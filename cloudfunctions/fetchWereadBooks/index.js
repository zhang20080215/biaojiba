// cloudfunctions/fetchWereadBooks/index.js
// 微信读书 TOP200 总榜抓取 — 全自动版（Phase 2）
//
// API: https://weread.qq.com/web/bookListInCategory/all?maxIndex=X&rank=1
//   - 每页 20 本，maxIndex 是已加载书籍数量（offset），rank=1 表示按热度总榜
//   - 公开接口，无需登录态
//
// 调用方式：
//   - 仅抓取元数据（默认）：wx.cloud.callFunction({ name: 'fetchWereadBooks' })
//   - 抓取 + 下载封面（分批避免超时）：
//     wx.cloud.callFunction({ name: 'fetchWereadBooks', data: { downloadCovers: true, coverBatchSize: 30 } })
//   - 仅下载封面（已抓过元数据）：
//     wx.cloud.callFunction({ name: 'fetchWereadBooks', data: { skipScrape: true, downloadCovers: true } })

const cloud = require('wx-server-sdk');
const axios = require('axios');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const booksCollection = db.collection('weread_books');
// 封面是否下载过的判定：直接看 weread_books.cover 是否以 cloud:// 开头
// （不再单独维护 image 索引表，避免冗余）

const API_BASE = 'https://weread.qq.com/web/bookListInCategory/all';
const TARGET_TOTAL = 200;
const PAGE_SIZE = 20;

const REQUEST_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Referer': 'https://weread.qq.com/web/category/all',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9'
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── 单页抓取 ─────────────────────────────────────────
async function fetchPage(maxIndex, retryCount = 0) {
    try {
        const res = await axios.get(API_BASE, {
            params: { maxIndex, rank: 1 },
            timeout: 12000,
            headers: REQUEST_HEADERS
        });
        return res.data;
    } catch (err) {
        if (retryCount < 2) {
            await sleep(1000 * (retryCount + 1));
            return fetchPage(maxIndex, retryCount + 1);
        }
        console.error(`抓取页 maxIndex=${maxIndex} 失败:`, err.message);
        return null;
    }
}

// ─── 字段映射：API 原始字段 → weread_books schema ──────
// API 响应结构（每条）：
//   { bookInfo: { bookId, title, author, cover, intro, newRating, ... },
//     searchIdx, readingCount, ... }
function mapBook(raw, fallbackRank) {
    const info = raw.bookInfo || {};
    const newRating = typeof info.newRating === 'number' ? info.newRating : 0;
    const bookId = String(info.bookId || '');
    return {
        bookId,
        rank: typeof raw.searchIdx === 'number' ? raw.searchIdx : fallbackRank,
        title: String(info.title || '').trim(),
        author: String(info.author || '').trim(),
        category: String(info.category || '').trim(),
        coverUrl: String(info.cover || ''),
        cover: String(info.cover || ''),         // 下载封面后会覆盖为 cloud://
        originalCover: String(info.cover || ''),
        description: String(info.intro || '').trim(),
        rating: newRating ? (newRating / 10).toFixed(1) : '',  // 931 → "93.1"
        ratingCount: typeof info.newRatingCount === 'number' ? info.newRatingCount : 0,
        readingCount: typeof raw.readingCount === 'number' ? raw.readingCount : 0,
        price: typeof info.price === 'number' ? info.price : 0,
        publishTime: String(info.publishTime || '').slice(0, 10),
        format: String(info.format || ''),
        finished: info.finished === 1,
        wereadUrl: bookId ? `https://weread.qq.com/web/reader/${bookId}` : ''
    };
}

// ─── 全量抓取 ─────────────────────────────────────────
async function scrapeAll() {
    const allBooks = [];
    let maxIndex = 0;
    let pageNum = 0;

    while (allBooks.length < TARGET_TOTAL && pageNum < 12) {
        const data = await fetchPage(maxIndex);
        if (!data || !Array.isArray(data.books) || data.books.length === 0) break;

        const startRank = allBooks.length + 1;
        const mapped = data.books.map((raw, i) => mapBook(raw, startRank + i));
        allBooks.push(...mapped);

        if (data.hasMore !== 1 && data.hasMore !== true) break;
        maxIndex += data.books.length;
        pageNum++;
        await sleep(400); // 友好的限流间隔
    }

    return allBooks.slice(0, TARGET_TOTAL);
}

