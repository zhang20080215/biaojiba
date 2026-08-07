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
  // navRightInset：右侧控件需避开右上角胶囊的安全内边距（px）
  const fallback = { statusBarHeight: 20, navBarHeight: 48, navOffset: 68, navRightInset: 96 };
  try {
    const systemInfo = getWindowInfoCompat();
    const statusBarHeight = systemInfo.statusBarHeight || fallback.statusBarHeight;
    const screenW = systemInfo.windowWidth || systemInfo.screenWidth || 375;
    let navBarHeight = fallback.navBarHeight;
    let navRightInset = fallback.navRightInset;
    if (wx.getMenuButtonBoundingClientRect) {
      const menu = wx.getMenuButtonBoundingClientRect();
      if (menu && menu.top && menu.height) {
        navBarHeight = (menu.top - statusBarHeight) * 2 + menu.height;
      }
      if (menu && menu.left) {
        // 右内边距 = 屏宽 - 胶囊左缘 + 8px 间隙，让右侧按钮落在胶囊左边
        navRightInset = Math.round(screenW - menu.left + 8);
      }
    }
    return { statusBarHeight, navBarHeight, navOffset: statusBarHeight + navBarHeight, navRightInset };
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

// 集数进度环（SVG data URI，供 <image> 用）。压在海报上，自带深色底盘保证任意封面上可读。
// pct: 0~100。opts.text=false 时不画中间数字（格子小时用）。镜像每日读书的 progressRingUri。
const RING_ACCENT = ACCENT_HEX[getTheme('movie').accent] || ACCENT_HEX.yellow || '#F5C518';
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

// 从 meta 归一化剧集观看进度，返回 { totalEpisodes, currentEpisode, epProgressPct, epProgressLabel }
// 仅电视剧有意义（meta.subtype==='tv'）。epProgressLabel：有分母→「看到 8/12 集」，只有当前集→「看到 8 集」，都没有→''
// 镜像每日读书 buildProgress（totalPages/currentPage）
function buildEpisodeProgress(meta) {
  const totalEpisodes = Number(meta && meta.totalEpisodes) || 0;
  const currentEpisode = Number(meta && meta.currentEpisode) || 0;
  const hasPct = totalEpisodes > 0 && currentEpisode > 0;
  let epProgressLabel = '';
  if (currentEpisode > 0) {
    epProgressLabel = totalEpisodes > 0
      ? `看到 ${currentEpisode}/${totalEpisodes} 集`
      : `看到 ${currentEpisode} 集`;
  }
  return {
    totalEpisodes,
    currentEpisode,
    epProgressPct: hasPct ? Math.min(100, Math.round(currentEpisode / totalEpisodes * 100)) : 0,
    epProgressLabel
  };
}

function normalizeMovieEntry(entry, date) {
  const meta = (entry && entry.meta) || {};
  const poster = meta.poster || meta.posterUrl || '';
  // 全平台评分快照（添加时写入 meta.platform，老记录无此字段则为空）
  const platform = meta.platform || {};
  const platformRatings = [];
  if (platform.douban) platformRatings.push({ label: '豆瓣', value: platform.douban });
  if (platform.imdb) platformRatings.push({ label: 'IMDb', value: platform.imdb });
  if (platform.rtCritic) platformRatings.push({ label: '新鲜度', value: platform.rtCritic });
  if (platform.rtAudience) platformRatings.push({ label: '爆米花', value: platform.rtAudience });
  return {
    ts: entry && entry.ts,
    value: entry && entry.value,
    date,
    doubanId: meta.doubanId || '',
    title: meta.title || '未命名电影',
    year: meta.year || '',
    poster,
    posterThumb: imageCache.getThumbnailUrl(poster, 'list'),
    director: meta.director || '',
    genres: Array.isArray(meta.genres) ? meta.genres : [],
    rating: Number(meta.rating) || 0,
    ratingText: ratingText(meta.rating),
    mood: meta.mood || '',
    moodEmoji: meta.moodEmoji || '',
    moodLabel: meta.moodLabel || '',
    platformRatings,
    // 剧集观看进度：仅电视剧写入 totalEpisodes/currentEpisode，非剧集时字段为 0、label 为空
    ...buildEpisodeProgress(meta),
    note: meta.note || '',
    timeText: formatTime(entry && entry.ts)
  };
}

function flattenMovies(days) {
  const list = [];
  (days || []).forEach(day => {
    (day.entries || []).forEach(entry => {
      list.push(normalizeMovieEntry(entry, day.date));
    });
  });
  return list;
}

// 同一部电影（doubanId）只保留一条：取最近一次观看（ts 最大）。
// 电影墙/统计按「部」去重用——一部剧多天多次记录只算/只展示一次。无 doubanId 的老记录按 ts 各自独立。
function dedupeMovies(list) {
  const byId = {};
  (list || []).forEach(m => {
    const key = m.doubanId || ('_ts_' + (m.ts || 0));
    const prev = byId[key];
    if (!prev || (m.ts || 0) > (prev.ts || 0)) byId[key] = m;
  });
  return Object.keys(byId).map(k => byId[k]);
}

function getMovieThemeView() {
  const theme = getTheme('movie');
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
  buildEpisodeProgress,
  normalizeMovieEntry,
  flattenMovies,
  dedupeMovies,
  getMovieThemeView
};
