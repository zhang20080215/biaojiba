/**
 * 每日电影 · 观影记录分享海报绘制器
 *
 * 设计目标：以电影海报为视觉主体的「观影记录」分享图，审美高级、有分享欲。
 *   - 始终 3:4；最小 1080×1440，随所选电影数量整体等比放大（画布像素变大、排版更密）。
 *   - 外层渐变 + 细颗粒质感做「相框卡纸」，中间圆角面板承载「标题 + 电影网格 + 署名」。
 *   - 每部电影：封面 + 观看日期 + 评分(星) + 心情 + 短评，随数量分档展示（少而精 / 多而齐）。
 *
 * 用法：
 *   const { width, height } = MoviePosterDrawer.computeSize(movies.length);        // layout 'whole'
 *   const { width, height } = MoviePosterDrawer.computeLayoutSize(layout, movies); // month/rating/calendar 长图（高随内容）
 *   canvas.width = width; canvas.height = height;
 *   new MoviePosterDrawer(canvas, ctx, width, height).draw(data, coverNodes, themeId, layout);
 *
 * layout（仅多部生效）：whole 整体一张（2~3 部纵向 / 4+ 网格）| month 按月份分区 | rating 按星级分区 | calendar 单月日历（需同月，见 isSingleMonth）
 * data.customTitle：自定义标题（≤20 字）；空则各版式用默认标题
 * data.periodLead：数据范围前缀（「2026年度」/「2026年6月」），长图标题 = 前缀 + 观影总结；空则按电影日期推
 * movies 为空时画空态（背景 + 0 部统计 + 提示文字）
 *
 * data = {
 *   title:        '我的观影记录',
 *   subtitle:     '2026.03 - 2026.07 · 共 12 部',   // 一行副标题
 *   avgText:      '平均 8.6',                        // 可空
 *   movies: [{
 *     key, date:'2026-07-13', title, year, dateLabel:'7月13日',
 *     rating(0~5), moodEmoji, moodLabel, note,
 *     platformRatings:[{label,value}]
 *   }]
 * }
 * coverNodes = { [key]: ImageNode|null }   // 预加载好的封面（canvas.createImage），失败为 null → 占位
 */

// ============ 主题：对齐豆瓣 TOP250 海报页（pages/douban/share）的三套背景渐变 ============
//   文字/元素色固定（标题 #2D2D2B、次要 #7A776D、淡 #9C998F、星 #D4A828），切换只换背景。
const INK = {
  isDark: false,
  panel: 'rgba(255,255,255,0.55)', panelEdge: 'rgba(255,255,255,0.58)',
  ink: '#2D2D2B', inkSoft: '#7A776D', inkFaint: '#9C998F',
  accent: '#B8952F', accentRgb: '184,149,47',
  star: '#D4A828', starEmpty: 'rgba(45,45,43,0.14)',
  chipBg: 'rgba(255,255,255,0.62)', chipInk: '#2D2D2B',
  ph1: '#F2F0EA', ph2: '#E4E0D5', borderRgb: '255,255,255',
  decoRgb: '255,255,255'
};
const THEMES = {
  pinkBlue: Object.assign({ id: 'pinkBlue', name: '粉蓝', bgTop: '#FDECEC', bgBot: '#D2F1FE' }, INK),
  goldSand: Object.assign({ id: 'goldSand', name: '暖金', bgTop: '#FEEFBF', bgBot: '#F8F3E7' }, INK),
  greenMist: Object.assign({ id: 'greenMist', name: '青雾', bgTop: '#E1E6D1', bgBot: '#EAF0F9' }, INK)
};

const DEFAULT_THEME = 'pinkBlue';
// swatch 给前端色点用：直接是 CSS 渐变串
const THEME_LIST = Object.keys(THEMES).map(k => ({ id: THEMES[k].id, name: THEMES[k].name, swatch: `linear-gradient(135deg, ${THEMES[k].bgTop}, ${THEMES[k].bgBot})` }));

// ============ 布局：三种模式（画布始终 3:4）============
//   n === 1        cover —— 海报满幅做背景 + 蒙版 + 悬浮文字（同「全网评分查询」详情）
//   n === 2 / 3    rows  —— 纵向排列：海报在左、文案在右
//   n >= 4         grid  —— 列数 = ⌈√n⌉ + 1（n 向上取完全平方数、开方后 +1）
//                          例：21 部 → ⌈√21⌉=5 → 列数=5+1=6 → 行数=⌈21/6⌉=4（6 列 4 行）
const WLADDER = { 1: 1080, 2: 1080, 3: 1160, 4: 1360, 5: 1560, 6: 1760, 7: 1960, 8: 2160, 9: 2360 };
const TEXTR = { 2: 0.56, 3: 0.42, 4: 0.48, 5: 0.52, 6: 0.56, 7: 0.58, 8: 0.60, 9: 0.62 }; // 文字区高 ÷ 单元格宽

function gridColsFor(n) {
  return Math.ceil(Math.sqrt(n)) + 1;     // ⌈√n⌉ + 1；n=60 时最多 9 列
}

function modeFor(n) {
  if (n <= 1) return 'cover';
  if (n <= 3) return 'rows';
  return 'grid';
}

