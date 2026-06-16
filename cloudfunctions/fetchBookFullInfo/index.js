// 入参: { doubanId: string, openid?: string, forceRefresh?: boolean, skipUserQuery?: boolean }
// 流程（书只有豆瓣一个评分平台，远比电影简单）：
//   1. 当日缓存命中 → 直接返回 searched_books 数据
//   2. 否则爬豆瓣读书详情（评分 + 评分人数 + 作者 + 出版社 + 出版日期 + 封面 + 简介）
//   3. 封面镜像到云存储，upsert searched_books（+ 可选 user_book_queries）
//   4. 返回完整文档
//
// 说明：searched_books / user_book_queries 集合缺失时**降级为不缓存**（直接返回实时抓取结果），
// 因此即便没在云控制台建集合也能用；建了则享受当日缓存。

const cloud = require('wx-server-sdk');
const axios = require('axios');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const booksCollection = db.collection('searched_books');
const queriesCollection = db.collection('user_book_queries');

// 限流规则：同一自然日(中国时区 UTC+8) 内只允许「更新」一次。00:00 重置。
const CN_TZ_OFFSET_MS = 8 * 60 * 60 * 1000;

function cnDateStr(ts) {
  const d = new Date(ts + CN_TZ_OFFSET_MS);
  return d.toISOString().slice(0, 10);
}

function msUntilNextCnDay(nowMs) {
  const cnNow = new Date(nowMs + CN_TZ_OFFSET_MS);
  const cnMsIntoDay =
    cnNow.getUTCHours() * 3600000 +
    cnNow.getUTCMinutes() * 60000 +
    cnNow.getUTCSeconds() * 1000 +
    cnNow.getUTCMilliseconds();
  return 24 * 3600000 - cnMsIntoDay;
}

// 豆瓣桌面端反爬严，走移动端 m.douban.com + iPhone UA（与 fetchMovieFullInfo 同策略）
function buildDoubanHeaders() {
  return {
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.3 Mobile/15E148 Safari/604.1',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Referer': 'https://m.douban.com/'
  };
}

function buildRexxarUrl(doubanId) {
  return `https://m.douban.com/rexxar/api/v2/book/${doubanId}`;
}

function buildMobileDetailUrl(doubanId) {
  return `https://m.douban.com/book/subject/${doubanId}/`;
}

async function downloadAndUploadCover(imageUrl, bookDocId) {
  if (!imageUrl) return null;
  try {
    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 15000,
      headers: buildDoubanHeaders()
    });
    const fileName = `searched_book_covers/${bookDocId}_${Date.now()}.jpg`;
    const uploadResult = await cloud.uploadFile({
      cloudPath: fileName,
      fileContent: response.data
    });
    return uploadResult && uploadResult.fileID ? uploadResult.fileID : null;
  } catch (e) {
    console.error('封面下载/上传失败:', e && e.message);
    return null;
  }
}

