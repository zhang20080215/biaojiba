const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), vm = require('vm');
const model = require('../utils/hubModel');
const logic = require('../cloudfunctions/getThemeHub/logic');
const catalog = require('../utils/themeCatalog');
const serverCatalog = require('../cloudfunctions/getThemeHub/catalog.json');
const root = path.resolve(__dirname, '..');
const fixtures = [
  ...Array.from({ length: 5 }, (_, i) => ({ id: 'movie' + i, category: 'movie', title: '电影' + i })),
  { id: 'book', category: 'reading', title: '悬疑小说' }, { id: 'travel', category: 'travel', title: '旅行' },
  { id: 'award', category: 'oscar', title: '奥斯卡' }, { id: 'daily', category: 'daily', title: '每日读书' }
];
const stats = { rows: Object.fromEntries(fixtures.map((t, i) => [t.id, { users: 100 - i, valid: true, total: 250 }])) };
test('home shows the ten most popular lists in count order without domain quotas', () => {
  const more = fixtures.concat(Array.from({ length: 8 }, (_, i) => ({ id: 'extra' + i, category: 'movie', title: '新电影' + i })));
  const counts = { rows: Object.fromEntries(more.map((t, i) => [t.id, { users: 100 - i, valid: true, total: 250 }])) };
  const rows = model.decorate(more, counts);
  const hot = model.selectHot(rows);
  assert.equal(hot.length, 10);
  assert.equal(hot[0].id, 'movie0');
  assert.deepEqual(hot.slice(0, 5).map(t => t.id), ['movie0', 'movie1', 'movie2', 'movie3', 'movie4']);
  assert.deepEqual(hot.map(t => t.popularityRank), Array.from({ length: 10 }, (_, i) => i + 1));
  assert.ok(!hot.some(t => t.id === 'daily'));
});
test('unknown counts stay blank and known counts use the original display rule', () => {
  const rows = model.decorate(fixtures, { rows: { movie0: { users: 0, valid: true, total: 10 }, movie1: { users: 999, valid: false } } });
  assert.equal(rows[0].userCount, 0);
  assert.equal(rows[0].userCountText, '100+');
  assert.equal(rows[1].userCount, null);
  assert.equal(rows[1].userCountText, '');
  assert.deepEqual(model.selectHot(rows).map(t => t.id), ['movie0']);
  assert.deepEqual(model.selectHot(model.decorate(fixtures, null)), []);
  assert.equal(model.formatCount(105), '100+');
  assert.equal(model.formatCount(1000), '1k');
  assert.equal(model.formatCount(1299), '1.2k');
  assert.equal(model.formatCount(10399), '10.3k');
});
test('popular rank responds to refreshed counts and excludes empty or hidden lists', () => {
  const rows = model.decorate(fixtures, stats);
  rows[2].userCount = 999;
  rows[1].contentCount = 0;
  rows[0].hidden = true;
  const hot = model.selectHot(rows);
  assert.equal(hot[0].id, 'movie2');
  assert.ok(!hot.some(t => t.id === 'movie0' || t.id === 'movie1'));
});
test('latest shows four most recent launches, including older and popular lists', () => {
  const now = Date.parse('2026-10-11T00:00:00Z');
  const dated = [ { id: 'valid', publishedAt: '2026-10-09' }, { id: 'hot', publishedAt: '2026-10-10', countKnown: true, userCount: 999 }, { id: 'old', publishedAt: '2026-07-01', isNew: true }, { id: 'unknown', isNew: true }, { id: 'future', publishedAt: '2027-01-01' }, { id: 'last', publishedAt: '2026-06-01' }, { id: 'empty', publishedAt: '2026-10-11', countKnown: true, contentCount: 0 }, { id: 'tool', category: 'daily', publishedAt: '2026-10-11' } ];
  assert.deepEqual(model.selectNew(dated, now).map(t => t.id), ['hot', 'valid', 'old', 'last']);
  assert.deepEqual(model.selectNew(dated.filter(t => !t.publishedAt), now).map(t => t.id), ['unknown']);
  assert.deepEqual(model.selectNew(fixtures, now).map(t => t.id), ['movie0','movie1','movie2','movie3']);
});
test('search matches outrank popular partial matches and awards belong to film', () => {
  const rows = model.decorate(fixtures.concat({ id: 'match', category: 'reading', title: '小说' }), stats);
  assert.equal(model.filter(rows, 'all', '小说', 'popular', t => [t.title])[0].id, 'match');
  assert.ok(model.filter(rows, 'movie', '', 'popular', t => [t.title]).some(t => t.id === 'award'));
  assert.ok(!model.filter(rows, 'all', '', 'popular', t => [t.title]).some(t => t.id === 'daily'));
  assert.equal(model.filter(rows, 'tools', '', 'popular', t => [t.title])[0].id, 'daily');
});
test('all visible local lists have a matching server statistics config', () => {
  for (const t of catalog.filter(model.isList)) assert.ok(serverCatalog.some(c => c.id === t.id), t.id);
});
test('registry preserves built-in configs and excludes disabled entries', () => {
  const rows = logic.mergeCatalog([{ id: 'built', collection: 'movies' }], [
    { cardId: 'built', theme: 'malformed', type: 'book' }, { cardId: 'off', theme: 'off', enabled: false }, { cardId: 'new', theme: 'new', type: 'book' }
  ]);
  assert.equal(rows.length, 2); assert.equal(rows[0].collection, 'movies'); assert.equal(rows[1].source, 'new');
});
test('personal progress deduplicates entries, respects latest state/source and ignores removed records', () => {
  const c = { marksCollection: 'BookMarks', idField: 'bookId', source: 'douban' };
  const rows = [
    { openid: 'me', bookId: 'a', status: 'wish', marked_at: '2026-01-01' },
    { openid: 'me', bookId: 'a', status: 'read', marked_at: '2026-10-01' },
    { openid: 'me', bookId: 'b', status: 'wish', source: 'weread' },
    { openid: 'me', bookId: 'c', status: 'unread' },
    { openid: '', bookId: 'b', status: 'read' }
  ];
  assert.deepEqual(logic.summarize(c, ['a','b','c'], rows), { total: 3, done: 1, wish: 0 });
  assert.equal(logic.belongs({ theme: 'wrong' }, { theme: 'correct' }), false);
  assert.equal(logic.belongs({ isTop250: false }, { topFiltered: true }), false);
});
test('tab pages, icons and visible catalog routes all exist and old home path remains first', () => {
  const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json')));
  assert.equal(app.pages[0], 'pages/category/category');
  assert.deepEqual(app.tabBar.list.map(t => t.text), ['首页','分类','记录','我的']);
  for (const t of app.tabBar.list) {
    for (const ext of ['js','json','wxml','wxss']) assert.ok(fs.existsSync(path.join(root, t.pagePath + '.' + ext)));
    assert.ok(app.pages.includes(t.pagePath));
    for (const icon of [t.iconPath, t.selectedIconPath]) assert.ok(fs.statSync(path.join(root, icon)).size < 40960);
    assert.match(fs.readFileSync(path.join(root, t.pagePath + '.wxml'), 'utf8'), /<import /);
  }
  for (const t of catalog.filter(t => !t.hidden)) assert.ok(app.pages.includes(t.url.split('?')[0].replace(/^\//, '')), t.id);
});
function storeFixture(response = () => ({ result: { success: false } })) {
  const storage = new Map(); let calls = 0; const navigations = [];
  const wx = { getStorageSync: k => storage.get(k), setStorageSync: (k,v) => storage.set(k,v), switchTab: args => navigations.push(args.url), cloud: { callFunction: async args => { calls++; return response(args); } } };
  const sandbox = { module: { exports: {} }, require: p => require(path.join(root,'utils',p)), wx, Date, console, setTimeout: fn => setImmediate(fn) }; vm.runInNewContext(fs.readFileSync(path.join(root, 'utils/hubStore.js'), 'utf8'), sandbox);
  return { store: sandbox.module.exports, storage, navigations, calls: () => calls };
}
// 自定义 tab-bar 组件：Component 定义在沙箱里取出，setData 直接合并进 data
function tabBarFixture({ showRecords = true, appTheme = 'theme-green' } = {}) {
  let def; const navigations = [];
  const adConfig = { shouldShowRecordsTab: () => showRecords, onRemoteApplied() {}, offRemoteApplied() {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'custom-tab-bar/index.js'), 'utf8'), {
    Component: d => { def = d; }, require: () => adConfig, getApp: () => ({ globalData: { theme: appTheme } }),
    wx: { switchTab: args => navigations.push(args.url) }
  });
  const bar = { data: JSON.parse(JSON.stringify(def.data)), setData(patch) { Object.assign(this.data, patch); }, ...def.methods };
  def.lifetimes.attached.call(bar);
  return { bar, navigations };
}

test('tab pages forward theme and kind to the custom tab bar', () => {
  const { store } = storeFixture(); const synced = [];
  store.applyTabStyle('theme-gold', { getTabBar: () => ({ sync: (kind, theme) => synced.push([kind, theme]) }) }, 'discover');
  assert.deepEqual(synced, [['discover', 'theme-gold']]);
  store.applyTabStyle('theme-gold', { getTabBar: () => null }, 'home');
  store.applyTabStyle('theme-gold', {}, 'home');
  store.applyTabStyle('theme-gold', null, 'home');
  assert.equal(synced.length, 1);
});
test('all four palettes update custom tab text and bundled selected icons', () => {
  for (const [theme, suffix, color] of [['theme-green', '', '#526631'], ['', '-pink', '#9F4865'], ['theme-gold', '-gold', '#856216'], ['theme-sand', '-sand', '#756448']]) {
    const { bar } = tabBarFixture(); bar.sync('profile', theme);
    assert.equal(bar.data.selectedColor, color);
    assert.equal(bar.data.selected, 'profile');
    assert.deepEqual(Array.from(bar.data.tabs, t => t.kind), ['home', 'discover', 'records', 'profile']);
    for (const item of bar.data.tabs) {
      assert.ok(item.activeIcon.endsWith('/' + item.kind + '-active' + suffix + '.png'));
      assert.ok(fs.existsSync(path.join(root, item.activeIcon)));
      assert.ok(fs.existsSync(path.join(root, item.icon)));
    }
  }
});
test('records tab follows the cloud switch and attached bar uses the app theme', () => {
  const { bar, navigations } = tabBarFixture({ showRecords: false, appTheme: '' });
  assert.equal(bar.data.selectedColor, '#9F4865');
  assert.deepEqual(Array.from(bar.data.tabs, t => t.kind), ['home', 'discover', 'profile']);
  bar.sync('home', undefined);
  assert.equal(bar.data.selectedColor, '#526631');
  bar.onTap({ currentTarget: { dataset: { kind: 'home', path: '/pages/category/category' } } });
  bar.onTap({ currentTarget: { dataset: { kind: 'profile', path: '/pages/profile/index' } } });
  assert.deepEqual(navigations, ['/pages/profile/index']);
});

test('pink theme survives cold launch while first launch defaults to green', () => {
  for (const [savedTheme, stored, expected] of [['', true, ''], ['', false, 'theme-green'], ['theme-gold', true, 'theme-gold'], ['theme-sand', true, 'theme-sand'], ['invalid', true, 'theme-green']]) {
    let app;
    const wx = { cloud: { init() {} }, getStorageSync: () => savedTheme, getStorageInfoSync: () => ({ keys: stored ? ['appTheme'] : [] }) };
    vm.runInNewContext(fs.readFileSync(path.join(root, 'app.js'), 'utf8'), { wx, App: config => { app = config; }, require: () => ({ onAdFreeChange() {}, onAdFreePassChange() {} }), console, setTimeout() {} });
    app.onLaunch();
    assert.equal(app.globalData.theme, expected);
  }
});
test('cross-tab search intent is consumed once and never leaks to another tab', () => {
  const { store, navigations } = storeFixture();
  store.switchTo('discover', { query: '奥斯卡', sort: 'latest' });
  assert.equal(navigations[0], '/pages/discover/index');
  assert.equal(store.takeIntent('records'), null);
  assert.equal(store.takeIntent('discover').query, '奥斯卡');
  assert.equal(store.takeIntent('discover'), null);
});
test('empty local snapshots are ignored and concurrent loads issue one database read', async () => {
  const { store, storage, calls } = storeFixture();
  storage.set('hubStatsV1', { rows: {}, generatedAt: Date.now() - 8 * 86400000 });
  assert.equal(store.readStats(), null);
  await Promise.all([store.loadStats(), store.loadStats()]);
  assert.equal(calls(), 1);
});

const partialStats = () => ({ success: true, jobVersion: 5, completedAt: Date.now(), needsRefresh: false, generatedAt: Date.now(), rows: {
  douban_movies: { valid: false }, imdb_movies: { valid: false },
  oscar_movies: { valid: true, users: 4474, total: 98 }, oscar_anime_movies: { valid: true, users: 7928, total: 25 },
  rt_animation_movies: { valid: true, users: 8596, total: 137 }, letterboxd500_movies: { valid: true, users: 8818, total: 500 },
  oscar_cinematography_movies: { valid: true, users: 7648, total: 125 }, oscar_screenplay_movies: { valid: true, users: 6984, total: 86 },
  oscar_director_movies: { valid: true, users: 7906, total: 99 }, oscar_vfx_movies: { valid: true, users: 7660, total: 84 },
  rt_action_movies: { valid: true, users: 7422, total: 140 }, arthouse_movies: { valid: true, users: 7728, total: 250 },
  sightsound_movies: { valid: true, users: 7698, total: 257 }
} });

test('an unusable recent cache cannot suppress valid partial cloud statistics', async () => {
  const f = storeFixture(() => ({ result: partialStats() }));
  f.storage.set('hubStatsV1', { generatedAt: Date.now(), rows: { douban_movies: { valid: false } } });
  assert.equal(f.store.readStats(), null);
  const result = await f.store.loadStats();
  assert.equal(f.calls(), 1);
  assert.equal(model.selectHot(model.decorate(catalog, result)).length, 10);
  assert.equal(f.store.readStats().rows.letterboxd500_movies.users, 8818);
  // 云端还不是今天的数据时，5 分钟内的普通进入不重复问云端；下拉/重试照常问
  await f.store.loadStats(); assert.equal(f.calls(), 1);
  await f.store.loadStats(true); assert.equal(f.calls(), 2);
});
test('history maintains recency without duplicate theme keys', () => {
  const { store } = storeFixture();
  store.remember('douban'); store.remember('imdb'); store.remember('douban');
  assert.equal(store.readHistory().length, 2); assert.equal(store.readHistory()[0].id, 'douban');
  assert.equal(model.routeKey(catalog.find(t => t.id === 'daily_movie')), 'daily:movie');
});
const fixture = require('./navigation-fixture.cjs');

test('home recovers after initial statistics failure on return and explicit retry', async () => {
  const f = fixture('home');
  f.store.readStats = () => null;
  f.store.loadStats = async () => null;
  f.page.onLoad(); f.page.onShow();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.page.data.statsState, 'error');
  assert.equal(f.page.data.hotThemes.length, 0);
  assert.equal(f.page.data.fallbackThemes.length, 10);
  assert.ok(f.page.data.fallbackThemes.every(t=>t.url && !t.countKnown && !t.popularityRank));
  const flags = [];
  f.store.loadStats = async force => { flags.push(force); return partialStats(); };
  f.page.onShow();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.page.data.statsState, 'ready');
  assert.equal(f.page.data.hotThemes.length, 10);
  assert.equal(f.page.data.hotThemes[0].id, 'letterboxd500_movies');
  assert.ok(!f.page.data.hotThemes.some(t => t.id === 'douban_movies' || t.id === 'imdb_movies'));
  await f.page.onRetryUserCounts();
  assert.deepEqual(flags, [false, true]);
  await f.page.onPullDownRefresh();
  assert.deepEqual(flags, [false, true, true]);
  f.page.onUnload();
});
test('root page lifecycles preserve pins and profile avoids statistics/content requests', async () => {
  for (const kind of ['home','discover','records','profile']) {
    const f = fixture(kind); f.page.onLoad(); f.page.onShow();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.page.data.dailyBlocks.length, 6);
    assert.deepEqual(f.page.data.dailyBlocks.slice(4).map(b => b.title), ['每日步数', '每日早睡']);
    assert.deepEqual(Array.from(f.page.data.commonThemes, t => t.id), ['douban_movies','daily_read']);
    assert.equal(f.page.data.commonThemes[1].progressText, '已收藏 · 点击打开');
    if (kind === 'profile') { assert.ok(f.calls.includes('summary')); assert.ok(!f.calls.includes('getThemeHub')); }
    if (kind === 'profile') assert.equal(f.page.data.summaryState, 'ready');
    if (kind === 'records') assert.equal(f.page.data.timelineRows.length, 1);
    if (kind === 'home') assert.ok(!f.calls.includes('summary'), 'home no longer loads progress for the removed continue section');
    f.page.onUnload();
  }
});
test('catalog star toggles favorites in the legacy pin storage without reordering the rest', async () => {
  const f = fixture('discover');
  f.wx.setStorageSync('categoryPinnedIds', ['daily_read', 'douban_movies']);
  f.page.onLoad(); f.page.onShow();
  await new Promise(resolve => setImmediate(resolve));
  const fav = id => (f.page.data.filteredThemes.find(t => t.id === id) || {}).favorited;
  assert.equal(fav('douban_movies'), true);
  assert.ok(!fav('imdb_movies'));
  f.page.onToggleFavorite({ currentTarget: { dataset: { id: 'imdb_movies' } } });
  assert.deepEqual(f.wx.getStorageSync('categoryPinnedIds'), ['daily_read', 'douban_movies', 'imdb_movies']);
  assert.equal(fav('imdb_movies'), true);
  assert.equal(f.page.data.commonThemes[2].id, 'imdb_movies');
  f.page.onToggleFavorite({ currentTarget: { dataset: { id: 'douban_movies' } } });
  assert.deepEqual(f.wx.getStorageSync('categoryPinnedIds'), ['daily_read', 'imdb_movies']);
  assert.ok(!fav('douban_movies'));
  f.page.onUnload();
});
test('profile directly inherits legacy pins in order without rewriting storage', async () => {
  const f = fixture('profile');
  const legacy = ['daily_read', 'imdb_movies', 'douban_movies', 'travel_provinces'];
  f.wx.setStorageSync('categoryPinnedIds', legacy);
  f.page.onLoad(); f.page.onShow();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.page.data.personalTab, 'common');
  assert.deepEqual(Array.from(f.page.data.commonThemes, t => t.id), legacy);
  assert.equal(f.wx.getStorageSync('categoryPinnedIds'), legacy, 'reading does not overwrite old data');
  f.page.onExpandPersonal();
  assert.deepEqual(Array.from(f.page.data.personalThemes, t => t.id), legacy);
});
test('saving common themes retains unloaded legacy pins and their original positions', () => {
  const f = fixture('profile');
  f.wx.setStorageSync('categoryPinnedIds', ['daily_read', 'cloud_pending', 'douban_movies']);
  f.page.onLoad(); f.page.onShow();
  f.page.onOpenPinManager();
  f.page.onSavePin();
  assert.deepEqual(Array.from(f.wx.getStorageSync('categoryPinnedIds')), ['daily_read', 'cloud_pending', 'douban_movies']);
  f.page.onOpenPinManager();
  f.page.onTogglePinItem({currentTarget:{dataset:{id:'daily_read'}}});
  f.page.onTogglePinItem({currentTarget:{dataset:{id:'imdb_movies'}}});
  f.page.onSavePin();
  assert.deepEqual(Array.from(f.wx.getStorageSync('categoryPinnedIds')), ['cloud_pending', 'douban_movies', 'imdb_movies']);
  f.page._mergeCloudThemes([{theme:'pending',cardId:'cloud_pending',title:'旧置顶云端主题',type:'book'}]);
  assert.deepEqual(Array.from(f.page.data.commonThemes, t => t.id), ['cloud_pending', 'douban_movies', 'imdb_movies']);
});
test('offline page remains navigable and does not mistake a summary failure for empty records', async () => {
  const f = fixture('profile', { offline: true }); f.page.onLoad(); f.page.onShow();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.page.data.summaryState, 'error');
  f.page.onOpenTheme({ currentTarget: { dataset: { id: 'douban_movies' } } });
  assert.equal(f.navigations[0].url, '/pages/douban/list/list');
});
test('cloud catalog refresh updates existing titles, dates and removes disabled entries', () => {
  const f = fixture('discover'); f.page.onLoad();
  f.page._mergeCloudThemes([{ theme: 'new', cardId: 'cloud_new', title: '旧名称', type: 'book' }]);
  f.page._mergeCloudThemes([{ theme: 'new', cardId: 'cloud_new', title: '新名称', type: 'book', publishedAt: '2026-10-10' }]);
  assert.equal(f.page.data.themes.find(t => t.id === 'cloud_new').title, '新名称');
  assert.equal(f.page.data.themes.find(t => t.id === 'cloud_new').publishedAt, '2026-10-10');
  f.page._mergeCloudThemes([]);
  assert.ok(!f.page.data.themes.some(t => t.id === 'cloud_new'));
  f.page.onUnload();
});

