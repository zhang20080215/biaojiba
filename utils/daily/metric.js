/**
 * 每日主题公共层 · 数值型主题（每天一个数 + 每日目标）的纯计算
 *
 * 不碰 wx / 页面，tools/test-daily-metric.cjs 直接 require 测。
 *
 * 「无数据」和「0」是两回事：数据库里没有这一天的文档 = 无数据（比如微信运动只给 30 天，
 * 用户很久没打开就补不回来），它不进日均、达标率的分母，也不打断连续达标；
 * 有文档但值为 0 = 真的是 0，照常计入。
 */
const D = require('./date.js');

// getRange 会给区间内没有文档的日子补一个空壳：新版云函数带 missing:true，旧版只能靠「没有 _id」认
function isMissing(day) {
  return !day || day.missing === true || !day._id;
}

// days（getRange / getYear 的返回）→ { 'YYYY-MM-DD': value }，只收有数据的日子
function toDayMap(days) {
  const map = {};
  (days || []).forEach(d => {
    if (!isMissing(d)) map[d.date] = Number(d.total_value) || 0;
  });
  return map;
}

/**
 * 热力分档：-1 无数据 / 0 为 0 / 1 <25% / 2 <50% / 3 <100% / 4 达标
 * 下标直接对应 palette.heat 的颜色（-1 由样式画虚线框）
 */
function heatLevel(value, goal, hasData) {
  if (!hasData) return -1;
  const v = Number(value) || 0;
  if (v <= 0) return 0;
  const r = goal > 0 ? v / goal : 1;
  if (r >= 1) return 4;
  if (r >= 0.5) return 3;
  if (r >= 0.25) return 2;
  return 1;
}

/**
 * 区间汇总（只算到 today 为止，未来的日子不算）
 * @returns {{ total, dataDays, achieved, avg, best:{date,value}|null, longestStreak, spanDays }}
 */
function summarize(dayMap, from, to, goal, today) {
  const end = to < today ? to : today;
  let total = 0, dataDays = 0, achieved = 0, best = null, streak = 0, longestStreak = 0, spanDays = 0;
  for (let d = from; d <= end; d = D.addDays(d, 1)) {
    spanDays++;
    if (!(d in dayMap)) continue;        // 无数据：跳过，不打断连续
    const v = dayMap[d];
    total += v;
    dataDays++;
    if (!best || v > best.value) best = { date: d, value: v };
    if (goal > 0 && v >= goal) {
      achieved++;
      streak++;
      if (streak > longestStreak) longestStreak = streak;
    } else {
      streak = 0;
    }
  }
  return { total, dataDays, achieved, avg: dataDays ? Math.round(total / dataDays) : 0, best, longestStreak, spanDays };
}

/**
 * 截止日期累计目标的进度
 * @param goal  { target, startDate, endDate }
 * @param walked 区间内（startDate ~ min(endDate, today)）已累计的量
 * @returns { target, walked, remaining, pct(0~100), daysLeft(含今天), perDayNeeded, totalDays, status: active|done|expired }
 */
function goalProgress(goal, walked, today) {
  const target = Number(goal && goal.target) || 0;
  const w = Math.max(0, Number(walked) || 0);
  const remaining = Math.max(0, target - w);
  const totalDays = D.daysBetween(goal.startDate, goal.endDate) + 1;
  const daysLeft = today > goal.endDate ? 0 : D.daysBetween(today < goal.startDate ? goal.startDate : today, goal.endDate) + 1;
  let status = 'active';
  if (target > 0 && w >= target) status = 'done';
  else if (today > goal.endDate) status = 'expired';
  return {
    target,
    walked: w,
    remaining,
    pct: target > 0 ? Math.min(100, Math.floor(w / target * 100)) : 0,
    daysLeft,
    perDayNeeded: daysLeft > 0 ? Math.ceil(remaining / daysLeft) : 0,
    totalDays,
    status
  };
}

// 月历格子（周一开头，前面补空位）
function buildMonthCells(year, month, dayMap, goal, today) {
  const r = D.monthRange(year, month);
  const lead = D.dayOfWeekMon(D.parseDate(r.from));
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push({ empty: true, key: 'e' + i });
  for (let day = 1; day <= r.lastDay; day++) {
    const date = D.ymd(year, month, day);
    const isFuture = date > today;
    const has = !isFuture && date in dayMap;
    const value = has ? dayMap[date] : 0;
    const level = isFuture ? -2 : heatLevel(value, goal, has);
    cells.push({ empty: false, key: date, day, date, value, has, level, achieved: level === 4, isToday: date === today, isFuture });
  }
  return cells;
}

// 年历：12 行，每行是该月每一天（列数 = 当月天数）
function buildYearRows(year, dayMap, goal, today) {
  const rows = [];
  for (let m = 1; m <= 12; m++) {
    const r = D.monthRange(year, m);
    const cells = [];
    for (let day = 1; day <= r.lastDay; day++) {
      const date = D.ymd(year, m, day);
      const isFuture = date > today;
      const has = !isFuture && date in dayMap;
      cells.push({ key: date, date, level: isFuture ? -2 : heatLevel(has ? dayMap[date] : 0, goal, has) });
    }
    rows.push({ month: m, label: m + '月', cells });
  }
  return rows;
}

// 12345 → '12,345'
function formatNum(n) {
  const v = Math.round(Number(n) || 0);
  return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// 大数缩写：12345 → '1.2万'，1000000 → '100万'
function formatShort(n) {
  const v = Number(n) || 0;
  if (v >= 10000) {
    const w = v / 10000;
    return (w >= 100 || Number.isInteger(w) ? Math.round(w) : w.toFixed(1)) + '万';
  }
  return formatNum(v);
}

// 换算（步数 → 公里）：eq = { factor, digits }
function equivalentOf(total, eq) {
  if (!eq) return '';
  return ((Number(total) || 0) * eq.factor).toFixed(eq.digits == null ? 1 : eq.digits);
}

module.exports = {
  isMissing,
  toDayMap,
  heatLevel,
  summarize,
  goalProgress,
  buildMonthCells,
  buildYearRows,
  formatNum,
  formatShort,
  equivalentOf
};
