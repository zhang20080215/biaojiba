// 云端注册主题的分享链接冷启动：用真实的通用列表/海报页跑 onLoad，桩掉 wx 和云函数。
// node --test tools/test-theme-cold-start.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const storage = new Map();
const state = { calls: [], titles: [], registry: null };

const BEAR = { theme: 'goldenBear', cardId: 'golden_bear_movies', type: 'movie', title: '历届柏林金熊奖', slogan: '标记经典', brandPrimary: '#8F5A2A', showEdition: true };
const HIGASHINO = { theme: 'higashino', cardId: 'higashino_books', type: 'book', title: '东野圭吾作品', brandPrimary: '#334455', source: 'higashino' };

function callFunction(req) {
  state.calls.push(req.name);
  if (req.name === 'getThemeRegistry') {
    if (state.registry === 'fail') return Promise.reject(new Error('offline'));
    if (state.registry === 'bad') return Promise.resolve({ result: { success: false } });
    return Promise.resolve({ result: { success: true, themes: state.registry || [] } });
  }
  return Promise.resolve({ result: { success: true, movies: [], marks: [], listVersion: null } });
}

const base = {
  getStorageSync: (k) => storage.get(k),
  setStorageSync: (k, v) => storage.set(k, v),
  removeStorageSync: (k) => storage.delete(k),
  getStorageInfoSync: () => ({ keys: [...storage.keys()] }),
  getWindowInfo: () => ({ statusBarHeight: 20, windowWidth: 375, windowHeight: 700, pixelRatio: 2 }),
  getMenuButtonBoundingClientRect: () => ({ top: 28, height: 32 }),
  getAppBaseInfo: () => ({ SDKVersion: '3.0.0' }),
  setNavigationBarTitle: ({ title }) => state.titles.push(title),
  createSelectorQuery: () => ({ in() { return this; }, select() { return this; }, selectAll() { return this; }, fields() { return this; }, boundingClientRect() { return this; }, exec() {} }),
  cloud: { init() {}, callFunction, database: () => ({}) }
};
global.wx = new Proxy(base, { get: (t, k) => (k in t ? t[k] : () => ({})) });
global.getApp = () => ({ globalData: {}, ensureOpenid: async () => {} });
global.getCurrentPages = () => [];

// 页面文件里有 ES import（开发者工具会编译），这里换成 require 再加载
function loadPage(rel) {
  let def;
  global.Page = (d) => { def = d; };
  const file = path.join(ROOT, rel);
  const source = fs.readFileSync(file, 'utf8').replace(/^import (\w+) from ('[^']+');?/gm, 'const $1 = require($2);');
  const mod = new Module(file, module);
  mod.filename = file;
  mod.paths = Module._nodeModulePaths(path.dirname(file));
  mod._compile(source, file);
  return def;
}

function open(def, options) {
  const page = { ...def, data: JSON.parse(JSON.stringify(def.data || {})) };
  page.setData = (patch) => {
    Object.entries(patch).forEach(([k, v]) => {
      const keys = k.split('.');
      let node = page.data;
      keys.slice(0, -1).forEach((p) => { node = node[p] = node[p] || {}; });
      node[keys[keys.length - 1]] = v;
    });
  };
  return { page, done: Promise.resolve(page.onLoad(options)) };
}

const flush = async () => { for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r)); };

function reset(registry, cached) {
  storage.clear();
  state.calls.length = 0;
  state.titles.length = 0;
  state.registry = registry;
  if (cached) storage.set('themeRegistryCache', { ts: Date.now(), themes: cached });
}

const movieList = loadPage('pages/genericList/list/list.js');
const bookList = loadPage('pages/genericBookList/list/list.js');
const movieShare = loadPage('pages/genericList/share/share.js');
const bookShare = loadPage('pages/genericBookList/share/share.js');
const loader = require(path.join(ROOT, 'utils/themeRegistryLoader.js'));

