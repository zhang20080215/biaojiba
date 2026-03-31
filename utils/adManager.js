/**
 * 插屏广告管理器（单例）
 * 负责插屏广告的创建、复用、频控和优雅降级
 */

const { adConfig, getPlacement } = require('./adConfig')

let _interstitialAd = null
let _lastShownTime = 0
let _sessionCount = 0

/**
 * 获取或创建插屏广告实例
 * @param {string} unitId
 * @returns {Object|null}
 */
function _getOrCreateInterstitial(unitId) {
  if (_interstitialAd) return _interstitialAd
  try {
    if (!wx.createInterstitialAd) return null
    _interstitialAd = wx.createInterstitialAd({ adUnitId: unitId })
    _interstitialAd.onError(function (err) {
      console.warn('[adManager] interstitial error:', err.errCode, err.errMsg)
    })
    return _interstitialAd
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
 * @returns {Promise<void>} - 广告关闭或跳过后 resolve
 */
function showInterstitial(placementName) {
  return new Promise(function (resolve) {
    if (!adConfig.enabled) return resolve()

    var placement = getPlacement(placementName)
    if (!placement) return resolve()

    if (!_canShowInterstitial()) return resolve()

    var ad = _getOrCreateInterstitial(placement.unitId)
    if (!ad) return resolve()

    // 注册一次性关闭回调
    var onClose = function () {
      ad.offClose(onClose)
      resolve()
    }
    ad.onClose(onClose)

    ad.show().then(function () {
      _lastShownTime = Date.now()
      _sessionCount++
    }).catch(function () {
      // 广告展示失败，直接继续
      ad.offClose(onClose)
      resolve()
    })
  })
}

module.exports = {
  showInterstitial,
}
