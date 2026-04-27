// cloudfunctions/fetchDoubanBooks/index.js
// 抓取豆瓣读书 TOP250，结构对齐 fetchMovies。
// 数据写入 douban_books 集合；封面镜像到云存储 book_covers/，索引存 book_images。

const cloud = require('wx-server-sdk');
const axios = require('axios');
const cheerio = require('cheerio');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const booksCollection = db.collection('douban_books');

const DESKTOP_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Referer': 'https://book.douban.com/',
    'Accept-Language': 'zh-CN,zh;q=0.9'
};

const PRICE_RE = /(元|\$|¥|USD|HKD|GBP|EUR)\s*$/;
const DATE_RE = /^\d{4}(-\d{1,2}){0,2}$/;
const SUBJECT_ID_RE = /\/subject\/(\d+)\/?/;

// ─── 元数据解析 ───────────────────────────────────────
// 例：
//   "[清] 曹雪芹 著 / 人民文学出版社 / 1996-12 / 59.70元"  → author/publisher/pubDate/price
//   "[英] J.K.罗琳 / 苏农 译 / 人民文学出版社 / 2000-9 / 19.50元" → +translator
function parseMetadata(text) {
    const parts = String(text || '').split('/').map((s) => s.trim()).filter(Boolean);
    const result = { author: '', translator: '', publisher: '', pubDate: '', price: '' };
    if (parts.length === 0) return result;

    let lastIdx = parts.length - 1;

    if (PRICE_RE.test(parts[lastIdx])) {
        result.price = parts[lastIdx];
        lastIdx--;
    }
    if (lastIdx >= 0 && DATE_RE.test(parts[lastIdx])) {
        result.pubDate = parts[lastIdx];
        lastIdx--;
    }
    if (lastIdx >= 0) {
        result.publisher = parts[lastIdx];
        lastIdx--;
    }

    // 余下的就是作者 (+ 可选译者)
    if (lastIdx >= 1) {
        result.author = parts[0];
        // 译者段通常以 "译" 结尾
        result.translator = parts[1].replace(/\s*译\s*$/, '');
    } else if (lastIdx === 0) {
        result.author = parts[0];
    }

    return result;
}

function parseRatingCount(text) {
    const match = String(text || '').match(/(\d+)\s*人评价/);
    return match ? parseInt(match[1], 10) : 0;
}

function extractSubjectId(href) {
    const match = String(href || '').match(SUBJECT_ID_RE);
    return match ? match[1] : '';
}

// ─── 封面下载 + 上传云存储 ────────────────────────────
async function checkExistingImage(bookId) {
    try {
        const result = await db.collection('book_images').where({ bookId }).get();
        return result.data.length > 0 ? result.data[0] : null;
    } catch (e) {
        console.error('检查已存图片失败:', e);
        return null;
    }
}

async function saveImageInfo(bookId, imageInfo) {
    try {
        await db.collection('book_images').add({ data: { bookId, ...imageInfo } });
    } catch (e) {
        console.error('保存图片信息失败:', e);
    }
}

async function downloadAndUploadCover(imageUrl, bookId, retryCount = 0) {
    try {
        const existing = await checkExistingImage(bookId);
        if (existing) return existing;

        const response = await axios({
            url: imageUrl,
            responseType: 'arraybuffer',
            timeout: 15000,
            headers: DESKTOP_HEADERS
        });

        const fileName = `book_covers/${bookId}_${Date.now()}.jpg`;
        const uploadResult = await cloud.uploadFile({
            cloudPath: fileName,
            fileContent: Buffer.from(response.data)
        });

        const cdnUrl = `https://${uploadResult.fileID}`;
        await saveImageInfo(bookId, {
            fileID: uploadResult.fileID,
            cdnUrl,
            originalUrl: imageUrl,
            uploadTime: new Date()
        });

        return { fileID: uploadResult.fileID, cdnUrl, originalUrl: imageUrl };
    } catch (error) {
        console.error(`下载/上传封面失败 (重试${retryCount}次):`, error.message);
        if (retryCount < 2) {
            await new Promise((r) => setTimeout(r, 1500));
            return downloadAndUploadCover(imageUrl, bookId, retryCount + 1);
        }
        return { fileID: '', cdnUrl: imageUrl, originalUrl: imageUrl, isFallback: true };
    }
}

// ─── 单页抓取 ─────────────────────────────────────────
async function fetchPage(start) {
    const url = `https://book.douban.com/top250?start=${start}`;
    try {
        const res = await axios.get(url, { timeout: 12000, headers: DESKTOP_HEADERS });
        const $ = cheerio.load(res.data);
        const books = [];

        $('tr.item').each((index, element) => {
            const $el = $(element);
            const $titleA = $el.find('div.pl2 > a').first();
            const $linkA = $el.find('a.nbg').first();
            const $img = $linkA.find('img').first();
            const $rating = $el.find('span.rating_nums').first();
            const $ratingCount = $el.find('div.star span.pl').first();
            const $inq = $el.find('span.inq').first();
            const $pl = $el.find('p.pl').first();

            const subjectId = extractSubjectId($linkA.attr('href') || $titleA.attr('href'));
            // 优先用 title 属性（干净的中文主标题），fallback 到 a 标签文本
            const title = (
                $titleA.attr('title') || $titleA.text().replace(/\s+/g, ' ').trim()
            ).trim();
            if (!subjectId || !title) return;

            const meta = parseMetadata($pl.text());
            const ratingValue = parseFloat($rating.text());

            books.push({
                _id: subjectId,
                rank: start + index + 1,
                title,
                author: meta.author,
                translator: meta.translator,
                publisher: meta.publisher,
                pubDate: meta.pubDate,
                price: meta.price,
                rating: isNaN(ratingValue) ? 0 : ratingValue,
                ratingCount: parseRatingCount($ratingCount.text()),
                originalCover: $img.attr('src') || '',
                description: $inq.text().trim(),
                doubanUrl: `https://book.douban.com/subject/${subjectId}/`
            });
        });

        return books;
    } catch (err) {
        console.error(`抓取 start=${start} 失败:`, err.message);
        return [];
    }
}

