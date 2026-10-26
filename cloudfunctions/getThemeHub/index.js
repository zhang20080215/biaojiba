const cloud = require('wx-server-sdk');
const logic = require('./logic');
const localCatalog = require('./catalog.json');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;
let membershipCache = null;
let membershipFlight = null;


async function scan(collection, where, fields, visit) {
  const rows = [];
  let after = '';
  while (true) {
    const condition = after ? _.and([where, { _id: _.gt(after) }]) : where;
    const res = await db.collection(collection).where(condition).orderBy('_id', 'asc').limit(1000).field(fields).get();
    if (visit) visit(res.data);
    else rows.push(...res.data);
    if (res.data.length < 1000) break;
    after = res.data[res.data.length - 1]._id;
  }
  return rows;
}
async function mapLimit(items, work, limit = 4) {
  const results = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) { const index = cursor++; try { results[index] = { value: await work(items[index]) }; } catch (error) { results[index] = { error }; } }
  }));
  return results;
}
async function membership() {
  if (membershipCache && Date.now() - membershipCache.at < 5 * 60000) return membershipCache;
  if (membershipFlight) return membershipFlight;
  membershipFlight = (async () => {
    // Failure is propagated: don't cache an incomplete catalog as a complete ranking.
    const registry = await scan('theme_registry', { enabled: _.neq(false) }, { theme: true, cardId: true, type: true, source: true, enabled: true });
    const configs = logic.mergeCatalog(localCatalog, registry);
    const collections = [...new Set(configs.map(c => c.collection))];
    const result = await mapLimit(collections, collection => scan(collection, { _id: _.exists(true) }, { _id: true, theme: true, isTop250: true }));
    const ids = {};
    collections.forEach((collection, index) => {
      if (result[index].error) console.warn('[getThemeHub] membership scan failed', collection, result[index].error.errCode || result[index].error.code || '', result[index].error.message);
      configs.filter(c => c.collection === collection).forEach(c => {
        ids[c.id] = result[index].error ? null : result[index].value.filter(r => logic.belongs(r, c)).map(r => r._id);
      });
    });
    membershipCache = { configs, ids, at: Date.now() };
    return membershipCache;
  })().finally(() => { membershipFlight = null; });
  return membershipFlight;
}
function userMatch(config, ids) {
  const match = { [config.idField || 'movieId']: _.in(ids), openid: _.exists(true).and(_.neq('')).and(_.neq(null)),
    status: _.in(config.marksCollection === 'BookMarks' ? ['read', 'wish'] : ['watched', 'wish']) };
  if (config.source) match.source = config.source === 'douban' ? _.or([_.eq('douban'), _.exists(false)]) : config.source;
  const excluded = (process.env.EXCLUDED_OPENIDS || '').split(',').filter(Boolean);
  if (excluded.length) match.openid = match.openid.and(_.nin(excluded));
  return match;
}
async function aggregateUsers(config, match) {
  const result = await db.collection(config.marksCollection || 'Marks').aggregate().match(match).group({ _id: '$openid' }).count('total').end();
  return result.list.length ? result.list[0].total : 0;
}
async function compareStats(reverse) {
  // Console/server-only diagnostic. Same environment and IDs, read-only;
  // never estimates counts, exposes user IDs, or writes the public snapshot.
  if (cloud.getWXContext().OPENID) return { success: false, error: 'server_only' };
  const rows = [];
  for (const config of localCatalog.filter(c => c.id === 'douban_movies' || c.id === 'imdb_movies')) {
    const row = { id: config.id };
    try {
      const content = await scan(config.collection, { isTop250: _.neq(false) }, { _id: true });
      const ids = content.map(item => item._id);
      row.total = ids.length;
      const variants = reverse ? ['current', 'legacy'] : ['legacy', 'current'];
      for (const variant of variants) {
        const started = Date.now();
        try {
          const match = variant === 'legacy' ? { [config.idField || 'movieId']: _.in(ids) } : userMatch(config, ids);
          row[variant] = { success: true, users: ids.length ? await aggregateUsers(config, match) : 0, durationMs: Date.now() - started };
        } catch (error) {
          row[variant] = { success: false, durationMs: Date.now() - started, errorCode: error.errCode || error.code || null, errorMessage: error.message || error.errMsg || 'unknown' };
        }
      }
    } catch (error) {
      row.errorCode = error.errCode || error.code || null;
      row.errorMessage = error.message || error.errMsg || 'unknown';
    }
    rows.push(row);
  }
  return { success: true, mode: 'compare_stats_queries', order: reverse ? 'current_first' : 'legacy_first', rows };
}
async function countThemeUsers(config, ids) {
  if (!ids.length) return 0;
  const match = userMatch(config, ids);
  const key = config.idField || 'movieId';
  const byContent = { [key]: match[key] };
  delete match[key];
  // Content-ID predicate can use an existing index; verify the actual plan in production.
  const result = await db.collection(config.marksCollection || 'Marks').aggregate()
    .match(byContent).match(match).group({ _id: '$openid' }).count('total').end();
  return result.list.length ? result.list[0].total : 0;
}
// Public popularity uses the released query; private progress keeps validMark rules.
const statsCache = require('./statsCache')({ db, localCatalog, logic, scan, count: require('./legacyStats')(db) });
// Fixed, read-only diagnostics: no caller-controlled collection/filter or user IDs.
async function diagnoseStats(theme) {
  const allowed = ['douban_movies', 'imdb_movies'];
  if (theme !== undefined && !allowed.includes(theme)) return { success: false, error: 'invalid_theme' };
  const rows = [];
  for (const config of localCatalog.filter(c => theme ? c.id === theme : allowed.includes(c.id))) {
    const row = { id: config.id, success: false, stage: 'content' };
    let started = Date.now();
    console.warn('[getThemeHub] diagnose start', config.id, 'content');
    try {
      const content = await scan(config.collection, { isTop250: _.neq(false) }, { _id: true });
      row.total = content.length;
      row.contentMs = Date.now() - started;
      row.stage = 'aggregate';
      started = Date.now();
      console.warn('[getThemeHub] diagnose start', config.id, 'aggregate', 'total', row.total);
      row.users = await countThemeUsers(config, content.map(x => x._id));
      row.aggregateMs = Date.now() - started;
      row.stage = 'complete';
      row.success = true;
    } catch (error) {
      row.durationMs = Date.now() - started;
      row.errorCode = error.errCode || error.code || null;
      // Raw SDK errors may contain query values; keep those out of public output.
      row.errorType = /timeout|timed out/i.test(String(error.message || error.errMsg)) ? 'timeout' : 'query_failed';
    }
    console.warn('[getThemeHub] diagnose result', JSON.stringify(row));
    rows.push(row);
  }
  return { success: rows.every(r => r.success), mode: 'diagnose_stats', rows };
}
async function summary() {
  const openid = cloud.getWXContext().OPENID;
  if (!openid) return { success: false, error: 'identity_unavailable' };
  const { configs, ids } = await membership();
  const result = await mapLimit(['Marks', 'BookMarks'], collection => scan(collection, { openid }, { movieId: true, bookId: true, openid: true, status: true, source: true, marked_at: true }));
  const rows = {};
  let partial = false;
  configs.forEach(c => {
    const marks = result[c.marksCollection === 'BookMarks' ? 1 : 0];
    if (!ids[c.id] || marks.error) { partial = true; return; }
    const row = logic.summarize(c, ids[c.id], marks.value);
    if (row.done || row.wish) rows[c.id] = row;
  });
  return { success: true, rows, partial };
}
exports.main = async event => {
  try {
    if (event && event.action === 'diagnoseStats') return await diagnoseStats(event.theme);
    if (event && event.action === 'compareStats') return await compareStats(event.reverse === true);
    if (event && event.action === 'summary') return await summary();
    if (event && event.action === 'refreshStats') return await statsCache.refresh(event.theme);
    if (event && event.action === 'computeStats') return await statsCache.compute(event.token);
    return await statsCache.read();
  } catch (error) {
    console.warn('[getThemeHub] unavailable', error.message);
    return { success: false, error: 'temporarily_unavailable' };
  }
};
