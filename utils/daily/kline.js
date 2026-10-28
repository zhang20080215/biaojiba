/**
 * 每日主题公共层 · 统计页 K 线（日K / 周K / 月K）的数据计算，纯函数便于测试
 *
 * 每根蜡烛 = 一段时间：
 *   周K / 月K —— 高 / 低 = 这段里最多 / 最少的一天，开 = 第一个有数据的日子，收 = 最后一个；
 *   日K —— 一天只有一个总数，没有「开盘」，所以开 = 上一个有数据的日子的值（第一天开 = 收），
 *          实体就是「比前一天多了还是少了」。
 * 收 ≥ 开 为涨（红），否则跌（绿），和股票软件一个读法。
 * 主值 main：日K 是当天的值，周K / 月K 是这段的平均（区间日均 / 平均入睡），表头和涨跌幅都用它。
 *
 * 入参 map 是「绘图值」：步数就是步数；睡眠传 -bedOffset（越早越大，往上画），由页面负责取反和格式化。
 */
const D = require('./date.js');

function periodOf(date, period) {
  if (period === 'week') {
    const r = D.weekRange(date, 0);
    return { key: r.from, from: r.from, to: r.to };
  }
  if (period === 'month') {
    const r = D.monthRange(Number(date.slice(0, 4)), Number(date.slice(5, 7)));
    return { key: date.slice(0, 7), from: r.from, to: r.to };
  }
  return { key: date, from: date, to: date };
}

/**
 * @param map    { 'YYYY-MM-DD': value }（只含有数据的日子）
 * @param period 'day' | 'week' | 'month'
 * @returns 按时间升序的蜡烛 [{ key, from, to, open, close, high, low, main, count }]，没有数据的周 / 月不出现
 */
function buildCandles(map, period) {
  const dates = Object.keys(map).sort();
  const out = [];
  let cur = null;
  let prevClose = null;
  dates.forEach(d => {
    const v = map[d];
    if (period === 'day') {
      const open = prevClose == null ? v : prevClose;
      out.push({ key: d, from: d, to: d, open, close: v, high: Math.max(open, v), low: Math.min(open, v), main: v, count: 1, sum: v });
      prevClose = v;
      return;
    }
    const p = periodOf(d, period);
    if (!cur || cur.key !== p.key) {
      cur = { key: p.key, from: p.from, to: p.to, open: v, close: v, high: v, low: v, sum: 0, count: 0 };
      out.push(cur);
    }
    cur.close = v;
    cur.high = Math.max(cur.high, v);
    cur.low = Math.min(cur.low, v);
    cur.sum += v;
    cur.count++;
  });
  out.forEach(c => { if (period !== 'day') c.main = c.sum / c.count; });
  return out;
}

// n 根均线（按 main）：前 n-1 根没有值（null），不画
function movingAverage(candles, n) {
  let sum = 0;
  return candles.map((c, i) => {
    sum += c.main;
    if (i >= n) sum -= candles[i - n].main;
    return i >= n - 1 ? sum / n : null;
  });
}

// 和上一根比的涨跌幅（%），第一根没有
function changePct(candles, i) {
  if (i <= 0 || !candles[i - 1]) return null;
  const prev = candles[i - 1].main;
  if (!prev) return null;
  return (candles[i].main - prev) / Math.abs(prev) * 100;
}

module.exports = { periodOf, buildCandles, movingAverage, changePct };