// 从 HTML 兜底提评分（rexxar 失败时用）
function extractRatingFromHtml(html) {
  if (!html) return { rating: null, votes: null };
  let rating = null;
  let votes = null;
  const rm = html.match(/"ratingValue"\s*:\s*"?([\d.]+)"?/i)
    || html.match(/rating[_-]?value["']?\s*[:=]\s*["']?([\d.]+)/i);
  if (rm) rating = Number(rm[1]);
  const vm = html.match(/"ratingCount"\s*:\s*"?(\d+)"?/i)
    || html.match(/(\d+)\s*人评价/);
  if (vm) votes = Number(vm[1]);
  return {
    rating: rating != null && !isNaN(rating) ? rating : null,
    votes: votes != null && !isNaN(votes) ? votes : null
  };
}

// 并发抓 rexxar JSON（结构化主数据）+ 移动端详情页 HTML（兜底评分）
async function scrapeDoubanBookDetail(doubanId) {
  const headers = buildDoubanHeaders();

  const [rexxarRes, htmlRes] = await Promise.all([
    axios.get(buildRexxarUrl(doubanId), {
      headers,
      timeout: 15000,
      responseType: 'json',
      validateStatus: () => true
    }).catch(e => {
      console.warn('rexxar 抓取失败:', e && e.message);
      return { data: {} };
    }),
    axios.get(buildMobileDetailUrl(doubanId), {
      headers,
      timeout: 15000,
      responseType: 'text',
      transformResponse: x => x,
      validateStatus: () => true
    }).catch(e => {
      console.warn('mobile_detail 抓取失败:', e && e.message);
      return { data: '' };
    })
  ]);

  const j = (rexxarRes && typeof rexxarRes.data === 'object' && rexxarRes.data) || {};
  const html = typeof (htmlRes && htmlRes.data) === 'string' ? htmlRes.data : '';

  const title = j.title || '';
  const year = j.pubdate
    ? String(j.pubdate).slice(0, 4)
    : (j.year || '');
  const coverUrl = j.cover_url || (j.pic && (j.pic.large || j.pic.normal)) || '';
  const authors = Array.isArray(j.author) ? j.author.filter(Boolean)
    : (j.author ? [String(j.author)] : []);
  const translators = Array.isArray(j.translator) ? j.translator.filter(Boolean) : [];
  const publisher = j.press || j.publisher || '';
  const pubDate = j.pubdate || '';
  const intro = j.intro || (j.abstract || '');
  const isbn = j.isbn13 || j.isbn || '';

  let rating = j.rating && j.rating.value != null ? Number(j.rating.value) : null;
  let votes = j.rating && j.rating.count != null ? Number(j.rating.count) : null;

  // rexxar 没拿到评分 → HTML 兜底
  if (rating == null || isNaN(rating)) {
    const fromHtml = extractRatingFromHtml(html);
    if (fromHtml.rating != null) rating = fromHtml.rating;
    if (votes == null && fromHtml.votes != null) votes = fromHtml.votes;
  }

  return {
    title,
    year,
    coverUrl,
    authors,
    translators,
    publisher,
    pubDate,
    isbn,
    intro,
    douban: {
      rating: rating != null && !isNaN(rating) ? rating : null,
      votes: votes != null && !isNaN(votes) ? votes : null
    }
  };
}

async function upsertUserQuery(openid, doubanId, bookRefId) {
  try {
    const exist = await queriesCollection.where({ openid, doubanId }).limit(1).get();
    if (exist.data && exist.data.length > 0) {
      await queriesCollection.doc(exist.data[0]._id).update({ data: { bookRefId } });
    } else {
      await queriesCollection.add({
        data: { openid, doubanId, bookRefId, queriedAt: db.serverDate() }
      });
    }
  } catch (e) {
    // 集合不存在等 → 静默跳过（不影响主流程）
    console.warn('upsertUserQuery 跳过:', e && e.message);
  }
}

exports.main = async (event, context) => {
  const doubanId = String((event && event.doubanId) || '').trim();
  const forceRefresh = !!(event && event.forceRefresh);
  const wxCtx = cloud.getWXContext() || {};
  const openid = event && event.openid !== undefined ? event.openid : wxCtx.OPENID;
  const bypassCache = !!(event && event.bypassCache) && !openid;
  const skipUserQuery = !!(event && event.skipUserQuery);

  if (!doubanId) {
    return { success: false, error: 'EMPTY_DOUBAN_ID' };
  }

  const bookDocId = `book_search_${doubanId}`;
  console.log(`[fetchBookFullInfo] doubanId=${doubanId} forceRefresh=${forceRefresh} hasOpenid=${!!openid}`);

  try {
    // 1. 缓存检查（searched_books 缺失则视为无缓存，降级实时抓取）
    let existing = null;
    if (!bypassCache) {
      try {
        const r = await booksCollection.doc(bookDocId).get();
        existing = r && r.data;
      } catch (e) { /* 文档/集合不存在 */ }
    }

    const nowMs = Date.now();
    if (!bypassCache && existing) {
      const updatedMs = existing.updatedAt ? new Date(existing.updatedAt).getTime() : 0;
      const sameDay = updatedMs && cnDateStr(updatedMs) === cnDateStr(nowMs);
      if (!forceRefresh) {
        if (openid && !skipUserQuery) await upsertUserQuery(openid, doubanId, bookDocId);
        return { success: true, book: existing, cached: true, refreshLimited: false, nextRefreshAvailableInMs: 0 };
      }
      if (forceRefresh && sameDay) {
        if (openid && !skipUserQuery) await upsertUserQuery(openid, doubanId, bookDocId);
        return { success: true, book: existing, cached: true, refreshLimited: true, nextRefreshAvailableInMs: msUntilNextCnDay(nowMs) };
      }
    }

    // 2. 爬豆瓣读书
    const detail = await scrapeDoubanBookDetail(doubanId);

    // 3. 封面上传云存储
    const cloudCover = await downloadAndUploadCover(detail.coverUrl, bookDocId);

    const now = new Date();
    const bookData = {
      _id: bookDocId,
      doubanId,
      title: detail.title,
      year: detail.year,
      authors: detail.authors,
      author: detail.authors[0] || '',
      translators: detail.translators,
      publisher: detail.publisher,
      pubDate: detail.pubDate,
      isbn: detail.isbn,
      intro: detail.intro,
      cover: cloudCover || detail.coverUrl,
      originalCover: detail.coverUrl,
      douban: {
        rating: detail.douban.rating,
        votes: detail.douban.votes,
        fetchedAt: now
      },
      updatedAt: now,
      createTime: db.serverDate()
    };

    // 4. upsert searched_books（集合缺失则降级：不缓存，仍返回实时结果）
    try {
      const { _id: _omit, ...dataToSet } = bookData;
      await booksCollection.doc(bookDocId).set({ data: dataToSet });
      if (openid && !skipUserQuery) await upsertUserQuery(openid, doubanId, bookDocId);
    } catch (e) {
      console.warn('searched_books 写入跳过（集合可能未创建），降级为不缓存:', e && e.message);
    }

    return { success: true, book: bookData, cached: false };
  } catch (err) {
    console.error('fetchBookFullInfo 失败:', err && err.message);
    return { success: false, error: err && err.message, doubanId };
  }
};