test('registry launch dates and wish attribution apply to existing local lists', () => {
  const f = fixture('home'); f.page.onLoad();
  f.page._mergeCloudThemes([{ theme: 'oscarForeign', cardId: 'oscar_foreign_movies', publishedAt: '2026-10-10', wishFrom: '新**' }]);
  assert.equal(f.page.data.newThemes.length, 4);
  assert.equal(f.page.data.newThemes[0].id, 'oscar_foreign_movies');
  assert.equal(f.page.data.newThemes[0].wishFrom, '新**');
  assert.equal(f.page.data.newThemes[0].url, '/pages/genericList/list/list?theme=oscarForeign');
  f.page.onUnload();
});
test('all WXML event bindings resolve on each page factory', () => {
  const text = fs.readFileSync(path.join(root, 'templates/hub.wxml'), 'utf8') + fs.readFileSync(path.join(root, 'templates/hub-overlays.wxml'), 'utf8');
  for (const kind of ['home','discover','records','profile']) {
    const f = fixture(kind);
    for (const match of text.matchAll(/(?:bind\w+|catch\w+)="([A-Za-z][\w]*)"/g)) assert.equal(typeof f.page[match[1]], 'function', kind + ':' + match[1]);
  }
});
test('failed static cloud covers fall back to the theme placeholder', () => {
  const f = fixture('discover'); f.page.onLoad();
  assert.ok(f.page.data.themes.find(t => t.id === 'daily_movie').image);
  f.page.onCoverError({currentTarget:{dataset:{id:'daily_movie'}}});
  const theme = f.page.data.themes.find(t => t.id === 'daily_movie');
  assert.equal(theme.image,''); assert.equal(theme.dynamicCover,null);
  f.page.onUnload();
});





