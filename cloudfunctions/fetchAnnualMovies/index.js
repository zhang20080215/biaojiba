// cloudfunctions/fetchAnnualMovies/index.js
// 2026年度院线电影数据 — 从猫眼票房日历增量抓取
// 数据来源：https://piaofang.maoyan.com/calendar（var AppData 内嵌数据）
// 每日凌晨2点定时触发，增量新增电影，永不删除（保护用户 Marks）

const cloud = require('wx-server-sdk');
const axios = require('axios');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const COLLECTION = 'annual_movies';
const YEAR = 2026;

// ==================== 猫眼数据抓取 ====================

/**
 * 从猫眼票房日历页面抓取电影数据
 * 页面将数据嵌在 var AppData = {...} 中，包含：
 *   - releaseInfo.calendars: { "2026-04-01": 5, ... } 日期→电影数量
 *   - releaseList.movies: { "2026-04-01": { date, list: [{ id, nm, rt, cat, dir, star, wish, img, sc }] } }
 * 注意：服务器只返回从今天起后几天的详细数据，不支持任意月份查询
 */
async function fetchMaoyanAppData() {
  const url = 'https://piaofang.maoyan.com/calendar';

  try {
    const res = await axios.get(url, {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9'
      }
    });

    const html = res.data;

    // 提取 var AppData = {...}
    const match = html.match(/var\s+AppData\s*=\s*(\{[\s\S]*?\});\s*<\/script>/);
    if (!match || !match[1]) {
      console.warn('未找到 AppData，尝试备用正则');
      const match2 = html.match(/var\s+AppData\s*=\s*(\{[\s\S]*?\})\s*;?\s*\n/);
      if (!match2 || !match2[1]) {
        throw new Error('无法从猫眼页面提取 AppData');
      }
      return JSON.parse(match2[1]);
    }

    return JSON.parse(match[1]);
  } catch (err) {
    console.error('抓取猫眼 AppData 失败:', err.message);
    throw err;
  }
}

/**
 * 从 AppData 中提取电影列表
 * @returns {Array<{title, maoyanId, releaseDate, director, genre, star, wish, coverUrl, score}>}
 */
function extractMoviesFromAppData(appData) {
  const movies = [];
  const seen = new Set();

  if (!appData || !appData.releaseList || !appData.releaseList.movies) {
    console.warn('AppData 中无 releaseList.movies');
    return movies;
  }

  const moviesByDate = appData.releaseList.movies;

  for (const dateKey of Object.keys(moviesByDate)) {
    const dateGroup = moviesByDate[dateKey];
    if (!dateGroup || !dateGroup.list) continue;

    for (const m of dateGroup.list) {
      if (!m.nm) continue;

      // 只取指定年份的电影
      const releaseYear = m.rt ? parseInt(m.rt.substring(0, 4)) : null;
      if (releaseYear && releaseYear !== YEAR) continue;

      // 去重（同一部电影可能出现在多个日期）
      const key = `${m.nm}_${m.rt}`;
      if (seen.has(key)) continue;
      seen.add(key);

      movies.push({
        title: m.nm,
        maoyanId: String(m.id || ''),
        releaseDate: m.rt || dateKey,
        director: m.dir || '',
        genre: (m.cat || '').replace(/\s*\/\s*/g, '/'),
        star: m.star || '',
        wish: m.wish || 0,
        coverUrl: m.img || '',
        score: m.sc || 0
      });
    }
  }

  // 按上映日期排序
  movies.sort((a, b) => (a.releaseDate || '').localeCompare(b.releaseDate || ''));

  return movies;
}

/**
 * 备用方案：从猫眼移动端"即将上映"接口抓取
 */
async function fetchMaoyanComingList() {
  const movies = [];
  try {
    const url = 'https://m.maoyan.com/ajax/comingList?ci=1&limit=100&type=1&token=';
    const res = await axios.get(url, {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15',
        'Referer': 'https://m.maoyan.com/'
      }
    });

    if (res.data && res.data.coming) {
      for (const m of res.data.coming) {
        const releaseYear = m.rt ? parseInt(m.rt.substring(0, 4)) : null;
        if (releaseYear && releaseYear !== YEAR) continue;

        movies.push({
          title: m.nm || '',
          maoyanId: String(m.id || ''),
          releaseDate: m.rt || m.comingTitle || '',
          director: m.dir || '',
          genre: (m.cat || '').replace(/\s*\/\s*/g, '/'),
          star: m.star || '',
          wish: m.wish || 0,
          coverUrl: m.img || '',
          score: m.sc || 0
        });
      }
    }

    console.log(`猫眼移动端即将上映: 找到 ${movies.length} 部 ${YEAR} 年电影`);
  } catch (err) {
    console.warn('猫眼移动端接口失败:', err.message);
  }
  return movies;
}

