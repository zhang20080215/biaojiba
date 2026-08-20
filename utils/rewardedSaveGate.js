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
const { track } = require('./track')

const PLACEMENT = 'save_image_rewarded'

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
    // 还没拿到就补触发一次拉取：启动那几秒 getOpenid 失败的话，原本这个会话
    // 就再也没机会了，闸门对该用户永久失效（历史约 17% 的保存没触发闸门）。
    try {
      const app = getApp()
      if (app && typeof app.ensureOpenid === 'function') app.ensureOpenid()
    } catch (e) { /* ignore */ }
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

function isGated(openid) {
  if (!openid) return false
  // 熔断兜底：连续多次广告侧异常后本地自动停闸 2 小时，之后自动恢复。
  // 广告链路再出问题时，用户不必每次保存都白等超时，也不用等云端配置或发版。
  if (rewardedAdManager.isCircuitOpen()) return false
  const forced = adConfig.isForcedIntoGray(PLACEMENT, openid)
  if (!forced) {
    const percentage = adConfig.getGrayPercentage(PLACEMENT)
    if (percentage <= 0) return false
    if (!grayBucket.isInBucket(openid, percentage)) return false
  }
  // 每次保存都需观看激励广告：命中灰度即每次都闸，不再按天授权放行
  return true
}

/**
 * 刷新页面 needRewardedAd 状态（用于显示/隐藏保存按钮副文案）
 * 命中灰度时同步预热激励广告实例，点击保存时 .show() 几乎零延迟。
 * 冷启动 openid 未到位时异步等待再判定，避免 hint 首屏总是显示"保存到相册"。
 */
function refreshHint(page) {
  if (!page || typeof page.setData !== 'function') return
  // 打开海报页即埋一次“查看海报”；与 poster_save 组成漏斗：poster_view − poster_save = 看了海报但没保存
  track('poster_view', { route: (page && page.route) || '' })
  awaitOpenid(page, 1500).then(function (openid) {
    syncHint(page, openid)
    if (page && page.data && page.data.needRewardedAd) {
      rewardedAdManager.preload(PLACEMENT, page)
    }
  })
}

/**
 * 只同步 needRewardedAd 副文案，不埋点、不预热。
 * 保存流程结束后也要调一次：广告连挂 3 次会触发熔断、之后 2 小时不再闸门，
 * 若不同步，按钮会一直挂着“需观看广告后保存”，而实际上点了并不看广告。
 */
function syncHint(page, openid) {
  // page._destroyed：页面若已 onUnload，此处 setData 会让渲染层往已销毁的父节点插节点
  // （insertTextView:fail parent not found）。未定义该字段的页面不受影响。
  if (!page || page._destroyed || typeof page.setData !== 'function') return
  const needRewardedAd = isGated(openid)
  if (page.data.needRewardedAd !== needRewardedAd) {
    page.setData({ needRewardedAd })
  }
}

/**
 * 保存前调用：确保用户已通过激励广告闸门
 * @returns {Promise<boolean>} true=放行继续保存，false=未完播/已有保存在途，应中止
 */
async function ensureGrant(page) {
  // ── 连点保护 ──
  // 各海报页的 saveImage 形如：
  //   if (this.data.isGenerating) return          // 守卫
  //   await rewardedSaveGate.ensureGrant(this)    // ← 等一整段广告，30s+
  //   this.setData({ isGenerating: true })        // 守卫这时才生效
  // 守卫和置位之间隔着整段广告播放，期间每次点击都能穿过页面守卫，广告结束后
  // 多条流程一起往下跑 —— 相册里出现多张一样的图、loading 打架、poster_save 重复上报。
  // 守卫放在这里，20 个海报页一处生效，不必逐页改。
  // 注意：早退必须在 try 之外，否则 finally 会把在途那次的标记清掉。
  if (page && page._rewardedGateInFlight) return false
  if (page) page._rewardedGateInFlight = true

  let currentOpenid = ''
  // 整个闸门包在 try 里：这里抛任何异常都会让 20 个页面的 saveImage 静默中止，
  // 用户点了没反应。广告链路出任何意外，一律放行保存。
  try {
    // 等 openid 到位再判灰度；冷启动窗口期 openid 为空时直接放行会绕过闸门。
    // 超时兜底仍放行，避免 cloud 异常时阻塞正常保存——极端 case，不是灰度用户预期路径。
    const openid = await awaitOpenid(page, 1500)
    currentOpenid = openid
    const gated = isGated(openid)
    // 每次保存尝试都埋点：gated=1 表示本次需看广告，用于观察“每次看广告”改动对保存量的影响
    track('poster_save', { route: (page && page.route) || '', gated: gated ? 1 : 0 })
    if (!gated) return true

    const watched = await rewardedAdManager.show(PLACEMENT, page)
    if (!watched) return false

    // 每次保存都需观看广告：不写当天授权，下次保存仍会触发闸门，needRewardedAd 保持为 true
    return true
  } catch (err) {
    console.warn('[rewardedSaveGate] ensureGrant 异常，放行保存', err)
    return true
  } finally {
    if (page) page._rewardedGateInFlight = false
    // 本次可能触发了熔断（连挂 3 次 → 停闸 2 小时），同步一下按钮副文案，
    // 免得一直挂着「需观看广告后保存」而实际已经不看广告了
    syncHint(page, currentOpenid)
  }
}

module.exports = {
  ensureGrant,
  refreshHint,
  isGated,
}
