// 版式 · 电子小票（单部）。视觉基准：docs/superpowers/mockups/v4.html ④。
// 暗场景 + 顶光，一张略歪的锯齿边小票：MARKED / 观影小票 No.编号 / 日期 → 「热敏打印」的黑白高反差封面
// → 账单式「电影票 ×1」《片名》、年份·导演·类型 → 平台评分逐行 → TOTAL = 我的星级、短评当脚注
// → THANK YOU FOR WATCHING。
// 段与段之间是虚线；哪段没数据就整段（连同它的虚线）不画。内容多了先压封面高度（440 → 300），小票整体垂直居中。
//
// 黑白封面要在离屏 canvas 上逐像素算，所以放在 prepare 里提前做（页面 / 调试页在 draw 之前 await）；
// 没准备好（离屏 canvas 不可用）就退回彩色封面。
const T = require('../tokens.js');
const kit = require('../kit.js');
const text = require('../text.js');
const tint = require('../tint.js');

const W = 1080, H = 1440;
const CARD_W = 720, CARD_X = (W - CARD_W) / 2;
const TOOTH = 22, ZIG = 11;
const PAD_X = 50, PAD_TOP = 22, PAD_BOTTOM = 28;
const INNER_W = CARD_W - PAD_X * 2;
const DASH = 20 + 2 + 20;
const IMG_W = INNER_W, IMG_MAX = 440, IMG_MIN = 300;
const ROW_LH = 43, NOTE_LH = 41;
const REGION_TOP = 50, REGION_BOTTOM = H - 116;
const TILT = -1.5;
const PAPER = '#FAFAF7', INK = '#1B1B1B', GREY = '#666666', FAINT = '#888888';

function supports(kind) { return kind === 'single'; }

function measure() { return { width: W, height: H }; }

function pad4(n) { const s = String(n); return s.length >= 4 ? s : '0000'.slice(s.length) + s; }

/** 黑白热敏封面：按最大尺寸做一张，画的时候再按实际高度裁 */
async function prepare(model, coverNodes) {
  const key = model.film.key;
  const node = (coverNodes || {})[key];
  return { thermal: { [key]: node ? await tint.prepareThermal(node, IMG_W, IMG_MAX, 0.3) : null } };
}

function layout(ctx, model, hasCover) {
  const f = model.film;
  const blocks = [];
  blocks.push({ type: 'head', h: 44 + 6 + 28 + (f.dateDot ? 2 + 28 : 0) });
  if (hasCover) blocks.push({ type: 'dash' }, { type: 'img', h: IMG_MAX });

  const measureAt = size => { ctx.font = T.cn(900, size); return s => ctx.measureText(s).width + 2 * Math.max(0, Array.from(s).length - 1); };
  const fit = text.fitTitle(`《${f.title || '未命名电影'}》`, INNER_W, [44, 38, 32], measureAt);
  const titleLH = Math.round(fit.size * 1.4);
  const meta = [f.year, f.director, (f.genres || []).join(' / ')].filter(Boolean).join(' · ');
  blocks.push({ type: 'dash' }, { type: 'film', fit, titleLH, meta, h: ROW_LH + 2 + fit.lines.length * titleLH + 4 + (meta ? 32 : 0) });

  const rows = (f.platform || []).slice(0, 4).map(p => [p.label, String(p.value)]);
  if (rows.length) blocks.push({ type: 'dash' }, { type: 'rows', rows, h: rows.length * ROW_LH });

  const badge = f.rating > 0 ? 'stars' : (f.moodLabel ? 'mood' : '');
  ctx.font = T.cn(400, 24);
  const noteLines = f.note ? text.wrapLines(`* ${f.note}`, INNER_W, 3, s => ctx.measureText(s).width) : [];
  if (badge || noteLines.length) {
    blocks.push({ type: 'dash' }, { type: 'total', badge, noteLines, h: (badge ? 48 : 0) + (badge && noteLines.length ? 14 : 0) + noteLines.length * NOTE_LH });
  }
  blocks.push({ type: 'dash' }, { type: 'thanks', h: 28 });
  blocks.forEach(b => { if (b.type === 'dash') b.h = DASH; });

  let cardH = () => ZIG + PAD_TOP + blocks.reduce((s, b) => s + b.h, 0) + PAD_BOTTOM + ZIG;
  // 放不下先压封面
  const img = blocks.find(b => b.type === 'img');
  const over = cardH() - (REGION_BOTTOM - REGION_TOP);
  if (img && over > 0) img.h = Math.max(IMG_MIN, IMG_MAX - over);
  const h = cardH();
  const y = Math.round(REGION_TOP + Math.max(0, (REGION_BOTTOM - REGION_TOP - h) / 2));
  return { f, blocks, cardH: h, cardY: y };
}

