/**
 * 每日主题公共层 · 统计页折线图（SVG data URI，给 <image> 用）
 *
 * 输入和柱状图同一份 bars（stats.js 算好的 { h: 0~100 高度百分比, color, missing, future }），
 * 所以两种图的纵向刻度、目标虚线位置完全一致，切换时只换画法不重算数据。
 * 无数据 / 未来的日子不画点，折线在这里断开（不把缺的天连成一条斜线，免得像是走了一半）。
 * 线用单调三次曲线（Fritsch–Carlson，同 d3 的 curveMonotoneX）：过每个点、整体平滑，
 * 但不会冲过峰值或跌破谷值 —— 普通贝塞尔/Catmull-Rom 会在 0 步那天下面画出负值的弧。
 *
 * 画布宽高按统计页图表区的 rpx 尺寸给（616×320），<image> 用 scaleToFill 铺满；
 * rpx 在所有屏幕上等比缩放，所以不会被拉伸变形。
 */
const W = 616;
const H = 320;

const f1 = v => +v.toFixed(1);

// 一段点的单调三次曲线：返回 path 里 M 之后的部分（「C ...」若干段）
function monotoneCurve(s) {
  const n = s.length;
  if (n < 2) return '';
  if (n === 2) return ` L${s[1].x},${s[1].y}`;
  const m = [];                       // 相邻两点的割线斜率
  for (let i = 0; i < n - 1; i++) m.push((s[i + 1].y - s[i].y) / (s[i + 1].x - s[i].x));
  const t = [m[0]];                   // 每个点的切线斜率
  for (let i = 1; i < n - 1; i++) t.push(m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2);
  t.push(m[n - 2]);
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
    const a = t[i] / m[i], b = t[i + 1] / m[i], h = a * a + b * b;
    if (h > 9) { const k = 3 / Math.sqrt(h); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i]; }
  }
  let d = '';
  for (let i = 0; i < n - 1; i++) {
    const dx = (s[i + 1].x - s[i].x) / 3;
    d += ` C${f1(s[i].x + dx)},${f1(s[i].y + t[i] * dx)} ${f1(s[i + 1].x - dx)},${f1(s[i + 1].y - t[i + 1] * dx)} ${s[i + 1].x},${s[i + 1].y}`;
  }
  return d;
}

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
    const curve = `M${s[0].x},${s[0].y}` + monotoneCurve(s);
    const area = `${curve} L${s[s.length - 1].x},${H} L${s[0].x},${H} Z`;
    return `<path d="${area}" fill="${o.color}" fill-opacity="0.12"/>` +
      `<path d="${curve}" fill="none" stroke="${o.color}" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>`;
  }).join('');
  const dots = pts.filter(Boolean).map(p =>
    `<circle cx="${p.x}" cy="${p.y}" r="${r}" fill="${p.color}" stroke="#FFFFFF" stroke-width="2"/>`
  ).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">${lines}${dots}</svg>`;
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

module.exports = { lineChartSvg, monotoneCurve, CHART_W: W, CHART_H: H };
