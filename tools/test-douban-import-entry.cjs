// node --test tools/test-douban-import-entry.cjs
// 豆瓣 TOP250 列表页「批量标记 / 从豆瓣导入」入口：未登录也显示，点击时才引导登录；导入入口仍受灰度控制。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');
const grayBucket = require('../utils/grayBucket');

function loadPage({ stored = null, deviceOpenid = '', percent = 0, forced = [] } = {}) {
  let page; const calls = { nav: [], toast: [], profile: 0 };
  const adConfig = {
    isForcedIntoGray: (name, openid) => name === 'douban_import' && forced.includes(openid),
    getGrayPercentage: name => (name === 'douban_import' ? percent : 0),
    getAdUnitId: () => '', isAdFree: () => false, onRemoteApplied() {}, offRemoteApplied() {}
  };
  const context = { Page: p => { page = p; }, console, setTimeout, clearTimeout,
    getApp: () => ({ globalData: { openid: deviceOpenid } }),
    require: p => p.includes('adConfig') ? adConfig : p.includes('grayBucket') ? grayBucket
      : p.includes('userStore') ? { getUserInfo: () => stored } : {},
    wx: { navigateTo: a => calls.nav.push(a.url), showToast: a => calls.toast.push(a.title) } };
  vm.runInNewContext(fs.readFileSync('pages/douban/list/list.js', 'utf8').replace(/^import .*;\r?\n/gm, ''), context);
  page.setData = function (patch) { Object.assign(this.data, patch); };
  page.onGetUserProfile = () => { calls.profile++; };
  return { page, calls };
}

test('logged-out users still see the import entry when their device openid is in the gray rollout', () => {
  const inside = loadPage({ deviceOpenid: 'o_dev', forced: ['o_dev'] });
  inside.page.checkLoginStatus();
  assert.equal(inside.page.data.userInfo, null);
  assert.equal(inside.page.data.doubanImportIn, true);
  const outside = loadPage({ deviceOpenid: 'o_dev', percent: 0 });
  outside.page.checkLoginStatus();
  assert.equal(outside.page.data.doubanImportIn, false, 'rollout 0 keeps it hidden for everyone');
  const noOpenidYet = loadPage({ deviceOpenid: '', percent: 50 });
  noOpenidYet.page.checkLoginStatus();
  assert.equal(noOpenidYet.page.data.doubanImportIn, false, 'partial rollout and no openid yet: wait for it instead of guessing');
  const everyone = loadPage({ deviceOpenid: '', percent: 100 });
  everyone.page.checkLoginStatus();
  assert.equal(everyone.page.data.doubanImportIn, true, 'full rollout shows at once, no openid needed');
});

test('percentage rollout buckets logged-out and logged-in users by the same openid', () => {
  const pick = want => { for (let i = 0; i < 1000; i++) { const id = 'o_' + i; if (grayBucket.isInBucket(id, 50) === want) return id; } };
  for (const want of [true, false]) {
    const id = pick(want);
    const out = loadPage({ deviceOpenid: id, percent: 50 });
    out.page.checkLoginStatus();
    const inn = loadPage({ stored: { _openid: id, nickName: 'x' }, deviceOpenid: id, percent: 50 });
    inn.page.checkLoginStatus();
    assert.equal(out.page.data.doubanImportIn, want);
    assert.equal(inn.page.data.doubanImportIn, want);
  }
});

test('tapping 从豆瓣导入 logged out asks for login instead of opening the page; logged in opens it', () => {
  const out = loadPage({ deviceOpenid: 'o_dev', forced: ['o_dev'] });
  out.page.checkLoginStatus(); out.page.onOpenDoubanImport();
  assert.deepEqual(out.calls.nav, []);
  assert.deepEqual(out.calls.toast, ['请先完成登录']);
  assert.equal(out.calls.profile, 1);
  const inn = loadPage({ stored: { _openid: 'o_me', nickName: 'x' }, forced: ['o_me'] });
  inn.page.checkLoginStatus(); inn.page.data.userInfo = { _openid: 'o_me' }; inn.page.onOpenDoubanImport();
  assert.deepEqual(inn.calls.nav, ['/pages/doubanImport/index']);
  assert.equal(inn.calls.profile, 0);
});

test('批量标记 logged out also asks for login (the whole action row is no longer hidden)', () => {
  const out = loadPage({ deviceOpenid: 'o_dev' });
  out.page.onStartBatchEdit();
  assert.equal(out.calls.profile, 1);
  assert.notEqual(out.page.data.isBatchEditing, true);
});

test('wxml: the action row and 批量标记 are not gated by userInfo; the import button is gated only by the rollout flag', () => {
  const wxml = fs.readFileSync('pages/douban/list/list.wxml', 'utf8');
  assert.match(wxml, /<view class="batch-options">/);
  assert.match(wxml, /<view class="icon-btn batch-icon" bindtap="onStartBatchEdit">批量标记<\/view>/);
  assert.match(wxml, /<view wx:if="\{\{doubanImportIn\}\}" class="icon-btn batch-icon" bindtap="onOpenDoubanImport">从豆瓣导入<\/view>/);
});
