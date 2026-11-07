// 版式 · 票夹（范围，月度默认）。2026-11 按小票定下来的方向重做：渐变底 + 放映机光柱打在标题上（公共部分在 rangeTheme.js），
// 去掉 MARKED、编号、观影日 / 平均分、最爱章和票根歪斜，字只留片名、日期、星级。
// 票根是实物，所以每张带投影和齿孔缺口；固定 3:4（小红书信息流的比例）：张数越多列越多、票越小，列数按「票能最大」算。
// 最多 60 张，放不下时挑星级高的，底部写「还有 N 张没夹进来」。env.palette 配色。油墨字只有小票有，票夹不支持。
const kit = require('../kit.js');
const text = require('../text.js');
const { topPicks } = require('../model.js');
const { W, HEAD_H, BEAM_BOTTOM, resolvePalette, grain, fillPage, drawBeam, drawHeader, lensOf } = require('./rangeTheme.js');

const H = 1440;
const MAX_TICKETS = 60;
const SIDE = 72;                                // 票夹左右最小留白
const TOP = 72;                                 // 抬头上沿
const GRID_TOP = TOP + HEAD_H + 16;
const GRID_BOTTOM = H - 92;                     // 署名上方
const MORE_H = 44;
const MAX_TICKET_W = 290;
const TITLE_FROM = 150;                         // 票宽够这么多才写片名
const STARS_FROM = 84;                          // 票宽够这么多才画星星

function supports(kind) { return kind === 'range'; }

function picks(model) { return topPicks(model.films, MAX_TICKETS); }

function coverFilms(model) { return picks(model); }

function measure() { return { width: W, height: H }; }

/** 一张票各段的高度（都随票宽走） */
function ticketParts(w) {
  const pad = Math.round(w * 0.07);
  const coverW = w - 2 * pad, coverH = Math.round(coverW * 1.42);
  const below = Math.round(w * 0.03), perf = Math.max(14, Math.round(w * 0.1));
  const stub = Math.round(w * (w >= TITLE_FROM ? 0.42 : 0.44));
  return { w, pad, coverW, coverH, below, perf, stub, h: pad + coverH + below + perf + stub };
}

/** 这样排的整块高度（gap 随票宽走，票小了缝也窄） */
function gapOf(w) { return Math.round(Math.max(14, w * 0.14)); }

/** 试每种列数，取票最大的那种。票高随宽度不是连续的（够宽才写片名），所以从大往小一格格试 */
function geometry(count, areaH) {
  const areaW = W - 2 * SIDE;
  const n = Math.max(1, count);
  let best = null;
  for (let cols = 1; cols <= Math.min(n, 10); cols++) {
    const rows = Math.ceil(n / cols);
    let w = MAX_TICKET_W;
    const fits = v => cols * v + (cols - 1) * gapOf(v) <= areaW && rows * ticketParts(v).h + (rows - 1) * gapOf(v) <= areaH;
    while (w > 40 && !fits(w)) w--;
    // 票差不多大时，选最后一行空位少的（排满最整齐），再一样就选更宽的
    const empty = cols * rows - n;
    const close = best && Math.abs(w - best.w) <= 4;
    if (!best || (w > best.w + 4) || (close && empty <= best.empty)) best = { cols, rows, w, gap: gapOf(w), empty };
  }
  const parts = ticketParts(best.w);
  const gridW = best.cols * best.w + (best.cols - 1) * best.gap;
  const gridH = best.rows * parts.h + (best.rows - 1) * best.gap;
  return Object.assign(best, { parts, gridW, gridH });
}

function drawPaper(ctx, x, y, t, P) {
  const r = Math.round(t.w * 0.06);
  const notchY = y + t.pad + t.coverH + t.below + t.perf / 2;
  const nr = Math.max(6, Math.round(t.w * 0.058));
  const path = () => kit.ticketPath(ctx, x, y, t.w, t.h, r, notchY, nr);
  // 两层投影：大而散的托起来，小而实的压住边
  kit.withShadow(ctx, { color: `rgba(${P.shadow},0.26)`, blur: Math.max(14, t.w * 0.16), y: Math.max(6, t.w * 0.06) }, 1, () => { path(); ctx.fillStyle = P.paper; ctx.fill(); });
  kit.withShadow(ctx, { color: `rgba(${P.shadow},0.24)`, blur: 4, y: 1 }, 1, () => { path(); ctx.fillStyle = P.paper; ctx.fill(); });
  kit.dashed(ctx, x + nr + 6, notchY, x + t.w - nr - 6, notchY, 2, P.paperFaint, 5, 5);
}

