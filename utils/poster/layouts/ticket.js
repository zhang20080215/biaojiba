// 版式 · 电影票根（单部）。视觉基准：docs/superpowers/mockups/v4.html ①（每日选片票卡放大成海报）。
// 场景底（深 / 浅可切）上一张白票：上半截是糊开的封面衬一张完整竖版封面 + 斜贴态度章（神作 / 泪目 … + MM.DD）
// → 齿孔（两侧缺口露出底色）→ 片名 → 年份·导演·类型 → 我的星级 → 短评 → 「No.037 ……… 日期」。
// 编号做大：连着发能成系列（No.037、No.038 …）。
// 整张票在页面里垂直居中；内容多了先压缩上半截（660 → 560），封面跟着等比缩。
//
// 文字一律 textBaseline = 'middle'，按「行盒中线」定位 —— 和精修稿的 CSS 行高对得上。
const T = require('../tokens.js');
const kit = require('../kit.js');
const text = require('../text.js');
const tint = require('../tint.js');

const { COLOR } = T;
const W = 1080, H = 1440;
const CARD_W = 800, CARD_X = (W - CARD_W) / 2;
const RADIUS = 40;
const TOP_MAX = 660, TOP_MIN = 560;
const COVER_TOP = 66, COVER_RATIO = 420 / 598;
const PERF_H = 56, NOTCH_R = 30;
const PAD_X = 56;
const REGION_TOP = 56, REGION_BOTTOM = H - 116;   // 票可以占的竖直范围（下面留给署名）
const TITLE_SIZES = [80, 68, 56];
const NOTE_SIZE = 30, NOTE_LH = 48;
const STAR = 40, STAR_GAP = 8;

function supports(kind) { return kind === 'single'; }

function measure() { return { width: W, height: H }; }

function metaLine(f) {
  return [f.year, f.director, (f.genres || []).join(' / ')].filter(Boolean).join(' · ');
}

/** 排版（只量不画）：票身各段高度 */
function layout(ctx, model) {
  const f = model.film;
  const innerW = CARD_W - PAD_X * 2;
  const measureAt = size => { ctx.font = T.cn(900, size); return s => ctx.measureText(s).width + 4 * Math.max(0, Array.from(s).length - 1); };
  const fit = text.fitTitle(f.title || '未命名电影', innerW, TITLE_SIZES, measureAt);
  const titleLH = Math.round(fit.size * 1.15);

  ctx.font = T.cn(400, NOTE_SIZE);
  const noteLines = f.note ? text.wrapLines(`「${f.note}」`, innerW, 3, s => ctx.measureText(s).width) : [];
  const meta = metaLine(f);
  // 心情已经写在态度章上了（verdict 心情优先），这里只放星级，不重复
  const badge = f.rating > 0 ? 'stars' : '';

  const body = 6 + fit.lines.length * titleLH
    + (meta ? 12 + 38 : 0)
    + (badge ? 26 + STAR : 0)
    + (noteLines.length ? 22 + noteLines.length * NOTE_LH : 0)
    + 30 + 2 + 20 + 56          // 底行：上留白 + 发丝线 + 内边距 + No. 大字
    + 36;
  const avail = REGION_BOTTOM - REGION_TOP;
  const top = Math.max(TOP_MIN, Math.min(TOP_MAX, avail - PERF_H - body));
  const cardH = top + PERF_H + body;
  const cardY = Math.round(REGION_TOP + Math.max(0, (avail - cardH) / 2));
  const coverH = top - COVER_TOP - 56;
  return { f, innerW, fit, titleLH, noteLines, meta, badge, top, cardH, cardY, coverH, coverW: Math.round(coverH * COVER_RATIO) };
}

/** 态度章「神作 / 10.18」：白底圆角、转 -7°，左上角 (x, y) */
function stamp(ctx, x, y, word, md, fontsReady) {
  ctx.font = T.cn(900, 40);
  const w1 = text.spacedWidth(word, 4, s => ctx.measureText(s).width);
  ctx.font = T.num(800, 40, fontsReady);
  const w2 = ctx.measureText(md || '').width;
  const w = Math.max(w1, w2) + 52, h = md ? 128 : 76;
  kit.rotated(ctx, x + w / 2, y + h / 2, -7, () => {
    kit.withShadow(ctx, { color: 'rgba(0,0,0,0.18)', blur: 16, y: 6 }, 1, () => {
      kit.fillRoundRect(ctx, -w / 2, -h / 2, w, h, 16, 'rgba(255,255,255,0.94)');
    });
    ctx.textBaseline = 'middle';
    ctx.fillStyle = COLOR.acc;
    ctx.font = T.cn(900, 40);
    text.drawSpaced(ctx, word, 0, md ? -h / 2 + 16 + 26 : 0, 4, 'center');
    if (md) {
      ctx.fillStyle = COLOR.ink;
      ctx.font = T.num(800, 40, fontsReady);
      ctx.textAlign = 'center';
      ctx.fillText(md, 0, -h / 2 + 16 + 52 + 2 + 24);
      ctx.textAlign = 'left';
    }
  });
}

