const cloud = require('wx-server-sdk');
const crypto = require('crypto');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const COLLECTION = 'MarkTimeline';
exports.main = async event => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { success: false };
  if (event.action === 'list') {
    const before = event.before;
    let where = { openid: OPENID };
    if (before && Number.isFinite(before.at) && typeof before.id === 'string') {
      where = db.command.and(where, db.command.or({ at: db.command.lt(before.at) }, { at: before.at, id: db.command.lt(before.id) }));
    }
    const result = await db.collection(COLLECTION).where(where).orderBy('at', 'desc').orderBy('id', 'desc').limit(21).get();
    const rows = result.data.slice(0, 20);
    const last = rows[rows.length - 1];
    return { success: true, rows, hasMore: result.data.length > 20, cursor: last ? { at: last.at, id: last.id } : null };
  }
  const row = event.row;
  if (event.action !== 'save' || !row || row.owner !== OPENID || !/^[a-z0-9_]{8,80}$/.test(row.id) ||
      !Number.isSafeInteger(row.revision) || row.revision < 1 || !Number.isSafeInteger(row.count) || row.count < 1 ||
      !Number.isFinite(row.at) || !Number.isFinite(row.createdAt) || !Array.isArray(row.items) || row.items.length > 1000) return { success: false };
  const text = (v, n) => String(v || '').slice(0, n);
  const data = { openid: OPENID, id: row.id, theme: text(row.theme, 100), title: text(row.title, 150),
    at: row.at, createdAt: row.createdAt, revision: row.revision, count: row.count, mode: row.mode === 'batch' ? 'batch' : 'single',
    items: row.items.map(i => {
      // 细节字段全部是客户端拼好的短文本，按长度截断即可；星级只收 1~5 的整数
      const item = { title: text(i.title, 150), cover: text(i.cover, 1500), status: text(i.status, 30) };
      if (Number.isInteger(i.stars) && i.stars >= 1 && i.stars <= 5) item.stars = i.stars;
      for (const [key, max] of [['note', 140], ['mood', 20], ['progress', 60], ['extra', 80]]) if (i[key]) item[key] = text(i[key], max);
      return item;
    }) };
  const id = crypto.createHash('sha256').update(OPENID + ':' + row.id).digest('hex');
  await db.runTransaction(async transaction => {
    let previous;
    try { const result = await transaction.collection(COLLECTION).doc(id).get(); previous = result.data; }
    catch (error) { if (!/not exist|not found|DOCUMENT_NOT_EXIST/i.test(String(error.errMsg || error.message))) throw error; }
    if (!previous || previous.revision < row.revision) await transaction.collection(COLLECTION).doc(id).set({ data });
  });
  return { success: true };
};
