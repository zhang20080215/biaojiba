// 离线回归：node --test tools/test-search-movie-dedupe.js
// 与 test-search-movie.js 一样借用 fetchOscarMovies 的 cheerio；不访问网络/数据库。
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const cheerio = require('../cloudfunctions/fetchOscarMovies/node_modules/cheerio');
const source = fs.readFileSync(path.join(__dirname, '../cloudfunctions/searchMovieByTitle/index.js'), 'utf8');

async function search(douban, mtime, keyword = '红辣椒', includeMtime = true) {
  const html = douban.map(m => `<div class="result"><div class="title"><h3><a href="https://movie.douban.com/subject/${m.id}/">${m.title}</a></h3></div><div class="subject-cast">原名:${m.originalTitle || m.title} / ${m.year || ''}</div></div>`).join('');
  const calls = [];
  const context = {
    exports: {}, console, setTimeout, clearTimeout, URL,
    require(name) {
      if (name === 'wx-server-sdk') return { init() {}, DYNAMIC_CURRENT_ENV: 'test' };
      if (name === 'cheerio') return cheerio;
      if (name === 'axios') return { async get(url) {
        calls.push(url);
        if (url.includes('unionSearch2')) return { status: 200, data: { data: { movies: mtime } } };
        if (url.includes('/search?')) return { status: 200, data: html };
        if (url.includes('subject_suggest')) return { status: 200, data: [] };
        throw new Error('Unexpected URL: ' + url);
      } };
      throw new Error('Unexpected module: ' + name);
    }
  };
  vm.runInNewContext(source, context);
  const result = await context.exports.main({ keyword, includeMtime }, {});
  assert.equal(result.success, true);
  return { candidates: JSON.parse(JSON.stringify(result.candidates)), calls };
}

const db = (id, year, title = '红辣椒', originalTitle = 'Paprika') => ({ id, year, title, originalTitle });
const mt = (id, year, name = '红辣椒', nameEn = 'Paprika') => ({ movieId: id, year, name, nameEn, movieContentType: '电影', directors: ['丁度·巴拉斯'], img: 'https://example.com/poster.jpg' });

test('同名 2006/1968 豆瓣电影不会吞掉时光网 1991 版本，同年版本不重复', async () => {
  const { candidates } = await search([db('1865703', '2006'), db('1301969', '1968')], [mt(23693, 1991), mt(22665, 1968)]);
  assert.deepEqual(candidates.map(c => c.key), ['db1865703', 'db1301969', 'mt23693']);
  const movie = candidates[2];
  assert.equal(movie.year, '1991');
  assert.equal(movie.source, 'mtime');
  assert.equal(movie.doubanId, '');
  assert.equal(movie.director, '丁度·巴拉斯');
  assert.equal(movie.rating, null);
});

test('片名归一化、同年重复和相同来源 ID 仍然去重', async () => {
  const { candidates } = await search([db('1', 2006)], [mt(2, 2006, '红 辣椒'), mt(3, 1991), mt(3, 1991)]);
  assert.deepEqual(candidates.map(c => c.key), ['db1', 'mt3']);
});

test('重访蓝丝绒：原名相同且年份差一仍合并', async () => {
  const { candidates } = await search([db('1', 2016, '重访蓝丝绒', 'Blue Velvet Revisited')], [mt(2, 2015, '重访蓝丝绒', 'Blue Velvet Revisited')], '蓝丝绒');
  assert.equal(candidates.length, 1);
});

test('相邻年份同名但原名不同的作品保留', async () => {
  const { candidates } = await search([db('1', 1992, '红辣椒', 'Different Film')], [mt(2, 1991)]);
  assert.equal(candidates.length, 2);
});

test('年份缺失不按同名猜测，相同来源 ID 仍去重', async () => {
  const { candidates } = await search([db('1', '')], [mt(2, 1991), mt(3, 0), mt(3, 0)]);
  assert.deepEqual(candidates.map(c => c.key), ['db1', 'mt2', 'mt3']);
});

test('相关性过滤和最多补 5 条仍生效', async () => {
  const { candidates } = await search([], [mt(9, 1999, '红河'), ...Array.from({ length: 8 }, (_, i) => mt(i + 10, 1970 + i * 3))]);
  assert.equal(candidates.length, 5);
  assert.ok(candidates.every(c => c.title === '红辣椒'));
});

test('未启用时光网的评分查询不受影响', async () => {
  const { candidates, calls } = await search([db('1', 2006)], [mt(2, 1991)], '红辣椒', false);
  assert.deepEqual(candidates.map(c => c.key), ['db1']);
  assert.ok(calls.every(url => !url.includes('mtime')));
});

test('1991 红辣椒已确认的占位图和空封面替换为 IMDb 海报', async () => {
  for (const img of ['', 'https://img31.mtime.cn/mt/2014/02/23/012437.96096376_o.jpg']) {
    const { candidates } = await search([], [{ ...mt(23693, 1991), img }]);
    assert.match(candidates[0].posterUrl, /^https:\/\/m\.media-amazon\.com\/images\//);
    assert.equal(candidates[0].source, 'mtime');
    assert.equal(candidates[0].mtimeId, '23693');
    assert.equal(candidates[0].doubanId, '');
  }
});

test('保留时光网新封面，不将修正套到其它版本或其它影片', async () => {
  const placeholder = 'https://img31.mtime.cn/mt/2014/02/23/012437.96096376_o.jpg';
  for (const movie of [mt(23693, 1991), { ...mt(23693, 2006), img: placeholder },
    { ...mt(23693, 1991, '红辣椒', 'Other Film'), img: placeholder },
    { ...mt(111617, 1985), img: placeholder }]) {
    const { candidates } = await search([], [movie]);
    assert.equal(candidates[0].posterUrl, movie.img);
  }
});
