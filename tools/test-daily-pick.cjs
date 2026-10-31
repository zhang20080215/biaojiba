// node --test tools/test-daily-pick.cjs
// 每日选片的纯逻辑（utils/dailyPick.js）
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const pick = require(path.join(__dirname, '..', 'utils', 'dailyPick.js'));

const seeded = seed => { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

test('片池：未看去掉看过的（想看的仍算未看），全部不过滤；没片名的不进池', () => {
  const movies = [{ _id: 'a', title: 'A' }, { _id: 'b', title: 'B' }, { _id: 'c', title: 'C' }, { _id: 'd' }];
  const st = { a: 'watched', b: 'wish' };
  assert.deepStrictEqual(pick.poolOf(movies, st, 'unwatched').map(m => m._id), ['b', 'c']);
  assert.deepStrictEqual(pick.poolOf(movies, st, 'all').map(m => m._id), ['a', 'b', 'c']);
  assert.deepStrictEqual(pick.poolOf(null, null, 'all'), []);
});

test('转盘字排法：片越多字越小；字不进中心钮，也不排到比字还窄的格子里', () => {
  const R = 536;
  const few = pick.wheelLabelLayout(8, R, 48);
  const many = pick.wheelLabelLayout(250, R, 48);
  assert.strictEqual(few.font, 48, '片少时到上限');
  assert.ok(many.font < few.font && many.font > 0);
  for (const L of [few, many, pick.wheelLabelLayout(500, R, 48), pick.wheelLabelLayout(1, R, 48)]) {
    assert.ok(L.rMin >= R * 0.29, '不压中心钮');
    assert.ok(L.rMin < L.rOuter);
    assert.ok(L.maxChars >= 1);
  }
  const k = 2 * Math.PI / 250;
  assert.ok(k * many.rMin >= many.font * 0.95, '最里面那个字处的格宽仍放得下字');
});

test('转盘绘制：一部一格，每部都写上字', () => {
  const calls = { arc: 0, text: 0 };
  const ctx = new Proxy({}, { get: (_, p) => p === 'fillText' ? () => calls.text++ : p === 'arc' ? () => calls.arc++ : () => {}, set: () => true });
  const titles = Array.from({ length: 251 }, (_, i) => '片' + i);
  pick.drawWheel(ctx, 1072, titles, { accent: '#000000', tint: '#FFFFFF', mid: '#888888' });
  assert.strictEqual(calls.arc, 1 + 126, '整盘 1 次 + 浅色格（含奇数时末格）');
  assert.ok(calls.text >= 251, '每格至少一个字');
});

test('转盘：停下时指针正好指着选中的那一格，且一直往前转', () => {
  const rnd = seeded(7);
  for (const n of [8, 5, 3, 2, 250, 500]) {
    let rot = 0;
    for (let k = 0; k < 200; k++) {
      const idx = Math.floor(rnd() * n);
      const next = pick.spinTo(rot, idx, n, rnd);
      assert.ok(next - rot >= pick.TURNS * 360, '至少转满 TURNS 圈');
      assert.ok(next - rot < (pick.TURNS + 1) * 360, '不多转一圈以上');
      assert.strictEqual(pick.indexAt(next, n), idx, `n=${n} 第 ${k} 次应停在 ${idx}`);
      rot = next;
    }
  }
});

test('短名：按字符截断，带省略号；emoji 不切坏', () => {
  assert.strictEqual(pick.shortTitle('肖申克的救赎'), '肖申克的救赎');
  assert.strictEqual(pick.shortTitle('这个杀手不太冷静'), '这个杀手不…');
  assert.strictEqual(pick.shortTitle('🎬🎬🎬🎬🎬🎬🎬'), '🎬🎬🎬🎬🎬…');
});

test('今日选片：只认今天的；转盘背景按格数交替两色', () => {
  const today = pick.cnToday(Date.parse('2026-10-31T16:30:00Z'));   // 北京时间 11-01 00:30
  assert.strictEqual(today, '2026-11-01');
  const rec = { date: '2026-11-01', movie: { title: 'A' } };
  assert.strictEqual(pick.todayPick(rec, today), rec);
  assert.strictEqual(pick.todayPick({ date: '2026-10-31', movie: {} }, today), null);
  assert.strictEqual(pick.todayPick(null, today), null);
  const bg = pick.wheelBackground(4, 'A', 'B');
  assert.strictEqual(bg, 'conic-gradient(A 0.00deg 90.00deg, B 90.00deg 180.00deg, A 180.00deg 270.00deg, B 270.00deg 360.00deg)');
});

test('快照：IMDb 榜的分标 IMDb，其余标豆瓣；封面有兜底', () => {
  const s = pick.snapshot({ _id: 1, title: 'X', year: 1994, originalCover: 'u', rating: '9.1' }, { theme: 'imdb', title: 'IMDb TOP250' });
  assert.deepStrictEqual(s, { _id: '1', title: 'X', year: 1994, director: '', country: '', cover: 'u', rating: 9.1, theme: 'imdb', listId: '', sourceTitle: 'IMDb TOP250', ratingLabel: 'IMDb' });
  assert.strictEqual(pick.snapshot({ _id: 2, title: 'Y' }, { theme: 'douban' }).ratingLabel, '豆瓣');
});

test('快照：导演留前两个、国家留第一个，串和数组都认', () => {
  const a = pick.snapshot({ _id: 1, title: 'X', director: '弗兰克·德拉邦特', country: '美国 / 英国' }, { theme: 'douban' });
  assert.strictEqual(a.director, '弗兰克·德拉邦特');
  assert.strictEqual(a.country, '美国');
  const b = pick.snapshot({ _id: 1, title: 'X', directors: [{ name: '甲' }, { name: '乙' }, { name: '丙' }], countries: ['法国'] }, { theme: 'x' });
  assert.strictEqual(b.director, '甲 / 乙');
  assert.strictEqual(b.country, '法国');
});

test('日期文案：北京日期 → 几月几日 · 周几', () => {
  assert.strictEqual(pick.dateLabel('2026-10-31'), '10月31日 · 周六');
  assert.strictEqual(pick.dateLabel('2026-11-02'), '11月2日 · 周一');
  assert.strictEqual(pick.dateLabel(''), '');
});
