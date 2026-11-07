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

/** 一排 5 颗星，左上角 (x, y)；n = 亮几颗（0~5，可以是 4.5：最后一颗亮半边）。返回总宽 */
function stars(ctx, x, y, n, size, gap, onColor, offColor) {
  for (let i = 0; i < 5; i++) {
    const sx = x + i * (size + gap);
    const part = Math.max(0, Math.min(1, n - i));
    starPath(ctx, sx, y, size);
    ctx.fillStyle = part === 1 ? (onColor || COLOR.acc) : (offColor || COLOR.starOff);
    ctx.fill();
    if (part > 0 && part < 1) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(sx, y, size * part, size);
      ctx.clip();
      starPath(ctx, sx, y, size);
      ctx.fillStyle = onColor || COLOR.acc;
      ctx.fill();
      ctx.restore();
    }
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

/** 铺满宽度 w 的条码（等高），最后一根按右边界裁齐 */
function barcodeFill(ctx, x, y, w, h, seed, unit, color) {
  const rnd = seeded(seed);
  const end = x + w;
  let cx = x;
  ctx.fillStyle = color || COLOR.ink;
  while (cx < end) {
    const bw = Math.min((1 + Math.floor(rnd() * 3)) * unit, end - cx);
    ctx.fillRect(cx, y, bw, h);
    cx += bw + (1 + Math.floor(rnd() * 2)) * unit;
  }
}

// 一维盒式模糊：src 里从 start 起、每隔 step 取一个值，共 n 个，半径 r，结果写回原位
function boxLine(src, start, step, n, r, tmp) {
  let sum = 0;
  const size = r * 2 + 1;
  for (let i = -r; i <= r; i++) sum += src[start + Math.max(0, Math.min(n - 1, i)) * step];
  for (let i = 0; i < n; i++) {
    tmp[i] = sum / size;
    sum += src[start + Math.min(n - 1, i + r + 1) * step] - src[start + Math.max(0, i - r) * step];
  }
  for (let i = 0; i < n; i++) src[start + i * step] = tmp[i];
}

/**
 * 油墨边：把 (x, y, w, h) 里已经画好的字压成铅印那种毛边。
 * 先把字晕开 radius 像素，再加噪声过阈值：笔画变粗、边缘不规则，字角被磨圆 —— 只动抗锯齿那 1 像素是看不出来的。
 * 颜色按预乘透明度一起晕开，所以多色的字（墨色 + 点缀色）各走各的。
 * opts: { radius 晕开半径, strength 毛边幅度, threshold 阈值（越低字越粗，细笔画才不断） }
 * 大约 1 百万像素的区域手机上要几十毫秒，只在选了这个效果时跑。getImageData 不可用时什么都不做。
 */
function inkEdge(ctx, x, y, w, h, seed, opts) {
  let img;
  try { img = ctx.getImageData(x, y, w, h); } catch (e) { return false; }
  const o = opts || {};
  const r = o.radius || 1, k = o.strength == null ? 0.4 : o.strength, cut = o.threshold == null ? 0.36 : o.threshold;
  const d = img.data, n = w * h;
  const buf = new Float32Array(n * 4);
  for (let p = 0, q = 0; p < n; p++, q += 4) {
    const a = d[q + 3] / 255;
    buf[q] = d[q] * a; buf[q + 1] = d[q + 1] * a; buf[q + 2] = d[q + 2] * a; buf[q + 3] = a;
  }
  const tmp = new Float32Array(Math.max(w, h));
  for (let c = 0; c < 4; c++) {
    for (let row = 0; row < h; row++) boxLine(buf, row * w * 4 + c, 4, w, r, tmp);
    for (let col = 0; col < w; col++) boxLine(buf, col * 4 + c, w * 4, h, r, tmp);
  }
  // 低频噪声决定边往里还是往外走，高频噪声出毛刺
  const rnd = seeded(seed);
  const STEP = 4, nw = Math.ceil(w / STEP) + 2, nh = Math.ceil(h / STEP) + 2;
  const noise = new Float32Array(nw * nh);
  for (let i = 0; i < noise.length; i++) noise[i] = rnd() - 0.5;
  for (let py = 0, q = 0; py < h; py++) {
    const gy = py / STEP, y0 = Math.floor(gy), fy = gy - y0;
    for (let px = 0; px < w; px++, q += 4) {
      const a = buf[q + 3];
      if (a < 0.01) { d[q + 3] = 0; continue; }
      const gx = px / STEP, x0 = Math.floor(gx), fx = gx - x0;
      const top = noise[y0 * nw + x0] * (1 - fx) + noise[y0 * nw + x0 + 1] * fx;
      const bot = noise[(y0 + 1) * nw + x0] * (1 - fx) + noise[(y0 + 1) * nw + x0 + 1] * fx;
      const v = a + (top * (1 - fy) + bot * fy) * k + (rnd() - 0.5) * k * 0.35;
      const t = (v - cut) / 0.1;
      d[q] = buf[q] / a; d[q + 1] = buf[q + 1] / a; d[q + 2] = buf[q + 2] / a;
      d[q + 3] = t <= 0 ? 0 : t >= 1 ? 255 : Math.round(t * 255);
    }
  }
  ctx.putImageData(img, x, y);
  return true;
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

/** 底部署名「● 使用小程序「标记吧」生成」，(cx, baselineY) 居中；s = 画布缩放；dotColor 默认强调色；font 默认中文黑体 */
function watermark(ctx, cx, y, s, color, dotColor, font) {
  ctx.font = (font || cn)(400, 20 * s);
  const tw = ctx.measureText(WATERMARK).width;
  const dot = 4 * s, gap = 10 * s;
  const x0 = cx - (tw + dot * 2 + gap) / 2;
  ctx.beginPath();
  ctx.arc(x0 + dot, y - 7 * s, dot, 0, Math.PI * 2);
  ctx.fillStyle = dotColor || COLOR.acc;
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
  hashStr, seeded, barcode, barcodeFill, inkEdge,
  dotMatrix, filmHoles, watermark
};
