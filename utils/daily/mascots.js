/**
 * 每日主题公共层 · 首页主角插画（SVG data URI，给 <image> 用）
 *
 * 学每日喝水的水瓶（utils/dailyBottle.js）：粗描边 + 白底 + 随进度变化的填色和表情，
 * 让首页有一个会给情绪反馈的焦点。填色取当前全站主题色（palette），四套主题各自成色。
 *   shoeSvg(pct, p)   每日步数：鞋身按完成度从后跟往前染色，表情 4 档（同水瓶）
 *   moonSvg(state, p) 每日早睡：pending 还没睡（睁眼）/ ok 早睡（闭眼微笑）/ late 晚睡（闭眼皱眉）
 */
const P = require('./palette.js');

const INK = '#2D2D2B';
const SW = 4;

function uri(svg) {
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

function fillOf(p) {
  return P.mix(p.tint, p.accent, 0.32);
}

// 两只眼 + 嘴。kind: closed 闭眼横线 / dot 圆眼 / happy 弯弯笑眼 / sleep 睡着的下弯眼
function face(ex1, ex2, ey, eyes, mouth, mx, my) {
  let s = '';
  [ex1, ex2].forEach(x => {
    if (eyes === 'dot') s += `<circle cx="${x}" cy="${ey}" r="4.2" fill="${INK}"/>`;
    else if (eyes === 'closed') s += `<path d="M${x - 5} ${ey} L${x + 5} ${ey}" stroke="${INK}" stroke-width="3.4" stroke-linecap="round"/>`;
    else if (eyes === 'happy') s += `<path d="M${x - 5} ${ey + 2} Q${x} ${ey - 5} ${x + 5} ${ey + 2}" fill="none" stroke="${INK}" stroke-width="3.4" stroke-linecap="round"/>`;
    else s += `<path d="M${x - 5} ${ey - 1} Q${x} ${ey + 5} ${x + 5} ${ey - 1}" fill="none" stroke="${INK}" stroke-width="3.4" stroke-linecap="round"/>`;
  });
  const m = {
    frown: `M${mx - 6} ${my + 4} Q${mx} ${my - 2} ${mx + 6} ${my + 4}`,
    flat: `M${mx - 5} ${my + 1} L${mx + 5} ${my + 1}`,
    smile: `M${mx - 6} ${my} Q${mx} ${my + 6} ${mx + 6} ${my}`,
    grin: `M${mx - 9} ${my - 1} Q${mx} ${my + 10} ${mx + 9} ${my - 1}`
  }[mouth];
  return s + `<path d="${m}" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>`;
}

// 运动鞋侧面：左边后跟、中间鞋口下凹、右边沿鞋带斜坡下到鞋头
const SHOE_UPPER = 'M20 98 C18 80 20 62 30 52 C36 46 46 46 52 52 C58 58 70 58 80 50 L94 30 C98 25 106 24 110 28 L150 64 C170 70 186 80 188 98 Z';

/**
 * @param pct 完成度 0~1+（≥1 视为达标）
 * @param p   palette.get(...) 的结果
 */
function shoeSvg(pct, p) {
  const r = Math.max(0, Number(pct) || 0);
  const fillX = 18 + Math.min(1, r) * 170;   // 从后跟往鞋头染
  let eyes = 'dot', mouth = 'smile';
  if (r === 0) { eyes = 'closed'; mouth = 'frown'; }
  else if (r < 0.5) mouth = 'flat';
  else if (r >= 1) { eyes = 'happy'; mouth = 'grin'; }
  // 达标：鞋后跟甩出三道速度线
  const speed = r >= 1
    ? `<path d="M6 70 L16 70 M2 82 L14 82 M8 94 L16 94" stroke="${INK}" stroke-width="3.4" stroke-linecap="round"/>`
    : '';
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 130">` +
    `<defs><clipPath id="u"><path d="${SHOE_UPPER}"/></clipPath></defs>` +
    speed +
    `<path d="${SHOE_UPPER}" fill="#FFFFFF"/>` +
    (r > 0 ? `<rect x="0" y="0" width="${fillX.toFixed(1)}" height="130" fill="${fillOf(p)}" clip-path="url(#u)"/>` : '') +
    `<path d="${SHOE_UPPER}" fill="none" stroke="${INK}" stroke-width="${SW}" stroke-linejoin="round"/>` +
    `<rect x="16" y="98" width="174" height="20" rx="10" fill="#FFFFFF" stroke="${INK}" stroke-width="${SW}"/>` +
    // 鞋带三道 + 鞋头包边
    `<path d="M102 54 L110 42 M113 61 L121 49 M124 68 L132 56" stroke="${INK}" stroke-width="3.4" stroke-linecap="round"/>` +
    `<path d="M152 98 C154 84 162 78 176 80" fill="none" stroke="${INK}" stroke-width="3.4" stroke-linecap="round"/>` +
    face(54, 76, 76, eyes, mouth, 65, 86) +
    `</svg>`;
  return uri(svg);
}

const MOON = 'M118 20 A64 64 0 1 0 156 118 A52 52 0 1 1 118 20 Z';

// 一个「z」：上横、斜线、下横（不用 <text>，小程序 <image> 里 SVG 文字不可靠）
function zee(x, y, w) {
  return `<path d="M${x} ${y} L${x + w} ${y} L${x} ${y + w} L${x + w} ${y + w}" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;
}

function star(cx, cy, r) {
  const k = r * 0.32;
  return `<path d="M${cx} ${cy - r} L${cx + k} ${cy - k} L${cx + r} ${cy} L${cx + k} ${cy + k} L${cx} ${cy + r} L${cx - k} ${cy + k} L${cx - r} ${cy} L${cx - k} ${cy - k} Z" ` +
    `fill="#FFFFFF" stroke="${INK}" stroke-width="2.6" stroke-linejoin="round"/>`;
}

/**
 * @param state 'pending' 还没睡 | 'ok' 早睡达标 | 'late' 晚了
 */
function moonSvg(state, p) {
  const asleep = state !== 'pending';
  const body = state === 'late' ? p.tint : fillOf(p);
  // 脸放在月牙最厚的左半边
  const f = state === 'ok' ? face(52, 68, 88, 'sleep', 'smile', 60, 104)
    : state === 'late' ? face(52, 68, 88, 'sleep', 'frown', 60, 104)
      : face(52, 68, 88, 'dot', 'flat', 60, 104);
  const zz = asleep ? zee(134, 66, 12) + zee(152, 50, 9) : star(150, 74, 8);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 150">` +
    `<path d="${MOON}" fill="${body}" stroke="${INK}" stroke-width="${SW}" stroke-linejoin="round"/>` +
    star(140, 28, 10) +
    zz +
    f +
    `</svg>`;
  return uri(svg);
}

module.exports = { shoeSvg, moonSvg };