test('legacy fallback counts use the original display format and remain sortable',()=>{
  const rows=model.decorate(fixtures,{rows:{movie0:{valid:true,users:2,total:10,estimated:true}}});
  assert.equal(rows[0].userCountText,'100+');
  assert.equal(model.selectHot(rows)[0].id,'movie0');
});


test('cached counts survive empty, failed and partial background responses in both storage and page',async()=>{
  const now=Date.now();
  const cached={success:true,generatedAt:now-1000,rows:{douban_movies:{valid:true,users:9999,total:250},imdb_movies:{valid:true,users:8888,total:250}}};
  const incoming={success:true,generatedAt:now,rows:{douban_movies:{valid:false},oscar_movies:{valid:true,users:10,total:98}}};
  const s=storeFixture(()=>({result:incoming}));
  s.storage.set('hubStatsV1',cached);
  const combined=await s.store.loadStats(true);
  assert.equal(combined.rows.douban_movies.users,9999);
  assert.equal(s.store.readStats().rows.imdb_movies.users,8888);
  const f=fixture('home');
  f.store.readStats=()=>cached;
  f.store.loadStats=async(force,update)=>{
    update({success:false,rows:{},generatedAt:0});
    assert.equal(f.page.data.hotThemes[0].userCount,9999);
    update(incoming);
    return {success:false,rows:{}};
  };
  await f.page.loadUserCounts(true);
  assert.equal(f.page.data.hotThemes[0].id,'douban_movies');
  assert.equal(f.page.data.hotThemes[1].id,'imdb_movies');
  assert.equal(f.page.data.statsState,'ready');
  f.page.filterThemes('all');
  assert.equal(f.page.data.hotThemes[0].userCount,9999);
});

