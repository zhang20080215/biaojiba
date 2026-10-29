/**
 * 数值型每日主题 · 统计报表海报
 *
 * 就是统计页（pages/daily/metric/stats）此刻的样子，按页面的 rpx 尺寸、颜色、字号 1:1 画到 canvas 上，
 * 宽 1080（1rpx = 1.44px），高随内容；不加任何页面上没有的东西，只在最底下加一行「标记吧小程序 · 免费制作同款图」水印。
 * 页面上的操作控件（左上返回、底部「生成海报」按钮）不画；按钮组（日周月年目标、画法、均线、日均总数、
 * 30/180/365 天）照页面的选中状态画，它们本身就是报表的一部分。
 * 图表直接调 utils/daily/klineDraw.js / goalDraw.js —— 和页面组件同一份绘制代码，按页面上的画布尺寸等比放大。
 * ⚠ 下面的 rpx 数字抄自 stats.wxss / common.wxss / daily-nav，改页面样式时这里要跟着改。
 *
 * 用法：const h = heightOf(snap); canvas.height = h; draw(ctx, snap)
 *   snap 由统计页 stats.js 的 _snapshot() 生成
 */
const KD = require('./daily/klineDraw.js');
const GD = require('./daily/goalDraw.js');
const P = require('./daily/palette.js');

const WIDTH = 1080;
const S = WIDTH / 750;                           // 1rpx 在海报上是几 px
const FONT = '"PingFang SC", "Helvetica Neue", sans-serif';
const LH = 1.4;                                  // 页面文字的 line-height: normal
const C = {                                      // styles/theme.wxss 的中性色（四套主题相同）
  page: P.NEUTRAL.page,
  card: P.NEUTRAL.card,
  section: '#F5F5F4',
  ink: P.NEUTRAL.ink,
  inkSoft: P.NEUTRAL.inkSoft,
  inkMuted: P.NEUTRAL.inkMuted,
  line: P.NEUTRAL.line
};
const WATERMARK = '标记吧小程序 · 免费制作同款图';

// 页面骨架（rpx）
const NAV_H = 88;                                // 导航条（不含状态栏），标题居中
const CONTENT_X = 32;                            // .content 左右内边距
const CONTENT_W = 750 - CONTENT_X * 2;           // 卡片宽 686
const QUOTE_H = 32 + 34 + 6 + 96 + 8 + 40 + 24;  // .quote 上外边距 + 时间段 + 大数字行 + 第三行 + 下外边距
const CARD_PAD = { t: 20, x: 20, b: 16 };
const BORDER = 3;
const HEAD_H = 60;                               // .chart-head：日周月年分段（52 + 上下 4）
const SUB_H = 52;                                // .chart-sub 第二行
const CHART_H = 440;                             // .kc 画布高
const CARD_H = BORDER * 2 + CARD_PAD.t + HEAD_H + 12 + SUB_H - 4 + 4 + CHART_H + CARD_PAD.b;
const SEC_TOP = 28, SEC_H = 52;
const TILE = { top: 20, padY: 22, padX: 24, label: 22, value: 40, sub: 20, radius: 28 };
const MARK_H = 120;                              // 底部水印区

const r = v => v * S;
const font = (size, weight) => `${weight || 400} ${r(size)}px ${FONT}`;

function roundRect(ctx, x, y, w, h, rad) {
  const k = Math.min(rad, h / 2, w / 2);
  ctx.beginPath();
  ctx.moveTo(x + k, y);
  ctx.arcTo(x + w, y, x + w, y + h, k);
  ctx.arcTo(x + w, y + h, x, y + h, k);
  ctx.arcTo(x, y + h, x, y, k);
  ctx.arcTo(x, y, x + w, y, k);
  ctx.closePath();
}

