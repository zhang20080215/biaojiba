// 记录页「期待上线」点赞：每人每天最多 LIMIT 次，总次数在云端（wishLike 云函数）累计。
// 展示取整到百：不足 200 一律「100+」，之后 200+、300+……
//
// 省调用的两条规矩：
// 1. 总数一天只读一次，结果按北京时间日期缓存在本地；
// 2. 连点只改本地计数，停手 FLUSH_MS 或离开页面时，把还没上报的次数合成一次 add。
//    add 的返回里带最新总数，顺手刷新缓存，不再单独读。
// 本地 count = 今天点了几次，sent = 其中已上报几次；屏幕上的总数 = 云端总数 + (count - sent)。
const LIMIT = 10;
const FLUSH_MS = 1500;
const MINE_KEY = 'recordsWishLikes';
const TOTAL_KEY = 'recordsWishTotal';
const TOPIC = 'records';

let inflight = null;

function today() { return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10); }
function read(key) { try { return wx.getStorageSync(key); } catch (e) { return null; } }
function write(key, value) { try { wx.setStorageSync(key, value); } catch (e) {} }

function formatTotal(total) {
  return Math.max(100, Math.floor((Number(total) || 0) / 100) * 100) + '+';
}

// 旧版本存的是一个累计数字，不是当天对象，按今天 0 次处理
function readMine() {
  const v = read(MINE_KEY);
  return v && typeof v === 'object' && v.day === today() ? { count: v.count || 0, sent: v.sent || 0 } : { count: 0, sent: 0 };
}
function writeMine(mine) { write(MINE_KEY, { day: today(), count: mine.count, sent: mine.sent }); }

function cachedTotal() {
  const v = read(TOTAL_KEY);
  return v && typeof v === 'object' && typeof v.total === 'number' ? v : null;
}
function saveTotal(total) { write(TOTAL_KEY, { day: today(), total }); }

// 当天已读过就用缓存；读失败退回旧缓存（再不行就 0，展示仍是 100+）
async function loadTotal() {
  const cached = cachedTotal();
  if (cached && cached.day === today()) return cached.total;
  try {
    const res = await wx.cloud.callFunction({ name: 'wishLike', data: { action: 'get', topic: TOPIC } });
    const result = res && res.result;
    if (result && result.success) { saveTotal(Number(result.total) || 0); return Number(result.total) || 0; }
  } catch (e) { /* 网络失败不影响点赞 */ }
  return cached ? cached.total : 0;
}

// 本地记一次；到上限返回 null，由页面给提示
function tap() {
  const mine = readMine();
  if (mine.count >= LIMIT) return null;
  mine.count += 1;
  writeMine(mine);
  return mine;
}

// 把没上报的次数一次发出去；返回最新云端总数，没发或失败返回 null（次数留着下次再发）
function flush() {
  if (inflight) return inflight;
  const pending = readMine();
  const n = pending.count - pending.sent;
  if (n <= 0) return Promise.resolve(null);
  inflight = wx.cloud.callFunction({ name: 'wishLike', data: { action: 'add', topic: TOPIC, count: n } }).then(res => {
    const result = res && res.result;
    if (!result || !result.success) return null;
    const mine = readMine();
    // 发请求期间日期变了就不回写：新的一天从 0 开始
    if (mine.count >= pending.count) writeMine({ count: mine.count, sent: Math.max(mine.sent, pending.count) });
    const total = Number(result.total) || 0;
    saveTotal(total);
    return total;
  }).catch(() => null).then(total => { inflight = null; return total; });
  return inflight;
}

module.exports = { LIMIT, FLUSH_MS, formatTotal, readMine, cachedTotal, loadTotal, tap, flush };
