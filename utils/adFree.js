/**
 * 会员（免广告）状态
 *
 * 数据源是云数据库 **vip_users** 集合，一人一条、_id 就是 openid，由云函数
 * `getVipStatus` 按 wxContext.OPENID 查询。加人 / 撤销 / 改到期时间都在云开发控制台
 * 改表，**不用发版**。表结构见 cloudfunctions/getVipStatus/index.js 顶部注释。
 *
 * 为什么不是「配置里放一个 openid 数组」：数组存不下金额、渠道、到期时间、流水号，
 * 人一多没法对账，而且整份名单会下发到每个客户端。查表只回传当前这个人的判定结果。
 *
 * 本模块**不 require 项目内任何模块**——adConfig 要 require 它（getPlacement 首行就要问），
 * 反过来再 require adConfig 就成环了。
 *
 * ── 同步 / 异步的错位 ──
 * 各页面在 onLoad 里**同步**调 adConfig.getAdUnitId()，而云函数是**异步**的。
 * 所以判定结果要落一份 storage，冷启动时同步读回来，第一屏就能是对的。代价是：
 *   - 刚开通的用户，**当次进入仍会看到已经渲染出来的展示类广告**（app.js 会在判定
 *     翻转时把存活页面上的广告就地撤掉，所以实际影响很小）；
 *     激励闸门不受这个限制，它每次点保存都重新判定。
 *   - 撤销同理滞后一次。
 *
 * ── 为什么撤销要比授予严格 ──
 * 云函数调用失败（网络差、函数没部署、超时）时不能当作「不是会员」，否则已付费用户
 * 的广告又冒出来了。只有**查询成功**才允许 true→false；失败一律维持现状。
 * 唯一的例外是本地判定到期（expireAt 已过），那不需要联网也能确定。
 */

var STORAGE_KEY = 'ad_free_flag'
var CLOUD_FN = 'getVipStatus'

// 每次进入小程序都会刷一次，节流只为吃掉「onLaunch 与 onShow 在冷启动时连着各调一次」
// （两者相隔毫秒级）。取 3 秒——取大了会留出「刚开通、用户立刻退出重进却查不到」的死窗口。
var MIN_FETCH_INTERVAL_MS = 3000

// 当前判定结果。模块加载时先从 storage 同步恢复，让首屏就有正确答案。
var _adFree = false
// 上面那个结果属于哪个 openid（同设备换微信号时要能识别出来重算）
var _owner = null
// 到期时间戳；null = 永久
var _expireAt = null
var _listeners = []
var _lastFetchAt = 0
var _inflight = null

;(function boot() {
  try {
    var cached = wx.getStorageSync(STORAGE_KEY)
    if (cached && cached.adFree === true) {
      _adFree = true
      _owner = cached.openid || null
      _expireAt = typeof cached.expireAt === 'number' ? cached.expireAt : null
    }
  } catch (e) { /* ignore */ }
})()

/**
 * 是否免广告。**同步**，可在 onLoad 里直接用。
 * 顺带做本地到期判定：年卡到期不必等联网就该失效。
 */
function isAdFree() {
  if (_adFree !== true) return false
  if (_expireAt !== null && Date.now() > _expireAt) {
    _adFree = false
    _persist(_owner, false, null)
    _notify(false)
    return false
  }
  return true
}

/** 到期时间戳（null = 永久 / 非会员） */
function getExpireAt() {
  return _adFree ? _expireAt : null
}

/**
 * 向云端查一次会员状态并应用结果。
 * @param {boolean} force 跳过节流（「刷新会员状态」按钮用）
 * @returns {Promise<boolean>} 判定结果是否发生了变化
 */
function refresh(force) {
  var now = Date.now()
  if (force !== true && _lastFetchAt && now - _lastFetchAt < MIN_FETCH_INTERVAL_MS) {
    return Promise.resolve(false)
  }
  // 在途去重：onLaunch 和 onShow 撞在一起时不要发两次
  if (_inflight) return _inflight
  if (!wx.cloud) return Promise.resolve(false)

  _lastFetchAt = now

  var p
  try {
    p = wx.cloud.callFunction({ name: CLOUD_FN })
  } catch (e) {
    // wx.cloud 存在不等于 init 成功过，callFunction 可能同步抛
    return Promise.resolve(false)
  }

  _inflight = Promise.resolve(p).then(function (res) {
    var r = (res && res.result) || null
    if (!r || r.success !== true || !r.openid) return false
    return _apply(r.openid, r.isVip === true, typeof r.expireAt === 'number' ? r.expireAt : null)
  }).catch(function (err) {
    // 查不到就维持现状，绝不据此撤销
    console.warn('[adFree] 查询会员状态失败，维持现状:', (err && (err.errMsg || err.message)) || err)
    return false
  }).then(function (changed) {
    _inflight = null
    return changed
  })

  return _inflight
}

/**
 * 应用一次**可信**的查询结果。
 * @returns {boolean} 判定结果是否发生了变化
 */
function _apply(openid, isVip, expireAt) {
  var changed = isVip !== _adFree
  var ownerChanged = _owner !== openid
  var expireChanged = expireAt !== _expireAt

  _adFree = isVip
  _owner = openid
  _expireAt = isVip ? expireAt : null

  if (changed || ownerChanged || expireChanged) _persist(openid, isVip, _expireAt)
  if (changed) _notify(isVip)
  return changed
}

function _persist(openid, adFree, expireAt) {
  try {
    if (adFree) {
      wx.setStorageSync(STORAGE_KEY, {
        openid: openid,
        adFree: true,
        expireAt: expireAt,
        ts: Date.now(),
      })
    } else {
      wx.removeStorageSync(STORAGE_KEY)
    }
  } catch (e) { /* ignore */ }
}

/**
 * 判定结果变化时回调。展示类广告位不监听（页面 onLoad 已经取过 unitId 了，
 * 见文件头的错位说明）；app.js 用它撤掉存活页面上的广告并弹开通提示。
 */
function onChange(cb) {
  if (typeof cb === 'function' && _listeners.indexOf(cb) === -1) _listeners.push(cb)
}

function offChange(cb) {
  var i = _listeners.indexOf(cb)
  if (i !== -1) _listeners.splice(i, 1)
}

function _notify(adFree) {
  for (var i = 0; i < _listeners.length; i++) {
    try {
      _listeners[i](adFree)
    } catch (e) {
      console.warn('[adFree] onChange 回调抛错:', e)
    }
  }
}

module.exports = {
  isAdFree: isAdFree,
  getExpireAt: getExpireAt,
  refresh: refresh,
  onChange: onChange,
  offChange: offChange,
  STORAGE_KEY: STORAGE_KEY,
}
