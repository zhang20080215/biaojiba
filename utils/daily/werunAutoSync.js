/**
 * 每日步数 · 打开小程序就顺手同步微信运动（2026-10-29）
 *
 * 微信运动只给最近 30 天左右的数据，用户一个多月没进步数页，中间那段就永远补不回来了。
 * 所以授权过微信运动的用户，每次打开小程序（冷启动或切回前台，app.onShow）都在后台静默同步一次，
 * 每个北京自然日最多一次。只要一个月里打开过小程序，哪怕没进步数页，历史也是连续的。
 *
 * 几道闸，任何一道不过就什么都不做、也不弹窗：
 *   1. 今天已经同步过（本地记日期；步数页自己同步成功也会记，见 pages/daily/metric/common.js）
 *   2. 没授权过 scope.werun（getSetting 里不是 true）—— 没用过每日步数的人不会被弹授权窗
 *   3. 隐私协议要重新同意（getPrivacySetting.needAuthorization）—— 否则调 getWeRunData 会在首页弹出隐私窗
 * 失败一律静默、不记日期，下次 onShow 再试。
 */
const D = require('./date.js');

const KEY = 'werunAutoSyncDate';
let running = false;

function call(api, opts) {
  return new Promise((resolve, reject) => api(Object.assign({}, opts, { success: resolve, fail: reject })));
}

function syncedToday(now) {
  try { return wx.getStorageSync(KEY) === D.todayStr(now); } catch (e) { return false; }
}

function markSynced(now) {
  try { wx.setStorageSync(KEY, D.todayStr(now || Date.now())); } catch (e) { /* ignore */ }
}

/**
 * @returns Promise<'skip' | 'no-auth' | 'privacy' | 'synced' | 'fail'>（只给测试和日志看，调用方不用管）
 */
async function maybeSync(now) {
  const t = now || Date.now();
  if (running || !wx.cloud || syncedToday(t)) return 'skip';
  running = true;
  try {
    const setting = await call(wx.getSetting);
    if (!setting.authSetting || setting.authSetting['scope.werun'] !== true) return 'no-auth';
    if (wx.getPrivacySetting) {
      const ps = await call(wx.getPrivacySetting);
      if (ps && ps.needAuthorization) return 'privacy';
    }
    const run = await call(wx.getWeRunData);
    const res = await wx.cloud.callFunction({
      name: 'syncDailyLog',
      data: { action: 'syncSource', theme: 'steps', source: 'werun', weRunData: wx.cloud.CloudID(run.cloudID) }
    });
    if (!(res && res.result && res.result.success)) return 'fail';
    markSynced(t);
    return 'synced';
  } catch (e) {
    return 'fail';
  } finally {
    running = false;
  }
}

module.exports = { maybeSync, markSynced, KEY };