function drawStub(ctx, f, x, y, t, P, fontsReady) {
  const left = x + t.pad, right = x + t.w - t.pad;
  const top = y + t.h - t.stub;
  const numSize = Math.max(14, Math.min(21, Math.round(t.w * 0.088)));
  const starSize = Math.max(10, Math.min(18, Math.round(t.w * (t.w >= TITLE_FROM ? 0.07 : 0.1))));
  const gap = Math.max(1, Math.round(starSize * 0.16));
  const starsW = 5 * starSize + 4 * gap;
  const showStars = f.rating > 0 && t.w >= STARS_FROM;

  if (t.w >= TITLE_FROM) {
    // 大票：片名一行，下面日期靠左、星星靠右
    const line2 = top + t.stub * 0.68;
    ctx.fillStyle = P.paperInk;
    ctx.font = P.f(600 + P.fw, Math.max(17, Math.min(26, Math.round(t.w * 0.105))));
    ctx.fillText(text.ellipsis(f.title || '未命名电影', right - left, s => ctx.measureText(s).width), left, top + t.stub * 0.27);
    ctx.fillStyle = P.paperSoft;
    ctx.font = P.n(500 + P.fw, numSize, fontsReady);
    text.drawTabular(ctx, f.md, left, line2);
    if (showStars) kit.stars(ctx, right - starsW, line2 - starSize / 2, f.rating, starSize, gap, P.paperAccent, P.paperFaint);
    return;
  }
  // 小票：地方不够放片名，日期、星星上下排、居中
  const cx = x + t.w / 2;
  ctx.fillStyle = P.paperInk;
  ctx.font = P.n(600 + P.fw, numSize, fontsReady);
  const dateW = text.tabularWidth(ctx, f.md);
  text.drawTabular(ctx, f.md, cx - dateW / 2, top + t.stub * (showStars ? 0.34 : 0.5));
  if (showStars) kit.stars(ctx, cx - starsW / 2, top + t.stub * 0.7 - starSize / 2, f.rating, starSize, gap, P.paperAccent, P.paperFaint);
}

function draw(ctx, model, covers, env) {
  const e = env || {};
  const fontsReady = !!e.fontsReady;
  const P = resolvePalette({ palette: e.palette });
  const list = picks(model);
  const more = model.films.length - list.length;

  // 1. 渐变底
  fillPage(ctx, H, P);
  grain(ctx, 0, 0, W, H, 'page', P.speckA, P.speckB);

  // 2. 排票：抬头的左缘跟票对齐；票很少时（票夹比抬头窄太多）票居中，抬头用固定边距
  const areaH = GRID_BOTTOM - GRID_TOP - (more > 0 ? MORE_H : 0);
  const g = geometry(list.length, areaH);
  const left = Math.round((W - g.gridW) / 2);
  const x0 = left <= 200 ? left : 96, x1 = W - x0;
  // 票少时别悬在正中：离标题近一点，空白留给下面
  const gridY = Math.round(GRID_TOP + (areaH - g.gridH) * 0.3);

  drawBeam(ctx, lensOf(x0, TOP), Math.max(10, TOP - 64), TOP + BEAM_BOTTOM, W, P, model.ymDot);

  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';

  const count = String(model.stats.count);
  const title = model.customTitle || `${model.periodTitle}${model.mode === 'month' ? '' : ' 年'}的 ${count} 张电影票`;
  drawHeader(ctx, x0, x1, TOP, title, model.spanText, P, fontsReady, model.customTitle ? '' : count);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';

  // 3. 票根
  const t = g.parts;
  list.forEach((f, i) => {
    const row = Math.floor(i / g.cols);
    // 最后一行不满时居中
    const shift = row === g.rows - 1 ? g.empty * (t.w + g.gap) / 2 : 0;
    const x = Math.round(left + shift + (i % g.cols) * (t.w + g.gap));
    const y = gridY + row * (t.h + g.gap);
    drawPaper(ctx, x, y, t, P);
    kit.drawCover(ctx, (covers || {})[f.key] || null, x + t.pad, y + t.pad, t.coverW, t.coverH,
      { r: Math.round(t.w * 0.025), shadow: false, hairline: false, title: f.title });
    drawStub(ctx, f, x, y, t, P, fontsReady);
  });

  if (more > 0) {
    ctx.fillStyle = P.soft;
    ctx.font = P.f(500 + P.fw, 24);
    text.drawSpaced(ctx, `还有 ${more} 张没夹进来`, W / 2, GRID_BOTTOM - MORE_H / 2 + 4, 2, 'center');
  }

  // 4. 署名
  ctx.textBaseline = 'alphabetic';
  kit.watermark(ctx, W / 2, H - 44, 1, P.wm, P.accent, (w, size) => P.f(w + P.fw, size));
}

module.exports = { supports, coverFilms, measure, draw, geometry, ticketParts, MAX_TICKETS };