test('late initial response cannot roll back a newer subscriber update',async()=>{
  const now=Date.now();
  const old={generatedAt:now-1000,rows:{douban_movies:{valid:true,users:5,total:250}}};
  const latest={generatedAt:now,rows:{douban_movies:{valid:true,users:9000,total:250}}};
  const f=fixture('home');f.store.readStats=()=>old;
  f.store.loadStats=async(force,update)=>{update(latest);return old;};
  await f.page.loadUserCounts(true);
  assert.equal(f.page.data.hotThemes[0].userCount,9000);
});

test('partial ranking keeps missing Douban and IMDb entrances without inventing ranks or counts',async()=>{
  const f=fixture('home');f.store.readStats=()=>null;
  f.page.filterThemes('all');
  assert.deepEqual(Array.from(f.page.data.fallbackThemes.slice(0,2),t=>t.id),['douban_movies','imdb_movies']);
  f.store.loadStats=async()=>partialStats();
  await f.page.loadUserCounts(true);
  assert.equal(f.page.data.hotThemes.length,10);
  assert.deepEqual(Array.from(f.page.data.pendingClassicThemes,t=>t.id),['douban_movies','imdb_movies']);
  assert.ok(f.page.data.pendingClassicThemes.every(t=>!t.countKnown && !t.popularityRank));
});

