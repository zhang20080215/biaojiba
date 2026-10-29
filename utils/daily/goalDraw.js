/**
 * 每日主题公共层 · 统计页「目标」页签的累计进度图绘制（纯 canvas 2d，不碰 wx / 组件）
 *
 * 从 components/daily/goal-chart 抽出来，组件和「统计报表海报」（utils/metricReportPoster.js）共用，
 * 海报上的图和页面上一样（含缩放窗口和十字线）。尺寸按 CSS 像素写，海报那边 ctx.scale 放大后调用。
 *
 * o  = { burnup（utils/daily/burnup.js 的结果，函数字段可以没有）, accent, targetText }
 * st = { k0, kw（横轴窗口，k0 为 null 表示整个区间）, sel（十字线那天，-1 无）}
 */
const M = require('./metric.js');
const D = require('./date.js');
const { monotoneControls } = require('./chart.js');

// 顶部不用给均线读数留位置（K 线图要），只留目标值那行字的余量
const PAD = { l: 6, r: 50, t: 8, b: 22 };
const MIN_DAYS = 7;                              // 放大到最多一屏 7 天
const GRID = '#EFEEEA';
const MUTED = '#A7A498';

function fmt(b, v) {
  return b && b.mode === 'days' ? String(Math.round(v)) : M.formatShort(Math.round(v));
}

function md(date) {
  return date ? date.slice(5).replace('-', '/').replace(/^0/, '').replace('/0', '/') : '';
}

// 横轴窗口 [k0, k1]（天，可以是小数）：k0 为 null 就是整个区间；否则夹回区间内、宽度不小于 7 天
function win(b, k0, kw) {
  const span = b.span;
  if (k0 == null) return { k0: 0, k1: span, w: span };
  const w = Math.min(span, Math.max(Math.min(MIN_DAYS, span), kw));
  const k = Math.min(span - w, Math.max(0, k0));
  return { k0: k, k1: k + w, w };
}

// 第 k 天结束时对应的日期（k=0 记作开始日）
function dateAt(b, k) {
  return D.addDays(b.startDate, Math.max(0, Math.round(k) - 1));
}

function geo(b, W, H, w) {
  const top = PAD.t, bottom = H - PAD.b;
  const plotW = W - PAD.l - PAD.r;
  const hi = Math.max(b.target, b.walked, b.projected || 0, 1) * 1.06;
  return {
    top, bottom, plotW,
    xOf: k => PAD.l + (k - w.k0) / w.w * plotW,
    yOf: v => bottom - v / hi * (bottom - top)
  };
}

