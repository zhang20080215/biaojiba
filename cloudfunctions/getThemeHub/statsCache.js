// 首页「最受欢迎」人数统计：按北京时间自然日刷新，一天只算一次。
// - 缓存是今天的 → 直接返回，不扫注册表、不查标记。
// - 不是今天的 → 第一个调用者用事务抢锁，拿到一次性令牌后**立即返回昨天的数据**（不让他等）；
//   客户端不等待地再发 computeStats(token)，统计在那次调用里后台跑完。
//   其他人同时进来直接拿昨天的数据，不触发任何查询。客户端没发 computeStats 的话，锁到期后下一个访客重新领令牌。
// - 每算完一个榜单就落库并记入 done，函数被平台杀掉也不丢进度；快到预算就释放锁，
//   剩下的由下一个访客接着算。失败的榜单保留旧值、同样记为今天已处理，当天不再重试。
const COLLECTION = 'theme_hub_cache';
const DOC_ID = 'public-v1';
const LOCK_MS = 70000;      // 大于函数超时（60s）：持锁者被杀掉后，下一个访客最多等这么久就能接手
const BUDGET_MS = 40000;    // 超过就不再开新榜单，给在跑的查询和落库留余量
const CONCURRENCY = 4;
const crypto = require('crypto');

function dayKey(now = Date.now()) {
  return new Date(now + 8 * 3600000).toISOString().slice(0, 10);
}
const valid = row => row && row.valid !== false && Number.isFinite(row.users) && row.users >= 0;

