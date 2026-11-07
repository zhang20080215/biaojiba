// 范围海报的公共底子（小票、票夹共用）：配色表、渐变底、放映机、光柱、标题。
// 配色和光柱是小票反复改出来的，定稿的取舍都在 rangeStatement.js 头注释里。
const T = require('../tokens.js');
const kit = require('../kit.js');
const text = require('../text.js');
const tint = require('../tint.js');

const W = 1080;
const HEAD_H = 182;                             // 抬头（放映机 + 标题）的高度
const PROJECTOR_MID = 69;                       // 放映机竖直中线，相对抬头上沿
const BEAM_BOTTOM = 198;                        // 光柱在画布右缘的下沿，相对抬头上沿（比抬头低，光柱才是朝右张开的）

function hexRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return `${n >> 16},${(n >> 8) & 255},${n & 255}`;
}

/** a 往 b 混 t（0~1）：油墨字要不透明的浅色，半透明字过 inkEdge 会变成实色 */
function mixHex(a, b, t) {
  const pa = hexRgb(a).split(',').map(Number), pb = hexRgb(b).split(',').map(Number);
  return `rgb(${pa.map((v, i) => Math.round(v + (pb[i] - v) * t)).join(',')})`;
}

// 一套配色：bg = 整张海报的斜向渐变（云霞用 glows 两团柔光），ink 墨色，accent 点缀色，beam 光柱色，hole 放映机上挖出来的孔的颜色。
// paper* 是白票上的字：深色配色的 ink 是浅色，落到白纸上看不见，要另给一组。shadow 是票的投影色，带底色才不脏
function palette(o) {
  const ink = hexRgb(o.ink);
  const paperInk = o.paperInk || o.ink;
  return {
    paper: o.paper || '#FFFDF9', paperInk, paperAccent: o.paperAccent || o.accent,
    paperSoft: mixHex(paperInk, '#FFFDF9', 0.38), paperFaint: mixHex(paperInk, '#FFFDF9', 0.8),
    shadow: o.shadow,
    id: o.id, name: o.name, bg: o.bg, deep: !!o.deep, glows: o.glows || null,
    f: T.cn, n: T.num, fw: 0,
    softSolid: mixHex(o.ink, o.hole, o.deep ? 0.24 : 0.34), faintSolid: mixHex(o.ink, o.hole, o.deep ? 0.7 : 0.76),
    ink: o.ink, accent: o.accent, title: o.title || o.ink,
    soft: `rgba(${ink},${o.deep ? 0.76 : 0.66})`, faint: `rgba(${ink},${o.deep ? 0.3 : 0.22})`,
    beam: o.beam, beamA: o.beamA || [0.6, 0.14], hole: o.hole,
    titleShadow: o.deep ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0)',
    wm: `rgba(${ink},0.6)`,
    speckA: o.deep ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.22)',
    speckB: o.deep ? 'rgba(0,0,0,0.06)' : `rgba(${ink},0.035)`
  };
}

