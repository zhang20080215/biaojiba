// 豆瓣导入：云函数 importDoubanMarks 的纯逻辑（链接解析、时间换算、写入规则、撤销规则）
//   node --test tools/test-douban-import.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseUid, doubanTimeToIso, cnDate, planPage, planUndo } = require('../cloudfunctions/importDoubanMarks/logic.js');

test('parseUid 认主页链接和纯 ID，拒绝怪字符', () => {
  assert.equal(parseUid('https://www.douban.com/people/4239269/?_i=35007524JPyJRL'), '4239269');
  assert.equal(parseUid('https://m.douban.com/people/ahbei/'), 'ahbei');
  assert.equal(parseUid('  4239269 '), '4239269');
  assert.equal(parseUid('ahbei'), 'ahbei');
  assert.equal(parseUid('我的主页 https://www.douban.com/people/abc_1.x/ 快来'), 'abc_1.x');
  assert.equal(parseUid(''), '');
  assert.equal(parseUid('a/b?c'), '');
  assert.equal(parseUid('https://movie.douban.com/subject/1292052/'), '');
});

test('doubanTimeToIso 按北京时间换算，认不出用兜底', () => {
  assert.equal(doubanTimeToIso('2026-03-12 13:22:57', 'x'), '2026-03-12T05:22:57.000Z');
  assert.equal(doubanTimeToIso('2026-01-01 00:30:00', 'x'), '2025-12-31T16:30:00.000Z');
  assert.equal(doubanTimeToIso('', 'fallback'), 'fallback');
  assert.equal(doubanTimeToIso('昨天', 'fallback'), 'fallback');
});

test('cnDate 用北京日期', () => {
  assert.equal(cnDate(Date.UTC(2026, 9, 31, 16, 30)), '2026-11-01');
  assert.equal(cnDate(Date.UTC(2026, 9, 31, 15, 59)), '2026-10-31');
});

const facts = {
  '1292052': { movieIds: ['movie_肖申克的救赎_', 'letterboxd500_1'], memberOf: ['douban', 'letterboxd500'] },
  '1291546': { movieIds: ['movie_霸王别姬_'], memberOf: ['douban'] },
  '3011091': { movieIds: ['rtWar_5'], memberOf: ['rtWar'] }
};
const T = '2026-03-12T05:22:57.000Z';

test('planPage：没标过的新增，一部片写到它在的每个榜单', () => {
  const p = planPage([{ doubanId: '1292052', status: 'watched', markedAt: T }], facts, {}, 'imp1');
  assert.deepEqual(p.adds.map(a => a.movieId), ['movie_肖申克的救赎_', 'letterboxd500_1']);
  assert.deepEqual(p.adds[0], { movieId: 'movie_肖申克的救赎_', status: 'watched', marked_at: T, source: 'douban_import', importId: 'imp1', importStatus: 'watched' });
  assert.equal(p.upgrades.length, 0);
  assert.deepEqual(p.films, { matched: 1, unmatched: 0, added: 1, upgraded: 0, skipped: 0, top250: 1 });
});

test('planPage：想看 + 豆瓣看过 → 升级并记下原状态；看过 + 豆瓣想看 → 跳过；同状态 → 跳过', () => {
  const existing = {
    'movie_霸王别姬_': { _id: 'm1', status: 'wish', marked_at: '2025-01-01T00:00:00.000Z' },
    'rtWar_5': { _id: 'm2', status: 'watched', marked_at: '2025-01-01T00:00:00.000Z' },
    'movie_肖申克的救赎_': { _id: 'm3', status: 'watched' },
    'letterboxd500_1': { _id: 'm4', status: 'watched' }
  };
  const p = planPage([
    { doubanId: '1291546', status: 'watched', markedAt: T },
    { doubanId: '3011091', status: 'wish', markedAt: T },
    { doubanId: '1292052', status: 'watched', markedAt: T }
  ], facts, existing, 'imp1');
  assert.equal(p.adds.length, 0);
  assert.deepEqual(p.upgrades, [{ _id: 'm1', movieId: 'movie_霸王别姬_', data: { status: 'watched', marked_at: T, source: 'douban_import', importId: 'imp1', importStatus: 'watched', prevStatus: 'wish', prevMarkedAt: '2025-01-01T00:00:00.000Z' } }]);
  assert.deepEqual(p.films, { matched: 3, unmatched: 0, added: 0, upgraded: 1, skipped: 2, top250: 2 });
});

test('planPage：一部片部分榜单已标、部分没标 → 只补没标的，按「新增」计', () => {
  const p = planPage([{ doubanId: '1292052', status: 'watched', markedAt: T }], facts,
    { 'movie_肖申克的救赎_': { _id: 'm3', status: 'watched' } }, 'imp1');
  assert.deepEqual(p.adds.map(a => a.movieId), ['letterboxd500_1']);
  assert.equal(p.films.added, 1);
});

test('planPage：对不上的片只计数；想看不计入 TOP250 已看', () => {
  const p = planPage([
    { doubanId: '999', status: 'watched', markedAt: T },
    { doubanId: '1291546', status: 'wish', markedAt: T }
  ], facts, {}, 'imp1');
  assert.equal(p.films.unmatched, 1);
  assert.equal(p.films.top250, 0);
  assert.equal(p.adds[0].status, 'wish');
});

test('planPage：同一页里重复的片只处理一次', () => {
  const p = planPage([
    { doubanId: '1291546', status: 'watched', markedAt: T },
    { doubanId: '1291546', status: 'watched', markedAt: T }
  ], facts, {}, 'imp1');
  assert.equal(p.adds.length, 1);
});

test('planUndo：没改过的新增删掉、升级的还原、改过的保留', () => {
  const u = planUndo([
    { _id: 'a', status: 'watched', importStatus: 'watched' },
    { _id: 'b', status: 'watched', importStatus: 'watched', prevStatus: 'wish', prevMarkedAt: '2025-01-01T00:00:00.000Z', marked_at: T },
    { _id: 'c', status: 'wish', importStatus: 'watched' },
    { _id: 'd', status: 'wish', importStatus: 'wish' }
  ]);
  assert.deepEqual(u.removes, ['a', 'd']);
  assert.deepEqual(u.restores, [{ _id: 'b', data: { status: 'wish', marked_at: '2025-01-01T00:00:00.000Z' } }]);
  assert.equal(u.kept, 1);
});
