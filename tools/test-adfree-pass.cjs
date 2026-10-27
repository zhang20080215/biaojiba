// 看视频换 30 分钟不展示页面广告：通行证存取 / 到期、只关页面广告（激励位与保存闸门照旧），
// 以及 rewardedAdManager.showForReward 只在「完整看完」时才算数（真模块 + 假激励视频 SDK）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.resolve(__dirname, '..');

// 最小 CommonJS 加载器：utils/ 下的模块都跑在同一个假 wx 上，模块缓存按 sandbox 独立
function sandbox({ storage = new Map(), sdk = null, pages = [] } = {}) {
  const toasts = [], tracked = [];
  const wx = {
    getStorageSync: k => storage.get(k), setStorageSync: (k, v) => storage.set(k, v), removeStorageSync: k => storage.delete(k),
    showToast: a => toasts.push(a.title), showLoading() {}, hideLoading() {},
    cloud: { callFunction: async () => ({ result: { success: false } }), database: () => ({ collection: () => ({ where() { return this; }, get: async () => ({ data: [] }) }) }) },
    getStorageInfoSync: () => ({ keys: [...storage.keys()] }),
    createRewardedVideoAd: sdk ? sdk.create : undefined
  };
  const cache = {};
  const stubs = { './track': { track: (name, data) => tracked.push({ name, data }) } };
  function load(file) {
    if (cache[file]) return cache[file].exports;
    const mod = { exports: {} }; cache[file] = mod;
    const dir = path.dirname(file);
    const req = p => {
      if (stubs[p]) return stubs[p];
      const target = path.join(dir, p.endsWith('.js') ? p : p + '.js');
      return load(target);
    };
    vm.runInNewContext(fs.readFileSync(file, 'utf8'), { module: mod, exports: mod.exports, require: req, wx, console: { log() {}, warn() {}, error() {} }, setTimeout, clearTimeout, Date, Promise, getCurrentPages: () => pages, getApp: () => ({ globalData: {} }) });
    return mod.exports;
  }
  return { load: rel => load(path.join(root, rel)), storage, toasts, tracked, wx };
}

test('pass is granted for 30 minutes, persisted, restored and expires with one notification', () => {
  const s = sandbox();
  const pass = s.load('utils/adFreePass.js');
  const events = []; pass.onChange(a => events.push(a));
  assert.equal(pass.isActive(), false); assert.equal(pass.getUntil(), 0);
  const before = Date.now(); const until = pass.grant();
  assert.ok(until - before >= 30 * 60000 && until - before < 30 * 60000 + 1000);
  assert.equal(pass.isActive(), true); assert.equal(pass.getUntil(), until);
  assert.equal(s.storage.get('ad_free_pass').until, until);
  assert.deepEqual(events, [true]);
  // 冷启动从 storage 恢复；过期的不恢复
  assert.equal(sandbox({ storage: new Map([['ad_free_pass', { until }]]) }).load('utils/adFreePass.js').isActive(), true);
  assert.equal(sandbox({ storage: new Map([['ad_free_pass', { until: Date.now() - 1 }]]) }).load('utils/adFreePass.js').isActive(), false);
  // 到期：惰性判定，清 storage，只通知一次
  const store = new Map([['ad_free_pass', { until: Date.now() + 30 }]]);
  const t = sandbox({ storage: store }).load('utils/adFreePass.js');
  const off = []; t.onChange(a => off.push(a));
  assert.equal(t.isActive(), true);
  return new Promise(r => setTimeout(r, 60)).then(() => {
    assert.equal(t.isActive(), false); assert.equal(t.isActive(), false);
    assert.deepEqual(off, [false]); assert.equal(store.has('ad_free_pass'), false);
  });
});

