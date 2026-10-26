// 榜单参与人数 = 标记过该榜单任一作品的去重 openid 数（与线上旧版小程序端同口径）。
//
// 小榜单一条聚合就够。豆瓣 TOP250 命中约 458 万条标记，云函数里单条聚合约 6 秒就被数据库判
// 超时（-501001 DATABASE_TIMEOUT，2026-10-25 compareStats 实测；同查询 IMDb 1.5 秒成功）。
// 这时按 openid 字符区间切段：每个用户只落在一段里，各段去重人数直接相加就是精确总数，
// 每段只回一个数字。某段仍超时就切得更细再试。
// 不再用「标记条数 ÷ 3」估算：豆瓣人均标记约 90 部，估出 152 万，失真几十倍。算不出来就抛错，
// 由调用方保留上一次的真实值。
// openid 字符集（base64url），按 ASCII 升序 —— 区间边界必须有序
const ALPHABET = '-0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz';
const COARSE_STEP = 4;      // 首轮每段覆盖 4 个字符：16 段，每段约 1/16 的用户
const CONCURRENCY = 4;

module.exports = db => async (config, ids) => {
  if (!ids.length) return { users: 0, estimated: false };
  const _ = db.command;
  const collection = config.marksCollection || 'Marks';
  const idField = config.idField || 'movieId';
  const match = extra => {
    const filter = { [idField]: _.in(ids), ...extra };
    if (config.source) filter.source = config.source === 'douban'
      ? _.or([_.eq('douban'), _.exists(false)]) : config.source;
    return filter;
  };
  const distinct = async extra => {
    const result = await db.collection(collection).aggregate().match(match(extra))
      .group({ _id: '$openid' }).count('total').end();
    return result.list.length ? result.list[0].total : 0;
  };

  try {
    return { users: await distinct({}), estimated: false };
  } catch (error) {
    console.warn('[getThemeHub] single aggregate failed, splitting by openid', config.id, error.errCode || error.code || '', error.message);
  }

  // 同一小程序的 openid 共用前缀（如 ozCMC7），按前缀后的第一个字符切段才均匀。
  // 取多条找最常见的前缀，避免第一条恰好是测试账号/脏数据（真实 openid 为 28 位）。
  // 前缀只影响切段是否均匀，不影响结果：区间覆盖全部字符串，前缀不同的 openid 落在首尾两段里照样计入。
  const sample = await db.collection(collection).where(match({})).limit(20).field({ openid: true }).get();
  const prefixes = {};
  sample.data.forEach(r => { if (typeof r.openid === 'string' && r.openid.length >= 20) prefixes[r.openid.slice(0, 6)] = (prefixes[r.openid.slice(0, 6)] || 0) + 1; });
  const prefix = Object.keys(prefixes).sort((a, b) => prefixes[b] - prefixes[a])[0];
  if (!prefix) throw new Error('openid sample unavailable');
  // 边界 K[0]=-∞, K[1..64]=prefix+字符, K[65]=+∞；区间 [K[i], K[j]) 覆盖全部字符串，互不重叠
  const bound = i => (i <= 0 || i > ALPHABET.length ? null : prefix + ALPHABET[i - 1]);
  const rangeFilter = ([i, j]) => {
    const lo = bound(i), hi = bound(j);
    if (lo && hi) return { openid: _.gte(lo).and(_.lt(hi)) };
    if (lo) return { openid: _.gte(lo) };
    return { openid: _.lt(hi) };
  };
  let pending = [[0, 1]];
  for (let i = 1; i <= ALPHABET.length; i += COARSE_STEP) pending.push([i, Math.min(i + COARSE_STEP, ALPHABET.length + 1)]);

  let users = 0;
  // 最多细分两轮：粗段 → 单字符段；单字符段仍失败就放弃整个榜单
  for (let round = 0; round < 2 && pending.length; round++) {
    const failed = [];
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pending.length) }, async () => {
      while (cursor < pending.length) {
        const range = pending[cursor++];
        // 先 await 再累加：写成 users += await … 会在等待前读走旧值，并发段互相覆盖、少算人数
        try { const n = await distinct(rangeFilter(range)); users += n; }
        catch (error) {
          console.warn('[getThemeHub] openid range failed', config.id, range.join('-'), error.errCode || error.code || '');
          failed.push(range);
        }
      }
    }));
    pending = [];
    for (const [i, j] of failed) {
      if (j - i <= 1) throw new Error(`openid range ${i}-${j} still times out`);
      for (let k = i; k < j; k++) pending.push([k, k + 1]);
    }
  }
  if (pending.length) throw new Error('openid ranges unfinished');
  return { users, estimated: false };
};