// 在 (0,0)-(W,H) 里画整张图（不清屏，调用方负责底色）
function draw(ctx, W, H, o, st) {
  const b = o.burnup;
  if (!b || !b.span) return;
  const view = win(b, st.k0, st.kw);
  const g = geo(b, W, H, view);
  const { top, bottom, xOf, yOf } = g;
  const inPlot = x => x >= PAD.l - 0.5 && x <= W - PAD.r + 0.5;
  const accent = o.accent;
  const pts = b.points.map(p => ({ x: xOf(p.k), y: yOf(p.cum) }));
  const now = pts[pts.length - 1];

  // 网格按目标值的 0 / 一半 / 四分之一、四分之三画，刻度只写 0 和一半（目标值本身贴在目标线上）——
  // 按纵轴高度三等分会写出「36万 / 72万 / 108万」这种不成数的刻度
  ctx.font = '10px sans-serif';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  [0, 0.25, 0.5, 0.75].forEach(f => {
    const y = yOf(b.target * f);
    ctx.strokeStyle = GRID;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(W - PAD.r, y); ctx.stroke();
    const half = b.target / 2;
    if (f === 0 || (f === 0.5 && (b.mode !== 'days' || Number.isInteger(half)))) {
      ctx.fillStyle = MUTED;
      ctx.fillText(f ? fmt(b, half) : '0', W - PAD.r + 6, y);
    }
  });

  // 目标值细线
  const ty = yOf(b.target);
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = accent;
  ctx.beginPath(); ctx.moveTo(PAD.l, ty); ctx.lineTo(W - PAD.r, ty); ctx.stroke();
  ctx.globalAlpha = 1;

  // 三条线裁在绘图区里：放大后窗口外的部分不画到刻度栏上
  ctx.save();
  ctx.beginPath();
  ctx.rect(PAD.l, 0, W - PAD.l - PAD.r, H);
  ctx.clip();

  // 理想进度
  ctx.save();
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = MUTED;
  ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(xOf(0), yOf(0)); ctx.lineTo(xOf(b.span), ty); ctx.stroke();
  ctx.restore();

  // 实际累计
  if (pts.length > 1) {
    const segs = monotoneControls(pts);
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    segs.forEach(s => ctx.bezierCurveTo(s.c1x, s.c1y, s.c2x, s.c2y, s.x, s.y));
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.lineTo(now.x, bottom);
    ctx.lineTo(pts[0].x, bottom);
    ctx.closePath();
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = accent;
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // 预测
  let projLabel = null;
  if (b.status === 'active' && b.projEndK > b.elapsed && b.walked > 0) {
    const px = xOf(b.projEndK), py = yOf(b.projected);
    ctx.save();
    ctx.setLineDash([3, 4]);
    ctx.globalAlpha = 0.65;
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(now.x, now.y); ctx.lineTo(px, py); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = accent;
    ctx.beginPath(); ctx.arc(px, py, 3, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    if (inPlot(px)) projLabel = { x: px, y: py, text: b.finishDate ? `预计 ${md(b.finishDate)} 达成` : `预计 ${fmt(b, b.projected)}` };
  }
  ctx.restore();                             // 结束裁剪

  // 文字最后画，垫白底免得被线盖住；右对齐到 x，返回占的矩形
  ctx.font = '10px sans-serif';
  const boxOf = (text, x, y) => { const tw = ctx.measureText(text).width; return { l: x - tw - 3, r: x + 3, t: y, b: y + 14 }; };
  const chip = (text, box, color) => {
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.fillRect(box.l, box.t, box.r - box.l, 14);
    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(text, box.l + 3, box.t + 2);
  };
  const hit = (p, q) => p && q && p.l < q.r && q.l < p.r && p.t < q.b && q.t < p.b;
  const tBox = o.targetText ? boxOf(o.targetText, W - PAD.r - 5, ty + 2) : null;
  if (tBox) chip(o.targetText, tBox, accent);
  if (projLabel) {
    // 预测末端的说明：先试点的上方（到不了目标时）/ 下方，和目标值撞了就再往下挪
    const x = Math.min(projLabel.x, W - PAD.r - 5);
    const tries = (b.finishDate ? [6, 24, 42] : [-18, 6, 24]).map(d => boxOf(projLabel.text, x, projLabel.y + d));
    const nowBox = { l: now.x - 7, r: now.x + 7, t: now.y - 7, b: now.y + 7 };
    const box = tries.find(bx => !hit(bx, tBox) && !hit(bx, nowBox) && bx.t >= top - 4 && bx.b <= bottom) || tries[tries.length - 1];
    chip(projLabel.text, box, accent);
  }

  // 今天的点（白圈压在线上，画在文字之后，不被说明盖住；放大后不在窗口里就不画）
  if (pts.length > 1 && inPlot(now.x)) {
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath(); ctx.arc(now.x, now.y, 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = accent;
    ctx.beginPath(); ctx.arc(now.x, now.y, 3.5, 0, Math.PI * 2); ctx.fill();
  }


  // 底部日期：窗口两端（没缩放就是开始、截止）+ 今天
  ctx.font = '10px sans-serif';
  ctx.textBaseline = 'top';
  ctx.fillStyle = MUTED;
  ctx.textAlign = 'left';
  ctx.fillText(md(dateAt(b, view.k0)), PAD.l, bottom + 6);
  ctx.textAlign = 'right';
  ctx.fillText(md(view.k1 >= b.span ? b.endDate : dateAt(b, view.k1)), W - PAD.r, bottom + 6);
  if (b.elapsed > 0 && b.elapsed < b.span && now.x - PAD.l > 36 && W - PAD.r - now.x > 36) {
    ctx.textAlign = 'center';
    ctx.fillStyle = '#6F6F68';
    ctx.fillText('今天', now.x, bottom + 6);
  }

  // 十字线
  const sel = st.sel == null ? -1 : st.sel;
  if (sel > 0 && sel < pts.length && inPlot(pts[sel].x)) {
    const p = pts[sel];
    ctx.save();
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = '#6F6F68';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(p.x, top); ctx.lineTo(p.x, bottom); ctx.moveTo(PAD.l, p.y); ctx.lineTo(W - PAD.r, p.y); ctx.stroke();
    ctx.restore();
    ctx.fillStyle = '#2D2D2B';
    ctx.fillRect(W - PAD.r + 1, p.y - 8, PAD.r - 2, 16);
    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(fmt(b, b.points[sel].cum), W - PAD.r + 4, p.y);
  }
}

module.exports = { PAD, MIN_DAYS, win, draw };
