// 版式 · 拍立得（单部）。视觉基准：docs/superpowers/mockups/single.html「拍立得」。
// 封面取色模糊底上一张向左歪 3° 的相纸，上沿两条半透明胶带；相纸下沿写片名 + 星级、日期 · 年份 · 导演；
// 相纸下方居中写短评（没有短评就写平台评分）。
// 相纸尺寸固定（1000 高），内容多少只影响相纸下方那一段。
const T = require('../tokens.js');
const kit = require('../kit.js');
const text = require('../text.js');
const tint = require('../tint.js');

const { COLOR } = T;
const W = 1080, H = 1440;
const FRAME_X = 160, FRAME_Y = 176, FRAME_W = 760;
const FRAME_PAD = 40, PHOTO_H = 760, CAPTION_H = 200;
const FRAME_H = FRAME_PAD + PHOTO_H + CAPTION_H;
const TILT = -3 * Math.PI / 180;
const TITLE_SIZES = [52, 44, 38];
const STAR = 30, STAR_GAP = 5;
const NOTE_TOP = 1230, NOTE_SIZE = 32, NOTE_LH = 51, NOTE_W = W - 240;

function supports(kind) { return kind === 'single'; }

function measure() { return { width: W, height: H }; }

function rad(deg) { return deg * Math.PI / 180; }

/** 半透明胶带：中心 (cx, cy)，转 deg 度 */
function tape(ctx, cx, cy, deg) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rad(deg));
  kit.withShadow(ctx, { color: 'rgba(0,0,0,0.06)', blur: 6, y: 2 }, 1, () => {
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillRect(-85, -26, 170, 52);
  });
  ctx.restore();
}

function draw(ctx, model, covers, env) {
  const e = env || {};
  const fontsReady = !!e.fontsReady;
  const f = model.film;
  const node = (covers || {})[f.key] || null;

  // 1. 模糊底
  tint.drawTint(ctx, (e.tints || {})[f.key], W, H, 0.5);

  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';

  // 2. 页眉
  const headY = 96 + 14;
  ctx.fillStyle = COLOR.ink;
  ctx.font = T.num(700, 20, fontsReady);
  text.drawSpaced(ctx, 'MARKED', 150, headY, 6, 'left');
  if (model.ordinal) {
    ctx.fillStyle = 'rgba(22,24,29,0.55)';
    ctx.font = T.cn(400, 20);
    text.drawSpaced(ctx, `我记录的第 ${model.ordinal} 部`, W - 150, headY, 3, 'right');
  }

  // 3. 相纸：绕自身中心转 -3°，坐标改成相对左上角
  ctx.save();
  ctx.translate(FRAME_X + FRAME_W / 2, FRAME_Y + FRAME_H / 2);
  ctx.rotate(TILT);
  ctx.translate(-FRAME_W / 2, -FRAME_H / 2);
  kit.withShadow(ctx, { color: 'rgba(30,35,45,0.20)', blur: 60, y: 30 }, 1, () => {
    ctx.fillStyle = COLOR.paper;
    ctx.fillRect(0, 0, FRAME_W, FRAME_H);
  });
  kit.drawCover(ctx, node, FRAME_PAD, FRAME_PAD, FRAME_W - FRAME_PAD * 2, PHOTO_H,
    { r: 0, shadow: false, hairline: false, title: f.title, focusY: 0.22 });

  // 相纸下沿：片名 ……… 星级（没评分有心情就写心情）
  const capX0 = FRAME_PAD + 6, capX1 = FRAME_W - FRAME_PAD - 6;
  const capTop = FRAME_PAD + PHOTO_H + 34;
  let badgeW = 0;
  if (f.rating > 0) {
    badgeW = 5 * STAR + 4 * STAR_GAP;
    kit.stars(ctx, capX1 - badgeW, capTop + 37 - STAR / 2, f.rating, STAR, STAR_GAP);
  } else if (f.moodLabel) {
    ctx.font = T.cn(400, 26);
    ctx.fillStyle = COLOR.ink2;
    const mood = `${f.moodEmoji || ''} ${f.moodLabel}`.trim();
    badgeW = ctx.measureText(mood).width;
    ctx.textAlign = 'right';
    ctx.fillText(mood, capX1, capTop + 37);
    ctx.textAlign = 'left';
  }
  const titleW = capX1 - capX0 - (badgeW ? badgeW + 24 : 0);
  const title = f.title || '未命名电影';
  const measureAt = size => { ctx.font = T.cn(900, size); return s => ctx.measureText(s).width + 3 * Math.max(0, Array.from(s).length - 1); };
  const size = text.fitFontSize(title, titleW, 1, TITLE_SIZES, measureAt);
  const fitted = text.ellipsis(title, titleW, measureAt(size));
  ctx.fillStyle = COLOR.ink;
  ctx.font = T.cn(900, size);
  text.drawSpaced(ctx, fitted, capX0, capTop + 37, 3, 'left');

  const sub = [[f.dateDot, f.weekdayEn].filter(Boolean).join(' '), f.year, f.director].filter(Boolean).join(' · ');
  if (sub) {
    ctx.fillStyle = COLOR.ink2;
    ctx.font = T.num(400, 24, fontsReady);
    ctx.fillText(text.ellipsis(sub, capX1 - capX0, s => ctx.measureText(s).width), capX0, capTop + 74 + 16 + 18);
  }
  ctx.restore();

  // 4. 胶带（盖在相纸上沿）
  tape(ctx, 180 + 85, 150 + 26, -12);
  tape(ctx, W - 170 - 85, 168 + 26, 9);

  // 5. 相纸下方：短评，没有短评就写平台评分
  ctx.textAlign = 'center';
  if (f.note) {
    ctx.fillStyle = COLOR.ink;
    ctx.font = T.cn(400, NOTE_SIZE);
    text.wrapLines(`「${f.note}」`, NOTE_W, 2, s => ctx.measureText(s).width)
      .forEach((line, i) => ctx.fillText(line, W / 2, NOTE_TOP + NOTE_LH * (i + 0.5)));
  } else if ((f.platform || []).length) {
    ctx.fillStyle = COLOR.ink2;
    ctx.font = T.cn(400, 26);
    const line = f.platform.slice(0, 4).map(p => `${p.label} ${p.value}`).join('   ·   ');
    ctx.fillText(text.ellipsis(line, NOTE_W, s => ctx.measureText(s).width), W / 2, NOTE_TOP + NOTE_LH / 2);
  }
  ctx.textAlign = 'left';

  // 6. 署名
  ctx.textBaseline = 'alphabetic';
  kit.watermark(ctx, W / 2, H - 56, 1, 'rgba(22,24,29,0.5)');
}

module.exports = { supports, measure, draw };
