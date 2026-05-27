// 入参: { openid?: string }（不传则从 wxContext 取）
// 返回用户的查询过的电影列表（按 queriedAt 倒序）
// 输出: { success, movies: [movie_doc, ...], queries: [query_doc, ...] }

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const MAX_LIMIT = 100;

async function readAll(query) {
  const countRes = await query.count();
  const total = countRes.total;
  if (total === 0) return [];
  const batchTimes = Math.ceil(total / MAX_LIMIT);
  const tasks = [];
  for (let i = 0; i < batchTimes; i++) {
    tasks.push(query.skip(i * MAX_LIMIT).limit(MAX_LIMIT).get());
  }
  const results = await Promise.all(tasks);
  let data = [];
  results.forEach(r => { data = data.concat(r.data); });
  return data;
}

exports.main = async (event, context) => {
  const wxCtx = cloud.getWXContext() || {};
  const openid = (event && event.openid) || wxCtx.OPENID;

  if (!openid) {
    return { success: false, error: 'NO_OPENID' };
  }

  try {
    const queries = await readAll(
      db.collection('user_movie_queries').where({ openid }).orderBy('queriedAt', 'desc')
    );

    if (queries.length === 0) {
      return { success: true, movies: [], queries: [] };
    }

    const movieIds = Array.from(new Set(queries.map(q => q.movieRefId).filter(Boolean)));
    if (movieIds.length === 0) {
      return { success: true, movies: [], queries };
    }

    const movies = await readAll(
      db.collection('searched_movies').where({ _id: _.in(movieIds) })
    );

    // 按用户查询顺序排序（queries 已是 queriedAt desc）
    const movieMap = {};
    movies.forEach(m => { movieMap[m._id] = m; });
    const ordered = queries
      .map(q => movieMap[q.movieRefId])
      .filter(Boolean);

    return { success: true, movies: ordered, queries };
  } catch (err) {
    console.error('getMyMovieQueries 失败:', err && err.message);
    return { success: false, error: err && err.message };
  }
};
