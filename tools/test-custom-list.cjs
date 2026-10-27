// 自建影单/书单：云函数 customList 的名称/说明语读写 + 表单页 info 的创建/修改流程（离线，内存假库）
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.resolve(__dirname, '..');

function cloudFixture({ openid = 'alice', secCheck } = {}) {
  const docs = new Map(); let seq = 0; const checked = [];
  const matches = (doc, q) => Object.entries(q).every(([k, v]) => doc[k] === v);
  const query = q => ({
    count: async () => ({ total: [...docs.values()].filter(d => matches(d, q)).length }),
    skip: () => ({ limit: () => ({ get: async () => ({ data: [...docs.values()].filter(d => matches(d, q)) }) }) }),
    update: async ({ data }) => {
      const hit = [...docs.values()].filter(d => matches(d, q));
      hit.forEach(d => Object.assign(d, data));
      return { stats: { updated: hit.length } };
    }
  });
  const db = {
    command: { in: x => x },
    createCollection: async () => {},
    collection: () => ({
      where: query,
      add: async ({ data }) => { const _id = 'list' + (++seq); docs.set(_id, { _id, ...data }); return { _id }; },
      doc: id => ({ get: async () => { if (!docs.has(id)) throw new Error('not found'); return { data: { ...docs.get(id) } }; } })
    })
  };
  const sdk = {
    init() {}, DYNAMIC_CURRENT_ENV: 'env', database: () => db, getWXContext: () => ({ OPENID: openid }),
    openapi: { security: { msgSecCheck: async args => { checked.push(args); if (secCheck) return secCheck(args); return { result: { suggest: 'pass' } }; } } }
  };
  const box = { module: { exports: {} }, require: p => (p === 'wx-server-sdk' ? sdk : p === 'axios' ? {} : require(p)), console: { log() {}, warn() {}, error() {} }, Buffer, Date };
  box.exports = box.module.exports;
  vm.runInNewContext(fs.readFileSync(path.join(root, 'cloudfunctions/customList/index.js'), 'utf8'), box);
  return { main: box.module.exports.main, docs, checked };
}

test('create stores a clipped description and returns it in mine and get', async () => {
  const f = cloudFixture();
  const created = await f.main({ action: 'create', type: 'movie', title: '  周末片单  ', description: '  ' + '好'.repeat(50) + '  ' });
  assert.equal(created.success, true);
  assert.equal(created.list.title, '周末片单');
  assert.equal(created.list.description, '好'.repeat(40));
  assert.equal(f.checked[0].content, '周末片单\n' + '好'.repeat(40));
  assert.equal(f.checked[0].openid, 'alice');
  const mine = await f.main({ action: 'mine' });
  assert.equal(mine.lists[0].description, '好'.repeat(40));
  const got = await f.main({ action: 'get', listId: created.listId });
  assert.equal(got.list.description, '好'.repeat(40));
  // 没写说明语也能建，存空串
  const book = await f.main({ action: 'create', type: 'book', title: '' });
  assert.equal(book.list.title, '我的书单');
  assert.equal(book.list.description, '');
  assert.equal(f.docs.get(book.listId).description, '');
  assert.equal((await f.main({ action: 'create', type: 'movie', title: '第二份' })).code, 'QUOTA');
});

test('rename updates description only when sent and can clear it', async () => {
  const f = cloudFixture();
  const { listId } = await f.main({ action: 'create', type: 'movie', title: '片单', description: '旧说明' });
  await f.main({ action: 'rename', listId, title: '新片单' });
  assert.equal(f.docs.get(listId).title, '新片单');
  assert.equal(f.docs.get(listId).description, '旧说明', 'legacy rename without description keeps it');
  const res = await f.main({ action: 'rename', listId, title: '新片单', description: '  新说明  ' });
  assert.deepEqual({ ...res }, { success: true, title: '新片单', description: '新说明' });
  assert.equal(f.docs.get(listId).description, '新说明');
  const rev = f.docs.get(listId).rev;
  await f.main({ action: 'rename', listId, title: '新片单', description: '新说明' });
  assert.equal(f.docs.get(listId).rev, rev, 'unchanged info does not bump rev');
  await f.main({ action: 'rename', listId, title: '新片单', description: '' });
  assert.equal(f.docs.get(listId).description, '');
  assert.equal((await f.main({ action: 'rename', listId, title: '  ', description: 'x' })).success, false);
});

