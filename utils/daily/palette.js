/**
 * 每日主题公共层 · 四套全站主题色的 JS 镜像
 *
 * 页面上的颜色一律走 styles/theme.wxss 的 CSS 变量（--brand-accent 等），这里只给 CSS 变量做不到的地方用：
 * 按数值算出来的热力格颜色、canvas 海报、进度环 SVG。
 * ⚠ 色值必须与 styles/theme.wxss 一致 —— tools/test-daily-metric.cjs 会逐项解析比对，改一边忘了另一边测试就挂。
 *
 * 主题 id ↔ 全站 class：pink ↔ ''（默认粉，没有 class）、gold ↔ theme-gold、green ↔ theme-green、sand ↔ theme-sand。
 */

const THEMES = {
  pink: {
    id: 'pink', name: '粉色', cls: '',
    primary: '#FAE0E4', soft: '#FFB2DD', accent: '#93415E', tint: '#F9EDF1',
    button: '#FAE0E4', hero: '#FAE0E4', heroInk: '#5E2539', heroSoft: '#9A6378'
  },
  gold: {
    id: 'gold', name: '暖金', cls: 'theme-gold',
    primary: '#F7D66E', soft: '#FEEFBF', accent: '#7B5918', tint: '#FBF3DE',
    button: '#F7D66E', hero: '#F7D66E', heroInk: '#553A0B', heroSoft: '#85621F'
  },
  green: {
    id: 'green', name: '橄榄绿', cls: 'theme-green',
    primary: '#9AAB65', soft: '#9AAB65', accent: '#526631', tint: '#EEF2E5',
    button: '#9AAB65', hero: '#9AAB65', heroInk: '#1F2B12', heroSoft: '#34421B'
  },
  sand: {
    id: 'sand', name: '暖沙', cls: 'theme-sand',
    primary: '#F8F3E7', soft: '#EDE7DA', accent: '#756044', tint: '#F4EFE6',
    button: '#E2DACB', hero: '#EDE7DA', heroInk: '#4A3D2A', heroSoft: '#8A7A62'
  }
};

const DEFAULT_ID = 'green';   // 与 app.js 一致：没存过主题时是橄榄绿
const NEUTRAL = { ink: '#2D2D2B', inkSoft: '#6F6F68', inkMuted: '#9C998F', line: '#EAEAE7', card: '#FFFFFF', page: '#FAFAFA' };

function idFromClass(cls) {
  const key = Object.keys(THEMES).find(k => THEMES[k].cls === cls);
  return key || DEFAULT_ID;
}

// 当前全站主题的 class。'' 是合法值（粉色），所以只能用 == null 判断「没设置」，不能用 ||
function currentClass() {
  try {
    const app = getApp();
    const t = app && app.globalData ? app.globalData.theme : null;
    return t == null ? THEMES[DEFAULT_ID].cls : t;
  } catch (e) {
    return THEMES[DEFAULT_ID].cls;
  }
}

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
}

function rgbToHex(rgb) {
  return '#' + rgb.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('').toUpperCase();
}

function mix(a, b, t) {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  return rgbToHex(x.map((v, i) => v + (y[i] - v) * t));
}

/**
 * 热力 5 档，下标就是 metric.heatLevel 的返回值：
 *   0 = 0 步（中性浅灰） 1~3 = 未达标，从 tint 往 accent 走 4 = 达标（accent 实色）
 */
function heatRamp(theme) {
  return [NEUTRAL.line, mix(theme.tint, theme.accent, 0.22), mix(theme.tint, theme.accent, 0.45), mix(theme.tint, theme.accent, 0.7), theme.accent];
}

function get(id) {
  const t = THEMES[id] || THEMES[DEFAULT_ID];
  return Object.assign({}, NEUTRAL, t, { heat: heatRamp(t) });
}

function current() {
  return get(idFromClass(currentClass()));
}

// 海报页色卡：[{ id, name, swatch }]
const LIST = Object.keys(THEMES).map(k => ({ id: k, name: THEMES[k].name, swatch: THEMES[k].accent }));

module.exports = { THEMES, LIST, DEFAULT_ID, NEUTRAL, get, current, currentClass, idFromClass, mix };
