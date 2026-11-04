// Successful actions only. A page visit + a two-minute idle window defines a continuous session.
const KEY = 'markTimelineOutboxV1:';
const WINDOW = 120000;
let flight = null;
function owner() { try { return getApp().globalData.openid || ''; } catch (e) { return ''; } }
function read(uid) { try { return wx.getStorageSync(KEY + uid) || []; } catch (e) { return []; } }
function write(uid, rows) { wx.setStorageSync(KEY + uid, rows); }
function uid() { return Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 12); }
const clip = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);
// 记录那一刻的条目快照：除标题/封面外，把能让时间轴「细腻」的信息都存成短文本——
// 每日电影/读书带用户自己的星级、短评、心情、看到第几集/读到第几页；榜单条目带平台评分、年份、作者/导演、省市。
// 存成现成的文本而不是原始字段：展示端不用再认识每个主题的数据结构，云函数也只需按长度截断。
function snapshot(item, status, ctx) {
  const snap = { title: clip(item.shortName || item.title || item.name || item.type, 80) || '一次标记',
    cover: item.cover || item.poster || '', status };
  if (ctx.daily) {
    const stars = Math.round(num(item.rating));
    if (stars >= 1 && stars <= 5) snap.stars = stars;
    if (item.note) snap.note = clip(item.note, 140);
    if (item.moodLabel) snap.mood = clip((item.moodEmoji ? item.moodEmoji + ' ' : '') + item.moodLabel, 20);
  }
  const progress = [];
  const epCur = num(item.currentEpisode), epTotal = num(item.totalEpisodes);
  if (epCur && epTotal) progress.push(`看到第 ${epCur} 集 / 共 ${epTotal} 集`);
  else if (epCur) progress.push(`看到第 ${epCur} 集`);
  // 单位随书走：豆瓣书是「页」，晋江网文记的是「章」（meta.progressUnit）
  const pageCur = num(item.currentPage), pageTotal = num(item.totalPages), unit = item.progressUnit || '页';
  if (pageCur && pageTotal) progress.push(`已读 ${pageCur}/${pageTotal} ${unit}（${Math.min(100, Math.round(pageCur / pageTotal * 100))}%）`);
  else if (pageCur) progress.push(`已读 ${pageCur} ${unit}`);
  if (num(item.readDays) > 0) progress.push(`已读 ${num(item.readDays)} 天`);
  if (progress.length) snap.progress = clip(progress.join(' · '), 60);
  const extra = [];
  if (item.extra) extra.push(item.extra);
  const score = ctx.daily ? item.platform && item.platform.douban : item.rating;
  if (num(score) > 0 && num(score) <= 10) extra.push(`${ctx.daily ? '豆瓣' : ctx.ratingLabel} ${score}`);
  if (item.year) extra.push(String(item.year).slice(0, 4));
  if (item.author) extra.push(String(item.author).split(/[、,，/]/)[0].trim());
  else if (item.director) extra.push(String(item.director).split(/[、,，/]/)[0].trim());
  if (item.province) extra.push(item.city && item.city !== item.province ? `${item.province} · ${item.city}` : item.province);
  if (extra.length) snap.extra = clip(extra.filter(Boolean).join(' · '), 80);
  return snap;
}
function record(page, theme, status, items, mode = 'single') {
  const user = owner();
  if (!user || !items.length) return;
  const now = Date.now();
  let group = page._timelineGroup;
  if (mode !== 'single' || !group || group.owner !== user || group.theme !== theme || now - group.at > WINDOW || group.count + items.length > 1000) {
    group = { id: uid(), owner: user, theme, at: now, createdAt: now, revision: 0, count: 0, items: [], mode };
  }
  const data = page.data || {};
  const all = data.allMovies || data.allBooks || data.allSpots || data.allCities || data.allProvinces || [];
  const ctx = { daily: String(theme).indexOf('daily:') === 0, ratingLabel: data.cfg && data.cfg.ratingLabel || '豆瓣' };
  const snapshots = items.map(value => {
    const item = value && typeof value === 'object' ? value : all.find(r => String(r._id || r.id) === String(value)) || { title: String(value) };
    return snapshot(item, status, ctx);
  });
  group = { ...group, at: now, revision: group.revision + 1, count: group.count + items.length,
    title: data.cfg && data.cfg.title || '', items: group.items.concat(snapshots) };
  page._timelineGroup = mode === 'single' ? group : null;
  try {
    write(user, read(user).filter(r => r.id !== group.id).concat(group));
    require('./hubStore').invalidateSummary();
    flush();
  } catch (e) { console.warn('[timeline] local persistence failed', e); }
}
async function flush() {
  if (flight) return flight;
  const user = owner();
  if (!user) return;
  flight = (async () => {
    // Drain newer revisions added while an earlier request was in flight, too.
    while (read(user).length) {
      const row = read(user)[0];
      if (owner() !== user) break;
      try {
        const res = await wx.cloud.callFunction({ name: 'markTimeline', data: { action: 'save', row } });
        if (!res.result || !res.result.success) break;
        write(user, read(user).filter(r => r.id !== row.id || r.revision !== row.revision));
      } catch (e) { break; } // Keep the durable outbox for the next visit/retry.
    }
  })().finally(() => { flight = null; });
  return flight;
}
async function list(before) {
  await flush();
  const user = owner();
  const pending = read(user);
  try {
    const res = await wx.cloud.callFunction({ name: 'markTimeline', data: { action: 'list', before: before || null } });
    if (owner() !== user) return { rows: [], offline: true };
    if (!res.result || !res.result.success) throw new Error('timeline unavailable');
    const rows = new Map((res.result.rows || []).map(r => [r.id, r]));
    if (!before) pending.forEach(r => { if (!rows.has(r.id) || rows.get(r.id).revision < r.revision) rows.set(r.id, r); });
    return { ...res.result, rows: Array.from(rows.values()).sort((a, b) => b.at - a.at), pending: pending.length };
  } catch (e) {
    return { rows: before ? [] : pending.slice().sort((a, b) => b.at - a.at), offline: true, pending: pending.length };
  }
}
// 每个主题自己的说法。榜单标记统一一个骨架：一个就直接写「看过《A》」「想看《A》」，
// 多个 / 批量写「标记了 12 部看过的电影」。doneAdj = 看过 / 读过 / 去过 / 参观过，wish = 想看 / 想读 / 想去。
// 标记只是点了「看过」，不等于「看完了」，所以不再用「看了 / 看完了 / 读完了 / 打卡了」这类动词。
const TRAVEL_VOCAB = {
  scenic_5a: { unit: '个', noun: '景区' }, museum_grade1: { unit: '座', noun: '博物馆', doneAdj: '参观过' },
  travel_provinces: { unit: '个', noun: '省份' }, travel_cities: { unit: '座', noun: '城市' }
};
function vocabFor(rowTheme, t) {
  if (rowTheme === 'daily:movie') return { kind: 'dailyMovie', unit: '部', noun: '电影', doneAdj: '看过', wish: '想看', quote: true };
  if (rowTheme === 'daily:read') return { kind: 'dailyRead', unit: '本', noun: '书', doneAdj: '读过', wish: '想读', quote: true };
  if (rowTheme === 'daily:sport') return { kind: 'sport' };
  if (rowTheme === 'daily:water') return { kind: 'water' };
  // 自建书单不在主题目录里，按 theme id 认
  const domain = rowTheme === 'customBook' ? 'reading' : t && t.domain;
  if (domain === 'travel') return { unit: '个', noun: '地方', doneAdj: '去过', wish: '想去', quote: false, ...(TRAVEL_VOCAB[t.id] || {}) };
  if (domain === 'reading') return { unit: '本', noun: '书', doneAdj: '读过', wish: '想读', quote: true };
  if (domain === 'tv') return { unit: '部', noun: '剧', doneAdj: '看过', wish: '想看', quote: true };
  if (domain === 'anime') return { unit: '部', noun: '动画', doneAdj: '看过', wish: '想看', quote: true };
  return { unit: '部', noun: '电影', doneAdj: '看过', wish: '想看', quote: true };
}
const isUnmark = s => ['unmark', 'unwatched', 'unread'].includes(s);
// 每日电影/读书里记了进度、还没看完/读完的：进行中写「在看 / 在读」，已完成写「看过 / 读过」
const watching = (v, item) => {
  const m = v.kind === 'dailyMovie' && /看到第 (\d+) 集(?: \/ 共 (\d+) 集)?/.exec(item.progress || '');
  return !!m && !(m[2] && Number(m[1]) >= Number(m[2]));   // 看到最后一集就是看完了，不算「在看」
};
const reading = (v, item) => v.kind === 'dailyRead' && /[页章]/.test(item.progress || '') && !/（100%）/.test(item.progress);
function statusText(v, s, item = {}) {
  if (isUnmark(s)) return '取消标记';
  if (watching(v, item)) return '在看';
  if (reading(v, item)) return '在读';
  if (v.kind === 'sport' || v.kind === 'water') return '已打卡';
  if (s === 'wish') return v.wish;
  return v.doneAdj;
}
function summarize(v, items) {
  const name = item => (v.quote ? `《${item.title}》` : item.title);
  if (v.kind === 'sport') return items.length === 1 ? `练了${items[0].title}` : `完成了 ${items.length} 项训练`;
  if (v.kind === 'water') return items.length === 1 ? `喝了 ${items[0].title} 水` : `喝了 ${items.length} 次水`;
  // 每日电影 / 读书：进行中写「在看 / 在读」，已完成（含看到最后一集、读到 100%）和没记进度的都写「看过 / 读过」
  if (items.length === 1 && watching(v, items[0])) return `在看${name(items[0])}`;
  if (items.length === 1 && reading(v, items[0])) return `在读${name(items[0])}`;
  const groups = { done: [], wish: [], unmark: [] };
  items.forEach(item => groups[isUnmark(item.status) ? 'unmark' : item.status === 'wish' ? 'wish' : 'done'].push(item));
  const { done, wish, unmark } = groups;
  // 一个：直接写状态 + 名字（看过《A》）；多个 / 批量：标记了 12 部看过的电影。连着两段数量句时后一段省掉「标记了」
  const parts = [];
  const mark = (list, adj) => {
    if (list.length === 1) parts.push({ text: `${adj}${name(list[0])}` });
    else if (list.length) parts.push({ count: true, text: `${list.length} ${v.unit}${adj}的${v.noun}` });
  };
  mark(done, v.doneAdj);
  mark(wish, v.wish);
  if (unmark.length === 1) parts.push({ text: `取消了${name(unmark[0])}的标记` });
  else if (unmark.length) parts.push({ text: `取消了 ${unmark.length} ${v.unit}${v.noun}的标记` });
  return parts.map((p, i) => (p.count && !(i > 0 && parts[i - 1].count) ? `标记了 ${p.text}` : p.text)).join('，') || '留下了一次标记';
}
// 老记录里存的进度文案是「读到第 320 / 1606 页（20%）」「读到第 12 页」，新记录统一成「已读 320/1606 页（20%）」。
// 进度是记录那一刻存下的文本，历史行不重写，展示时转成新说法（只认这两种老格式，其余原样）。
function legacyProgress(text) {
  return String(text || '')
    .replace(/读到第 (\d+) \/ (\d+) ([页章])/g, '已读 $1/$2 $3')
    .replace(/读到第 (\d+) ([页章])/g, '已读 $1 $2');
}
function present(rows, themes, now = Date.now()) {
  const model = require('./hubModel');
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  let lastDay = '';
  return rows.map(row => {
    const t = themes.find(t => model.routeKey(t) === row.theme || t.id === row.theme);
    const date = new Date(row.at);
    const day = `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
    const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    const elapsed = Math.max(0, now - row.at);
    const timeLabel = elapsed < 60000 ? '刚刚'
      : elapsed < 3600000 ? `${Math.floor(elapsed / 60000)}分钟前`
      : row.at >= today.getTime() ? `${Math.floor(elapsed / 3600000)}小时前`
      : row.at >= yesterday.getTime() ? `昨天 ${time}`
      : `${date.getFullYear() === today.getFullYear() ? '' : date.getFullYear() + '年'}${date.getMonth() + 1}月${date.getDate()}日 ${time}`;
    const v = vocabFor(row.theme, t);
    const all = row.items || [];
    const single = all.length === 1 ? all[0] : null;
    const result = { ...row, day, showDay: day !== lastDay, time, timeLabel,
      themeId: t && t.id || '', themeIcon: t && t.placeholderEmoji || '✦', themeTitle: t && t.title || row.title || '每日标记',
      summary: summarize(v, all),
      // 只有一条时把星级/心情/短评/进度/评分摊开展示；多条时只在小图上标状态
      detail: single && (single.stars || single.mood || single.note || single.progress || single.extra) ? {
        starsText: single.stars ? '★'.repeat(single.stars) + '☆'.repeat(5 - single.stars) : '',
        mood: single.mood || '', note: single.note || '', progress: legacyProgress(single.progress), extra: single.extra || '' } : null,
      items: all.slice(0, row.expanded ? undefined : 9).map((item, index) => ({ ...item, key: index, statusText: statusText(v, item.status, item) })) };
    lastDay = day;
    return result;
  });
}
module.exports = { record, flush, list, present };