const PALETTES = [
  palette({ id: 'cloud', name: '云霞', bg: ['#A9D0FB', '#FFFFFF', '#F7CFE7'], glows: ['143,196,252', '247,204,230'],
    ink: '#2C4368', accent: '#E0659F', beam: '250,176,214', beamA: [0.55, 0.14], hole: '#EDF4FC', shadow: '96,124,180' }),
  palette({ id: 'pinkBlue', name: '粉蓝', bg: ['#FDE3E3', '#F1E6F5', '#C8EDFE'],
    ink: '#28304C', accent: '#EF6355', beam: '255,178,140', hole: '#F2EEF6', shadow: '110,110,160' }),
  palette({ id: 'night', name: '夜幕', deep: true, bg: ['#24346F', '#6B3A8C', '#C74F6D'],
    ink: '#FFEEDA', title: '#FFF7EC', accent: '#FFC56A', beam: '255,208,140', hole: '#3F3166', shadow: '18,10,46',
    paperInk: '#2A2350', paperAccent: '#E0862B' }),
  palette({ id: 'olive', name: '橄榄', deep: true, bg: ['#8A9650', '#6A7437', '#4F5A28'],
    ink: '#F7E487', title: '#FFF7CE', accent: '#FFD24F', beam: '255,238,160', hole: '#5D6730', shadow: '38,42,12',
    paperInk: '#363C16', paperAccent: '#BC8A0E' }),
  palette({ id: 'paper', name: '米白', bg: ['#F4F0E7', '#E9E4D8', '#DDD7C9'],
    ink: '#1D1E20', accent: '#1D1E20', beam: '232,178,74', hole: '#F5F2EA', shadow: '90,80,60' })
];
const PALETTE = {};
PALETTES.forEach(p => { PALETTE[p.id] = p; });
const DEFAULT_PALETTE = 'pinkBlue';
/** 油墨字：换粗宋、字重加半档（粗宋笔画细；再粗笔画多的字会糊成一团），浅色换成不透明的，标题不要影子（影子也会被压成实色） */
function withInk(P) {
  return Object.assign({}, P, {
    f: T.serif, n: (w, size) => T.serif(w, size), fw: 100,
    soft: P.softSolid, faint: P.faintSolid, titleShadow: 'rgba(0,0,0,0)'
  });
}

// 分享页选项用
const PALETTE_LIST = PALETTES.map(p => ({ id: p.id, name: p.name, swatch: `linear-gradient(135deg, ${p.bg.join(', ')})` }));

/** 纸张颗粒：随机撒浅、深两种细点，范围内同一 seed 每次一样 */
function grain(ctx, x, y, w, h, seed, colorA, colorB) {
  const rnd = kit.seeded(seed);
  const n = Math.round(w * h / 700);
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = i % 2 ? colorA : colorB;
    const s = rnd() < 0.12 ? 2 : 1;
    ctx.fillRect(x + rnd() * w, y + rnd() * h, s, s);
  }
}

function fillPage(ctx, H, P) {
  if (P.glows) {
    // 两团柔光：从左上、右下两个角漫开，没有边
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, W, H);
    const r = Math.max(W, H) * 0.72;
    P.glows.forEach((color, i) => {
      const cx = i ? W : 0, cy = i ? H : 0;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, `rgba(${color},0.6)`);
      g.addColorStop(1, `rgba(${color},0)`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    });
    return;
  }
  const g = ctx.createLinearGradient(0, 0, W, H);
  P.bg.forEach((c, i) => g.addColorStop(i / (P.bg.length - 1), c));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

/**
 * 放映机（侧面朝右），(x, y) 是左上角，设计尺寸 150×124，返回镜头中心。
 * 整体一个墨色剪影，细节用底色挖出来（片盘的孔、机身散热槽）—— 小尺寸下比线稿耐看。
 */
function drawProjector(ctx, x, y, P) {
  const ink = P.ink, hole = P.hole;
  const reel = (cx, cy, r) => {
    ctx.fillStyle = ink;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = hole;
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + i * Math.PI * 2 / 5;
      ctx.beginPath(); ctx.arc(cx + Math.cos(a) * r * 0.55, cy + Math.sin(a) * r * 0.55, r * 0.2, 0, Math.PI * 2); ctx.fill();
    }
    ctx.beginPath(); ctx.arc(cx, cy, r * 0.13, 0, Math.PI * 2); ctx.fill();
  };
  reel(x + 42, y + 30, 30);
  reel(x + 100, y + 36, 24);
  // 机身
  kit.fillRoundRect(ctx, x + 14, y + 62, 112, 44, 7, ink);
  // 散热槽
  for (let i = 0; i < 4; i++) kit.fillRoundRect(ctx, x + 28 + i * 11, y + 74, 5, 20, 2, hole);
  // 旋钮
  ctx.fillStyle = hole;
  ctx.beginPath(); ctx.arc(x + 102, y + 84, 7, 0, Math.PI * 2); ctx.fill();
  // 镜头：从机身往外收的短筒
  ctx.fillStyle = ink;
  ctx.beginPath();
  ctx.moveTo(x + 122, y + 70);
  ctx.lineTo(x + 146, y + 74);
  ctx.lineTo(x + 146, y + 94);
  ctx.lineTo(x + 122, y + 98);
  ctx.closePath();
  ctx.fill();
  // 支脚
  kit.fillRoundRect(ctx, x + 30, y + 104, 12, 14, 2, ink);
  kit.fillRoundRect(ctx, x + 96, y + 104, 12, 14, 2, ink);
  kit.fillRoundRect(ctx, x + 18, y + 116, 102, 6, 3, ink);
  return { x: x + 146, y: y + 84 };
}