/**
 * 下载图片并上传到微信云存储
 */
async function downloadAndUploadImage(imageUrl, fileName) {
  try {
    // 猫眼图片去掉尺寸限制参数，获取更高清版本
    let highResUrl = imageUrl;
    if (imageUrl.includes('imageMogr2')) {
      highResUrl = imageUrl.split('?')[0] + '?imageMogr2/quality/90';
    }

    const response = await axios({
      url: highResUrl,
      responseType: 'arraybuffer',
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://piaofang.maoyan.com/'
      }
    });

    const cloudPath = `annual_covers/${fileName}_${Date.now()}.jpg`;
    const uploadResult = await cloud.uploadFile({
      cloudPath,
      fileContent: response.data
    });

    console.log(`  -> 封面上传成功: ${fileName} (${(response.data.length / 1024).toFixed(1)}KB)`);
    return uploadResult.fileID;
  } catch (e) {
    console.warn(`  -> 封面下载失败 ${fileName}:`, e.message);
    return imageUrl; // 回退原始 URL
  }
}

// ==================== 云函数入口 ====================

/**
 * @param {Object} event
 * @param {string} [event.action='fetch'] - 操作类型：
 *   - 'fetch': 从猫眼抓取最新数据并增量更新（默认，定时触发器也调用此action）
 *   - 'covers': 将猫眼海报图下载到云存储（断点续传）
 *
 * 云端测试示例：
 *   {} 或 {"action":"fetch"} — 从猫眼增量抓取
 *   {"action":"covers"} — 下载海报到云存储
 *   {"action":"covers","startFrom":10} — 从第10名继续下载
 *   {"action":"covers","forceRefresh":true} — 强制重新下载所有封面
 */
