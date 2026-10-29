/**
 * 每日主题公共层 · 日期与导航尺寸
 *
 * 全部按北京时间、周一开头计算；日期在各处一律用 'YYYY-MM-DD' 字符串传递，
 * 内部用 UTC 零点的 Date 做加减，避免设备时区影响。
 * movie / read / sport 的 common.js 各有一份同样的实现，二期迁移时改为引用这里。
 */

const WD_MON = ['一', '二', '三', '四', '五', '六', '日'];
const DAY_MS = 86400000;

// wx.getSystemInfoSync 已废弃：优先 wx.getWindowInfo，回退兼容旧基础库
function getWindowInfoCompat() {
  try { if (wx.getWindowInfo) return wx.getWindowInfo(); } catch (e) { /* ignore */ }
  try { if (wx.getSystemInfoSync) return wx.getSystemInfoSync(); } catch (e) { /* ignore */ }
  return {};
}

// 自定义导航栏尺寸：navRightInset 是右侧控件需要避开胶囊的内边距（px）
function getNavMetrics() {
  const fallback = { statusBarHeight: 20, navBarHeight: 48, navOffset: 68, navRightInset: 96 };
  try {
    const info = getWindowInfoCompat();
    const statusBarHeight = info.statusBarHeight || fallback.statusBarHeight;
    const screenW = info.windowWidth || info.screenWidth || 375;
    let navBarHeight = fallback.navBarHeight;
    let navRightInset = fallback.navRightInset;
    if (wx.getMenuButtonBoundingClientRect) {
      const menu = wx.getMenuButtonBoundingClientRect();
      if (menu && menu.top && menu.height) navBarHeight = (menu.top - statusBarHeight) * 2 + menu.height;
      if (menu && menu.left) navRightInset = Math.round(screenW - menu.left + 8);
    }
    return { statusBarHeight, navBarHeight, navOffset: statusBarHeight + navBarHeight, navRightInset };
  } catch (e) {
    return fallback;
  }
}

function todayStr(now) {
  const d = new Date((now == null ? Date.now() : now) + 8 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

function parseDate(str) {
  const p = String(str || '').split('-').map(Number);
  return new Date(Date.UTC(p[0], p[1] - 1, p[2]));
}

function dateStr(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(str, n) {
  return dateStr(new Date(parseDate(str).getTime() + n * DAY_MS));
}

// b - a 的天数（同一天 = 0）
function daysBetween(a, b) {
  return Math.round((parseDate(b) - parseDate(a)) / DAY_MS);
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function ymd(year, month, day) {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

// 0 = 周一 … 6 = 周日
function dayOfWeekMon(date) {
  return (date.getUTCDay() + 6) % 7;
}

function monthRange(year, month) {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from: ymd(year, month, 1), to: ymd(year, month, lastDay), year, month, lastDay };
}

function addMonths(year, month, delta) {
  const d = new Date(Date.UTC(year, month - 1 + delta, 1));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

// today 所在周（周一开头）再平移 offset 周
function weekRange(today, offset) {
  const monday = addDays(today, -dayOfWeekMon(parseDate(today)) + (offset || 0) * 7);
  return { from: monday, to: addDays(monday, 6) };
}

function formatMonthLabel(year, month) {
  return `${year}年${month}月`;
}

function formatDateCN(str) {
  const p = String(str || '').split('-').map(Number);
  return `${p[1]}月${p[2]}日`;
}

function formatWeekLabel(from, to) {
  const f = String(from).split('-').map(Number);
  const t = String(to).split('-').map(Number);
  if (f[1] === t[1]) return `${f[1]}月${f[2]}日 - ${t[2]}日`;
  return `${f[1]}月${f[2]}日 - ${t[1]}月${t[2]}日`;
}

const WEEKDAY_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
function weekdayCN(str) {
  return WEEKDAY_CN[parseDate(str).getUTCDay()];
}

module.exports = {
  WD_MON,
  getWindowInfoCompat,
  getNavMetrics,
  todayStr,
  parseDate,
  dateStr,
  addDays,
  daysBetween,
  ymd,
  dayOfWeekMon,
  monthRange,
  addMonths,
  weekRange,
  formatMonthLabel,
  formatDateCN,
  formatWeekLabel,
  weekdayCN
};
