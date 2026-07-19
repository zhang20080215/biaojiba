/**
 * 每日电影 · 观影记录分享海报绘制器
 *
 * 设计目标：以电影海报为视觉主体的「观影记录」分享图，审美高级、有分享欲。
 *   - 始终 3:4；最小 1080×1440，随所选电影数量整体等比放大（画布像素变大、排版更密）。
 *   - 外层渐变 + 细颗粒质感做「相框卡纸」，中间圆角面板承载「标题 + 电影网格 + 署名」。
 *   - 每部电影：封面 + 观看日期 + 评分(星) + 心情 + 短评，随数量分档展示（少而精 / 多而齐）。
 *
 * 用法：
 *   const { width, height } = MoviePosterDrawer.computeSize(movies.length);
 *   canvas.width = width; canvas.height = height;
 *   new MoviePosterDrawer(canvas, ctx, width, height).draw(data, coverNodes, themeId);
 *
 * data = {
 *   title:        '我的观影记录',
 *   subtitle:     '2026.03 - 2026.07 · 共 12 部',   // 一行副标题
 *   avgText:      '平均 8.6',                        // 可空
 *   movies: [{
 *     key, title, year, dateLabel:'7月13日',
 *     rating(0~5), moodEmoji, moodLabel, note,
 *     platformRatings:[{label,value}]
 *   }]
 * }
 * coverNodes = { [key]: ImageNode|null }   // 预加载好的封面（canvas.createImage），失败为 null → 占位
 */

// ============ 主题（含深色「影院」默认 + 3 套浅色） ============
const THEMES = {
  cinema: {
    id: 'cinema', name: '影院', swatch: '#E5B85C', isDark: true,
    bgTop: '#232833', bgBot: '#0D0F14',
    panel: '#1B1F29', panelEdge: 'rgba(229,184,92,0.16)',
    ink: '#F4EEDD', inkSoft: '#A79E86', inkFaint: '#6E6858',
    accent: '#E5B85C', accentRgb: '229,184,92',
    star: '#F1C453', starEmpty: 'rgba(244,238,221,0.18)',
    chipBg: 'rgba(229,184,92,0.12)', chipInk: '#E7CE97',
    ph1: '#2A2F3B', ph2: '#171A22', borderRgb: '229,184,92',
    decoRgb: '229,184,92'
  },
  noir: {
    id: 'noir', name: '午夜蓝', swatch: '#6FA8FF', isDark: true,
    bgTop: '#1C2740', bgBot: '#0A0F1C',
    panel: '#141C30', panelEdge: 'rgba(111,168,255,0.16)',
    ink: '#EAF1FC', inkSoft: '#96A6C6', inkFaint: '#5C6A88',
    accent: '#6FA8FF', accentRgb: '111,168,255',
    star: '#8CC0FF', starEmpty: 'rgba(234,241,252,0.16)',
    chipBg: 'rgba(111,168,255,0.14)', chipInk: '#AFCCFF',
    ph1: '#1E2942', ph2: '#0E1526', borderRgb: '111,168,255',
    decoRgb: '111,168,255'
  },
  cream: {
    id: 'cream', name: '奶油', swatch: '#B8873B', isDark: false,
    bgTop: '#FBF7EF', bgBot: '#EDE2CE',
    panel: '#FFFFFF', panelEdge: 'rgba(184,135,59,0.18)',
    ink: '#2A2620', inkSoft: '#8C8474', inkFaint: '#B7AE9B',
    accent: '#B8873B', accentRgb: '184,135,59',
    star: '#E0A93B', starEmpty: 'rgba(42,38,32,0.14)',
    chipBg: 'rgba(184,135,59,0.12)', chipInk: '#9A6F2E',
    ph1: '#EFE6D5', ph2: '#E2D6C0', borderRgb: '184,135,59',
    decoRgb: '184,135,59'
  },
  rose: {
    id: 'rose', name: '胭脂', swatch: '#E6738F', isDark: false,
    bgTop: '#FFF6F5', bgBot: '#F6E1E4',
    panel: '#FFFFFF', panelEdge: 'rgba(230,115,143,0.18)',
    ink: '#3A2A2E', inkSoft: '#9A7E86', inkFaint: '#C6AEB4',
    accent: '#E6738F', accentRgb: '230,115,143',
    star: '#EA8AA1', starEmpty: 'rgba(58,42,46,0.14)',
    chipBg: 'rgba(230,115,143,0.14)', chipInk: '#C25576',
    ph1: '#F7E3E7', ph2: '#EFD2D8', borderRgb: '230,115,143',
    decoRgb: '230,115,143'
  }
};

const DEFAULT_THEME = 'cinema';
const THEME_LIST = Object.keys(THEMES).map(k => ({ id: THEMES[k].id, name: THEMES[k].name, swatch: THEMES[k].swatch }));

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

  draw(data, coverNodes, themeId) {
    this.C = THEMES[themeId] || THEMES[DEFAULT_THEME];
    this.covers = coverNodes || {};
    const ctx = this.ctx;
    const d = data || {};
    const movies = (d.movies || []).slice(0, 60);
    const L = computeLayout(movies.length || 1);

    // cover 模式：海报即背景，独立走一套绘制（不画渐变底/头部/水印）
    if (L.mode === 'cover') {
      this._drawCoverHero(movies[0] || {}, L);
      return;
    }

    this._drawBackground();
    // 满幅：内容直接落在渐变背景上，无面板卡片 / 无内外边框

    // 头部（顶部居中）
    this._drawHeader(L.M + L.PAD, L.M + L.PAD, this.w - 2 * (L.M + L.PAD), d);

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
  _drawBackground() {
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
    // 四角闪光点缀
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
