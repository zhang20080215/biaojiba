// 每日推荐电影：从 searched_movies 里挑一部「豆瓣评分 > 8.5」的电影，按中国自然日轮换。
// 入参：无（可选 { minRating } 覆盖默认阈值）
// 输出：{ success, movie: <searched_movies doc>|null, total, index }
//
// 选片规则：
//   1. 取所有 douban.rating > 8.5 的电影 _id
//   2. 按 _id 字典序稳定排序（保证同一天选到同一部）
//   3. idx = CN自然日序号 % 池大小 → 每天自动换一部，循环遍历整个候选池
//   4. 取第 idx 部的完整文档返回
// 纯读库、不触发任何抓取，首页 hero 每次加载都很轻。

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const moviesCollection = db.collection('searched_movies');

const MAX_LIMIT = 100;
const CN_TZ_OFFSET_MS = 8 * 60 * 60 * 1000;
const DEFAULT_MIN_RATING = 8.5; // 严格大于

// 中国时区(UTC+8)的自然日序号，用于「每天换一部」的稳定轮换
function cnDayIndex(nowMs) {
  return Math.floor((nowMs + CN_TZ_OFFSET_MS) / 86400000);
}

// 仅取 _id（投影减小负载），分页读全部命中
async function readAllIds(query) {
  const countRes = await query.count();
  const total = countRes.total;
  if (total === 0) return [];
  const batch = Math.ceil(total / MAX_LIMIT);
  const tasks = [];
  for (let i = 0; i < batch; i++) {
    tasks.push(query.field({ _id: true }).skip(i * MAX_LIMIT).limit(MAX_LIMIT).get());
  }
  const results = await Promise.all(tasks);
  let ids = [];
  results.forEach(r => { ids = ids.concat(r.data.map(d => d._id)); });
  return ids;
}

exports.main = async (event) => {
  const minRating = event && Number(event.minRating) > 0 ? Number(event.minRating) : DEFAULT_MIN_RATING;
  try {
    const where = { 'douban.rating': _.gt(minRating) };
    const ids = await readAllIds(moviesCollection.where(where));
    if (ids.length === 0) {
      return { success: true, movie: null, total: 0, reason: 'EMPTY_POOL' };
    }
    // 字典序稳定排序 → 同一天固定选同一部；按 CN 自然日取模 → 每天换一部
    ids.sort();
    const idx = cnDayIndex(Date.now()) % ids.length;
    const pickedId = ids[idx];
    const doc = await moviesCollection.doc(pickedId).get();
    return {
      success: true,
      movie: (doc && doc.data) || null,
      total: ids.length,
      index: idx
    };
  } catch (err) {
    console.error('getDailyFeaturedMovie 失败:', err && err.message);
    return { success: false, error: err && err.message };
  }
};