test('failed updates retain expired counts and a newer successful zero is accepted',()=>{
  const merge=require('../utils/hubStats').merge,now=Date.now();
  const old={generatedAt:now-1000,rows:{a:{valid:true,users:9,total:10}}};
  const kept=merge(old,{generatedAt:now,rows:{a:{valid:false}}},now);
  assert.equal(kept.rows.a.updatedAt,now-1000);
  assert.equal(merge(kept,{generatedAt:now+8*86400000,rows:{}},now+8*86400000).rows.a.users,9);
  assert.equal(merge(old,{generatedAt:now,rows:{a:{valid:true,users:0,total:10}}},now).rows.a.users,0);
});

test("today's statistics are reused locally without calling the cloud; refreshIds no longer fan out",async()=>{
  const requests=[];
  const today=new Date(Date.now()+8*3600000).toISOString().slice(0,10);
  const initial={success:true,day:today,generatedAt:Date.now(),rows:{douban_movies:{valid:true,users:12345}},refreshIds:['imdb_movies','oscar_movies']};
  const f=storeFixture(async args=>{requests.push(args.data);return {result:initial};});
  const r=await f.store.loadStats();assert.equal(r.rows.douban_movies.users,12345);
  for(let i=0;i<5;i++)await new Promise(r=>setImmediate(r));
  assert.deepEqual(requests.map(r=>r.action),['stats']);
  await f.store.loadStats();await f.store.loadStats();
  assert.equal(requests.length,1);
  assert.equal(f.store.readStats().rows.douban_movies.users,12345);
  await f.store.loadStats(true);assert.equal(requests.length,2);
});

test('lock winner returns history at once and computes in the background without touching the view',async()=>{
  const today=new Date(Date.now()+8*3600000).toISOString().slice(0,10);
  const requests=[];let release;const gate=new Promise(r=>release=r);
  const stale={success:true,day:'2000-01-01',generatedAt:Date.now(),refreshing:true,refreshToken:'tok',rows:{douban_movies:{valid:true,users:99,total:250}}};
  const fresh={success:true,day:today,generatedAt:Date.now()+1,rows:{douban_movies:{valid:true,users:4321,total:250,updatedAt:Date.now()+1}}};
  const f=storeFixture(async args=>{
    requests.push(args.data);
    if(args.data.action==='stats')return {result:stale};
    await gate;return {result:fresh};
  });
  const seen=[];
  const r=await f.store.loadStats(false,u=>seen.push(u));
  assert.equal(r.rows.douban_movies.users,99);
  assert.deepEqual(requests.map(x=>x.action),['stats','computeStats']);
  assert.equal(requests[1].token,'tok');
  release();for(let i=0;i<5;i++)await new Promise(r=>setImmediate(r));
  assert.ok(seen.every(u=>u.rows.douban_movies.users===99));
  assert.equal(f.store.readStats().rows.douban_movies.users,4321);
  assert.equal(f.store.readStats().day,today);
  await f.store.loadStats();assert.equal(requests.length,2);
});

test('locked records tab shows a demo feed under the mask and never loads the timeline or covers', async () => {
  const f = fixture('records', { recordsLocked: true });
  f.wx.setStorageSync('categoryDynCovers', { douban_movies: 'cloud://shawshank.jpg' });
  let listed = 0, coverQueries = 0;
  f.page.loadDynamicCovers = () => { coverQueries++; };
  f.page.onLoad(); f.page.onShow();
  await new Promise(resolve => setImmediate(resolve));
  f.page.onShow(); await f.page.onPullDownRefresh(); f.page.onReachBottom();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.page.data.recordsLocked, true);
  assert.equal(f.page.data.timelineRows.length, 4);
  assert.equal(f.page.data.timelineRows[0].items[0].title, '肖申克的救赎');
  assert.equal(f.page.data.timelineRows[0].items[0].cover, 'cloud://shawshank.jpg');
  assert.equal(f.page.data.timelineRows[1].summary, '在读一本书《红楼梦》');
  assert.equal(f.page.data.timelineRows[2].summary, '标记了 3 部看过的电影');
  assert.equal(f.page.data.timelineRows[0].detail.starsText, '★★★★★');
  assert.equal(coverQueries, 0);
  f.page.onGoHome();
  assert.equal(f.navigations[0].kind, 'home');
  const other = fixture('home', { recordsLocked: true }); other.page.onLoad();
  assert.equal(other.page.data.recordsLocked, false);
});