test('risky text is rejected while a failing content-security call does not block users', async () => {
  const risky = cloudFixture({ secCheck: args => ({ result: { suggest: args.content.includes('违规') ? 'risky' : 'pass' } }) });
  const blocked = await risky.main({ action: 'create', type: 'movie', title: '片单', description: '违规内容' });
  assert.equal(blocked.success, false);
  assert.equal(blocked.code, 'SEC_CHECK');
  assert.equal(risky.docs.size, 0);
  const { listId } = await risky.main({ action: 'create', type: 'movie', title: '片单' });
  assert.equal((await risky.main({ action: 'rename', listId, title: '片单', description: '违规' })).code, 'SEC_CHECK');
  assert.equal(risky.docs.get(listId).description, '');
  const down = cloudFixture({ secCheck: () => { throw Object.assign(new Error('no permission'), { errCode: -604101 }); } });
  assert.equal((await down.main({ action: 'create', type: 'book', title: '书单', description: '说明' })).success, true);
  // 别人的清单改不了
  const other = cloudFixture();
  const made = await other.main({ action: 'create', type: 'movie', title: '片单' });
  other.docs.get(made.listId).openid = 'bob';
  assert.equal((await other.main({ action: 'rename', listId: made.listId, title: '抢', description: '' })).code, 'FORBIDDEN');
});

function infoPage(callResult) {
  let def; const calls = [], nav = [], toasts = [], app = { globalData: {} };
  const wx = {
    cloud: { callFunction: async req => { calls.push(req.data); return { result: callResult(req.data) }; } },
    setNavigationBarTitle: a => nav.push({ title: a.title }), redirectTo: a => nav.push({ redirect: a.url }),
    navigateBack: () => nav.push({ back: true }), showToast: a => toasts.push(a.title)
  };
  const loadCommon = () => { const box = { module: { exports: {} }, require: p => require(path.join(root, 'pages/customList', p)), wx, getApp: () => app }; vm.runInNewContext(fs.readFileSync(path.join(root, 'pages/customList/common.js'), 'utf8'), box); return box.module.exports; };
  const common = loadCommon();
  vm.runInNewContext(fs.readFileSync(path.join(root, 'pages/customList/info/info.js'), 'utf8'), { Page: d => { def = d; }, require: () => common, wx });
  const page = { ...def, data: JSON.parse(JSON.stringify(def.data)), setData(p) { Object.assign(this.data, p); } };
  return { page, calls, nav, toasts, app, common };
}

test('info form creates with name and description, then edits and returns', async () => {
  const c = infoPage(() => ({ success: true, listId: 'L9' }));
  c.page.onLoad({ type: 'book' });
  assert.equal(c.page.data.mode, 'create');
  assert.equal(c.nav[0].title, '创建书单');
  c.page.onTitleInput({ detail: { value: ' 东野圭吾 ' } });
  c.page.onDescInput({ detail: { value: ' 一本本读完 ' } });
  await c.page.onSubmit();
  assert.deepEqual({ ...c.calls[0] }, { action: 'create', type: 'book', title: '东野圭吾', description: '一本本读完' });
  assert.equal(c.nav[1].redirect, '/pages/customList/edit/edit?listId=L9&fresh=1');
  // 名称留空 → 用默认名
  const d = infoPage(() => ({ success: true, listId: 'L1' }));
  d.page.onLoad({ type: 'movie' }); await d.page.onSubmit();
  assert.equal(d.calls[0].title, '我的影单');

  const url = c.common.infoUrl({ _id: 'L9', type: 'book', title: '东野 & 圭吾', description: '说明?' });
  const e = infoPage(() => ({ success: true }));
  // 小程序 onLoad 拿到的 query 值仍是编码态，页面自己 decode
  e.page.onLoad(Object.fromEntries(url.split('?')[1].split('&').map(kv => kv.split('='))));
  assert.equal(e.page.data.mode, 'edit');
  assert.equal(e.page.data.title, '东野 & 圭吾');
  assert.equal(e.page.data.description, '说明?');
  e.page.onTitleInput({ detail: { value: '  ' } });
  await e.page.onSubmit();
  assert.equal(e.calls.length, 0, 'edit mode refuses an empty name');
  assert.equal(e.toasts[0], '书单名称不能为空');
  e.page.onTitleInput({ detail: { value: '新名字' } });
  e.page.onDescInput({ detail: { value: '' } });
  await e.page.onSubmit();
  assert.deepEqual({ ...e.calls[0] }, { action: 'rename', listId: 'L9', title: '新名字', description: '' });
  assert.ok(e.nav.some(n => n.back));
  assert.equal(e.app.globalData.customListDirty.L9, true);
});