function computeLayout(count) {
  const n = Math.max(1, count | 0);
  const mode = modeFor(n);
  const cols = mode === 'grid' ? gridColsFor(n) : 1;
  const W = mode === 'grid' ? (WLADDER[cols] || 1080) : 1080;
  const H = Math.round(W * 4 / 3);
  const M = 0;                            // 满幅：无外边框
  const PAD = Math.round(W * 0.032);      // 内容留白（更收窄）

  if (mode === 'cover') {
    return { mode, W, H, M, PAD, cols: 1, rows: 1, n };
  }

  const HEADER = Math.round(W * 0.155);   // 顶部标题区高度
  const FOOTER = Math.round(W * 0.064);   // 内容区底 → 画布底
  const innerW = W - 2 * M - 2 * PAD;
  const areaTop = M + PAD + HEADER;
  const areaBottom = H - M - PAD - FOOTER;
  const availH = areaBottom - areaTop;

  if (mode === 'rows') {
    return { mode, W, H, M, PAD, HEADER, FOOTER, innerW, areaTop, areaBottom, availH, cols: 1, rows: n, n };
  }

  // grid
  const rows = Math.ceil(n / cols);
  const COLGAP = Math.round(W * 0.024);
  const ROWGAP = Math.round(W * 0.030);
  let cellW = Math.floor((innerW - (cols - 1) * COLGAP) / cols);
  let posterH = Math.round(cellW * 1.44);
  let textH = Math.round(cellW * (TEXTR[cols] || 0.5));
  let gridH = rows * (posterH + textH) + (rows - 1) * ROWGAP;
  if (gridH > availH) {                    // 行太多超出：整体等比缩小以塞进 3:4
    const k = availH / gridH;
    posterH = Math.round(posterH * k);
    textH = Math.round(textH * k);
    cellW = Math.round(cellW * k);
    gridH = availH;
  }
  const scale = clamp(cellW / 300, 0.6, 1.25);
  return { mode, W, H, M, PAD, HEADER, FOOTER, COLGAP, ROWGAP, cols, rows, cellW, posterH, textH, gridH, innerW, areaTop, areaBottom, availH, scale, n };
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function tidy(v) { const x = Number(v); return Number.isFinite(x) ? String(Math.round(x * 10) / 10) : ''; }

// ============ 分区版式（按月份 / 按评分）：年度观影总结长图 ============
//   画布宽固定 1280，高随内容伸展（下限 3:4，上限 3.5 倍宽——超出先加列、再整体缩小）。
//   每段：左侧标签栏（月份：两位月号/中文月/英文缩写；评分：星级数/星星/力荐…），右侧封面网格（封面 + 单行片名）。
//   参考小红书「年度阅读总结」长图的排版。
const MONTH_CN = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];
const MONTH_EN = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const RATING_LABEL = { 5: '力荐', 4: '推荐', 3: '还行', 2: '较差', 1: '很差', 0: '未评分' };
const SECTION_W = 1280;

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

function computeSectionLayout(groups, n) {
  const W = SECTION_W;
  const s = W / 1080;
  const PAD = Math.round(W * 0.06);
  const labelW = Math.round(150 * s);
  const HEADER = Math.round(330 * s);
  const FOOTER = Math.round(120 * s);
  const minH = Math.round(W * 4 / 3);
  const maxH = Math.round(W * 3.5);

  const baseCols = n <= 6 ? 3 : n <= 12 ? 4 : n <= 24 ? 5 : 6;
  const build = (cols, k) => {
    const gap = Math.round(24 * s * k);
    const gridW = W - 2 * PAD - labelW;
    const cellW = Math.floor((gridW - (cols - 1) * gap) / cols * k);   // k<1：缩格，网格靠左不铺满
    const coverH = Math.round(cellW * 1.44);
    const titleH = Math.round(58 * s * k);
    const rowGap = Math.round(30 * s * k);
    const secPad = Math.round(46 * s * k);
    let y = HEADER;
    const secs = groups.map(g => {
      const rows = Math.ceil(g.movies.length / cols);
      const h = secPad * 2 + rows * (coverH + titleH) + (rows - 1) * rowGap;
      const sec = Object.assign({}, g, { rows, top: y, h });
      y += h;
      return sec;
    });
    const contentH = y + FOOTER;
    return { W, s, PAD, labelW, HEADER, FOOTER, cols, gap, cellW, coverH, titleH, rowGap, secPad, secs, contentH };
  };

  // 内容过高：先加列（最多 8 列），仍超则整体缩小格子
  let L = build(baseCols, 1);
  for (let cols = baseCols + 1; L.contentH > maxH && cols <= 8; cols++) L = build(cols, 1);
  if (L.contentH > maxH) {
    // 分区高度各项都随 k 线性缩放，一次即可逼近上限
    const k = (maxH - HEADER - FOOTER) / (L.contentH - HEADER - FOOTER);
    L = build(L.cols, k);
  }
  L.H = Math.max(minH, L.contentH);
  L.n = n;
  return L;
}

function computeMonthLayout(movies) {
  const list = (movies || []).slice(0, 60);
  const L = computeSectionLayout(groupByMonth(list), Math.max(1, list.length));
  L.mode = 'month';
  return L;
}