// 边框画在盒子里面（页面 box-sizing 是 border-box 的效果）
function box(ctx, x, y, w, h, rad, fill, stroke, bw) {
  if (fill) { ctx.fillStyle = fill; roundRect(ctx, x, y, w, h, rad); ctx.fill(); }
  if (stroke) {
    const half = bw / 2;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = bw;
    roundRect(ctx, x + half, y + half, w - bw, h - bw, rad - half);
    ctx.stroke();
  }
}

function text(ctx, s, x, y, size, color, weight, align) {
  ctx.font = font(size, weight);
  ctx.fillStyle = color;
  ctx.textAlign = align || 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(s, x, y);
  return ctx.measureText(s).width;
}

function fit(ctx, s, maxW) {
  let t = String(s == null ? '' : s);
  if (ctx.measureText(t).width <= maxW) return t;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t + '…';
}

// ───────── 汇总格子的高度（和页面一样：一行两格，行高取这一行里高的那个；没有 sub 的格子矮一截）─────────
function tileH(t) {
  return TILE.padY * 2 + BORDER * 2 + TILE.label * LH + TILE.value * LH + (t.sub ? 4 + TILE.sub * LH : 0);
}
function tileRows(kpi) {
  const rows = [];
  for (let i = 0; i < (kpi || []).length; i += 2) rows.push(kpi.slice(i, i + 2));
  return rows.map(row => ({ row, h: Math.max.apply(null, row.map(tileH)) }));
}

function heightOf(snap) {
  const tiles = tileRows(snap.kpi).reduce((a, x) => a + TILE.top + x.h, 0);
  return Math.ceil(r(NAV_H + 16 + QUOTE_H + CARD_H + SEC_TOP + SEC_H + tiles + MARK_H));
}

// ───────── 各块 ─────────
function nav(ctx, snap) {
  text(ctx, snap.title, WIDTH / 2, r(NAV_H / 2), 32, C.ink, 700, 'center');
  return NAV_H;
}

function quote(ctx, snap, top) {
  const h = snap.header;
  const x = r(CONTENT_X + 8), maxW = r(CONTENT_W - 16);
  let y = top + 32;
  ctx.font = font(24);
  text(ctx, fit(ctx, h.cap, maxW), x, r(y + 17), 24, C.inkMuted);
  y += 34 + 6;
  // 大数字行：数字 / 单位 / 涨跌共用一条基线
  const base = r(y + 74);
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.font = font(72, 800);
  ctx.fillStyle = C.ink;
  ctx.fillText(String(h.big), x, base);
  let cx = x + ctx.measureText(String(h.big)).width;
  if (h.bigUnit) {
    cx += r(8);
    ctx.font = font(26);
    ctx.fillStyle = C.inkSoft;
    ctx.fillText(h.bigUnit, cx, base);
    cx += ctx.measureText(h.bigUnit).width;
  }
  if (h.change) {
    cx += r(20);
    ctx.font = font(26, 600);
    ctx.fillStyle = h.changeColor || C.inkMuted;
    ctx.fillText(fit(ctx, h.change, x + maxW - cx), cx, base);
  }
  y += 96 + 8;
  // 第三行：开高低收 / 最多最少累计（等分），或日视图的目标说明
  const mid = r(y + 20);
  if (h.ohlc && h.ohlc.length) {
    const colW = maxW / h.ohlc.length;
    h.ohlc.forEach((it, i) => {
      const ix = x + colW * i;
      ctx.textBaseline = 'alphabetic';
      ctx.textAlign = 'left';
      ctx.font = font(22);
      ctx.fillStyle = C.inkMuted;
      ctx.fillText(it.k, ix, mid + r(9));
      const kw = ctx.measureText(it.k).width + r(8);
      ctx.font = font(26, 600);
      ctx.fillStyle = C.ink;
      ctx.fillText(fit(ctx, it.v, colW - kw - r(8)), ix + kw, mid + r(9));
    });
  } else if (h.note) {
    ctx.font = font(24);
    text(ctx, fit(ctx, h.note, maxW), x, mid, 24, C.inkSoft);
  }
  return top + QUOTE_H;
}

