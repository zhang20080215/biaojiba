// 版式 · 杂志封面（单部）。视觉基准：docs/superpowers/mockups/v4.html ②。
// 整幅封面铺满 + 杂志的「家具」：通栏大刊头 MARKED → 刊期行（YYYY年M月刊 · 我的观影志 · 星期 日期）
// → 左侧大号记录编号 No.037（没有编号退回豆瓣评分大数字）→ 右上态度圆贴纸（神作 / 泪目 …）
// → 底部封面故事（片名 / 年份·导演·类型 / 星级 + 平台评分 / 短评）。
// 2026-11 做过一轮减法：去掉了右下条码框和两个平台评分大数字 —— 元素太多互相抢。
// 上下两段黑色渐变保证白字可读；封面越亮遮罩越深（亮度来自 tint.avg）。底部封面故事从下往上排，始终贴底。
const T = require('../tokens.js');
const kit = require('../kit.js');
const text = require('../text.js');

const W = 1080, H = 1440;
const X0 = 60, X1 = W - 60;
const STORY_BOTTOM = H - 140, STORY_W = X1 - X0;
const TITLE_SIZES = [112, 96, 80];
const NOTE_SIZE = 30, NOTE_LH = 46;
const STAR = 36, STAR_GAP = 7;
const WHITE = '#FFFFFF';
const NO_COVER_BG = '#2A2D33';
// 白字压在封面上：一层轻投影，封面自带的字 / 亮色块不至于把字吃掉
const TEXT_SHADOW = { color: 'rgba(0,0,0,0.35)', blur: 14, y: 2 };

function supports(kind) { return kind === 'single'; }

function measure() { return { width: W, height: H }; }

function metaLine(f) {
  return [f.year, f.director, (f.genres || []).join(' / ')].filter(Boolean).join(' · ');
}

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

/** 遮罩：封面平均亮度 0.35 以下用精修稿原值，0.75 以上加到最深（龙猫这种浅色封面） */
function overlayAlpha(avg) {
  const k = avg ? clamp01((avg.lum - 0.35) / 0.4) : 0;
  return { top: 0.5 + 0.25 * k, mid: 0.12 * k, bottom: 0.82 + 0.1 * k };
}

/** 排版（只量不画）：底部封面故事各行的位置，从下往上 */
function layout(ctx, model) {
  const f = model.film;
  const measureAt = size => { ctx.font = T.cn(900, size); return s => ctx.measureText(s).width + 4 * Math.max(0, Array.from(s).length - 1); };
  const fit = text.fitTitle(f.title || '未命名电影', STORY_W, TITLE_SIZES, measureAt);
  const titleLH = Math.round(fit.size * 1.05);
  ctx.font = T.cn(400, NOTE_SIZE);
  const noteLines = f.note ? text.wrapLines(`「${f.note}」`, STORY_W, 2, s => ctx.measureText(s).width) : [];
  // 心情已经写在态度章上了（verdict 心情优先），这里只放星级，不重复
  const badge = f.rating > 0 ? 'stars' : '';
  const meta = metaLine(f);
  // 没编号时第一个平台评分已经做成了左上大数字，这里不重复
  const plat = (f.platform || []).slice(model.serial ? 0 : 1, 3);
  const platformText = plat.map(p => `${p.label} ${p.value}`).join('   ');

  const rows = {};
  let bottom = STORY_BOTTOM;
  if (noteLines.length) { rows.noteTop = bottom - noteLines.length * NOTE_LH; bottom = rows.noteTop - 16; }
  if (badge || platformText) { rows.badge = bottom - STAR / 2; bottom -= STAR + 22; }
  else if (noteLines.length) bottom -= 6;
  if (meta) { rows.meta = bottom - 19; bottom -= 38 + 14; }
  rows.titleTop = bottom - fit.lines.length * titleLH;
  rows.kicker = rows.titleTop - 10 - 17;
  return { f, fit, titleLH, noteLines, badge, meta, rows, platformText };
}

