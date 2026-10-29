/**
 * 每日主题公共层 · 统计页 K 线图的绘制（纯 canvas 2d，不碰 wx / 组件）
 *
 * 从 components/daily/kline-chart 抽出来，组件和「统计报表海报」（utils/metricReportPoster.js）共用这一份，
 * 海报上的图和用户在页面上看到的一模一样：同样的周期、画法、均线、目标线、缩放窗口和十字线。
 * 所有尺寸按 CSS 像素写（页面上图表约 343×220），海报那边 ctx.scale 放大后调用。
 *
 * o  = 图表设置 { candles, period, mode, value, goal, showGoal, goalText, format, accent, showMA }
 * st = 视窗状态 { V（一屏几根）, offset（离最右偏几根）, sel（十字线那根，-1 无）}
 */
const M = require('./metric.js');
const T = require('./clock.js');
const K = require('./kline.js');
const { monotoneControls } = require('./chart.js');

const MA_COLORS = ['#E3A23B', '#6A8CDB'];
const MA_N = [5, 10];
const UP = '#E25A4E';
const DOWN = '#3A9F6E';
const FLAT = '#A7A498';
const PAD = { l: 6, r: 50, t: 24, b: 22 };

// 视窗：最新一根在最右，offset 根以外往左；不满一屏时整体靠右。offset 会被夹回合法范围（返回值里）
function view(candles, V0, offset, W) {
  const c = candles || [];
  const n = c.length;
  const V = Math.max(1, V0);
  const maxOffset = Math.max(0, n - V);
  const off = Math.min(Math.max(0, offset || 0), maxOffset);
  const end = n - off;
  const start = Math.max(0, end - V);
  const plotW = W - PAD.l - PAD.r;
  const slot = plotW / V;
  const lead = V - (end - start);
  const xOf = i => PAD.l + (i - start + lead) * slot + slot / 2;
  return { c, n, V, start, end, slot, xOf, plotW, maxOffset, offset: off };
}

// 每根要画的那个数：K线看收；柱形 / 折线看 value
function valOf(c, o) {
  if (o.mode === 'candle') return c.close;
  return o.value === 'sum' ? c.sum : c.main;
}

function fmt(v, o) {
  return o.format === 'clock' ? T.offsetToClock(-v) : M.formatShort(Math.round(v));
}

// 纵轴刻度：步数取整到百（8,113 → 8,100），读起来像刻度而不是某一天的数
function axisFmt(v, o) {
  return o.format === 'clock' ? T.offsetToClock(-v) : M.formatShort(Math.round(v / 100) * 100);
}

function dateLabel(c, o) {
  if (!c) return '';
  if (o.period === 'year') return c.key;
  if (o.period === 'month') return c.key.replace('-', '/');
  return c.from.slice(5).replace('-', '/');
}

/**
 * 在 (0,0)-(W,H) 里画整张图（不清屏，调用方负责底色）。返回 view，组件用它更新 offset。
 */
