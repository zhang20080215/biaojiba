// 版式 · 电影票根（单部）。视觉基准：docs/superpowers/mockups/refined.html 第三张。
// 封面取色模糊底上一张白票：大封面 → ADMIT ONE + 星级 → 片名 → 年份·导演·类型 → 平台评分 → 短评
// → 齿孔线（两侧镂空缺口）→ 观影日期 + 条形码。
// 内容多少都画在 1080×1440 里：内容多了先压缩封面高度（560 → 380），整体在页面里垂直居中。
//
// 文字一律 textBaseline = 'middle'，按「行盒中线」定位 —— 和精修稿的 CSS 行高对得上，也不受各机型字体上下留白影响。
const T = require('../tokens.js');
const kit = require('../kit.js');
const text = require('../text.js');
const tint = require('../tint.js');

const { COLOR } = T;
const W = 1080, H = 1440;
const CARD_W = 820, CARD_X = (W - CARD_W) / 2;
const PAD = 44, COVER_PAD = 28;
const COVER_MAX = 560, COVER_MIN = 380;
const NOTCH_R = 26;
const STUB_H = 30 + 64 + 34;          // 齿孔线以下：上 30 + 内容 64 + 下 34
const REGION_TOP = 150, REGION_BOTTOM = 1330;   // 票面可以占的竖直范围（上有页眉，下有署名）
const TITLE_SIZES = [76, 64, 56];

function supports(kind) { return kind === 'single'; }

function measure() { return { width: W, height: H }; }

function metaLine(f) {
  return [f.year, f.director, (f.genres || []).join(' / ')].filter(Boolean).join(' · ');
}

/** 先排版（只量不画），得到各段高度；draw 和测试共用 */
function layout(ctx, model, fontsReady) {
  const f = model.film;
  const innerW = CARD_W - PAD * 2;
  const measureAt = size => { ctx.font = T.cn(900, size); return s => ctx.measureText(s).width + 3 * Math.max(0, Array.from(s).length - 1); };
  const titleSize = text.fitFontSize(f.title || '未命名电影', innerW, 2, TITLE_SIZES, measureAt);
  const titleLines = text.wrapLines(f.title || '未命名电影', innerW, 2, measureAt(titleSize));
  const titleLH = Math.round(titleSize * 1.1);

  ctx.font = T.cn(400, 28);
  const noteLines = f.note ? text.wrapLines(`「${f.note}」`, innerW, 3, s => ctx.measureText(s).width) : [];
  const noteLH = Math.round(28 * 1.7);

  const platform = (f.platform || []).slice(0, 4);
  // 封面以外的高度（从封面底到票底）
  const rest = 34 + 30                                // ADMIT ONE 行
    + 14 + titleLines.length * titleLH                // 片名
    + (metaLine(f) ? 12 + 36 : 0)                     // 年份·导演·类型
    + (platform.length ? 34 + 110 : 0)                // 平台评分条
    + (noteLines.length ? 26 + noteLines.length * noteLH : 0)
    + 30                                              // 齿孔线上方留白
    + STUB_H;
  const coverH = Math.max(COVER_MIN, Math.min(COVER_MAX, (REGION_BOTTOM - REGION_TOP) - COVER_PAD - rest));
  const cardH = COVER_PAD + coverH + rest;
  const cardY = Math.round(REGION_TOP + Math.max(0, (REGION_BOTTOM - REGION_TOP - cardH) / 2));
  return { f, innerW, titleSize, titleLines, titleLH, noteLines, noteLH, platform, coverH, cardH, cardY, fontsReady };
}