module.exports = ({ db, localCatalog, logic, scan, count, now = () => Date.now() }) => {
  const ref = host => host.collection(COLLECTION).doc(DOC_ID);
  async function get(host = db) {
    try { return (await ref(host).get()).data || { rows: {} }; }
    catch (error) {
      if (/not exist|not found|DOCUMENT_NOT_EXIST|missing/i.test(String(error.errMsg || error.message))) return { rows: {} };
      throw error;
    }
  }
  async function put(host, snapshot) {
    const data = { ...snapshot };
    delete data._id;
    await ref(host).set({ data });
    return data;
  }
  async function catalog() {
    try {
      const registry = await scan('theme_registry', { enabled: db.command.neq(false) },
        { theme: true, cardId: true, type: true, source: true, enabled: true });
      return logic.mergeCatalog(localCatalog, registry);
    } catch (error) { return localCatalog; }
  }
  function result(snapshot, extra = {}) {
    const rows = {};
    for (const [id, row] of Object.entries(snapshot.rows || {})) {
      if (valid(row)) rows[id] = { ...row, valid: true, updatedAt: row.updatedAt || snapshot.generatedAt || now() };
    }
    // refreshIds/needsRefresh 保留字段名兼容客户端；刷新已完全在服务端完成，客户端不用再逐个触发。
    return { success: true, rows, day: snapshot.day || '', generatedAt: now(), refreshIds: [], needsRefresh: false, done: true, ...extra };
  }

  // 抢今天的刷新锁。lock 为 null 表示今天已算完或别人正在算，current 是事务里读到的最新快照。
  async function acquire(today) {
    try { await db.createCollection(COLLECTION); } catch (error) { /* Already exists. */ }
    return db.runTransaction(async tx => {
      const current = await get(tx);
      if (current.day === today) return { lock: null, current };
      const lock = current.refresh;
      if (lock && lock.day === today && lock.lockUntil > now()) return { lock: null, current };
      const refresh = { day: today, lockUntil: now() + LOCK_MS, token: crypto.randomBytes(12).toString('hex'),
        done: lock && lock.day === today ? lock.done || [] : [] };
      return { lock: refresh, current: await put(tx, { ...current, refresh }) };
    });
  }

  // 落一个榜单的结果（row 为 null 表示失败，保留旧值），并在全部完成时把整份快照标成今天。
  function save(today, id, before, row, allIds) {
    return db.runTransaction(async tx => {
      const current = await get(tx);
      const rows = { ...(current.rows || {}) };
      // 查询期间有人在控制台手改了这一行：手改优先
      const untouched = JSON.stringify(rows[id]) === JSON.stringify(before);
      if (row && untouched) rows[id] = row;
      // 失败时保留旧值，但旧版「÷3」估算值失真严重（豆瓣曾估出 152 万），宁可不显示也不沿用
      if (!row && untouched && rows[id] && rows[id].estimated) delete rows[id];
      const done = Array.from(new Set(((current.refresh && current.refresh.day === today && current.refresh.done) || []).concat(id)));
      const next = { ...current, rows, generatedAt: now() };
      if (allIds.every(x => done.includes(x))) {
        next.day = today;
        delete next.refresh;
      } else {
        next.refresh = { ...(current.refresh || {}), day: today, done };
      }
      return put(tx, next);
    });
  }

  async function countOne(config) {
    const where = { _id: db.command.exists(true) };
    if (config.theme) where.theme = config.theme;
    if (config.topFiltered) where.isTop250 = db.command.neq(false);
    const content = await scan(config.collection, where, { _id: true });
    return { valid: true, ...await count(config, content.map(x => x._id)), total: content.length, updatedAt: now() };
  }

  async function run(today, lock, snapshot) {
    const started = now();
    const configs = await catalog();
    const allIds = configs.map(c => c.id);
    const queue = configs.filter(c => !lock.done.includes(c.id));
    let latest = snapshot;
    let cursor = 0;
    // 查询可以并发，写库必须排队：所有结果写的是同一份文档，并发事务会互相冲突，重试耗尽就整体失败
    let writes = Promise.resolve();
    const queueSave = (id, before, row) => {
      // 单条落库失败只记日志、不中断其余榜单：该榜单不进 done，下一棒会重算它
      writes = writes.then(() => save(today, id, before, row, allIds)).then(saved => { latest = saved; })
        .catch(error => console.warn('[getThemeHub] statistics save failed', id, error.errCode || error.code || '', error.message));
      return writes;
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      while (cursor < queue.length && now() - started < BUDGET_MS) {
        const config = queue[cursor++];
        const before = (snapshot.rows || {})[config.id];
        let row = null;
        try { row = await countOne(config); }
        catch (error) { console.warn('[getThemeHub] statistics query failed', config.id, error.errCode || error.code || ''); }
        await queueSave(config.id, before, row);
      }
    }));
    await writes;
    if (queue.length === 0 || latest.day !== today) {
      // 没跑完（预算用尽）或目录为空：释放锁，下一个访客从 done 之后接着算
      latest = await db.runTransaction(async tx => {
        const current = await get(tx);
        if (current.day === today) return current;
        if (queue.length === 0) { const next = { ...current, day: today }; delete next.refresh; return put(tx, next); }
        const refresh = { ...(current.refresh || {}), day: today, lockUntil: 0 };
        delete refresh.token;
        return put(tx, { ...current, refresh });
      });
    }
    return latest;
  }

  async function read() {
    const today = dayKey(now());
    const snapshot = await get();
    if (snapshot.day === today) return result(snapshot);
    const { lock, current } = await acquire(today);
    if (!lock) return result(current, current.day === today ? {} : { refreshing: true });
    // 抢到锁也不在这次调用里算：先把历史数据还给用户，统计交给 compute
    return result(current, { refreshing: true, refreshToken: lock.token });
  }

  // 只有持有当前锁令牌的调用才能触发统计，客户端不能凭空让服务端反复聚合。
  async function compute(token) {
    const today = dayKey(now());
    const current = await get();
    const lock = current.refresh;
    if (!token || current.day === today || !lock || lock.day !== today || lock.token !== token || !(lock.lockUntil > now())) {
      return { success: false, error: 'not_lock_holder' };
    }
    // 从领令牌到真正开跑有一段客户端往返，开跑时把锁续满，保证本次 60 秒内不会被别人接手
    const renewed = await db.runTransaction(async tx => {
      const latest = await get(tx);
      if (!latest.refresh || latest.refresh.token !== token) return null;
      return put(tx, { ...latest, refresh: { ...latest.refresh, lockUntil: now() + LOCK_MS } });
    });
    if (!renewed) return { success: false, error: 'not_lock_holder' };
    return result(await run(today, renewed.refresh, renewed));
  }

  return { read, refresh: read, compute, dayKey };
};
module.exports.dayKey = dayKey;
