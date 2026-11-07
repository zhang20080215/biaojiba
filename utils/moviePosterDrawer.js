/**
 * 每日电影 · 观影记录分享海报绘制器
 *
 * 2026-11 按小票定下的方向重做（「经典」版式）：配色、渐变底、放映机光柱、标题都和小票 / 票夹共用 poster/layouts/rangeTheme.js；
 * 去掉三格统计（观影日 / 平均分）和署名胶囊，字只留片名、日期、星级；3:4 的整体版式列数按「封面最大、尽量排满」算。
 * 每日读书没有放映机（词表 cinema: false），其余完全一样。
 *
 * 用法：
 *   const { width, height } = MoviePosterDrawer.computeSize(movies.length);        // layout 'whole'
 *   const { width, height } = MoviePosterDrawer.computeLayoutSize(layout, movies); // month/rating/calendar 长图（高随内容）
 *   canvas.width = width; canvas.height = height;
 *   new MoviePosterDrawer(canvas, ctx, width, height).draw(data, coverNodes, themeId, layout);
 *
 * 词表（vocab）：版式/几何与「电影」无关，只有文案（部/观影/观影日/占位 🎬…）和单部封面海报的品牌 tint 是电影专属，
 *   全部收在 MOVIE_VOCAB 里；`MoviePosterDrawer.withVocab({...})` 返回一个换了词表的子类，每日读书的
 *   utils/bookPosterDrawer.js 就是这样一行包出来的（部→本、观影→阅读、🎬→📖），不复制版式代码。
 *   条目的「署名行 + 标签」也走通用字段：byline（电影 = 「导演 xxx」，书 = 「作者 xxx」）、tags（电影 = 类型，书 = 阅读进度）。
 *
 * layout（仅多部生效）：whole 整体一张（2~3 部纵向 / 4+ 网格）| month 按月份分区 | rating 按星级分区 | calendar 单月日历（需同月，见 isSingleMonth）
 * data.customTitle：自定义标题（≤20 字）；空则各版式用默认标题
 * data.periodLead：数据范围前缀（「2026年度」/「2026年6月」），长图标题 = 前缀 + 观影总结；空则按电影日期推
 * data.fontsReady：数字字体加载好了（走 Inter），没好用系统字
 * movies 为空时画空态（背景 + 0 部统计 + 提示文字）
 *
 * data = {
 *   movies: [{
 *     key, date:'2026-07-13', title, year, dateLabel:'7月13日', watchDateText:'2026年7月13日观影',
 *     byline:'导演 xxx', tags:['剧情','科幻'],        // 仅单部封面海报用
 *     rating(0~5), moodEmoji, moodLabel, note,
 *     platformRatings:[{label,value}]
 *   }]
 * }
 * coverNodes = { [key]: ImageNode|null }   // 预加载好的封面（canvas.createImage），失败为 null → 占位
 */

const kit = require('./poster/kit.js');
const text = require('./poster/text.js');
const { HEAD_H, BEAM_BOTTOM, PROJECTOR_MID, PALETTE, PALETTE_LIST, DEFAULT_PALETTE, grain, fillPage, drawBeam, drawHeader, drawTitleBlock, lensOf } = require('./poster/layouts/rangeTheme.js');

// ============ 主题：和小票、票夹同一套配色（rangeTheme.js） ============
function toTheme(P) {
  return {
    id: P.id, name: P.name, P, isDark: P.deep,
    ink: P.ink, inkSoft: P.soft, inkFaint: P.faint, accent: P.accent,
    star: P.accent, starEmpty: P.faint,
    chipBg: P.deep ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.62)', chipInk: P.ink,
    ph1: P.deep ? 'rgba(255,255,255,0.14)' : '#F2F0EA', ph2: P.deep ? 'rgba(255,255,255,0.08)' : '#E4E0D5',
    borderRgb: '255,255,255', decoRgb: '255,255,255'
  };
}
const THEMES = {};
Object.keys(PALETTE).forEach(id => { THEMES[id] = toTheme(PALETTE[id]); });

const DEFAULT_THEME = DEFAULT_PALETTE;

// ============ 词表：绘制器里所有「电影」专属的文案与品牌色。换一套词表 = 换一个每日主题的海报 ============
const MOVIE_VOCAB = {
  cinema: true,                            // 抬头画放映机和光柱
  unit: '部',                              // 统计单位：N 部 / 共 N 部
  verb: '观影',                            // 默认标题的强调词：「2026年度」+ 观影 + 总结
  dayLabel: '观影日',                      // 三格统计第三格
  untitled: '未命名电影',
  emoji: '🎬',                             // 无封面占位
  emptyText: '这段时间还没有观影记录',
  // 单部封面海报：压在海报上的品牌色斜向 tint（对齐 category 卡片 brand 色）
  tint: ['rgba(208,132,104,0.30)', 'rgba(168,94,68,0.30)'],
  // 单部封面海报底部的白字署名：圆点 / 文字（微微偏暖，呼应 tint）
  heroSign: { dot: 'rgba(240,196,176,0.72)', text: 'rgba(255,246,242,0.62)' }
};
// swatch 给前端色点用：直接是 CSS 渐变串
const THEME_LIST = PALETTE_LIST;

// ============ 画布尺寸：整体版式固定 1242×1660（≥ 97 部加宽到 1560×2080），长图宽 1560、高随内容 ============
const POSTER_W = 1242;
const POSTER_H = 1660;
const POSTER_W_XL = 1560;  // 整体版式 >= WIDE_FROM 部时加宽（仍 3:4 → 1560×2080），14 列封面墙
const WIDE_FROM = 97;
const MAX_MOVIES = 300;    // 绘制上限；分享页超出时按日期取前 300 部、统计仍按全量、页脚注明

const HEAD_TOP = 72;       // 抬头上沿（设计稿 1080 宽的坐标，画的时候整体放大 s 倍）
const FOOT_H = 92;         // 底部署名带
const RICH_FROM = 150;     // 格宽（设计稿坐标）够这么多才写「片名 + 日期 + 星级」
const TITLE_FROM = 76;     // 够这么多才写片名，再窄就是纯封面墙

// ============ 布局：三种模式（画布始终 3:4）============
//   n === 1        cover —— 海报满幅做背景 + 蒙版 + 悬浮文字（同「全网评分查询」详情）
//   n === 2 / 3    rows  —— 纵向排列：海报在左、文案在右
//   n >= 4         grid  —— 试每种列数，取封面最大的；差不多大时选最后一行空位少的（排满最整齐）
function tileTitleSize(w, s) { return Math.round(clamp(w * 0.115, 15 * s, 26 * s)); }
function tileMetaSize(w, s) { return Math.round(clamp(w * 0.09, 13 * s, 20 * s)); }

// 格宽决定一格写什么；票高随宽度不是连续的，所以 gridGeometry 从大往小一格格试
function tileOf(w, s) {
  const tier = w >= RICH_FROM * s ? 'rich' : w >= TITLE_FROM * s ? 'titled' : 'bare';
  const titleH = Math.round(12 * s) + tileTitleSize(w, s);
  const textH = tier === 'rich' ? titleH + Math.round(14 * s) + tileMetaSize(w, s) + Math.round(6 * s)
    : tier === 'titled' ? titleH + Math.round(6 * s) : 0;
  return { tier, textH, posterH: Math.round(w * 1.42), colGap: Math.round(Math.max(10 * s, w * 0.12)), rowGap: Math.round(Math.max(12 * s, w * 0.14)) };
}