/** 一个光锥：镜头处窄、向右张开。(ox, oy) 是原点偏移，k 是缩放（离屏小图用） */
function fillCone(ctx, lens, top, bottom, right, ox, oy, k, P, alpha) {
  const g = ctx.createLinearGradient((lens.x - ox) * k, 0, (right - ox) * k, 0);
  g.addColorStop(0, `rgba(${P.beam},${P.beamA[0] * alpha})`);
  g.addColorStop(0.5, `rgba(${P.beam},${P.beamA[0] * 0.6 * alpha})`);
  g.addColorStop(1, `rgba(${P.beam},${P.beamA[1] * alpha})`);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo((lens.x - ox) * k, (lens.y - 9 - oy) * k);
  ctx.lineTo((right - ox) * k, (top - oy) * k);
  ctx.lineTo((right - ox) * k, (bottom - oy) * k);
  ctx.lineTo((lens.x - ox) * k, (lens.y + 9 - oy) * k);
  ctx.closePath();
  ctx.fill();
}

/** 光柱：从镜头向右打开到小票右缘，里面飘一点灰尘。
 * 小程序 canvas 不保证有 blur：先画到八分之一大小的离屏图，再放大贴回来，边缘自然就柔了。
 * 叠多层锥形也能出柔边，但深色底上看得见一层层的台阶，所以只在离屏图不可用时退回去。 */