// .opt-group：细边框胶囊，选中的那格 tint 底 + accent 字；right = 右边缘（右对齐），返回左边缘
function optGroup(ctx, items, isOn, right, cy, p) {
  ctx.font = font(22);
  const ws = items.map(it => ctx.measureText(it.label).width + r(28));
  const w = ws.reduce((a, b) => a + b, 0) + r(4);
  const h = r(22 * LH + 16 + 4);
  const left = right - w;
  const top = cy - h / 2;
  ctx.save();
  roundRect(ctx, left, top, w, h, h / 2);
  ctx.clip();
  let x = left + r(2);
  items.forEach((it, i) => {
    if (isOn(it)) { ctx.fillStyle = p.tint; ctx.fillRect(x, top, ws[i], h); }
    text(ctx, it.label, x + ws[i] / 2, cy, 22, isOn(it) ? p.accent : C.inkMuted, isOn(it) ? 600 : 400, 'center');
    x += ws[i];
  });
  ctx.restore();
  box(ctx, left, top, w, h, h / 2, null, C.line, r(2));
  return left;
}

function chartCard(ctx, snap, top, p) {
  const innerX = r(CONTENT_X + BORDER + CARD_PAD.x), innerW = r(CONTENT_W - BORDER * 2 - CARD_PAD.x * 2);
  box(ctx, r(CONTENT_X), r(top), r(CONTENT_W), r(CARD_H), r(36), C.card, C.line, r(BORDER));
  const goal = snap.chart.kind === 'goal';

  // 第一行左：日周月年（目标）分段
  const headY = top + BORDER + CARD_PAD.t;
  const cy = r(headY + HEAD_H / 2);
  const segW = r(56);
  const pw = segW * snap.periods.length + r(8);
  box(ctx, innerX, r(headY), pw, r(HEAD_H), r(HEAD_H / 2), C.section);
  snap.periods.forEach((it, i) => {
    const sx = innerX + r(4) + segW * i;
    const on = it.key === snap.period;
    if (on) {
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.06)';
      ctx.shadowBlur = r(6);
      ctx.shadowOffsetY = r(2);
      box(ctx, sx, r(headY + 4), segW, r(52), r(26), C.card);
      ctx.restore();
    }
    text(ctx, it.label, sx + segW / 2, cy, 26, on ? C.ink : C.inkSoft, on ? 700 : 400, 'center');
  });

  // 第一行右：画法 + 均线（目标页签隐藏）
  if (!goal) {
    const right = innerX + innerW;
    const maLeft = optGroup(ctx, [{ key: 'ma', label: '均线' }], () => snap.showMA, right, cy, p);
    optGroup(ctx, snap.modes, it => it.key === snap.mode, maLeft - r(12), cy, p);
  }

  // 第二行：目标 = 图例；周月年 = 每X看 日均 / 总数（靠右）
  const subY = headY + HEAD_H + 12 - 4;
  const sy = r(subY + SUB_H / 2);
  if (goal) {
    let lx = innerX + r(8);
    [['实际累计', 'solid'], ['理想进度', 'dash'], ['预测', 'dot']].forEach(([label, kind]) => {
      ctx.save();
      ctx.strokeStyle = kind === 'dash' ? '#A7A498' : p.accent;
      ctx.globalAlpha = kind === 'dot' ? 0.7 : 1;
      ctx.lineWidth = r(kind === 'solid' ? 4 : 3);
      ctx.setLineDash(kind === 'dash' ? [r(6), r(4)] : kind === 'dot' ? [r(3), r(3)] : []);
      ctx.beginPath(); ctx.moveTo(lx, sy); ctx.lineTo(lx + r(28), sy); ctx.stroke();
      ctx.restore();
      const tw = text(ctx, label, lx + r(36), sy, 22, C.inkSoft);
      lx += r(36) + tw + r(24);
    });
  } else if (snap.showAgg) {
    const left = optGroup(ctx, snap.aggs, it => it.key === snap.agg, innerX + innerW, sy, p);
    text(ctx, snap.aggLabel, left - r(12), sy, 22, C.inkMuted, 400, 'right');
  }

  // 图表：页面上的画布是 innerW × 440rpx，按它的 CSS 像素尺寸画，再等比放大
  const chartY = subY + SUB_H + 4;
  const c = snap.chart;
  const cw = c.w || 320, ch = c.h || 220;
  const k = innerW / cw;
  ctx.save();
  ctx.translate(innerX, r(chartY));
  ctx.scale(k, k);
  if (c.kind === 'goal') {
    GD.draw(ctx, cw, ch, Object.assign({}, c.opts, { accent: p.accent }), { k0: c.k0, kw: c.kw, sel: c.sel });
  } else {
    KD.draw(ctx, cw, ch, Object.assign({}, c.opts, { accent: p.accent }), { V: c.V, offset: c.offset, sel: c.sel });
  }
  ctx.restore();
  return top + CARD_H;
}