test('wish-like taps animate, batch into one upload, cap at 10 a day and show the rounded shared total', async () => {
  const sent = [];
  let total = 250;
  const callFunction = ({ name, data }) => {
    assert.equal(name, 'wishLike');
    if (data.action === 'add') { sent.push(data.count); total += data.count; }
    return { result: { success: true, total } };
  };
  const tick = ms => new Promise(resolve => setTimeout(resolve, ms || 0));
  const f = fixture('records', { recordsLocked: true, callFunction });
  const toasts = []; f.wx.showToast = t => toasts.push(t.title);
  f.wx.setStorageSync('recordsWishLikes', 7);   // 旧版本存的累计数字：按今天 0 次处理
  f.page.onLoad(); await tick();
  assert.deepEqual(f.calls.filter(n => n === 'wishLike').length, 1, 'total is read once on load');
  assert.equal(f.page.data.wishLikes, 0);
  assert.equal(f.page.data.wishTotalText, '200+');
  f.page.onWishLike(); const first = f.page.data.likePop;
  f.page.onWishLike(); const second = f.page.data.likePop;
  f.page.onWishLike();
  assert.notEqual(first, second);
  assert.equal(f.page.data.likeBursts.length, 3);
  assert.deepEqual(sent, [], 'taps are not uploaded one by one');
  f.page.onHide(); await tick();
  assert.deepEqual(sent, [3], 'leaving the tab flushes pending taps in one call');
  for (let i = 0; i < 9; i++) f.page.onWishLike();
  assert.equal(f.page.data.wishLikes, 10);
  assert.equal(toasts.length, 2, 'taps past the daily limit only show a friendly tip');
  await tick(20);
  assert.deepEqual(sent, [3, 7], 'reaching the limit flushes immediately');
  assert.equal(f.page.data.wishTotalText, '200+');
  await tick(950);
  assert.equal(f.page.data.likeBursts.length, 0);
  f.page.onUnload(); await tick();
  assert.deepEqual(sent, [3, 7], 'nothing pending, nothing sent');

  const again = fixture('records', { recordsLocked: true, callFunction });
  again.wx.setStorageSync('recordsWishLikes', f.wx.getStorageSync('recordsWishLikes'));
  again.wx.setStorageSync('recordsWishTotal', f.wx.getStorageSync('recordsWishTotal'));
  again.page.onLoad(); await tick();
  assert.equal(again.calls.filter(n => n === 'wishLike').length, 0, 'same-day total comes from cache');
  assert.equal(again.page.data.wishLikes, 10);
  again.page.onUnload();
  const wl = require('../utils/wishLike');
  assert.deepEqual([0, 99, 199, 200, 1234].map(wl.formatTotal), ['100+', '100+', '100+', '200+', '1200+']);
});

test('locked records demo loads real posters once and reuses them', async () => {
  const queries = [];
  const docs = {
    movies: [{ title: '肖申克的救赎', cover: 'cloud://m1' }, { title: '霸王别姬', cover: 'cloud://m2' }, { title: '阿甘正传', cover: 'cloud://m3' }, { title: '千与千寻', cover: 'cloud://m4' }],
    douban_books: [{ title: '红楼梦', cover: 'cloud://b1' }],
    scenic_5a: [{ name: '故宫博物院', shortName: '故宫', cover: 'cloud://s1', province: '北京', city: '北京' }]
  };
  const database = { command: { neq: x => x, in: x => x }, collection: name => {
    const q = { where() { return q; }, field() { return q; }, limit() { return q; }, get: async () => { queries.push(name); return { data: docs[name] || [] }; } };
    return q;
  } };
  const f = fixture('records', { recordsLocked: true, database });
  f.page.onLoad(); f.page.onShow();
  for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve));
  const rows = f.page.data.timelineRows;
  assert.equal(rows[0].items[0].cover, 'cloud://m1');
  assert.equal(rows[1].items[0].cover, 'cloud://b1');
  assert.deepEqual(Array.from(rows[2].items, i => i.cover), ['cloud://m2', 'cloud://m3', 'cloud://m4']);
  assert.equal(rows[3].summary, '打卡了故宫');
  assert.equal(rows[3].items[0].cover, 'cloud://s1');
  assert.equal(queries.length, 3);
  const again = fixture('records', { recordsLocked: true, database });
  again.wx.setStorageSync('recordsDemoCoversV1', f.wx.getStorageSync('recordsDemoCoversV1'));
  again.page.onLoad();
  for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(queries.length, 3, 'complete cache is never queried again');
  assert.equal(again.page.data.timelineRows[2].items[0].cover, 'cloud://m2');
});

test('cached covers are present in the very first rendered lists, and unchanged covers cause no re-render', async () => {
  const cover = 'cloud://cover-douban.jpg';
  const docs = { movies: [{ cover }] };
  const database = { command: { neq: x => x, in: x => x }, collection: name => {
    const q = { where() { return q; }, field() { return q; }, limit() { return q; }, orderBy() { return q; }, get: async () => ({ data: name === 'movies' ? docs.movies : [] }) };
    return q;
  } };
  const f = fixture('home', { database });
  f.wx.setStorageSync('categoryDynCovers', { douban_movies: cover });
  const patches = [];
  const setData = f.page.setData;
  f.page.setData = function (patch) { patches.push(Object.keys(patch)); return setData.call(this, patch); };
  const firstLists = [];
  const filter = f.page.filterThemes;
  f.page.filterThemes = function (tab) { if (!firstLists.length) firstLists.push(this.data.themes.find(t => t.id === 'douban_movies')); return filter.call(this, tab); };
  f.page.onLoad();
  assert.equal(firstLists[0].dynamicCover && firstLists[0].dynamicCover.cover, cover, 'first list render already has the cached cover');
  for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); // 先让 onLoad 排在 nextTick 的加载跑完
  const before = patches.length;
  await f.page.loadDynamicCovers();
  assert.equal(patches.slice(before).filter(k => k.includes('themes')).length, 0, 'same covers do not trigger another render');
});

