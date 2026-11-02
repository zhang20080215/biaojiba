// 海报数据模型：把各分享页的数据整理成版式统一吃的 PosterModel。
// 海报上的每个数字都在这里算（设计文档第 4 节），版式文件只管画 —— 口径只有一份。
// 纯函数，不碰 wx；tools/test-poster-model.cjs 直接跑。
//
// 三个硬规则（数据来源）：
//   - 条目的 ts 是「记录时间」不是看片时刻 → 不产出任何「几点看的」字段
//   - 榜单的标记时间 marked_at 是「标记时间」→ 只叫 recent（最近标记），不叫最近看过
//   - 数据不满一年不说「年度」→ 年度 label 写「共 N 个月有记录」

const MONTH_CN = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];
const WEEK_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const WEEK_EN = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const RECENT_MAX = 24;

function pad2(n) { return n < 10 ? '0' + n : String(n); }

/** 'YYYY-MM-DD' → { weekdayCn, weekdayEn, dot:'2026.10.18', md:'10.18' }；非法日期返回空串字段 */
function dateParts(date) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date || ''));
  if (!m) return { weekdayCn: '', weekdayEn: '', dot: '', md: '' };
  const wd = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay();
  return { weekdayCn: WEEK_CN[wd], weekdayEn: WEEK_EN[wd], dot: `${m[1]}.${m[2]}.${m[3]}`, md: `${m[2]}.${m[3]}` };
}

function byDateTs(a, b) {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  return (a.ts || 0) - (b.ts || 0);
}

// 星级 → 一句态度（盖在印章 / 贴纸上）。1 星不写「烂片」：是我的评价，不替片子下定论
const STAR_VERDICT = ['', '踩雷', '一般', '还行', '推荐', '神作'];

/** 印章文案：选了心情用心情（最有个人味），否则按星级，都没有就「看过了」 */
function verdictOf(e) {
  if (e && e.moodLabel) return String(e.moodLabel);
  const r = Math.max(0, Math.min(5, Math.round(Number(e && e.rating) || 0)));
  return STAR_VERDICT[r] || '看过了';
}

/** 记录序号的展示：No.037（三位补零，上千照写） */
function serialOf(n) {
  if (!(n > 0)) return '';
  const s = String(n);
  return 'No.' + (s.length >= 3 ? s : ('00' + s).slice(-3));
}

/**
 * 每日电影 / 读书的一条记录 → 版式用的 film。
 * 入参是 pages/daily/movie/common.js normalizeMovieEntry 的输出（已带 platformRatings）。
 */
function toFilm(e, hideRatings) {
  const p = dateParts(e.date);
  return {
    key: `${e.date}-${e.ts}`,
    title: e.title || '',
    year: e.year ? String(e.year) : '',
    director: e.director || '',
    genres: Array.isArray(e.genres) ? e.genres.slice(0, 3) : [],
    poster: e.poster || '',
    rating: Math.max(0, Math.min(5, Number(e.rating) || 0)),   // 我的星级 0~5，0 = 未评分
    moodEmoji: e.moodEmoji || '',
    moodLabel: e.moodLabel || '',
    note: e.note || '',
    // 「—」是分享页给没取到的平台占的位，海报上不画
    platform: hideRatings ? [] : (e.platformRatings || []).filter(r => r && r.value !== '' && r.value != null && r.value !== '—'),
    date: e.date || '',
    ts: e.ts || 0,
    weekdayCn: p.weekdayCn,
    weekdayEn: p.weekdayEn,
    dateDot: p.dot,
    md: p.md,
    verdict: verdictOf(e)
  };
}

/**
 * 「我记录的第 N 部」：全量记录里排在这条之前（含）的条数，按 (date, ts) 排序。
 * 是「记录」的序号，重看也算一条 —— 文案必须写「记录的第 N 部」。找不到这条返回 null。
 */
function ordinalOf(all, entry) {
  if (!entry) return null;
  const list = (all || []).slice().sort(byDateTs);
  const i = list.findIndex(e => e.date === entry.date && e.ts === entry.ts);
  return i < 0 ? null : i + 1;
}

/** 单部海报 */
function fromDailySingle(entry, opts) {
  const o = opts || {};
  return {
    kind: 'single',
    film: toFilm(entry || {}, !!o.hideRatings),
    ordinal: typeof o.ordinal === 'number' && o.ordinal > 0 ? o.ordinal : null,
    serial: serialOf(o.ordinal)
  };
}

/**
 * 范围海报（月度 / 年度）。
 * list：范围内的记录（未去重，normalizeMovieEntry 输出）；opts.dedupe：页面传入 common.js 的 dedupeMovies，
 * 按「部」去重的口径只有那一份。
 */
