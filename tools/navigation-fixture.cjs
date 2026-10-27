// Runs the real page factory with a small Mini Program host for offline render tests.
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.resolve(__dirname, '..');
module.exports = function createFixture(kind, options = {}) {
  const model = require('../utils/hubModel');
  const catalog = require('../utils/themeCatalog');
  const memory = new Map([['categoryPinnedIds', ['douban_movies', 'daily_read']]]);
  const navigations = [], calls = [], errors = [], tracked = [], rewards = [], toasts = [];
  // 广告配置桩：与真实 getPlacement 一样——会员全关；限时通行证只关页面广告，*_rewarded 激励位照旧
  const pass = { until: options.passUntil || 0 };
  const passUntil = () => (pass.until > Date.now() ? pass.until : 0);
  const adConfig = {
    isAdFree: () => !!options.vip, getVipExpireAt: () => null,
    getAdUnitId: k => (options.vip || (passUntil() && !/_rewarded$/.test(k)) ? '' : (options.adUnits && options.adUnits[k]) || ''),
    getAdFreePassUntil: passUntil, isAdFreePassActive: () => !!passUntil(),
    grantAdFreePass: () => { pass.until = Date.now() + 30 * 60000; return pass.until; }
  };
  const app = { globalData: { theme: options.theme == null ? 'theme-green' : options.theme } };
  const stats = options.offline ? null : { generatedAt: Date.now(), rows: Object.fromEntries(catalog.filter(model.isList).map((t,i) => [t.id, { users: 2700 - i * 51, total: 250, valid: true }])) };
  const rows = options.empty ? {} : { douban_movies: { total: 250, done: 32, wish: 8 } };
  if (options.partial && stats) {
    delete stats.rows.douban_movies;
    delete stats.rows.imdb_movies;
  }
  let intent = options.intent;
  let page;
  const store = {
    readStats: () => stats, loadStats: async () => stats,
    readHistory: () => options.empty ? [] : [{ id: 'douban', at: Date.now() }],
    loadSummary: async () => { calls.push('summary'); if (options.offline) throw new Error('offline'); return { rows }; },
    takeIntent: () => { const data = intent; intent = null; return data; },
    switchTo: (kind,data) => navigations.push({ kind,data }), applyTabStyle() {}, invalidateSummary() {}, remember() {}
  };
  const cloudQuery = { where() { return this; }, field() { return this; }, limit() { return this; }, orderBy() { return this; }, get: async () => ({ data: [] }) };
  const wx = { getStorageSync: k => memory.get(k), setStorageSync: (k,v) => memory.set(k,v), getWindowInfo: () => ({ statusBarHeight: 20 }), getMenuButtonBoundingClientRect: () => ({ top: 28 }),
    nextTick: fn => Promise.resolve().then(fn), cloud: { callFunction: async req => { calls.push(req.name); return options.callFunction ? options.callFunction(req) : { result: { success: false } }; }, database: () => (options.database || { command: { neq: x => x, in: x => x }, collection: () => cloudQuery }) },
    navigateTo: args => navigations.push(args), showToast: args => toasts.push(args.title), stopPullDownRefresh() {},
    showModal: args => { if (options.showModal) options.showModal(args); }, showLoading() {}, hideLoading() {}
  };
  const modules = {
    './markTimeline': {
      list: async () => ({ rows: options.empty ? [] : [{id:'fixture_event', theme:'douban', at: Date.now(), count:2, mode:'single', items:[{title:'肖申克的救赎',status:'watched'},{title:'霸王别姬',status:'wish'}]}], offline: !!options.offline }),
      present: require('../utils/markTimeline').present
    },
    './hubFlags': { recordsOpen: !options.recordsLocked },
    './hubIcons': require('../utils/hubIcons'),
    './wishLike': loadWishLike(),
    './hubModel': model, './hubStore': store, './themeCatalog': catalog, './hubStats': require('../utils/hubStats'),
    './track': { track: (name, data) => tracked.push({ name, data }) }, './adConfig': adConfig,
    './rewardedAdManager': { showForReward: async (placement, pg, toast) => { rewards.push({ placement, toast }); return typeof options.rewardOutcome === 'function' ? options.rewardOutcome() : (options.rewardOutcome || 'failed'); }, preload() {} },
    './openidWaiter.js': { awaitOpenid: async () => 'fixture' }, './userStore.js': { getUserInfo: () => null }, './themeRegistry.js': { readAll: () => options.cloudThemes || [], writeAll() {} },
    '../pages/customList/common.js': loadCustomListCommon()
  };
  // 自建清单共用模块同样跑在本 fixture 的 wx 上（云函数调用走 options.callFunction）
  function loadCustomListCommon() { const box = { module: { exports: {} }, require: p => require(path.join(root, 'pages/customList', p)), wx, getApp: () => app }; vm.runInNewContext(fs.readFileSync(path.join(root, 'pages/customList/common.js'), 'utf8'), box); return box.module.exports; }
  // wishLike 读写的是本 fixture 的 wx（内存 storage + 假云函数），每个 fixture 一份独立模块状态
  function loadWishLike() { const box = { module: { exports: {} }, wx }; vm.runInNewContext(fs.readFileSync(path.join(root, 'utils/wishLike.js'), 'utf8'), box); return box.module.exports; }
  const sandbox = { module: { exports: {} }, require: p => { if (!(p in modules)) throw new Error('Unexpected require ' + p); return modules[p]; }, getApp: () => app, wx, console: { log() {}, warn: (...args) => errors.push(args), error: (...args) => errors.push(args) }, setTimeout, clearTimeout };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'utils/hubPage.js'), 'utf8'), sandbox);
  page = sandbox.module.exports(kind);
  page.data = JSON.parse(JSON.stringify(page.data));
  page.setData = function(patch) { for (const [key,value] of Object.entries(patch)) { const parts = key.split('.'); let target = this.data; for (const part of parts.slice(0,-1)) target = target[part] || (target[part] = {}); target[parts[parts.length - 1]] = value; } };
  return { page, wx, app, store, calls, errors, navigations, stats, rows, tracked, rewards, toasts, pass };
};
