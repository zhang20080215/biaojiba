// syncMarkAcrossThemes 云函数离线测试：内存版数据库。
// 重点是「修改标记」：记录是云函数写的（没有 _openid）时只有这个函数改得动，所以它必须连 movieId 自己一起写。
const { test } = require('node:test');
const assert = require('node:assert');
const Module = require('module'), path = require('path');

let marks = [], aliases = {}, failFor = null, nextId = 1;
const matches = (m, w) => Object.keys(w).every(k => {
  const v = w[k];
  return v && v.$in ? v.$in.indexOf(m[k]) >= 0 : m[k] === v;
});
const db = {
  command: { in: arr => ({ $in: arr }) },
  collection: name => name === 'movie_alias'
    ? { doc: id => ({ get: async () => { if (!aliases[id]) throw new Error('document not exist'); return { data: { siblings: aliases[id] } }; } }) }
    : {
      where: w => ({
        limit: () => ({ get: async () => ({ data: marks.filter(m => matches(m, w)) }) }),
        remove: async () => {
          if (failFor && failFor === w.movieId) throw new Error('boom');
          marks = marks.filter(m => !matches(m, w));
          return { stats: { removed: 1 } };
        }
      }),
      doc: id => ({
        update: async ({ data }) => {
          const m = marks.find(x => x._id === id);
          if (failFor && m && failFor === m.movieId) throw new Error('boom');
          Object.assign(m, data);
          return { stats: { updated: 1 } };
        }
      }),
      add: async ({ data }) => {
        if (failFor && failFor === data.movieId) throw new Error('boom');
        const row = Object.assign({ _id: `r${nextId++}` }, data);
        marks.push(row);
        return { _id: row._id };
      }
    }
};
const sdk = { init() {}, DYNAMIC_CURRENT_ENV: 'env', database: () => db, getWXContext: () => ({ OPENID: 'u1' }) };
const load = Module._load;
Module._load = (req, ...rest) => (req === 'wx-server-sdk' ? sdk : load(req, ...rest));
const { main } = require(path.join(__dirname, '../cloudfunctions/syncMarkAcrossThemes/index.js'));
Module._load = load;

const mark = (movieId, status, at, extra) => Object.assign({ _id: `r${nextId++}`, movieId, openid: 'u1', status, marked_at: at || '2026-01-01T00:00:00.000Z' }, extra);
const statusOf = id => (marks.find(m => m.movieId === id) || {}).status;
const reset = () => { marks = []; aliases = {}; failFor = null; };

test('改已有标记：只在一个榜单里的条目（云函数写的、前端改不动）也要改掉', async () => {
  reset();
  marks.push(mark('letterboxd500_1', 'watched'));
  const r = await main({ movieId: 'letterboxd500_1', status: 'wish' });
  assert.strictEqual(r.self, true);
  assert.strictEqual(statusOf('letterboxd500_1'), 'wish');
  assert.notStrictEqual(marks[0].marked_at, '2026-01-01T00:00:00.000Z');
});

test('取消标记：没有 alias 也要把自己删掉，重复记录一起删', async () => {
  reset();
  marks.push(mark('city_1', 'watched'), mark('city_1', 'wish', '2026-02-01T00:00:00.000Z'), mark('city_2', 'watched'));
  const r = await main({ movieId: 'city_1', status: '' });
  assert.strictEqual(r.self, true);
  assert.deepStrictEqual(marks.map(m => m.movieId), ['city_2']);
});

test('有兄弟：自己和兄弟都改成新状态，没记录的补上，alias 里带自己不重复写', async () => {
  reset();
  aliases.a = ['a', 'b', 'c'];
  marks.push(mark('a', 'watched'), mark('b', 'watched'));
  const r = await main({ movieId: 'a', status: 'wish' });
  assert.strictEqual(r.synced, 3);
  assert.strictEqual(marks.length, 3);
  ['a', 'b', 'c'].forEach(id => assert.strictEqual(statusOf(id), 'wish', id));
});

test('状态已经对了就不写（前端自己新增的那条）', async () => {
  reset();
  marks.push(mark('a', 'wish'));
  const r = await main({ movieId: 'a', status: 'wish' });
  assert.strictEqual(r.synced, 0);
  assert.strictEqual(r.self, true);
  assert.strictEqual(marks[0].marked_at, '2026-01-01T00:00:00.000Z');
});

test('重复记录：改 marked_at 最新的那条（processMarks 认它）', async () => {
  reset();
  const old = mark('a', 'watched', '2026-01-01T00:00:00.000Z');
  const latest = mark('a', 'watched', '2026-03-01T00:00:00.000Z');
  marks.push(old, latest);
  await main({ movieId: 'a', status: 'wish' });
  assert.strictEqual(latest.status, 'wish');
  assert.strictEqual(old.status, 'watched');
});

test('自己写失败 self=false，前端要回滚；只有兄弟失败 self 仍是 true', async () => {
  reset();
  aliases.a = ['b'];
  marks.push(mark('a', 'watched'), mark('b', 'watched'));
  failFor = 'a';
  assert.strictEqual((await main({ movieId: 'a', status: 'wish' })).self, false);
  failFor = 'b';
  const r = await main({ movieId: 'a', status: 'wish' });
  assert.strictEqual(r.self, true);
  assert.strictEqual(statusOf('a'), 'wish');
});

test('页面不再直接改、删云函数可能写过的标记', () => {
  const fs = require('fs');
  ['douban', 'genericList', 'scenic', 'province', 'city'].forEach(p => {
    const src = fs.readFileSync(path.join(__dirname, `../pages/${p}/list/list.js`), 'utf8');
    assert.ok(!/collection\('Marks'\)\.doc\([^)]*\)\.update/.test(src), `${p} update`);
    assert.ok(!/collection\('Marks'\)\.where\([^)]*\)\.remove/.test(src), `${p} remove`);
    assert.ok(src.includes('markSync.save('), p);
  });
  const book = fs.readFileSync(path.join(__dirname, '../pages/genericBookList/list/list.js'), 'utf8');
  assert.ok(!/collection\('BookMarks'\)\.doc\([^)]*\)\.update/.test(book));
  assert.ok(book.includes('this.saveBookMark('));
});