test('影单列表页：没有缓存时先拉注册表，再按云端配置读 getThemeMovies', async () => {
  reset([BEAR]);
  const { page } = open(movieList, { theme: 'goldenBear' });
  assert.equal(page.data.cfg.title, '');
  await flush();
  assert.deepEqual(state.calls.slice(0, 2), ['getThemeRegistry', 'getThemeMovies']);
  assert.ok(!state.calls.includes('getMoviesData'));
  assert.equal(page.data.cfg.title, '历届柏林金熊奖');
  assert.equal(page.data.cfg.brandPrimary, '#8F5A2A');
  assert.ok(state.titles.includes('历届柏林金熊奖'));
});

test('书单列表页：没有缓存时走 getThemeBooks，不读电影集合', async () => {
  reset([HIGASHINO]);
  const { page } = open(bookList, { theme: 'higashino' });
  await flush();
  assert.deepEqual(state.calls.slice(0, 2), ['getThemeRegistry', 'getThemeBooks']);
  assert.ok(!state.calls.includes('getMoviesData'));
  assert.equal(page.data.cfg.title, '东野圭吾作品');
  assert.equal(page.data.cfg.source, 'higashino');
});

test('缓存是旧的、里面没有新主题时也会重拉', async () => {
  reset([BEAR], [HIGASHINO]);
  const { page } = open(movieList, { theme: 'goldenBear' });
  await flush();
  assert.equal(state.calls[0], 'getThemeRegistry');
  assert.equal(page.data.cfg.title, '历届柏林金熊奖');
});

for (const failure of ['fail', 'bad']) {
  test(`注册表拉取失败（${failure}）时数据路由仍然正确，只是用默认标题`, async () => {
    reset(failure);
    const { page } = open(movieList, { theme: 'goldenBear' });
    await flush();
    assert.ok(state.calls.includes('getThemeMovies'));
    assert.ok(!state.calls.includes('getMoviesData'));
    assert.equal(page.data.cfg.title, '主题片单');

    reset(failure);
    open(bookList, { theme: 'higashino' });
    await flush();
    assert.ok(state.calls.includes('getThemeBooks'));
    assert.ok(!state.calls.includes('getMoviesData'));
  });
}

test('已缓存的云端主题不拉注册表，同步启动', async () => {
  reset(null, [BEAR]);
  const { page } = open(movieList, { theme: 'goldenBear' });
  assert.equal(page.data.cfg.title, '历届柏林金熊奖');
  await flush();
  assert.ok(!state.calls.includes('getThemeRegistry'));
  assert.ok(state.calls.includes('getThemeMovies'));
});

test('硬编码主题的路由和启动方式不变', async () => {
  reset(null);
  const palme = open(movieList, { theme: 'palmeDor' });
  assert.equal(palme.page.data.cfg.title, '历届金棕榈奖');
  assert.equal(palme.page.data.cfg.catalogType, undefined);
  await flush();
  assert.deepEqual(state.calls, ['getThemeMovies']);

  reset(null);
  const imdb = open(movieList, { theme: 'imdb' });
  await flush();
  assert.equal(imdb.page.data.cfg.catalogType, undefined);
  assert.deepEqual(state.calls, ['getMoviesData']);

  reset(null);
  open(bookList, { theme: 'douban_books' });
  await flush();
  assert.deepEqual(state.calls, ['getMoviesData']);
});

test('海报页冷启动也先拉注册表，标题和配色正确', async () => {
  reset([BEAR]);
  const movie = open(movieShare, { theme: 'goldenBear' });
  await movie.done;
  await flush();
  assert.equal(state.calls[0], 'getThemeRegistry');
  assert.ok(!state.calls.includes('getMoviesData'));
  assert.equal(movie.page.data.cfg.title, '历届柏林金熊奖');
  assert.equal(movie.page.data.uiText.cardTitle, '历届柏林金熊奖观影海报');

  reset([HIGASHINO]);
  const book = open(bookShare, { theme: 'higashino' });
  await book.done;
  await flush();
  assert.equal(state.calls[0], 'getThemeRegistry');
  assert.ok(!state.calls.includes('getMoviesData'));
  assert.equal(book.page.data.cfg.title, '东野圭吾作品');
});

test('同时发起的拉取只调一次云函数', async () => {
  reset([BEAR]);
  await Promise.all([loader.refresh(), loader.refresh(), loader.ensureTheme('goldenBear', {})]);
  assert.deepEqual(state.calls, ['getThemeRegistry']);
});
