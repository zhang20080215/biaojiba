// utils/dataLoader.js - 数据加载工具（含本地缓存优化）

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 小时缓存有效期

// ─────────────────────────────────────────────
// 缓存工具
// ─────────────────────────────────────────────

function getCacheKey(theme) {
  return `cache_movies_${theme}`;
}

function readMovieCache(theme) {
  try {
    const raw = wx.getStorageSync(getCacheKey(theme));
    if (!raw || !raw.ts || !raw.data) return null;
    if (Date.now() - raw.ts > CACHE_TTL_MS) return null; // 过期
    return raw.data;
  } catch (e) {
    return null;
  }
}

function writeMovieCache(theme, movies) {
  try {
    wx.setStorageSync(getCacheKey(theme), { ts: Date.now(), data: movies });
  } catch (e) {
    console.warn('写入电影缓存失败:', e);
  }
}

function invalidateMovieCache(theme) {
  try {
    wx.removeStorageSync(getCacheKey(theme));
  } catch (e) { }
}

// ─────────────────────────────────────────────
// 核心：调用聚合云函数，优先命中本地缓存
// ─────────────────────────────────────────────

/**
 * 加载电影数据（优先缓存，过期或强制刷新时才调云函数）
 * @param {string} theme - 'douban' | 'imdb'
 * @param {string|null} openid
 * @param {boolean} forceRefresh - 是否强制忽略缓存
 */
async function loadMoviesData(theme, openid, forceRefresh = false) {
  const cached = forceRefresh ? null : readMovieCache(theme);

  let movies;
  let marks = [];

  if (cached) {
    // 命中缓存：电影列表直接使用缓存，标记单独从云函数刷新
    movies = cached;
    if (openid) {
      try {
        const markRes = await wx.cloud.callFunction({
          name: 'getMoviesData',
          data: { theme, openid, marksOnly: true }
        });
        if (markRes.result && markRes.result.marks) {
          marks = markRes.result.marks;
        }
      } catch (e) {
        console.warn('刷新标记失败，使用空标记:', e);
      }
    }
  } else {
    // 缓存未命中：全量请求
    const res = await wx.cloud.callFunction({
      name: 'getMoviesData',
      data: { theme, openid }
    });
    if (!res.result || !res.result.success) {
      throw new Error(res.result ? res.result.error : '云函数调用失败');
    }
    movies = res.result.movies;
    marks = res.result.marks || [];
    writeMovieCache(theme, movies);
  }

  return { movies, marks };
}

// ─────────────────────────────────────────────
// 标记处理（纯本地计算，保留原有逻辑）
// ─────────────────────────────────────────────

function processMarks(marks, movies) {
  const _markObjectMap = {};
  const markTitleMap = {};
  const normalizedMap = {};
  const stats = { watched: 0, wish: 0, unwatched: 0 };
  const watchedMovies = [];
  const markDateMap = {};
  const markStatusMap = {};
  const markRecordIdMap = {};
  const watchedIds = [];
  const wishIds = [];

  const getCleanId = (idStr) => {
    if (!idStr) return '';
    return String(idStr).replace(/_\d{4}$/, '').replace(/_+$/, '');
  };

  marks.forEach(item => {
    const mid = String(item.movieId);
    if (!_markObjectMap[mid] || new Date(item.marked_at) > new Date(_markObjectMap[mid].marked_at)) {
      _markObjectMap[mid] = item;
    }
    const cleanId = getCleanId(mid);
    if (cleanId && (!normalizedMap[cleanId] || new Date(item.marked_at) > new Date(normalizedMap[cleanId].marked_at))) {
      normalizedMap[cleanId] = item;
    }
    if (item.movieTitle) {
      const title = String(item.movieTitle);
      if (!markTitleMap[title] || new Date(item.marked_at) > new Date(markTitleMap[title].marked_at)) {
        markTitleMap[title] = item;
      }
    }
  });

  movies.forEach(movie => {
    const cleanMovieId = getCleanId(movie._id);
    let mark = _markObjectMap[movie._id] || normalizedMap[cleanMovieId] || markTitleMap[movie.title];

    if (mark) {
      if (mark._id) {
        markRecordIdMap[movie._id] = mark._id;
      }
      if (mark.status === 'watched' || mark.status === 'wish') {
        markStatusMap[movie._id] = mark.status;
      }
      if (mark.marked_at && (mark.status === 'watched' || mark.status === 'wish')) {
        let dateValue = mark.marked_at;
        if (typeof dateValue === 'object') {
          dateValue = dateValue.toISOString ? dateValue.toISOString() : new Date(dateValue).toISOString();
        } else if (typeof dateValue !== 'string') {
          dateValue = new Date(dateValue).toISOString();
        }
        try {
          const dateObj = new Date(dateValue);
          markDateMap[movie._id] = `${dateObj.getMonth() + 1}/${dateObj.getDate()}`;
        } catch (e) {
          markDateMap[movie._id] = '';
        }
      }
      if (mark.status === 'watched') {
        stats.watched++;
        watchedIds.push(movie._id);
        watchedMovies.push(movie);
      } else if (mark.status === 'wish') {
        stats.wish++;
        wishIds.push(movie._id);
      } else {
        stats.unwatched++;
      }
    } else {
      stats.unwatched++;
    }
  });

  return { markStatusMap, markDateMap, markRecordIdMap, watchedIds, wishIds, stats, watchedMovies };
}

// ─────────────────────────────────────────────
// 保留旧版接口（兼容 share 页等未改动的页面）
// ─────────────────────────────────────────────

const MAX_LIMIT = 20;

async function loadCollection(db, collectionName, options = {}) {
  try {
    const { where = {}, orderBy, limit } = options;
    const countRes = await db.collection(collectionName).where(where).count();
    const total = countRes.total;
    if (total === 0) return [];
    const batchLimit = limit || MAX_LIMIT;
    const batchTimes = Math.ceil(total / batchLimit);
    const tasks = [];
    for (let i = 0; i < batchTimes; i++) {
      let query = db.collection(collectionName).where(where);
      if (orderBy) query = query.orderBy(orderBy.field, orderBy.order || 'asc');
      tasks.push(query.skip(i * batchLimit).limit(batchLimit).get());
    }
    const results = await Promise.all(tasks);
    let allData = [];
    results.forEach(res => { allData = allData.concat(res.data); });
    return allData;
  } catch (err) {
    console.error(`加载集合 ${collectionName} 失败:`, err);
    throw err;
  }
}

async function loadMarks(db, openid) {
  return await loadCollection(db, 'Marks', { where: { openid } });
}

module.exports = {
  // 新接口（优化后）
  loadMoviesData,
  invalidateMovieCache,
  processMarks,
  // 旧接口（保留兼容）
  loadCollection,
  loadMarks,
};
