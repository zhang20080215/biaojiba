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

module.exports = { prepareTint, drawTint, brighten, averageOf };
