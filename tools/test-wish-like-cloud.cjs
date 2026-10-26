// wishLike 云函数离线测试：内存版数据库，验证每日上限、总数累加、集合不存在时自动创建。
const assert = require('assert'), Module = require('module'), path = require('path');
const docs = new Map(); let collectionExists = false, openid = 'u1';
const notExist = () => Object.assign(new Error('collection not exist'), { errMsg: 'DATABASE_COLLECTION_NOT_EXIST' });
const db = {
  command: { inc: n => ({ $inc: n }) }, serverDate: () => 'now',
  createCollection: async () => { collectionExists = true; },
  collection: () => ({ doc: id => ({
    get: async () => { if (!collectionExists) throw notExist(); if (!docs.has(id)) throw Object.assign(new Error('document not exist'), { errMsg: 'document.get:fail document not exist' }); return { data: docs.get(id) }; },
    set: async ({ data }) => { if (!collectionExists) throw notExist(); docs.set(id, { ...data }); },
    update: async ({ data }) => { if (!collectionExists) throw notExist(); if (!docs.has(id)) return { stats: { updated: 0 } };
      const d = docs.get(id); for (const [k, v] of Object.entries(data)) d[k] = v && v.$inc ? (d[k] || 0) + v.$inc : v; return { stats: { updated: 1 } }; }
  }) })
};
const sdk = { init() {}, DYNAMIC_CURRENT_ENV: 'env', database: () => db, getWXContext: () => ({ OPENID: openid }) };
const load = Module._load; Module._load = (req, ...rest) => req === 'wx-server-sdk' ? sdk : load(req, ...rest);
const { main } = require(path.join(__dirname, '../cloudfunctions/wishLike/index.js'));
(async () => {
  assert.deepEqual(await main({ action: 'get' }), { success: true, total: 0 });
  let r = await main({ action: 'add', count: 6 });
  assert.equal(collectionExists, true);
  assert.deepEqual([r.accepted, r.used, r.total], [6, 6, 6]);
  r = await main({ action: 'add', count: 9 });
  assert.deepEqual([r.accepted, r.used, r.total], [4, 10, 10], 'capped at 10 per user per day');
  r = await main({ action: 'add', count: 1 });
  assert.deepEqual([r.accepted, r.total], [0, 10]);
  openid = 'u2';
  r = await main({ action: 'add', count: 500 });
  assert.deepEqual([r.accepted, r.total], [10, 20], 'oversized counts are clamped');
  assert.deepEqual(await main({ action: 'add', count: 0 }), { success: false });
  assert.deepEqual(await main({ action: 'get', topic: 'whatever' }), { success: true, total: 20 });
  console.log('PASS wishLike cloud function (6 checks)');
})().catch(e => { console.error('FAIL', e); process.exit(1); });
