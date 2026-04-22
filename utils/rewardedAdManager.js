const { getPlacement } = require('./adConfig')

// 激励视频广告管理
// 约束：wx.createRewardedVideoAd 返回的实例是「页面作用域」的——页面 A
// 创建的实例在页面 B 调用 .show() 会抛
// "you can only invoke show() on the page where rewardedVideoAd is created"
// 解决：实例与「正在播放的 Promise」都按页面对象缓存（挂在 page 上）。
// 模块级单例曾导致一个 corner case：用户在广告关闭事件触发前跳页，
// activeShowPromise 永远不会 resolve，下一次在别的页面调用 show() 直接
// 返回已死的 promise，save 闸门卡死。改成 page-scoped 后，页面 GC 随之销毁。
const PAGE_AD_PROP = '__xbj_rewardedAd__'

function _createInstance(placementName) {
  if (!wx.createRewardedVideoAd) return null
  var placement = getPlacement(placementName)
  if (!placement || placement.type !== 'rewarded' || !placement.unitId) return null
  try {
    return wx.createRewardedVideoAd({ adUnitId: placement.unitId })
  } catch (err) {
    console.error('[rewardedAdManager] createRewardedVideoAd failed', err)
    return null
  }
}

function _getPageEntry(page, placementName) {
  if (!page) return null
  var bucket = page[PAGE_AD_PROP]
  return (bucket && bucket[placementName]) || null
}

function _ensurePageEntry(page, placementName) {
  if (!page) return null
  if (!page[PAGE_AD_PROP]) page[PAGE_AD_PROP] = {}
  if (!page[PAGE_AD_PROP][placementName]) page[PAGE_AD_PROP][placementName] = {}
  return page[PAGE_AD_PROP][placementName]
}

function _getPageAd(page, placementName) {
  var entry = _getPageEntry(page, placementName)
  return entry ? entry.ad : null
}

function _setPageAd(page, placementName, ad) {
  var entry = _ensurePageEntry(page, placementName)
  if (entry) entry.ad = ad
}

function _getActivePromise(page, placementName) {
  var entry = _getPageEntry(page, placementName)
  return entry ? entry.activePromise : null
}

function _setActivePromise(page, placementName, promise) {
  var entry = _getPageEntry(page, placementName)
  if (entry) entry.activePromise = promise
}

/**
 * 预热：在页面 onLoad / refreshHint 中调用。
 * 创建实例并触发素材 load，用户真正点保存时 .show() 瞬时播放。
 * 幂等：若当前页面已有实例则跳过。
 */
function preload(placementName, page) {
  if (_getPageAd(page, placementName)) return
  var ad = _createInstance(placementName)
  if (!ad) return

  try {
    // 挂一个静默的错误 listener 避免 unhandled；show() 时会另挂具体 handler
    ad.onError(function (err) {
      console.warn('[rewardedAdManager] preload warn', err && err.errMsg)
    })
    // 触发 SDK 下发素材，不阻塞调用方
    if (ad.load) {
      ad.load().catch(function () { /* 预热失败不处理，show 时兜底重新 load */ })
    }
  } catch (e) { /* ignore */ }

  _setPageAd(page, placementName, ad)
}

/**
 * 展示激励广告；resolve(true) = 完整观看，resolve(false) = 未完播/失败
 */
function show(placementName, page) {
  var active = _getActivePromise(page, placementName)
  if (active) return active

  var ad = _getPageAd(page, placementName)
  if (!ad) {
    ad = _createInstance(placementName)
    if (ad) _setPageAd(page, placementName, ad)
  }
  if (!ad) return Promise.resolve(true)

  var promise = new Promise(function (resolve) {
    var settled = false

    var cleanup = function () {
      if (ad.offClose) ad.offClose(handleClose)
      if (ad.offError) ad.offError(handleError)
      _setActivePromise(page, placementName, null)
      // 不清空 page 上的 ad 引用，下次 show 仍可复用；
      // 页面销毁时 JS 引用随 page 对象一起被 GC。
    }

    var finish = function (result) {
      if (settled) return
      settled = true
      cleanup()
      resolve(result)
    }

    var handleClose = function (res) {
      if (res === undefined || (res && res.isEnded)) {
        finish(true)
        return
      }
      wx.showToast({ title: '未完整观看广告，暂无法保存', icon: 'none' })
      finish(false)
    }

    var handleError = function (err) {
      console.error('[rewardedAdManager] rewarded error', err)
    }

    ad.onClose(handleClose)
    ad.onError(handleError)

    ad.show().catch(function () {
      return ad.load().then(function () {
        return ad.show()
      })
    }).catch(function (err) {
      console.warn('[rewardedAdManager] rewarded show fallback', err)
      var code = err && err.errCode
      // 1004=无合适广告 / 1005=广告组件未显示 —— 属于广告平台侧问题，
      // 非用户过错。放行保存并按已完播处理，避免阻塞正常业务。
      if (code === 1004 || code === 1005) {
        finish(true)
        return
      }
      wx.showToast({ title: '广告加载失败，请稍后重试', icon: 'none' })
      finish(false)
    })
  })

  _setActivePromise(page, placementName, promise)
  return promise
}

module.exports = {
  preload,
  show,
}
