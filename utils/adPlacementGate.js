/**
 * 展示类广告位的灰度闸门（banner / 原生 / 插屏）
 *
 * 与 rewardedSaveGate 的区别：那个是「保存前必须看完激励视频」的**行为闸门**，会拦住
 * 用户操作；这个只决定「这个位子给不给这个用户看」，不拦任何操作。
 *
 * 三层，任意一层不过就返回空串，页面据此整块不渲染：
 *   ① 全局 enabled + placements[name].enabled —— 云端 app_config 可改，不用发版
 *   ② unitId —— 只在代码里，换广告位要发版
 *   ③ grayRollout[name] 百分比（+ grayForceIn[name] 白名单直通）—— 云端可改，不用发版
 *
 * 页面用法：
 *   const adPlacementGate = require('../../../utils/adPlacementGate')
 *   async initAds() {
 *     const unitId = await adPlacementGate.resolveUnitId('daily_movie_banner', this)
 *     if (this._destroyed) return
 *     this.setData({ 'adUnitIds.daily_movie_banner': unitId, showBannerAd: !!unitId })
 *   }
 */

const adConfig = require('./adConfig')
const grayBucket = require('./grayBucket')
const { awaitOpenid } = require('./openidWaiter')

/**
 * openid 拿不到时一律**不投放**。
 * 注意这与激励闸门的默认方向相反：那边拿不到 openid 是"放行不闸"（默认不打扰用户），
 * 这边拿不到是"不出广告"（默认不在灰度放开前全量投出去）。两边的安全侧不同。
 */
function isInGray(placementName, openid) {
  if (!openid) return false
  if (adConfig.isForcedIntoGray(placementName, openid)) return true
  const percentage = adConfig.getGrayPercentage(placementName)
  if (percentage <= 0) return false
  return grayBucket.isInBucket(openid, percentage)
}

/**
 * @returns {Promise<string>} 该用户此刻应该用的 unitId；空串 = 不投放
 */
async function resolveUnitId(placementName, page, timeoutMs) {
  // getAdUnitId 已经覆盖了①全局开关、②该位 enabled、③unitId 是否配了
  const unitId = adConfig.getAdUnitId(placementName) || ''
  if (!unitId) return ''
  const openid = await awaitOpenid(page, timeoutMs || 1500)
  return isInGray(placementName, openid) ? unitId : ''
}

module.exports = {
  resolveUnitId,
  isInGray,
}