function draw(ctx, model, covers, env) {
  const e = env || {};
  const fontsReady = !!e.fontsReady;
  const f = model.film;
  const node = (covers || {})[f.key] || null;
  const hasCover = !!(node && node.width && node.height);
  const thermal = ((e.thermal || {})[f.key]) || null;
  const L = layout(ctx, model, hasCover);

  // 1. 暗场景 + 顶光
  tint.drawStage(ctx, (e.tints || {})[f.key], W, H);
  const light = ctx.createRadialGradient(W / 2, 250, 0, W / 2, 250, 550);
  light.addColorStop(0, 'rgba(255,255,255,0.22)');
  light.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = light;
  ctx.fillRect(0, 0, W, H);

  // 2. 小票：整张略歪
  kit.rotated(ctx, W / 2, L.cardY + L.cardH / 2, TILT, () => {
    ctx.translate(-CARD_W / 2, -L.cardH / 2);
    kit.withShadow(ctx, { color: 'rgba(0,0,0,0.5)', blur: 50, y: 34 }, 1, () => {
      kit.receiptPath(ctx, 0, 0, CARD_W, L.cardH, TOOTH);
      ctx.fillStyle = PAPER;
      ctx.fill();
    });

    const x0 = PAD_X, x1 = CARD_W - PAD_X, cx = CARD_W / 2;
    let y = ZIG + PAD_TOP;
    ctx.textBaseline = 'middle';
    L.blocks.forEach(b => {
      if (b.type === 'dash') {
        kit.dashed(ctx, x0, y + 21, x1, y + 21, 2, '#CFCFCF', 8, 6);
      } else if (b.type === 'head') {
        ctx.fillStyle = INK;
        ctx.font = T.num(800, 36, fontsReady);
        text.drawSpaced(ctx, 'MARKED', cx, y + 22, 12, 'center');
        ctx.font = T.mono(400, 20);
        text.drawSpaced(ctx, model.ordinal ? `观影小票 No.${pad4(model.ordinal)}` : '观影小票', cx, y + 44 + 6 + 14, 2, 'center');
        if (f.dateDot) {
          ctx.fillStyle = '#777777';
          ctx.textAlign = 'center';
          ctx.fillText([f.dateDot, f.weekdayEn].filter(Boolean).join(' '), cx, y + 44 + 6 + 28 + 2 + 14);
          ctx.textAlign = 'left';
        }
      } else if (b.type === 'img') {
        if (thermal) {
          const c = kit.coverCrop(thermal.width, thermal.height, IMG_W, b.h);
          ctx.drawImage(thermal, c[0], c[1], c[2], c[3], x0, y, IMG_W, b.h);
        } else {
          kit.drawCover(ctx, node, x0, y, IMG_W, b.h, { r: 0, shadow: false, hairline: false, title: f.title, focusY: 0.3 });
        }
      } else if (b.type === 'film') {
        ctx.fillStyle = INK;
        ctx.font = T.mono(400, 24);
        ctx.fillText('电影票 ×1', x0, y + ROW_LH / 2);
        let ty = y + ROW_LH + 2;
        ctx.font = T.cn(900, b.fit.size);
        b.fit.lines.forEach(line => { text.drawSpaced(ctx, line, x0 - b.fit.size * 0.3, ty + b.titleLH / 2, 2, 'left'); ty += b.titleLH; });
        if (b.meta) {
          ctx.fillStyle = GREY;
          ctx.font = T.cn(400, 22);
          ctx.fillText(text.ellipsis(b.meta, INNER_W, s => ctx.measureText(s).width), x0, ty + 4 + 16);
        }
      } else if (b.type === 'rows') {
        ctx.fillStyle = INK;
        ctx.font = T.mono(400, 24);
        b.rows.forEach((r, i) => {
          const ry = y + ROW_LH * (i + 0.5);
          ctx.textAlign = 'left';
          ctx.fillText(r[0], x0, ry);
          ctx.textAlign = 'right';
          ctx.fillText(r[1], x1, ry);
        });
        ctx.textAlign = 'left';
      } else if (b.type === 'total') {
        drawTotal(ctx, b, f, x0, x1, y);
      } else if (b.type === 'thanks') {
        ctx.fillStyle = FAINT;
        ctx.font = T.mono(400, 18);
        text.drawSpaced(ctx, 'THANK YOU FOR WATCHING', cx, y + 14, 4, 'center');
      }
      y += b.h;
    });
  });

  // 3. 署名
  ctx.textBaseline = 'alphabetic';
  kit.watermark(ctx, W / 2, H - 52, 1, 'rgba(255,255,255,0.62)');
}

function drawTotal(ctx, b, f, x0, x1, y) {
  let cy = y;
  if (b.badge) {
    const mid = cy + 24;
    ctx.fillStyle = INK;
    ctx.font = T.mono(700, 34);
    ctx.fillText('TOTAL', x0, mid);
    if (b.badge === 'stars') {
      const sw = 5 * 34 + 4 * 5;
      kit.stars(ctx, x1 - sw, mid - 17, f.rating, 34, 5, T.COLOR.acc, 'rgba(0,0,0,0.12)');
    } else {
      ctx.font = T.cn(400, 26);
      ctx.textAlign = 'right';
      ctx.fillText(`${f.moodEmoji || ''} ${f.moodLabel}`.trim(), x1, mid);
      ctx.textAlign = 'left';
    }
    cy += 48 + (b.noteLines.length ? 14 : 0);
  }
  ctx.fillStyle = INK;
  ctx.font = T.cn(400, 24);
  b.noteLines.forEach(line => { ctx.fillText(line, x0, cy + NOTE_LH / 2); cy += NOTE_LH; });
}

module.exports = { supports, measure, draw, layout, prepare };