function draw(ctx, model, covers, env) {
  const e = env || {};
  const fontsReady = !!e.fontsReady;
  const L = layout(ctx, model, fontsReady);
  const f = L.f;
  const node = (covers || {})[f.key] || null;

  // 1. 模糊底
  tint.drawTint(ctx, (e.tints || {})[f.key], W, H, 0.5);

  // 2. 页眉：MARKED ……… 我记录的第 N 部
  const headY = L.cardY - 42;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = COLOR.ink;
  ctx.font = T.num(700, 20, fontsReady);
  text.drawSpaced(ctx, 'MARKED', CARD_X, headY, 6, 'left');
  if (model.ordinal) {
    ctx.fillStyle = 'rgba(22,24,29,0.55)';
    ctx.font = T.cn(400, 20);
    text.drawSpaced(ctx, `我记录的第 ${model.ordinal} 部`, CARD_X + CARD_W, headY, 3, 'right');
  }

  // 3. 票面（带两侧缺口），投影画在票面形状上
  const cardY = L.cardY, cardH = L.cardH;
  const perfY = cardY + cardH - STUB_H;
  kit.withShadow(ctx, kit.SHADOW.card, 1, () => {
    kit.ticketPath(ctx, CARD_X, cardY, CARD_W, cardH, 36, perfY, NOTCH_R);
    ctx.fillStyle = COLOR.paper;
    ctx.fill();
  });

  // 4. 封面
  kit.drawCover(ctx, node, CARD_X + COVER_PAD, cardY + COVER_PAD, CARD_W - COVER_PAD * 2, L.coverH,
    { r: 20, shadow: false, hairline: false, title: f.title, focusY: 0.3 });

  const x0 = CARD_X + PAD, x1 = CARD_X + CARD_W - PAD;
  let y = cardY + COVER_PAD + L.coverH + 34;

  // 5. ADMIT ONE + 我的星级（没评分但有心情就写心情，都没有就空着）
  ctx.fillStyle = COLOR.acc;
  ctx.font = T.num(600, 20, fontsReady);
  text.drawSpaced(ctx, 'ADMIT ONE', x0, y + 15, 6, 'left');
  if (f.rating > 0) {
    kit.stars(ctx, x1 - (5 * 30 + 4 * 6), y, f.rating, 30, 6);
  } else if (f.moodLabel) {
    ctx.fillStyle = COLOR.ink2;
    ctx.font = T.cn(400, 22);
    ctx.textAlign = 'right';
    ctx.fillText(`${f.moodEmoji || ''} ${f.moodLabel}`.trim(), x1, y + 15);
    ctx.textAlign = 'left';
  }
  y += 30;

  // 6. 片名
  y += 14;
  ctx.fillStyle = COLOR.ink;
  ctx.font = T.cn(900, L.titleSize);
  L.titleLines.forEach(line => {
    text.drawSpaced(ctx, line, x0, y + L.titleLH / 2, 3, 'left');
    y += L.titleLH;
  });

  // 7. 年份 · 导演 · 类型
  const meta = metaLine(f);
  if (meta) {
    y += 12;
    ctx.fillStyle = COLOR.ink2;
    ctx.font = T.cn(400, 24);
    ctx.fillText(text.ellipsis(meta, L.innerW, s => ctx.measureText(s).width), x0, y + 18);
    y += 36;
  }

  // 8. 平台评分：上下发丝线，等分几栏，栏间竖线
  if (L.platform.length) {
    y += 34;
    const rowH = 110, n = L.platform.length, colW = L.innerW / n;
    kit.line(ctx, x0, y, x1, y, 1.5, COLOR.line);
    kit.line(ctx, x0, y + rowH, x1, y + rowH, 1.5, COLOR.line);
    L.platform.forEach((p, i) => {
      const cx = x0 + colW * i + (i ? 28 : 0);
      if (i) kit.line(ctx, x0 + colW * i, y, x0 + colW * i, y + rowH, 1.5, COLOR.line);
      ctx.fillStyle = COLOR.ink3;
      ctx.font = T.cn(400, 18);
      text.drawSpaced(ctx, p.label, cx, y + 22 + 12, 2, 'left');
      ctx.fillStyle = COLOR.ink;
      ctx.font = T.num(700, 40, fontsReady);
      ctx.fillText(String(p.value), cx, y + 22 + 18 + 4 + 22);
    });
    y += rowH;
  }

  // 9. 短评
  if (L.noteLines.length) {
    y += 26;
    ctx.fillStyle = COLOR.ink;
    ctx.font = T.cn(400, 28);
    L.noteLines.forEach(line => {
      ctx.fillText(line, x0, y + L.noteLH / 2);
      y += L.noteLH;
    });
  }

  // 10. 齿孔线
  kit.dashed(ctx, x0, perfY, x1, perfY, 3, '#DDE0E5', 10, 8);

  // 11. 存根：观影日期 + 星期 ……… 条形码
  const stubTop = perfY + 30;
  ctx.fillStyle = COLOR.ink3;
  ctx.font = T.cn(400, 18);
  text.drawSpaced(ctx, '观影日期', x0, stubTop + 12, 2, 'left');
  ctx.fillStyle = COLOR.ink;
  ctx.font = T.num(700, 34, fontsReady);
  const dateText = f.dateDot || '';
  ctx.fillText(dateText, x0, stubTop + 24 + 4 + 21);
  if (f.weekdayEn) {
    const dw = ctx.measureText(dateText).width;
    ctx.fillStyle = COLOR.ink2;
    ctx.font = T.num(500, 22, fontsReady);
    ctx.fillText(f.weekdayEn, x0 + dw + 10, stubTop + 24 + 4 + 23);
  }
  const bars = 19, barH = 60;
  // 先量宽度再右对齐：同一 seed 两次生成的图案一样
  const probe = { fillRect() {}, set fillStyle(v) {} };
  const bw = kit.barcode(probe, 0, 0, barH, f.key, 3, bars);
  kit.barcode(ctx, x1 - bw, stubTop + 2, barH, f.key, 3, bars, COLOR.ink);

  // 12. 署名
  ctx.textBaseline = 'alphabetic';
  kit.watermark(ctx, W / 2, H - 56, 1, 'rgba(22,24,29,0.5)');
}

module.exports = { supports, measure, draw, layout };