function gridGeometry(n, s, areaW, areaH) {
  let best = null;
  for (let cols = 1; cols <= Math.min(n, 14); cols++) {
    const rows = Math.ceil(n / cols);
    const fits = v => {
      const t = tileOf(v, s);
      return cols * v + (cols - 1) * t.colGap <= areaW && rows * (t.posterH + t.textH) + (rows - 1) * t.rowGap <= areaH;
    };
    let w = Math.round(areaW);
    while (w > 40 && !fits(w)) w--;
    const empty = cols * rows - n;
    const close = best && Math.abs(w - best.cellW) <= 6 * s;
    if (!best || w > best.cellW + 6 * s || (close && empty <= best.empty)) best = { cols, rows, cellW: w, empty };
  }
  const t = tileOf(best.cellW, s);
  return Object.assign(best, t, {
    COLGAP: t.colGap, ROWGAP: t.rowGap,
    gridW: best.cols * best.cellW + (best.cols - 1) * t.colGap,
    gridH: best.rows * (t.posterH + t.textH) + (best.rows - 1) * t.rowGap
  });
}

function modeFor(n) {
  if (n <= 1) return 'cover';
  if (n <= 3) return 'rows';
  return 'grid';
}

function computeLayout(count) {
  const n = Math.max(1, count | 0);
  const mode = modeFor(n);
  const W = n >= WIDE_FROM ? POSTER_W_XL : POSTER_W;
  const H = W === POSTER_W ? POSTER_H : Math.round(W * 4 / 3);
  const s = W / 1080;
  const M = 0;                            // 满幅：无外边框
  const PAD = Math.round(72 * s);

  if (mode === 'cover') {
    return { mode, W, H, M, PAD, s, cols: 1, rows: 1, n };
  }

  const HEADER = Math.round((HEAD_TOP + HEAD_H) * s);
  const FOOTER = Math.round(FOOT_H * s);
  const innerW = W - 2 * PAD;
  const areaTop = HEADER + Math.round(16 * s);
  const areaBottom = H - FOOTER;
  const availH = areaBottom - areaTop;

  if (mode === 'rows') {
    return { mode, W, H, M, PAD, s, HEADER, FOOTER, innerW, areaTop, areaBottom, availH, cols: 1, rows: n, n, headX: PAD };
  }

  const g = gridGeometry(n, s, innerW, availH);
  // 抬头的左缘跟网格对齐；格子很少、网格比抬头窄太多时网格居中，抬头用固定边距
  const left = Math.round((W - g.gridW) / 2);
  const headX = left <= 200 * s ? left : Math.round(96 * s);
  return Object.assign({ mode, W, H, M, PAD, s, HEADER, FOOTER, innerW, areaTop, areaBottom, availH, n, headX }, g);
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function tidy(v) { const x = Number(v); return Number.isFinite(x) ? String(Math.round(x * 10) / 10) : ''; }

// ============ 分区版式（按月份 / 按评分）：年度观影总结长图 ============
//   画布宽固定 1560，高随内容伸展（下限 3:4，上限 4.3 倍宽——超出先加列（最多 12）、再整体缩小）。
//   每段：左侧标签栏（月份：两位月号/中文月/部数；评分：星级数/星星/力荐/部数），右侧封面网格（封面 + 单行片名）。
//   参考小红书「年度阅读总结」长图的排版。
const MONTH_CN = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];
const RATING_LABEL = { 5: '力荐', 4: '推荐', 3: '还行', 2: '较差', 1: '很差', 0: '未评分' };
function headerH(s) { return Math.round((HEAD_TOP + HEAD_H + 16) * s); }
const SECTION_W = POSTER_W_XL;   // 长图（按月份 / 按评分 / 日历）宽 1560：10 列封面 105px 带片名
const SECTION_PAD = 70;          // 长图左右留白（固定像素，不随 s 放大，把宽度留给封面）
const SECTION_LABEL_W = 190;     // 左侧月份 / 星级标签栏

function ymOf(m) {
  const p = String(m.date || '').split('-');
  return { ym: p.length >= 2 ? `${p[0]}-${p[1]}` : '', year: Number(p[0]) || 0, month: Number(p[1]) || 0 };
}

// 按 'YYYY-MM' 分组（保持传入顺序：分享页已按日期升序）
function groupByMonth(movies) {
  const map = {};
  const order = [];
  movies.forEach(m => {
    const { ym, year, month } = ymOf(m);
    const k = ym || 'unknown';
    if (!map[k]) {
      map[k] = { kind: 'month', year, month, movies: [] };
      order.push(k);
    }
    map[k].movies.push(m);
  });
  return order.map(k => map[k]);
}

// 按星级分组：5★→1★（四舍五入到整星，如 4.5 归 5），没有的星级不出现；未评分的放末尾
function groupByRating(movies) {
  const buckets = { 5: [], 4: [], 3: [], 2: [], 1: [], 0: [] };
  movies.forEach(m => {
    const r = Number(m.rating) || 0;
    const level = r > 0 ? clamp(Math.round(r), 1, 5) : 0;
    buckets[level].push(m);
  });
  return [5, 4, 3, 2, 1, 0]
    .filter(l => buckets[l].length)
    .map(l => ({ kind: 'rating', level: l, movies: buckets[l] }));
}

// 分区网格片名字号：随格宽走，18~26px；格宽不足 SECTION_TITLE_MIN 时不画片名（纯封面）
const SECTION_TITLE_MIN = 80;
function sectionTitleSize(cellW) { return Math.round(clamp(cellW * 0.22, 18, 26)); }

function computeSectionLayout(groups, n) {
  const W = SECTION_W;
  const s = W / 1080;
  const PAD = SECTION_PAD;
  const labelW = SECTION_LABEL_W;
  const HEADER = headerH(s);
  const FOOTER = Math.round(FOOT_H * s);
  const minH = Math.round(W * 4 / 3);
  const softH = Math.round(W * 3);      // 4680：超过就先加列（稀疏的 12 段长图别被大封面撑得老长）
  const maxH = Math.round(W * 4.3);     // 6708：硬上限，12 个月 × 20 部（10 列两行、封面 105px 带片名）刚好放下；面积 1046 万像素 < iOS 1677 万上限
  const gridW = W - 2 * PAD - labelW;

  // 起步列数随总数走（少的时候格子大），最多加到 12 列；12 列 × 12 月 × 2 行 = 288 部带片名
  const baseCols = n <= 6 ? 3 : n <= 12 ? 4 : n <= 24 ? 5 : n <= 60 ? 6 : n <= 120 ? 8 : 10;
  const build = (cols, k) => {
    const gap = Math.round(20 * k);
    const cellW = Math.floor((gridW - (cols - 1) * gap) / cols * k);   // k<1：缩格，网格靠左不铺满
    const coverH = Math.round(cellW * 1.44);
    const titled = cellW >= SECTION_TITLE_MIN;
    const titleH = titled ? 14 + sectionTitleSize(cellW) + 12 : 0;
    const rowGap = Math.round(20 * k);
    const secPad = Math.round(40 * k);
    let y = HEADER;
    const secs = groups.map(g => {
      const rows = Math.ceil(g.movies.length / cols);
      const h = secPad * 2 + rows * (coverH + titleH) + (rows - 1) * rowGap;
      const sec = Object.assign({}, g, { rows, top: y, h });
      y += h;
      return sec;
    });
    const contentH = y + FOOTER;
    return { W, s, PAD, headX: PAD, labelW, HEADER, FOOTER, cols, gap, cellW, coverH, titled, titleH, rowGap, secPad, secs, contentH, k };
  };

  // 内容过高：先加列（最多 12 列，目标 softH），仍超硬上限则整体缩小格子
  let L = build(baseCols, 1);
  for (let cols = baseCols + 1; L.contentH > softH && cols <= 12; cols++) {
    const next = build(cols, 1);
    // 已经在硬上限内、再加列会把封面挤到 100px 以下：停，别为了「更短」牺牲可读性
    if (L.contentH <= maxH && next.cellW < 100) break;
    L = next;
  }
  for (let i = 0; i < 3 && L.contentH > maxH; i++) {
    // 分区高度各项都随 k 线性缩放，缩一两次即可逼近上限（片名去留会跳变，故迭代）
    L = build(L.cols, L.k * (maxH - HEADER - FOOTER) / (L.contentH - HEADER - FOOTER));
  }
  L.H = Math.max(minH, L.contentH);
  L.n = n;
  return L;
}

