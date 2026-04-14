const cloud = require('wx-server-sdk');
const axios = require('axios');
const cheerio = require('cheerio');
const awardMovies = require('./awardsData');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const COLLECTION = 'chinese_award_movies';
const THEME = 'chinese_awards';
const RUN_TIMEOUT_MS = 52000;
const DEFAULT_BATCH_LIMIT = 12;
const MOBILE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.3 Mobile/15E148 Safari/604.1',
  'Accept-Charset': 'utf-8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
};
const DESKTOP_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  Referer: 'https://movie.douban.com/'
};
const PLATFORM_KEYWORDS = [
  '腾讯视频',
  '爱奇艺',
  '优酷',
  '哔哩哔哩',
  '哔哩哔哩电影',
  '芒果TV',
  '咪咕视频',
  '搜狐视频',
  '乐视视频',
  '1905电影网',
  '西瓜视频',
  '央视频'
];

function normalizeRecord(record = {}) {
  return {
    awardName: String(record.awardName || '').trim(),
    awardKey: String(record.awardKey || '').trim().toLowerCase(),
    awardYear: Number(record.awardYear) || 0,
    awardCeremony: String(record.awardCeremony || '').trim(),
    title: String(record.title || '').trim()
  };
}

function isValidRecord(record) {
  return !!(record.awardName && record.awardKey && record.awardYear && record.awardCeremony && record.title);
}

function extractYear(text = '') {
  const match = String(text).match(/(19|20)\d{2}/);
  return match ? Number(match[0]) : 0;
}

function buildSearchQueries(record) {
  return [`${record.title} ${record.awardYear}`, record.title].filter(Boolean);
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  const result = [];
  items.forEach(item => {
    const key = keyFn(item);
    if (!key || seen.has(key)) return;
    seen.add(key);
    result.push(item);
  });
  return result;
}

function pickBestCandidate(candidates = [], targetYear = 0) {
  if (!candidates.length) return null;
  const exactYear = candidates.find(item => item.year && item.year === targetYear);
  if (exactYear) return exactYear;
  return candidates[0];
}

function extractPlatforms($) {
  const platforms = new Set();

  $('body a').each((_, el) => {
    const text = $(el).text().trim();
    if (PLATFORM_KEYWORDS.includes(text)) platforms.add(text);
  });

  const bodyText = $('body').text();
  PLATFORM_KEYWORDS.forEach(name => {
    if (bodyText.includes(name)) platforms.add(name);
  });

  return Array.from(platforms);
}

function extractInfoValue(infoText, label) {
  const safeLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`${safeLabel}[\\s:：]*([^\\n]+)`);
  const match = String(infoText || '').match(regex);
  return match ? match[1].trim() : '';
}

function normalizeCandidate(candidate = {}) {
  return {
    doubanId: String(candidate.doubanId || '').trim(),
    title: String(candidate.title || '').trim(),
    coverUrl: String(candidate.coverUrl || '').trim(),
    rating: Number(candidate.rating) || 0,
    year: Number(candidate.year) || 0
  };
}

async function fetchBySuggest(query) {
  try {
    const res = await axios.get(`https://movie.douban.com/j/subject_suggest?q=${encodeURIComponent(query)}`, {
      timeout: 8000,
      headers: DESKTOP_HEADERS
    });

    return (Array.isArray(res.data) ? res.data : []).map(item => normalizeCandidate({
      doubanId: item.id,
      title: item.title,
      coverUrl: item.img,
      year: extractYear(item.year),
      rating: 0
    }));
  } catch (error) {
    console.warn(`Douban suggest failed for "${query}":`, error.message);
    return [];
  }
}

