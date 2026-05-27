// 入参: { doubanId: string, openid?: string, forceRefresh?: boolean }
// 流程：
//   1. 24h 缓存命中 → 直接返回 searched_movies 数据
//   2. 否则爬豆瓣详情页（评分 + 评分人数 + IMDB ID + 海报 + 元数据）
//   3. 有 IMDB ID 且 OMDB_API_KEY 配置 → 调 OMDb API 拿 IMDB 评分 + 烂番茄评分
//   4. upsert searched_movies + user_movie_queries
//   5. 返回完整文档
// 环境变量：OMDB_API_KEY（缺失时 imdb / rottenTomatoes 返回 null）

const cloud = require('wx-server-sdk');
const axios = require('axios');
const cheerio = require('cheerio');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const moviesCollection = db.collection('searched_movies');
const queriesCollection = db.collection('user_movie_queries');

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// 豆瓣对详情页有更严格反爬，需要完整的浏览器 headers + bid Cookie 才能 200
// bid 是豆瓣给匿名用户分配的标识，11 位 [A-Za-z0-9]，每次随机生成即可绕过简单反爬
function genBid() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let bid = '';
  for (let i = 0; i < 11; i++) {
    bid += chars[Math.floor(Math.random() * chars.length)];
  }
  return bid;
}

function buildDoubanHeaders() {
  return {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Referer': 'https://movie.douban.com/',
    'Cookie': `bid=${genBid()}`,
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1'
  };
}


async function downloadAndUploadPoster(imageUrl, movieDocId) {
  if (!imageUrl) return null;
  try {
    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 15000,
      headers: buildDoubanHeaders()
    });
    const fileName = `searched_movie_covers/${movieDocId}_${Date.now()}.jpg`;
    const uploadResult = await cloud.uploadFile({
      cloudPath: fileName,
      fileContent: response.data
    });
    return uploadResult && uploadResult.fileID ? uploadResult.fileID : null;
  } catch (e) {
    console.error('海报下载/上传失败:', e && e.message);
    return null;
  }
}

async function scrapeDoubanDetail(doubanId) {
  const url = `https://movie.douban.com/subject/${doubanId}/`;
  const res = await axios.get(url, { headers: buildDoubanHeaders(), timeout: 15000 });
  const $ = cheerio.load(res.data);

  const ratingText = $('strong[property="v:average"]').first().text().trim();
  const votesText = $('span[property="v:votes"]').first().text().trim();
  const title = $('h1 span[property="v:itemreviewed"]').first().text().trim();
  const yearRaw = $('h1 .year').first().text() || '';
  const year = yearRaw.replace(/[()（）\s]/g, '').trim();

  const posterUrl = $('#mainpic img').attr('src') || '';

  const directors = [];
  $('#info a[rel="v:directedBy"]').each((i, el) => {
    const name = $(el).text().trim();
    if (name) directors.push(name);
  });

  const genres = [];
  $('#info span[property="v:genre"]').each((i, el) => {
    const g = $(el).text().trim();
    if (g) genres.push(g);
  });

  const infoText = $('#info').text();
  const imdbMatch = infoText.match(/IMDb:?\s*(tt\d+)/i);
  const imdbId = imdbMatch ? imdbMatch[1] : null;

  const rating = parseFloat(ratingText);
  const votes = parseInt(votesText.replace(/,/g, ''), 10);

  return {
    title,
    year,
    posterUrl,
    directors,
    genres,
    imdbId,
    douban: {
      rating: !isNaN(rating) ? rating : null,
      votes: !isNaN(votes) ? votes : null
    }
  };
}

