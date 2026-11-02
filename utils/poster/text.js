// 海报文字排版：换行、省略、字距。
// 纯函数，不碰 wx / ctx —— measure(text) → 宽度 由调用方传入（绘制时包一层 ctx.measureText，
// 测试里用假函数），tools/test-poster-text.cjs 直接跑。
// 字距靠逐字绘制实现：小程序 canvas 不保证支持 ctx.letterSpacing。

const ELLIPSIS = '…';

/** 把 text 截到 maxW 以内，放不下就以「…」结尾 */
function ellipsis(text, maxW, measure) {
  const s = String(text == null ? '' : text);
  if (!s || measure(s) <= maxW) return s;
  const chars = Array.from(s);
  let lo = 0, hi = chars.length;
  // 二分找最长前缀：prefix + … 放得下
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measure(chars.slice(0, mid).join('') + ELLIPSIS) <= maxW) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? chars.slice(0, lo).join('') + ELLIPSIS : ELLIPSIS;
}

/**
 * 按字切行，最多 maxLines 行；超出的部分在最后一行以「…」收尾。
 * 英文单词不做整词换行 —— 海报上的长文字是中文短评，按字切最稳。
 */
function wrapLines(text, maxW, maxLines, measure) {
  const s = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  if (!s) return [];
  const chars = Array.from(s);
  const lines = [];
  let cur = '';
  for (let i = 0; i < chars.length; i++) {
    const next = cur + chars[i];
    if (cur && measure(next) > maxW) {
      lines.push(cur);
      cur = chars[i] === ' ' ? '' : chars[i];
      if (lines.length === maxLines) {
        // 放满了：把剩下的并进最后一行再整体省略
        lines[maxLines - 1] = ellipsis(lines[maxLines - 1] + chars.slice(i).join(''), maxW, measure);
        return lines;
      }
    } else {
      cur = next;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

/** 带字距的总宽（字距只加在字与字之间） */
function spacedWidth(text, spacing, measure) {
  const chars = Array.from(String(text || ''));
  if (!chars.length) return 0;
  return chars.reduce((w, ch) => w + measure(ch), 0) + spacing * (chars.length - 1);
}

/**
 * 逐字绘制带字距的文字。align: 'left' | 'center' | 'right'（相对 x）。
 * 调用前 ctx.font / fillStyle / textBaseline 已设好；返回画出的宽度。
 */
function drawSpaced(ctx, text, x, y, spacing, align) {
  const measure = t => ctx.measureText(t).width;
  const chars = Array.from(String(text || ''));
  const total = spacedWidth(text, spacing, measure);
  let cx = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
  const prevAlign = ctx.textAlign;
  ctx.textAlign = 'left';
  chars.forEach(ch => {
    ctx.fillText(ch, cx, y);
    cx += measure(ch) + spacing;
  });
  ctx.textAlign = prevAlign;
  return total;
}

/**
 * 从大到小试字号，返回第一个让 text 在 maxLines 行内放下（不需要省略）的字号；
 * 都放不下就返回最小那个。measureAt(size) → measure 函数。
 */
function fitFontSize(text, maxW, maxLines, sizes, measureAt) {
  for (let i = 0; i < sizes.length; i++) {
    const m = measureAt(sizes[i]);
    const lines = wrapLines(text, maxW, maxLines, m);
    const last = lines[lines.length - 1] || '';
    if (last.slice(-1) !== ELLIPSIS || String(text).slice(-1) === ELLIPSIS) return sizes[i];
  }
  return sizes[sizes.length - 1];
}

/**
 * 大标题排版：先从大到小找能一行放下的字号；都放不下再按两行排，并把两行尽量切均匀，
 * 避免「牯岭街少年杀人事 / 件」这种第二行只剩一个字。返回 { size, lines }。
 */
function fitTitle(text, maxW, sizes, measureAt) {
  const s = String(text == null ? '' : text).trim();
  for (let i = 0; i < sizes.length; i++) {
    if (measureAt(sizes[i])(s) <= maxW) return { size: sizes[i], lines: [s] };
  }
  const chars = Array.from(s);
  for (let i = 0; i < sizes.length; i++) {
    const m = measureAt(sizes[i]);
    // 从正中间往两边找第一个两半都放得下的切点
    const mid = Math.ceil(chars.length / 2);
    for (let d = 0; d < chars.length; d++) {
      for (const cut of d ? [mid + d, mid - d] : [mid]) {
        if (cut <= 0 || cut >= chars.length) continue;
        const a = chars.slice(0, cut).join('').trim(), b = chars.slice(cut).join('').trim();
        if (m(a) <= maxW && m(b) <= maxW) return { size: sizes[i], lines: [a, b] };
      }
    }
  }
  const size = sizes[sizes.length - 1];
  return { size, lines: wrapLines(s, maxW, 2, measureAt(size)) };
}

module.exports = { ELLIPSIS, ellipsis, wrapLines, spacedWidth, drawSpaced, fitFontSize, fitTitle };