/** 态度圆贴纸「神作 / 10.18」：圆心 (cx, cy)，转 12° */
function sticker(ctx, cx, cy, word, md, fontsReady) {
  kit.rotated(ctx, cx, cy, 12, () => {
    kit.withShadow(ctx, { color: 'rgba(0,0,0,0.3)', blur: 28, y: 12 }, 1, () => {
      ctx.beginPath();
      ctx.arc(0, 0, 88, 0, Math.PI * 2);
      ctx.fillStyle = T.COLOR.acc;
      ctx.fill();
    });
    ctx.fillStyle = WHITE;
    ctx.textBaseline = 'middle';
    ctx.font = T.cn(900, Array.from(word).length > 2 ? 32 : 40);
    text.drawSpaced(ctx, word, 0, md ? -22 : 0, 4, 'center');
    if (md) {
      ctx.font = T.num(800, 40, fontsReady);
      ctx.textAlign = 'center';
      ctx.fillText(md, 0, 24);
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
  const avg = ((e.tints || {})[f.key] || {}).avg || null;

  // 1. 整幅封面（没有封面就是深灰底，白字照样可读）
  if (node && node.width && node.height) {
    const c = kit.coverCrop(node.width, node.height, W, H, 0.28);
    ctx.drawImage(node, c[0], c[1], c[2], c[3], 0, 0, W, H);
  } else {
    ctx.fillStyle = NO_COVER_BG;
    ctx.fillRect(0, 0, W, H);
  }

  // 2. 遮罩
  const a = overlayAlpha(avg);
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, `rgba(0,0,0,${a.top})`);
  g.addColorStop(0.3, `rgba(0,0,0,${a.mid})`);
  g.addColorStop(0.48, `rgba(0,0,0,${a.mid})`);
  g.addColorStop(1, `rgba(0,0,0,${a.bottom})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';

  // 3. 通栏刊头：字号按宽度收，撑满左右 52
  ctx.fillStyle = WHITE;
  let size = 214;
  const mastW = () => { ctx.font = T.num(800, size, fontsReady); return text.spacedWidth('MARKED', -size * 0.042, s => ctx.measureText(s).width); };
  while (mastW() > W - 104 && size > 140) size -= 4;
  ctx.font = T.num(800, size, fontsReady);
  text.drawSpaced(ctx, 'MARKED', W / 2, 36 + size * 0.43, -size * 0.042, 'center');

  // 4. 期号行
  kit.line(ctx, X0, 236, X1, 236, 2, 'rgba(255,255,255,0.55)');
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  const issueY = 236 + 2 + 12 + 15;
  const ym = /^(d{4})-(d{2})/.exec(f.date || '');
  ctx.font = T.cn(400, 22);
  if (ym) text.drawSpaced(ctx, `${ym[1]}年${Number(ym[2])}月刊`, X0, issueY, 3, 'left');
  text.drawSpaced(ctx, '我的观影志', W / 2, issueY, 3, 'center');
  ctx.font = T.num(500, 22, fontsReady);
  const dayText = [f.weekdayEn, f.md].filter(Boolean).join(' ');
  if (dayText) text.drawSpaced(ctx, dayText, X1, issueY, 3, 'right');

  // 5. 封面要点：大号记录编号（连着发成系列）；没有编号退回豆瓣评分大数字
  const lead = model.serial
    ? { big: model.serial, small: `我记录的第 ${model.ordinal} 部电影` }
    : ((f.platform || [])[0] ? { big: String(f.platform[0].value), small: `${f.platform[0].label}评分` } : null);
  if (lead) {
    kit.withShadow(ctx, TEXT_SHADOW, 1, () => {
      ctx.fillStyle = WHITE;
      ctx.font = T.num(800, 112, fontsReady);
      text.drawSpaced(ctx, lead.big, X0 - 4, 330 + 56, -3, 'left');
      ctx.fillStyle = 'rgba(255,255,255,0.88)';
      ctx.font = T.cn(400, 26);
      text.drawSpaced(ctx, lead.small, X0, 330 + 112 + 8 + 18, 3, 'left');
    });
  }

  // 6. 圆贴纸
  sticker(ctx, W - 64 - 88, 350 + 88, f.verdict, f.md, fontsReady);

  // 7. 封面故事
  kit.withShadow(ctx, TEXT_SHADOW, 1, () => drawStory(ctx, L, f, fontsReady));

  // 8. 署名
  ctx.textBaseline = 'alphabetic';
  kit.watermark(ctx, W / 2, H - 52, 1, 'rgba(255,255,255,0.62)');
}

function drawStory(ctx, L, f, fontsReady) {
  const R = L.rows;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = T.COLOR.acc;
  ctx.font = T.num(700, 22, fontsReady);
  text.drawSpaced(ctx, 'COVER STORY', X0, R.kicker, 6, 'left');

  ctx.fillStyle = WHITE;
  ctx.font = T.cn(900, L.fit.size);
  L.fit.lines.forEach((line, i) => text.drawSpaced(ctx, line, X0, R.titleTop + L.titleLH * (i + 0.5), 4, 'left'));

  if (L.meta) {
    ctx.fillStyle = 'rgba(255,255,255,0.82)';
    ctx.font = T.cn(400, 26);
    ctx.fillText(text.ellipsis(L.meta, STORY_W, s => ctx.measureText(s).width), X0, R.meta);
  }
  let bx = X0;
  if (L.badge === 'stars') {
    bx += kit.stars(ctx, X0, R.badge - STAR / 2, f.rating, STAR, STAR_GAP, T.COLOR.acc, 'rgba(255,255,255,0.3)');
  } else if (L.badge === 'mood') {
    ctx.fillStyle = WHITE;
    ctx.font = T.cn(400, 28);
    const mood = `${f.moodEmoji || ''} ${f.moodLabel}`.trim();
    ctx.fillText(mood, X0, R.badge);
    bx += ctx.measureText(mood).width;
  }
  if (L.platformText) {
    ctx.fillStyle = 'rgba(255,255,255,0.82)';
    ctx.font = T.num(600, 26, fontsReady);
    ctx.fillText(L.platformText, bx + (L.badge ? 28 : 0), R.badge);
  }
  if (L.noteLines.length) {
    ctx.fillStyle = WHITE;
    ctx.font = T.cn(400, NOTE_SIZE);
    L.noteLines.forEach((line, i) => ctx.fillText(line, X0, R.noteTop + NOTE_LH * (i + 0.5)));
  }
}

module.exports = { supports, measure, draw, layout, overlayAlpha };