async function fetchByMobileSearch(query) {
  try {
    const res = await axios.get(`https://m.douban.com/search/?query=${encodeURIComponent(query)}&type=movie`, {
      timeout: 10000,
      headers: MOBILE_HEADERS,
      responseType: 'text',
      responseEncoding: 'utf8'
    });

    const $ = cheerio.load(res.data);
    const candidates = [];

    $('.search-results .search-result, .search-module li').each((_, el) => {
      const href = $(el).find('a').attr('href') || '';
      if (!href.includes('/movie/subject/')) return;

      const match = href.match(/\/subject\/(\d+)\//);
      const doubanId = match ? match[1] : '';
      if (!doubanId) return;

      const title = ($(el).find('.subject-title').first().text() || $(el).find('img').attr('alt') || '').trim();
      const ratingText = ($(el).find('.rating span').last().text() || $(el).find('.rating_nums').text() || '').trim();
      const coverUrl = $(el).find('img').attr('src') || '';
      const infoText = $(el).text().trim();

      candidates.push(normalizeCandidate({
        doubanId,
        title,
        coverUrl,
        rating: ratingText,
        year: extractYear(infoText)
      }));
    });

    return candidates;
  } catch (error) {
    console.warn(`Douban mobile search failed for "${query}":`, error.message);
    return [];
  }
}

async function fetchDoubanSubject(record) {
  for (const query of buildSearchQueries(record)) {
    const candidates = uniqueBy([
      ...(await fetchBySuggest(query)),
      ...(await fetchByMobileSearch(query))
    ], item => item.doubanId);

    const best = pickBestCandidate(candidates, record.awardYear);
    if (best && best.doubanId) return best;
  }

  return null;
}

async function fetchDoubanDetails(doubanId) {
  const urls = [
    {
      url: `https://m.douban.com/movie/subject/${doubanId}/`,
      headers: {
        ...MOBILE_HEADERS,
        Referer: 'https://m.douban.com/'
      }
    },
    {
      url: `https://movie.douban.com/subject/${doubanId}/`,
      headers: DESKTOP_HEADERS
    }
  ];

  for (const entry of urls) {
    try {
      const res = await axios.get(entry.url, {
        timeout: 12000,
        headers: entry.headers,
        responseType: 'text',
        responseEncoding: 'utf8'
      });

      const $ = cheerio.load(res.data);
      const infoText = $('#info').text().replace(/\u00a0/g, ' ');
      const summary = $('span[property="v:summary"]').text().replace(/\s+/g, ' ').trim();
      const title = $('title').text().replace('(豆瓣)', '').replace('(Douban)', '').trim();
      const coverUrl = $('#mainpic img').attr('src') || $('.subject-pic img').attr('src') || '';
      const ratingText = $('strong[property="v:average"]').text().trim() || $('.rating_num').first().text().trim();
      const genres = [];
      $('span[property="v:genre"], .subject-info .meta span').each((_, el) => {
        const text = $(el).text().trim();
        if (text && !genres.includes(text)) genres.push(text);
      });

      const directors = [];
      $('#info a[rel="v:directedBy"], .subject-info .director a').each((_, el) => {
        const text = $(el).text().trim();
        if (text && !directors.includes(text)) directors.push(text);
      });

      const actors = [];
      $('#info .actor .attrs a, .subject-info .cast a').each((_, el) => {
        const text = $(el).text().trim();
        if (text && !actors.includes(text)) actors.push(text);
      });

      const details = {
        title,
        coverUrl,
        rating: ratingText ? Number(ratingText) || 0 : 0,
        director: directors.join(' / '),
        directors,
        actors,
        genres,
        region: extractInfoValue(infoText, '制片国家/地区'),
        releaseYear: extractYear(infoText || title),
        duration: extractInfoValue(infoText, '片长'),
        summary,
        playPlatforms: extractPlatforms($)
      };

      if (details.title || details.coverUrl || details.rating || details.director || details.summary) {
        return details;
      }
    } catch (error) {
      console.warn(`Douban detail failed for "${doubanId}" via ${entry.url}:`, error.message);
    }
  }

  return null;
}

function buildFallbackDetails(record, doubanSubject) {
  return {
    title: record.title,
    coverUrl: doubanSubject.coverUrl || '',
    rating: doubanSubject.rating || 0,
    director: '',
    directors: [],
    actors: [],
    genres: [],
    region: '',
    releaseYear: record.awardYear,
    duration: '',
    summary: '',
    playPlatforms: []
  };
}

async function downloadAndUploadImage(imageUrl, fileKey) {
  if (!imageUrl) return '';

  try {
    const highResUrl = imageUrl.replace('/s_ratio_poster/', '/m_ratio_poster/');
    const response = await axios({
      url: highResUrl,
      responseType: 'arraybuffer',
      timeout: 15000,
      headers: {
        ...DESKTOP_HEADERS,
        Referer: 'https://movie.douban.com/'
      }
    });

    const uploadResult = await cloud.uploadFile({
      cloudPath: `award_covers/${fileKey}_${Date.now()}.jpg`,
      fileContent: response.data
    });
    return uploadResult.fileID;
  } catch (error) {
    console.warn(`Upload cover failed for "${fileKey}":`, error.message);
    return imageUrl;
  }
}

async function upsertAwardMovie(record, doubanSubject, doubanDetails) {
  const coverUrl = doubanDetails.coverUrl || doubanSubject.coverUrl || '';
  const cloudCover = coverUrl
    ? await downloadAndUploadImage(coverUrl, `${record.awardKey}_${record.awardYear}_${doubanSubject.doubanId}`)
    : '';

  const data = {
    theme: THEME,
    isTop250: true,
    awardName: record.awardName,
    awardKey: record.awardKey,
    awardYear: record.awardYear,
    awardCeremony: record.awardCeremony,
    title: record.title,
    doubanId: doubanSubject.doubanId,
    rating: doubanDetails.rating || doubanSubject.rating || 0,
    cover: cloudCover,
    originalCover: coverUrl,
    coverUrl,
    director: doubanDetails.director || '',
    directors: doubanDetails.directors || [],
    actors: doubanDetails.actors || [],
    genres: doubanDetails.genres || [],
    region: doubanDetails.region || '',
    releaseYear: doubanDetails.releaseYear || record.awardYear,
    duration: doubanDetails.duration || '',
    summary: doubanDetails.summary || '',
    playPlatforms: doubanDetails.playPlatforms || [],
    playPlatformsText: (doubanDetails.playPlatforms || []).join(' / '),
    rank: record.awardYear,
    updateTime: new Date()
  };

  const existing = await db.collection(COLLECTION).where({
    awardKey: record.awardKey,
    awardYear: record.awardYear,
    title: record.title
  }).get();

  if (existing.data.length > 0) {
    await db.collection(COLLECTION).doc(existing.data[0]._id).update({ data });
    return 'updated';
  }

  await db.collection(COLLECTION).add({ data });
  return 'added';
}

exports.main = async (event = {}) => {
  const action = event.action || 'sync';
  if (action !== 'sync') {
    return { success: false, error: `Unsupported action: ${action}` };
  }

  const startAt = Date.now();
  const startFrom = Math.max(0, Number(event.startFrom || 0));
  const limit = Math.max(1, Number(event.limit || DEFAULT_BATCH_LIMIT));
  const sourceList = Array.isArray(event.items) && event.items.length ? event.items : awardMovies;
  const normalizedList = sourceList.map(normalizeRecord).filter(isValidRecord);
  const batch = normalizedList.slice(startFrom, startFrom + limit);

  let added = 0;
  let updated = 0;
  let processed = 0;
  let stoppedEarly = false;
  const skipped = [];
  let nextStartFrom = startFrom;

  for (const record of batch) {
    if (Date.now() - startAt > RUN_TIMEOUT_MS) {
      stoppedEarly = true;
      break;
    }

    const doubanSubject = await fetchDoubanSubject(record);
    if (!doubanSubject || !doubanSubject.doubanId) {
      skipped.push({
        awardKey: record.awardKey,
        awardYear: record.awardYear,
        title: record.title,
        reason: 'douban_not_found'
      });
      processed += 1;
      nextStartFrom = startFrom + processed;
      continue;
    }

    const doubanDetails = await fetchDoubanDetails(doubanSubject.doubanId) || buildFallbackDetails(record, doubanSubject);
    const result = await upsertAwardMovie(record, doubanSubject, doubanDetails);
    if (result === 'added') added += 1;
    if (result === 'updated') updated += 1;

    processed += 1;
    nextStartFrom = startFrom + processed;
  }

  const completed = nextStartFrom >= normalizedList.length;

  return {
    success: true,
    theme: THEME,
    collection: COLLECTION,
    totalInput: normalizedList.length,
    startFrom,
    limit,
    processed,
    added,
    updated,
    skipped,
    stoppedEarly,
    nextStartFrom,
    completed,
    remaining: Math.max(0, normalizedList.length - nextStartFrom)
  };
};
