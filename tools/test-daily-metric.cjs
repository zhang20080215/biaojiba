// 每日主题公共层（utils/daily/*）+ syncDailyLog 数据源解析的单元测试
// 运行：node --test tools/test-daily-metric.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const D = require('../utils/daily/date');
const M = require('../utils/daily/metric');
const P = require('../utils/daily/palette');
const S = require('../cloudfunctions/syncDailyLog/sources');
const root = path.resolve(__dirname, '..');

test('date helpers use Beijing time and Monday-first weeks', () => {
  assert.equal(D.todayStr(Date.parse('2026-10-27T16:30:00Z')), '2026-10-28');
  assert.equal(D.addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(D.daysBetween('2026-10-01', '2026-10-31'), 30);
  assert.deepEqual(D.weekRange('2026-10-28', 0), { from: '2026-10-26', to: '2026-11-01' });
  assert.deepEqual(D.weekRange('2026-11-01', -1), { from: '2026-10-19', to: '2026-10-25' });
  assert.equal(D.monthRange(2028, 2).lastDay, 29);
  assert.deepEqual(D.addMonths(2026, 1, -1), { year: 2025, month: 12 });
  assert.equal(D.formatWeekLabel('2026-10-26', '2026-11-01'), '10月26日 - 11月1日');
  assert.equal(D.weekdayCN('2026-10-28'), '周三');
});

test('missing days are not zero days', () => {
  const map = M.toDayMap([
    { _id: 'a', date: '2026-10-01', total_value: 0 },
    { date: '2026-10-02', total_value: 0, entries: [] },               // 旧版 getRange 补零：没有 _id
    { _id: 'x', date: '2026-10-03', total_value: 0, missing: true },
    { _id: 'b', date: '2026-10-04', total_value: 5200 }
  ]);
  assert.deepEqual(map, { '2026-10-01': 0, '2026-10-04': 5200 });
});

test('heat levels', () => {
  assert.equal(M.heatLevel(0, 8000, false), -1);
  assert.equal(M.heatLevel(0, 8000, true), 0);
  assert.equal(M.heatLevel(1999, 8000, true), 1);
  assert.equal(M.heatLevel(2000, 8000, true), 2);
  assert.equal(M.heatLevel(4000, 8000, true), 3);
  assert.equal(M.heatLevel(8000, 8000, true), 4);
});

test('summary skips missing days without breaking the streak and ignores the future', () => {
  const map = { '2026-10-01': 9000, '2026-10-02': 8000, '2026-10-04': 12000, '2026-10-05': 3000, '2026-10-06': 8100, '2026-10-30': 99999 };
  const s = M.summarize(map, '2026-10-01', '2026-10-31', 8000, '2026-10-06');
  assert.equal(s.total, 40100);
  assert.equal(s.dataDays, 5);
  assert.equal(s.avg, 8020);
  assert.equal(s.achieved, 4);
  assert.equal(s.longestStreak, 3);          // 1、2、(3 无数据)、4 连着
  assert.deepEqual(s.best, { date: '2026-10-04', value: 12000 });
  assert.equal(s.spanDays, 6);
  assert.equal(M.summarize({}, '2026-10-01', '2026-10-07', 8000, '2026-10-07').avg, 0);
});

test('deadline goal progress', () => {
  const goal = { target: 1000000, startDate: '2026-10-01', endDate: '2026-12-31' };
  const p = M.goalProgress(goal, 250000, '2026-10-28');
  assert.equal(p.status, 'active');
  assert.equal(p.pct, 25);
  assert.equal(p.daysLeft, 65);              // 10-28 ~ 12-31，含今天
  assert.equal(p.perDayNeeded, Math.ceil(750000 / 65));
  assert.equal(p.totalDays, 92);
  assert.equal(M.goalProgress(goal, 1000001, '2026-11-01').status, 'done');
  assert.equal(M.goalProgress(goal, 1000001, '2026-11-01').pct, 100);
  const late = M.goalProgress(goal, 10, '2027-01-01');
  assert.equal(late.status, 'expired');
  assert.equal(late.daysLeft, 0);
  assert.equal(late.perDayNeeded, 0);
  assert.equal(M.goalProgress(goal, 0, '2026-12-31').daysLeft, 1);
});

test('number formatting', () => {
  assert.equal(M.formatNum(1234567), '1,234,567');
  assert.equal(M.formatShort(9999), '9,999');
  assert.equal(M.formatShort(12345), '1.2万');
  assert.equal(M.formatShort(1000000), '100万');
  assert.equal(M.equivalentOf(10000, { factor: 0.0007, digits: 1 }), '7.0');
});

test('palette mirrors styles/theme.wxss', () => {
  const css = fs.readFileSync(path.join(root, 'styles/theme.wxss'), 'utf8');
  const blockOf = sel => {
    const i = css.indexOf(sel);
    assert.ok(i >= 0, sel);
    return css.slice(i, css.indexOf('}', i));
  };
  const varOf = (block, name) => {
    const m = block.match(new RegExp('--' + name + ':\\s*(#[0-9A-Fa-f]{6})'));
    return m && m[1].toUpperCase();
  };
  const fields = { primary: 'brand-primary', soft: 'brand-soft', accent: 'brand-accent', tint: 'brand-tint', button: 'brand-button', hero: 'brand-hero', heroInk: 'hero-ink', heroSoft: 'hero-soft' };
  const blocks = { pink: blockOf('page {'), gold: blockOf('page.theme-gold'), green: blockOf('page.theme-green'), sand: blockOf('page.theme-sand') };
  for (const id of Object.keys(blocks)) {
    for (const [k, v] of Object.entries(fields)) {
      assert.equal(P.THEMES[id][k].toUpperCase(), varOf(blocks[id], v), `${id}.${k}`);
    }
  }
  const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  for (const t of Object.values(P.THEMES)) assert.ok(app.includes(`'${t.cls}'`), t.cls);
});

test('palette resolves classes and builds a five-step heat ramp', () => {
  assert.equal(P.idFromClass(''), 'pink');
  assert.equal(P.idFromClass('theme-sand'), 'sand');
  assert.equal(P.idFromClass('bogus'), 'green');
  const g = P.get('gold');
  assert.equal(g.heat.length, 5);
  assert.equal(g.heat[4], g.accent);
  assert.equal(P.get('nope').id, 'green');
  assert.equal(P.mix('#000000', '#FFFFFF', 0.5), '#808080');
});

test('werun parser drops leading zeros and maps timestamps to Beijing dates', () => {
  const day = d => Date.parse(d + 'T00:00:00+08:00') / 1000;
  const rows = S.parseWeRun({ data: { stepInfoList: [
    { timestamp: day('2026-10-25'), step: 0 },
    { timestamp: day('2026-10-26'), step: 0 },
    { timestamp: day('2026-10-27'), step: 6000 },
    { timestamp: day('2026-10-28'), step: 0 }
  ] } });
  assert.deepEqual(rows, [{ date: '2026-10-27', value: 6000 }, { date: '2026-10-28', value: 0 }]);
  assert.deepEqual(S.parseWeRun({ data: { stepInfoList: [{ timestamp: day('2026-10-28'), step: 0 }] } }), []);
  assert.equal(S.parseWeRun({}), null);
});

test('sync only writes new or changed days', () => {
  const plan = S.planWrites(
    [{ date: '2026-10-27', value: 6000 }, { date: '2026-10-28', value: 300 }, { date: '2026-10-26', value: 10 }],
    [{ _id: 'a', date: '2026-10-27', total_value: 6000 }, { _id: 'b', date: '2026-10-28', total_value: 100 }]
  );
  assert.deepEqual(plan.adds, [{ date: '2026-10-26', value: 10 }]);
  assert.deepEqual(plan.updates, [{ _id: 'b', date: '2026-10-28', value: 300 }]);
});

// ───────── 每日早睡：时刻工具 / bedtime 度量 / 首页卡片 ─────────
const T = require('../utils/daily/clock');
const V = require('../utils/daily/views');
const { THEMES } = require('../utils/dailyThemes');

test('clock offsets keep times across midnight comparable', () => {
  assert.equal(T.clockToOffset('23:00'), 660);
  assert.equal(T.clockToOffset('00:30'), 750);
  assert.equal(T.clockToOffset('21:00'), 540);
  assert.equal(T.clockToOffset('25:00'), null);
  assert.equal(T.offsetToClock(750), '00:30');
  assert.equal(T.offsetToClock(Math.round((T.clockToOffset('23:50') + T.clockToOffset('00:10')) / 2)), '00:00');
  assert.equal(T.durationOf('23:30', '07:10'), 460);
  assert.equal(T.durationOf('23:30', ''), 0);
  assert.equal(T.formatDuration(460), '7小时40分');
  assert.equal(T.formatDuration(480), '8小时');
  assert.equal(T.formatDuration(45), '45分');
  // 中午 12 点前算昨晚
  assert.equal(T.nightOf(Date.parse('2026-10-28T01:30:00+08:00')), '2026-10-27');
  assert.equal(T.nightOf(Date.parse('2026-10-28T11:59:00+08:00')), '2026-10-27');
  assert.equal(T.nightOf(Date.parse('2026-10-28T12:00:00+08:00')), '2026-10-28');
  assert.equal(T.nowClock(Date.parse('2026-10-28T06:05:00+08:00')), '06:05');
  assert.deepEqual(T.sleepEntry('23:10', '07:00'), { value: 470, meta: { bedTime: '23:10', wakeTime: '07:00', bedOffset: 670, duration: 470 } });
});

test('bedtime measure: earlier is better, missing bedOffset is no data', () => {
  const doc = (date, bed) => ({ _id: date, date, total_value: 0, meta: bed ? { bedOffset: T.clockToOffset(bed) } : {} });
  const map = M.toDayMap([doc('2026-10-01', '22:50'), doc('2026-10-02', '23:20'), doc('2026-10-03', null), doc('2026-10-04', '00:30'), doc('2026-10-05', '22:00')], 'bedtime');
  assert.deepEqual(Object.keys(map), ['2026-10-01', '2026-10-02', '2026-10-04', '2026-10-05']);
  const s = M.summarize(map, '2026-10-01', '2026-10-31', 660, '2026-10-05', 'bedtime');
  assert.equal(s.achieved, 2);
  assert.equal(s.best.date, '2026-10-05');
  assert.equal(s.longestStreak, 1);
  assert.equal(M.heatLevel(660, 660, true, 'bedtime'), 4);
  assert.equal(M.heatLevel(690, 660, true, 'bedtime'), 3);
  assert.equal(M.heatLevel(720, 660, true, 'bedtime'), 2);
  assert.equal(M.heatLevel(721, 660, true, 'bedtime'), 1);
});

test('deadline goal counted in days', () => {
  const goal = { target: 30, startDate: '2026-10-01', endDate: '2026-10-31' };
  const p = M.goalProgress(goal, 10, '2026-10-28', 'days');
  assert.equal(p.remaining, 20);
  assert.equal(p.daysLeft, 4);
  assert.equal(p.feasible, false);
  assert.equal(p.perDayNeeded, 0);
  assert.equal(M.goalProgress(goal, 28, '2026-10-28', 'days').feasible, true);
});

test('sleep home card adapts to the time of day', () => {
  const at = s => Date.parse(s + '+08:00');
  const evening = V.sleepCard(null, 660, at('2026-10-28T21:40:00'));
  assert.equal(evening.nightLabel, '今晚');
  assert.equal(evening.showSleep, true);
  assert.equal(evening.countdownText, '距离目标入睡还有 1小时20分');
  const late = V.sleepCard(null, 660, at('2026-10-29T00:20:00'));
  assert.equal(late.night, '2026-10-28');
  assert.ok(late.countdownText.includes('已经超过目标 1小时20分'));
  const noon = V.sleepCard(null, 660, at('2026-10-28T09:00:00'));
  assert.equal(noon.nightLabel, '昨晚');
  assert.equal(noon.showSleep, false);
  assert.equal(noon.countdownText, '昨晚还没有记录');
  const slept = { date: '2026-10-27', meta: T.sleepEntry('23:25', '').meta };
  const morning = V.sleepCard(slept, 660, at('2026-10-28T07:10:00'));
  assert.equal(morning.statusText, '比目标晚 25分');
  assert.equal(morning.showWake, true);
  assert.equal(V.sleepCard(slept, 660, at('2026-10-27T23:30:00')).showWake, false);
});

test('views render both measures', () => {
  const steps = THEMES.steps, sleep = THEMES.sleep;
  assert.equal(V.viewOf(steps).dayText({ total_value: 8234 }, steps), '8,234 步');
  const sd = { date: '2026-10-27', ...T.sleepEntry('22:40', '06:50') };
  sd.total_value = sd.value;
  assert.equal(V.viewOf(sleep).dayText(sd, sleep), '22:40 入睡 · 06:50 起床 · 睡了 8小时10分');
  const s = M.summarize({ '2026-10-27': 620 }, '2026-10-01', '2026-10-31', 660, '2026-10-28', 'bedtime');
  const st = V.viewOf(sleep).stats(s, { '2026-10-27': sd }, sleep, 660, '本月');
  assert.equal(st.headline, '22:20');
  assert.equal(st.kpi[3].value, '06:50');
});

// ───────── 首页视图模型 / 主角插画 ─────────
const H = require('../utils/daily/home');
const Ms = require('../utils/daily/mascots');

test('home: streak skips missing days and today-in-progress', () => {
  const map = { '2026-10-20': 9000, '2026-10-21': 9000, '2026-10-23': 8500, '2026-10-24': 9100, '2026-10-25': 3000 };
  assert.equal(H.streakAt(map, '2026-10-24', 8000, '2026-10-25', '2026-10-01'), 4);
  assert.equal(H.streakAt(map, '2026-10-25', 8000, '2026-10-25', '2026-10-01'), 4);   // 今天还没达标：从昨天数
  assert.equal(H.streakAt(map, '2026-10-25', 8000, '2026-10-26', '2026-10-01'), 0);
  assert.equal(H.streakAt(map, '2026-10-24', 8000, '2026-10-25', '2026-10-23'), 2);   // 最早数到已加载窗口
  assert.equal(H.dateTitle('2026-10-25', '2026-10-25', 'count'), '今天');
  assert.equal(H.dateTitle('2026-10-24', '2026-10-25', 'bedtime'), '昨晚');
  assert.equal(H.dateTitle('2026-10-20', '2026-10-25', 'bedtime'), '10月20日晚');
});

test('home: steps and sleep view models', () => {
  const docs = { '2026-10-27': { _id: 'a', date: '2026-10-27', total_value: 6420 } };
  const s = H.stepsHome(docs, '2026-10-27', '2026-10-27', 8000, THEMES.steps, '2026-09-01');
  assert.equal(s.bigText, '6,420');
  assert.equal(s.subText, '目标 8,000 · 还差 1,580');
  assert.equal(s.cards[0].value, '4.5');
  assert.equal(H.stepsHome({}, '2026-10-26', '2026-10-27', 8000, THEMES.steps, '2026-09-01').subText, '这一天没有数据');
  const at = t => Date.parse('2026-10-27T' + t + ':00+08:00');
  const empty = H.sleepHome({}, '2026-10-27', '2026-10-27', 660, at('21:00'));
  assert.equal(empty.mood, 'pending');
  assert.deepEqual(empty.cards.map(c => c.disabled), [false, true, false]);
  const past = H.sleepHome({}, '2026-10-20', '2026-10-27', 660, at('21:00'));
  assert.equal(past.subText, '这一晚没有记录');
  assert.deepEqual(past.cards.map(c => c.disabled), [true, true, false]);
  const late = { '2026-10-27': { _id: 'b', date: '2026-10-27', meta: T.sleepEntry('23:40', '').meta } };
  const lh = H.sleepHome(late, '2026-10-27', '2026-10-27', 660, at('23:50'));
  assert.equal(lh.mood, 'late');
  assert.equal(lh.subText, '目标 23:00 前 · 晚了 40分');
  assert.equal(lh.cards[2].value, '修改');
});

test('home: goal line and mascots follow the theme colour', () => {
  assert.equal(H.goalLine(null, 0, '2026-10-27', THEMES.steps.deadlineGoal).status, 'none');
  const g = { target: 1000000, startDate: '2026-10-01', endDate: '2026-12-31' };
  assert.equal(H.goalLine(g, 250000, '2026-10-27', THEMES.steps.deadlineGoal).text, '12月31日前走满 100万步 · 已完成 25%');
  assert.equal(H.goalLine(g, 1000000, '2026-10-27', THEMES.steps.deadlineGoal).status, 'done');
  const pink = P.get('pink');
  const shoe = decodeURIComponent(Ms.shoeSvg(0.5, pink));
  assert.ok(shoe.includes(P.mix(pink.tint, pink.accent, 0.32)));
  assert.ok(!decodeURIComponent(Ms.shoeSvg(0, pink)).includes('<rect x="0"'));
  assert.ok(!decodeURIComponent(Ms.moonSvg('ok', pink)).includes('<text'));   // 小程序 <image> 里 SVG 文字不可靠
});

// ───────── 统计页 K 线 / 平滑曲线 ─────────
const K = require('../utils/daily/kline');

test('day candles: high = low = the day itself, open = previous recorded day', () => {
  const c = K.buildCandles({ '2026-10-01': 8000, '2026-10-02': 6000, '2026-10-05': 9000 }, 'day');
  assert.deepEqual(c.map(x => [x.open, x.close, x.high, x.low, x.main]), [
    [8000, 8000, 8000, 8000, 8000],
    [8000, 6000, 6000, 6000, 6000],
    [6000, 9000, 9000, 9000, 9000]        // 10-03、10-04 没数据：开盘接 10-02 的收盘
  ]);
});

test('week and month candles: open = first day, close = last day, high/low = extremes, main = average', () => {
  const map = { '2026-10-26': 9000, '2026-10-27': 15000, '2026-10-29': 3000, '2026-10-30': 7000, '2026-11-02': 8000 };
  const w = K.buildCandles(map, 'week');
  assert.equal(w.length, 2);
  assert.deepEqual([w[0].key, w[0].from, w[0].to], ['2026-10-26', '2026-10-26', '2026-11-01']);
  assert.deepEqual([w[0].open, w[0].close, w[0].high, w[0].low, w[0].main, w[0].count], [9000, 7000, 15000, 3000, 8500, 4]);
  const m = K.buildCandles(map, 'month');
  assert.deepEqual(m.map(x => x.key), ['2026-10', '2026-11']);
  assert.deepEqual([m[1].from, m[1].to, m[1].open, m[1].close], ['2026-11-01', '2026-11-30', 8000, 8000]);
  assert.equal(Math.round(K.changePct(m, 1)), -6);                   // 8000 vs 8500
  const y = K.buildCandles(map, 'year');
  assert.deepEqual(y.map(x => [x.key, x.from, x.to, x.count, x.high, x.low, x.sum]), [['2026', '2026-01-01', '2026-12-31', 5, 15000, 3000, 42000]]);
  assert.equal(K.changePct(m, 0), null);
  assert.deepEqual(K.movingAverage([{ main: 1 }, { main: 2 }, { main: 3 }, { main: 6 }], 3), [null, null, 2, 11 / 3]);
});

test('smooth line passes through every point and never overshoots', () => {
  const { monotoneCurve } = require('../utils/daily/chart');
  const pts = [{ x: 0, y: 100 }, { x: 10, y: 20 }, { x: 20, y: 100 }, { x: 30, y: 100 }, { x: 40, y: 0 }];
  const d = monotoneCurve(pts);
  assert.equal((d.match(/C/g) || []).length, 4);
  pts.slice(1).forEach(p => assert.ok(d.includes(` ${p.x},${p.y}`), d));      // 每段终点就是数据点
  // 控制点的 y 不越过相邻两点的范围 → 曲线不会冲过峰值、也不会在平坦段鼓包
  const ctrl = [...d.matchAll(/C([\d.-]+),([\d.-]+) ([\d.-]+),([\d.-]+)/g)];
  assert.equal(ctrl.length, 4);
  ctrl.forEach((c, i) => {
    const lo = Math.min(pts[i].y, pts[i + 1].y), hi = Math.max(pts[i].y, pts[i + 1].y);
    [Number(c[2]), Number(c[4])].forEach(y => assert.ok(y >= lo - 1e-6 && y <= hi + 1e-6, `seg ${i}: ${y} not in [${lo},${hi}]`));
  });
  assert.ok(d.includes('C23.3,100 26.7,100 30,100'), d);                       // 两天相同 → 平直，不鼓包
});

test('burnup: cumulative line, ideal pace, projection and header text', () => {
  const B = require('../utils/daily/burnup');
  const { THEMES } = require('../utils/dailyThemes');
  const goal = { target: 1000000, startDate: '2026-10-01', endDate: '2026-12-31' };   // 92 天
  const map = {};
  for (let d = '2026-10-01'; d <= '2026-10-29'; d = D.addDays(d, 1)) map[d] = 9000;
  delete map['2026-10-10'];                                    // 无数据：不加，但曲线不断
  const b = B.buildBurnup(goal, map, 8000, '2026-10-29', 'sum', 'count');
  assert.equal(b.span, 92);
  assert.equal(b.elapsed, 29);
  assert.equal(b.points.length, 30);
  assert.deepEqual(b.points[0], { k: 0, date: '', add: null, cum: 0 });
  assert.equal(b.points[10].add, null);
  assert.equal(b.points[10].cum, b.points[9].cum);
  assert.equal(b.walked, 28 * 9000);
  assert.equal(Math.round(b.ideal), Math.round(1000000 * 29 / 92));
  assert.ok(b.diff < 0);
  assert.equal(b.finishDate, '');                              // 这个速度到不了
  assert.equal(b.projected, Math.round(252000 + 252000 / 29 * 63));
  assert.equal(b.projEndK, 92);
  const v = B.goalView(b, THEMES.steps, -1);
  assert.equal(v.cap, '12月31日前走满 100万步 · 已走');
  assert.equal(v.big, '252,000');
  assert.equal(v.tone, 'down');
  assert.ok(v.change.startsWith('落后理想进度 '), v.change);
  assert.deepEqual(v.ohlc.map(o => o.k), ['预计截止时', '每天还需']);
  assert.equal(v.kpi.length, 4);
  // 选中某一天：累计 + 当天 + 理想
  const s = B.goalView(b, THEMES.steps, 10);
  assert.equal(s.cap, '10月10日 · 累计');
  assert.equal(s.ohlc[0].v, '无数据');

  // 走得快：预测线停在到达那天
  const fast = {};
  for (let d = '2026-10-01'; d <= '2026-10-29'; d = D.addDays(d, 1)) fast[d] = 20000;
  const f = B.buildBurnup(goal, fast, 8000, '2026-10-29', 'sum', 'count');
  assert.equal(f.projEndK, 29 + Math.ceil((1000000 - 580000) / 20000));
  assert.equal(f.finishDate, D.addDays('2026-10-01', f.projEndK - 1));
  assert.equal(B.goalView(f, THEMES.steps).tone, 'up');
  assert.equal(B.goalView(f, THEMES.steps).ohlc[0].v, D.formatDateCN(f.finishDate) + '达成');

  // 睡眠：累计的是早睡天数
  const sleep = { '2026-10-01': 640, '2026-10-02': 700, '2026-10-03': 650 };
  const z = B.buildBurnup({ target: 30, startDate: '2026-10-01', endDate: '2026-10-30' }, sleep, 660, '2026-10-03', 'days', 'bedtime');
  assert.equal(z.walked, 2);
  assert.deepEqual(z.points.map(p => p.add), [null, 1, 0, 1]);
  const zv = B.goalView(z, THEMES.sleep);
  assert.equal(zv.cap, '10月30日前早睡满 30天 · 已早睡');
  assert.equal(zv.kpi[2].label, '达标率');

  assert.equal(B.buildBurnup(null, map, 8000, '2026-10-29', 'sum'), null);
});

test('werun auto sync: once a day, only for users who already authorised, never pops a dialog', async () => {
  const S = require('../utils/daily/werunAutoSync');
  const store = {}, calls = [];
  let auth = { 'scope.werun': true }, needPrivacy = false, cloudOk = true;
  global.wx = {
    getStorageSync: k => store[k], setStorageSync: (k, v) => { store[k] = v; },
    getSetting: o => o.success({ authSetting: auth }),
    getPrivacySetting: o => o.success({ needAuthorization: needPrivacy }),
    getWeRunData: o => { calls.push('getWeRunData'); o.success({ cloudID: 'cid' }); },
    cloud: {
      CloudID: id => ({ cloudID: id }),
      callFunction: async ({ name, data }) => { calls.push(name + ':' + data.action + ':' + data.theme); return { result: { success: cloudOk } }; }
    }
  };
  const now = Date.parse('2026-10-29T02:00:00Z');
  auth = {};
  assert.equal(await S.maybeSync(now), 'no-auth');                      // 没用过步数：不调 getWeRunData，不弹授权
  auth = { 'scope.werun': false };
  assert.equal(await S.maybeSync(now), 'no-auth');                      // 拒绝过：同样不打扰
  auth = { 'scope.werun': true }; needPrivacy = true;
  assert.equal(await S.maybeSync(now), 'privacy');                      // 隐私协议待同意：不在首页弹隐私窗
  assert.deepEqual(calls, []);
  needPrivacy = false; cloudOk = false;
  assert.equal(await S.maybeSync(now), 'fail');                         // 失败不记日期，下次再试
  assert.equal(store[S.KEY], undefined);
  cloudOk = true;
  assert.equal(await S.maybeSync(now), 'synced');
  assert.equal(store[S.KEY], '2026-10-29');
  assert.deepEqual(calls.slice(-2), ['getWeRunData', 'syncDailyLog:syncSource:steps']);
  assert.equal(await S.maybeSync(now + 3600e3), 'skip');               // 同一天不再同步
  assert.equal(await S.maybeSync(now + 24 * 3600e3), 'synced');       // 第二天再来一次
  S.markSynced(now + 48 * 3600e3);                                     // 步数页自己同步过，也算
  assert.equal(await S.maybeSync(now + 48 * 3600e3), 'skip');
  delete global.wx;
});

test('report poster redraws the stats page snapshot 1:1 (kline and goal) and only adds the watermark', () => {
  const R = require('../utils/metricReportPoster');
  const K = require('../utils/daily/kline');
  const B = require('../utils/daily/burnup');
  const texts = [];
  const ctx = new Proxy({}, {
    get: (t, k) => (k in t ? t[k] : k === 'measureText' ? s => ({ width: String(s).length * 10 })
      : k === 'createLinearGradient' ? () => ({ addColorStop() {} })
      : k === 'fillText' ? s => texts.push(String(s)) : () => {}),
    set: (t, k, v) => { t[k] = v; return true; }
  });
  const map = {};
  for (let d = '2026-09-01'; d <= '2026-10-29'; d = D.addDays(d, 1)) map[d] = 7000 + (d.charCodeAt(9) % 4) * 1000;
  const base = {
    title: '每日步数统计', colorClass: 'theme-green', ranges: [{ key: 30, label: '30天' }], dayRange: 30,
    periods: [{ key: 'day', label: '日' }, { key: 'week', label: '周' }], period: 'week',
    modes: [{ key: 'bar', label: '柱形' }, { key: 'candle', label: 'K线' }], mode: 'candle', showMA: true,
    aggs: [{ key: 'avg', label: '日均' }, { key: 'sum', label: '总数' }], agg: 'avg', showAgg: false, aggLabel: '每周看',
    header: { cap: '10月13日 - 10月19日 · 日均', big: '9,204', bigUnit: '步', change: '较上一周 ▼ 3.1%', changeColor: '#3A9F6E', ohlc: [{ k: '开', v: '8,812' }] },
    sumTitle: '10月13日 - 10月19日 汇总', kpi: [{ label: '达标天数', value: 4, unit: '/ 7 天', sub: '' }]
  };
  R.draw(ctx, Object.assign({}, base, {
    chart: { kind: 'kline', opts: { candles: K.buildCandles(map, 'week'), period: 'week', mode: 'candle', value: 'main', goal: 8000, showGoal: true, goalText: '目标 8,000', format: 'count', showMA: true }, V: 20, offset: 0, sel: 3 }
  }));
  ['每日步数统计', '9,204', '较上一周 ▼ 3.1%', '开', 'K线', '均线', '目标 8,000', '达标天数', '搜索“标记吧”小程序，免费制作同款图'].forEach(t => assert.ok(texts.includes(t), t));
  assert.ok(!texts.includes('30天'), 'the day-range buttons only show on the day tab, as on the page');
  assert.ok(!texts.includes('生成海报'));
  assert.ok(texts.some(t => t.startsWith('MA5 ')));
  texts.length = 0;
  const b = B.buildBurnup({ target: 1000000, startDate: '2026-10-01', endDate: '2026-12-31' }, map, 8000, '2026-10-29', 'sum');
  R.draw(ctx, Object.assign({}, base, { period: 'goal', chart: { kind: 'goal', opts: { burnup: b, targetText: '目标 100万步' }, k0: null, kw: null, sel: -1, w: 320, h: 220 } }));
  ['实际累计', '理想进度', '预测', '目标 100万步', '今天'].forEach(t => assert.ok(texts.includes(t), t));
  assert.ok(!texts.includes('均线'), 'goal tab hides the chart settings');
  assert.equal(R.WIDTH, 1080);
  // 高随内容：两行汇总格子比一行高
  assert.ok(R.heightOf(Object.assign({}, base, { kpi: base.kpi.concat(base.kpi, base.kpi) })) > R.heightOf(base));
});