// ─── 批量 upsert ────────────────────────────────────
async function upsertBook(book) {
    book.isTop250 = true; // getMoviesData 用此字段过滤"在榜"书籍
    const existing = await booksCollection.where({ bookId: book.bookId }).get();

    if (existing.data.length === 0) {
        const res = await booksCollection.add({
            data: { ...book, createdAt: db.serverDate(), updatedAt: db.serverDate() }
        });
        return { action: 'add', _id: res._id };
    }

    const docId = existing.data[0]._id;
    // 保留 cloud:// 封面（如果之前已下载）
    const oldCover = existing.data[0].cover;
    const finalBook = { ...book, updatedAt: db.serverDate() };
    if (typeof oldCover === 'string' && oldCover.startsWith('cloud://')) {
        finalBook.cover = oldCover;
    }
    await booksCollection.doc(docId).update({ data: finalBook });
    return { action: 'update', _id: docId };
}

// ─── 封面下载 ────────────────────────────────────────
// 已下载过的判定：weread_books.cover 字段以 cloud:// 开头
async function downloadAndUploadCover(book, retryCount = 0) {
    const { bookId, coverUrl } = book;
    if (!coverUrl) return null;

    try {
        const response = await axios({
            url: coverUrl,
            responseType: 'arraybuffer',
            timeout: 15000,
            headers: REQUEST_HEADERS
        });

        const ext = (coverUrl.match(/\.(jpg|jpeg|png|webp)/i) || [])[1] || 'jpg';
        const cloudPath = `weread_book_covers/${bookId}_${Date.now()}.${ext}`;
        const uploadResult = await cloud.uploadFile({
            cloudPath,
            fileContent: Buffer.from(response.data)
        });

        // 直接把 cloud:// fileID 写回 weread_books.cover —— 这就是事实来源
        await booksCollection.where({ bookId }).update({
            data: { cover: uploadResult.fileID }
        });

        return uploadResult.fileID;
    } catch (err) {
        if (retryCount < 1) {
            await sleep(1500);
            return downloadAndUploadCover(book, retryCount + 1);
        }
        console.warn(`封面下载失败 [${bookId}]: ${err.message}`);
        return null;
    }
}

// ─── 批量下载封面（限批次避免超时）─────────────────
async function downloadCoversBatch(batchSize) {
    // 找出 cover 字段还是 https URL（即没下载过）的书
    const allBooks = await booksCollection
        .where({ isTop250: true })
        .field({ bookId: true, cover: true, coverUrl: true })
        .limit(TARGET_TOTAL)
        .get();

    const todo = allBooks.data.filter((b) => !b.cover || !b.cover.startsWith('cloud://'));
    const slice = todo.slice(0, batchSize);

    let success = 0;
    let failed = 0;
    for (const book of slice) {
        const fileID = await downloadAndUploadCover(book);
        if (fileID) success++;
        else failed++;
        await sleep(150);
    }

    return { attempted: slice.length, remaining: todo.length - slice.length, success, failed };
}

// ─── 主入口 ──────────────────────────────────────────
exports.main = async (event = {}) => {
    const {
        skipScrape = false,
        downloadCovers = false,
        coverBatchSize = 30
    } = event;

    const result = { scraped: null, covers: null };

    try {
        // Step 1: 抓取元数据 + upsert
        if (!skipScrape) {
            const books = await scrapeAll();
            if (books.length === 0) {
                return { success: false, error: '未抓到任何书籍，请检查 API 是否变更' };
            }

            const stats = { total: books.length, added: 0, updated: 0, failed: 0, skippedNoBookId: 0 };
            for (const book of books) {
                if (!book.bookId) {
                    stats.skippedNoBookId++;
                    continue;
                }
                try {
                    const r = await upsertBook(book);
                    if (r.action === 'add') stats.added++;
                    else stats.updated++;
                } catch (err) {
                    stats.failed++;
                    console.error(`upsert ${book.bookId} 失败:`, err.message);
                }
            }
            result.scraped = stats;
        }

        // Step 2: 可选 — 批量下载封面（云函数 60s 限时，分批跑）
        if (downloadCovers) {
            result.covers = await downloadCoversBatch(coverBatchSize);
        }

        return { success: true, ...result };
    } catch (err) {
        console.error('fetchWereadBooks 失败:', err);
        return { success: false, error: err.message, ...result };
    }
};