async function fetchOmdb(imdbId) {
  const apiKey = process.env.OMDB_API_KEY;
  if (!apiKey) return { imdb: null, rottenTomatoes: null, reason: 'no_api_key' };
  if (!imdbId) return { imdb: null, rottenTomatoes: null, reason: 'no_imdb_id' };

  try {
    const url = `https://www.omdbapi.com/?i=${encodeURIComponent(imdbId)}&apikey=${encodeURIComponent(apiKey)}`;
    const res = await axios.get(url, { timeout: 10000, responseType: 'json' });
    const data = res.data || {};
    if (data.Response === 'False') {
      return { imdb: null, rottenTomatoes: null, reason: 'omdb_not_found' };
    }

    const imdbRating = parseFloat(data.imdbRating);
    const imdbVotes = parseInt(String(data.imdbVotes || '').replace(/,/g, ''), 10);
    const imdb = !isNaN(imdbRating) ? {
      rating: imdbRating,
      votes: !isNaN(imdbVotes) ? imdbVotes : null
    } : null;

    const rt = (data.Ratings || []).find(r => r && r.Source === 'Rotten Tomatoes');
    const rottenTomatoes = rt ? { score: rt.Value } : null;

    return { imdb, rottenTomatoes, reason: 'ok' };
  } catch (e) {
    console.error('OMDb 调用失败:', e && e.message);
    return { imdb: null, rottenTomatoes: null, reason: 'omdb_error' };
  }
}

async function upsertUserQuery(openid, doubanId, movieRefId) {
  try {
    const exist = await queriesCollection.where({ openid, doubanId }).limit(1).get();
    if (exist.data && exist.data.length > 0) {
      await queriesCollection.doc(exist.data[0]._id).update({
        data: { queriedAt: db.serverDate(), movieRefId }
      });
    } else {
      await queriesCollection.add({
        data: {
          openid,
          doubanId,
          movieRefId,
          queriedAt: db.serverDate()
        }
      });
    }
  } catch (e) {
    console.error('upsertUserQuery 失败:', e && e.message);
  }
}

exports.main = async (event, context) => {
  const doubanId = String((event && event.doubanId) || '').trim();
  const forceRefresh = !!(event && event.forceRefresh);
  // 优先用 event 显式传入的 openid（云端测试可指定空），否则从微信上下文取
  const wxCtx = cloud.getWXContext() || {};
  const openid = event && event.openid !== undefined ? event.openid : wxCtx.OPENID;

  if (!doubanId) {
    return { success: false, error: 'EMPTY_DOUBAN_ID' };
  }

  const movieDocId = `movie_search_${doubanId}`;

  try {
    // 1. 缓存检查
    if (!forceRefresh) {
      let existing = null;
      try {
        const r = await moviesCollection.doc(movieDocId).get();
        existing = r && r.data;
      } catch (e) { /* 文档不存在 */ }

      if (existing && existing.updatedAt) {
        const ageMs = Date.now() - new Date(existing.updatedAt).getTime();
        if (ageMs < CACHE_TTL_MS) {
          if (openid) await upsertUserQuery(openid, doubanId, movieDocId);
          return { success: true, movie: existing, cached: true };
        }
      }
    }

    // 2. 爬豆瓣
    const detail = await scrapeDoubanDetail(doubanId);

    // 3. OMDb
    const omdb = await fetchOmdb(detail.imdbId);

    // 4. 海报上传（每次都新上传，简单稳；后续可优化为复用旧 cloudPoster）
    const cloudPoster = await downloadAndUploadPoster(detail.posterUrl, movieDocId);

    const now = new Date();
    const movieData = {
      _id: movieDocId,
      doubanId,
      imdbId: detail.imdbId,
      title: detail.title,
      year: detail.year,
      directors: detail.directors,
      genres: detail.genres,
      poster: cloudPoster || detail.posterUrl,
      originalPoster: detail.posterUrl,
      douban: {
        rating: detail.douban.rating,
        votes: detail.douban.votes,
        fetchedAt: now
      },
      imdb: omdb.imdb ? { ...omdb.imdb, fetchedAt: now } : null,
      rottenTomatoes: omdb.rottenTomatoes ? { ...omdb.rottenTomatoes, fetchedAt: now } : null,
      omdbReason: omdb.reason,
      updatedAt: now,
      createTime: db.serverDate()
    };

    // 5. upsert searched_movies（用 set，避免 update 在文档不存在时静默成功的坑）
    await moviesCollection.doc(movieDocId).set({ data: movieData });

    // 6. upsert user_movie_queries
    if (openid) {
      await upsertUserQuery(openid, doubanId, movieDocId);
    }

    return { success: true, movie: movieData, cached: false };
  } catch (err) {
    console.error('fetchMovieFullInfo 失败:', err && err.message);
    return { success: false, error: err && err.message, doubanId };
  }
};
