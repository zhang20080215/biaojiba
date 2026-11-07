// 版式 · 观影小票（范围）。2026-11 反复改过：纯色单墨色显闷，用户更喜欢分享页原来的粉蓝渐变（#FDECEC → #D2F1FE）。
// 现在是：渐变铺满整张海报，字直接落在渐变上（用户看过真机后定的：不要卡片）+ 一个点缀色（星星、部数），放映机光柱打在标题上。
// 放映机 + 光柱 + 标题 → 表头 → 逐行「序号 日期 片名 ┄┄ 星级」（数字等宽对齐）→ TOTAL → 条码。
// 内容在画布上垂直居中；12 部正好 3:4，更多变长图，最多列 110 行，超出写「… 另 N 部」（画布高度上限 6000）。
// 始终单栏：试过按部数分两栏、三栏保 3:4，用户否了 —— 小票就该是一长条。
// 不用封面。两个选项互相独立：env.palette 配色，
// env.inked 油墨字（粗宋 + kit.inkEdge 压毛边，参考用户给的铅印字样）：字先画在离屏层上，压完贴回来；离屏层不可用就直接画，只是没有毛边。
// 「云霞」配色：白底，左上一团蓝光、右下一团粉光（参考用户给的「流光卡片」）。
const kit = require('../kit.js');
const text = require('../text.js');
const tint = require('../tint.js');
const { W, HEAD_H, BEAM_BOTTOM, PALETTE, PALETTE_LIST, DEFAULT_PALETTE, resolvePalette, grain, fillPage, drawBeam, drawHeader, lensOf } = require('./rangeTheme.js');

const MIN_H = 1440;
const X0 = 182, X1 = W - X0, INNER_W = X1 - X0;  // 内容左右边界
const PAD_BOTTOM = 12;
const CODE_GAP = 28;                            // TOTAL 下面的虚线到条码区的多留空白，结尾才收得住
const MARGIN = 104;                             // 内容上下最小留白
const MAX_ROWS = 110;
const COL_DATE = 56, COL_TITLE = 146;           // 日期、片名相对 X0 的位置
const STAR = 18, STAR_GAP = 4, STARS_W = 5 * STAR + 4 * STAR_GAP;
const ROW_MIN = 40, ROW_MAX = 50;
const DASH_H = 30, TH_H = 30, TOTAL_H = 54, CODE_H = 142;

function supports(kind) { return kind === 'range'; }

function coverFilms() { return []; }   // 不用封面

function layout(model) {
  const rows = model.films.slice(0, MAX_ROWS);
  const more = model.films.length - rows.length;

  const lines = rows.length + (more > 0 ? 1 : 0);
  const fixed = HEAD_H + DASH_H + TH_H + DASH_H + DASH_H + TOTAL_H + DASH_H + CODE_GAP + CODE_H + PAD_BOTTOM;
  const room = MIN_H - MARGIN - MARGIN - fixed;
  const rowH = Math.max(ROW_MIN, Math.min(ROW_MAX, Math.floor(room / Math.max(1, lines))));
  const contentH = fixed + lines * rowH;
  return { rows, more, rowH, contentH, height: Math.max(MIN_H, MARGIN + contentH + MARGIN) };
}

function measure(model) { return { width: W, height: layout(model).height }; }

function dashAt(ctx, y, P) {
  kit.dashed(ctx, X0, y + DASH_H / 2, X1, y + DASH_H / 2, 1.5, P.faint, 4, 5);
  return y + DASH_H;
}

function drawTableHead(ctx, y, P) {
  const mid = y + TH_H / 2;
  ctx.fillStyle = P.ink;
  ctx.font = P.f(600 + P.fw, 21);
  text.drawSpaced(ctx, '#', X0, mid, 0, 'left');
  text.drawSpaced(ctx, '日期', X0 + COL_DATE, mid, 3, 'left');
  text.drawSpaced(ctx, '片名', X0 + COL_TITLE, mid, 3, 'left');
  text.drawSpaced(ctx, '评分', X1, mid, 3, 'right');
  return y + TH_H;
}

function drawRows(ctx, rule, L, y, P, fontsReady) {
  const titleX = X0 + COL_TITLE;
  const starX = X1 - STARS_W;
  const titleMax = starX - 36 - titleX;
  L.rows.forEach((f, i) => {
    const mid = y + L.rowH / 2;
    ctx.fillStyle = P.soft;
    ctx.font = P.n(500 + P.fw, 20, fontsReady);
    text.drawTabular(ctx, i < 9 ? `0${i + 1}` : String(i + 1), X0, mid);
    text.drawTabular(ctx, f.md, X0 + COL_DATE, mid);
    ctx.fillStyle = P.ink;
    ctx.font = P.f(500 + P.fw, 26);
    const title = text.ellipsis(f.title || '未命名电影', titleMax, s => ctx.measureText(s).width);
    ctx.fillText(title, titleX, mid);
    const end = titleX + ctx.measureText(title).width + 14;
    kit.dashed(rule, end, mid + 2, f.rating > 0 ? starX - 14 : X1, mid + 2, 1.5, P.faint, 1.5, 6);
    if (f.rating > 0) kit.stars(ctx, starX, mid - STAR / 2, f.rating, STAR, STAR_GAP, P.accent, P.faint);
    y += L.rowH;
  });
  if (L.more > 0) {
    ctx.fillStyle = P.soft;
    ctx.font = P.f(400 + P.fw, 24);
    ctx.fillText(`… 另 ${L.more} 部`, titleX, y + L.rowH / 2);
    y += L.rowH;
  }
  return y;
}

