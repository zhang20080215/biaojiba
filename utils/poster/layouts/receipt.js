// 版式 · 电子小票（单部）。视觉基准：docs/superpowers/mockups/single.html「小票」。
// 封面取色模糊底上一张上下锯齿边的白小票：MARKED / 观影小票 · No.编号 → 封面 + 片名 + 年份·导演 / 类型
// → DATE 与平台评分逐行 → 我的评分 + 备注（短评）→ 条形码 + THANK YOU FOR WATCHING。
// 段与段之间是虚线；哪段没数据就整段（连同它的虚线）不画。小票高度随内容，在页面里略偏上居中。
//
// 和票根一样先 layout（只量）再 draw：layout 返回一串「段」，每段知道自己的高度和画法。
const T = require('../tokens.js');
const kit = require('../kit.js');
const text = require('../text.js');
const tint = require('../tint.js');

const { COLOR } = T;
const W = 1080, H = 1440;
const CARD_W = 700, CARD_X = (W - CARD_W) / 2;
const TOOTH = 24, ZIG = 12;           // 锯齿宽 / 深
const PAD_X = 56, PAD_TOP = 26, PAD_BOTTOM = 30;
const X0 = CARD_X + PAD_X, X1 = CARD_X + CARD_W - PAD_X, INNER_W = X1 - X0;
const DASH = 22 + 2 + 22;             // 虚线段：上下各 22
const COVER_W = 200, COVER_H = 290, COVER_GAP = 28;
const ROW_LH = 42, NOTE_LH = 41;
const BAR_H = 70, BARS = 23;

function supports(kind) { return kind === 'single'; }

function measure() { return { width: W, height: H }; }

function pad4(n) { const s = String(n); return s.length >= 4 ? s : '0000'.slice(s.length) + s; }

function layout(ctx, model) {
  const f = model.film;
  const blocks = [];

  // 刊头
  blocks.push({ type: 'head', h: 40 + 8 + 32 });

  // 封面 + 片名
  const textW = INNER_W - COVER_W - COVER_GAP;
  const measureAt = size => { ctx.font = T.cn(900, size); return s => ctx.measureText(s).width + 2 * Math.max(0, Array.from(s).length - 1); };
  const title = f.title || '未命名电影';
  const fit = text.fitTitle(title, textW, [40, 34, 30], measureAt);
  const titleSize = fit.size, titleLines = fit.lines;
  const metaLines = [[f.year, f.director].filter(Boolean).join(' · '), (f.genres || []).join(' / ')].filter(Boolean);
  const textH = titleLines.length * Math.round(titleSize * 1.2) + (metaLines.length ? 12 + metaLines.length * 37 : 0);
  blocks.push({ type: 'dash' }, { type: 'film', h: Math.max(COVER_H, textH), titleSize, titleLines, metaLines, textW });

  // DATE + 平台评分
  const rows = [];
  if (f.dateDot) rows.push(['DATE', [f.dateDot, f.weekdayEn].filter(Boolean).join(' ')]);
  (f.platform || []).slice(0, 4).forEach(p => rows.push([p.label, String(p.value)]));
  if (rows.length) blocks.push({ type: 'dash' }, { type: 'rows', h: rows.length * ROW_LH, rows });

  // 我的评分 / 心情 + 备注
  const hasBadge = f.rating > 0 || !!f.moodLabel;
  ctx.font = T.cn(400, 24);
  const prefixW = ctx.measureText('备注：').width;
  const noteLines = f.note ? text.wrapLines(f.note, INNER_W - prefixW, 3, s => ctx.measureText(s).width) : [];
  if (hasBadge || noteLines.length) {
    blocks.push({ type: 'dash' }, {
      type: 'mine', hasBadge, noteLines, prefixW,
      h: (hasBadge ? 48 : 0) + (hasBadge && noteLines.length ? 14 : 0) + noteLines.length * NOTE_LH
    });
  }

  // 条形码
  blocks.push({ type: 'dash' }, { type: 'bar', h: BAR_H + 10 + 28 });

  blocks.forEach(b => { if (b.type === 'dash') b.h = DASH; });
  const contentH = blocks.reduce((s, b) => s + b.h, 0);
  const cardH = ZIG + PAD_TOP + contentH + PAD_BOTTOM + ZIG;
  // 精修稿 translateY(-53%)：比正中略偏上，给底部署名留气口
  const cardY = Math.round(Math.max(60, H / 2 - cardH * 0.53));
  return { f, blocks, cardH, cardY };
}

