/**
 * openid 等待器（激励闸门与展示类广告位灰度共用）
 *
 * openid 由 app.onLaunch 里异步 cloud.callFunction('getOpenid') 取得，用户冷启动后
 * 很快操作时它可能还是空的。这里短轮询等待，并在拿不到时补触发一次 app.ensureOpenid()
 * —— 启动那几秒 getOpenid 失败的话，原本这个会话就再也没机会重试，灰度判定对该用户
 * 整个会话失效（历史上约 17% 的保存因此没触发闸门）。
 *
 * ⚠ 这两个函数原先只长在 rewardedSaveGate.js 里。展示类广告位做灰度需要同一套逻辑，
 *   复制一份必然随时间走样（尤其是上面那个 ensureOpenid 补触发，它本身是个事故修复），
 *   所以抽到这里两边共用。改这里之前想清楚：激励闸门和所有展示位灰度都受影响。
 */

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

function awaitOpenid(page, timeoutMs) {
  return new Promise(function (resolve) {
    const immediate = getCurrentOpenid(page)
    if (immediate) return resolve(immediate)
    // 还没拿到就补触发一次拉取：启动那几秒 getOpenid 失败的话，原本这个会话
    // 就再也没机会了，灰度判定对该用户永久失效。
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

module.exports = {
  getCurrentOpenid,
  awaitOpenid,
}
