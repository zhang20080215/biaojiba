/**
 * 每日打卡 · 水瓶 / 水杯 SVG 生成
 *
 * 抽离自 pages/daily/index/index.js，让页面文件只关心数据与交互。
 * 水位是动态的（随 progress 变化），所以仍以函数返回 data URL 字符串，
 * 由 wxml 的 <image> 渲染。
 *
 * 设计来源：Claude Design 「Water Tracker」交付稿
 * 简化版：只画 黄盖 + 白颈 + 瓶身 + 水位 + 主波浪 + 笑脸
 *        （去掉腮红、瓶身竖向高光、波浪高光线 —— 让水瓶更接近极简稿）
 */

const { DESIGN_TOKENS } = require('./dailyThemes.js');

const T = DESIGN_TOKENS;

/**
 * 按进度返回水瓶表情（眼+嘴）的 SVG 片段。4 档：
 *  - pct === 0     蔫蔫：闭眼线 + 倒弧嘴
 *  - pct < 0.5     平静：圆眼 + 浅笑
 *  - pct < 1       开心：圆眼 + 标准笑（默认）
 *  - pct ≥ 1       满足：月牙眼 + 大笑
 */
function faceFor(pct, w, eyeY, ink, stroke) {
  const cx = w / 2;
  const eo = w * 0.10;       // 眼睛横向偏移
  const er = w * 0.022;      // 圆眼半径
  const mw = w * 0.06;       // 嘴宽
  const mv = w * 0.05;       // 嘴竖向起点
  const mh = w * 0.05;       // 嘴弧高
  const sw = stroke * 0.75;

  const dot = (cx0, cy0) =>
    `<circle cx="${cx0}" cy="${cy0}" r="${er}" fill="${ink}"/>`;
  const closedEye = (cx0, cy0) =>
    `<path d="M ${cx0 - er} ${cy0} L ${cx0 + er} ${cy0}" stroke="${ink}" stroke-width="${sw * 1.2}" stroke-linecap="round"/>`;
  const arcEye = (cx0, cy0) =>
    `<path d="M ${cx0 - er} ${cy0 + er * 0.5} Q ${cx0} ${cy0 - er * 0.8} ${cx0 + er} ${cy0 + er * 0.5}" ` +
    `fill="none" stroke="${ink}" stroke-width="${sw * 1.2}" stroke-linecap="round"/>`;

  // pct === 0：闭眼 + 倒弧（皱眉嘴）
  if (pct === 0) {
    return closedEye(cx - eo, eyeY) + closedEye(cx + eo, eyeY) +
      `<path d="M ${cx - mw * 0.7} ${eyeY + mv + mh} Q ${cx} ${eyeY + mv} ${cx + mw * 0.7} ${eyeY + mv + mh}" ` +
      `fill="none" stroke="${ink}" stroke-width="${sw}" stroke-linecap="round"/>`;
  }
  // pct ≥ 1：月牙眼 + 大笑
  if (pct >= 1) {
    return arcEye(cx - eo, eyeY) + arcEye(cx + eo, eyeY) +
      `<path d="M ${cx - mw * 1.2} ${eyeY + mv} Q ${cx} ${eyeY + mv + mh * 1.5} ${cx + mw * 1.2} ${eyeY + mv}" ` +
      `fill="none" stroke="${ink}" stroke-width="${sw * 1.1}" stroke-linecap="round"/>`;
  }
  // 0 < pct < 0.5：圆眼 + 浅笑
  if (pct < 0.5) {
    return dot(cx - eo, eyeY) + dot(cx + eo, eyeY) +
      `<path d="M ${cx - mw * 0.7} ${eyeY + mv + 1} Q ${cx} ${eyeY + mv + mh * 0.5} ${cx + mw * 0.7} ${eyeY + mv + 1}" ` +
      `fill="none" stroke="${ink}" stroke-width="${sw}" stroke-linecap="round"/>`;
  }
  // 0.5 ≤ pct < 1：圆眼 + 标准笑
  return dot(cx - eo, eyeY) + dot(cx + eo, eyeY) +
    `<path d="M ${cx - mw} ${eyeY + mv} Q ${cx} ${eyeY + mv + mh} ${cx + mw} ${eyeY + mv}" ` +
    `fill="none" stroke="${ink}" stroke-width="${sw}" stroke-linecap="round"/>`;
}

