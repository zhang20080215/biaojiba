/**
 * 数值型每日主题 · 统计报表海报（小红书 3:4，1080×1440）
 *
 * 照着统计页「当前的样子」画一张：标题 → 表头（选中的那一段 / 大数字 / 涨跌 / 开高低收或最多最少）
 * → 图表卡（日周月年目标页签、画法 / 均线 / 日均总数 的选中状态、图表本身）→ 汇总四格 → 署名。
 * 图表直接调 utils/daily/klineDraw.js / goalDraw.js —— 和页面组件同一份绘制代码，周期、画法、均线、
 * 缩放窗口、十字线都和页面一致，只是按海报尺寸放大。
 * 纯 ctx 绘制，不加载图片；底部只有文字署名，没有二维码 / 小程序码（推广合规）。
 *
 * 用法：draw(ctx, snap, palette)
 *   snap 由统计页 stats.js 的 _snapshot() 生成，palette 是 utils/daily/palette.js 的一套主题色（海报页可换）
 */
const KD = require('./daily/klineDraw.js');
const GD = require('./daily/goalDraw.js');

const W = 1080;
const H = 1440;
const M = 60;                                    // 左右留白
const CW = W - M * 2;                            // 内容宽
const FONT = '"PingFang SC", "Helvetica Neue", sans-serif';
const INK = '#2D2D2B';
const INK_SOFT = '#6F6F68';
const INK_MUTED = '#9C998F';
const LINE = '#EAEAE7';

// 图表在海报上的逻辑尺寸：宽度和手机上一样按 343 算，字号、线宽跟着一起放大；高度比页面略扁，给汇总留位置
const CHART_LW = 343;
const CHART_BOX = { x: M + 30, w: CW - 60, h: 400 };

