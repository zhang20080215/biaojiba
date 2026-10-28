/**
 * 每日主题公共层 · 进度环（SVG data URI，给 <image> 用）
 * 中间的数字由 WXML 叠在上面，这里只画环；颜色从 palette 传入，四套主题色各自成色。
 */
function ringUri(pct, opts) {
  const o = opts || {};
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  const R = 42, C = 2 * Math.PI * R, W = o.width || 9;
  const dash = (p / 100 * C).toFixed(2);
  const arc = p > 0
    ? `<circle cx="50" cy="50" r="${R}" fill="none" stroke="${o.color}" stroke-width="${W}" stroke-linecap="round" ` +
      `stroke-dasharray="${dash} ${(C - dash).toFixed(2)}" transform="rotate(-90 50 50)"/>`
    : '';
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">` +
    `<circle cx="50" cy="50" r="${R}" fill="none" stroke="${o.track}" stroke-width="${W}"/>` +
    arc +
    `</svg>`;
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

module.exports = { ringUri };
