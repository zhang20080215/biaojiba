/**
 * 每日主题公共层 · 平滑曲线（统计页 K 线图的「折线」模式用）
 *
 * 单调三次曲线（Fritsch–Carlson，同 d3 的 curveMonotoneX）：过每个点、整体平滑，
 * 但不会冲过峰值或跌破谷值 —— 普通贝塞尔 / Catmull-Rom 会在 0 步那天下面画出负值的弧。
 */
const f1 = v => +v.toFixed(1);

/**
 * 一段点（x 递增）的单调三次曲线，返回每一小段的贝塞尔控制点：
 * [{ c1x, c1y, c2x, c2y, x, y }]，第 i 项是从点 i 画到点 i+1；只有两个点时控制点落在直线上。
 * canvas 直接 bezierCurveTo，SVG 拼成 C 命令（monotoneCurve）。
 */
function monotoneControls(s) {
  const n = s.length;
  if (n < 2) return [];
  const m = [];                       // 相邻两点的割线斜率
  for (let i = 0; i < n - 1; i++) m.push((s[i + 1].y - s[i].y) / (s[i + 1].x - s[i].x));
  const t = [m[0]];                   // 每个点的切线斜率
  for (let i = 1; i < n - 1; i++) t.push(m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2);
  t.push(m[n - 2]);
  if (n === 2) { t[0] = m[0]; t[1] = m[0]; }
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
    const a = t[i] / m[i], b = t[i + 1] / m[i], h = a * a + b * b;
    if (h > 9) { const k = 3 / Math.sqrt(h); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i]; }
  }
  const out = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = (s[i + 1].x - s[i].x) / 3;
    out.push({ c1x: s[i].x + dx, c1y: s[i].y + t[i] * dx, c2x: s[i + 1].x - dx, c2y: s[i + 1].y - t[i + 1] * dx, x: s[i + 1].x, y: s[i + 1].y });
  }
  return out;
}

// 同一条曲线的 SVG path 片段（M 之后的部分）
function monotoneCurve(s) {
  return monotoneControls(s).map(c => ` C${f1(c.c1x)},${f1(c.c1y)} ${f1(c.c2x)},${f1(c.c2y)} ${c.x},${c.y}`).join('');
}

module.exports = { monotoneControls, monotoneCurve };
