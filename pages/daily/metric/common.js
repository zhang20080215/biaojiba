// 数值型每日主题（pages/daily/metric/*）的页面公共逻辑：主题解析、主题色、云函数调用、外部数据源同步
const { THEMES } = require('../../../utils/dailyThemes.js');
const palette = require('../../../utils/daily/palette.js');

const DEFAULT_THEME = 'steps';

// ?theme= 只认数值型主题；不认识的回落到步数，免得落到喝水那套配置上
function resolveTheme(id) {
  const t = THEMES[id];
  return t && t.kind === 'metric' ? t : THEMES[DEFAULT_THEME];
}

// 页面根节点用的全站主题 class + JS 侧颜色（热力梯度、进度环、海报）
function themeState() {
  const cls = palette.currentClass();
  const p = palette.get(palette.idFromClass(cls));
  return { themeClass: cls, heat: p.heat, palette: p };
}

function callDaily(data) {
  return new Promise((resolve, reject) => {
    wx.cloud.callFunction({
      name: 'syncDailyLog',
      data,
      success: res => {
        const r = res && res.result;
        if (r && r.success) resolve(r);
        else reject(new Error((r && r.error) || '请求失败'));
      },
      fail: reject
    });
  });
}

function getSettingAsync() {
  return new Promise(resolve => {
    wx.getSetting({ success: res => resolve(res.authSetting || {}), fail: () => resolve({}) });
  });
}

function getWeRunDataAsync() {
  return new Promise((resolve, reject) => {
    wx.getWeRunData({ success: resolve, fail: reject });
  });
}

/**
 * 从主题的外部数据源同步，结果：
 *   { ok: true, changed }        同步成功（changed = 有新增或改动）
 *   { ok: false, denied: true }  用户拒绝过授权，需要引导去设置页
 *   { ok: false, error }         其它失败（没开微信运动、隐私协议未声明、网络……）
 */
async function syncSource(theme) {
  if (theme.source !== 'werun') return { ok: true, changed: false };
  const auth = await getSettingAsync();
  if (auth['scope.werun'] === false) return { ok: false, denied: true };
  let res;
  try {
    res = await getWeRunDataAsync();
  } catch (err) {
    const msg = (err && err.errMsg) || '';
    if (/auth den/i.test(msg)) return { ok: false, denied: true };
    console.warn('[metric] getWeRunData fail', msg);
    return { ok: false, error: msg };
  }
  try {
    const r = await callDaily({
      action: 'syncSource',
      theme: theme.id,
      source: 'werun',
      weRunData: wx.cloud.CloudID(res.cloudID)
    });
    return { ok: true, changed: (r.added || 0) + (r.updated || 0) > 0 };
  } catch (err) {
    console.warn('[metric] syncSource fail', err);
    return { ok: false, error: (err && (err.errMsg || err.message)) || '' };
  }
}

// 「x 分钟前同步」
function syncAgoText(ts, sourceName) {
  if (!ts) return '';
  const min = Math.floor((Date.now() - ts) / 60000);
  const when = min < 1 ? '刚刚' : min < 60 ? `${min} 分钟前` : `${Math.floor(min / 60)} 小时前`;
  return `${when}已同步${sourceName || ''}`;
}

module.exports = { resolveTheme, themeState, callDaily, syncSource, syncAgoText };