function computeRatingLayout(movies) {
  const list = (movies || []).slice(0, 60);
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
  const list = (movies || []).slice(0, 60);
  const W = SECTION_W;
  const s = W / 1080;
  const PAD = Math.round(W * 0.06);
  const HEADER = Math.round(330 * s);
  const FOOTER = Math.round(120 * s);
  const minH = Math.round(W * 4 / 3);
  const { year, month } = calendarMonthOf(list);
  const days = year && month ? new Date(year, month, 0).getDate() : 30;
  const firstDow = year && month ? (new Date(year, month - 1, 1).getDay() + 6) % 7 : 0;   // 周一=0
  const rows = Math.ceil((firstDow + days) / 7);
  const gap = Math.round(12 * s);
  const cellW = Math.floor((W - 2 * PAD - 6 * gap) / 7);
  const cellH = Math.round(cellW * 1.36);
  const wdH = Math.round(56 * s);
  const gridTop = HEADER + Math.round(16 * s) + wdH;
  const contentH = gridTop + rows * cellH + (rows - 1) * gap + Math.round(40 * s) + FOOTER;
  const byDay = {};
  list.forEach(m => {
    const d = Number(String(m.date || '').split('-')[2]) || 0;
    if (!d) return;
    (byDay[d] = byDay[d] || []).push(m);
  });
  return { mode: 'calendar', W, s, PAD, HEADER, FOOTER, year, month, days, firstDow, rows, gap, cellW, cellH, wdH, gridTop, byDay, contentH, H: Math.max(minH, contentH), n: list.length };
}

class MoviePosterDrawer {
  constructor(canvas, ctx, width, height) {
    this.canvas = canvas;
    this.ctx = ctx;
    this.w = width;
    this.h = height;
  }

  static computeSize(count) {
    const l = computeLayout(count);
    return { width: l.W, height: l.H, cols: l.cols };
  }

  // 长图类版式（month / rating / calendar）的画布尺寸：高随内容变，需要拿到 movies（含 date / rating）
  static computeLayoutSize(layout, movies) {
    if (!movies || !movies.length) return { width: SECTION_W, height: Math.round(SECTION_W * 4 / 3), cols: 1 };
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
    this.covers = coverNodes || {};
    const ctx = this.ctx;
    const d = data || {};
    const movies = (d.movies || []).slice(0, 60);
    this.customTitle = String(d.customTitle || '').trim().slice(0, 20);
    this.periodLead = String(d.periodLead || '');   // 「2026年度」/「2026年6月」，有则长图标题不再从日期推

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
    // 满幅：内容直接落在渐变背景上，无面板卡片 / 无内外边框

    // 头部（顶部居中）
    this._drawHeader(L.M + L.PAD, L.M + L.PAD, this.w - 2 * (L.M + L.PAD),
      this.customTitle ? Object.assign({}, d, { title: this.customTitle }) : d);

    if (L.mode === 'rows') {
      this._drawRows(movies, L);
    } else {
      // 网格：竖向在中间区域居中；末行不足整行居中
      const n = movies.length;
      const gridTop = L.areaTop + Math.max(0, Math.round((L.availH - L.gridH) / 2));
      movies.forEach((m, i) => {
        const row = Math.floor(i / L.cols);
        const col = i % L.cols;
        const inRow = Math.min(L.cols, n - row * L.cols);
        const rowW = inRow * L.cellW + (inRow - 1) * L.COLGAP;
        const rowLeft = Math.round((this.w - rowW) / 2);
        const x = rowLeft + col * (L.cellW + L.COLGAP);
        const y = gridTop + row * (L.posterH + L.textH + L.ROWGAP);
        this._drawTile(x, y, L.cellW, L.posterH, L.textH, m, L.cols, L.scale);
      });
    }

    // 署名（底部居中，纯文字）
    this._drawWatermark(this.w / 2, this.h - L.M - L.PAD - L.FOOTER / 2 + 8);
  }

  // ============ 背景 / 面板 ============
  _drawBackground(opts) {
    const ctx = this.ctx, w = this.w, h = this.h, C = this.C;
    const g = ctx.createLinearGradient(0, 0, w * 0.4, h);
    g.addColorStop(0, C.bgTop);
    g.addColorStop(1, C.bgBot);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    // 大淡光晕
    const rg = ctx.createRadialGradient(w * 0.82, h * 0.12, 40, w * 0.82, h * 0.12, w * 0.6);
    rg.addColorStop(0, this._rgba(C.decoRgb, C.isDark ? 0.10 : 0.14));
    rg.addColorStop(1, this._rgba(C.decoRgb, 0));
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, w, h);

