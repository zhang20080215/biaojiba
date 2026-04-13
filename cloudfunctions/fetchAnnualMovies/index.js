const cloud = require('wx-server-sdk');
const axios = require('axios');
const cheerio = require('cheerio');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

const COLLECTION = 'annual_movies';
const YEAR = 2026;
const FETCH_TIMEOUT_MS = 52000;
const ENRICH_TIMEOUT_MS = 52000;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/[：:]/g, ':')
    .trim();
}

function normalizeDateValue(value) {
  if (!value) return '';
  if (typeof value === 'object' && value.toDate) {
    return value.toDate().toISOString().slice(0, 10);
  }
  if (typeof value === 'object' && value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return String(value).replace(/\./g, '-').replace(/\//g, '-').slice(0, 10);
}

function getReleaseMonth(dateValue) {
  const normalized = normalizeDateValue(dateValue);
  const matched = normalized.match(/^(\d{4})-(\d{2})/);
  if (!matched) return '';
  return `${matched[1]}-${matched[2]}`;
}

function normalizeTitleKey(title) {
  return normalizeText(title)
    .toLowerCase()
    .replace(/[·•]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function buildDocKey(title, releaseDate) {
  return `${normalizeTitleKey(title)}__${normalizeDateValue(releaseDate)}`;
}

function toNumber(value) {
  if (value === undefined || value === null || value === '') return 0;
  const numeric = Number(String(value).replace(/[^\d.]/g, ''));
  return Number.isNaN(numeric) ? 0 : numeric;
}

function cleanCoverUrl(url) {
  const text = String(url || '').trim();
  if (!text) return '';
  return text.replace(/^http:/, 'https:');
}

function shouldKeepExisting(doc, fieldName) {
  if (!doc || doc.manuallyAdded !== true) return false;
  const value = doc[fieldName];
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function setIfPresent(target, fieldName, value) {
  if (value === undefined || value === null || value === '') return;
  target[fieldName] = value;
}

async function readAll(collectionName, query) {
  const countRes = await query.count();
  const total = countRes.total;
  if (total === 0) return [];

  const pageSize = 100;
  const tasks = [];
  for (let skip = 0; skip < total; skip += pageSize) {
    tasks.push(query.skip(skip).limit(pageSize).get());
  }

  const result = await Promise.all(tasks);
  let all = [];
  result.forEach((item) => {
    all = all.concat(item.data || []);
  });
  return all;
}

async function fetchMaoyanAppData() {
  const res = await axios.get('https://piaofang.maoyan.com/calendar', {
    timeout: 15000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
      'Accept-Language': 'zh-CN,zh;q=0.9'
    }
  });

  const html = res.data;
  const matched = html.match(/var\s+AppData\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/);
  if (!matched || !matched[1]) {
    throw new Error('无法从猫眼日历页面提取 AppData');
  }
  return JSON.parse(matched[1]);
}

function extractMoviesFromAppData(appData) {
  const movies = [];
  const seen = new Set();
  const moviesByDate = appData && appData.releaseList ? appData.releaseList.movies : null;
  if (!moviesByDate) return movies;

  Object.keys(moviesByDate).forEach((dateKey) => {
    const group = moviesByDate[dateKey];
    const list = group && group.list ? group.list : [];
    list.forEach((movie) => {
      const title = normalizeText(movie.nm);
      const releaseDate = normalizeDateValue(movie.rt || dateKey);
      const releaseYear = releaseDate ? Number(releaseDate.slice(0, 4)) : 0;
      if (!title || releaseYear !== YEAR) return;

      const dedupeKey = `${title}__${releaseDate}`;
      if (seen.has(dedupeKey)) return;
      seen.add(dedupeKey);

      movies.push({
        title,
        originalTitle: title,
        maoyanId: String(movie.id || ''),
        releaseDate,
        releaseMonth: getReleaseMonth(releaseDate),
        director: normalizeText(movie.dir),
        genre: normalizeText(movie.cat).replace(/\s*\/\s*/g, '/'),
        actor: normalizeText(movie.star),
        maoyanWish: Number(movie.wish || 0),
        maoyanScore: toNumber(movie.sc),
        coverUrl: cleanCoverUrl(movie.img),
        originalCover: cleanCoverUrl(movie.img)
      });
    });
  });

  return movies.sort((a, b) => String(a.releaseDate || '').localeCompare(String(b.releaseDate || '')));
}

async function fetchMaoyanComingList() {
  try {
    const res = await axios.get('https://m.maoyan.com/ajax/comingList?ci=1&limit=100&type=1&token=', {
      timeout: 12000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15',
        Referer: 'https://m.maoyan.com/'
      }
    });

    const list = res.data && res.data.coming ? res.data.coming : [];
    return list
      .map((movie) => {
        const title = normalizeText(movie.nm);
        const releaseDate = normalizeDateValue(movie.rt || '');
        const releaseYear = releaseDate ? Number(releaseDate.slice(0, 4)) : 0;
        if (!title || releaseYear !== YEAR) return null;
        return {
          title,
          originalTitle: title,
          maoyanId: String(movie.id || ''),
          releaseDate,
          releaseMonth: getReleaseMonth(releaseDate),
          director: normalizeText(movie.dir),
          genre: normalizeText(movie.cat).replace(/\s*\/\s*/g, '/'),
          actor: normalizeText(movie.star),
          maoyanWish: Number(movie.wish || 0),
          maoyanScore: toNumber(movie.sc),
          coverUrl: cleanCoverUrl(movie.img),
          originalCover: cleanCoverUrl(movie.img)
        };
      })
      .filter(Boolean);
  } catch (err) {
    console.warn('猫眼即将上映接口失败:', err.message);
    return [];
  }
}

function mergeFetchedMovies(primary, secondary) {
  const merged = [];
  const seen = new Set();
  [...primary, ...secondary].forEach((movie) => {
    const key = buildDocKey(movie.title, movie.releaseDate);
    if (!key || seen.has(key)) return;
    seen.add(key);
    merged.push(movie);
  });
  return merged.sort((a, b) => String(a.releaseDate || '').localeCompare(String(b.releaseDate || '')));
}

function buildLookupMaps(existingDocs) {
  const byMaoyanId = new Map();
  const byDocKey = new Map();

  existingDocs.forEach((doc) => {
    if (doc.maoyanId) byMaoyanId.set(String(doc.maoyanId), doc);
    byDocKey.set(buildDocKey(doc.title, doc.releaseDate), doc);
  });

  return { byMaoyanId, byDocKey };
}

async function downloadAndUploadImage(imageUrl, fileName) {
  try {
    const response = await axios({
      url: imageUrl,
      responseType: 'arraybuffer',
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Referer: 'https://movie.douban.com/'
      }
    });

    const uploadResult = await cloud.uploadFile({
      cloudPath: `annual_covers/${fileName}_${Date.now()}.jpg`,
      fileContent: response.data
    });
    return uploadResult.fileID;
  } catch (err) {
    console.warn('upload cover failed:', err.message);
    return '';
  }
}

async function fetchDoubanInfo(movie) {
  const queries = [
    `${movie.title} ${YEAR}`,
    movie.title,
    movie.originalTitle ? `${movie.originalTitle} ${YEAR}` : '',
    movie.originalTitle || ''
  ].filter(Boolean);

  for (const query of queries) {
    try {
      const res = await axios.get(`https://m.douban.com/search/?query=${encodeURIComponent(query)}`, {
        timeout: 12000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.3 Mobile/15E148 Safari/604.1',
          'Accept-Charset': 'utf-8'
        }
      });

      const $ = cheerio.load(res.data);
      const candidates = [];

      $('.search-module li').each((index, element) => {
        const href = $(element).find('a').attr('href') || '';
        if (!href.includes('/movie/subject/')) return;

        const title = normalizeText($(element).find('.subject-title').first().text()) || normalizeText($(element).find('img').attr('alt'));
        const ratingText = normalizeText($(element).find('.rating span:nth-child(2)').text());
        const coverUrl = cleanCoverUrl($(element).find('img').attr('src'));
        const infoText = normalizeText($(element).text());
        const idMatch = href.match(/\/subject\/(\d+)\//);
        candidates.push({
          doubanId: idMatch ? idMatch[1] : '',
          title,
          rating: toNumber(ratingText),
          coverUrl,
          yearMatched: infoText.includes(String(YEAR))
        });
      });

      const best = candidates.find((item) => item.yearMatched) || candidates[0];
      if (best && best.doubanId) {
        return best;
      }
    } catch (err) {
      console.warn(`douban search failed for "${query}":`, err.message);
    }
    await wait(250);
  }

  return null;
}

async function fetchImdbInfo(movie) {
  const query = normalizeText(movie.originalTitle || movie.title || '');
  if (!query) return null;

  try {
    const firstChar = /^[a-z0-9]/i.test(query[0]) ? query[0].toLowerCase() : 'x';
    const encoded = encodeURIComponent(query.toLowerCase());
    const url = `https://v3.sg.media-imdb.com/suggestion/${firstChar}/${encoded}.json`;
    const res = await axios.get(url, {
      timeout: 12000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });

    const list = res.data && Array.isArray(res.data.d) ? res.data.d : [];
    if (!list.length) return null;

    const targetTitleKey = normalizeTitleKey(movie.originalTitle || movie.title);
    const ranked = list
      .filter((item) => item && item.id && (item.qid === 'movie' || item.q === 'feature'))
      .map((item) => {
        const yearDiff = item.y ? Math.abs(Number(item.y) - YEAR) : 99;
        const titleKey = normalizeTitleKey(item.l);
        const titleMatched = titleKey === targetTitleKey || titleKey.includes(targetTitleKey) || targetTitleKey.includes(titleKey);
        return {
          imdbId: item.id,
          imdbTitle: item.l || '',
          imdbRating: 0,
          weight: (titleMatched ? 0 : 100) + yearDiff
        };
      })
      .sort((a, b) => a.weight - b.weight);

    return ranked[0] || null;
  } catch (err) {
    console.warn(`imdb suggestion failed for "${query}":`, err.message);
    return null;
  }
}

async function fetchRottenTomatoesInfo(movie) {
  const queries = [movie.originalTitle, movie.title].filter(Boolean);

  for (const query of queries) {
    try {
      const res = await axios.get(`https://www.rottentomatoes.com/search?search=${encodeURIComponent(query)}`, {
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept-Language': 'en-US,en;q=0.9'
        }
      });

      const $ = cheerio.load(res.data, { xmlMode: false });
      const rows = $('search-page-result[type="movie"] search-page-media-row');
      if (!rows.length) continue;

      const targetTitleKey = normalizeTitleKey(movie.originalTitle || movie.title);
      const candidates = [];

      rows.each((index, element) => {
        const row = $(element);
        const title = normalizeText(row.find('a[slot="title"]').text() || row.find('img').attr('alt'));
        const year = Number(row.attr('release-year') || 0);
        const score = toNumber(row.attr('tomatometer-score'));
        const href = row.find('a[slot="title"]').attr('href') || row.find('a[slot="thumbnail"]').attr('href') || '';
        const titleKey = normalizeTitleKey(title);
        const titleMatched = titleKey === targetTitleKey || titleKey.includes(targetTitleKey) || targetTitleKey.includes(titleKey);

        candidates.push({
          rtTitle: title,
          rottenTomatoes: score,
          rtUrl: href,
          weight: (titleMatched ? 0 : 100) + Math.abs((year || YEAR) - YEAR)
        });
      });

      const best = candidates.sort((a, b) => a.weight - b.weight)[0];
      if (best) return best;
    } catch (err) {
      console.warn(`rotten tomatoes search failed for "${query}":`, err.message);
    }
    await wait(250);
  }

  return null;
}

async function fetchExistingAnnualDocs() {
  return readAll(COLLECTION, db.collection(COLLECTION).where({ year: _.eq(YEAR) }));
}

function buildFetchUpdateData(existingDoc, sourceMovie) {
  const updateData = {
    year: YEAR,
    theme: 'annual_movies',
    isTop250: true,
    sourceUpdatedAt: new Date(),
    updateTime: new Date()
  };

  const baseAssignments = {
    title: sourceMovie.title,
    originalTitle: sourceMovie.originalTitle || sourceMovie.title,
    releaseDate: sourceMovie.releaseDate,
    releaseMonth: sourceMovie.releaseMonth || getReleaseMonth(sourceMovie.releaseDate),
    director: sourceMovie.director,
    genre: sourceMovie.genre,
    actor: sourceMovie.actor,
    maoyanId: sourceMovie.maoyanId,
    maoyanWish: sourceMovie.maoyanWish,
    maoyanScore: sourceMovie.maoyanScore,
    coverUrl: sourceMovie.coverUrl,
    originalCover: sourceMovie.originalCover || sourceMovie.coverUrl
  };

  Object.keys(baseAssignments).forEach((fieldName) => {
    const value = baseAssignments[fieldName];
    if (value === undefined || value === null || value === '') return;

    if (!existingDoc) {
      updateData[fieldName] = value;
      return;
    }

    if (shouldKeepExisting(existingDoc, fieldName)) return;

    const oldValue = existingDoc[fieldName];
    if (oldValue === undefined || oldValue === null || oldValue === '' || fieldName === 'maoyanWish' || fieldName === 'maoyanScore') {
      updateData[fieldName] = value;
    }
  });

  return updateData;
}

async function syncFetchedMovies(event = {}) {
  const startAt = Date.now();
  const existingDocs = await fetchExistingAnnualDocs();
  const { byMaoyanId, byDocKey } = buildLookupMaps(existingDocs);

  let sourceMovies = [];
  try {
    const appData = await fetchMaoyanAppData();
    sourceMovies = extractMoviesFromAppData(appData);
  } catch (err) {
    console.warn('猫眼日历抓取失败:', err.message);
  }

  const comingMovies = await fetchMaoyanComingList();
  const mergedMovies = mergeFetchedMovies(sourceMovies, comingMovies);
  if (!mergedMovies.length) {
    return { success: false, action: 'fetch', error: '未获取到任何年度电影数据' };
  }

  let added = 0;
  let updated = 0;
  let processed = 0;
  let stoppedEarly = false;

  for (let index = 0; index < mergedMovies.length; index++) {
    if (Date.now() - startAt > FETCH_TIMEOUT_MS) {
      stoppedEarly = true;
      break;
    }

    const movie = mergedMovies[index];
    const existingDoc = movie.maoyanId
      ? byMaoyanId.get(String(movie.maoyanId))
      : byDocKey.get(buildDocKey(movie.title, movie.releaseDate));

    const updateData = buildFetchUpdateData(existingDoc, movie);

    if (existingDoc) {
      await db.collection(COLLECTION).doc(existingDoc._id).update({ data: updateData });
      updated++;
    } else {
      const doc = {
        rank: existingDocs.length + added + 1,
        createTime: new Date(),
        manuallyAdded: false,
        doubanRating: 0,
        imdbRating: 0,
        rottenTomatoes: 0,
        imdbId: '',
        doubanId: '',
        ...updateData
      };
      await db.collection(COLLECTION).add({ data: doc });
      added++;
    }

    processed++;
  }

  return {
    success: true,
    action: 'fetch',
    totalFromSource: mergedMovies.length,
    processed,
    added,
    updated,
    stoppedEarly
  };
}

function needsEnrichment(doc, options = {}) {
  if (options.coverOnly) {
    return !!(doc.coverUrl || doc.originalCover) && !(doc.cover && String(doc.cover).startsWith('cloud://'));
  }

  return !doc.doubanRating
    || !doc.imdbId
    || !doc.rottenTomatoes
    || !(doc.cover && String(doc.cover).startsWith('cloud://'));
}

async function enrichAnnualMovies(event = {}) {
  const startAt = Date.now();
  const startFrom = Number(event.startFrom || 0);
  const coverOnly = !!event.coverOnly || event.action === 'covers';
  const docs = (await fetchExistingAnnualDocs())
    .sort((a, b) => String(normalizeDateValue(a.releaseDate)).localeCompare(String(normalizeDateValue(b.releaseDate))))
    .filter((doc) => needsEnrichment(doc, { coverOnly }));

  let processed = 0;
  let updated = 0;
  let failed = 0;
  let stoppedEarly = false;
  let lastRank = startFrom;

  for (let index = 0; index < docs.length; index++) {
    const doc = docs[index];
    if (doc.rank < startFrom) continue;
    if (Date.now() - startAt > ENRICH_TIMEOUT_MS) {
      stoppedEarly = true;
      break;
    }

    const updateData = {
      lastEnrichedAt: new Date(),
      updateTime: new Date()
    };

    try {
      let doubanInfo = null;
      let imdbInfo = null;
      let rtInfo = null;

      if (!coverOnly) {
        if (!doc.doubanRating || !doc.doubanId || !(doc.cover && String(doc.cover).startsWith('cloud://'))) {
          doubanInfo = await fetchDoubanInfo(doc);
          await wait(300);
        }
        if (!doc.imdbId) {
          imdbInfo = await fetchImdbInfo(doc);
          await wait(200);
        }
        if (!doc.rottenTomatoes) {
          rtInfo = await fetchRottenTomatoesInfo(doc);
          await wait(300);
        }
      } else if (!(doc.cover && String(doc.cover).startsWith('cloud://'))) {
        doubanInfo = await fetchDoubanInfo(doc);
        await wait(300);
      }

      if (doubanInfo) {
        if (!shouldKeepExisting(doc, 'doubanId')) setIfPresent(updateData, 'doubanId', doubanInfo.doubanId);
        if (!shouldKeepExisting(doc, 'doubanRating') && doubanInfo.rating > 0) setIfPresent(updateData, 'doubanRating', doubanInfo.rating);
        if (!shouldKeepExisting(doc, 'coverUrl') && doubanInfo.coverUrl) {
          setIfPresent(updateData, 'coverUrl', doubanInfo.coverUrl);
          setIfPresent(updateData, 'originalCover', doubanInfo.coverUrl);
        }

        if (!(doc.cover && String(doc.cover).startsWith('cloud://')) && doubanInfo.coverUrl) {
          const cloudCover = await downloadAndUploadImage(doubanInfo.coverUrl, `annual_${doubanInfo.doubanId || doc._id}`);
          if (cloudCover) updateData.cover = cloudCover;
        }
      }

      if (imdbInfo) {
        if (!shouldKeepExisting(doc, 'imdbId')) setIfPresent(updateData, 'imdbId', imdbInfo.imdbId);
        if (!shouldKeepExisting(doc, 'imdbTitle')) setIfPresent(updateData, 'imdbTitle', imdbInfo.imdbTitle);
        if (!shouldKeepExisting(doc, 'imdbRating') && imdbInfo.imdbRating > 0) setIfPresent(updateData, 'imdbRating', imdbInfo.imdbRating);
      }

      if (rtInfo) {
        if (!shouldKeepExisting(doc, 'rottenTomatoes') && rtInfo.rottenTomatoes > 0) setIfPresent(updateData, 'rottenTomatoes', rtInfo.rottenTomatoes);
        if (!shouldKeepExisting(doc, 'rtUrl')) setIfPresent(updateData, 'rtUrl', rtInfo.rtUrl);
      }

      const usefulKeys = Object.keys(updateData).filter((fieldName) => !['lastEnrichedAt', 'updateTime'].includes(fieldName));
      if (usefulKeys.length > 0) {
        await db.collection(COLLECTION).doc(doc._id).update({ data: updateData });
        updated++;
      }
    } catch (err) {
      console.warn(`enrich failed for ${doc.title}:`, err.message);
      failed++;
    }

    processed++;
    lastRank = doc.rank || lastRank;
  }

  return {
    success: true,
    action: coverOnly ? 'covers' : 'enrich',
    processed,
    updated,
    failed,
    stoppedEarly,
    lastRank
  };
}

exports.main = async (event = {}, context) => {
  const action = event.action || 'sync';

  try {
    if (action === 'fetch') {
      return await syncFetchedMovies(event);
    }

    if (action === 'enrich') {
      return await enrichAnnualMovies(event);
    }

    if (action === 'covers') {
      return await enrichAnnualMovies({ ...event, coverOnly: true, action: 'covers' });
    }

    if (action === 'sync') {
      const fetchResult = await syncFetchedMovies(event);
      if (!fetchResult.success) return fetchResult;

      const enrichResult = await enrichAnnualMovies(event);
      return {
        success: true,
        action: 'sync',
        fetch: fetchResult,
        enrich: enrichResult
      };
    }

    return {
      success: false,
      error: `未知操作: ${action}`,
      usage: '支持 action=sync | fetch | enrich | covers'
    };
  } catch (err) {
    console.error('fetchAnnualMovies error:', err);
    return { success: false, error: err.message };
  }
};