function drawBeam(ctx, lens, top, bottom, right, P, seed) {
  const SCALE = 1 / 8, PAD = 48;
  const ox = lens.x - PAD, oy = top - PAD;
  const bw = right + PAD - ox, bh = bottom + PAD - oy;
  const small = tint.makeOffscreen(Math.ceil(bw * SCALE), Math.ceil(bh * SCALE));
  if (small) {
    fillCone(small.getContext('2d'), lens, top, bottom, right, ox, oy, SCALE, P, 1);
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(small, ox, oy, small.width / SCALE, small.height / SCALE);
    ctx.restore();
  } else {
    for (let i = 0; i < 7; i++) {
      const t = 1 - i * 0.055;
      fillCone(ctx, lens, lens.y - (lens.y - top) * t, lens.y + (bottom - lens.y) * t, right, 0, 0, 1, P, 1 / 7);
    }
  }
  // 灰尘：越远越散
  const rnd = kit.seeded(seed);
  for (let i = 0; i < 46; i++) {
    const t = 0.08 + rnd() * 0.9;
    const px = lens.x + (right - lens.x) * t;
    const spread = (rnd() - 0.5) * 1.7;
    const py = lens.y + spread * (spread < 0 ? lens.y - top : bottom - lens.y) * t;
    ctx.fillStyle = `rgba(${P.beam},${0.25 + rnd() * 0.5})`;
    ctx.beginPath();
    ctx.arc(px, py, 0.8 + rnd() * 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
}

// 放映机最左边是大片盘（设计坐标 x = 12），往左挪 12，整机才和内容左缘对齐
function projectorX(x0) { return x0 - 12; }
function lensOf(x0, y) { return { x: projectorX(x0) + 146, y: y + 8 + 84 }; }

/** 标题排版：一行放得下用大字，放不下折两行（自定义标题最多 20 字，两行一定放得下） */
function titleLines(ctx, str, room, P) {
  const SPACING = 4;
  const measureAt = size => {
    ctx.font = P.f(700 + P.fw, size);
    return t => ctx.measureText(t).width + SPACING * Math.max(0, Array.from(t).length - 1);
  };
  const sizes = [64, 56, 48, 40];
  for (let i = 0; i < sizes.length; i++) {
    if (measureAt(sizes[i])(str) <= room) return { size: sizes[i], lines: [str] };
  }
  return text.fitTitle(str, room, [38, 34, 30, 26], measureAt);
}

/**
 * 抬头：放映机 + 打在光柱里的标题 + 起止日期。x0 / x1 是内容左右边界，光柱另外画（它不走油墨）。
 * 放映机贴左边界，标题和日期在放映机右边的空间里居中，整块与放映机在同一条水平中线上。
 * accentWord：标题里要用点缀色的那段（票夹的张数），只在标题一行放得下时生效。返回标题占的矩形（油墨要按字号单独压）。
 */
function drawHeader(ctx, x0, x1, y, title, span, P, fontsReady, accentWord) {
  drawProjector(ctx, projectorX(x0), y + 8, P);
  return drawTitleBlock(ctx, x0 + 186, x1, y + PROJECTOR_MID, title, span, P, fontsReady, accentWord);
}

/** 标题 + 日期：在 left~right 里居中，整块的竖直中线在 midY。返回标题占的矩形 */
function drawTitleBlock(ctx, left, right, midY, title, span, P, fontsReady, accentWord) {
  const room = right - left, cx = left + room / 2;
  const SPACING = 4;
  const fit = titleLines(ctx, title, room, P);
  const lh = Math.round(fit.size * 1.22);
  const cap = fit.size * 0.42, dateMid = fit.size / 2 + 24, DATE_HALF = 10;
  const blockH = cap + (fit.lines.length - 1) * lh + dateMid + DATE_HALF;
  const firstMid = midY - blockH / 2 + cap;
  const lastMid = firstMid + (fit.lines.length - 1) * lh;
  kit.withShadow(ctx, { color: P.titleShadow, blur: 10, y: 1 }, 1, () => {
    ctx.fillStyle = P.title;
    ctx.font = P.f(700 + P.fw, fit.size);
    const parts = accentWord && fit.lines.length === 1 ? fit.lines[0].split(accentWord) : null;
    if (parts && parts.length === 2) {
      const measure = t => text.spacedWidth(t, SPACING, c => ctx.measureText(c).width);
      const gapW = SPACING;
      const total = measure(parts[0]) + gapW + measure(accentWord) + gapW + measure(parts[1]);
      let x = cx - total / 2;
      x += text.drawSpaced(ctx, parts[0], x, firstMid, SPACING, 'left') + gapW;
      ctx.fillStyle = P.accent;
      x += text.drawSpaced(ctx, accentWord, x, firstMid, SPACING, 'left') + gapW;
      ctx.fillStyle = P.title;
      text.drawSpaced(ctx, parts[1], x, firstMid, SPACING, 'left');
    } else {
      fit.lines.forEach((line, i) => text.drawSpaced(ctx, line, cx, firstMid + i * lh, SPACING, 'center'));
    }
    ctx.font = P.n(500 + P.fw, 21, fontsReady);
    text.drawSpaced(ctx, span, cx, lastMid + dateMid, 1, 'center');
  });

  const titleTop = Math.round(firstMid - lh / 2 - 4);
  return { x: left, y: titleTop, w: room, h: Math.round(lastMid + lh / 2 + 4) - titleTop, size: fit.size };
}

/** 选配色（油墨字开了就换粗宋那一组） */
function resolvePalette(env) {
  const e = env || {};
  const base = PALETTE[e.palette] || PALETTE[DEFAULT_PALETTE];
  return e.inked ? withInk(base) : base;
}

module.exports = {
  W, HEAD_H, BEAM_BOTTOM, PROJECTOR_MID, PALETTE, PALETTE_LIST, DEFAULT_PALETTE, resolvePalette, withInk,
  grain, fillPage, drawBeam, drawHeader, drawTitleBlock, lensOf
};
