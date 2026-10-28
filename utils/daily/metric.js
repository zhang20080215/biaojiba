/**
 * 每日主题公共层 · 数值型主题（每天一个数 + 每日目标）的纯计算
 *
 * 不碰 wx / 页面，tools/test-daily-metric.cjs 直接 require 测。
 *
 * 「无数据」和「0」是两回事：数据库里没有这一天的文档 = 无数据（比如微信运动只给 30 天，
 * 用户很久没打开就补不回来），它不进日均、达标率的分母，也不打断连续达标；
 * 有文档但值为 0 = 真的是 0，照常计入。
 *
 * 度量（measure）决定「每天取哪个数、怎样算达标、怎样分档」，主题配置里用 measure: 'count' | 'bedtime' 选：
 *   count   —— 数量，越多越好，取 total_value（步数）
 *   bedtime —— 入睡时刻，越早越好，取 meta.bedOffset（中午 12 点起算的分钟数，见 clock.js）
 * 下面所有函数的 measure 参数都可省略，省略即 count。
 */
const D = require('./date.js');

const MEASURES = {
  count: {
    id: 'count',
    valueOf: day => Number(day.total_value) || 0,
    achieved: (v, goal) => goal > 0 && v >= goal,
    better: (a, b) => a > b,
    // 0 为 0 / 1 <25% / 2 <50% / 3 <100% / 4 达标
    level(v, goal) {
      if (v <= 0) return 0;
      const r = goal > 0 ? v / goal : 1;
      if (r >= 1) return 4;
      if (r >= 0.5) return 3;
      if (r >= 0.25) return 2;
      return 1;
    }
  },
  bedtime: {
    id: 'bedtime',
    valueOf(day) {
      const o = day.meta && Number(day.meta.bedOffset);
      return Number.isFinite(o) ? o : null;
    },
    achieved: (v, goal) => v <= goal,
    better: (a, b) => a < b,
    // 4 准时 / 3 晚 30 分钟内 / 2 晚 1 小时内 / 1 更晚（没有 0 档：睡了就有时刻）
    level(v, goal) {
      const late = v - goal;
      if (late <= 0) return 4;
      if (late <= 30) return 3;
      if (late <= 60) return 2;
      return 1;
    }
  }
};

function measureOf(m) {
  if (m && typeof m === 'object') return m;
  return MEASURES[m] || MEASURES.count;
}

// getRange 会给区间内没有文档的日子补一个空壳：新版云函数带 missing:true，旧版只能靠「没有 _id」认
function isMissing(day) {
  return !day || day.missing === true || !day._id;
}

// days（getRange / getYear 的返回）→ { 'YYYY-MM-DD': value }，只收有数据的日子
function toDayMap(days, measure) {
  const ms = measureOf(measure);
  const map = {};
  (days || []).forEach(d => {
    if (isMissing(d)) return;
    const v = ms.valueOf(d);
    if (v != null) map[d.date] = v;
  });
  return map;
}

// 同上，但保留整份文档（详情、睡眠时长等要用）
function toDocMap(days) {
  const map = {};
  (days || []).forEach(d => { if (!isMissing(d)) map[d.date] = d; });
  return map;
}

/**
 * 热力分档：-1 无数据，0~4 见各度量的 level
 * 下标直接对应 palette.heat 的颜色（-1 由样式画虚线框）
 */
function heatLevel(value, goal, hasData, measure) {
  if (!hasData) return -1;
  return measureOf(measure).level(Number(value) || 0, goal);
}

/**
 * 区间汇总（只算到 today 为止，未来的日子不算）
 * @returns {{ total, dataDays, achieved, avg, best:{date,value}|null, longestStreak, spanDays }}
 *   best 按度量取「最好」的一天（count 最大、bedtime 最早）
 */
function summarize(dayMap, from, to, goal, today, measure) {
  const ms = measureOf(measure);
  const end = to < today ? to : today;
  let total = 0, dataDays = 0, achieved = 0, best = null, streak = 0, longestStreak = 0, spanDays = 0;
  for (let d = from; d <= end; d = D.addDays(d, 1)) {
    spanDays++;
    if (!(d in dayMap)) continue;        // 无数据：跳过，不打断连续
    const v = dayMap[d];
    total += v;
    dataDays++;
    if (!best || ms.better(v, best.value)) best = { date: d, value: v };
    if (ms.achieved(v, goal)) {
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
 * @param goal   { target, startDate, endDate }
 * @param walked 区间内（startDate ~ min(endDate, today)）已累计的量：mode=sum 是数值之和，mode=days 是达标天数
 * @param mode   'sum'（累计 100 万步）| 'days'（早睡满 30 天）
 * @returns { target, walked, remaining, pct(0~100), daysLeft(含今天), perDayNeeded, feasible, totalDays, status: active|done|expired }
 *   perDayNeeded 只对 sum 有意义；days 模式看 feasible（剩下的天数还够不够）
 */
function goalProgress(goal, walked, today, mode) {
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
    perDayNeeded: mode !== 'days' && daysLeft > 0 ? Math.ceil(remaining / daysLeft) : 0,
    feasible: remaining <= daysLeft || mode !== 'days',
    totalDays,
    status
  };
}

// 月历格子（周一开头，前面补空位）
function buildMonthCells(year, month, dayMap, goal, today, measure) {
  const ms = measureOf(measure);
  const r = D.monthRange(year, month);
  const lead = D.dayOfWeekMon(D.parseDate(r.from));
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push({ empty: true, key: 'e' + i });
  for (let day = 1; day <= r.lastDay; day++) {
    const date = D.ymd(year, month, day);
    const isFuture = date > today;
    const has = !isFuture && date in dayMap;
    const value = has ? dayMap[date] : 0;
    const level = isFuture ? -2 : heatLevel(value, goal, has, ms);
    cells.push({ empty: false, key: date, day, date, value, has, level, achieved: has && ms.achieved(value, goal), isToday: date === today, isFuture });
  }
  return cells;
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
  MEASURES,
  measureOf,
  isMissing,
  toDayMap,
  toDocMap,
  heatLevel,
  summarize,
  goalProgress,
  buildMonthCells,
  formatNum,
  formatShort,
  equivalentOf
};
