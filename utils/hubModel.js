// Pure selection logic shared by the four root pages and regression tests.
const hubIcons = require('./hubIcons');
const LABELS = { movie: '电影', tv: '剧集', anime: '动漫', reading: '读书', travel: '旅行', daily: '每日记录', parenting: '育儿' };
const ROUTES = { douban_movies: 'douban', travel_provinces: 'province', travel_cities: 'city', daily_movie: 'daily:movie', daily_read: 'daily:read', daily_sport: 'daily:sport', daily_water: 'daily:water' };
const normalize = s => String(s || '').toLowerCase().replace(/\s+/g, '');
function routeKey(t) {
  if (ROUTES[t.id]) return ROUTES[t.id];
  const match = (t.url || '').match(/[?&]theme=([^&]+)/);
  return match ? decodeURIComponent(match[1]) : t.id;
}
function isTool(t) { return t.category === 'parenting' || t.category === 'daily' || t.id === 'movie_search_all_platforms' || t.category === 'game'; }
function isList(t) { return !t.hidden && !isTool(t); }
function formatCount(n) {
  if (!Number.isFinite(n) || n < 0) return '';
  const stepped = Math.floor(n / 100) * 100;
  if (stepped >= 1000) {
    const k = stepped / 1000;
    return (k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)) + 'k';
  }
  return stepped + '+';
}
function dateMs(t) { const n = Date.parse(t.publishedAt || ''); return Number.isFinite(n) ? n : 0; }
function decorate(themes, snapshot) {
  return themes.filter(t => !t.hidden).map(t => {
    const stat = snapshot && snapshot.rows && snapshot.rows[t.id];
    const known = !!(stat && stat.valid === true && Number.isFinite(stat.users) && stat.users >= 0);
    const domain = t.category === 'oscar' ? 'movie' : t.category;
    return { ...t, domain, isTool: isTool(t), domainLabel: LABELS[domain] || '工具', countKnown: known, iconKey: hubIcons.keyFor(t),
      // Apply the released page's +100 display rule once; keep stored counts
      // and ranking values unchanged when re-decorating after a refresh.
      userCount: known ? stat.users : null, userCountText: known ? formatCount(stat.users + 100) : '',
      contentCount: known ? stat.total : null };
  });
}
function comparePopular(a, b) {
  return Number(b.countKnown) - Number(a.countKnown) || (b.userCount || 0) - (a.userCount || 0) || dateMs(b) - dateMs(a) || a.id.localeCompare(b.id);
}
function selectHot(themes) {
  // Shared counts (including the legacy timeout estimate) determine popularity.
  return themes.filter(t => isList(t) && t.countKnown && t.contentCount !== 0)
    .sort(comparePopular).slice(0, 10).map((t, index) => ({ ...t, popularityRank: index + 1 }));
}
function selectNew(themes, now = Date.now()) {
  // Historical lists without dates retain catalog order after dated launches.
  // Latest and popular are independent sections, so overlap is allowed.
  return themes.filter(t => isList(t) && dateMs(t) <= now && !(t.countKnown && t.contentCount === 0))
    .map((t, index) => ({ t, index }))
    .sort((a, b) => dateMs(b.t) - dateMs(a.t) || a.index - b.index).slice(0, 4).map(row => row.t);
}
function filter(themes, category, query, sort, keywords) {
  const q = normalize(query);
  const score = t => normalize(t.title) === q ? 3 : normalize(t.title).includes(q) ? 2 : 1;
  return themes.filter(t => !t.hidden && (category === 'tools' ? isTool(t) : category === 'all' ? (!isTool(t) || !!q) : isList(t) && t.domain === category))
    .filter(t => !q || keywords(t).some(v => normalize(v).includes(q)))
    .sort((a, b) => (q ? score(b) - score(a) : 0) || (sort === 'latest' ? dateMs(b) - dateMs(a) : comparePopular(a, b)) || a.id.localeCompare(b.id));
}
function withProgress(t, row) {
  if (!row) return { ...t, progressText: '最近浏览 · 继续探索', progressPercent: 0 };
  const verb = t.domain === 'reading' ? '已读' : t.domain === 'travel' ? '去过' : '已看';
  return { ...t, progressText: `${verb} ${row.done} / ${row.total}${row.wish ? ' · 待完成 ' + row.wish : ''}`,
    progressPercent: row.total ? Math.min(100, Math.round(row.done / row.total * 100)) : 0 };
}
module.exports = { routeKey, isTool, isList, formatCount, dateMs, decorate, comparePopular, selectHot, selectNew, filter, withProgress };