function draw(ctx, model, covers, env) {
  const e = env || {};
  const fontsReady = !!e.fontsReady;
  const L = layout(ctx, model);
  const f = L.f;
  const node = (covers || {})[f.key] || null;
  const tintData = (e.tints || {})[f.key];
  const mode = e.stage === 'light' ? 'light' : 'dark';
  const ink = tint.stageInk(mode);

  // 1. 场景底
  tint.drawStage(ctx, tintData, W, H, mode);

  // 2. 票身（带两侧缺口），投影画在票身形状上
  const x = CARD_X, y = L.cardY;
  const perfY = y + L.top + PERF_H / 2;
  kit.withShadow(ctx, { color: ink.shadow, blur: 70, y: 40 }, 1, () => {
    kit.ticketPath(ctx, x, y, CARD_W, L.cardH, RADIUS, perfY, NOTCH_R);
    ctx.fillStyle = COLOR.paper;
    ctx.fill();
  });

  // 3. 上半截：糊开的封面 + 一层往下渐深的影
  ctx.save();
  kit.topRoundRectPath(ctx, x, y, CARD_W, L.top, RADIUS);
  ctx.clip();
  tint.drawTintRect(ctx, tintData, x, y, CARD_W, L.top);
  const shade = ctx.createLinearGradient(0, y, 0, y + L.top);
  shade.addColorStop(0, 'rgba(0,0,0,0.02)');
  shade.addColorStop(1, 'rgba(0,0,0,0.28)');
  ctx.fillStyle = shade;
  ctx.fillRect(x, y, CARD_W, L.top);
  ctx.restore();

  // 4. 完整竖版封面 + 真投影
  kit.drawCover(ctx, node, x + (CARD_W - L.coverW) / 2, y + COVER_TOP, L.coverW, L.coverH,
    { r: 18, shadow: { color: 'rgba(0,0,0,0.42)', blur: 50, y: 26 }, hairline: false, title: f.title });

  // 5. 印章
  stamp(ctx, x + 40, y + 40, f.verdict, f.md, fontsReady);

  // 6. 齿孔线
  kit.dashed(ctx, x + 48, perfY, x + CARD_W - 48, perfY, 3, '#E3E5E9', 10, 8);

  // 7. 票面文字，居中
  const cx = x + CARD_W / 2;
  let cy = y + L.top + PERF_H + 6;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = COLOR.ink;
  ctx.font = T.cn(900, L.fit.size);
  L.fit.lines.forEach(line => {
    text.drawSpaced(ctx, line, cx, cy + L.titleLH / 2, 4, 'center');
    cy += L.titleLH;
  });

  ctx.textAlign = 'center';
  if (L.meta) {
    cy += 12;
    ctx.fillStyle = COLOR.ink2;
    ctx.font = T.cn(400, 26);
    ctx.fillText(text.ellipsis(L.meta, L.innerW, s => ctx.measureText(s).width), cx, cy + 19);
    cy += 38;
  }

  if (L.badge) {
    cy += 26;
    if (L.badge === 'stars') {
      const sw = 5 * STAR + 4 * STAR_GAP;
      kit.stars(ctx, cx - sw / 2, cy, f.rating, STAR, STAR_GAP);
    } else {
      ctx.fillStyle = COLOR.ink2;
      ctx.font = T.cn(400, 30);
      ctx.fillText(`${f.moodEmoji || ''} ${f.moodLabel}`.trim(), cx, cy + STAR / 2);
    }
    cy += STAR;
  }

  if (L.noteLines.length) {
    cy += 22;
    ctx.fillStyle = COLOR.ink;
    ctx.font = T.cn(400, NOTE_SIZE);
    L.noteLines.forEach(line => {
      ctx.fillText(line, cx, cy + NOTE_LH / 2);
      cy += NOTE_LH;
    });
  }
  ctx.textAlign = 'left';

  // 8. 底行：发丝线 + No.037（大）……… 日期 星期
  cy += 30;
  const x0 = x + PAD_X, x1 = x + CARD_W - PAD_X;
  kit.line(ctx, x0, cy, x1, cy, 2, '#ECEDF0');
  const rowY = cy + 2 + 20 + 28;
  if (model.serial) {
    ctx.fillStyle = COLOR.ink;
    ctx.font = T.num(800, 52, fontsReady);
    text.drawSpaced(ctx, model.serial, x0, rowY, -1, 'left');
  }
  const dateText = [f.dateDot, f.weekdayEn].filter(Boolean).join(' ');
  if (dateText) {
    ctx.fillStyle = COLOR.ink2;
    ctx.font = T.num(500, 26, fontsReady);
    text.drawSpaced(ctx, dateText, x1, rowY, 1, 'right');
  }

  // 9. 署名
  ctx.textBaseline = 'alphabetic';
  kit.watermark(ctx, W / 2, H - 52, 1, ink.wm);
}

module.exports = { supports, measure, draw, layout, stages: true };