function fromDailyRange(list, opts) {
  const o = opts || {};
  const raw = (list || []).slice();
  const deduped = (o.dedupe ? o.dedupe(raw) : raw).slice().sort(byDateTs);
  const films = deduped.map(e => toFilm(e, false));

  // 观影日按原始记录算：同一部片重看的那天也是观影日
  const dayset = {};
  raw.forEach(e => { if (e.date) dayset[e.date] = 1; });
  const monthset = {};
  raw.forEach(e => { if (e.date) monthset[String(e.date).slice(0, 7)] = 1; });

  const rated = films.filter(f => f.rating > 0);
  const avgStars = rated.length ? Math.round(rated.reduce((s, f) => s + f.rating, 0) / rated.length * 10) / 10 : null;

  // 最爱：评分最高，同分取最早（films 已按时间升序，取第一个最高分即可）；全未评分 → 第一部
  let favorite = null, favoriteKind = null;
  if (films.length) {
    if (rated.length) {
      const top = Math.max.apply(null, rated.map(f => f.rating));
      favorite = films.find(f => f.rating === top);
      favoriteKind = 'best';
    } else {
      favorite = films[0];
      favoriteKind = 'first';
    }
  }

  const groups = [];
  films.forEach(f => {
    const last = groups[groups.length - 1];
    if (last && last.date === f.date) last.films.push(f);
    else groups.push({ date: f.date, md: f.md, weekdayCn: f.weekdayCn, films: [f] });
  });

  const isMonth = o.mode === 'month';
  const year = Number(o.year) || 0;
  const month = Number(o.month) || 0;
  const monthsWithData = Object.keys(monthset).length;
  const periodTitle = isMonth ? (MONTH_CN[month - 1] || '') : String(year);
  const periodSub = isMonth ? String(year) : `共 ${monthsWithData} 个月有记录`;
  const defaultTitle = isMonth ? `${periodTitle}观影` : `${year} 观影`;
  const custom = String(o.customTitle || '').trim();

  return {
    kind: 'range',
    mode: isMonth ? 'month' : 'year',
    year,
    month,
    title: custom || defaultTitle,
    periodTitle,
    periodSub,
    films,
    groups,
    favorite,
    favoriteKind,
    stats: { count: films.length, days: Object.keys(dayset).length, avgStars },
    monthsWithData
  };
}

/**
 * 榜单海报。
 * items：榜单条目（带 _id / rank / title / cover），marks：{ statusMap, timeMap }，
 *   statusMap = dataLoader.processMarks 的 markStatusMap，timeMap = markTimeMap（ms，P3 加）。
 */
function fromRanking(items, marks, opts) {
  const o = opts || {};
  const statusMap = (marks && marks.statusMap) || {};
  const timeMap = (marks && marks.timeMap) || {};
  const list = (items || []).map((it, i) => ({ it, i }))
    .sort((a, b) => {
      const ra = Number(a.it.rank), rb = Number(b.it.rank);
      const ha = Number.isFinite(ra), hb = Number.isFinite(rb);
      if (ha && hb && ra !== rb) return ra - rb;
      if (ha !== hb) return ha ? -1 : 1;
      return a.i - b.i;
    })
    .map(x => x.it);

  const toItem = (it, idx) => ({
    key: String(it._id),
    rank: Number.isFinite(Number(it.rank)) ? Number(it.rank) : idx + 1,
    title: it.title || '',
    year: it.year ? String(it.year) : '',
    poster: it.cover || it.coverUrl || it.originalCover || '',
    markTime: Number(timeMap[it._id]) || 0
  });

  const dots = [];
  const watchedByRank = [];
  let wish = 0;
  list.forEach((it, idx) => {
    const st = statusMap[it._id];
    if (st === 'watched') { dots.push('w'); watchedByRank.push(toItem(it, idx)); }
    else if (st === 'wish') { dots.push('h'); wish++; }
    else dots.push('u');
  });

  const total = list.length;
  const watched = watchedByRank.length;
  const recentMax = o.recentMax || RECENT_MAX;
  // 最近标记：标记时间倒序，同一时间按排名；没有标记时间的排最后
  const recent = watchedByRank.slice()
    .sort((a, b) => (b.markTime - a.markTime) || (a.rank - b.rank))
    .slice(0, recentMax);

  return {
    kind: 'ranking',
    title: o.title || '',
    total,
    watched,
    wish,
    unwatched: total - watched - wish,
    pct: total ? Math.round(watched / total * 1000) / 10 : 0,
    dots,
    watchedByRank,
    recent
  };
}

module.exports = { verdictOf, serialOf, MONTH_CN, WEEK_CN, WEEK_EN, RECENT_MAX, dateParts, toFilm, ordinalOf, fromDailySingle, fromDailyRange, fromRanking };