function computeMonthLayout(movies) {
  const list = (movies || []).slice(0, MAX_MOVIES);
  const L = computeSectionLayout(groupByMonth(list), Math.max(1, list.length));
  L.mode = 'month';
  return L;
}

function computeRatingLayout(movies) {
  const list = (movies || []).slice(0, MAX_MOVIES);
  const L = computeSectionLayout(groupByRating(list), Math.max(1, list.length));
  L.mode = 'rating';
  return L;
}

// ============ 「日历」版式：单月日历，有观影的日子铺封面 ============
//   前提：所选电影都在同一个月（分享页负责校验，这里取第一部的年月）。周一起始，与全站一致。
function calendarMonthOf(movies) {
  const first = (movies || []).find(m => ymOf(m).ym) || {};
  return ymOf(first);
}

// 所选电影是否落在同一个月（分享页用它决定「日历」版式可不可选）
function isSingleMonth(movies) {
  const list = (movies || []).filter(m => ymOf(m).ym);
  if (!list.length) return false;
  const k = ymOf(list[0]).ym;
  return list.every(m => ymOf(m).ym === k);
}

function computeCalendarLayout(movies) {
  const list = (movies || []).slice(0, MAX_MOVIES);
  const W = SECTION_W;
  const s = W / 1080;
  const PAD = SECTION_PAD;
  const HEADER = headerH(s);
  const FOOTER = Math.round(FOOT_H * s);
  const minH = Math.round(W * 4 / 3);
  const { year, month } = calendarMonthOf(list);
  const days = year && month ? new Date(year, month, 0).getDate() : 30;
  const firstDow = year && month ? (new Date(year, month - 1, 1).getDay() + 6) % 7 : 0;   // 周一=0
  const rows = Math.ceil((firstDow + days) / 7);
  const gap = Math.round(12 * s);
  const cellW = Math.floor((W - 2 * PAD - 6 * gap) / 7);
  const wdH = Math.round(44 * s);
  const titleH = Math.round(32 * s);      // 封面下面的片名行
  const gridTop = HEADER - Math.round(10 * s) + wdH;
  // 5 行正好铺满 3:4；6 行的月份封面不能压得太扁，宁可超出变长一点
  const room = minH - gridTop - FOOTER - Math.round(16 * s);
  const fit = Math.floor((room - (rows - 1) * gap) / rows) - titleH;
  const coverH = clamp(fit, Math.round(cellW * 1.26), Math.round(cellW * 1.42));
  const cellH = coverH + titleH;
  const contentH = gridTop + rows * cellH + (rows - 1) * gap + Math.round(16 * s) + FOOTER;
  const byDay = {};
  list.forEach(m => {
    const d = Number(String(m.date || '').split('-')[2]) || 0;
    if (!d) return;
    (byDay[d] = byDay[d] || []).push(m);
  });
  return { mode: 'calendar', W, s, PAD, headX: PAD, HEADER, FOOTER, year, month, days, firstDow, rows, gap, cellW, cellH, coverH, titleH, wdH, gridTop, byDay, contentH, H: Math.max(minH, contentH), n: list.length };
}

// 「2026.10.02 — 10.31 · 12 部」：同年后半段不写年份
function spanTextOf(movies, unit, count) {
  const dates = (movies || []).map(m => m.date).filter(Boolean).sort();
  const tail = `${count} ${unit}`;
  if (!dates.length) return tail;
  const a = dates[0], b = dates[dates.length - 1];
  const dot = d => d.replace(/-/g, '.');
  const range = a === b ? dot(a) : `${dot(a)} — ${a.slice(0, 4) === b.slice(0, 4) ? dot(b).slice(5) : dot(b)}`;
  return `${range} · ${tail}`;
}

function mdOf(date) {
  const p = String(date || '').split('-');
  return p.length === 3 ? `${p[1]}.${p[2]}` : '';
}

class MoviePosterDrawer {
  constructor(canvas, ctx, width, height, vocab) {
    this.canvas = canvas;
    this.ctx = ctx;
    this.w = width;
    this.h = height;
    this.V = Object.assign({}, MOVIE_VOCAB, vocab || this.constructor.VOCAB || {});
  }

  // 换词表：返回一个把 vocab 烤进去的子类（静态方法 / THEMES 随原型链继承），供其它每日主题复用全部版式
  static withVocab(vocab) {
    const V = Object.assign({}, MOVIE_VOCAB, vocab || {});
    return class extends MoviePosterDrawer {
      constructor(canvas, ctx, width, height) { super(canvas, ctx, width, height, V); }
      static get VOCAB() { return V; }
    };
  }

  static computeSize(count) {
    const l = computeLayout(count);
    return { width: l.W, height: l.H, cols: l.cols };
  }

  // 长图类版式（month / rating / calendar）的画布尺寸：高随内容变，需要拿到 movies（含 date / rating）
  static computeLayoutSize(layout, movies) {
    if (!movies || !movies.length) return { width: POSTER_W, height: POSTER_H, cols: 1 };
    const l = layout === 'month' ? computeMonthLayout(movies)
      : layout === 'rating' ? computeRatingLayout(movies)
      : layout === 'calendar' ? computeCalendarLayout(movies)
      : computeLayout((movies || []).length);
    return { width: l.W, height: l.H, cols: l.cols || 1 };
  }

  // 所选电影是否都在同一个月——「日历」版式的前提
  static isSingleMonth(movies) { return isSingleMonth(movies); }

  // layout: 'whole'（默认；1 部 cover / 2~3 部 rows / 4+ 网格）
  //       | 'month' 逐月分区 | 'rating' 逐星级分区 | 'calendar' 单月日历（均仅多部生效）
  // data.customTitle：用户自定义标题（≤20 字），有则替换各版式的默认标题
  draw(data, coverNodes, themeId, layout) {
    this.C = THEMES[themeId] || THEMES[DEFAULT_THEME];
    this.P = this.C.P;
    this.covers = coverNodes || {};
    const ctx = this.ctx;
    const d = data || {};
    const movies = (d.movies || []).slice(0, MAX_MOVIES);
    this.fontsReady = !!d.fontsReady;
    this.customTitle = String(d.customTitle || '').trim().slice(0, 20);
    this.periodLead = String(d.periodLead || '');   // 「2026年度」/「2026年6月」，有则长图标题不再从日期推
    // 范围内超过 MAX_MOVIES 部时分享页只传前 300 部，但统计按全量（fullStats）、页脚注明只展示了前 N 部
    this.fullStats = d.fullStats || null;
    this.totalCount = Number(d.totalCount) || movies.length;

    if (!movies.length) { this._drawEmptyPoster(); return; }
    if (layout !== 'whole' && movies.length >= 1) {
      if (layout === 'month') { this._drawSectionPoster(movies, computeMonthLayout(movies)); return; }
      if (layout === 'rating') { this._drawSectionPoster(movies, computeRatingLayout(movies)); return; }
      if (layout === 'calendar') { this._drawCalendarPoster(movies, computeCalendarLayout(movies)); return; }
    }
    const L = computeLayout(movies.length || 1);

    // cover 模式：海报即背景，独立走一套绘制（不画渐变底/头部/水印）
    if (L.mode === 'cover') {
      this._drawCoverHero(movies[0] || {}, L);
      return;
    }

    this._drawBackground();
    this._drawSummaryHeader(movies, L, this.periodLead || this._yearLead(movies));

    if (L.mode === 'rows') {
      this._drawRows(movies, L);
    } else {
      // 票少时别悬在正中：离标题近一点，空白留给下面；末行不足整行居中
      const n = movies.length;
      const gridTop = L.areaTop + Math.max(0, Math.round((L.availH - L.gridH) * 0.3));
      movies.forEach((m, i) => {
        const row = Math.floor(i / L.cols);
        const col = i % L.cols;
        const inRow = Math.min(L.cols, n - row * L.cols);
        const rowW = inRow * L.cellW + (inRow - 1) * L.COLGAP;
        const rowLeft = Math.round((this.w - rowW) / 2);
        const x = rowLeft + col * (L.cellW + L.COLGAP);
        const y = gridTop + row * (L.posterH + L.textH + L.ROWGAP);
        this._drawTile(x, y, L, m);
      });
    }

    this._drawTruncNote(movies.length);
    this._drawWatermark(this.w / 2, L.s);
  }

