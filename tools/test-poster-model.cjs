// node --test tools/test-poster-model.cjs
// 海报数据模型（utils/poster/model.js）：统计口径只有这一份，设计文档第 4 节。
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const M = require(path.join(__dirname, '..', 'utils', 'poster', 'model.js'));
const { dedupeMovies } = require(path.join(__dirname, '..', 'pages', 'daily', 'movie', 'common.js'));

// normalizeMovieEntry 输出的最小形状
const e = (date, ts, title, rating, extra) => Object.assign({
  date, ts, title, doubanId: 'd_' + title, year: 2001, director: '导演', genres: ['剧情', '动画', '奇幻', '冒险'],
  poster: 'cloud://x/' + title + '.jpg', rating, platformRatings: [{ label: '豆瓣', value: '9.4' }, { label: 'IMDb', value: '' }], note: ''
}, extra || {});

test('dateParts：星期与点分日期', () => {
  assert.deepStrictEqual(M.dateParts('2026-10-18'), { weekdayCn: '周日', weekdayEn: 'SUN', dot: '2026.10.18', md: '10.18' });
  assert.deepStrictEqual(M.dateParts('bad'), { weekdayCn: '', weekdayEn: '', dot: '', md: '' });
});

test('toFilm：类型最多 3 个、空的平台评分丢掉、星级夹在 0~5、没有任何时刻字段', () => {
  const f = M.toFilm(e('2026-10-18', 5, '千与千寻', 9), false);
  assert.deepStrictEqual(f.genres, ['剧情', '动画', '奇幻']);
  assert.deepStrictEqual(f.platform, [{ label: '豆瓣', value: '9.4' }]);
  assert.strictEqual(f.rating, 5);
  assert.strictEqual(f.key, '2026-10-18-5');
  assert.ok(!('time' in f) && !('timeText' in f), 'ts 是记录时间，不能当看片时刻输出');
  assert.deepStrictEqual(M.toFilm(e('2026-10-18', 5, 'x', 3), true).platform, []);
});

test('ordinalOf：按 (date, ts) 排序后的序号，找不到返回 null', () => {
  const all = [e('2026-10-02', 9, 'b', 0), e('2026-09-30', 1, 'a', 0), e('2026-10-02', 3, 'c', 0)];
  assert.strictEqual(M.ordinalOf(all, all[0]), 3);
  assert.strictEqual(M.ordinalOf(all, all[2]), 2);
  assert.strictEqual(M.ordinalOf(all, { date: '2026-01-01', ts: 0 }), null);
  assert.strictEqual(M.fromDailySingle(all[0], { ordinal: 3 }).ordinal, 3);
  assert.strictEqual(M.fromDailySingle(all[0], { ordinal: null }).ordinal, null);
});

test('fromDailyRange：按部去重、观影日按原始记录、平均只算有评分的', () => {
  const list = [
    e('2026-10-02', 1, '龙猫', 5),
    e('2026-10-04', 2, '花样年华', 4),
    e('2026-10-09', 3, '龙猫', 5),        // 重看：去重后只剩 10-09 这条，但 10-02 仍是观影日
    e('2026-10-11', 4, '卡萨布兰卡', 0)   // 未评分不进平均
  ];
  const r = M.fromDailyRange(list, { mode: 'month', year: 2026, month: 10, dedupe: dedupeMovies });
  assert.strictEqual(r.stats.count, 3);
  assert.strictEqual(r.stats.days, 4);
  assert.strictEqual(r.stats.avgStars, 4.5);
  assert.deepStrictEqual(r.films.map(f => f.title), ['花样年华', '龙猫', '卡萨布兰卡']);
  assert.strictEqual(r.title, '十月观影');
  assert.strictEqual(r.periodTitle, '十月');
  assert.strictEqual(r.periodSub, '2026');
});

test('fromDailyRange：最爱 = 最高分里最早的；全未评分 → 第一部', () => {
  const list = [e('2026-10-02', 1, 'a', 4), e('2026-10-03', 2, 'b', 5), e('2026-10-05', 3, 'c', 5)];
  const r = M.fromDailyRange(list, { mode: 'month', year: 2026, month: 10 });
  assert.strictEqual(r.favorite.title, 'b');
  assert.strictEqual(r.favoriteKind, 'best');
  const r2 = M.fromDailyRange([e('2026-10-05', 3, 'c', 0), e('2026-10-02', 1, 'a', 0)], { mode: 'month', year: 2026, month: 10 });
  assert.strictEqual(r2.favorite.title, 'a');
  assert.strictEqual(r2.favoriteKind, 'first');
  assert.strictEqual(r2.stats.avgStars, null);
});

