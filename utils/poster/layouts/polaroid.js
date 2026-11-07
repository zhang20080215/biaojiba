// 版式 · 拍立得（单部）。视觉基准：docs/superpowers/mockups/v4.html ③。
// 场景底（深 / 浅可切）上一张向左歪 4° 的大相纸（完整竖版封面），左上一条半透明胶带；相纸下沿只写片名 + 日期。
// 便签钉在相纸右下角：顶行 No.037（大）+ 星级（或心情），下面是短评。
// 便签没有内容（没评分、没心情、没短评、没序号）就不画，片名占满相纸下沿。
const T = require('../tokens.js');
const kit = require('../kit.js');
const text = require('../text.js');
const tint = require('../tint.js');

const { COLOR } = T;
const W = 1080, H = 1440;
const FRAME_X = 150, FRAME_Y = 120, FRAME_W = 780;
const FRAME_PAD = 42, PHOTO_H = 900, CAPTION_H = 190;
const FRAME_H = FRAME_PAD + PHOTO_H + CAPTION_H;
const PAPER = '#FBFBF9';
const NOTE_X = 560, NOTE_Y = 990, NOTE_W = 430, NOTE_PAD_X = 36, NOTE_BOTTOM_MAX = 1330;
const NOTE_BG = '#FFF6D9', NOTE_INK = '#2B2722', NOTE_SIGN = '#9A8F7A';
const NOTE_SIZE = 30, NOTE_LH = 48;
const STAR = 32, STAR_GAP = 6;
const TITLE_SIZES = [56, 48, 40];

function supports(kind) { return kind === 'single'; }

function measure() { return { width: W, height: H }; }

const HEAD_H = 52;   // 便签顶行：No.037 大字的行高

/** 便签内容与高度；没有可写的就返回 null */
function noteLayout(ctx, model) {
  const f = model.film;
  const badge = f.rating > 0 ? 'stars' : (f.moodLabel ? 'mood' : '');
  ctx.font = T.cn(400, NOTE_SIZE);
  const lines = f.note ? text.wrapLines(f.note, NOTE_W - NOTE_PAD_X * 2, 3, s => ctx.measureText(s).width) : [];
  const head = !!(badge || model.serial);
  if (!head && !lines.length) return null;
  const h = 36 + (head ? HEAD_H + (lines.length ? 14 : 0) : 0) + lines.length * NOTE_LH + 30;
  return { badge, lines, head, h, y: Math.min(NOTE_Y, NOTE_BOTTOM_MAX - h) };
}

