const { getTheme, ACCENT_HEX } = require('../../../utils/dailyThemes.js');

const WD_MON = ['一', '二', '三', '四', '五', '六', '日'];

// wx.getSystemInfoSync 已废弃：优先用 wx.getWindowInfo（含 statusBarHeight / windowWidth），
// 回退兼容旧基础库。返回对象供 getNavMetrics / 页面取 windowWidth 用。
function getWindowInfoCompat() {
  try { if (wx.getWindowInfo) return wx.getWindowInfo(); } catch (e) { /* ignore */ }
  try { if (wx.getSystemInfoSync) return wx.getSystemInfoSync(); } catch (e) { /* ignore */ }
  return {};
}

function getNavMetrics() {
  const fallback = { statusBarHeight: 20, navBarHeight: 48, navOffset: 68 };
  try {
    const systemInfo = getWindowInfoCompat();
    const statusBarHeight = systemInfo.statusBarHeight || fallback.statusBarHeight;
    let navBarHeight = fallback.navBarHeight;
    if (wx.getMenuButtonBoundingClientRect) {
      const menu = wx.getMenuButtonBoundingClientRect();
      if (menu && menu.top && menu.height) {
        navBarHeight = (menu.top - statusBarHeight) * 2 + menu.height;
      }
    }
    return { statusBarHeight, navBarHeight, navOffset: statusBarHeight + navBarHeight };
  } catch (e) {
    return fallback;
  }
}

function todayStr() {
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString().slice(0, 10);
}

function parseDate(dateStr) {
  const parts = String(dateStr || '').split('-').map(Number);
  return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
}

function dateStr(date) {
  return date.toISOString().slice(0, 10);
}

function monthRange(year, month) {
  const fromDate = new Date(Date.UTC(year, month - 1, 1));
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const toDate = new Date(Date.UTC(year, month - 1, lastDay));
  return {
    from: dateStr(fromDate),
    to: dateStr(toDate),
    fromDate,
    toDate,
    year,
    month,
    lastDay
  };
}

function addMonths(year, month, delta) {
  const d = new Date(Date.UTC(year, month - 1 + delta, 1));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

function dayOfWeekMon(date) {
  return (date.getUTCDay() + 6) % 7;
}

function formatMonthLabel(year, month) {
  return `${year}年${month}月`;
}

function formatDateCN(dateStrValue) {
  const p = String(dateStrValue || '').split('-').map(Number);
  return `${p[1]}月${p[2]}日`;
}

function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(Number(ts));
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

// 数值整洁化：去掉无意义的小数（5.0 → 5，5.50 → 5.5）
function tidyNum(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '';
  return String(Math.round(v * 100) / 100);
}

// 运动摘要文案：有氧=「30分钟 · 5km」；力量=「4组×12次 · 60kg」；移植自旧 fitness history.js formatRecord
function buildSummary(meta) {
  const m = meta || {};
  if (m.category === 'cardio') {
    const parts = [];
    if (Number(m.duration) > 0) parts.push(`${tidyNum(m.duration)}分钟`);
    if (Number(m.distance) > 0) parts.push(`${tidyNum(m.distance)}${m.distanceUnit || 'km'}`);
    return parts.join(' · ');
  }
  // 力量训练
  const parts = [];
  if (Number(m.sets) > 0 && Number(m.reps) > 0) {
    parts.push(`${tidyNum(m.sets)}组×${tidyNum(m.reps)}次`);
  } else if (Number(m.duration) > 0) {
    // 平板支撑等只记时长的力量项
    parts.push(`${tidyNum(m.duration)}分钟`);
  }
  if (Number(m.weight) > 0) parts.push(`${tidyNum(m.weight)}kg`);
  return parts.join(' · ');
}

function normalizeSportEntry(entry, date) {
  const meta = (entry && entry.meta) || {};
  return {
    ts: entry && entry.ts,
    value: entry && entry.value,
    date,
    category: meta.category || '',
    type: meta.type || '运动',
    typeName: meta.type || '运动',
    icon: meta.icon || '🏃',
    duration: Number(meta.duration) || 0,
    distance: Number(meta.distance) || 0,
    distanceUnit: meta.distanceUnit || 'km',
    sets: Number(meta.sets) || 0,
    reps: Number(meta.reps) || 0,
    weight: Number(meta.weight) || 0,
    summaryText: buildSummary(meta),
    note: meta.note || '',
    timeText: formatTime(entry && entry.ts)
  };
}

function flattenSports(days) {
  const list = [];
  (days || []).forEach(day => {
    (day.entries || []).forEach(entry => {
      list.push(normalizeSportEntry(entry, day.date));
    });
  });
  return list;
}

function getSportThemeView() {
  const theme = getTheme('sport');
  const accent = theme.accent || 'yellow';
  return {
    theme,
    accent,
    accentHex: ACCENT_HEX[accent] || ACCENT_HEX.yellow
  };
}

module.exports = {
  WD_MON,
  getWindowInfoCompat,
  getNavMetrics,
  todayStr,
  parseDate,
  dateStr,
  monthRange,
  addMonths,
  dayOfWeekMon,
  formatMonthLabel,
  formatDateCN,
  buildSummary,
  normalizeSportEntry,
  flattenSports,
  getSportThemeView
};