/**
 * 生成水瓶 data URL（aspectFit 用）
 * @param {number} pct 0~1 进度
 * @param {string} capColor 瓶盖色
 * @param {{ w?: number, h?: number, stroke?: number }} [opts]
 * @returns {string} data:image/svg+xml,...
 */
function buildBottleSvg(pct, capColor, opts) {
  const w = (opts && opts.w) || 168;
  const h = (opts && opts.h) || 240;
  const stroke = (opts && opts.stroke) || 4;

  const neckW = w * 0.34;
  const neckH = h * 0.10;
  const capH = h * 0.05;
  const bodyTop = neckH + capH;
  const bodyH = h - bodyTop;
  const waterH = bodyH * pct;
  const waterTop = h - waterH;
  const rx = w * 0.17;

  const capX = (w - neckW - 16) / 2;
  const neckX = (w - neckW) / 2;
  const eyeY = bodyTop + bodyH * 0.62;
  const clipId = `b${Math.round(pct * 1000)}`;

  const wavePath =
    `M 0 ${waterTop} Q ${w * 0.18} ${waterTop - 8}, ${w * 0.34} ${waterTop} ` +
    `T ${w * 0.66} ${waterTop} T ${w} ${waterTop} ` +
    `L ${w} ${waterTop + 16} L 0 ${waterTop + 16} Z`;

  const water = pct > 0
    ? `<g clip-path="url(#${clipId})">` +
      `<rect x="0" y="${waterTop}" width="${w}" height="${waterH + 20}" fill="${T.blue}"/>` +
      `<path d="${wavePath}" fill="${T.blue}"/>` +
      `</g>`
    : '';

  const face = faceFor(pct, w, eyeY, T.ink, stroke);

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">` +
    `<defs><clipPath id="${clipId}">` +
    `<rect x="${stroke}" y="${bodyTop}" width="${w - stroke * 2}" height="${bodyH - stroke}" rx="${rx}" ry="${rx}"/>` +
    `</clipPath></defs>` +
    `<rect x="${capX}" y="0" width="${neckW + 16}" height="${capH + 4}" rx="6" ry="6" ` +
    `fill="${capColor}" stroke="${T.ink}" stroke-width="${stroke}" stroke-linejoin="round"/>` +
    `<rect x="${neckX}" y="${capH}" width="${neckW}" height="${neckH}" rx="4" ry="4" ` +
    `fill="#fff" stroke="${T.ink}" stroke-width="${stroke}" stroke-linejoin="round"/>` +
    `<rect x="${stroke}" y="${bodyTop}" width="${w - stroke * 2}" height="${bodyH - stroke}" rx="${rx}" ry="${rx}" ` +
    `fill="#fff" stroke="${T.ink}" stroke-width="${stroke}" stroke-linejoin="round"/>` +
    water +
    `<g>${face}</g>` +
    `</svg>`;

  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

/**
 * 生成水杯 data URL —— 用于 quick preset 按钮
 * 真稿 CupGlyph：viewBox 40×40，杯身梯形 + 顶部椭圆杯口，水位用 clipPath 控制
 * @param {number} fillPct 0~1 杯内水位
 * @param {string} [color] 水的颜色，默认蓝色
 * @returns {string}
 */
function buildCupSvg(fillPct, color) {
  const c = color || T.blue;
  const id = `cg${Math.round(fillPct * 100)}`;
  const cupPath = 'M11 11 L29 11 L27.5 32 Q 27.5 34.5 25 34.5 L15 34.5 Q 12.5 34.5 12.5 32 Z';
  const waterY = 11 + 23.5 * (1 - fillPct);

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" width="40" height="40">` +
    `<defs><clipPath id="${id}"><path d="${cupPath}"/></clipPath></defs>` +
    `<path d="${cupPath}" fill="#fff" stroke="${T.ink}" stroke-width="2.4" stroke-linejoin="round"/>` +
    `<g clip-path="url(#${id})">` +
    `<rect x="0" y="${waterY}" width="40" height="40" fill="${c}"/>` +
    `</g>` +
    `<ellipse cx="20" cy="11" rx="9" ry="2" fill="${c}" stroke="${T.ink}" stroke-width="2.4"/>` +
    `</svg>`;

  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

/**
 * 三个 preset 对应的水位（来自真稿：[0.25, 0.55, 0.9]）
 */
const PRESET_FILL_LEVELS = [0.25, 0.55, 0.9];

module.exports = {
  buildBottleSvg,
  buildCupSvg,
  PRESET_FILL_LEVELS
};