test('a failed save shows the error and lets the user retry', async () => {
  const f = infoPage(() => ({ success: false, error: '名称或说明语含有不适宜的内容，请修改后再试' }));
  f.page.onLoad({ type: 'movie' });
  await f.page.onSubmit();
  assert.equal(f.page.data.saving, false);
  assert.equal(f.toasts[0], '名称或说明语含有不适宜的内容，请修改后再试');
  assert.ok(!f.nav.some(n => n.redirect));
});

test('a custom list is readable only by its creator', async () => {
  const f = cloudFixture({ openid: 'alice' });
  const { listId } = await f.main({ action: 'create', type: 'movie', title: '私人片单', description: '只给自己看' });
  f.docs.get(listId).items = [{ _id: 'douban_1', title: '霸王别姬', year: '1993' }];
  const mine = await f.main({ action: 'get', listId, openid: 'alice' });
  assert.equal(mine.success, true);
  assert.equal(mine.movies.length, 1);
  assert.equal(mine.list.isOwner, true);
  // 别人拿着 listId：不给条目、不给元信息，提示与「不存在」同一条
  f.docs.get(listId).openid = 'bob';
  for (const event of [{ action: 'get', listId, openid: 'alice' }, { listId }, { action: 'get', listId, marksOnly: true }]) {
    const res = await f.main(event);
    assert.equal(res.success, false);
    assert.equal(res.code, 'PRIVATE');
    assert.deepEqual([...res.movies], []); assert.deepEqual([...res.marks], []);
    assert.equal(res.list, undefined);
    assert.ok(!JSON.stringify(res).includes('霸王别姬') && !JSON.stringify(res).includes('私人片单'));
  }
  // 没有身份（OPENID 为空）同样读不到
  const anon = cloudFixture({ openid: '' });
  const made = await f.main({ action: 'create', type: 'book', title: '书单' });
  anon.docs.set(made.listId, { ...f.docs.get(made.listId) });
  assert.equal((await anon.main({ action: 'get', listId: made.listId })).code, 'PRIVATE');
  assert.equal((await f.main({ action: 'get', listId: 'nope' })).code, 'NOT_FOUND');
});

test('list and poster pages never share a custom list link', () => {
  for (const page of ['genericList', 'genericBookList']) {
    const list = fs.readFileSync(path.join(root, `pages/${page}/list/list.js`), 'utf8');
    assert.match(list, /if \(cfg\.custom && wx\.hideShareMenu\) wx\.hideShareMenu/);
    assert.match(list, /if \(this\.data\.cfg\.custom\) return \{ title: '标记吧', path: '\/pages\/category\/category' \}/);
    assert.match(list, /if \(this\.data\.cfg\.custom\) return \{ title: '标记吧', query: '' \}/);
    const share = fs.readFileSync(path.join(root, `pages/${page}/share/share.js`), 'utf8');
    assert.match(share, /if \(listId && wx\.hideShareMenu\) wx\.hideShareMenu/);
    assert.match(share, /path: this\._listId \? '\/pages\/category\/category'/);
    // 只看转发函数本身；返回列表页的 reLaunch 是本人站内跳转，带 listId 是对的
    const shareFn = share.slice(share.indexOf('onShareAppMessage()'), share.indexOf('onUnload()'));
    assert.ok(shareFn.length > 0 && !shareFn.includes('listId='), page + ' poster share never carries listId');
  }
});