function font(size, weight) {
  return `${weight || 400} ${size}px ${FONT}`;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function card(ctx, x, y, w, h) {
  ctx.fillStyle = '#FFFFFF';
  roundRect(ctx, x, y, w, h, 32);
  ctx.fill();
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 2;
  ctx.stroke();
}

// 文字截断到 maxW 以内（末尾加 …）
function fit(ctx, text, maxW) {
  let t = String(text || '');
  if (ctx.measureText(t).width <= maxW) return t;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t + '…';
}

function background(ctx, p) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, p.tint);
  g.addColorStop(1, '#FFFFFF');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = p.soft;
  ctx.beginPath(); ctx.arc(W - 70, 90, 210, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = p.accent;
  ctx.beginPath(); ctx.arc(W - 250, 250, 60, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1;
}

function title(ctx, snap, p) {
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = INK;
  ctx.font = font(58, 700);
  ctx.fillText(snap.title, M, 128);
  ctx.fillStyle = INK_SOFT;
  ctx.font = font(28);
  ctx.fillText(snap.subtitle, M, 180);
  // 标题下的短强调线
  ctx.fillStyle = p.accent;
  roundRect(ctx, M, 202, 64, 8, 4);
  ctx.fill();
}

// 表头：页面 quote 区的放大版
function header(ctx, snap, y) {
  const h = snap.header;
  const x = M + 40;
  card(ctx, M, y, CW, 220);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = INK_MUTED;
  ctx.font = font(28);
  ctx.fillText(fit(ctx, h.cap, CW - 80), x, y + 54);

  ctx.fillStyle = INK;
  ctx.font = font(96, 700);
  const big = String(h.big);
  ctx.fillText(big, x, y + 148);
  let cx = x + ctx.measureText(big).width + 12;
  if (h.bigUnit) {
    ctx.fillStyle = INK_MUTED;
    ctx.font = font(32, 600);
    ctx.fillText(h.bigUnit, cx, y + 148);
    cx += ctx.measureText(h.bigUnit).width + 24;
  }
  if (h.change) {
    ctx.fillStyle = h.changeColor || INK_SOFT;
    ctx.font = font(30, 600);
    ctx.fillText(fit(ctx, h.change, M + CW - 40 - cx), cx, y + 146);
  }

  // 第三行：开高低收 / 最多最少累计，或日视图的目标说明
  const ly = y + 194;
  if (h.ohlc && h.ohlc.length) {
    const colW = (CW - 80) / Math.max(3, h.ohlc.length);
    h.ohlc.forEach((it, i) => {
      const ix = x + colW * i;
      ctx.fillStyle = INK_MUTED;
      ctx.font = font(26);
      ctx.fillText(it.k, ix, ly);
      const kw = ctx.measureText(it.k).width + 12;
      ctx.fillStyle = INK;
      ctx.font = font(30, 600);
      ctx.fillText(fit(ctx, it.v, colW - kw - 12), ix + kw, ly);
    });
  } else if (h.note) {
    ctx.fillStyle = INK_SOFT;
    ctx.font = font(28);
    ctx.fillText(fit(ctx, h.note, CW - 80), x, ly);
  }
  return y + 220;
}

// 分段按钮（页签 / 画法 / 日均总数）：on 的那个高亮，和页面上同一个意思
function segs(ctx, items, onKey, x, y, opt) {
  const h = 52, padX = opt.padX || 22;
  ctx.font = font(26, 600);
  const widths = items.map(it => Math.max(opt.minW || 0, ctx.measureText(it.label).width + padX * 2));
  const total = widths.reduce((a, b) => a + b, 0) + 8;
  let left = opt.alignRight ? x - total : x;
  ctx.fillStyle = opt.bg;
  roundRect(ctx, left, y, total, h, h / 2);
  ctx.fill();
  if (opt.border) { ctx.strokeStyle = LINE; ctx.lineWidth = 2; ctx.stroke(); }
  let cx = left + 4;
  items.forEach((it, i) => {
    const on = it.key === onKey || (opt.onAll && it.on);
    if (on) {
      ctx.fillStyle = opt.onBg;
      roundRect(ctx, cx, y + 4, widths[i], h - 8, (h - 8) / 2);
      ctx.fill();
    }
    ctx.fillStyle = on ? opt.onInk : INK_MUTED;
    ctx.font = font(26, on ? 700 : 400);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(it.label, cx + widths[i] / 2, y + h / 2 + 1);
    cx += widths[i];
  });
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  return { left, right: left + total };
}

function chartCard(ctx, snap, p, y) {
  const top = y;
  const goal = snap.chart.kind === 'goal';
  const sub = goal || snap.showAgg;
  const chartTop = top + (sub ? 156 : 104);
  // 没有第二行（日均总数 / 图例）时把省下的高度给图表，汇总和署名的位置就不随页签变
  const chartH = CHART_BOX.h + (sub ? 0 : 52);
  const h = chartTop - top + chartH + 24;
  card(ctx, M, top, CW, h);

  // 第一行：页签（左）+ 画法 / 均线（右，目标页签不画）
  segs(ctx, snap.periods, snap.period, M + 30, top + 30, { bg: '#F5F5F4', onBg: '#FFFFFF', onInk: INK, minW: 76, padX: 18 });
  if (!goal) {
    const ma = segs(ctx, [{ key: 'ma', label: '均线', on: snap.showMA }], '', M + CW - 30, top + 30,
      { bg: '#FFFFFF', border: true, onBg: p.tint, onInk: p.accent, onAll: true, alignRight: true });
    segs(ctx, snap.modes, snap.mode, ma.left - 14, top + 30,
      { bg: '#FFFFFF', border: true, onBg: p.tint, onInk: p.accent, alignRight: true });
  }

  // 第二行：目标 = 图例；周月年 = 每X看 日均 / 总数（靠右）
  if (goal) {
    const ly = top + 104;
    let lx = M + 40;
    [['实际累计', 'solid'], ['理想进度', 'dash'], ['预测', 'dot']].forEach(([label, kind]) => {
      ctx.strokeStyle = kind === 'dash' ? '#A7A498' : p.accent;
      ctx.globalAlpha = kind === 'dot' ? 0.7 : 1;
      ctx.lineWidth = kind === 'solid' ? 5 : 4;
      ctx.setLineDash(kind === 'dash' ? [8, 6] : kind === 'dot' ? [3, 6] : []);
      ctx.beginPath(); ctx.moveTo(lx, ly + 26); ctx.lineTo(lx + 40, ly + 26); ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      ctx.fillStyle = INK_SOFT;
      ctx.font = font(26);
      ctx.textBaseline = 'middle';
      ctx.fillText(label, lx + 52, ly + 27);
      ctx.textBaseline = 'alphabetic';
      lx += 52 + ctx.measureText(label).width + 40;
    });
  } else if (snap.showAgg) {
    const s = segs(ctx, snap.aggs, snap.agg, M + CW - 30, top + 92,
      { bg: '#FFFFFF', border: true, onBg: p.tint, onInk: p.accent, alignRight: true });
    ctx.fillStyle = INK_MUTED;
    ctx.font = font(26);
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(snap.aggLabel, s.left - 14, top + 119);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  // 图表：逻辑宽 343，放大到 CHART_BOX.w
  const k = CHART_BOX.w / CHART_LW;
  const lh = chartH / k;
  ctx.save();
  ctx.translate(CHART_BOX.x, chartTop);
  ctx.scale(k, k);
  const c = snap.chart;
  if (c.kind === 'goal') {
    GD.draw(ctx, CHART_LW, lh, Object.assign({}, c.opts, { accent: p.accent }), { k0: c.k0, kw: c.kw, sel: c.sel });
  } else {
    KD.draw(ctx, CHART_LW, lh, Object.assign({}, c.opts, { accent: p.accent }), { V: c.V, offset: c.offset, sel: c.sel });
  }
  ctx.restore();
  return top + h;
}

function summary(ctx, snap, y) {
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = INK_MUTED;
  ctx.font = font(28);
  ctx.fillText(fit(ctx, snap.sumTitle, CW - 20), M + 10, y + 30);
  const tiles = (snap.kpi || []).slice(0, 4);
  if (!tiles.length) return y + 40;
  const gap = 18;
  const tw = (CW - gap * (tiles.length - 1)) / tiles.length;
  const ty = y + 52, th = 176;
  tiles.forEach((t, i) => {
    const x = M + (tw + gap) * i;
    card(ctx, x, ty, tw, th);
    const ix = x + 24;
    ctx.fillStyle = INK_MUTED;
    ctx.font = font(24);
    ctx.fillText(fit(ctx, t.label, tw - 48), ix, ty + 46);
    ctx.fillStyle = INK;
    ctx.font = font(48, 700);
    const v = String(t.value);
    ctx.fillText(fit(ctx, v, tw - 48), ix, ty + 110);
    const vw = Math.min(ctx.measureText(v).width, tw - 48);
    if (t.unit) {
      ctx.fillStyle = INK_SOFT;
      ctx.font = font(22);
      ctx.fillText(fit(ctx, t.unit, tw - 48 - vw - 8), ix + vw + 8, ty + 110);
    }
    if (t.sub) {
      ctx.fillStyle = INK_MUTED;
      ctx.font = font(20);
      ctx.fillText(fit(ctx, t.sub, tw - 48), ix, ty + 150);
    }
  });
  return ty + th;
}

function footer(ctx, snap) {
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(M, H - 92); ctx.lineTo(W - M, H - 92); ctx.stroke();
  ctx.fillStyle = INK_MUTED;
  ctx.font = font(26);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText(snap.signature, M, H - 50);
  ctx.textAlign = 'right';
  ctx.fillText(snap.dateText, W - M, H - 50);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

function draw(ctx, snap, palette) {
  ctx.clearRect(0, 0, W, H);
  background(ctx, palette);
  title(ctx, snap, palette);
  let y = header(ctx, snap, 232);
  y = chartCard(ctx, snap, palette, y + 24);
  summary(ctx, snap, y + 24);
  footer(ctx, snap);
}

module.exports = { SIZE: { width: W, height: H }, draw };