test('discover custom section loads own lists once and routes open, manage and create', async () => {
  const requests = []; let fail = true;
  const f = fixture('discover', {
    callFunction: req => { if (req.name !== 'customList') return { result: { success: false } }; requests.push(req.data); return fail ? { result: { success: false, error: '网络异常，请重试' } } : { result: { success: true, quota: { movie: 1, book: 1 }, lists: [{ _id: 'l1', type: 'movie', title: '周末片单', count: 3, covers: ['cloud://a.jpg'] }] } }; }
  });
  f.page.onLoad(); f.page.onShow(); await new Promise(setImmediate);
  assert.equal(requests.length, 0, 'lists and daily sections never read custom lists');
  f.page.onDiscoverSection({ currentTarget: { dataset: { section: 'custom' } } });
  assert.equal(f.page.data.customState, 'loading');
  await f.page.loadCustomLists();
  assert.equal(f.page.data.customState, 'error');
  assert.equal(f.page.data.customError, '网络异常，请重试');
  fail = false;
  await Promise.all([f.page.loadCustomLists(), f.page.loadCustomLists()]);
  assert.equal(requests.length, 2, 'concurrent reloads share one request');
  assert.equal(requests[1].action, 'mine');
  assert.equal(f.page.data.customState, 'ready');
  const [movie, book] = f.page.data.customCards;
  assert.equal(movie.list.title, '周末片单');
  assert.equal(book.list, null); assert.equal(book.canCreate, true);
  const tap = type => ({ currentTarget: { dataset: { type } } });
  f.page.onCustomOpen(tap('movie')); f.page.onCustomEdit(tap('movie')); f.page.onCustomOpen(tap('book'));
  assert.deepEqual(f.navigations.map(n => n.url), ['/pages/genericList/list/list?theme=customMovie&listId=l1&title=' + encodeURIComponent('周末片单'), '/pages/customList/edit/edit?listId=l1']);
  f.page.onCustomCreate(tap('book')); f.page.onCustomCreate(tap('movie'));
  assert.equal(f.navigations[2].url, '/pages/customList/info/info?type=book', 'create goes to the name + description form; an existing list cannot be created again');
  assert.equal(f.navigations.length, 3);
  // 回到分类页时静默刷新：失败不清掉已有卡片
  fail = true; f.page.onShow(); await f.page.loadCustomLists();
  assert.equal(f.page.data.customState, 'ready');
  assert.equal(f.page.data.customCards[0].list.title, '周末片单');
  assert.equal(requests.length, 3);
});

test('discover tab ad hangs under the section tabs only on the discover page and hides on error', async () => {
  const units = { discover_tab_native: 'adunit-tab', home_top_native: 'adunit-top', category_native: 'adunit-native' };
  const d = fixture('discover', { adUnits: units }); d.page.onLoad(); d.page.onShow(); await new Promise(setImmediate);
  assert.equal(d.page.data.showDiscoverAd, true);
  assert.equal(d.page.data.adUnitIds.discover_tab_native, 'adunit-tab');
  assert.equal(d.page.data.discoverAdReady, false, 'no outline until the ad has rendered');
  assert.equal(d.page.data.showTopAd, false); assert.equal(d.page.data.showNativeAd, false);
  d.page.onDiscoverAdLoad();
  assert.equal(d.page.data.discoverAdReady, true);
  for (const section of ['daily', 'custom', 'lists']) { d.page.onDiscoverSection({ currentTarget: { dataset: { section } } }); assert.equal(d.page.data.showDiscoverAd, true, section + ' keeps the same ad'); }
  d.page.onDiscoverAdError();
  assert.equal(d.page.data.showDiscoverAd, false); assert.equal(d.page.data.discoverAdReady, false);
  for (const kind of ['home', 'records', 'profile']) {
    const f = fixture(kind, { adUnits: units }); f.page.onLoad(); f.page.onShow(); await new Promise(setImmediate);
    assert.equal(f.page.data.showDiscoverAd, false, kind + ' never shows the discover tab ad');
  }
  const none = fixture('discover'); none.page.onLoad(); none.page.onShow(); await new Promise(setImmediate);
  assert.equal(none.page.data.showDiscoverAd, false, 'ad-free or disabled placement renders nothing');
});

test('profile ad sits under the avatar card only on the profile page and hides on error', async () => {
  const units = { profile_top_native: 'adunit-profile', discover_tab_native: 'adunit-tab', home_top_native: 'adunit-top', category_native: 'adunit-native' };
  const p = fixture('profile', { adUnits: units }); p.page.onLoad(); p.page.onShow(); await new Promise(setImmediate);
  assert.equal(p.page.data.showProfileAd, true);
  assert.equal(p.page.data.adUnitIds.profile_top_native, 'adunit-profile');
  assert.equal(p.page.data.profileAdReady, false);
  assert.equal(p.page.data.showDiscoverAd, false); assert.equal(p.page.data.showTopAd, false);
  p.page.onProfileAdLoad(); assert.equal(p.page.data.profileAdReady, true);
  p.page.onProfileAdError();
  assert.equal(p.page.data.showProfileAd, false); assert.equal(p.page.data.profileAdReady, false);
  for (const kind of ['home', 'discover', 'records']) {
    const f = fixture(kind, { adUnits: units }); f.page.onLoad(); f.page.onShow(); await new Promise(setImmediate);
    assert.equal(f.page.data.showProfileAd, false, kind + ' never shows the profile ad');
  }
});

test('home ad-free tip offers a video, grants 30 minutes only when watched and hides every hub ad', async () => {
  const units = { adfree_pass_rewarded: 'adunit-reward', home_top_native: 'adunit-top', category_native: 'adunit-native' };
  const open = async (kind, opts) => { const f = fixture(kind, { adUnits: units, ...opts }); f.page.onLoad(); f.page.onShow(); await new Promise(setImmediate); return f; };
  let outcome = 'failed';
  const f = await open('home', { rewardOutcome: () => outcome });
  assert.equal(f.page.data.showAdFreeTip, true);
  assert.equal(f.page.data.adFreePassUntilText, '');
  assert.equal(f.page.data.showTopAd, true);

  await f.page.onWatchAdFreeVideo();
  assert.deepEqual({ ...f.rewards[0] }, { placement: 'adfree_pass_rewarded', toast: '看完视频才能生效' });
  assert.equal(f.pass.until, 0, 'no fill grants nothing');
  assert.equal(f.toasts.at(-1), '暂时没有可播放的视频，请稍后再试');

  outcome = 'abandoned'; const toastCount = f.toasts.length;
  await f.page.onWatchAdFreeVideo();
  assert.equal(f.pass.until, 0, 'closing the video early grants nothing');
  assert.equal(f.toasts.length, toastCount, 'the manager already told the user why');

  outcome = 'watched';
  await f.page.onWatchAdFreeVideo();
  assert.ok(f.pass.until > Date.now() + 29 * 60000);
  assert.equal(f.page.data.showTopAd, false); assert.equal(f.page.data.showNativeAd, false);
  assert.equal(f.page.data.showAdFreeTip, true);
  assert.match(f.page.data.adFreePassUntilText, /^\d\d:\d\d$/);
  assert.equal(f.toasts.at(-1), '页面广告已关闭 30 分钟');
  assert.deepEqual(f.tracked.filter(t => t.name === 'adfree_pass').map(t => t.data.result), ['failed', 'abandoned', 'watched']);
  await f.page.onWatchAdFreeVideo();
  assert.equal(f.rewards.length, 3, 'no second video while the pass is running');
  f.page.onUnload();

  // 冷启动时通行证仍在：直接是「HH:MM 前不再展示」，广告不出
  const live = await open('home', { passUntil: Date.now() + 10 * 60000 });
  assert.equal(live.page.data.showAdFreeTip, true); assert.ok(live.page.data.adFreePassUntilText);
  assert.equal(live.page.data.showTopAd, false);
  live.page.onUnload();
  // 会员 / 激励位关停 / 非首页：都不出 tips 条
  for (const [kind, opts] of [['home', { vip: true }], ['home', { adUnits: { home_top_native: 'adunit-top' } }], ['discover', {}], ['profile', {}]]) {
    const g = await open(kind, opts);
    assert.equal(g.page.data.showAdFreeTip, false, kind + ' ' + JSON.stringify(opts));
    g.page.onUnload();
  }
});