  // ============ 背景：和小票同一张渐变底 ============
  _drawBackground() {
    const ctx = this.ctx, P = this.P, s = this.w / 1080;
    const h = this.h / s;
    ctx.save();
    ctx.scale(s, s);
    fillPage(ctx, h, P);
    grain(ctx, 0, 0, 1080, h, 'page', P.speckA, P.speckB);
    ctx.restore();
  }

  // ============ 单部：海报满幅背景 + 蒙版 + 悬浮文字（字号/评分卡对齐「全平台评分查询」海报） ============
  _drawCoverHero(m, L) {
    const ctx = this.ctx, w = this.w, h = this.h, C = this.C;
    const s = w / 1080;

    // 1) 背景：海报满幅 aspectFill；无图渐变兜底
    const node = this.covers[m.key];
    if (node && node.width && node.height) {
      const k = Math.max(w / node.width, h / node.height);
      const dw = node.width * k, dh = node.height * k;
      ctx.drawImage(node, (w - dw) / 2, (h - dh) / 2, dw, dh);
    } else {
      const g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, C.ph1); g.addColorStop(1, C.ph2);
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.font = `${Math.round(h * 0.2)}px sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(this.V.emoji, w / 2, h * 0.36);
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    }

    // 2a) 品牌色斜向 tint（对齐 category 卡片 brand 色；降透明度，不盖住海报本色）
    const tint = ctx.createLinearGradient(0, 0, w, h);
    tint.addColorStop(0, this.V.tint[0]);
    tint.addColorStop(1, this.V.tint[1]);
    ctx.fillStyle = tint; ctx.fillRect(0, 0, w, h);

    // 2b) 底部蒙层：顶透 → 底 0.85 黑（对齐详情海报），保证白字对比
    const mask = ctx.createLinearGradient(0, 0, 0, h);
    mask.addColorStop(0, 'rgba(0,0,0,0)');
    mask.addColorStop(0.35, 'rgba(0,0,0,0.10)');
    mask.addColorStop(0.68, 'rgba(0,0,0,0.52)');
    mask.addColorStop(1, 'rgba(0,0,0,0.86)');
    ctx.fillStyle = mask; ctx.fillRect(0, 0, w, h);

    // 3) 尺寸（对齐详情海报 1080 基准，按 s 缩放）
    const ix = Math.round(46 * s);                 // 内容左内边距
    const tw = w - ix * 2;
    const dateSize = Math.round(34 * s);
    const titleSize = Math.round(69 * s), titleLH = Math.round(titleSize * 1.28);
    const subSize = Math.round(37 * s), subLH = Math.round(subSize * 1.4);
    const genreSize = Math.round(32 * s), genreTagH = Math.round(genreSize * 1.4) + Math.round(12 * s);
    const noteSize = Math.round(30 * s), noteLH = Math.round(noteSize * 1.62);
    const starSize = Math.round(46 * s), starGap = Math.round(9 * s), starsRowH = Math.round(58 * s);

    // 段间距（保持合适行距）
    const gDateTitle = Math.round(22 * s);
    const gTitleSub = Math.round(26 * s);
    const gGenreStars = Math.round(34 * s);
    const gStarsNote = Math.round(28 * s);
    const gMetaCards = Math.round(48 * s);

    // 4) 内容准备
    const watchDate = m.watchDateText || '';
    ctx.font = `800 ${titleSize}px sans-serif`;
    const titleLines = this._wrapLines(m.title || this.V.untitled, tw, 2);
    const dirText = String(m.byline || '');            // 署名行：电影「导演 xxx」/ 书「作者 xxx」
    const genres = (m.tags || []).slice(0, 4);         // 标签胶囊：电影类型 / 阅读进度
    const hasDG = !!(dirText || genres.length);        // 署名 + 标签（同一行）
    const dgRowH = Math.max(subLH, genreTagH);
    const hasStars = Number(m.rating) > 0, hasMood = !!(m.moodEmoji || m.moodLabel);
    ctx.font = `400 ${noteSize}px sans-serif`;
    const noteLines = m.note ? this._wrapLines(`「${m.note}」`, tw, 6) : [];  // 最多 6 行，可容纳约 140 字
    const cards = (m.platformRatings || []).slice(0, 4);

    // 5) 各段高度 + 总高（用于底部锚定）
    const dateH = watchDate ? dateSize + gDateTitle : 0;
    const titleH = titleLines.length * titleLH;
    const dgH = hasDG ? gTitleSub + dgRowH : 0;
    const starsH = (hasStars || hasMood) ? gGenreStars + starsRowH : 0;
    const noteH = noteLines.length ? gStarsNote + noteLines.length * noteLH : 0;
    const metaH = dateH + titleH + dgH + starsH + noteH;
    const cardsH = cards.length ? Math.round(146 * s) : 0;

    // 6) 自底向上锚定：署名 → 评分卡 → 文字块
    const wmY = h - Math.round(52 * s);
    this._drawWatermarkWhite(w / 2, wmY, s);
    let bottom = wmY - Math.round(46 * s);
    if (cards.length) {
      const cardsTop = bottom - cardsH;
      this._drawRatingCards(ix, cardsTop, tw, cardsH, cards, s);
      bottom = cardsTop - gMetaCards;
    }
    let ty = bottom - metaH;   // 文字块顶（textBaseline='top'）

    // 7) 逐段绘制（top 基线，逐行拉开间距）
    // 观影日期（标题上方）
    if (watchDate) {
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      this._shadowOn(0.5, 8, 2);
      ctx.font = `500 ${dateSize}px sans-serif`;
      ctx.fillStyle = 'rgba(255,255,255,0.82)';
      ctx.fillText(watchDate, ix, ty);
      this._shadowOff();
      ty += dateSize + gDateTitle;
    }
    // 标题
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    this._shadowOn(0.5, 12, 3);
    ctx.font = `800 ${titleSize}px sans-serif`;
    ctx.fillStyle = '#FFFFFF';
    titleLines.forEach((ln, i) => ctx.fillText(ln, ix, ty + i * titleLH));
    this._shadowOff();
    ty += titleH;
    // 署名 + 标签（同一行：署名文字在左，标签胶囊紧随其后）
    if (hasDG) {
      ty += gTitleSub;
      const rowMid = ty + dgRowH / 2;
      let cx = ix;
      if (dirText) {
        ctx.font = `500 ${subSize}px sans-serif`;
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        const dirMaxW = genres.length ? Math.round(tw * 0.55) : tw;
        const dirDraw = this._truncate(dirText, dirMaxW);
        this._shadowOn(0.4, 6, 1);
        ctx.fillStyle = 'rgba(255,255,255,0.88)';
        ctx.fillText(dirDraw, cx, rowMid);
        this._shadowOff();
        cx += ctx.measureText(dirDraw).width + Math.round(22 * s);
      }
      if (genres.length) {
        this._drawGenreTags(cx, rowMid - genreTagH / 2, w - ix, genres, genreSize, genreTagH, s);
      }
      ty += dgRowH;
    }
    // 星级 + 分数 + 心情
    if (hasStars || hasMood) {
      ty += gGenreStars;
      const cy = ty + starsRowH / 2;
      let cx = ix;
      if (hasStars) {
        // 「我的评分」前缀
        ctx.font = `600 ${Math.round(30 * s)}px sans-serif`;
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        this._shadowOn(0.4, 6, 1);
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.fillText('我的评分', cx, cy);
        this._shadowOff();
        cx += ctx.measureText('我的评分').width + Math.round(20 * s);
        // 星级 + 分数
        this._shadowOn(0.4, 6, 1);
        this._drawStars(cx, cy - starSize / 2, starSize, starGap, m.rating, '#FFD24A', 'rgba(255,255,255,0.30)');
        ctx.font = `700 ${Math.round(38 * s)}px sans-serif`;
        ctx.fillStyle = '#FFFFFF'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        ctx.fillText(tidy(Number(m.rating) * 2), cx + 5 * (starSize + starGap) + Math.round(18 * s), cy);
        this._shadowOff();
        cx += 5 * (starSize + starGap) + Math.round(130 * s);
      }
      if (hasMood) {
        const t = `${m.moodEmoji || ''}${m.moodLabel ? ' ' + m.moodLabel : ''}`.trim();
        this._glassChip(cx, cy - Math.round(25 * s), t, s);
      }
      ty += starsRowH;
    }
    // 短评
    if (noteLines.length) {
      ty += gStarsNote;
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      this._shadowOn(0.4, 6, 1);
      ctx.font = `400 ${noteSize}px sans-serif`;
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      noteLines.forEach((ln, i) => ctx.fillText(ln, ix, ty + i * noteLH));
      this._shadowOff();
    }
  }

  // 类型胶囊行（白透底 + 白透边 + 白字，同详情海报）；单行，溢出即止
  _drawGenreTags(x, y, maxRight, genres, fs, tagH, s) {
    const ctx = this.ctx;
    ctx.save();
    ctx.font = `400 ${fs}px sans-serif`;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    const padH = Math.round(23 * s), gap = Math.round(14 * s);
    let cx = x;
    const cy = y + tagH / 2;
    genres.forEach(g => {
      const tw = ctx.measureText(g).width;
      const tagW = tw + padH * 2;
      if (cx + tagW > maxRight) return;
      this._roundRectPath(cx, y, tagW, tagH, tagH / 2);
      ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fill();
      ctx.lineWidth = Math.max(1, Math.round(1.5 * s));
      ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.stroke();
      ctx.fillStyle = '#FFFFFF';
      ctx.fillText(g, cx + padH, cy + 1);
      cx += tagW + gap;
    });
    ctx.restore();
  }

  // 半透明白评分卡片（label/value，配色同详情海报）；定宽（按 4 列基准，不随数量拉宽）、整体居中
  _drawRatingCards(x, y, w, h, cards, s) {
    const ctx = this.ctx;
    const list = cards.slice(0, 4);
    const gap = Math.round(17 * s);
    const cw = Math.floor((w - gap * 3) / 4);       // 固定按 4 列算宽 → 少于 4 个也不拉宽
    const startX = x;                                // 靠左对齐（豆瓣在最左，与标题对齐）
    const radius = Math.round(23 * s);
    const padTop = Math.round(24 * s);
    const labelSize = Math.round(32 * s);
    const valueSize = Math.round(49 * s);
    const valueMt = Math.round(14 * s);
    list.forEach((c, i) => {
      const cx = startX + i * (cw + gap);
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.28)';
      ctx.shadowBlur = Math.round(14 * s); ctx.shadowOffsetY = Math.round(6 * s);
      this._roundRectPath(cx, y, cw, h, radius);
      ctx.fillStyle = 'rgba(255,255,255,0.80)';      // 增加透明度（更玻璃感）
      ctx.fill();
      ctx.restore();
      ctx.lineWidth = Math.max(1, Math.round(1.5 * s));
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      this._roundRectPath(cx, y, cw, h, radius);
      ctx.stroke();
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.font = `600 ${labelSize}px sans-serif`;
      ctx.fillStyle = '#5f6a45';
      ctx.fillText(c.label, cx + cw / 2, y + padTop);
      ctx.font = `800 ${valueSize}px sans-serif`;
      ctx.fillStyle = '#61762f';
      ctx.fillText(this._truncate(String(c.value), cw - Math.round(12 * s)), cx + cw / 2, y + padTop + labelSize + valueMt);
      ctx.textAlign = 'left';
    });
  }

  // ============ 抬头：放映机 + 光柱 + 标题 + 起止日期和部数（设计稿坐标，整体放大 s 倍）============
  //   titleLead：默认标题前缀（「2026年度」/「2026年6月」），后接强调色「观影」+「总结」；有自定义标题就用自定义的。
  _drawSummaryHeader(movies, L, titleLead) {
    const ctx = this.ctx, P = this.P, V = this.V, s = L.s;
    const x0 = (L.headX || L.PAD) / s, x1 = L.W / s - x0;
    const title = this.customTitle || `${titleLead || ''}${V.verb}总结`;
    const accent = this.customTitle ? '' : V.verb;
    const count = this.fullStats ? this.fullStats.count : movies.length;
    const span = spanTextOf(movies, V.unit, count);
    ctx.save();
    ctx.scale(s, s);
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    if (V.cinema) {
      drawBeam(ctx, lensOf(x0, HEAD_TOP), Math.max(10, HEAD_TOP - 64), HEAD_TOP + BEAM_BOTTOM, L.W / s, P, title);
      drawHeader(ctx, x0, x1, HEAD_TOP, title, span, P, this.fontsReady, accent);
    } else {
      drawTitleBlock(ctx, x0, x1, HEAD_TOP + PROJECTOR_MID, title, span, P, this.fontsReady, accent);
    }
    ctx.restore();
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
  }

  // 全量统计：部数 / 平均分（10 分制，全部未评分为 null）/ 观影日 / 活跃月
  static summarize(movies) {
    const list = movies || [];
    const rated = list.filter(m => Number(m.rating) > 0);
    const days = [];
    const months = [];
    list.forEach(m => {
      if (m.date && days.indexOf(m.date) < 0) days.push(m.date);
      const ym = ymOf(m).ym;
      if (ym && months.indexOf(ym) < 0) months.push(ym);
    });
    const avg = rated.length ? rated.reduce((a, m) => a + Number(m.rating), 0) / rated.length * 2 : null;
    return { count: list.length, avg, days: days.length, months: months.length };
  }

  // 截断注脚：范围内多于画出来的部数时，署名上方一行小字说明
  _drawTruncNote(shown) {
    if (this.totalCount <= shown) return;
    const ctx = this.ctx, C = this.C, s = this.w / 1080;
    ctx.font = this.P.f(500, 20 * s);
    ctx.fillStyle = C.inkSoft;
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(`共 ${this.totalCount} ${this.V.unit}，海报按时间展示最早的 ${shown} ${this.V.unit}`, this.w / 2, this.h - Math.round(76 * s));
    ctx.textAlign = 'left';
  }

  // 年份区间 → 「2026年度」/「2025–2026」
  _yearLead(movies) {
    const years = [];
    movies.forEach(m => { const y = ymOf(m).year; if (y && years.indexOf(y) < 0) years.push(y); });
    years.sort((a, b) => a - b);
    if (!years.length) return '';
    return years.length === 1 ? `${years[0]}年度` : `${years[0]}–${years[years.length - 1]}`;
  }

  // ============ 分区长图（按月份 / 按评分）：左标签栏 + 右封面网格 ============
  _drawSectionPoster(movies, L) {
    const ctx = this.ctx, C = this.C, P = this.P, s = L.s, W = L.W, fr = this.fontsReady;
    this._drawBackground();
    this._drawSummaryHeader(movies, L, this.periodLead || this._yearLead(movies));

    const gridX = L.PAD + L.labelW;
    const unit = this.V.unit;
    L.secs.forEach((sec, si) => {
      const top = sec.top;
      const labelY = top + L.secPad + Math.round(62 * s);
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      if (sec.kind === 'month') {
        // 月号 / 中文月 · 部数
        ctx.font = P.n(700, Math.round(72 * s), fr);
        ctx.fillStyle = C.ink;
        ctx.fillText(sec.month ? String(sec.month).padStart(2, '0') : '--', L.PAD, labelY);
        ctx.font = P.f(500, Math.round(24 * s));
        ctx.fillStyle = C.inkSoft;
        if (sec.month) ctx.fillText(MONTH_CN[sec.month - 1], L.PAD, labelY + Math.round(42 * s));
        ctx.font = P.f(400, Math.round(21 * s));
        ctx.fillText(`${sec.movies.length} ${unit}`, L.PAD, labelY + Math.round(76 * s));
      } else if (sec.level > 0) {
        // 星级数 / 星星行 / 力荐 · 部数
        ctx.font = P.n(700, Math.round(72 * s), fr);
        ctx.fillStyle = C.ink;
        ctx.fillText(String(sec.level), L.PAD, labelY);
        const ss = Math.round(16 * s), sg = Math.round(3 * s);
        kit.stars(ctx, L.PAD, labelY + Math.round(18 * s), sec.level, ss, sg, C.star, C.starEmpty);
        ctx.font = P.f(500, Math.round(24 * s));
        ctx.fillStyle = C.inkSoft;
        ctx.fillText(RATING_LABEL[sec.level], L.PAD, labelY + Math.round(70 * s));
        ctx.font = P.f(400, Math.round(21 * s));
        ctx.fillText(`${sec.movies.length} ${unit}`, L.PAD, labelY + Math.round(104 * s));
      } else {
        ctx.font = P.f(700, Math.round(32 * s));
        ctx.fillStyle = C.inkSoft;
        ctx.fillText('未评分', L.PAD, labelY - Math.round(10 * s));
        ctx.font = P.f(500, Math.round(22 * s));
        ctx.fillText(`${sec.movies.length} ${unit}`, L.PAD, labelY + Math.round(30 * s));
      }

      // 右栏：封面网格 + 单行片名
      sec.movies.forEach((m, i) => {
        const row = Math.floor(i / L.cols), col = i % L.cols;
        const x = gridX + col * (L.cellW + L.gap);
        const y = top + L.secPad + row * (L.coverH + L.titleH + L.rowGap);
        this._drawShadowCover(m, x, y, L.cellW, L.coverH, Math.max(6, Math.round(L.cellW * 0.05)), s);
        if (L.titled) {
          const fs = sectionTitleSize(L.cellW);
          ctx.font = P.f(500, fs);
          ctx.fillStyle = C.ink;
          ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
          ctx.fillText(this._truncate(m.title || this.V.untitled, L.cellW), x, y + L.coverH + 14 + fs);
        }
      });

      // 段与段之间一条虚线，末段不画
      if (si < L.secs.length - 1) kit.dashed(ctx, L.PAD, top + sec.h, W - L.PAD, top + sec.h, Math.round(1.5 * s), C.inkFaint, 4 * s, 5 * s);
    });

    this._drawTruncNote(movies.length);
    this._drawWatermark(W / 2, s);
  }

  // ============ 单月日历长图：周一起始，有观影的日子铺封面 ============
  _drawCalendarPoster(movies, L) {
    const ctx = this.ctx, C = this.C, P = this.P, s = L.s, W = L.W, fr = this.fontsReady;
    this._drawBackground();
    const lead = this.periodLead || (L.year && L.month ? `${L.year}年${L.month}月` : this._yearLead(movies));
    this._drawSummaryHeader(movies, L, lead);

    // 星期表头
    const WD = ['一', '二', '三', '四', '五', '六', '日'];
    const wdY = L.gridTop - L.wdH / 2;
    ctx.font = P.f(500, Math.round(24 * s));
    ctx.fillStyle = C.inkSoft;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    WD.forEach((t, i) => ctx.fillText(t, L.PAD + i * (L.cellW + L.gap) + L.cellW / 2, wdY));
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';

    const r = Math.round(8 * s);
    for (let d = 1; d <= L.days; d++) {
      const idx = L.firstDow + d - 1;
      const row = Math.floor(idx / 7), col = idx % 7;
      const x = L.PAD + col * (L.cellW + L.gap);
      const y = L.gridTop + row * (L.cellH + L.gap);
      const list = L.byDay[d];
      if (!list || !list.length) {
        // 空白日：只留日号，不要格子，封面才跳得出来
        ctx.font = P.n(500, Math.round(24 * s), fr);
        ctx.fillStyle = C.inkSoft;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(String(d), x + L.cellW / 2, y + L.coverH / 2);
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        continue;
      }
      // 观影日：格内按部数切分（同小程序日历页）——1 满格 / 2 左右各半 / 3 左一大右二小 / 4 田字，
      // 超过 4 部的右上角「+N」；左上角日号，片名写在封面下面（压在封面上会和海报自己的字打架）
      this._drawCalendarCell(list, x, y, L.cellW, L.coverH, r, s);
      const pad = Math.round(5 * s);
      this._dayChip(x + pad, y + pad, String(d), s, 'left');
      if (list.length > 4) this._dayChip(x + L.cellW - pad, y + pad, `+${list.length - 4}`, s, 'right');
      const first = list[0].title || this.V.untitled;
      const label = list.length > 1 ? `${first} 等${list.length}${this.V.unit}` : first;
      ctx.font = P.f(500, Math.round(19 * s));
      ctx.fillStyle = C.ink;
      ctx.fillText(this._truncate(label, L.cellW), x, y + L.coverH + Math.round(24 * s));
    }

    this._drawWatermark(W / 2, s);
  }

  // 日历格上的小标：半透明黑底白字，x 按 align 是左缘或右缘
  _dayChip(x, y, label, s, align) {
    const ctx = this.ctx;
    ctx.font = this.P.n(600, Math.round(19 * s), this.fontsReady);
    const h = Math.round(28 * s), w = Math.max(h, ctx.measureText(label).width + Math.round(14 * s));
    const left = align === 'right' ? x - w : x;
    this._roundRectPath(left, y, w, h, Math.round(6 * s));
    ctx.fillStyle = 'rgba(20,20,28,0.62)';
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(label, left + w / 2, y + h / 2 + 1);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  }

  // ============ 空态：范围内没有观影记录 ============
  _drawEmptyPoster() {
    const ctx = this.ctx, C = this.C;
    const W = this.w, s = W / 1080;
    const L = { s, W, PAD: Math.round(72 * s) };
    this._drawBackground();
    this._drawSummaryHeader([], L, this.periodLead);
    ctx.font = this.P.f(500, Math.round(30 * s));
    ctx.fillStyle = C.inkSoft;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(this.V.emptyText, W / 2, this.h * 0.5);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    this._drawWatermark(W / 2, s);
  }

  // 日历格：最多 4 张封面拼一格（整格一个圆角 + 一个阴影，内部细缝 2*s），再压片名
  _drawCalendarCell(list, x, y, w, h, r, s) {
    const ctx = this.ctx, C = this.C;
    const n = Math.min(4, list.length);
    const gap = Math.round(2 * s);
    const halfW = (w - gap) / 2, halfH = (h - gap) / 2;
    // [x, y, w, h] 相对格子
    const rects = n === 1 ? [[0, 0, w, h]]
      : n === 2 ? [[0, 0, halfW, h], [halfW + gap, 0, halfW, h]]
      : n === 3 ? [[0, 0, halfW, h], [halfW + gap, 0, halfW, halfH], [halfW + gap, halfH + gap, halfW, halfH]]
      : [[0, 0, halfW, halfH], [halfW + gap, 0, halfW, halfH], [0, halfH + gap, halfW, halfH], [halfW + gap, halfH + gap, halfW, halfH]];

    ctx.save();
    ctx.shadowColor = `rgba(${this.P.shadow},0.26)`;
    ctx.shadowBlur = Math.round(14 * s);
    ctx.shadowOffsetY = Math.round(6 * s);
    this._roundRectPath(x, y, w, h, r);
    ctx.fillStyle = C.ph2;
    ctx.fill();
    ctx.restore();

    ctx.save();
    this._roundRectPath(x, y, w, h, r);
    ctx.clip();
    rects.forEach((rc, i) => {
      const m = list[i];
      const node = this.covers[m.key];
      const [cx, cy, cw, ch] = [x + rc[0], y + rc[1], rc[2], rc[3]];
      if (node && node.width && node.height) {
        const k = Math.max(cw / node.width, ch / node.height);
        const dw = node.width * k, dh = node.height * k;
        ctx.save();
        ctx.beginPath(); ctx.rect(cx, cy, cw, ch); ctx.clip();
        ctx.drawImage(node, cx + (cw - dw) / 2, cy + (ch - dh) / 2, dw, dh);
        ctx.restore();
      } else {
        const g = ctx.createLinearGradient(cx, cy, cx, cy + ch);
        g.addColorStop(0, C.ph1); g.addColorStop(1, C.ph2);
        ctx.fillStyle = g; ctx.fillRect(cx, cy, cw, ch);
        ctx.fillStyle = this._rgba(C.decoRgb, 0.55);
        ctx.font = `${Math.round(Math.min(cw, ch) * 0.34)}px sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(this.V.emoji, cx + cw / 2, cy + ch / 2);
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      }
    });
    ctx.restore();
    // 细描边
    this._roundRectPath(x, y, w, h, r);
    ctx.lineWidth = 2;
    ctx.strokeStyle = this._rgba(C.borderRgb, C.isDark ? 0.28 : 0.35);
    ctx.stroke();
  }

  // 带阴影的圆角封面（长图版式共用）
  _drawShadowCover(m, x, y, w, h, r, s) {
    const ctx = this.ctx, C = this.C;
    ctx.save();
    ctx.shadowColor = `rgba(${this.P.shadow},0.26)`;
    ctx.shadowBlur = Math.round(14 * s);
    ctx.shadowOffsetY = Math.round(6 * s);
    this._roundRectPath(x, y, w, h, r);
    ctx.fillStyle = C.ph2;
    ctx.fill();
    ctx.restore();
    this._drawCover(this.covers[m.key], x, y, w, h, r, m.title);
  }

  // ============ 2~3 部：纵向排列，海报左、文案右 ============
  _drawRows(movies, L) {
    const n = movies.length;
    const gap = Math.round(L.W * 0.030);
    const rowH = Math.floor((L.availH - (n - 1) * gap) / n);
    movies.forEach((m, i) => {
      const y = L.areaTop + i * (rowH + gap);
      this._drawHeroRow(m || {}, L.M + L.PAD, y, L.innerW, rowH);
    });
  }

  _drawHeroRow(m, x, y, w, h) {
    const ctx = this.ctx, C = this.C, P = this.P;
    const s = this.w / 1080, fr = this.fontsReady;
    const posterW = Math.min(Math.round(w * 0.36), Math.round((h - 8) / 1.42));
    const posterH = Math.round(posterW * 1.42);
    const px = x, py = y + Math.round((h - posterH) / 2);
    this._drawShadowCover(m, px, py, posterW, posterH, Math.round(12 * s), s);

    const gap = Math.round(44 * s);
    const tx = px + posterW + gap;
    const tw = w - posterW - gap;

    // 先量出整块文字的高度，和封面上下居中
    const titleSize = Math.round(44 * s), titleLH = Math.round(56 * s);
    ctx.font = P.f(700, titleSize);
    const titleLines = this._wrapLines(m.title || this.V.untitled, tw, 2);
    const metaSize = Math.round(25 * s), rowGap = Math.round(20 * s);
    const meta = [mdOf(m.date), m.year].filter(Boolean).join(' · ');
    const hasStars = Number(m.rating) > 0;
    const star = Math.round(30 * s), starGap = Math.round(6 * s);
    const noteSize = Math.round(25 * s), noteLH = Math.round(38 * s);
    ctx.font = P.f(400, noteSize);
    const noteLines = m.note ? this._wrapLines(`「${m.note}」`, tw, 3) : [];
    const blockH = titleLines.length * titleLH
      + (m.byline ? metaSize + rowGap : 0)
      + (meta ? metaSize + rowGap : 0)
      + (hasStars ? star + rowGap : 0)
      + (noteLines.length ? noteLines.length * noteLH + rowGap : 0);
    let ty = py + Math.round((posterH - blockH) / 2);

    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.font = P.f(700, titleSize);
    ctx.fillStyle = C.ink;
    titleLines.forEach(line => { ctx.fillText(line, tx, ty + titleSize); ty += titleLH; });

    ctx.font = P.f(500, metaSize);
    ctx.fillStyle = C.inkSoft;
    if (m.byline) { ty += rowGap; ctx.fillText(this._truncate(m.byline, tw), tx, ty + metaSize * 0.84); ty += metaSize; }
    if (meta) {
      ty += rowGap;
      ctx.font = P.n(500, metaSize, fr);
      ctx.fillText(this._truncate(meta, tw), tx, ty + metaSize * 0.84);
      ty += metaSize;
    }
    if (hasStars) {
      ty += rowGap;
      kit.stars(ctx, tx, ty, Number(m.rating), star, starGap, C.star, C.starEmpty);
      ty += star;
    }
    if (noteLines.length) {
      ty += rowGap;
      ctx.font = P.f(400, noteSize);
      ctx.fillStyle = C.inkSoft;
      noteLines.forEach(line => { ctx.fillText(line, tx, ty + noteSize); ty += noteLH; });
    }
  }

  // ============ 网格单元：封面 + 片名（够宽再加一行：日期靠左、星星靠右）============
  _drawTile(x, y, L, m) {
    const ctx = this.ctx, C = this.C, P = this.P, s = L.s, w = L.cellW;
    this._drawShadowCover(m, x, y, w, L.posterH, Math.max(6, Math.round(w * 0.05)), s);
    if (L.tier === 'bare') return;

    const size = tileTitleSize(w, s);
    const titleY = y + L.posterH + Math.round(12 * s) + size;
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.font = P.f(600, size);
    ctx.fillStyle = C.ink;
    ctx.fillText(this._truncate(m.title || this.V.untitled, w), x, titleY);
    if (L.tier !== 'rich') return;

    const meta = tileMetaSize(w, s);
    const mid = titleY + Math.round(14 * s) + meta / 2;
    ctx.textBaseline = 'middle';
    ctx.font = P.n(500, meta, this.fontsReady);
    ctx.fillStyle = C.inkSoft;
    text.drawTabular(ctx, mdOf(m.date), x, mid);
    if (Number(m.rating) > 0) {
      const star = Math.round(clamp(w * 0.08, 12 * s, 20 * s)), gap = Math.max(1, Math.round(star * 0.16));
      kit.stars(ctx, x + w - 5 * star - 4 * gap, mid - star / 2, Number(m.rating), star, gap, C.star, C.starEmpty);
    }
    ctx.textBaseline = 'alphabetic';
  }

  // 封面（object-fit: cover 进圆角矩形；无节点画占位）
  _drawCover(node, x, y, w, h, r, title) {
    const ctx = this.ctx, C = this.C;
    ctx.save();
    this._roundRectPath(x, y, w, h, r);
    ctx.clip();
    if (node && node.width && node.height) {
      const s = Math.max(w / node.width, h / node.height);
      const dw = node.width * s, dh = node.height * s;
      ctx.drawImage(node, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
    } else {
      const g = ctx.createLinearGradient(x, y, x, y + h);
      g.addColorStop(0, C.ph1);
      g.addColorStop(1, C.ph2);
      ctx.fillStyle = g;
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = this._rgba(C.decoRgb, 0.55);
      ctx.font = `${Math.round(h * 0.24)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(this.V.emoji, x + w / 2, y + h / 2 - h * 0.04);
      ctx.fillStyle = C.inkSoft;
      ctx.font = '500 22px sans-serif';
      ctx.fillText(this._truncate(title || '', w - 24), x + w / 2, y + h / 2 + h * 0.18);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
    }
    ctx.restore();
    // 细描边
    this._roundRectPath(x, y, w, h, r);
    ctx.lineWidth = 2;
    ctx.strokeStyle = this._rgba(C.borderRgb, C.isDark ? 0.28 : 0.35);
    ctx.stroke();
  }

  // ============ 元件 ============
  _drawStars(x, y, size, gap, rating, fillColor, emptyColor) {
    const ctx = this.ctx, C = this.C;
    const star = fillColor || C.star;
    const empty = emptyColor || C.starEmpty;
    const r = clamp(Number(rating) || 0, 0, 5);
    for (let i = 0; i < 5; i++) {
      const cx = x + i * (size + gap) + size / 2;
      const cy = y + size / 2;
      const fill = clamp(r - i, 0, 1); // 0 / 0.5 / 1
      // 底星
      this._starPath(cx, cy, size / 2);
      ctx.fillStyle = empty;
      ctx.fill();
      if (fill > 0) {
        ctx.save();
        this._starPath(cx, cy, size / 2);
        ctx.clip();
        ctx.fillStyle = star;
        ctx.fillRect(cx - size / 2, cy - size / 2, size * fill, size);
        ctx.restore();
      }
    }
  }

  _starPath(cx, cy, R) {
    const ctx = this.ctx;
    const inner = R * 0.42;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const rad = i % 2 === 0 ? R : inner;
      const a = -Math.PI / 2 + i * Math.PI / 5;
      const px = cx + Math.cos(a) * rad;
      const py = cy + Math.sin(a) * rad;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }

  // 小圆角标签（心情 / 平台）；返回右边界 x
  _wrapLines(text, maxW, maxLines) {
    const ctx = this.ctx;
    const paras = String(text == null ? '' : text).split('\n');
    const lines = [];
    let cut = false;
    for (let p = 0; p < paras.length; p++) {
      if (lines.length >= maxLines) { cut = true; break; }
      const chars = paras[p].split('');
      if (!chars.length) { lines.push(''); continue; }   // 空行保留
      let line = '';
      for (let i = 0; i < chars.length; i++) {
        const test = line + chars[i];
        if (ctx.measureText(test).width > maxW && line) {
          lines.push(line);
          line = chars[i];
          if (lines.length >= maxLines) { cut = true; break; }
        } else {
          line = test;
        }
      }
      if (cut) break;          // 本段还没排完就满了
      lines.push(line);
    }
    if (cut && lines.length) {
      let t = lines[lines.length - 1];
      while (t && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
      lines[lines.length - 1] = t + '…';
    }
    return lines.slice(0, maxLines);
  }

  // 文字阴影开关（成对使用；靠 save/restore 复位）
  _shadowOn(a, blur, dy) {
    const ctx = this.ctx;
    ctx.save();
    ctx.shadowColor = `rgba(0,0,0,${a == null ? 0.5 : a})`;
    ctx.shadowBlur = blur == null ? 12 : blur;
    ctx.shadowOffsetY = dy == null ? 2 : dy;
  }
  _shadowOff() { this.ctx.restore(); }

  // 玻璃拟态小标签（半透明白底 + 白边 + 白字），用于海报背景之上
  _glassChip(x, y, text, s) {
    const ctx = this.ctx;
    const fs = Math.round(26 * s);
    const h = Math.round(50 * s);
    const padX = Math.round(20 * s);
    ctx.font = `600 ${fs}px sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const tw = ctx.measureText(text).width;
    const w = padX * 2 + tw;
    this._roundRectPath(x, y, w, h, h / 2);
    ctx.fillStyle = 'rgba(255,255,255,0.20)';
    ctx.fill();
    ctx.lineWidth = Math.max(1, Math.round(1.5 * s));
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.stroke();
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(text, x + padX, y + h / 2 + 1);
    ctx.textBaseline = 'alphabetic';
    return x + w;
  }

  // 署名水印（白字版，用于 cover 海报底部）
  _drawWatermarkWhite(cx, cy, s) {
    const ctx = this.ctx;
    const text = kit.WATERMARK;
    // 署名是次要信息：压低不透明度 + 减一档字重，并微微偏向品牌色（呼应 tint），
    // 避免纯白粗体压在暗部蒙层上过于生硬、抢走标题的视觉重量。
    this._shadowOn(0.32, 6, 1);
    ctx.font = `500 ${Math.round(26 * s)}px sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const tw = ctx.measureText(text).width;
    const dotR = Math.round(5 * s), lead = dotR * 2 + Math.round(14 * s);
    const totalW = lead + tw;
    const x = cx - totalW / 2;
    ctx.beginPath();
    ctx.arc(x + dotR, cy, dotR, 0, Math.PI * 2);
    ctx.fillStyle = this.V.heroSign.dot;        // 品牌色圆点，弱于正文
    ctx.fill();
    ctx.fillStyle = this.V.heroSign.text;       // 近白、半透，安静地退到背景里
    ctx.fillText(text, x + lead, cy + 1);
    this._shadowOff();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  _drawWatermark(cx, s) {
    const P = this.P;
    this.ctx.textBaseline = 'alphabetic';
    kit.watermark(this.ctx, cx, this.h - Math.round(44 * s), s, P.wm, P.accent, (w, size) => P.f(w, size));
    this.ctx.textAlign = 'left';
  }

  // ============ 工具 ============
  _rgba(rgb, a) { return `rgba(${rgb},${a})`; }

  _truncate(text, maxW) {
    const ctx = this.ctx;
    let s = String(text == null ? '' : text);
    if (ctx.measureText(s).width <= maxW) return s;
    while (s.length && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1);
    return s + '…';
  }

  _roundRectPath(x, y, w, h, r) {
    const ctx = this.ctx;
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }
}

MoviePosterDrawer.THEMES = THEME_LIST;
MoviePosterDrawer.DEFAULT_THEME = DEFAULT_THEME;
MoviePosterDrawer.MOVIE_VOCAB = MOVIE_VOCAB;

module.exports = MoviePosterDrawer;
