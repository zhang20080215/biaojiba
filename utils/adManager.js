/**
 * 插屏广告管理器
 *
 * ── 硬约束：这个 Promise 必须、一定、无论如何都要 resolve ──
 * 调用方（7 个列表页的 onShareTypeSelect）是这个形态：
 *   this._navigatingToShare = true                       // 先上锁
 *   adManager.showInterstitial('share_interstitial').then(() => {
 *     wx.navigateTo({ ..., complete: () => { this._navigatingToShare = false } })
 *   })
 * 一旦这里悬空，navigateTo 永不执行、_navigatingToShare 永不复位，
 * 用户的「分享」按钮就彻底点不动了，只能退出页面重进。
 * 所以所有出口（正常关闭 / show 失败 / 超时）统一收敛到 finish()，绝不 reject。
 *
 * ── 实例约束（与 rewardedAdManager 同源的坑，2026-08 事故复盘）──
 * wx.createInterstitialAd 对同一 adUnitId 返回同一实例，但它是原生组件，
 * 绑定「最后一次 create 它的页面」。旧实现用模块级变量缓存首个实例、之后不再
 * 重新 create，跨页面 show() 会失败。现在每次都 create 一次拿回同一对象并重绑
 * 到当前页，代价极低。
 */

const { adConfig, getPlacement } = require('./adConfig')

// show() 成功后等 onClose 的兜底时限。插屏通常几秒内关闭，
// 这里只防「回调永远不来」把调用方永久挂起。
var CLOSE_TIMEOUT_MS = 30000

let _lastShownTime = 0
let _sessionCount = 0

/**
 * 拿到实例并绑定到当前页面。
 * 同一 adUnitId 返回同一对象，重复调用只是重绑页面。
 */
function _acquire(unitId) {
  if (!wx.createInterstitialAd) return null
  try {
    var ad = wx.createInterstitialAd({ adUnitId: unitId })
    if (ad && !ad.__xbjErrBound) {
      // 只绑一次，避免实例是单例时监听器跨页面累积
      ad.__xbjErrBound = true
      ad.onError(function (err) {
        console.warn('[adManager] interstitial error:', err && err.errCode, err && err.errMsg)
      })
    }
    return ad
  } catch (e) {
    console.warn('[adManager] createInterstitialAd failed:', e)
    return null
  }
}

/**
 * 检查是否可以展示插屏广告（频控）
 * @returns {boolean}
 */
function _canShowInterstitial() {
  var freq = adConfig.frequency
  if (_sessionCount >= freq.maxInterstitialsPerSession) return false
  if (Date.now() - _lastShownTime < freq.interstitialCooldownMs) return false
  return true
}

/**
 * 展示插屏广告
 * @param {string} placementName - 广告位名称（如 'share_interstitial'）
 * @returns {Promise<void>} - 广告关闭 / 展示失败 / 超时后 resolve，永不 reject
 */
function showInterstitial(placementName) {
  return new Promise(function (resolve) {
    if (!adConfig.enabled) return resolve()

    var placement = getPlacement(placementName)
    if (!placement) return resolve()

    if (!_canShowInterstitial()) return resolve()

    var ad = _acquire(placement.unitId)
    if (!ad) return resolve()

    var settled = false
    var timer = null

    var finish = function () {
      if (settled) return
      settled = true
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      if (ad.offClose) ad.offClose(onClose)
      resolve()
    }

    var onClose = function () {
      finish()
    }

    ad.onClose(onClose)

    try {
      var p = ad.show()
      if (p && p.then) {
        p.then(function () {
          _lastShownTime = Date.now()
          _sessionCount++
          // 广告已展示，等 onClose；但回调可能永远不来，挂个兜底
          if (!settled) {
            timer = setTimeout(finish, CLOSE_TIMEOUT_MS)
          }
        }).catch(function () {
          // 展示失败，直接放行调用方继续（不阻塞跳转）
          finish()
        })
      } else {
        // 异常实现下 show() 没返回 Promise：只能靠超时兜底
        timer = setTimeout(finish, CLOSE_TIMEOUT_MS)
      }
    } catch (e) {
      console.warn('[adManager] interstitial show threw:', e)
      finish()
    }
  })
}

module.exports = {
  showInterstitial,
}