test('fromDailyRange：按日期分组，组内按记录顺序', () => {
  const list = [e('2026-10-04', 5, 'c', 0), e('2026-10-02', 1, 'a', 0), e('2026-10-04', 2, 'b', 0)];
  const r = M.fromDailyRange(list, { mode: 'month', year: 2026, month: 10 });
  assert.deepStrictEqual(r.groups.map(g => [g.md, g.weekdayCn, g.films.map(f => f.title).join('')]), [['10.02', '周五', 'a'], ['10.04', '周日', 'bc']]);
});

test('fromDailyRange：年度不说「年度」，写「共 N 个月有记录」；自定义标题优先', () => {
  const list = [e('2026-08-02', 1, 'a', 0), e('2026-08-20', 2, 'b', 0), e('2026-10-01', 3, 'c', 0)];
  const r = M.fromDailyRange(list, { mode: 'year', year: 2026 });
  assert.strictEqual(r.periodSub, '共 2 个月有记录');
  assert.strictEqual(r.monthsWithData, 2);
  assert.ok(r.title.indexOf('年度') < 0 && r.periodSub.indexOf('年度') < 0);
  assert.strictEqual(M.fromDailyRange(list, { mode: 'year', year: 2026, customTitle: '  我的夏天 ' }).title, '我的夏天');
});

test('fromDailyRange：空范围', () => {
  const r = M.fromDailyRange([], { mode: 'month', year: 2026, month: 11 });
  assert.strictEqual(r.stats.count, 0);
  assert.strictEqual(r.stats.days, 0);
  assert.strictEqual(r.stats.avgStars, null);
  assert.strictEqual(r.favorite, null);
  assert.deepStrictEqual(r.groups, []);
});

test('fromRanking：按 rank 排点阵、计数、百分比保留 1 位', () => {
  const items = [3, 1, 2, 4, 5].map(r => ({ _id: 'm' + r, rank: r, title: 't' + r, cover: 'c' + r }));
  const marks = { statusMap: { m1: 'watched', m2: 'wish', m4: 'watched' }, timeMap: {} };
  const r = M.fromRanking(items, marks, { title: '豆瓣电影 TOP250' });
  assert.deepStrictEqual(r.dots, ['w', 'h', 'u', 'w', 'u']);
  assert.strictEqual(r.watched, 2);
  assert.strictEqual(r.wish, 1);
  assert.strictEqual(r.unwatched, 2);
  assert.strictEqual(r.pct, 40);
  assert.deepStrictEqual(r.watchedByRank.map(x => x.rank), [1, 4]);
  assert.strictEqual(M.fromRanking(items.slice(0, 3), { statusMap: { m1: 'watched' } }).pct, 33.3);
});

test('fromRanking：最近标记 = 标记时间倒序、截到上限、没有时间的排最后', () => {
  const items = Array.from({ length: 30 }, (_, i) => ({ _id: 'm' + (i + 1), rank: i + 1, title: 't' }));
  const statusMap = {}, timeMap = {};
  items.forEach((it, i) => { statusMap[it._id] = 'watched'; if (i < 26) timeMap[it._id] = 1000 + i; });
  const r = M.fromRanking(items, { statusMap, timeMap });
  assert.strictEqual(r.recent.length, 24);
  assert.strictEqual(r.recent[0].rank, 26);      // 最新标记的
  assert.strictEqual(r.recent[23].rank, 3);
  const r2 = M.fromRanking(items, { statusMap, timeMap }, { recentMax: 30 });
  assert.deepStrictEqual(r2.recent.slice(-4).map(x => x.rank), [27, 28, 29, 30]);
});

test('fromRanking：没有 rank 的按原顺序排在后面；空榜单', () => {
  const r = M.fromRanking([{ _id: 'b' }, { _id: 'a', rank: 1 }], { statusMap: { b: 'watched' } });
  assert.deepStrictEqual(r.dots, ['u', 'w']);
  assert.strictEqual(r.watchedByRank[0].rank, 2);
  const e0 = M.fromRanking([], {});
  assert.strictEqual(e0.total, 0);
  assert.strictEqual(e0.pct, 0);
  assert.deepStrictEqual(e0.recent, []);
});
