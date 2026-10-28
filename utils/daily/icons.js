/**
 * 每日主题公共层 · 首页底部卡片的线性小图标（SVG data URI，颜色跟随主题强调色）
 * 24 网格、2 线宽、圆角端点，和 images/icon-stats.svg 等导航图标同一种画法。
 */
const PATHS = {
  route: '<circle cx="6" cy="18" r="2.2"/><circle cx="18" cy="6" r="2.2"/><path d="M8.2 18H15a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h6.8"/>',
  chart: '<path d="M4 19l5-6 4 3 7-9"/><path d="M15 7h5v5"/>',
  flame: '<path d="M12 21c-3.9 0-6.5-2.6-6.5-6.2 0-3.5 2.6-5.6 3.8-8.8.9 1.6 1.4 3 1.4 4.3 1.3-.8 2.3-2.5 2.6-4.8 2.6 2 5.2 5.3 5.2 9.3 0 3.6-2.6 6.2-6.5 6.2z"/>',
  moon: '<path d="M19.5 14.6A7.8 7.8 0 1 1 9.4 4.5a6.2 6.2 0 0 0 10.1 10.1z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/>',
  pencil: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>'
};

function iconUri(name, color) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${color}" ` +
    `stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${PATHS[name] || ''}</svg>`;
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

module.exports = { iconUri };