// ─── 主入口 ───────────────────────────────────────────
exports.main = async (event) => {
    const _ = db.command;
    const START_TIME = Date.now();
    const TIME_LIMIT = 45000; // 与 fetchMovies 对齐：45 秒安全阈值

    const skipImages = !!(event && event.skipImages);

    try {
        // 抓取 10 页（并发，每页 25 本）
        const pages = await Promise.all(
            [0, 25, 50, 75, 100, 125, 150, 175, 200, 225].map((start) => fetchPage(start))
        );
        const fetched = pages.reduce((acc, list) => acc.concat(list), []);

        if (fetched.length === 0) {
            return { success: false, message: '抓取结果为空，疑似页面结构变更或网络异常' };
        }

        console.log(`抓取完成，共 ${fetched.length} 本，开始读取已存数据...`);

        // 读取现有 douban_books 全量（最多 250+ 数量级，分批）
        const MAX_LIMIT = 100;
        const countRes = await booksCollection.count();
        const total = countRes.total;
        let existingBooks = [];
        for (let i = 0; i < total; i += MAX_LIMIT) {
            const batch = await booksCollection.skip(i).limit(MAX_LIMIT).get();
            existingBooks = existingBooks.concat(batch.data);
        }
        const existingMap = {};
        existingBooks.forEach((b) => { existingMap[b._id] = b; });

        // 处理封面 + 分类新增/更新
        const toAdd = [];
        const toUpdate = [];
        let stoppedEarly = false;

        const CHUNK_SIZE = 25;
        for (let i = 0; i < fetched.length; i += CHUNK_SIZE) {
            if (Date.now() - START_TIME > TIME_LIMIT) {
                console.warn(`[Timeout Guard] 已超 45s 阈值，在 index=${i} 提前结束以保存进度`);
                stoppedEarly = true;
                break;
            }
            const chunk = fetched.slice(i, i + CHUNK_SIZE);
            await Promise.all(chunk.map(async (raw) => {
                const { originalCover, _id } = raw;
                let cover = originalCover;
                let coverUrl = originalCover;
                if (!skipImages && originalCover) {
                    const imageInfo = await downloadAndUploadCover(originalCover, _id);
                    cover = imageInfo.fileID || originalCover;
                    coverUrl = imageInfo.cdnUrl || originalCover;
                }

                const record = {
                    ...raw,
                    cover,
                    coverUrl,
                    isTop250: true,
                    updateTime: db.serverDate()
                };

                if (existingMap[_id]) {
                    if (existingMap[_id].isTop250 === false) {
                        record.enterTop250Time = db.serverDate();
                    }
                    toUpdate.push(record);
                } else {
                    record.enterTop250Time = db.serverDate();
                    record.createTime = db.serverDate();
                    toAdd.push(record);
                }
            }));
        }

        // 软删除：在榜旧记录但本次未抓到的 → isTop250=false
        const fetchedIds = new Set(fetched.map((b) => b._id));
        const softDeleteIds = existingBooks
            .filter((b) => b.isTop250 !== false && !fetchedIds.has(b._id))
            .map((b) => b._id);

        // ─── 写库 ───
        if (softDeleteIds.length > 0) {
            await booksCollection.where({ _id: _.in(softDeleteIds) }).update({
                data: {
                    isTop250: false,
                    exitTop250Time: db.serverDate(),
                    updateTime: db.serverDate()
                }
            });
        }

        // 更新已存
        for (let i = 0; i < toUpdate.length; i += 20) {
            const batch = toUpdate.slice(i, i + 20);
            await Promise.all(batch.map(async (book) => {
                const { _id, ...data } = book;
                return booksCollection.doc(_id).update({ data }).catch((err) => {
                    console.error(`更新 ${_id} 失败:`, err.message);
                });
            }));
            await new Promise((r) => setTimeout(r, 150));
        }

        // 新增
        if (toAdd.length > 0) {
            const BATCH_SIZE = 50;
            for (let i = 0; i < toAdd.length; i += BATCH_SIZE) {
                const batch = toAdd.slice(i, i + BATCH_SIZE);
                await Promise.all(batch.map(async (book) => {
                    return booksCollection.add({ data: book }).catch((err) => {
                        console.error(`新增 ${book._id} 失败:`, err.message);
                    });
                }));
            }
        }

        return {
            success: true,
            total: fetched.length,
            added: toAdd.length,
            updated: toUpdate.length,
            softDeleted: softDeleteIds.length,
            stoppedEarly,
            message: stoppedEarly
                ? '抓取在 45s 安全阈值暂停以保存进度，请再次运行同步剩余数据'
                : '豆瓣读书 TOP250 同步完成'
        };
    } catch (err) {
        console.error('fetchDoubanBooks 失败:', err);
        return { success: false, error: err.message, message: '豆瓣读书数据抓取失败' };
    }
};
