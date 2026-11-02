// node --test tools/test-poster-covers.cjs
// 每日电影 / 每日读书分享页的封面并发加载（utils/posterCovers.js）
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { CONCURRENCY, mapLimit, ensureCoverNodes } = require(path.join(__dirname, '..', 'utils', 'posterCovers.js'));

const sleep = ms => new Promise(r => setTimeout(r, ms));

test('mapLimit：同时跑的不超过上限，全部跑完；取消后不再开新的', async () => {
  let running = 0, peak = 0;
  const seen = [];
  await mapLimit(Array.from({ length: 40 }, (_, i) => i), 6, async i => {
    running++; peak = Math.max(peak, running);
    await sleep(1 + (i % 3));
    seen.push(i); running--;
  });
  assert.strictEqual(peak, 6);
  assert.deepStrictEqual(seen.slice().sort((a, b) => a - b), Array.from({ length: 40 }, (_, i) => i));

  let count = 0;
  await mapLimit(Array.from({ length: 40 }), 4, async () => { count++; await sleep(1); }, () => count >= 8);
  assert.ok(count >= 8 && count < 40, '取消后停下');
});

test('ensureCoverNodes：只加载 cloud:// 封面、并发加载、已有的不重复；失败和无封面记 null', async () => {
  const movies = Array.from({ length: 120 }, (_, i) => ({ key: 'k' + i, poster: 'cloud://env/c/' + i + '.jpg' }));
  movies.push({ key: 'douban', poster: 'https://img.doubanio.com/x.jpg' }, { key: 'none', poster: '' }, { key: 'bad', poster: 'cloud://env/c/bad.jpg' });
  const nodes = { k0: 'cached' };
  const batches = [];
  let running = 0, peak = 0, loads = 0;
  const progress = [];
  await ensureCoverNodes({
    movies, nodes,
    getTempFileURL: async list => { batches.push(list.length); return { fileList: list.map(id => ({ fileID: id, tempFileURL: 'https://t/' + id })) }; },
    load: async url => {
      loads++; running++; peak = Math.max(peak, running);
      await sleep(2); running--;
      if (url.indexOf('bad') >= 0) throw new Error('404');
      return 'img:' + url;
    },
    onProgress: (done, total) => progress.push([done, total])
  });
  assert.strictEqual(nodes.k0, 'cached', '已有的不重新加载');
  assert.strictEqual(nodes.k1, 'img:https://t/cloud://env/c/1.jpg');
  assert.strictEqual(nodes.douban, null, '直链不加载');
  assert.strictEqual(nodes.none, null);
  assert.strictEqual(nodes.bad, null, '加载失败记 null');
  assert.strictEqual(loads, 120, '119 张 + bad');
  assert.strictEqual(peak, CONCURRENCY);
  assert.deepStrictEqual(batches, [50, 50, 20], '换链每批不超过 50');
  assert.deepStrictEqual(progress[progress.length - 1], [122, 122]);
});

test('ensureCoverNodes：换链失败不抛，全部记 null', async () => {
  const nodes = {};
  await ensureCoverNodes({
    movies: [{ key: 'a', poster: 'cloud://x/a.jpg' }],
    nodes,
    getTempFileURL: async () => { throw new Error('net'); },
    load: async () => 'never'
  });
  assert.deepStrictEqual(nodes, { a: null });
});

test('ensureCoverNodes：allowHttp 时直链直接加载、cloud 照常换链，混在一起也对', async () => {
  const nodes = {};
  const loaded = [];
  await ensureCoverNodes({
    movies: [
      { key: 'c', poster: 'cloud://x/c.jpg' },
      { key: 'h', poster: 'https://img9.doubanio.com/p1.jpg' },
      { key: 'h2', poster: 'http://img1.doubanio.com/p2.jpg' },
      { key: 'n', poster: '' }
    ],
    nodes,
    allowHttp: true,
    getTempFileURL: async list => ({ fileList: list.map(id => ({ fileID: id, tempFileURL: 'https://t/' + id })) }),
    load: async url => { loaded.push(url); return 'img:' + url; }
  });
  assert.strictEqual(nodes.c, 'img:https://t/cloud://x/c.jpg');
  assert.strictEqual(nodes.h, 'img:https://img9.doubanio.com/p1.jpg');
  assert.strictEqual(nodes.h2, 'img:http://img1.doubanio.com/p2.jpg');
  assert.strictEqual(nodes.n, null);
  assert.strictEqual(loaded.length, 3);
});
