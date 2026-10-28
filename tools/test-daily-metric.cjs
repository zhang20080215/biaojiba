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