test('an active pass closes page ads only: rewarded slots and the poster save gate keep running, VIP untouched', () => {
  const s = sandbox();
  const adConfig = s.load('utils/adConfig.js');
  const gate = s.load('utils/rewardedSaveGate.js');
  const forced = 'ozCMC7vB3JQinqbeqyXzY_7TwSMo'; // 本地默认配置里的保存闸门灰度白名单
  assert.ok(adConfig.getAdUnitId('discover_tab_native'));
  assert.ok(adConfig.getAdUnitId('adfree_pass_rewarded'));
  assert.equal(gate.isGated(forced), true);
  adConfig.grantAdFreePass();
  for (const k of ['category_native', 'home_top_native', 'discover_tab_native', 'profile_top_native', 'daily_movie_banner', 'share_banner', 'share_interstitial']) assert.equal(adConfig.getAdUnitId(k), null, k);
  for (const k of ['save_image_rewarded', 'adfree_pass_rewarded', 'guess_extra_rewarded']) assert.ok(adConfig.getAdUnitId(k), k + ' keeps running');
  assert.equal(gate.isGated(forced), true, 'saving a poster still asks for a video during the pass');
  assert.equal(adConfig.isAdFree(), false, 'VIP badge / 会员已开通 stay off');
  assert.equal(adConfig.getVipExpireAt(), null);
  assert.ok(adConfig.isAdFreePassActive());
});

// 假激励视频 SDK：同一 adUnitId 单例；show 的结局由测试决定
function fakeSdk() {
  const ads = {};
  const sdk = {
    shows: 0, mode: 'play',
    create: ({ adUnitId }) => {
      if (ads[adUnitId]) return ads[adUnitId];
      const h = { load: [], error: [], close: [] };
      const ad = {
        onLoad: f => h.load.push(f), onError: f => h.error.push(f), onClose: f => h.close.push(f),
        load: () => { setTimeout(() => h.load.forEach(f => f()), 5); return Promise.resolve(); },
        show: () => {
          sdk.shows++;
          if (sdk.mode === 'nofill') { setTimeout(() => h.error.forEach(f => f({ errCode: 1004, errMsg: 'no ad' })), 1); return Promise.reject({ errCode: 1004 }); }
          return Promise.resolve();
        },
        destroy: () => { delete ads[adUnitId]; },
        close: res => h.close.forEach(f => f(res))
      };
      ads[adUnitId] = ad; return ad;
    },
    ad: id => ads[id]
  };
  return sdk;
}

test('showForReward only reports watched when the video reached the end', async () => {
  const sdk = fakeSdk(); const page = { route: 'pages/category/category' };
  const s = sandbox({ sdk, pages: [page] });
  const manager = s.load('utils/rewardedAdManager.js');
  const cfg = s.load('utils/adConfig.js');
  const unit = cfg.getAdUnitId('adfree_pass_rewarded'), saveUnit = cfg.getAdUnitId('save_image_rewarded');
  assert.equal(unit, 'adunit-32f974192bb5096f');
  assert.notEqual(unit, saveUnit, 'own unit, so it never shares the poster-save SDK instance');
  const until = async (fn) => { for (let i = 0; i < 200 && !fn(); i++) await new Promise(r => setTimeout(r, 10)); };

  let p = manager.showForReward('adfree_pass_rewarded', page, '看完视频才能生效');
  await until(() => sdk.shows === 1);
  sdk.ad(unit).close({ isEnded: true });
  assert.equal(await p, 'watched');

  p = manager.showForReward('adfree_pass_rewarded', page, '看完视频才能生效');
  await until(() => sdk.shows === 2);
  sdk.ad(unit).close({ isEnded: false });
  assert.equal(await p, 'abandoned');
  assert.equal(s.toasts.at(-1), '看完视频才能生效', 'own abandon text, not the poster-save one');

  // 平台无填充：show() 为了不挡存图会 resolve(true)，但发放权益必须当作失败
  sdk.mode = 'nofill';
  const plain = await manager.show('adfree_pass_rewarded', page);
  assert.equal(plain, true, 'poster-save semantics unchanged');
  assert.equal(await manager.showForReward('adfree_pass_rewarded', page), 'failed');

  // 原有保存海报路径的中途关闭提示保持原文案
  sdk.mode = 'play';
  p = manager.show('save_image_rewarded', page);
  await until(() => sdk.shows === 5);
  assert.ok(sdk.ad(saveUnit) && sdk.ad(saveUnit) !== sdk.ad(unit));
  sdk.ad(saveUnit).close({ isEnded: false });
  assert.equal(await p, false);
  assert.equal(s.toasts.at(-1), '未完整观看广告，暂无法保存');
});
