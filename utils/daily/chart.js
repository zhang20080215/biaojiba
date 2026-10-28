/**
 * 每日主题公共层 · 统计页折线图（SVG data URI，给 <image> 用）
 *
 * 输入和柱状图同一份 bars（stats.js 算好的 { h: 0~100 高度百分比, color, missing, future }），
 * 所以两种图的纵向刻度、目标虚线位置完全一致，切换时只换画法不重算数据。
 * 无数据 / 未来的日子不画点，折线在这里断开（不把缺的天连成一条斜线，免得像是走了一半）。
 *
 * 画布宽高按统计页图表区的 rpx 尺寸给（616×320），<image> 用 scaleToFill 铺满；
 * rpx 在所有屏幕上等比缩放，所以不会被拉伸变形。
 */
const W = 616;
const H = 320;

function lineChartSvg(bars, opts) {
  const o = opts || {};
  const n = bars.length || 1;
  const step = W / n;
  const r = n > 12 ? 4 : 6;
  const pts = bars.map((b, i) => (b.missing || b.future ? null : {
    x: +(step * (i + 0.5)).toFixed(1),
    y: +(H * (1 - b.h / 100)).toFixed(1),
    color: b.color || o.color
  }));
  // 连续有数据的点连成一段
  const segs = [];
  let cur = [];
  pts.forEach(p => {
    if (p) cur.push(p);
    else if (cur.length) { segs.push(cur); cur = []; }
  });
  if (cur.length) segs.push(cur);
  // 每段线下面铺一层浅色面积，线本身再压在上面
  const lines = segs.filter(s => s.length > 1).map(s => {
    const pts2 = s.map(p => p.x + ',' + p.y).join(' ');
    const area = `${s[0].x},${H} ${pts2} ${s[s.length - 1].x},${H}`;
    return `<polygon points="${area}" fill="${o.color}" fill-opacity="0.12"/>` +
      `<polyline points="${pts2}" fill="none" stroke="${o.color}" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>`;
  }).join('');
  const dots = pts.filter(Boolean).map(p =>
    `<circle cx="${p.x}" cy="${p.y}" r="${r}" fill="${p.color}" stroke="#FFFFFF" stroke-width="2"/>`
  ).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">${lines}${dots}</svg>`;
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

module.exports = { lineChartSvg, CHART_W: W, CHART_H: H };
