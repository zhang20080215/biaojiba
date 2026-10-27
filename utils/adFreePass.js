/**
 * 限时无广告通行证：用户在首页看完一段激励视频，之后 30 分钟内不展示**页面广告**
 * （banner / 原生 / 插屏）。激励视频（保存海报、填字提示 / 复活）照旧——那是收入大头，
 * 一起关掉会让「看 1 次连存」把它吃掉，见 adConfig.getPlacement。会员则是全关。
 *
 * 与会员（utils/adFree.js）**刻意分开存**：会员那份状态驱动「会员已开通」弹窗、
 * 我的页「已开通」徽标和到期日，限时通行证混进去会让这些全部误报。
 * 通行证只在 adConfig.getPlacement 一处生效（且跳过 type=rewarded 的位）。
 *
 * 只存本地（wx.storage），不上云：30 分钟的权益丢了无所谓，换设备也不该带过去。
 * 到期是惰性判定的——isActive() 被问到时才发现过期并通知；页面要在到期那一刻恢复广告，
 * 自己按 getUntil() 定时（见 hubPage.syncAdFreePass）。
 *
 * 本模块**不 require 项目内任何模块**：adConfig 要 require 它，反过来就成环了（同 adFree.js）。
 */

var STORAGE_KEY = 'ad_free_pass'
var DURATION_MS = 30 * 60 * 1000

var _until = 0
var _listeners = []

;(function boot() {
  try {
    var cached = wx.getStorageSync(STORAGE_KEY)
    if (cached && typeof cached.until === 'number' && cached.until > Date.now()) _until = cached.until
  } catch (e) { /* ignore */ }
})()

/** 通行证是否生效中。同步，过期时顺手清掉并通知一次 */
function isActive() {
  if (!_until) return false
  if (Date.now() < _until) return true
  _until = 0
  try { wx.removeStorageSync(STORAGE_KEY) } catch (e) { /* ignore */ }
  _notify(false)
  return false
}

/** 生效中返回到期时间戳，否则 0 */
function getUntil() {
  return isActive() ? _until : 0
}

/** 看完视频后发放：从现在起 DURATION_MS。重复发放只会重新计时，不叠加 */
function grant() {
  _until = Date.now() + DURATION_MS
  try { wx.setStorageSync(STORAGE_KEY, { until: _until, ts: Date.now() }) } catch (e) { /* ignore */ }
  _notify(true)
  return _until
}

function onChange(cb) {
  if (typeof cb === 'function' && _listeners.indexOf(cb) === -1) _listeners.push(cb)
}

function offChange(cb) {
  var i = _listeners.indexOf(cb)
  if (i !== -1) _listeners.splice(i, 1)
}

function _notify(active) {
  for (var i = 0; i < _listeners.length; i++) {
    try {
      _listeners[i](active)
    } catch (e) {
      console.warn('[adFreePass] onChange 回调抛错:', e)
    }
  }
}

module.exports = {
  isActive: isActive,
  getUntil: getUntil,
  grant: grant,
  onChange: onChange,
  offChange: offChange,
  DURATION_MS: DURATION_MS,
  STORAGE_KEY: STORAGE_KEY,
}
