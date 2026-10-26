const STATS_KEY = 'hubStatsV1';
const { merge } = require('./hubStats');
const HISTORY_KEY = 'hubHistoryV1';
const PATHS = { home: '/pages/category/category', discover: '/pages/discover/index', records: '/pages/records/index', profile: '/pages/profile/index' };
let statsFlight = null;
let statsFetchedAt = 0;
const statsListeners = new Set();
// 云端统计按北京时间自然日刷新（见 getThemeHub/statsCache.js），本地同口径判断「是不是今天的」
const STATS_RETRY_MS = 5 * 60000;
function todayKey() { return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10); }
let intent = null;
let summary = null;
let summaryAt = 0;
let summaryFlight = null;
function read(key, fallback) { try { return wx.getStorageSync(key) || fallback; } catch (e) { return fallback; } }
function write(key, value) { try { wx.setStorageSync(key, value); } catch (e) {} }
function usableStats(snapshot) {
  return !!(snapshot && snapshot.rows && Number.isFinite(snapshot.generatedAt) &&
    Object.values(snapshot.rows).some(row => row && row.valid === true && Number.isFinite(row.users) && row.users >= 0));
}
function readStats() {
  const c = read(STATS_KEY, null);
  return usableStats(c) ? c : null;
}
function acceptStats(result) {
  if (!result) return;
  result = merge(readStats(), result);
  if (usableStats(result)) write(STATS_KEY, result);
  for (const listener of statsListeners) {
    try { listener(result); } catch (e) { console.warn('[hubStats] view update failed'); }
  }
  return result;
}
// 本访客抢到了今天的统计锁：后台发起统计，不等待、不改当前页面（用户这次照常看历史数据）。
// 算完只写本地缓存，下次进入首页时 loadStats 读到今天的数据直接用。
function computeInBackground(token) {
  wx.cloud.callFunction({ name: 'getThemeHub', data: { action: 'computeStats', token } }).then(res => {
    const result = res && res.result;
    if (!result || !result.success) return;
    const merged = merge(readStats(), result);
    if (usableStats(merged)) write(STATS_KEY, merged);
  }).catch(() => { /* 失败无感：云端锁到期后由下一个访客重新触发 */ });
}
async function loadStats(force, onUpdate) {
  // 本地已是今天的统计就直接用，不调云函数；云端还停在昨天（别人正在刷新）时，5 分钟内也不重复问。
  // force（下拉刷新/重试）照常问云端 —— 云端当天有缓存，只是一次读文档。
  const cached = readStats();
  if (!force && cached && (cached.day === todayKey() || Date.now() - statsFetchedAt < STATS_RETRY_MS)) return cached;
  if (typeof onUpdate === 'function') statsListeners.add(onUpdate);
  if (statsFlight) return statsFlight;
  statsFlight = Promise.resolve().then(() => wx.cloud.callFunction({ name: 'getThemeHub', data: { action: 'stats' } })).then(res => {
    const result = res && res.result;
    if (!result || !result.success) return readStats();
    statsFetchedAt = Date.now();
    if (result.refreshToken) computeInBackground(result.refreshToken);
    return acceptStats(result);
  }).catch(() => readStats()).finally(() => {
    statsFlight = null;
    statsListeners.clear();
  });
  return statsFlight;
}
function readHistory() { const rows = read(HISTORY_KEY, []); return Array.isArray(rows) ? rows.filter(r => r && typeof r.id === 'string') : []; }
function remember(id) {
  if (!id) return;
  write(HISTORY_KEY, [{ id, at: Date.now() }].concat(readHistory().filter(r => r.id !== id)).slice(0, 30));
}
function invalidateSummary() { summaryAt = 0; }
async function loadSummary(force) {
  if (!force && summary && Date.now() - summaryAt < 15000) return summary;
  if (summaryFlight) return summaryFlight;
  summaryFlight = wx.cloud.callFunction({ name: 'getThemeHub', data: { action: 'summary' } }).then(res => {
    if (!res.result || !res.result.success) throw new Error('summary unavailable');
    summary = res.result; summaryAt = Date.now(); return summary;
  }).finally(() => { summaryFlight = null; });
  return summaryFlight;
}
function switchTo(kind, data) {
  if (!PATHS[kind]) return;
  intent = data ? { kind, data } : null;
  wx.switchTab({ url: PATHS[kind], fail: () => { intent = null; wx.showToast({ title: '页面打开失败', icon: 'none' }); } });
}
function takeIntent(kind) { if (!intent || intent.kind !== kind) return null; const data = intent.data; intent = null; return data; }
function applyTabStyle(theme) {
  const selected = { 'theme-green': '#526631', 'theme-gold': '#856216', 'theme-sand': '#756448', '': '#9F4865' }[theme] || '#526631';
  if (wx.setTabBarStyle) wx.setTabBarStyle({ color: '#77776D', selectedColor: selected, backgroundColor: '#FAFAFA', borderStyle: 'white' });
  const suffix = { 'theme-green': '', 'theme-gold': '-gold', 'theme-sand': '-sand', '': '-pink' }[theme] || '';
  if (wx.setTabBarItem) ['home', 'discover', 'records', 'profile'].forEach((name, index) => {
    wx.setTabBarItem({ index, selectedIconPath: 'images/tabs/' + name + '-active' + suffix + '.png' });
  });
}
module.exports = { readStats, loadStats, readHistory, remember, invalidateSummary, loadSummary, switchTo, takeIntent, applyTabStyle };
