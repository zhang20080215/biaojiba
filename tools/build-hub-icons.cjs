// 由 utils/hubIcons.js 生成 styles/hub-icons.wxss（线条图标的 SVG data URI 样式类）。
// 用法：node tools/build-hub-icons.cjs
// 体积控制：每个图标只出一份深色版本；白色（封面上）用 filter 反白、浅灰（时间轴）用 opacity，
// 只有「每日标记」四个图标需要跟主题强调色，各出四套主题色。
const fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..');
const { ICONS, svg } = require(path.join(root, 'utils/hubIcons.js'));

const uri = s => `url('data:image/svg+xml,${encodeURIComponent(s).replace(/'/g, '%27').replace(/\(/g, '%28').replace(/\)/g, '%29')}')`;
const INK = '#2D2D2B';
// 与 styles/theme.wxss 的 --brand-accent 同值
const ACCENTS = { '': '#93415E', 'theme-gold': '#7B5918', 'theme-green': '#526631', 'theme-sand': '#756044' };
const DAILY = ['clapper', 'reading', 'dumbbell', 'droplet', 'sparkle'];
// 跟随强调色的独立图标（如首页「榜单许愿」链接），类名 .hub-glyph-accent
const ACCENT_ICONS = ['wand'];

const lines = [
  '/* 由 tools/build-hub-icons.cjs 从 utils/hubIcons.js 生成，勿手改；改图标后重跑该脚本 */',
  '.hub-glyph { display: block; background-repeat: no-repeat; background-position: center; background-size: contain; }',
  '.hub-glyph-white { filter: brightness(0) invert(1); }',
  '.hub-glyph-muted { opacity: 0.42; }'
];
for (const key of Object.keys(ICONS)) lines.push(`.hub-glyph.icon-${key} { background-image: ${uri(svg(key, INK))}; }`);
// 每日标记 / 分类页每日卡片：图标跟主题强调色（默认粉色 + 三套主题）
for (const [theme, color] of Object.entries(ACCENTS)) {
  const scope = theme ? `.hub-root.${theme} ` : '';
  for (const key of DAILY) lines.push(`${scope}.hub-daily-icon .hub-glyph.icon-${key} { background-image: ${uri(svg(key, color, 1.9))}; }`);
  for (const key of ACCENT_ICONS) lines.push(`${scope}.hub-glyph-accent.icon-${key} { background-image: ${uri(svg(key, color, 1.9))}; }`);
}
// 分类页收藏星：未收藏 = 白描边（压在封面上），已收藏 = 金色实心
const STAR = `<path d='M12 3.4l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.8l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z'/>`;
const solid = (body, fill) => `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='${fill}' stroke='${fill}' stroke-width='1.2' stroke-linejoin='round'>${body}</svg>`;
const line = (body, color, w) => `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='${color}' stroke-width='${w}' stroke-linecap='round' stroke-linejoin='round'>${body}</svg>`;
lines.push(`.hub-fav-icon { background-image: ${uri(line(STAR, '#FFFFFF', 2))}; }`);
lines.push(`.hub-fav-on .hub-fav-icon { background-image: ${uri(solid(STAR, '#FFC53D'))}; }`);
// 记录页「期待上线」爱心：照小红书——未赞深灰描边，已赞 #FF2442 实心，粒子也是同色实心小爱心
const HEART = `<path d='M12 20.4C6.4 16.5 2.8 13.3 2.8 9.1 2.8 6.4 4.9 4.3 7.6 4.3c1.8 0 3.4 1 4.4 2.5 1-1.5 2.6-2.5 4.4-2.5 2.7 0 4.8 2.1 4.8 4.8 0 4.2-3.6 7.4-9.2 11.3z'/>`;
lines.push(`.records-like-heart { background-image: ${uri(line(HEART, '#333333', 1.9))}; }`);
lines.push(`.records-like-heart.is-liked, .records-like-spark { background-image: ${uri(solid(HEART, '#FF2442'))}; }`);
const out = path.join(root, 'styles/hub-icons.wxss');
fs.writeFileSync(out, lines.join('\n') + '\n');
console.log(out, (fs.statSync(out).size / 1024).toFixed(1) + 'KB');
