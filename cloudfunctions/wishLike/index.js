// 云函数：wishLike —— 未开放功能的「期待上线」点赞计数（目前只有记录页 topic=records）
// 计的是次数不是人数：每人每天最多 LIMIT 次，超出部分服务端直接丢弃（客户端也拦，这里兜底防刷）。
// 前端攒批调用：连点在本地累加，停手或离开页面时一次 add；总数每天最多读一次。
//   { action: 'get', topic }          → { success, total }
//   { action: 'add', topic, count }   → { success, accepted, used, total }
// 集合 WishLikes：`total_<topic>` 存总数，`u_<topic>_<openid>_<日期>` 存某人当天已点次数。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
const COLLECTION = 'WishLikes';
const TOPICS = ['records'];
const LIMIT = 10;

const cnDay = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
const missing = error => /not.?exist|not.?found|-502005/i.test(String(error && [error.errCode, error.errMsg, error.message].join(' ')));

async function readDoc(id) {
  try { return (await db.collection(COLLECTION).doc(id).get()).data; }
  catch (error) { if (missing(error)) return null; throw error; }
}

async function readTotal(topic) {
  const doc = await readDoc('total_' + topic);
  return doc && Number(doc.total) || 0;
}

async function add(topic, openid, want) {
  const userId = `u_${topic}_${openid}_${cnDay()}`;
  const mine = await readDoc(userId);
  const used = mine && Number(mine.count) || 0;
  const accepted = Math.max(0, Math.min(want, LIMIT - used));
  if (!accepted) return { accepted: 0, used };
  await db.collection(COLLECTION).doc(userId).set({ data: { topic, openid, day: cnDay(), count: used + accepted, updatedAt: db.serverDate() } });
  // 总数用原子自增，不进事务：并发点赞只会互相累加，不会冲突重试
  const res = await db.collection(COLLECTION).doc('total_' + topic).update({ data: { total: _.inc(accepted), updatedAt: db.serverDate() } });
  if (!res.stats || !res.stats.updated) {
    await db.collection(COLLECTION).doc('total_' + topic).set({ data: { topic, total: accepted, updatedAt: db.serverDate() } });
  }
  return { accepted, used: used + accepted };
}

async function run(event) {
  const topic = TOPICS.includes(event.topic) ? event.topic : 'records';
  if (event.action === 'add') {
    const { OPENID } = cloud.getWXContext();
    const want = Math.floor(Number(event.count) || 0);
    if (!OPENID || want < 1) return { success: false };
    const result = await add(topic, OPENID, Math.min(want, LIMIT));
    return { success: true, ...result, total: await readTotal(topic) };
  }
  return { success: true, total: await readTotal(topic) };
}

exports.main = async event => {
  try { return await run(event || {}); }
  catch (error) {
    // 首次使用集合还不存在：建好再跑一次
    if (!missing(error)) return { success: false, error: String(error.errMsg || error.message || error) };
    try { await db.createCollection(COLLECTION); } catch (e) { /* 并发时可能已被别的实例建好 */ }
    try { return await run(event || {}); }
    catch (e) { return { success: false, error: String(e.errMsg || e.message || e) }; }
  }
};
