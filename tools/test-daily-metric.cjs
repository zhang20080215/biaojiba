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

test('month cells start on Monday and mark today / future / missing', () => {
  const cells = M.buildMonthCells(2026, 10, { '2026-10-01': 8000, '2026-10-02': 100 }, 8000, '2026-10-02');
  assert.equal(cells.filter(c => c.empty).length, 3);   // 2026-10-01 是周四
  const days = cells.filter(c => !c.empty);
  assert.equal(days.length, 31);
  assert.equal(days[0].level, 4);
  assert.equal(days[1].level, 1);
  assert.ok(days[1].isToday);
  assert.equal(days[2].level, -2);
  const before = M.buildMonthCells(2026, 9, {}, 8000, '2026-10-02').filter(c => !c.empty);
  assert.ok(before.every(c => c.level === -1));
});

test('year rows have one cell per calendar day', () => {
  const rows = M.buildYearRows(2028, {}, 8000, '2028-12-31');
  assert.equal(rows.length, 12);
  assert.equal(rows[1].cells.length, 29);
  assert.equal(rows.reduce((n, r) => n + r.cells.length, 0), 366);
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

// ───────── 每日睡眠：时刻工具 / bedtime 度量 / 首页卡片 ─────────
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
  assert.equal(M.buildMonthCells(2026, 10, map, 660, '2026-10-05', 'bedtime').find(c => c.date === '2026-10-01').achieved, true);
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
  const pd = V.viewOf(sleep).posterDay(sd, 660, sleep, 't');
  assert.equal(pd.statusText, '早睡达标');
  assert.equal(pd.ratio, 1);
  const s = M.summarize({ '2026-10-27': 620 }, '2026-10-01', '2026-10-31', 660, '2026-10-28', 'bedtime');
  const st = V.viewOf(sleep).stats(s, { '2026-10-27': sd }, sleep, 660, '本月');
  assert.equal(st.headline, '22:20');
  assert.equal(st.kpi[3].value, '06:50');
  assert.equal(V.viewOf(sleep).year(s, { '2026-10-27': sd }, sleep).heroNum, '1');
  assert.equal(V.viewOf(steps).posterMonth(M.summarize({ '2026-10-27': 9000 }, '2026-10-01', '2026-10-31', 8000, '2026-10-28'), [], {}, steps, 't').tiles.length, 3);
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

// ───────── 统计页折线图 ─────────
const { lineChartSvg } = require('../utils/daily/chart');

test('line chart breaks at missing days and maps heights like the bars', () => {
  const bars = [
    { h: 50, color: '#111111' }, { h: 100, color: '#222222' }, { h: 0, missing: true },
    { h: 25, color: '#333333' }, { h: 0, missing: true, future: true }
  ];
  const svg = decodeURIComponent(lineChartSvg(bars, { color: '#526631' }));
  assert.equal((svg.match(/fill="none"/g) || []).length, 1);       // 只有前两天连成一段；第 4 天单独一个点，不连线
  assert.equal((svg.match(/<circle/g) || []).length, 3);
  assert.ok(svg.includes('d="M61.6,160 L184.8,0"'), svg);          // 616 宽 5 等分取中点；320 高按百分比；两点一段是直线
  assert.ok(svg.includes('cy="240"'));
  assert.ok(!svg.includes('<text'));
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
