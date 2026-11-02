// 海报绘图原语：纯 ctx，不碰 wx。坐标 / 尺寸一律是画布像素 —— 版式按 1080 设计坐标乘 s 后传进来。
// 视觉细节（圆角、描边、投影、星形）都对齐 docs/superpowers/mockups/refined.html。
const { COLOR, cn } = require('./tokens.js');

// ---------- 基础形状 ----------

function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h);
  ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
}

function fillRoundRect(ctx, x, y, w, h, r, fill) {
  roundRectPath(ctx, x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
}

/** 在 fn 执行期间开投影；s = 画布缩放（投影参数按 1080 设计坐标给） */
function withShadow(ctx, shadow, s, fn) {
  ctx.save();
  ctx.shadowColor = shadow.color;
  ctx.shadowBlur = shadow.blur * s;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = (shadow.y || 0) * s;
  fn();
  ctx.restore();
}

const SHADOW = {
  cover: { color: 'rgba(20,25,35,0.10)', blur: 16, y: 6 },
  card: { color: 'rgba(30,35,45,0.16)', blur: 40, y: 26 },
  soft: { color: 'rgba(20,30,50,0.14)', blur: 22, y: 6 }
};

/** aspectFill：图片按比例铺满 w×h，返回源图裁切框 [sx, sy, sw, sh] */
function coverCrop(iw, ih, w, h, focusY) {
  const k = Math.max(w / iw, h / ih);
  const sw = w / k, sh = h / k;
  const fy = focusY == null ? 0.5 : focusY;
  return [(iw - sw) / 2, Math.max(0, Math.min(ih - sh, (ih - sh) * fy)), sw, sh];
}

/**
 * 封面：aspectFill + 圆角 + 极淡描边 + 投影（refined.html 的 .cover）。
 * node 为 null → 浅灰占位 + 片名首字。opts: { r, s, shadow:true|false|SHADOW.x, hairline:true, title, focusY }
 */
function drawCover(ctx, node, x, y, w, h, opts) {
  const o = opts || {};
  const s = o.s || 1;
  const r = o.r == null ? 8 * s : o.r;
  const shadow = o.shadow === false ? null : (o.shadow && o.shadow.color ? o.shadow : SHADOW.cover);
  if (shadow) withShadow(ctx, shadow, s, () => fillRoundRect(ctx, x, y, w, h, r, COLOR.placeholder));

  ctx.save();
  roundRectPath(ctx, x, y, w, h, r);
  ctx.clip();
  if (node && node.width && node.height) {
    const c = coverCrop(node.width, node.height, w, h, o.focusY);
    ctx.drawImage(node, c[0], c[1], c[2], c[3], x, y, w, h);
  } else {
    ctx.fillStyle = COLOR.placeholder;
    ctx.fillRect(x, y, w, h);
    const ch = Array.from(String(o.title || ''))[0];
    if (ch && w > 24 * s) {
      ctx.fillStyle = COLOR.ink3;
      ctx.font = cn(700, Math.min(w, h) * 0.36);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(ch, x + w / 2, y + h / 2);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
    }
  }
  ctx.restore();

  if (o.hairline !== false) {
    roundRectPath(ctx, x + 0.5, y + 0.5, w - 1, h - 1, r);
    ctx.strokeStyle = 'rgba(0,0,0,0.06)';
    ctx.lineWidth = Math.max(1, 1.5 * s);
    ctx.stroke();
  }
}

/** 绕 (cx, cy) 转 deg 度后执行 fn；fn 里的坐标以 (cx, cy) 为原点 */
function rotated(ctx, cx, cy, deg, fn) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(deg * Math.PI / 180);
  fn();
  ctx.restore();
}

/** 圆角只在上面两个角的矩形路径（票根上半截 clip 用） */
function topRoundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x, y + h);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h);
  ctx.closePath();
}

// ---------- 线 ----------

function line(ctx, x1, y1, x2, y2, width, color) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.lineWidth = width;
  ctx.strokeStyle = color;
  ctx.stroke();
}

function dashed(ctx, x1, y1, x2, y2, width, color, dash, gap) {
  ctx.save();
  ctx.setLineDash([dash, gap]);
  line(ctx, x1, y1, x2, y2, width, color);
  ctx.restore();
}

// ---------- 星级 ----------
// 与精修稿 SVG 同一条路径（24 网格）：M12 2.5 l2.9 6.1 6.6.8 -4.9 4.6 1.3 6.6 L12 17.3 l-5.9 3.3 1.3-6.6 L2.5 9.4 l6.6-.8z
const STAR_PTS = [[12, 2.5], [14.9, 8.6], [21.5, 9.4], [16.6, 14], [17.9, 20.6], [12, 17.3], [6.1, 20.6], [7.4, 14], [2.5, 9.4], [9.1, 8.6]];

function starPath(ctx, x, y, size) {
  const k = size / 24;
  ctx.beginPath();
  STAR_PTS.forEach((p, i) => (i ? ctx.lineTo(x + p[0] * k, y + p[1] * k) : ctx.moveTo(x + p[0] * k, y + p[1] * k)));
  ctx.closePath();
}

