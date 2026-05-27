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

// 豆瓣桌面端详情页反爬严，会 302 到 sec.douban.com 安全挑战页（需 JS 执行才能过）；
// 改走移动端 m.douban.com + iPhone UA，反爬明显宽松（fetchImdbMovies 已验证可用）
function buildDoubanHeaders() {
  return {
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.3 Mobile/15E148 Safari/604.1',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Referer': 'https://m.douban.com/'
  };
}

function buildRexxarUrl(doubanId) {
  return `https://m.douban.com/rexxar/api/v2/movie/${doubanId}`;
}

function buildMobileDetailUrl(doubanId) {
  return `https://m.douban.com/movie/subject/${doubanId}/`;
}

// frodo 路径在实测中始终返回 400 invalid_request_997（apikey 已被豆瓣废弃），
// 已弃用。保留函数签名为空实现，主流程靠 OMDb 按 original_title 反查搞定 IMDb ID。
async function fetchImdbIdFromFrodo(_doubanId) {
  return null;
}

// 从 m.douban.com 详情页 HTML 里提 IMDB ID，多种 pattern 都试一遍
function extractImdbIdFromHtml(html) {
  if (!html) return null;
  const patterns = [
    /IMDb:?\s*(tt\d+)/i,
    /imdb_id["']?\s*[:=]\s*["']?(tt\d+)/i,
    /imdb\.com\/title\/(tt\d+)/i,
    /["']?imdb["']?\s*:\s*["'](tt\d+)["']/i,
    /\btt(\d{7,})\b/  // 兜底：找任意 tt + 7~8 位数字
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m) {
      const id = m[1].startsWith('tt') ? m[1] : 'tt' + m[1];
      return id;
    }
  }
  return null;
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

// 并发调 rexxar JSON 接口（拿结构化主数据）+ 移动端详情页 HTML（仅用来正则提 IMDB ID）
// rexxar JSON 不返 imdb_id；HTML 接口反爬比桌面端 movie.douban.com 宽松（实测 200）
async function scrapeDoubanDetail(doubanId) {
  const headers = buildDoubanHeaders();

  const [rexxarRes, htmlRes, frodoImdbId] = await Promise.all([
    axios.get(buildRexxarUrl(doubanId), {
      headers,
      timeout: 15000,
      responseType: 'json'
    }),
    axios.get(buildMobileDetailUrl(doubanId), {
      headers,
      timeout: 15000,
      responseType: 'text',
      validateStatus: () => true
    }).catch(e => {
      console.warn('mobile_detail 抓取失败（不影响主流程）:', e && e.message);
      return { data: '' };
    }),
    fetchImdbIdFromFrodo(doubanId)
  ]);

  const j = (rexxarRes && rexxarRes.data) || {};
  const html = typeof (htmlRes && htmlRes.data) === 'string' ? htmlRes.data : '';

  // IMDB ID 提取优先级：frodo API > HTML 正则（m.douban HTML 实际不渲染 IMDb 字段，仅作兜底）
  let imdbId = frodoImdbId || extractImdbIdFromHtml(html);
  if (!imdbId) {
    console.log(`[scrapeDoubanDetail] IMDB ID 在 frodo / HTML 都未提取到（doubanId=${j.id || ''})，可能这部豆瓣未关联 IMDB`);
  } else {
    console.log(`[scrapeDoubanDetail] IMDB ID 命中: ${imdbId} (来源: ${frodoImdbId ? 'frodo' : 'html'})`);
  }

  // 从 rexxar 提其余结构化字段
  const title = j.title || '';
  const year = j.year || '';
  const posterUrl = j.cover_url || (j.pic && (j.pic.large || j.pic.normal)) || '';
  const genres = Array.isArray(j.genres) ? j.genres : [];
  const countries = Array.isArray(j.countries) ? j.countries : [];
  const languages = Array.isArray(j.languages) ? j.languages : [];
  const durations = Array.isArray(j.durations) ? j.durations : [];
  const directors = Array.isArray(j.directors)
    ? j.directors.map(d => d && d.name).filter(Boolean)
    : [];
  const rating = j.rating && j.rating.value != null ? Number(j.rating.value) : null;
  const votes = j.rating && j.rating.count != null ? Number(j.rating.count) : null;
  const intro = j.intro || '';

  const aka = Array.isArray(j.aka) ? j.aka : [];
  const originalTitle = j.original_title || '';

  return {
    title,
    originalTitle,
    year,
    posterUrl,
    directors,
    genres,
    countries,
    languages,
    durations,
    intro,
    aka,
    imdbId,
    douban: {
      rating: !isNaN(rating) ? rating : null,
      votes: !isNaN(votes) ? votes : null
    }
  };
}

// 从 detail 里挑一个英文标题用来 OMDb 反查：original_title 优先，否则 aka 里找不含中文字符的
function pickEnglishTitle(detail) {
  if (detail.originalTitle && !/[一-龥]/.test(detail.originalTitle)) {
    return detail.originalTitle;
  }
  if (Array.isArray(detail.aka)) {
    for (const a of detail.aka) {
      if (a && !/[一-龥]/.test(a)) return a;
    }
  }
  return null;
}

// 调 OMDb API，支持两种查询模式：
//   按 IMDB ID 精确查（imdbId 传入）
//   按片名 + 年份反查（title 传入，year 选填）
// 返回 { imdb, rottenTomatoes, imdbId, reason }
//   imdbId 在按 title 查时来自 OMDb 返回，用于补全豆瓣未提供的 IMDB 关联
async function fetchOmdb({ imdbId, title, year }) {
  const apiKey = process.env.OMDB_API_KEY;
  if (!apiKey) return { imdb: null, rottenTomatoes: null, imdbId: null, reason: 'no_api_key' };

  let url;
  if (imdbId) {
    url = `https://www.omdbapi.com/?i=${encodeURIComponent(imdbId)}&apikey=${encodeURIComponent(apiKey)}`;
  } else if (title) {
    const yearPart = year ? `&y=${encodeURIComponent(year)}` : '';
    url = `https://www.omdbapi.com/?t=${encodeURIComponent(title)}${yearPart}&apikey=${encodeURIComponent(apiKey)}`;
  } else {
    return { imdb: null, rottenTomatoes: null, imdbId: null, reason: 'no_query' };
  }

  try {
    const res = await axios.get(url, { timeout: 10000, responseType: 'json' });
    const data = res.data || {};
    if (data.Response === 'False') {
      return { imdb: null, rottenTomatoes: null, imdbId: null, reason: 'omdb_not_found' };
    }

    const imdbRating = parseFloat(data.imdbRating);
    const imdbVotes = parseInt(String(data.imdbVotes || '').replace(/,/g, ''), 10);
    const imdb = !isNaN(imdbRating) ? {
      rating: imdbRating,
      votes: !isNaN(imdbVotes) ? imdbVotes : null
    } : null;

    const rt = (data.Ratings || []).find(r => r && r.Source === 'Rotten Tomatoes');
    const rottenTomatoes = rt ? { score: rt.Value } : null;

    return {
      imdb,
      rottenTomatoes,
      imdbId: data.imdbID || imdbId || null,  // OMDb 返回的是 imdbID（大小写敏感）
      reason: 'ok'
    };
  } catch (e) {
    console.error('OMDb 调用失败:', e && e.message);
    return { imdb: null, rottenTomatoes: null, imdbId: null, reason: 'omdb_error' };
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
  const debug = !!(event && event.debug);
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

    // 3. OMDb：豆瓣有 IMDb ID 则精确查；没有就挑英文标题（original_title 或 aka 中的英文项）反查
    let omdb;
    if (detail.imdbId) {
      omdb = await fetchOmdb({ imdbId: detail.imdbId });
    } else {
      const enTitle = pickEnglishTitle(detail);
      if (enTitle) {
        console.log(`[OMDb] 豆瓣未提供 IMDb ID，用 title='${enTitle}' year='${detail.year}' 反查`);
        omdb = await fetchOmdb({ title: enTitle, year: detail.year });
        if (omdb.imdbId) {
          console.log(`[OMDb] 反查命中 imdbId=${omdb.imdbId}`);
        } else {
          console.log(`[OMDb] 反查失败，reason=${omdb.reason}`);
        }
      } else {
        console.log(`[OMDb] 没有可用的英文标题（originalTitle 为空且 aka 全是中文），跳过反查`);
        omdb = { imdb: null, rottenTomatoes: null, imdbId: null, reason: 'no_en_title' };
      }
    }
    const finalImdbId = detail.imdbId || omdb.imdbId || null;

    // 4. 海报上传（每次都新上传，简单稳；后续可优化为复用旧 cloudPoster）
    const cloudPoster = await downloadAndUploadPoster(detail.posterUrl, movieDocId);

    const now = new Date();
    const movieData = {
      _id: movieDocId,
      doubanId,
      imdbId: finalImdbId,
      title: detail.title,
      year: detail.year,
      directors: detail.directors,
      genres: detail.genres,
      countries: detail.countries,
      languages: detail.languages,
      durations: detail.durations,
      intro: detail.intro,
      aka: detail.aka,
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
    // 注意：doc(id).set() 的 data 不能含 _id 字段，否则报 -501007 "不能更新_id的值"
    const { _id: _omit, ...dataToSet } = movieData;
    await moviesCollection.doc(movieDocId).set({ data: dataToSet });

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