function drawTotal(ctx, model, y, P, fontsReady) {
  const mid = y + TOTAL_H / 2;
  ctx.fillStyle = P.ink;
  ctx.font = P.n(700 + P.fw, 30, fontsReady);
  text.drawSpaced(ctx, 'TOTAL', X0, mid, 3, 'left');
  ctx.font = P.f(500 + P.fw, 24);
  ctx.textAlign = 'right';
  ctx.fillText('部', X1, mid + 2);
  ctx.fillStyle = P.accent;
  ctx.font = P.n(700 + P.fw, 34, fontsReady);
  ctx.fillText(String(model.stats.count), X1 - 34, mid);
  ctx.textAlign = 'left';
  return y + TOTAL_H;
}

function drawCode(ctx, model, y, P, fontsReady) {
  const cx = W / 2, barW = 520, barH = 62;
  ctx.fillStyle = P.soft;
  ctx.font = P.n(500 + P.fw, 20, fontsReady);
  text.drawSpaced(ctx, `#${model.ymDot}`, cx, y + 22, 3, 'center');
  kit.barcodeFill(ctx, cx - barW / 2, y + 42, barW, barH, model.ymDot, 2, P.ink);
}

function draw(ctx, model, covers, env) {
  const e = env || {};
  const fontsReady = !!e.fontsReady;
  const P = resolvePalette(e);
  const L = layout(model);
  const H = L.height;

  // 1. 渐变底
  fillPage(ctx, H, P);
  grain(ctx, 0, 0, W, H, 'page', P.speckA, P.speckB);

  // 2. 内容
  const top = Math.round(MARGIN + Math.max(0, (H - MARGIN - MARGIN - L.contentH) / 2));

  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  let y = top;
  drawBeam(ctx, lensOf(X0, y), top - 64, y + BEAM_BOTTOM, W, P, model.ymDot);
  // 要压油墨边的配色：字画在离屏层，压完贴回来
  const layer = e.inked ? tint.makeOffscreen(W, H) : null;
  const pen = layer ? layer.getContext('2d') : ctx;
  pen.textBaseline = 'middle';
  pen.textAlign = 'left';
  const title = model.customTitle || (model.mode === 'month' ? `${model.periodTitle}观影小票` : `${model.periodTitle} 观影小票`);
  const titleBox = drawHeader(pen, X0, X1, y, title, model.spanText, P, fontsReady);
  // 虚线太细，经不起油墨处理：直接画在底层 ctx，不进离屏层
  y = dashAt(ctx, y + HEAD_H, P);
  y = dashAt(ctx, drawTableHead(pen, y, P), P);
  y = dashAt(ctx, drawRows(pen, ctx, L, y, P, fontsReady), P);
  y = dashAt(ctx, drawTotal(pen, model, y, P, fontsReady), P) + CODE_GAP;
  drawCode(pen, model, y, P, fontsReady);
  // 署名：条码下面
  pen.textBaseline = 'alphabetic';
  kit.watermark(pen, W / 2, y + 136, 1, e.inked ? P.soft : P.wm, P.accent, (w, size) => P.f(w + P.fw, size));
  if (layer) {
    // 大字晕得开，小字只能轻压，不然笔画糊成一团；浅字压在深底上显粗，阈值抬一点；抬过 0.25 细横线（片名「一一」）就断了
    const small = { radius: 1, strength: 0.16, threshold: P.deep ? 0.24 : 0.2 };
    const big = titleBox.size >= 48;
    const box = titleBox, boxEnd = box.y + box.h;
    kit.inkEdge(pen, box.x, box.y, box.w, box.h, model.ymDot, big ? { radius: 2, strength: 0.32, threshold: 0.22 } : small);
    const left = X0 - 40, wide = INNER_W + 80;
    kit.inkEdge(pen, left, top, box.x - left, boxEnd - top, model.ymDot + 'b', small);
    kit.inkEdge(pen, left, boxEnd, wide, Math.round(y - boxEnd), model.ymDot + 'c', small);
    // 条码、署名也压：条码的线之间只有 2 像素的缝，阈值要高，不然缝被糊死
    const codeY = Math.round(y);
    kit.inkEdge(pen, left, codeY, wide, 40, model.ymDot + 'd', small);
    kit.inkEdge(pen, left, codeY + 40, wide, 66, model.ymDot + 'e', { radius: 1, strength: 0.34, threshold: 0.44 });
    kit.inkEdge(pen, left, codeY + 106, wide, CODE_H - 106, model.ymDot + 'f', small);
    ctx.drawImage(layer, 0, 0);
  }
}

module.exports = { supports, coverFilms, measure, draw, layout, PALETTE, PALETTE_LIST, DEFAULT_PALETTE, MAX_ROWS };