/** 一排 5 颗星，左上角 (x, y)；n = 亮几颗（0~5）。返回总宽 */
function stars(ctx, x, y, n, size, gap, onColor, offColor) {
  for (let i = 0; i < 5; i++) {
    starPath(ctx, x + i * (size + gap), y, size);
    ctx.fillStyle = i < n ? (onColor || COLOR.acc) : (offColor || COLOR.starOff);
    ctx.fill();
  }
  return 5 * size + 4 * gap;
}

// ---------- 票根 / 小票 ----------

/**
 * 票根外轮廓：圆角矩形 + 两侧在 notchY 处各一个向内的半圆缺口。
 * 直接 fill 这条路径，缺口处就露出下面的背景（导出 jpg 时也是背景色，不会是黑块）。
 */
function ticketPath(ctx, x, y, w, h, r, notchY, notchR) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, notchY - notchR);
  ctx.arc(x + w, notchY, notchR, -Math.PI / 2, Math.PI / 2, true);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, notchY + notchR);
  ctx.arc(x, notchY, notchR, Math.PI / 2, -Math.PI / 2, true);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

/** 小票外轮廓：上下两条锯齿边（齿宽 tooth），左右直边 */
function receiptPath(ctx, x, y, w, h, tooth) {
  const n = Math.max(1, Math.round(w / tooth));
  const t = w / n, d = t / 2;
  ctx.beginPath();
  ctx.moveTo(x, y + d);
  for (let i = 0; i < n; i++) {
    ctx.lineTo(x + i * t + t / 2, y);
    ctx.lineTo(x + (i + 1) * t, y + d);
  }
  ctx.lineTo(x + w, y + h - d);
  for (let i = n - 1; i >= 0; i--) {
    ctx.lineTo(x + i * t + t / 2, y + h);
    ctx.lineTo(x + i * t, y + h - d);
  }
  ctx.closePath();
}

// ---------- 伪随机（同一份数据每次画得一样） ----------

function hashStr(str) {
  let h = 2166136261;
  const s = String(str || '');
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function seeded(str) {
  let a = hashStr(str) || 1;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 条形码：由 seed 决定粗细，同一 seed 图案固定；左上角 (x, y)，返回总宽 */
function barcode(ctx, x, y, h, seed, unit, bars, color) {
  const rnd = seeded(seed);
  let cx = x;
  ctx.fillStyle = color || COLOR.ink;
  for (let i = 0; i < bars; i++) {
    const bw = (1 + Math.floor(rnd() * 3)) * unit;
    const tall = i % 6 === 0;
    ctx.fillRect(cx, tall ? y : y + h * 0.12, bw, tall ? h : h * 0.88);
    cx += bw + (1 + Math.floor(rnd() * 2)) * unit;
  }
  return cx - x;
}

// ---------- 点阵 / 胶片 ----------

/** 点阵：dots 为 'w'|'h'|'u'，colors 对应三种颜色；cell = 点心距，r = 半径 */
function dotMatrix(ctx, x, y, cols, cellX, cellY, r, dots, colors) {
  dots.forEach((d, i) => {
    const cx = x + (i % cols) * cellX + r;
    const cy = y + Math.floor(i / cols) * cellY + r;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = colors[d] || colors.u;
    ctx.fill();
  });
}

/** 胶片齿孔：沿 (x, y) 起、长 len 的一条，水平或竖直排列 */
function filmHoles(ctx, x, y, len, vertical, holeW, holeH, gap, color) {
  const step = (vertical ? holeH : holeW) + gap;
  const n = Math.max(1, Math.floor((len + gap) / step));
  const offset = (len - (n * step - gap)) / 2;
  ctx.fillStyle = color;
  for (let i = 0; i < n; i++) {
    const p = offset + i * step;
    fillRoundRect(ctx, vertical ? x : x + p, vertical ? y + p : y, holeW, holeH, Math.min(holeW, holeH) * 0.25, color);
  }
}

// ---------- 署名 ----------

const WATERMARK = '使用小程序「标记吧」生成';

/** 底部署名「● 使用小程序「标记吧」生成」，(cx, baselineY) 居中；s = 画布缩放 */
function watermark(ctx, cx, y, s, color) {
  ctx.font = cn(400, 20 * s);
  const tw = ctx.measureText(WATERMARK).width;
  const dot = 4 * s, gap = 10 * s;
  const x0 = cx - (tw + dot * 2 + gap) / 2;
  ctx.beginPath();
  ctx.arc(x0 + dot, y - 7 * s, dot, 0, Math.PI * 2);
  ctx.fillStyle = COLOR.acc;
  ctx.fill();
  ctx.fillStyle = color || COLOR.ink3;
  ctx.textAlign = 'left';
  ctx.fillText(WATERMARK, x0 + dot * 2 + gap, y);
}

module.exports = {
  SHADOW, WATERMARK,
  roundRectPath, fillRoundRect, withShadow, coverCrop, drawCover, rotated, topRoundRectPath,
  line, dashed, starPath, stars,
  ticketPath, receiptPath,
  hashStr, seeded, barcode,
  dotMatrix, filmHoles, watermark
};
