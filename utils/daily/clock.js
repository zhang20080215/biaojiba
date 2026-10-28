/**
 * 每日主题公共层 · 时刻工具（每日睡眠用）
 *
 * 入睡时刻存成「中午 12 点起算的分钟数」bedOffset：21:00 → 540、23:00 → 660、00:30 → 750、02:00 → 840。
 * 这样跨午夜的时刻能直接比大小、求平均（23:50 和 00:10 的平均是 00:00，而不是 12:00）。
 *
 * 一晚记在「那一晚」的日期上：中午 12 点前算昨晚，12 点后算今晚 —— nightOf(now) = 北京时间 (now - 12h) 的日期。
 */
const D = require('./date.js');

const NOON = 720;
const DAY_MIN = 1440;

function pad2(n) {
  return String(n).padStart(2, '0');
}

// 'HH:mm' → 当天分钟数；格式不对返回 null
function minutesOf(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || ''));
  if (!m) return null;
  const h = Number(m[1]), mm = Number(m[2]);
  if (h > 23 || mm > 59) return null;
  return h * 60 + mm;
}

function clockOf(minutes) {
  const v = ((Math.round(minutes) % DAY_MIN) + DAY_MIN) % DAY_MIN;
  return `${pad2(Math.floor(v / 60))}:${pad2(v % 60)}`;
}

function clockToOffset(hhmm) {
  const m = minutesOf(hhmm);
  return m == null ? null : (m - NOON + DAY_MIN) % DAY_MIN;
}

function offsetToClock(offset) {
  return clockOf(Number(offset) + NOON);
}

// 入睡 → 起床的分钟数；没有起床时间返回 0
function durationOf(bedTime, wakeTime) {
  const b = minutesOf(bedTime), w = minutesOf(wakeTime);
  if (b == null || w == null) return 0;
  return (w - b + DAY_MIN) % DAY_MIN;
}

// 470 → '7小时50分'
function formatDuration(min) {
  const v = Math.round(Number(min) || 0);
  const h = Math.floor(v / 60), m = v % 60;
  if (!h) return `${m}分`;
  return m ? `${h}小时${m}分` : `${h}小时`;
}

function nightOf(now) {
  return D.todayStr((now == null ? Date.now() : now) - 12 * 3600 * 1000);
}

// 北京时间的 'HH:mm'
function nowClock(now) {
  const d = new Date((now == null ? Date.now() : now) + 8 * 3600 * 1000);
  return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`;
}

// 一晚的记录：value（total_value）= 睡眠时长分钟数，meta 带入睡/起床时刻
function sleepEntry(bedTime, wakeTime) {
  const duration = durationOf(bedTime, wakeTime);
  return {
    value: duration,
    meta: { bedTime, wakeTime: wakeTime || '', bedOffset: clockToOffset(bedTime), duration }
  };
}

module.exports = { minutesOf, clockOf, clockToOffset, offsetToClock, durationOf, formatDuration, nightOf, nowClock, sleepEntry };
