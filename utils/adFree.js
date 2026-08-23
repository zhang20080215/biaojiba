/**
 * 免广告白名单（按 openid 加白）
 *
 * 名单来源是云端 `app_config` 里 `key:"ad_config"` 那条文档的 `adFreeOpenids` 数组，
 * 走 adConfig 已有的远程配置通道（SWR 缓存），**加白/撤销都不用发版**：
 *   { key: "ad_config", ..., adFreeOpenids: ["oXXXX...", "oYYYY..."] }
 *
 * 本模块**不 require 任何东西**——adConfig 要 require 它（getPlacement 首行就要问），
 * 反过来再 require adConfig 就成环了。名单由 adConfig 单向 push 进来（apply()）。
 *
 * ── 同步 / 异步的错位 ──
 * 各页面在 onLoad 里**同步**调 adConfig.getAdUnitId()，而 openid 和云端名单都是**异步**到的。
 * 所以判定结果要落一份 storage，冷启动时同步读回来，第一屏就能是对的。代价是：
 *   - 刚被加白的用户，**当次冷启动仍会看到展示类广告**，下次启动才干净；
 *     激励闸门不受这个限制，它每次点保存都重新判定。
 *   - 撤销同理滞后一次冷启动。
 *
 * ── 为什么撤销要比授予严格 ──
 * 网络差 / 云端没拉到时，名单可能是空的或过期的。若照单撤销，等于把已付费用户的广告
 * 又放出来。所以只有 `trusted`（本次云端拉取成功）的名单才允许 true→false，
 * 本地缓存与本地默认只允许 false→true。
 */

var STORAGE_KEY = 'ad_free_flag'

// 当前判定结果。模块加载时先从 storage 同步恢复，让首屏就有正确答案。
var _adFree = false
// 上面那个结果属于哪个 openid（同设备换微信号时要能识别出来重算）
var _owner = null
var _listeners = []

;(function boot() {
  try {
    var cached = wx.getStorageSync(STORAGE_KEY)
    if (cached && cached.adFree === true) {
      _adFree = true
      _owner = cached.openid || null
    }
  } catch (e) { /* ignore */ }
})()

/**
 * 是否免广告。**同步**，可在 onLoad 里直接用。
 */
function isAdFree() {
  return _adFree === true
}

/**
 * 用（openid, 名单）重新判定。
 *
 * @param {string} openid    当前用户 openid；为空则维持现状（宁可继续免广告，
 *                           也不要因为 openid 还没到就把已付费用户的广告放出来）
 * @param {string[]} list    白名单
 * @param {boolean} trusted  名单是否来自云端本次拉取成功。false 时只授予不撤销。
 * @returns {boolean} 判定结果是否发生了变化
 */
function apply(openid, list, trusted) {
  if (!openid) return false

  var hit = Array.isArray(list) && list.indexOf(openid) !== -1

  // 不可信来源不撤销
  if (!hit && !trusted && _adFree) return false

  var changed = hit !== _adFree
  var ownerChanged = _owner !== openid

  _adFree = hit
  _owner = openid

  if (changed || ownerChanged) _persist(openid, hit)
  if (changed) _notify(hit)
  return changed
}

function _persist(openid, adFree) {
  try {
    if (adFree) {
      wx.setStorageSync(STORAGE_KEY, { openid: openid, adFree: true, ts: Date.now() })
    } else {
      wx.removeStorageSync(STORAGE_KEY)
    }
  } catch (e) { /* ignore */ }
}

/**
 * 判定结果变化时回调。展示类广告位不监听（页面 onLoad 已经取过 unitId 了，
 * 见文件头的错位说明）；给激励闸门刷新按钮副文案、以及将来的会员页用。
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
  apply: apply,
  onChange: onChange,
  offChange: offChange,
  STORAGE_KEY: STORAGE_KEY,
}
