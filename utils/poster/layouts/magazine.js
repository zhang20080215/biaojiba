// 版式 · 杂志封面（单部）。视觉基准：docs/superpowers/mockups/single.html「杂志」。
// 整幅封面铺满当杂志封面：左上大刊头 MARKED + 右上日期 / 第 N 部 → 强调色短条 → 左侧「封面要点」= 平台评分
// → 底部封面故事：COVER STORY → 片名 → 年份·导演·类型 → 星级 | 短评。
// 上下两段黑色渐变保证白字可读；封面越亮遮罩越深（亮度来自 tint.avg）。
// 底部封面故事从下往上排：短评长短、片名几行都不影响它贴底。
const T = require('../tokens.js');
const kit = require('../kit.js');
const text = require('../text.js');

const W = 1080, H = 1440;
const X0 = 64, X1 = W - 64, INNER_W = X1 - X0;
const STORY_BOTTOM = H - 132;
const TITLE_SIZES = [104, 88, 72];
const NOTE_SIZE = 30, NOTE_LH = 48;
const STAR = 34, STAR_GAP = 6;
const WHITE = '#FFFFFF';
const NO_COVER_BG = '#2A2D33';
// 白字压在封面上：一层轻投影，封面自带的字 / 亮色块不至于把字吃掉
const TEXT_SHADOW = { color: 'rgba(0,0,0,0.35)', blur: 10, y: 1 };

function supports(kind) { return kind === 'single'; }

function measure() { return { width: W, height: H }; }

function metaLine(f) {
  return [f.year, f.director, (f.genres || []).join(' / ')].filter(Boolean).join(' · ');
}

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

/** 遮罩深浅：封面平均亮度 0.35 以下用精修稿原值，0.75 以上加到最深 */
function overlayAlpha(avg) {
  const k = avg ? clamp01((avg.lum - 0.35) / 0.4) : 0;
  return { top: 0.42 + 0.18 * k, bottom: 0.78 + 0.12 * k };
}