exports.main = async (event = {}, context) => {
  const action = event.action || 'fetch';

  try {
    // ========== action: fetch（猫眼增量抓取，也是定时触发器默认入口）==========
    if (action === 'fetch') {
      let movies = [];

      // 方案1：从猫眼票房日历 AppData 抓取
      try {
        const appData = await fetchMaoyanAppData();
        movies = extractMoviesFromAppData(appData);
        console.log(`猫眼日历 AppData: 提取到 ${movies.length} 部 ${YEAR} 年电影`);
      } catch (err) {
        console.warn('AppData 抓取失败，尝试备用方案:', err.message);
      }

      // 方案2：从猫眼移动端即将上映接口补充
      try {
        const comingMovies = await fetchMaoyanComingList();
        const existingTitles = new Set(movies.map(m => m.title));
        for (const m of comingMovies) {
          if (!existingTitles.has(m.title)) {
            movies.push(m);
            existingTitles.add(m.title);
          }
        }
        console.log(`合并后共 ${movies.length} 部电影`);
      } catch (err) {
        console.warn('移动端接口补充失败:', err.message);
      }

      if (movies.length === 0) {
        return { success: false, error: '未能从猫眼获取到任何电影数据', action };
      }

      let totalAdded = 0;
      let totalUpdated = 0;

      for (const movie of movies) {
        if (!movie.title) continue;

        // 查询是否已存在（按标题+年份匹配，保护 _id 和 Marks）
        const existing = await db.collection(COLLECTION)
          .where({ title: movie.title, year: YEAR })
          .get();

        if (existing.data.length > 0) {
          // 已存在：只更新动态字段，不修改 _id / rank / cover
          const old = existing.data[0];
          const updateData = { updateTime: new Date() };

          if (movie.maoyanId && !old.maoyanId) updateData.maoyanId = movie.maoyanId;
          if (movie.director && !old.director) updateData.director = movie.director;
          if (movie.genre && !old.genre) updateData.genre = movie.genre;
          if (movie.star && !old.star) updateData.star = movie.star;
          if (movie.wish) updateData.wish = movie.wish;
          if (movie.score > 0 && (!old.rating || old.rating === 0)) updateData.rating = movie.score;
          // 如果还没有任何封面，存猫眼原始 URL
          if (movie.coverUrl && !old.cover && !old.coverUrl) {
            updateData.coverUrl = movie.coverUrl;
            updateData.originalCover = movie.coverUrl;
          }

          await db.collection(COLLECTION).doc(old._id).update({ data: updateData });
          totalUpdated++;
        } else {
          // 新电影：获取当前最大 rank 后追加
          const maxRankRes = await db.collection(COLLECTION)
            .orderBy('rank', 'desc')
            .limit(1)
            .get();
          const nextRank = maxRankRes.data.length > 0 ? maxRankRes.data[0].rank + 1 : 1;

          await db.collection(COLLECTION).add({
            data: {
              rank: nextRank,
              title: movie.title,
              year: YEAR,
              releaseDate: movie.releaseDate || '',
              director: movie.director || '',
              genre: movie.genre || '',
              star: movie.star || '',
              wish: movie.wish || 0,
              rating: movie.score || 0,
              maoyanId: movie.maoyanId || '',
              coverUrl: movie.coverUrl || '',
              originalCover: movie.coverUrl || '',
              cover: '',
              isTop250: true,
              theme: 'annual_movies',
              updateTime: new Date()
            }
          });
          totalAdded++;
        }
      }

      return {
        success: true,
        action: 'fetch',
        totalFromMaoyan: movies.length,
        totalAdded,
        totalUpdated,
        sampleTitles: movies.slice(0, 5).map(m => m.title)
      };
    }

    // ========== action: covers（下载猫眼海报到云存储）==========
    if (action === 'covers') {
      const START_TIME = Date.now();
      const TIME_LIMIT = 50000; // 50秒安全线
      const forceRefresh = event.forceRefresh || false;
      const startFrom = event.startFrom || 0;

      // 读取所有电影
      const MAX_LIMIT = 100;
      let allMovies = [];
      let fetchCount = 0;
      while (true) {
        const batch = await db.collection(COLLECTION)
          .orderBy('rank', 'asc')
          .skip(fetchCount)
          .limit(MAX_LIMIT)
          .get();
        allMovies = allMovies.concat(batch.data);
        fetchCount += batch.data.length;
        if (batch.data.length < MAX_LIMIT) break;
      }

      console.log(`共 ${allMovies.length} 部年度电影，forceRefresh=${forceRefresh}, startFrom=${startFrom}`);

      let processed = 0;
      let uploaded = 0;
      let skipped = 0;
      let failed = 0;
      let stoppedEarly = false;
      let lastRank = 0;

      for (const movie of allMovies) {
        if (movie.rank < startFrom) {
          skipped++;
          continue;
        }

        if (Date.now() - START_TIME > TIME_LIMIT) {
          stoppedEarly = true;
          break;
        }

        lastRank = movie.rank;

        // 已有云存储封面则跳过
        if (!forceRefresh && movie.cover && movie.cover.startsWith('cloud://')) {
          skipped++;
          processed++;
          continue;
        }

        // 需要有猫眼原始图片 URL
        const sourceUrl = movie.coverUrl || movie.originalCover;
        if (!sourceUrl) {
          console.warn(`[${movie.rank}] ${movie.title}: 无封面 URL，跳过`);
          failed++;
          processed++;
          continue;
        }

        console.log(`[${movie.rank}] 上传封面: ${movie.title}`);

        const fileId = `annual_${movie.maoyanId || movie.rank}`;
        const cloudFileID = await downloadAndUploadImage(sourceUrl, fileId);

        if (cloudFileID && cloudFileID.startsWith('cloud://')) {
          await db.collection(COLLECTION).doc(movie._id).update({
            data: {
              cover: cloudFileID,
              updateTime: new Date()
            }
          });
          uploaded++;
        } else {
          failed++;
        }

        processed++;
        // 限速，避免触发猫眼/云存储限流
        await new Promise(r => setTimeout(r, 500));
      }

      return {
        success: true,
        action: 'covers',
        processed,
        uploaded,
        skipped,
        failed,
        stoppedEarly,
        lastRank,
        hint: stoppedEarly
          ? `已处理到第${lastRank}名，请传入 {"action":"covers","startFrom":${lastRank}} 继续`
          : '全部封面处理完成'
      };
    }

    return {
      success: false,
      error: `未知操作: "${action}"`,
      usage: '支持的 action: "fetch"（猫眼增量抓取）、"covers"（下载封面到云存储）'
    };
  } catch (err) {
    console.error('fetchAnnualMovies error:', err);
    return { success: false, error: err.message };
  }
};