function summary(ctx, snap, top, p) {
  const x = r(CONTENT_X + 8), right = r(CONTENT_X + CONTENT_W - 8);
  const y = top + SEC_TOP;
  const cy = r(y + SEC_H / 2);
  let titleMax = right - x;
  if (snap.period === 'day' && snap.ranges) {
    const left = optGroup(ctx, snap.ranges, it => it.key === snap.dayRange, right, cy, p);
    titleMax = left - x - r(16);
  }
  ctx.font = font(24);
  text(ctx, fit(ctx, snap.sumTitle, titleMax), x, cy, 24, C.inkMuted);

  let ty = y + SEC_H;
  const tw = (CONTENT_W - 20) / 2;
  tileRows(snap.kpi).forEach(({ row, h }) => {
    ty += TILE.top;
    row.forEach((t, i) => {
      const tx = CONTENT_X + (tw + 20) * i;
      box(ctx, r(tx), r(ty), r(tw), r(h), r(TILE.radius), C.card, C.line, r(BORDER));
      const ix = r(tx + BORDER + TILE.padX), maxW = r(tw - BORDER * 2 - TILE.padX * 2);
      let ly = ty + BORDER + TILE.padY;
      ctx.font = font(TILE.label);
      text(ctx, fit(ctx, t.label, maxW), ix, r(ly + TILE.label * LH / 2), TILE.label, C.inkMuted);
      ly += TILE.label * LH;
      const base = r(ly + TILE.value * 1.05);
      ctx.textBaseline = 'alphabetic';
      ctx.textAlign = 'left';
      ctx.font = font(TILE.value, 700);
      ctx.fillStyle = C.ink;
      const v = String(t.value);
      ctx.fillText(v, ix, base);
      const vw = ctx.measureText(v).width;
      if (t.unit) {
        ctx.font = font(22);
        ctx.fillStyle = C.inkSoft;
        ctx.fillText(fit(ctx, t.unit, maxW - vw - r(6)), ix + vw + r(6), base);
      }
      ly += TILE.value * LH;
      if (t.sub) {
        ctx.font = font(TILE.sub);
        text(ctx, fit(ctx, t.sub, maxW), ix, r(ly + 4 + TILE.sub * LH / 2), TILE.sub, C.inkMuted);
      }
    });
    ty += h;
  });
  return ty;
}

function watermark(ctx, H) {
  text(ctx, WATERMARK, WIDTH / 2, H - r(MARK_H / 2), 24, C.inkMuted, 400, 'center');
}

function draw(ctx, snap) {
  const H = heightOf(snap);
  const p = P.get(P.idFromClass(snap.colorClass));
  ctx.clearRect(0, 0, WIDTH, H);
  ctx.fillStyle = C.page;
  ctx.fillRect(0, 0, WIDTH, H);
  let y = nav(ctx, snap) + 16;
  y = quote(ctx, snap, y);
  y = chartCard(ctx, snap, y, p);
  summary(ctx, snap, y, p);
  watermark(ctx, H);
}

module.exports = { WIDTH, heightOf, draw };
