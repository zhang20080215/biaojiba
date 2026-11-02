// 版式 · 金句（单部）。只在这条记录写了短评时出现（supportsModel）。
// 「我」是主角：短评用尽量大的字当海报标题，电影退到底部当配角（小封面 + 片名 + 星级），右下是记录编号 No.037。
// 缩到小红书信息流的四分之一宽时，短评、编号仍然读得出来 —— 这是这个版式存在的理由。
// 场景底跟别的版式一样能切深 / 浅（env.stage）。
const T = require('../tokens.js');
const kit = require('../kit.js');
const text = require('../text.js');
const tint = require('../tint.js');

const { COLOR } = T;
const W = 1080, H = 1440;
const X0 = 92, X1 = W - 92, INNER_W = X1 - X0;
const QUOTE_TOP = 300, QUOTE_BOTTOM = 1000;
const QUOTE_SIZES = [120, 104, 88, 76, 64, 56, 48];
const QUOTE_LH = 1.34;
const ROW_Y = 1060, COVER_W = 132, COVER_H = 188;

function supports(kind) { return kind === 'single'; }

function supportsModel(model) {
  return !!(model && model.film && String(model.film.note || '').trim());
}

function measure() { return { width: W, height: H }; }

/** 按句读切成分句（标点留在分句末尾）：「不要回头，」「一直往前走。」 */
function clausesOf(note) {
  return String(note).match(/[^，。！？；、,.!?;]+[，。！？；、,.!?;」』”]*/g) || [String(note)];
}

/**
 * 从大到小找字号。先试「一个分句一行」—— 金句在句读处断行才像句子，
 * 「不要回头，一直 / 往前走。」这种折在半句中间的读着别扭；分句太多或太长放不下，再退回按字折行。
 */
function fitQuote(ctx, note) {
  const avail = QUOTE_BOTTOM - QUOTE_TOP;
  const clauses = clausesOf(note);
  if (clauses.length > 1 && clauses.length <= 5) {
    for (let i = 0; i < QUOTE_SIZES.length; i++) {
      const size = QUOTE_SIZES[i];
      const lh = Math.round(size * QUOTE_LH);
      if (clauses.length * lh > avail) continue;
      ctx.font = T.cn(700, size);
      if (clauses.every(c => ctx.measureText(c).width <= INNER_W)) return { size, lh, lines: clauses };
      if (size <= 64) break;   // 小到这个字号还放不下，按字折行能用更大的字
    }
  }
  for (let i = 0; i < QUOTE_SIZES.length; i++) {
    const size = QUOTE_SIZES[i];
    const lh = Math.round(size * QUOTE_LH);
    const maxLines = Math.max(1, Math.floor(avail / lh));
    ctx.font = T.cn(700, size);
    const lines = text.wrapLines(note, INNER_W, maxLines, s => ctx.measureText(s).width);
    const last = lines[lines.length - 1] || '';
    if (last.slice(-1) !== text.ELLIPSIS || i === QUOTE_SIZES.length - 1) return { size, lh, lines };
  }
  return null;
}

function draw(ctx, model, covers, env) {
  const e = env || {};
  const fontsReady = !!e.fontsReady;
  const mode = e.stage === 'light' ? 'light' : 'dark';
  const ink = tint.stageInk(mode);
  const f = model.film;
  const node = (covers || {})[f.key] || null;

  // 1. 场景底
  tint.drawStage(ctx, (e.tints || {})[f.key], W, H, mode);

  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';

  // 2. 顶行：态度章（强调色胶囊）……… 日期 星期
  ctx.font = T.cn(900, 36);
  const vw = text.spacedWidth(f.verdict, 6, s => ctx.measureText(s).width);
  kit.fillRoundRect(ctx, X0, 86, vw + 56, 72, 36, COLOR.acc);
  ctx.fillStyle = '#FFFFFF';
  text.drawSpaced(ctx, f.verdict, X0 + 28, 86 + 36, 6, 'left');
  const dateText = [f.dateDot, f.weekdayEn].filter(Boolean).join(' ');
  if (dateText) {
    ctx.fillStyle = ink.ink2;
    ctx.font = T.num(500, 24, fontsReady);
    text.drawSpaced(ctx, dateText, X1, 86 + 36, 2, 'right');
  }

  // 3. 大引号 + 短评
  const q = fitQuote(ctx, String(f.note).trim());
  if (q) {
    const blockH = q.lines.length * q.lh;
    let y = QUOTE_TOP + Math.max(0, (QUOTE_BOTTOM - QUOTE_TOP - blockH) / 2);
    // 大引号贴在正文上方
    ctx.fillStyle = COLOR.acc;
    ctx.font = T.num(800, 240, fontsReady);
    ctx.fillText('“', X0 - 10, Math.max(200, y - 40));
    ctx.fillStyle = ink.ink;
    ctx.font = T.cn(700, q.size);
    q.lines.forEach(line => { ctx.fillText(line, X0, y + q.lh / 2); y += q.lh; });
  }

  // 4. 底部：发丝线 → 小封面 + 片名 / 年份·导演 / 星级 ……… No.037
  kit.line(ctx, X0, ROW_Y - 36, X1, ROW_Y - 36, 2, mode === 'light' ? 'rgba(22,24,29,0.14)' : 'rgba(255,255,255,0.22)');
  kit.drawCover(ctx, node, X0, ROW_Y, COVER_W, COVER_H,
    { r: 10, shadow: { color: ink.shadow, blur: 24, y: 10 }, hairline: false, title: f.title });

  const serialW = model.serial ? 260 : 0;
  const tx = X0 + COVER_W + 32, tw = X1 - tx - serialW - 20;
  const measureAt = size => { ctx.font = T.cn(900, size); return s => ctx.measureText(s).width + 2 * Math.max(0, Array.from(s).length - 1); };
  const fit = text.fitTitle(f.title || '未命名电影', tw, [48, 40, 34], measureAt);
  ctx.fillStyle = ink.ink;
  ctx.font = T.cn(900, fit.size);
  text.drawSpaced(ctx, text.ellipsis(fit.lines[0], tw, measureAt(fit.size)), tx, ROW_Y + 34, 2, 'left');
  const meta = [f.year, f.director].filter(Boolean).join(' · ');
  if (meta) {
    ctx.fillStyle = ink.ink2;
    ctx.font = T.cn(400, 24);
    ctx.fillText(text.ellipsis(meta, tw, s => ctx.measureText(s).width), tx, ROW_Y + 34 + 30 + 20);
  }
  if (f.rating > 0) kit.stars(ctx, tx, ROW_Y + 134, f.rating, 32, 6, COLOR.acc, mode === 'light' ? COLOR.starOff : 'rgba(255,255,255,0.25)');

  if (model.serial) {
    ctx.fillStyle = ink.ink;
    ctx.font = T.num(800, 72, fontsReady);
    text.drawSpaced(ctx, model.serial, X1, ROW_Y + 70, -1, 'right');
    ctx.fillStyle = ink.ink2;
    ctx.font = T.cn(400, 22);
    text.drawSpaced(ctx, `我记录的第 ${model.ordinal} 部`, X1, ROW_Y + 70 + 36 + 26, 2, 'right');
  }

  // 5. 署名
  ctx.textBaseline = 'alphabetic';
  kit.watermark(ctx, W / 2, H - 52, 1, ink.wm);
}

module.exports = { supports, supportsModel, measure, draw, clausesOf, stages: true };
