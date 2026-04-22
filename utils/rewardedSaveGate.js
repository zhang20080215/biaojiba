/**
 * 保存图片激励广告闸门（统一模块）
 *
 * 使用方式（在 Page 中）：
 *   const rewardedSaveGate = require('../../../utils/rewardedSaveGate')
 *
 *   data: { needRewardedAd: false, ... }
 *   onLoad() { ... await this.loadUserInfo(); rewardedSaveGate.refreshHint(this); }
 *   async saveImage() {
 *     const ok = await rewardedSaveGate.ensureGrant(this)
 *     if (!ok) return
 *     // ... 继续保存流程
 *   }
 *
 * WXML 建议把按钮文字按 needRewardedAd 切换：
 *   {{isGenerating ? '生成中...' : '保存到相册'}}
 *   needRewardedAd 时额外显示副文案："需观看广告后保存"
 *   （避免使用"免费/解锁/无限制/奖励"等违反微信《小程序广告规范》的措辞）
 */

const adConfig = require('./adConfig')
const grayBucket = require('./grayBucket')
const rewardedAdManager = require('./rewardedAdManager')

const PLACEMENT = 'save_image_rewarded'
const KEY_PREFIX = 'rewarded_save_grant_date_'

function getCurrentOpenid(page) {
  const app = getApp()
  if (app && app.globalData && app.globalData.openid) {
    return app.globalData.openid
  }
  if (page && page.data && page.data.userInfo && page.data.userInfo._openid) {
    return page.data.userInfo._openid
  }
  return ''
}

// openid 由 app.onLaunch 中异步 cloud.callFunction('getOpenid') 获取，
// 用户冷启动后迅速点保存时可能仍为空。短轮询等待，避免此窗口期内整个灰度判定被跳过。
function awaitOpenid(page, timeoutMs) {
  return new Promise(function (resolve) {
    const immediate = getCurrentOpenid(page)
    if (immediate) return resolve(immediate)
    const deadline = Date.now() + (timeoutMs || 1500)
    const tick = function () {
      const openid = getCurrentOpenid(page)
      if (openid) return resolve(openid)
      if (Date.now() >= deadline) return resolve('')
      setTimeout(tick, 100)
    }
    setTimeout(tick, 100)
  })
}

function getTodayISO() {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function grantKey(openid) {
  return `${KEY_PREFIX}${openid}`
}

function hasTodayGrant(openid) {
  if (!openid) return false
  return wx.getStorageSync(grantKey(openid)) === getTodayISO()
}

function isGated(openid) {
  if (!openid) return false
  const forced = adConfig.isForcedIntoGray(PLACEMENT, openid)
  if (!forced) {
    const percentage = adConfig.getGrayPercentage(PLACEMENT)
    if (percentage <= 0) return false
    if (!grayBucket.isInBucket(openid, percentage)) return false
  }
  return !hasTodayGrant(openid)
}

/**
 * 刷新页面 needRewardedAd 状态（用于显示/隐藏保存按钮副文案）
 * 命中灰度时同步预热激励广告实例，点击保存时 .show() 几乎零延迟。
 * 冷启动 openid 未到位时异步等待再判定，避免 hint 首屏总是显示"保存到相册"。
 */
function refreshHint(page) {
  if (!page || typeof page.setData !== 'function') return
  awaitOpenid(page, 1500).then(function (openid) {
    if (!page || typeof page.setData !== 'function') return
    const needRewardedAd = isGated(openid)
    if (page.data.needRewardedAd !== needRewardedAd) {
      page.setData({ needRewardedAd })
    }
    if (needRewardedAd) {
      rewardedAdManager.preload(PLACEMENT, page)
    }
  })
}

/**
 * 保存前调用：确保用户已通过激励广告闸门
 * @returns {Promise<boolean>} true=放行继续保存，false=未完播应中止
 */
async function ensureGrant(page) {
  // 等 openid 到位再判灰度；冷启动窗口期 openid 为空时直接放行会绕过闸门。
  // 超时兜底仍放行，避免 cloud 异常时阻塞正常保存——极端 case，不是灰度用户预期路径。
  const openid = await awaitOpenid(page, 1500)
  if (!isGated(openid)) return true

  const watched = await rewardedAdManager.show(PLACEMENT, page)
  if (!watched) return false

  wx.setStorageSync(grantKey(openid), getTodayISO())
  if (page && page.data && page.data.needRewardedAd) {
    page.setData({ needRewardedAd: false })
  }
  return true
}

module.exports = {
  ensureGrant,
  refreshHint,
  isGated,
}
