// 封面取色模糊底：把封面缩成很小的图再放大铺满，就是模糊效果；再叠一层白，得到和封面同色系的淡底。
// 小程序 canvas 不保证支持 ctx.filter，所以不用 blur()，用「缩小再放大」—— 所有机型都能画。
// 同时顺手算出封面的平均色和亮度：杂志版式按亮度调遮罩，票夹的色带用平均色。
//
// 要真机验证的点（设计文档第 7 节）：离屏 canvas 能不能 drawImage 到页面 canvas 上、放大后够不够匀。
// 任何一步失败都退回平均色纯色底，再不行退回浅灰 —— 海报照样能出。
const { COLOR } = require('./tokens.js');
const { coverCrop } = require('./kit.js');

const SMALL = [12, 16];     // 第一级：缩到 12×16
const MID = [48, 64];       // 第二级：放大到 48×64，再放大到成品 —— 两级放大比一步到位匀
const LOAD_TIMEOUT = 3000;

const _cache = {};          // src → tint，同一张封面切版式 / 改标题时不重算

function makeOffscreen(w, h) {
  try {
    if (typeof wx === 'undefined' || !wx.createOffscreenCanvas) return null;
    const c = wx.createOffscreenCanvas({ type: '2d', width: w, height: h });
    return c && c.getContext ? c : null;
  } catch (e) {
    return null;
  }
}

// 页面 canvas 的 image 节点不一定能画进离屏 canvas：用它的 src（本地临时路径）在离屏 canvas 上重新建一个
function loadOn(canvas, src) {
  return new Promise(resolve => {
    if (!src || !canvas.createImage) return resolve(null);
    const img = canvas.createImage();
    const timer = setTimeout(() => resolve(null), LOAD_TIMEOUT);
    img.onload = () => { clearTimeout(timer); resolve(img); };
    img.onerror = () => { clearTimeout(timer); resolve(null); };
    img.src = src;
  });
}

function averageOf(ctx, w, h) {
  try {
    const d = ctx.getImageData(0, 0, w, h).data;
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
    if (!n) return null;
    r = Math.round(r / n); g = Math.round(g / n); b = Math.round(b / n);
    return { r, g, b, lum: (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 };
  } catch (e) {
    return null;
  }
}

// 糊开的颜色会发灰：提饱和 1.6、提亮 1.15（精修稿 CSS 的 saturate(1.6) brightness(1.15)）。
// 只在 48×64 的中间图上逐像素算，三千个像素，不费时。getImageData 不支持就跳过。
const SATURATE = 1.6, BRIGHTEN = 1.15;
function vivid(ctx, w, h) {
  try {
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      const gray = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      d[i] = clamp255((gray + (r - gray) * SATURATE) * BRIGHTEN);
      d[i + 1] = clamp255((gray + (g - gray) * SATURATE) * BRIGHTEN);
      d[i + 2] = clamp255((gray + (b - gray) * SATURATE) * BRIGHTEN);
    }
    ctx.putImageData(img, 0, 0);
  } catch (e) { /* 不支持就保持原色 */ }
}
function clamp255(v) { return v < 0 ? 0 : v > 255 ? 255 : Math.round(v); }

/**
 * 为一张封面准备模糊底素材。node = 页面 canvas.createImage 出来的封面（可为 null）。
 * 返回 { blurred: 离屏 canvas | null, avg: {r,g,b,lum} | null }
 */
async function prepareTint(node) {
  const src = node && node.src;
  if (!src) return { blurred: null, avg: null };
  if (_cache[src]) return _cache[src];

  const out = { blurred: null, avg: null };
  const small = makeOffscreen(SMALL[0], SMALL[1]);
  if (small) {
    const img = await loadOn(small, src);
    if (img && img.width && img.height) {
      const sctx = small.getContext('2d');
      const c = coverCrop(img.width, img.height, SMALL[0], SMALL[1]);
      sctx.drawImage(img, c[0], c[1], c[2], c[3], 0, 0, SMALL[0], SMALL[1]);
      out.avg = averageOf(sctx, SMALL[0], SMALL[1]);
      const mid = makeOffscreen(MID[0], MID[1]);
      if (mid) {
        const mctx = mid.getContext('2d');
        mctx.imageSmoothingEnabled = true;
        if ('imageSmoothingQuality' in mctx) mctx.imageSmoothingQuality = 'high';
        mctx.drawImage(small, 0, 0, MID[0], MID[1]);
        vivid(mctx, MID[0], MID[1]);
        out.blurred = mid;
      }
    }
  }
  _cache[src] = out;
  return out;
}

/**
 * 画模糊底：tint 来自 prepareTint。wash = 白色蒙层不透明度（精修稿是 0.5）。
 * 失败顺序：模糊图 → 平均色纯色 → 浅灰。
 */