function draw(ctx, model, covers, env) {
  const e = env || {};
  const fontsReady = !!e.fontsReady;
  const L = layout(ctx, model);
  const f = L.f;
  const node = (covers || {})[f.key] || null;

  // 1. 模糊底（比票根稍淡的白蒙层，小票本身是白的，底要留点颜色）
  tint.drawTint(ctx, (e.tints || {})[f.key], W, H, 0.42);

  // 2. 小票纸
  kit.withShadow(ctx, { color: 'rgba(30,35,45,0.18)', blur: 40, y: 24 }, 1, () => {
    kit.receiptPath(ctx, CARD_X, L.cardY, CARD_W, L.cardH, TOOTH);
    ctx.fillStyle = COLOR.paper;
    ctx.fill();
  });

  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  let y = L.cardY + ZIG + PAD_TOP;
  L.blocks.forEach(b => {
    if (b.type === 'dash') {
      kit.dashed(ctx, X0, y + 23, X1, y + 23, 2, '#D3D6DB', 8, 6);
    } else if (b.type === 'head') {
      ctx.fillStyle = COLOR.ink;
      ctx.font = T.num(800, 30, fontsReady);
      text.drawSpaced(ctx, 'MARKED', W / 2, y + 20, 10, 'center');
      drawSerial(ctx, model.ordinal, y + 40 + 8 + 16);
    } else if (b.type === 'film') {
      drawFilm(ctx, b, f, node, y);
    } else if (b.type === 'rows') {
      b.rows.forEach((r, i) => {
        const cy = y + ROW_LH * (i + 0.5);
        ctx.fillStyle = COLOR.ink2;
        ctx.font = T.mono(400, 24);
        ctx.textAlign = 'left';
        ctx.fillText(r[0], X0, cy);
        ctx.fillStyle = COLOR.ink;
        ctx.textAlign = 'right';
        ctx.fillText(r[1], X1, cy);
      });
      ctx.textAlign = 'left';
    } else if (b.type === 'mine') {
      drawMine(ctx, b, f, y);
    } else if (b.type === 'bar') {
      const probe = { fillRect() {}, set fillStyle(v) {} };
      const bw = kit.barcode(probe, 0, 0, BAR_H, f.key, 3, BARS);
      kit.barcode(ctx, W / 2 - bw / 2, y, BAR_H, f.key, 3, BARS, COLOR.ink);
      ctx.fillStyle = COLOR.ink3;
      ctx.font = T.mono(400, 18);
      text.drawSpaced(ctx, 'THANK YOU FOR WATCHING', W / 2, y + BAR_H + 10 + 14, 4, 'center');
    }
    y += b.h;
  });

  // 3. 署名
  ctx.textBaseline = 'alphabetic';
  kit.watermark(ctx, W / 2, H - 56, 1, 'rgba(22,24,29,0.5)');
}

/** 「观影小票 · No.0037」居中；没有序号只写「观影小票」 */
function drawSerial(ctx, ordinal, cy) {
  const label = '观影小票';
  const serial = ordinal ? `No.${pad4(ordinal)}` : '';
  ctx.font = T.cn(400, 22);
  const lw = ctx.measureText(label + (serial ? ' · ' : '')).width;
  ctx.font = T.mono(400, 22);
  const sw = serial ? ctx.measureText(serial).width : 0;
  let x = W / 2 - (lw + sw) / 2;
  ctx.fillStyle = COLOR.ink2;
  ctx.font = T.cn(400, 22);
  ctx.fillText(label + (serial ? ' · ' : ''), x, cy);
  if (serial) {
    ctx.font = T.mono(400, 22);
    ctx.fillText(serial, x + lw, cy);
  }
}

function drawFilm(ctx, b, f, node, y) {
  kit.drawCover(ctx, node, X0, y, COVER_W, COVER_H, { r: 6, shadow: false, title: f.title, focusY: 0.3 });
  const tx = X0 + COVER_W + COVER_GAP;
  const lh = Math.round(b.titleSize * 1.2);
  let ty = y;
  ctx.fillStyle = COLOR.ink;
  ctx.font = T.cn(900, b.titleSize);
  b.titleLines.forEach(line => { text.drawSpaced(ctx, line, tx, ty + lh / 2, 2, 'left'); ty += lh; });
  if (b.metaLines.length) {
    ty += 12;
    ctx.fillStyle = COLOR.ink2;
    ctx.font = T.cn(400, 22);
    b.metaLines.forEach(line => {
      ctx.fillText(text.ellipsis(line, b.textW, s => ctx.measureText(s).width), tx, ty + 18);
      ty += 37;
    });
  }
}

function drawMine(ctx, b, f, y) {
  let cy = y;
  if (b.hasBadge) {
    const mid = cy + 24;
    ctx.fillStyle = COLOR.ink;
    ctx.font = T.cn(700, 30);
    ctx.fillText(f.rating > 0 ? '我的评分' : '我的心情', X0, mid);
    if (f.rating > 0) {
      const sw = 5 * 32 + 4 * 5;
      kit.stars(ctx, X1 - sw, mid - 16, f.rating, 32, 5);
    } else {
      ctx.font = T.cn(400, 26);
      ctx.textAlign = 'right';
      ctx.fillText(`${f.moodEmoji || ''} ${f.moodLabel}`.trim(), X1, mid);
      ctx.textAlign = 'left';
    }
    cy += 48 + (b.noteLines.length ? 14 : 0);
  }
  ctx.font = T.cn(400, 24);
  b.noteLines.forEach((line, i) => {
    const mid = cy + NOTE_LH / 2;
    if (i === 0) {
      ctx.fillStyle = COLOR.ink2;
      ctx.fillText('备注：', X0, mid);
    }
    ctx.fillStyle = COLOR.ink;
    ctx.fillText(line, X0 + b.prefixW, mid);
    cy += NOTE_LH;
  });
}

module.exports = { supports, measure, draw, layout };