function draw(ctx, model, covers, env) {
  const e = env || {};
  const fontsReady = !!e.fontsReady;
  const f = model.film;
  const node = (covers || {})[f.key] || null;
  const note = noteLayout(ctx, model);
  const mode = e.stage === 'light' ? 'light' : 'dark';
  const ink = tint.stageInk(mode);

  // 1. 场景底
  tint.drawStage(ctx, (e.tints || {})[f.key], W, H, mode);

  // 2. 相纸：绕自身中心转 -4°，坐标改成相对左上角
  kit.rotated(ctx, FRAME_X + FRAME_W / 2, FRAME_Y + FRAME_H / 2, -4, () => {
    ctx.translate(-FRAME_W / 2, -FRAME_H / 2);
    kit.withShadow(ctx, { color: ink.shadow, blur: 80, y: 44 }, 1, () => {
      ctx.fillStyle = PAPER;
      ctx.fillRect(0, 0, FRAME_W, FRAME_H);
    });
    kit.drawCover(ctx, node, FRAME_PAD, FRAME_PAD, FRAME_W - FRAME_PAD * 2, PHOTO_H,
      { r: 0, shadow: false, hairline: false, title: f.title, focusY: 0.25 });

    // 相纸下沿：片名 + 日期。右边被便签压住的部分不写字
    const capX = FRAME_PAD + 4;
    const capW = note ? NOTE_X - FRAME_X - capX - 20 : FRAME_W - FRAME_PAD * 2 - 8;
    const capTop = FRAME_PAD + PHOTO_H + 30;
    const title = f.title || '未命名电影';
    const measureAt = size => { ctx.font = T.cn(900, size); return s => ctx.measureText(s).width + 3 * Math.max(0, Array.from(s).length - 1); };
    const fit = text.fitTitle(title, capW, TITLE_SIZES, measureAt);
    ctx.textBaseline = 'middle';
    ctx.fillStyle = COLOR.ink;
    ctx.font = T.cn(900, fit.size);
    text.drawSpaced(ctx, text.ellipsis(fit.lines[0], capW, measureAt(fit.size)), capX, capTop + 40, 3, 'left');
    const dateText = [f.dateDot, f.weekdayEn].filter(Boolean).join(' ');
    if (dateText) {
      ctx.fillStyle = COLOR.ink2;
      ctx.font = T.num(500, 28, fontsReady);
      text.drawSpaced(ctx, dateText, capX, capTop + 80 + 12 + 19, 1, 'left');
    }
  });

  // 3. 胶带
  kit.rotated(ctx, 200 + 100, 96 + 28, -16, () => {
    ctx.fillStyle = 'rgba(255,250,235,0.62)';
    ctx.fillRect(-100, -28, 200, 56);
  });

  // 4. 便签
  if (note) drawNote(ctx, note, f, model.serial, fontsReady);

  // 5. 署名
  ctx.textBaseline = 'alphabetic';
  kit.watermark(ctx, W / 2, H - 52, 1, ink.wm);
}

function drawNote(ctx, note, f, serial, fontsReady) {
  kit.rotated(ctx, NOTE_X + NOTE_W / 2, note.y + note.h / 2, 5, () => {
    ctx.translate(-NOTE_W / 2, -note.h / 2);
    kit.withShadow(ctx, { color: 'rgba(0,0,0,0.35)', blur: 40, y: 24 }, 1, () => {
      ctx.fillStyle = NOTE_BG;
      ctx.fillRect(0, 0, NOTE_W, note.h);
    });
    // 图钉
    kit.withShadow(ctx, { color: 'rgba(0,0,0,0.3)', blur: 8, y: 4 }, 1, () => {
      ctx.beginPath();
      ctx.arc(NOTE_W / 2, 0, 14, 0, Math.PI * 2);
      ctx.fillStyle = COLOR.acc;
      ctx.fill();
    });

    const x0 = NOTE_PAD_X, x1 = NOTE_W - NOTE_PAD_X;
    let y = 36;
    ctx.textBaseline = 'middle';
    if (note.head) {
      const mid = y + HEAD_H / 2;
      if (serial) {
        ctx.fillStyle = NOTE_INK;
        ctx.font = T.num(800, 46, fontsReady);
        text.drawSpaced(ctx, serial, x0, mid, -1, 'left');
      }
      // 有编号时星级靠右，没编号就靠左
      if (note.badge === 'stars') {
        const sw = 5 * STAR + 4 * STAR_GAP;
        kit.stars(ctx, serial ? x1 - sw : x0, mid - STAR / 2, f.rating, STAR, STAR_GAP, COLOR.acc, 'rgba(43,39,34,0.14)');
      } else if (note.badge === 'mood') {
        ctx.fillStyle = NOTE_INK;
        ctx.font = T.cn(400, 28);
        ctx.textAlign = serial ? 'right' : 'left';
        ctx.fillText(`${f.moodEmoji || ''} ${f.moodLabel}`.trim(), serial ? x1 : x0, mid);
        ctx.textAlign = 'left';
      }
      y += HEAD_H + (note.lines.length ? 14 : 0);
    }

    ctx.fillStyle = NOTE_INK;
    ctx.font = T.cn(400, NOTE_SIZE);
    note.lines.forEach(line => { ctx.fillText(line, x0, y + NOTE_LH / 2); y += NOTE_LH; });
  });
}

module.exports = { supports, measure, draw, noteLayout, stages: true };