/** 排版（只量不画）：底部封面故事各行的位置 */
function layout(ctx, model) {
  const f = model.film;
  const title = f.title || '未命名电影';
  const measureAt = size => { ctx.font = T.cn(900, size); return s => ctx.measureText(s).width + 4 * Math.max(0, Array.from(s).length - 1); };
  const fit = text.fitTitle(title, INNER_W, TITLE_SIZES, measureAt);
  const titleSize = fit.size, titleLines = fit.lines;
  const titleLH = Math.round(titleSize * 1.08);

  // 星级（没评分有心情就写心情）和短评：放得下就同一行，放不下短评另起最多两行
  const badgeW = f.rating > 0 ? 5 * STAR + 4 * STAR_GAP
    : (f.moodLabel ? (ctx.font = T.cn(400, 28), ctx.measureText(`${f.moodEmoji || ''} ${f.moodLabel}`.trim()).width) : 0);
  ctx.font = T.cn(400, NOTE_SIZE);
  const note = f.note ? `「${f.note}」` : '';
  const sep = badgeW ? 22 + 1 + 22 : 0;
  const inline = !note || ctx.measureText(note).width <= INNER_W - badgeW - sep;
  const noteLines = !note ? [] : inline ? [note] : text.wrapLines(note, INNER_W, 2, s => ctx.measureText(s).width);

  // 从下往上
  let bottom = STORY_BOTTOM;
  const rows = {};
  if (inline) {
    if (badgeW || note) { rows.badge = bottom - 24; rows.noteInline = !!note; bottom -= 48; }
  } else {
    rows.noteTop = bottom - noteLines.length * NOTE_LH;
    bottom = rows.noteTop;
    if (badgeW) { bottom -= 18; rows.badge = bottom - 24; bottom -= 48; }
  }
  if (bottom < STORY_BOTTOM) bottom -= 26;
  const meta = metaLine(f);
  if (meta) { rows.meta = bottom - 21; bottom -= 42 + 14; }
  rows.titleTop = bottom - titleLines.length * titleLH;
  bottom = rows.titleTop - 12;
  rows.kicker = bottom - 17;
  return { f, title, titleSize, titleLines, titleLH, badgeW, sep, noteLines, inline, rows, meta };
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
    const c = kit.coverCrop(node.width, node.height, W, H, 0.3);
    ctx.drawImage(node, c[0], c[1], c[2], c[3], 0, 0, W, H);
  } else {
    ctx.fillStyle = NO_COVER_BG;
    ctx.fillRect(0, 0, W, H);
  }

  // 2. 遮罩：顶部 0 → 20% 渐隐，46% → 底部渐深
  const a = overlayAlpha(avg);
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, `rgba(0,0,0,${a.top})`);
  g.addColorStop(0.2, 'rgba(0,0,0,0)');
  g.addColorStop(0.46, 'rgba(0,0,0,0)');
  g.addColorStop(1, `rgba(0,0,0,${a.bottom})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';

  // 3. 刊头 MARKED + 右上日期 / 第 N 部
  ctx.fillStyle = WHITE;
  ctx.font = T.num(800, 132, fontsReady);
  text.drawSpaced(ctx, 'MARKED', X0, 54 + 60, -5, 'left');
  const right = [];
  if (f.dateDot) right.push({ s: f.dateDot, font: T.num(600, 20, fontsReady), alpha: 1 });
  if (model.ordinal) right.push({ s: `我记录的第 ${model.ordinal} 部`, font: T.cn(400, 20), alpha: 0.85 });
  kit.withShadow(ctx, TEXT_SHADOW, 1, () => right.forEach((r, i) => {
    ctx.font = r.font;
    ctx.fillStyle = `rgba(255,255,255,${r.alpha})`;
    text.drawSpaced(ctx, r.s, X1, 54 + 14 + 17 + i * 34, 1, 'right');
  }));

  // 4. 强调色短条 + 封面要点（平台评分），带一点投影防亮封面吃字
  ctx.fillStyle = T.COLOR.acc;
  ctx.fillRect(X0, 228, 48, 4);
  const platform = (f.platform || []).slice(0, 4);
  if (platform.length) {
    kit.withShadow(ctx, TEXT_SHADOW, 1, () => {
      platform.forEach((p, i) => {
        const cy = 252 + 21 + i * 42;
        ctx.font = T.cn(400, 22);
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        const lw = text.drawSpaced(ctx, p.label, X0, cy, 2, 'left');
        ctx.font = T.num(700, 26, fontsReady);
        ctx.fillStyle = WHITE;
        text.drawSpaced(ctx, String(p.value), X0 + lw + 12, cy, 2, 'left');
      });
    });
  }

  // 5. 封面故事
  kit.withShadow(ctx, TEXT_SHADOW, 1, () => drawStory(ctx, L, f, fontsReady));

  // 6. 署名
  ctx.textBaseline = 'alphabetic';
  kit.watermark(ctx, W / 2, H - 56, 1, 'rgba(255,255,255,0.7)');
}

function drawStory(ctx, L, f, fontsReady) {
  const R = L.rows;
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = T.num(500, 22, fontsReady);
  text.drawSpaced(ctx, 'COVER STORY', X0, R.kicker, 6, 'left');

  ctx.fillStyle = WHITE;
  ctx.font = T.cn(900, L.titleSize);
  L.titleLines.forEach((line, i) => text.drawSpaced(ctx, line, X0, R.titleTop + L.titleLH * (i + 0.5), 4, 'left'));

  if (L.meta) {
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = T.cn(400, 26);
    ctx.fillText(text.ellipsis(L.meta, INNER_W, s => ctx.measureText(s).width), X0, R.meta);
  }

  if (R.badge != null) {
    if (f.rating > 0) {
      kit.stars(ctx, X0, R.badge - STAR / 2, f.rating, STAR, STAR_GAP, T.COLOR.acc, 'rgba(255,255,255,0.3)');
    } else if (f.moodLabel) {
      ctx.fillStyle = WHITE;
      ctx.font = T.cn(400, 28);
      ctx.fillText(`${f.moodEmoji || ''} ${f.moodLabel}`.trim(), X0, R.badge);
    }
    if (L.inline && R.noteInline) {
      let nx = X0;
      if (L.badgeW) {
        kit.line(ctx, X0 + L.badgeW + 22, R.badge - 15, X0 + L.badgeW + 22, R.badge + 15, 1, 'rgba(255,255,255,0.4)');
        nx = X0 + L.badgeW + L.sep;
      }
      ctx.fillStyle = WHITE;
      ctx.font = T.cn(400, NOTE_SIZE);
      ctx.fillText(L.noteLines[0], nx, R.badge);
    }
  }
  if (!L.inline) {
    ctx.fillStyle = WHITE;
    ctx.font = T.cn(400, NOTE_SIZE);
    L.noteLines.forEach((line, i) => ctx.fillText(line, X0, R.noteTop + NOTE_LH * (i + 0.5)));
  }
}

module.exports = { supports, measure, draw, layout, overlayAlpha };