test('when the pass runs out the page restores its ads and the offer by itself', async () => {
  const units = { adfree_pass_rewarded: 'adunit-reward', home_top_native: 'adunit-top' };
  const f = fixture('home', { adUnits: units, passUntil: Date.now() + 400 }); f.page.onLoad(); f.page.onShow(); await new Promise(setImmediate);
  assert.equal(f.page.data.showTopAd, false); assert.ok(f.page.data.adFreePassUntilText);
  await new Promise(r => setTimeout(r, 1700));
  assert.equal(f.page.data.showTopAd, true);
  assert.equal(f.page.data.adFreePassUntilText, '');
  assert.equal(f.page.data.showAdFreeTip, true);
  // 卸载后定时器清掉，不再 setData
  const g = fixture('discover', { adUnits: { discover_tab_native: 'adunit-tab' }, passUntil: Date.now() + 400 }); g.page.onLoad(); g.page.onShow(); await new Promise(setImmediate);
  assert.equal(g.page.data.showDiscoverAd, false);
  g.page.onUnload();
  await new Promise(r => setTimeout(r, 1700));
  assert.equal(g.page.data.showDiscoverAd, false);
});

test('the tip question mark lists the ads the 30 minutes do not cover', async () => {
  let modal = null;
  const f = fixture('home', { adUnits: { adfree_pass_rewarded: 'adunit-reward' }, showModal: a => { modal = a; } });
  f.page.onLoad(); f.page.onShow(); await new Promise(setImmediate);
  f.page.onAdFreeHelp();
  assert.equal(modal.title, '30 分钟无页面广告');
  assert.equal(modal.showCancel, false);
  assert.equal(modal.content, '页面上的广告、弹出的广告都会暂停\n打开小程序时的开屏广告照常显示\n保存海报、填字换提示仍需看视频');
  const lines = modal.content.split('\n');
  assert.ok(lines.every(line => line.length <= 18), 'short lines that read well centered');
  assert.ok(Math.max(...lines.map(l => l.length)) - Math.min(...lines.map(l => l.length)) <= 2, 'lines of similar length look even when centered');
  assert.ok(!/横幅|原生|插屏|封面/.test(modal.content), 'no ad-industry jargon');
  assert.equal(f.rewards.length, 0, 'asking never starts a video');
  f.page.onUnload();
});

test('tab pages leave room for the fixed custom tab bar so the last content can scroll into view', () => {
  const bar = fs.readFileSync(path.join(root, 'custom-tab-bar/index.wxss'), 'utf8');
  const hub = fs.readFileSync(path.join(root, 'styles/hub.wxss'), 'utf8');
  assert.match(bar, /\.tab-bar\s*\{[^}]*position:\s*fixed/, 'the custom tab bar floats over the page');
  const barHeight = bar.match(/\.tab-bar\s*\{[^}]*?\bheight:\s*(\d+px)/)[1];
  const rootRule = hub.match(/\.hub-root\s*\{([^}]*)\}/)[1];
  assert.equal(rootRule.match(/--hub-tabbar-h:\s*(\d+px)/)[1], barHeight, 'reserved height matches the tab bar');
  const padding = rootRule.match(/padding:\s*([^;]+);/)[1];
  assert.ok(padding.includes('var(--hub-tabbar-h)') && padding.includes('env(safe-area-inset-bottom)'), padding);
  assert.match(bar, /padding-bottom:\s*env\(safe-area-inset-bottom\)/);
});
test('custom tab bar hides while a hub sheet or modal is open (it is drawn above the page)', async () => {
  const f = fixture('profile');
  const hidden = [];
  f.page.getTabBar = () => ({ sync() {}, setHidden: h => hidden.push(h) });
  f.page.onLoad(); f.page.onShow();
  await new Promise(resolve => setImmediate(resolve));
  hidden.length = 0;
  f.page.syncMemberCode = () => {};                      // 打开主题面板会顺手刷会员码，夹具里没有这条云调用
  f.page.onToggleThemePicker();
  f.page.onToggleThemePicker();
  f.page.onOpenPinManager();
  f.page.onClosePinManager();
  f.page.onOpenRequestModal();
  f.page.onCloseRequestModal();
  assert.deepEqual(hidden, [true, false, true, false, true, false]);
  f.page.onUnload();
});
test('discover: switching the left category or the top section clears the selected quick tag, but keeps typed search', async () => {
  const f = fixture('discover');
  f.page.onLoad(); f.page.onShow();
  await new Promise(resolve => setImmediate(resolve));
  const tag = id => ({ currentTarget: { dataset: { keyword: id } } });
  f.page.onSearchKeywordTap(tag('豆瓣'));
  assert.equal(f.page.data.searchQuery, '豆瓣');
  f.page.onTabTap({ currentTarget: { dataset: { tab: 'movie' } } });
  assert.equal(f.page.data.activeTab, 'movie');
  assert.equal(f.page.data.searchQuery, '', 'left category clears the tag');
  f.page.onSearchKeywordTap(tag('豆瓣'));
  f.page.onDiscoverSection({ currentTarget: { dataset: { section: 'daily' } } });
  assert.equal(f.page.data.searchQuery, '', 'top section clears the tag');
  f.page.onDiscoverSection({ currentTarget: { dataset: { section: 'lists' } } });
  f.page.onSearchInput({ detail: { value: '东野' } });
  f.page.onTabTap({ currentTarget: { dataset: { tab: 'reading' } } });
  assert.equal(f.page.data.searchQuery, '东野', 'typed search is not a tag and stays');
  f.page.onUnload();
});
