// 每日读书 · 晋江文学城（jjwxc）搜索 / 详情。action 分发：
//   { action:'search', keyword }                → { success, candidates:[{doubanId:'jj_<id>', source:'jjwxc', title, author, serialText, finished, novelType}] }
//   { action:'detail', novelid, forceRefresh? } → { success, book:{ doubanId, title, author, wordCount, chapterCount, collectedCount, cover, finished, ... } }
//
// 书的唯一键沿用每日读书的 meta.doubanId 字段，晋江书写成 'jj_<novelid>'（去重 / 继续阅读 / suggestReadDays 全按它）。
// 简介（intro）只入库、不返回给前端：存进 searched_books 的 book_search_jj_<novelid>（与豆瓣书同集合，
// 这样 syncDailyLog.migrateCovers 的「云→云封面镜像」也能按 book_search_${doubanId} 找到）。
// 晋江没有页数也没有评分：进度单位由前端记为「章」，总数 = chapterCount；热度用 collectedCount。
// 抓取：搜索页 search.php?kw=<GBK>&t=1（只取第 1 页 25 条，不逐条拉详情）；详情只在用户选中时拉一次，
// 同北京日当日缓存。页面是 gb18030，解析见 parse.js。

const cloud = require('wx-server-sdk');
const axios = require('axios');
const { encodeGbkQuery, decodeBody, searchTotal, parseSearch, parseDetail } = require('./parse.js');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const booksCollection = db.collection('searched_books');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const CN_TZ_OFFSET_MS = 8 * 60 * 60 * 1000;

function cnDateStr(ts) {
  return new Date(ts + CN_TZ_OFFSET_MS).toISOString().slice(0, 10);
}

function msUntilNextCnDay(nowMs) {
  const d = new Date(nowMs + CN_TZ_OFFSET_MS);
  const into = d.getUTCHours() * 3600000 + d.getUTCMinutes() * 60000 + d.getUTCSeconds() * 1000 + d.getUTCMilliseconds();
  return 24 * 3600000 - into;
}

async function getHtml(url) {
  const res = await axios.get(url, {
    headers: {
      'User-Agent': UA,
      'Referer': 'https://www.jjwxc.net/',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9'
    },
    timeout: 12000,
    responseType: 'arraybuffer',
    validateStatus: () => true
  });
  const html = res.data && res.data.length ? decodeBody(res.data) : '';
  return { status: res.status, html };
}

async function search(event) {
  const keyword = String(event.keyword || '').trim();
  if (!keyword) return { success: false, error: 'EMPTY_KEYWORD' };

  const { status, html } = await getHtml(`https://www.jjwxc.net/search.php?kw=${encodeGbkQuery(keyword)}&t=1`);
  const candidates = status < 400 && html ? parseSearch(html) : [];
  // 既没解析出结果、也没有「共找到 N 篇文章」→ 不是正常搜索页（被拦 / 改版），别当成「没搜到」
  if (!candidates.length && (status >= 400 || searchTotal(html) === null)) {
    console.warn(`[jjwxcBook] search BLOCKED status=${status} len=${html.length}`);
    return { success: false, code: 'BLOCKED', error: '晋江暂时无法访问，请稍后重试', keyword };
  }
  return { success: true, candidates, keyword };
}

async function downloadAndUploadCover(imageUrl, docId) {
  if (!imageUrl) return null;
  try {
    const res = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 15000,
      headers: { 'User-Agent': UA, 'Referer': 'https://www.jjwxc.net/' }
    });
    const up = await cloud.uploadFile({
      cloudPath: `searched_book_covers/${docId}_${Date.now()}.jpg`,
      fileContent: res.data
    });
    return up && up.fileID ? up.fileID : null;
  } catch (e) {
    console.error('晋江封面下载/上传失败:', e && e.message);
    return null;
  }
}