function drawTint(ctx, tint, W, H, wash) {
  const t = tint || {};
  let drawn = false;
  if (t.blurred) {
    try {
      ctx.save();
      ctx.imageSmoothingEnabled = true;
      if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high';
      // 四边各外扩一点，避免放大后边缘发暗
      const bleed = Math.round(W * 0.06);
      ctx.drawImage(t.blurred, -bleed, -bleed, W + bleed * 2, H + bleed * 2);
      ctx.restore();
      drawn = true;
    } catch (e) {
      ctx.restore();
    }
  }
  if (!drawn) {
    ctx.fillStyle = t.avg ? `rgb(${t.avg.r},${t.avg.g},${t.avg.b})` : COLOR.mist;
    ctx.fillRect(0, 0, W, H);
  }
  const w = wash == null ? 0.5 : wash;
  if (w > 0) {
    ctx.fillStyle = `rgba(255,255,255,${w})`;
    ctx.fillRect(0, 0, W, H);
  }
}

/** 在 (x, y, w, h) 里画模糊图（aspectFill + 裁切），没有模糊图退平均色 / 深灰。调用方负责 clip */
function drawTintRect(ctx, tint, x, y, w, h) {
  const t = tint || {};
  if (t.blurred) {
    try {
      const bw = t.blurred.width, bh = t.blurred.height;
      // 往里收一圈像素：放大后边缘像素会拉出暗边
      const c = coverCrop(bw - 4, bh - 4, w, h);
      ctx.save();
      ctx.imageSmoothingEnabled = true;
      if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(t.blurred, c[0] + 2, c[1] + 2, c[2], c[3], x, y, w, h);
      ctx.restore();
      return;
    } catch (e) {
      ctx.restore();
    }
  }
  ctx.fillStyle = t.avg ? `rgb(${t.avg.r},${t.avg.g},${t.avg.b})` : STAGE_FALLBACK;
  ctx.fillRect(x, y, w, h);
}

/**
 * 暗场景底（v4 单部海报）：封面糊开铺满，再压一层中心浅、四角深的暗角 ——
 * 白色卡片 / 相纸 / 小票放上去才是全图最亮的东西（参照每日选片票卡的深色遮罩）。
 */
const STAGE_FALLBACK = '#2A2D33';
function drawStage(ctx, tint, W, H, mode) {
  drawTintRect(ctx, tint, 0, 0, W, H);
  const cx = W / 2, cy = H * 0.42;
  const r = Math.hypot(Math.max(cx, W - cx), Math.max(cy, H - cy));
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  if (mode === 'light') {
    // 浅色：同一张糊开的封面罩一层白，中心更亮 —— 「清新」那一档，物件靠投影浮起来
    g.addColorStop(0, 'rgba(255,255,255,0.66)');
    g.addColorStop(1, 'rgba(255,255,255,0.46)');
  } else {
    g.addColorStop(0, 'rgba(12,10,10,0.18)');
    g.addColorStop(0.7, 'rgba(12,10,10,0.55)');
    g.addColorStop(1, 'rgba(12,10,10,0.72)');
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

/** 场景底上直接写的字 / 署名 / 物件投影的颜色，跟着深浅走 */
function stageInk(mode) {
  return mode === 'light'
    ? { ink: '#16181D', ink2: 'rgba(22,24,29,0.62)', wm: 'rgba(22,24,29,0.5)', shadow: 'rgba(30,35,45,0.22)' }
    : { ink: '#FFFFFF', ink2: 'rgba(255,255,255,0.72)', wm: 'rgba(255,255,255,0.62)', shadow: 'rgba(0,0,0,0.45)' };
}

/**
 * 「热敏打印」黑白高反差封面（小票版式）：在离屏 canvas 上按 w×h 裁好、转灰度、提对比。
 * 精修稿 CSS = grayscale(1) contrast(1.45) brightness(1.08)。失败返回 null，版式退回彩色封面。
 */
const _thermalCache = {};
async function prepareThermal(node, w, h, focusY) {
  const src = node && node.src;
  if (!src) return null;
  const key = `${src}|${w}x${h}`;
  if (key in _thermalCache) return _thermalCache[key];
  let out = null;
  const c = makeOffscreen(w, h);
  if (c) {
    const img = await loadOn(c, src);
    if (img && img.width && img.height) {
      try {
        const cctx = c.getContext('2d');
        const k = coverCrop(img.width, img.height, w, h, focusY);
        cctx.drawImage(img, k[0], k[1], k[2], k[3], 0, 0, w, h);
        const data = cctx.getImageData(0, 0, w, h);
        const d = data.data;
        for (let i = 0; i < d.length; i += 4) {
          const g = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
          const v = clamp255(((g - 128) * 1.45 + 128) * 1.08);
          d[i] = d[i + 1] = d[i + 2] = v;
        }
        cctx.putImageData(data, 0, 0);
        out = c;
      } catch (e) { out = null; }
    }
  }
  _thermalCache[key] = out;
  return out;
}

/** 把平均色提亮到 HSL 亮度 ≥ minL（0~1），票夹色带用，避免发暗发脏 */
function brighten(avg, minL) {
  if (!avg) return null;
  const r = avg.r / 255, g = avg.g / 255, b = avg.b / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const target = Math.max(l, minL == null ? 0.7 : minL);
  if (target === l) return `rgb(${avg.r},${avg.g},${avg.b})`;
  // 按比例往白色推
  const k = (target - l) / (1 - l || 1);
  const mix = v => Math.round((v + (1 - v) * k) * 255);
  return `rgb(${mix(r)},${mix(g)},${mix(b)})`;
}

module.exports = { prepareTint, drawTint, drawTintRect, drawStage, stageInk, prepareThermal, brighten, averageOf };
