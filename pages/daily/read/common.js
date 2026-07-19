const { getTheme, ACCENT_HEX } = require('../../../utils/dailyThemes.js');
const imageCache = require('../../../utils/imageCacheManager.js');

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

function ratingText(rating) {
  const n = Number(rating);
  if (!Number.isFinite(n) || n <= 0) return '未评分';
  return `${n.toFixed(1)} 星`;
}

// 阅读进度环（SVG data URI，供 <image> 用）。压在书封上，自带深色底盘保证任意封面上可读。
// pct: 0~100。opts.text=false 时不画中间数字（格子小时用）。沿用 dailyBottle/sportIcons 的 data-URI 约定。
const RING_ACCENT = ACCENT_HEX.yellow || '#F5C518';
function progressRingUri(pct, opts) {
  const o = opts || {};
  const p = Math.max(0, Math.min(100, Math.round(Number(pct) || 0)));
  const R = 15, C = 2 * Math.PI * R;         // viewBox 40，半径 15，周长
  const dash = (p / 100 * C).toFixed(2);
  const showText = o.text !== false;
  const label = showText
    ? `<text x="20" y="20" text-anchor="middle" dominant-baseline="central" ` +
      `font-family="sans-serif" font-size="13" font-weight="700" fill="#fff">${p}</text>`
    : '';
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40">` +
    `<circle cx="20" cy="20" r="19" fill="rgba(0,0,0,0.5)"/>` +
    `<circle cx="20" cy="20" r="${R}" fill="none" stroke="rgba(255,255,255,0.28)" stroke-width="4"/>` +
    `<circle cx="20" cy="20" r="${R}" fill="none" stroke="${RING_ACCENT}" stroke-width="4" ` +
    `stroke-linecap="round" stroke-dasharray="${dash} ${(C - dash).toFixed(2)}" ` +
    `transform="rotate(-90 20 20)"/>` +
    label +
    `</svg>`;
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

// 从 meta 归一化阅读进度，返回 { totalPages, currentPage, progressPct, progressLabel }
// progressLabel：有分母→「已读 120/362 页」，只有当前页→「已读 120 页」，都没有→''
function buildProgress(meta) {
  const totalPages = Number(meta && meta.totalPages) || 0;
  const currentPage = Number(meta && meta.currentPage) || 0;
  const hasPct = totalPages > 0 && currentPage > 0;
  let progressLabel = '';
  if (currentPage > 0) {
    progressLabel = totalPages > 0
      ? `已读 ${currentPage}/${totalPages} 页`
      : `已读 ${currentPage} 页`;
  }
  return {
    totalPages,
    currentPage,
    progressPct: hasPct ? Math.min(100, Math.round(currentPage / totalPages * 100)) : 0,
    progressLabel
  };
}

function normalizeBookEntry(entry, date) {
  const meta = (entry && entry.meta) || {};
  // 封面：兼容 cover / poster / posterUrl 多种历史字段
  const poster = meta.cover || meta.poster || meta.posterUrl || '';
  // 评分快照（添加时写入 meta.platform，书只有豆瓣一项）
  const platform = meta.platform || {};
  const platformRatings = [];
  if (platform.douban) platformRatings.push({ label: '豆瓣', value: platform.douban });
  return {
    ts: entry && entry.ts,
    value: entry && entry.value,
    date,
    doubanId: meta.doubanId || '',
    title: meta.title || '未命名书籍',
    year: meta.year || '',
    poster,
    posterThumb: imageCache.getThumbnailUrl(poster, 'list'),
    author: meta.author || '',
    publisher: meta.publisher || '',
    // 阅读进度：totalPages 0=未知（豆瓣没给）、currentPage 0=未填；两者都有才算得出百分比
    ...buildProgress(meta),
    rating: Number(meta.rating) || 0,
    ratingText: ratingText(meta.rating),
    mood: meta.mood || '',
    moodEmoji: meta.moodEmoji || '',
    moodLabel: meta.moodLabel || '',
    platformRatings,
    note: meta.note || '',
    timeText: formatTime(entry && entry.ts)
  };
}

function flattenBooks(days) {
  const list = [];
  (days || []).forEach(day => {
    (day.entries || []).forEach(entry => {
      list.push(normalizeBookEntry(entry, day.date));
    });
  });
  return list;
}

function getReadThemeView() {
  const theme = getTheme('read');
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
  ratingText,
  progressRingUri,
  normalizeBookEntry,
  flattenBooks,
  getReadThemeView
};