// searched_books 里的文档 → 返回给前端的 book（不带 intro）
function toClientBook(doc) {
  return {
    doubanId: doc.doubanId,
    source: 'jjwxc',
    title: doc.title,
    author: doc.author,
    novelType: doc.novelType,
    serialText: doc.serialText,
    finished: !!doc.finished,
    wordCount: doc.wordCount || 0,
    chapterCount: doc.chapterCount || 0,
    collectedCount: doc.collectedCount || 0,
    cover: doc.cover || '',
    lastUpdate: doc.lastUpdate || ''
  };
}

async function detail(event) {
  const novelid = String(event.novelid || '').replace(/\D/g, '');
  if (!novelid) return { success: false, error: 'EMPTY_NOVEL_ID' };
  const forceRefresh = !!event.forceRefresh;
  const docId = `book_search_jj_${novelid}`;
  const nowMs = Date.now();

  let cached = null;
  try {
    const r = await booksCollection.doc(docId).get();
    cached = r && r.data;
  } catch (e) { /* 文档 / 集合不存在 */ }

  if (cached && cached.source === 'jjwxc' && cached.chapterCount !== undefined) {
    const updatedMs = cached.updatedAt ? new Date(cached.updatedAt).getTime() : 0;
    const sameDay = updatedMs && cnDateStr(updatedMs) === cnDateStr(nowMs);
    // 连载书章节数会涨：非强刷时只在当日内走缓存，隔天选中会重抓一次
    if (sameDay && !forceRefresh) return { success: true, book: toClientBook(cached), cached: true };
    if (sameDay && forceRefresh) {
      return { success: true, book: toClientBook(cached), cached: true, refreshLimited: true, nextRefreshAvailableInMs: msUntilNextCnDay(nowMs) };
    }
  }

  const { status, html } = await getHtml(`https://www.jjwxc.net/onebook.php?novelid=${novelid}`);
  const d = status < 400 && html ? parseDetail(html) : null;
  if (!d) {
    console.warn(`[jjwxcBook] detail failed novelid=${novelid} status=${status} len=${html.length}`);
    // 拿不到时若有旧缓存，宁可给旧的也别让用户卡住
    if (cached && cached.source === 'jjwxc') return { success: true, book: toClientBook(cached), cached: true, stale: true };
    return { success: false, code: 'BLOCKED', error: '晋江暂时无法访问，请稍后重试', novelid };
  }

  // 封面：同一本书已转存过就复用（chapter 数会变、封面基本不变），避免每天重复下载上传
  let cover = cached && typeof cached.cover === 'string' && cached.cover.indexOf('cloud://') === 0 ? cached.cover : '';
  if (!cover) cover = (await downloadAndUploadCover(d.coverUrl, docId)) || d.coverUrl;

  const now = new Date();
  const data = {
    doubanId: `jj_${novelid}`,
    source: 'jjwxc',
    novelId: novelid,
    title: d.title,
    author: d.author,
    authors: d.author ? [d.author] : [],
    novelType: d.novelType,
    serialText: d.serialText,
    finished: d.finished,
    wordCount: d.wordCount,
    chapterCount: d.chapterCount,
    collectedCount: d.collectedCount,
    scoreCount: d.scoreCount,
    lastUpdate: d.lastUpdate,
    pages: null,                 // 与豆瓣书文档同形：晋江没有页数
    intro: d.intro,              // 只入库，不下发给前端
    cover,
    originalCover: d.coverUrl,
    updatedAt: now,
    createTime: (cached && cached.createTime) || db.serverDate()
  };
  try {
    await booksCollection.doc(docId).set({ data });
  } catch (e) {
    console.warn('searched_books 写入跳过（集合可能未创建），降级为不缓存:', e && e.message);
  }
  return { success: true, book: toClientBook(data), cached: false };
}

exports.main = async (event) => {
  const action = (event && event.action) || 'search';
  try {
    if (action === 'search') return await search(event || {});
    if (action === 'detail') return await detail(event || {});
    return { success: false, error: 'UNKNOWN_ACTION' };
  } catch (err) {
    console.error(`jjwxcBook ${action} 失败:`, err && err.message);
    return { success: false, error: err && err.message, code: err && err.code };
  }
};