    // 细颗粒质感（稀疏点）
    ctx.fillStyle = this._rgba(C.decoRgb, C.isDark ? 0.05 : 0.06);
    const step = 46;
    for (let y = 40; y < h; y += step) {
      for (let x = 40 + ((y / step) % 2) * (step / 2); x < w; x += step) {
        ctx.beginPath();
        ctx.arc(x, y, 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // 四角闪光点缀（按月份长图的标题贴右上角，不放）
    if (opts && opts.noSparkle) return;
    this._sparkle(w - 120, 150, 20, this._rgba(C.decoRgb, 0.5));
    this._sparkle(96, h - 150, 15, this._rgba(C.decoRgb, 0.4));
  }

  _drawPanel(x, y, w, h) {
    const ctx = this.ctx, C = this.C;
    ctx.save();
    ctx.shadowColor = C.isDark ? 'rgba(0,0,0,0.5)' : 'rgba(60,48,30,0.18)';
    ctx.shadowBlur = 48;
    ctx.shadowOffsetY = 22;
    this._roundRectPath(x, y, w, h, 40);
    ctx.fillStyle = C.panel;
    ctx.fill();
    ctx.restore();
    // 内描边
    this._roundRectPath(x + 3, y + 3, w - 6, h - 6, 37);
    ctx.lineWidth = 2;
    ctx.strokeStyle = C.panelEdge;
    ctx.stroke();
  }

  // ============ 头部 ============
  _drawHeader(x, top, w, d) {
    const ctx = this.ctx, C = this.C;
    const cx = x + w / 2;
    const s = this.w / 1080;   // 随画布放大
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';

    // 眉标（小号金色）
    ctx.font = `600 ${Math.round(20 * s)}px sans-serif`;
    ctx.fillStyle = C.accent;
    ctx.fillText('· MY MOVIE DIARY ·', cx, top + Math.round(42 * s));

    // 主标题（收小、衬线）
    ctx.font = `700 ${Math.round(44 * s)}px serif`;
    ctx.fillStyle = C.ink;
    ctx.fillText(this._truncate(d.title || '我的观影记录', w), cx, top + Math.round(98 * s));

    // 短下划线
    const ulW = Math.round(56 * s);
    this._roundRectPath(cx - ulW / 2, top + Math.round(116 * s), ulW, Math.round(4 * s), 2);
    ctx.fillStyle = C.accent;
    ctx.fill();

    // 副标题
    ctx.font = `500 ${Math.round(23 * s)}px sans-serif`;
    ctx.fillStyle = C.inkSoft;
    let sub = d.subtitle || '';
    if (d.avgText) sub = sub ? `${sub} · ${d.avgText}` : d.avgText;
    if (sub) ctx.fillText(this._truncate(sub, w), cx, top + Math.round(156 * s));
    ctx.textAlign = 'left';
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
      ctx.fillText('🎬', w / 2, h * 0.36);
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    }

    // 2a) 品牌暖色斜向 tint（对齐 category 封面 .cover-tint.daily-movie；降透明度，不盖住海报本色）
    const tint = ctx.createLinearGradient(0, 0, w, h);
    tint.addColorStop(0, 'rgba(208,132,104,0.30)');
    tint.addColorStop(1, 'rgba(168,94,68,0.30)');
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
    const titleLines = this._wrapLines(m.title || '未命名电影', tw, 2);
    const dirText = m.director ? ('导演 ' + m.director) : '';
    const genres = (m.genres || []).slice(0, 4);
    const hasDG = !!(dirText || genres.length);        // 导演 + 类型（同一行）
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
    // 导演 + 类型（同一行：导演文字在左，类型胶囊紧随其后）
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

  // ============ 长图公共头部：标题 + 发丝线 + 三格统计（N 部 / 平均分 / 观影日） ============
  //   titleLead：默认标题前缀（「2026年度」/「2026年6月」），后接强调色「观影」+「总结」；
  //   有自定义标题则整句用正文色画出（自适应缩字号，保证一行放下）。
  _drawSummaryHeader(movies, L, titleLead) {
    const ctx = this.ctx, C = this.C, s = L.s, W = L.W;
    const innerW = W - 2 * L.PAD;
    const hair = this._rgba(C.isDark ? '255,255,255' : '42,38,32', C.isDark ? 0.14 : 0.12);
    const hline = y => {
      ctx.fillStyle = hair;
      ctx.fillRect(L.PAD, y, innerW, Math.max(1, Math.round(1.5 * s)));
    };

    const titleY = L.PAD + Math.round(92 * s);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    if (this.customTitle) {
      let fs = Math.round(66 * s);
      ctx.font = `700 ${fs}px serif`;
      while (fs > Math.round(40 * s) && ctx.measureText(this.customTitle).width > innerW) {
        fs -= 2; ctx.font = `700 ${fs}px serif`;
      }
      ctx.fillStyle = C.ink;
      ctx.fillText(this._truncate(this.customTitle, innerW), L.PAD, titleY);
    } else {
      ctx.font = `700 ${Math.round(66 * s)}px serif`;
      let tx = L.PAD;
      [[titleLead, C.ink], ['观影', C.accent], ['总结', C.ink]].forEach(([t, color]) => {
        if (!t) return;
        ctx.fillStyle = color;
        ctx.fillText(t, tx, titleY);
        tx += ctx.measureText(t).width;
      });
    }
    hline(titleY + Math.round(48 * s));

    // 三格统计：N 部 / 平均分 / 观影日；全部未评分时中间格改成活跃月
    const rated = movies.filter(m => Number(m.rating) > 0);
    const days = [];
    const months = [];
    movies.forEach(m => {
      if (m.date && days.indexOf(m.date) < 0) days.push(m.date);
      const ym = ymOf(m).ym;
      if (ym && months.indexOf(ym) < 0) months.push(ym);
    });
    const stats = [{ num: String(movies.length), label: '部' }];
    if (!movies.length) {
      stats.push({ num: '–', label: '平均分' });
    } else if (rated.length) {
      const avg = rated.reduce((a, m) => a + Number(m.rating), 0) / rated.length;
      stats.push({ num: (avg * 2).toFixed(1), label: '平均分' });
    } else {
      stats.push({ num: String(months.length), label: '活跃月' });
    }
    stats.push({ num: String(days.length), label: '观影日' });

    const statTop = titleY + Math.round(48 * s);
    const statH = Math.round(112 * s);
    const statBase = statTop + Math.round(74 * s);
    const cellW = innerW / 3;
    stats.forEach((st, i) => {
      ctx.font = `700 ${Math.round(54 * s)}px serif`;
      const nw = ctx.measureText(st.num).width;
      ctx.font = `500 ${Math.round(24 * s)}px sans-serif`;
      const lw = ctx.measureText(st.label).width;
      const gap = Math.round(10 * s);
      const x0 = L.PAD + cellW * i + (cellW - nw - gap - lw) / 2;
      ctx.font = `700 ${Math.round(54 * s)}px serif`;
      ctx.fillStyle = C.ink;
      ctx.fillText(st.num, x0, statBase);
      ctx.font = `500 ${Math.round(24 * s)}px sans-serif`;
      ctx.fillStyle = C.inkSoft;
      ctx.fillText(st.label, x0 + nw + gap, statBase);
      if (i > 0) {   // 竖向细分隔线
        ctx.fillStyle = hair;
        ctx.fillRect(Math.round(L.PAD + cellW * i), statTop + Math.round(26 * s), Math.max(1, Math.round(1.5 * s)), statH - Math.round(52 * s));
      }
    });
    hline(statTop + statH);
    return hline;
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
    const ctx = this.ctx, C = this.C, s = L.s, W = L.W;
    this._drawBackground({ noSparkle: true });
    const hline = this._drawSummaryHeader(movies, L, this.periodLead || this._yearLead(movies));

    const gridX = L.PAD + L.labelW;
    L.secs.forEach(sec => {
      const top = sec.top;
      const labelY = top + L.secPad + Math.round(78 * s);
      ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      if (sec.kind === 'month') {
        // 月号 / 中文月 / 英文缩写
        ctx.font = `700 ${Math.round(84 * s)}px serif`;
        ctx.fillStyle = C.ink;
        ctx.fillText(sec.month ? String(sec.month).padStart(2, '0') : '--', L.PAD, labelY);
        ctx.font = `500 ${Math.round(26 * s)}px sans-serif`;
        ctx.fillStyle = C.inkSoft;
        ctx.fillText(sec.month ? MONTH_CN[sec.month - 1] : '', L.PAD + Math.round(6 * s), labelY + Math.round(44 * s));
        ctx.font = `500 ${Math.round(21 * s)}px sans-serif`;
        ctx.fillStyle = C.inkFaint;
        ctx.fillText(sec.month ? MONTH_EN[sec.month - 1] : '', L.PAD + Math.round(6 * s), labelY + Math.round(80 * s));
      } else if (sec.level > 0) {
        // 星级数 / 星星行 / 力荐…
        ctx.font = `700 ${Math.round(84 * s)}px serif`;
        ctx.fillStyle = C.ink;
        ctx.fillText(String(sec.level), L.PAD, labelY);
        const ss = Math.round(18 * s), sg = Math.round(4 * s);
        this._drawStars(L.PAD + Math.round(4 * s), labelY + Math.round(22 * s), ss, sg, sec.level);
        ctx.font = `500 ${Math.round(22 * s)}px sans-serif`;
        ctx.fillStyle = C.inkFaint;
        ctx.fillText(RATING_LABEL[sec.level], L.PAD + Math.round(6 * s), labelY + Math.round(76 * s));
      } else {
        ctx.font = `700 ${Math.round(34 * s)}px serif`;
        ctx.fillStyle = C.inkSoft;
        ctx.fillText('未评分', L.PAD, labelY - Math.round(10 * s));
      }

      // 右栏：封面网格 + 单行片名
      sec.movies.forEach((m, i) => {
        const row = Math.floor(i / L.cols), col = i % L.cols;
        const x = gridX + col * (L.cellW + L.gap);
        const y = top + L.secPad + row * (L.coverH + L.titleH + L.rowGap);
        this._drawShadowCover(m, x, y, L.cellW, L.coverH, Math.round(6 * s), s);
        ctx.font = `500 ${Math.round(24 * s)}px sans-serif`;
        ctx.fillStyle = C.ink;
        ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
        ctx.fillText(this._truncate(m.title || '未命名电影', L.cellW + Math.round(8 * s)), x + L.cellW / 2, y + L.coverH + Math.round(38 * s));
        ctx.textAlign = 'left';
      });

      hline(top + sec.h);   // 每段收尾一条发丝线（末段的线兼作页脚上界）
    });

    this._drawWatermark(W / 2, L.H - L.FOOTER / 2);
  }

  // ============ 单月日历长图：周一起始，有观影的日子铺封面 ============
  _drawCalendarPoster(movies, L) {
    const ctx = this.ctx, C = this.C, s = L.s, W = L.W;
    this._drawBackground({ noSparkle: true });
    const lead = this.periodLead || (L.year && L.month ? `${L.year}年${L.month}月` : this._yearLead(movies));
    this._drawSummaryHeader(movies, L, lead);

    // 星期表头
    const WD = ['一', '二', '三', '四', '五', '六', '日'];
    const wdY = L.gridTop - L.wdH / 2;
    ctx.font = `500 ${Math.round(24 * s)}px sans-serif`;
    ctx.fillStyle = C.inkSoft;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    WD.forEach((t, i) => ctx.fillText(t, L.PAD + i * (L.cellW + L.gap) + L.cellW / 2, wdY));
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';

    const r = Math.round(10 * s);
    const emptyFill = this._rgba(C.isDark ? '255,255,255' : '42,38,32', C.isDark ? 0.05 : 0.04);
    const emptyEdge = this._rgba(C.isDark ? '255,255,255' : '42,38,32', C.isDark ? 0.10 : 0.08);
    for (let d = 1; d <= L.days; d++) {
      const idx = L.firstDow + d - 1;
      const row = Math.floor(idx / 7), col = idx % 7;
      const x = L.PAD + col * (L.cellW + L.gap);
      const y = L.gridTop + row * (L.cellH + L.gap);
      const list = L.byDay[d];
      if (!list || !list.length) {
        // 空白日：淡底 + 细边 + 居中日号
        this._roundRectPath(x, y, L.cellW, L.cellH, r);
        ctx.fillStyle = emptyFill; ctx.fill();
        ctx.lineWidth = Math.max(1, Math.round(1.2 * s));
        ctx.strokeStyle = emptyEdge; ctx.stroke();
        ctx.font = `500 ${Math.round(26 * s)}px serif`;
        ctx.fillStyle = C.inkFaint;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(String(d), x + L.cellW / 2, y + L.cellH / 2);
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
        continue;
      }
      // 观影日：首部封面铺满 + 底部渐变压片名 + 左上日号胶囊（多部时右上「+N」）
      const m = list[0];
      this._drawShadowCover(m, x, y, L.cellW, L.cellH, r, s);
      ctx.save();
      this._roundRectPath(x, y, L.cellW, L.cellH, r);
      ctx.clip();
      const gh = Math.round(L.cellH * 0.42);
      const g = ctx.createLinearGradient(0, y + L.cellH - gh, 0, y + L.cellH);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.72)');
      ctx.fillStyle = g;
      ctx.fillRect(x, y + L.cellH - gh, L.cellW, gh);
      ctx.font = `600 ${Math.round(20 * s)}px sans-serif`;
      ctx.fillStyle = '#FFFFFF';
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      ctx.fillText(this._truncate(m.title || '未命名电影', L.cellW - Math.round(12 * s)), x + L.cellW / 2, y + L.cellH - Math.round(12 * s));
      ctx.textAlign = 'left';
      ctx.restore();
      const pad = Math.round(6 * s);
      const cs = 0.62 * s;
      this._glassChip(x + pad, y + pad, String(d), cs);
      if (list.length > 1) {
        ctx.font = `600 ${Math.round(26 * cs)}px sans-serif`;
        const t = `+${list.length - 1}`;
        const cw = ctx.measureText(t).width + Math.round(40 * cs);
        this._glassChip(x + L.cellW - pad - cw, y + pad, t, cs);
      }
    }

    this._drawWatermark(W / 2, L.H - L.FOOTER / 2);
  }

  // ============ 空态：范围内没有观影记录 ============
  _drawEmptyPoster() {
    const ctx = this.ctx, C = this.C;
    const W = this.w, s = W / 1080;
    const L = { s, W, PAD: Math.round(W * 0.06) };
    this._drawBackground({ noSparkle: true });
    this._drawSummaryHeader([], L, this.periodLead);
    ctx.font = `500 ${Math.round(30 * s)}px sans-serif`;
    ctx.fillStyle = C.inkFaint;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('这段时间还没有观影记录', W / 2, this.h * 0.5);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    this._drawWatermark(W / 2, this.h - Math.round(60 * s));
  }

  // 带阴影的圆角封面（长图版式共用）
  _drawShadowCover(m, x, y, w, h, r, s) {
    const ctx = this.ctx, C = this.C;
    ctx.save();
    ctx.shadowColor = C.isDark ? 'rgba(0,0,0,0.45)' : 'rgba(60,48,30,0.20)';
    ctx.shadowBlur = Math.round(18 * s);
    ctx.shadowOffsetY = Math.round(8 * s);
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
    const ctx = this.ctx, C = this.C;
    const s = this.w / 1080;
    const posterW = Math.min(Math.round(w * 0.40), Math.round((h - 8) / 1.44));
    const posterH = Math.round(posterW * 1.44);
    const px = x, py = y + Math.round((h - posterH) / 2);

    ctx.save();
    ctx.shadowColor = C.isDark ? 'rgba(0,0,0,0.5)' : 'rgba(60,48,30,0.22)';
    ctx.shadowBlur = 24; ctx.shadowOffsetY = 12;
    this._roundRectPath(px, py, posterW, posterH, Math.round(18 * s));
    ctx.fillStyle = C.ph2; ctx.fill();
    ctx.restore();
    this._drawCover(this.covers[m.key], px, py, posterW, posterH, Math.round(18 * s), m.title);

    const gap = Math.round(w * 0.05);
    const tx = px + posterW + gap;
    const tw = w - posterW - gap;
    let ty = py + Math.round(56 * s);

    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.font = `700 ${Math.round(46 * s)}px serif`;
    ctx.fillStyle = C.ink;
    ty = this._wrapText(m.title || '未命名电影', tx, ty, tw, Math.round(54 * s), 2) + Math.round(30 * s);

    ctx.font = `500 ${Math.round(26 * s)}px sans-serif`;
    ctx.fillStyle = C.inkSoft;
    let dl = m.dateLabel || '';
    if (m.year) dl = dl ? `${dl} · ${m.year}` : String(m.year);
    if (dl) { ctx.fillText(this._truncate(dl, tw), tx, ty); ty += Math.round(48 * s); }

    if (Number(m.rating) > 0) {
      const ss = Math.round(34 * s), sg = Math.round(7 * s);
      this._drawStars(tx, ty - ss + Math.round(6 * s), ss, sg, m.rating);
      ctx.font = `600 ${Math.round(28 * s)}px sans-serif`;
      ctx.fillStyle = C.accent; ctx.textBaseline = 'middle';
      ctx.fillText(tidy(Number(m.rating) * 2), tx + 5 * (ss + sg) + Math.round(16 * s), ty - ss / 2 + Math.round(6 * s));
      ctx.textBaseline = 'alphabetic';
      ty += Math.round(42 * s);
    }

    if (m.moodEmoji || m.moodLabel) {
      const t = `${m.moodEmoji || ''}${m.moodLabel ? ' ' + m.moodLabel : ''}`.trim();
      this._chip(tx, ty, t, s);
      ty += Math.round(46 * s) + Math.round(26 * s);
    }

    if (m.note) {
      ctx.font = `400 ${Math.round(26 * s)}px sans-serif`;
      ctx.fillStyle = C.inkSoft;
      ty = this._wrapText(`「${m.note}」`, tx, ty, tw, Math.round(38 * s), 3) + Math.round(18 * s);
    }

    if (m.platformRatings && m.platformRatings.length) {
      let chx = tx;
      const chy = Math.min(ty, py + posterH - Math.round(46 * s));
      m.platformRatings.slice(0, 4).forEach(p => { chx = this._chip(chx, chy, `${p.label} ${p.value}`, 0.82) + Math.round(12 * s); });
    }
  }

  // ============ 单部电影（网格单元） ============
  _drawTile(x, y, cellW, posterH, textH, m, cols, scale) {
    const ctx = this.ctx, C = this.C;
    // 封面 + 阴影
    ctx.save();
    ctx.shadowColor = C.isDark ? 'rgba(0,0,0,0.45)' : 'rgba(60,48,30,0.22)';
    ctx.shadowBlur = 22;
    ctx.shadowOffsetY = 12;
    this._roundRectPath(x, y, cellW, posterH, 16);
    ctx.fillStyle = C.ph2;
    ctx.fill();
    ctx.restore();
    this._drawCover(this.covers[m.key], x, y, cellW, posterH, 16, m.title);

    // 文字区
    const tx = x;
    let ty = y + posterH + (cols >= 3 ? 34 : 44);
    const rich = cols <= 2;

    // 标题
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    const titleSize = Math.round(38 * scale);
    ctx.font = `700 ${titleSize}px sans-serif`;
    ctx.fillStyle = C.ink;
    let titleStr = m.title || '未命名电影';
    if (m.year && rich) titleStr = `${titleStr}`;
    ctx.fillText(this._truncate(titleStr, cellW), tx, ty);
    ty += Math.round(titleSize * 0.62);

    // 日期（+年份）
    const metaSize = Math.round(25 * scale);
    ctx.font = `500 ${metaSize}px sans-serif`;
    ctx.fillStyle = C.inkSoft;
    let dateLine = m.dateLabel || '';
    if (m.year) dateLine = dateLine ? `${dateLine} · ${m.year}` : String(m.year);
    ctx.fillText(this._truncate(dateLine, cellW), tx, ty + metaSize);
    ty += metaSize + Math.round(20 * scale);

    // 星级 + 分数
    const starSize = Math.round(30 * scale);
    const starGap = Math.round(6 * scale);
    if (Number(m.rating) > 0) {
      this._drawStars(tx, ty, starSize, starGap, m.rating);
      if (rich) {
        ctx.font = `600 ${Math.round(24 * scale)}px sans-serif`;
        ctx.fillStyle = C.accent;
        ctx.textBaseline = 'middle';
        ctx.fillText(`${tidy(Number(m.rating) * 2)}`, tx + 5 * (starSize + starGap) + 16, ty + starSize / 2);
        ctx.textBaseline = 'alphabetic';
      }
      ty += starSize + Math.round(20 * scale);
    } else if (rich) {
      ctx.font = `500 ${Math.round(23 * scale)}px sans-serif`;
      ctx.fillStyle = C.inkFaint;
      ctx.fillText('未评分', tx, ty + starSize * 0.72);
      ty += starSize + Math.round(20 * scale);
    }

    // 心情
    if (m.moodEmoji || m.moodLabel) {
      const moodTxt = `${m.moodEmoji || ''}${m.moodLabel ? ' ' + m.moodLabel : ''}`.trim();
      if (cols <= 3) {
        this._chip(tx, ty, moodTxt, scale);
        ty += Math.round(46 * scale) + Math.round(16 * scale);
      }
    }

    // 短评（仅 1~2 列，且有内容时）
    if (rich && m.note) {
      const noteSize = Math.round(25 * scale);
      ctx.font = `400 ${noteSize}px sans-serif`;
      ctx.fillStyle = C.inkSoft;
      const maxLines = cols === 1 ? 4 : 2;
      this._wrapText(`「${m.note}」`, tx, ty + noteSize, cellW, noteSize + 10, maxLines);
    }

    // 平台评分（仅 hero）
    if (cols === 1 && m.platformRatings && m.platformRatings.length) {
      const chips = m.platformRatings.slice(0, 4);
      let chx = tx;
      const chy = y + posterH + textH - 44;
      chips.forEach(p => { chx = this._chip(chx, chy, `${p.label} ${p.value}`, 0.86) + 14; });
    }
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
      ctx.fillText('🎬', x + w / 2, y + h / 2 - h * 0.04);
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
  _chip(x, y, text, scale) {
    const ctx = this.ctx, C = this.C;
    const fs = Math.round(24 * scale);
    const h = Math.round(46 * scale);
    const padX = Math.round(18 * scale);
    ctx.font = `500 ${fs}px sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const tw = ctx.measureText(text).width;
    const w = padX * 2 + tw;
    this._roundRectPath(x, y, w, h, h / 2);
    ctx.fillStyle = C.chipBg;
    ctx.fill();
    ctx.fillStyle = C.chipInk;
    ctx.fillText(text, x + padX, y + h / 2 + 1);
    ctx.textBaseline = 'alphabetic';
    return x + w;
  }

  // 逐字换行，最多 maxLines 行，末行超出加省略号；返回最后一行的基线 y
  _wrapText(text, x, y, maxW, lineH, maxLines) {
    const ctx = this.ctx;
    const chars = String(text).split('');
    let line = '';
    let lines = 0;
    for (let i = 0; i < chars.length; i++) {
      const test = line + chars[i];
      if (ctx.measureText(test).width > maxW && line) {
        if (lines === maxLines - 1) {
          let t = line;
          while (t && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
          ctx.fillText(t + '…', x, y);
          return y;
        }
        ctx.fillText(line, x, y);
        line = chars[i];
        y += lineH;
        lines++;
      } else {
        line = test;
      }
    }
    if (line) ctx.fillText(line, x, y);
    return y;
  }

  // 折行为字符串数组：先按用户输入的换行符 `\n` 分段（保留手动换行/空行），
  // 再按宽度折行；最多 maxLines 行，被截断时末行加省略号。需先设好 ctx.font。
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
    const text = '小程序标记吧，制作同款图';
    // 署名是次要信息：压低不透明度 + 减一档字重，并微微偏暖（呼应品牌暖色 tint），
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
    ctx.fillStyle = 'rgba(240,196,176,0.72)';   // 暖色圆点，弱于正文
    ctx.fill();
    ctx.fillStyle = 'rgba(255,246,242,0.62)';   // 暖白、半透，安静地退到背景里
    ctx.fillText(text, x + lead, cy + 1);
    this._shadowOff();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  _drawWatermark(cx, cy) {
    const ctx = this.ctx, C = this.C;
    const text = '小程序标记吧，制作同款图';
    ctx.font = '600 26px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const tw = ctx.measureText(text).width;
    const dotR = 5, lead = dotR * 2 + 14, padX = 24, tagH = 50;
    const tagW = padX + lead + tw + padX;
    const x = cx - tagW / 2;
    this._roundRectPath(x, cy - tagH / 2, tagW, tagH, tagH / 2);
    ctx.fillStyle = this._rgba(C.decoRgb, C.isDark ? 0.12 : 0.10);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x + padX + dotR, cy, dotR, 0, Math.PI * 2);
    ctx.fillStyle = C.accent;
    ctx.fill();
    ctx.fillStyle = C.inkSoft;
    ctx.fillText(text, x + padX + lead, cy + 1);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  // ============ 工具 ============
  _sparkle(cx, cy, r, color) {
    const ctx = this.ctx;
    const inner = r * 0.32;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const rad = i % 2 === 0 ? r : inner;
      const a = -Math.PI / 2 + i * Math.PI / 4;
      const px = cx + Math.cos(a) * rad;
      const py = cy + Math.sin(a) * rad;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }

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

module.exports = MoviePosterDrawer;