function draw(ctx, W, H, o, st) {
  const v = view(o.candles, st.V, st.offset, W);
  if (!v.n) return v;
  const sel = st.sel == null ? -1 : st.sel;
  const mode = o.mode;
  const vals = v.c.map(c => valOf(c, o));
  const showMA = o.showMA;
  // 均线：K线按收盘价算（股票软件的口径），柱形 / 折线按画出来的那个数
  const ma = showMA ? MA_N.map(n => K.movingAverage(vals.map(x => ({ main: x })), n)) : [];
  const vis = v.c.slice(v.start, v.end);
  const goal = o.goal;

  // 纵轴范围：可见的值（K线含开高低收：日K 的开是上一天，可能在高低之外）+ 均线 + 目标线
  let lo = Infinity, hi = -Infinity;
  vis.forEach((c, k) => {
    const i = v.start + k;
    lo = Math.min(lo, mode === 'candle' ? Math.min(c.low, c.open) : vals[i]);
    hi = Math.max(hi, mode === 'candle' ? Math.max(c.high, c.open) : vals[i]);
    ma.forEach(arr => { const x = arr[i]; if (x != null) { lo = Math.min(lo, x); hi = Math.max(hi, x); } });
  });
  if (o.showGoal) { lo = Math.min(lo, goal); hi = Math.max(hi, goal); }
  if (hi === lo) { hi += 1; lo -= 1; }
  const padV = (hi - lo) * 0.08;
  hi += padV; lo -= padV;
  // 步数的柱子从 0 长起，柱高才和数值成正比
  if (mode === 'bar' && o.format === 'count') lo = 0;
  const top = PAD.t, bottom = H - PAD.b, plotH = bottom - top;
  const yOf = val => top + (hi - val) / (hi - lo) * plotH;

  // 网格 + 右侧刻度
  ctx.font = '10px sans-serif';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  for (let g = 0; g <= 3; g++) {
    const y = top + plotH * g / 3;
    ctx.strokeStyle = '#EFEEEA';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(W - PAD.r, y); ctx.stroke();
    ctx.fillStyle = '#A7A498';
    ctx.fillText(axisFmt(hi - (hi - lo) * g / 3, o), W - PAD.r + 6, y);
  }

  // 每日目标虚线（文字最后画，免得被图形盖住）
  const gy = o.showGoal ? yOf(goal) : null;
  if (gy != null) {
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = o.accent;
    ctx.beginPath(); ctx.moveTo(PAD.l, gy); ctx.lineTo(W - PAD.r, gy); ctx.stroke();
    ctx.restore();
  }
  // 达标深色、没达标浅一档；没有目标线（看总数）时一律深色
  const strong = val => !o.showGoal || val >= goal;

  if (mode === 'line') {
    const pts = vis.map((c, k) => ({ x: v.xOf(v.start + k), y: yOf(vals[v.start + k]) }));
    const segs = monotoneControls(pts);
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    segs.forEach(s => ctx.bezierCurveTo(s.c1x, s.c1y, s.c2x, s.c2y, s.x, s.y));
    ctx.strokeStyle = o.accent;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.lineTo(pts[pts.length - 1].x, bottom);
    ctx.lineTo(pts[0].x, bottom);
    ctx.closePath();
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = o.accent;
    ctx.fill();
    ctx.globalAlpha = 1;
  } else if (mode === 'bar') {
    // 一屏放很多根时一格不到 2px，柱子按格宽收窄，最细 1px
    const bw = Math.min(14, Math.max(1, v.slot * (v.slot < 4 ? 0.7 : 0.5)));
    vis.forEach((c, k) => {
      const val = vals[v.start + k];
      const x = v.xOf(v.start + k), y = yOf(val);
      ctx.globalAlpha = strong(val) ? 1 : 0.35;
      ctx.fillStyle = o.accent;
      ctx.fillRect(x - bw / 2, y, bw, Math.max(1, bottom - y));
    });
    ctx.globalAlpha = 1;
  } else {
    // K线：影线 = 最高到最低，实体 = 开到收；实心红涨绿跌，持平画一道灰横线
    const bw = Math.max(1, Math.min(12, v.slot * 0.62));
    vis.forEach((c, k) => {
      const x = Math.round(v.xOf(v.start + k)) + 0.5;
      const color = c.close > c.open ? UP : c.close < c.open ? DOWN : FLAT;
      const top2 = Math.max(c.high, c.open, c.close), bot2 = Math.min(c.low, c.open, c.close);
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, yOf(top2)); ctx.lineTo(x, yOf(bot2)); ctx.stroke();
      const yo = yOf(c.open), yc = yOf(c.close);
      const y = Math.min(yo, yc), h = Math.max(1, Math.abs(yo - yc));
      ctx.fillRect(x - bw / 2, y, bw, h);
    });
  }

  // 均线
  ma.forEach((arr, j) => {
    ctx.strokeStyle = MA_COLORS[j];
    ctx.lineWidth = 1;
    ctx.beginPath();
    let started = false;
    for (let i = v.start; i < v.end; i++) {
      if (arr[i] == null) continue;
      const x = v.xOf(i), y = yOf(arr[i]);
      if (started) ctx.lineTo(x, y); else { ctx.moveTo(x, y); started = true; }
    }
    ctx.stroke();
  });

  // 目标值贴在虚线右下角，垫一块白底压在图形上面；太靠底放不下就贴右上角
  if (gy != null && o.goalText) {
    ctx.font = '10px sans-serif';
    const tw = ctx.measureText(o.goalText).width;
    const below = gy + 16 <= bottom;
    const by = below ? gy + 2 : gy - 16;
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.fillRect(W - PAD.r - tw - 8, by, tw + 6, 14);
    ctx.fillStyle = o.accent;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText(o.goalText, W - PAD.r - 5, by + 2);
  }

  // 左上角均线读数（十字线所在那根，否则最新一根）
  const at = sel >= 0 ? sel : v.end - 1;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  let lx = PAD.l;
  (showMA ? MA_N : []).forEach((n, j) => {
    const val = ma[j][at];
    const txt = `MA${n} ${val == null ? '--' : fmt(val, o)}`;
    ctx.fillStyle = MA_COLORS[j];
    ctx.fillText(txt, lx, 10);
    lx += ctx.measureText(txt).width + 12;
  });

  // 底部日期：首、中、尾
  ctx.fillStyle = '#A7A498';
  ctx.textBaseline = 'top';
  const idx = [v.start, Math.floor((v.start + v.end - 1) / 2), v.end - 1];
  ['left', 'center', 'right'].forEach((align, j) => {
    const x = j === 0 ? PAD.l : j === 2 ? W - PAD.r : v.xOf(idx[1]);
    // 中间那个日期离两头太近就不写（根数少、整体靠右时会和右边的日期叠在一起）
    if (j === 1 && (v.end - v.start < 5 || x - PAD.l < 44 || W - PAD.r - x < 44)) return;
    ctx.textAlign = align;
    ctx.fillText(dateLabel(v.c[idx[j]], o), x, bottom + 6);
  });

  // 十字线
  if (sel >= v.start && sel < v.end) {
    const val = vals[sel];
    const x = v.xOf(sel), y = yOf(val);
    ctx.save();
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = '#6F6F68';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.moveTo(PAD.l, y); ctx.lineTo(W - PAD.r, y); ctx.stroke();
    ctx.restore();
    ctx.fillStyle = '#2D2D2B';
    ctx.fillRect(W - PAD.r + 1, y - 8, PAD.r - 2, 16);
    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(fmt(val, o), W - PAD.r + 4, y);
  }
  return v;
}

module.exports = { PAD, MA_COLORS, view, draw, valOf, fmt };
