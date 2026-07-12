// cloudfunctions/enrichThemeBooks/index.js
// 通用读书主题录入函数：给定 bookList，批量搜索豆瓣封面+评分，写入共享集合 generic_theme_books（按 theme 字段区分主题）。
// 整体结构（断点续传/自接力/灌库前自检/调序识别/封面已就绪跳过重爬/sourceTitle 归档）照抄
// cloudfunctions/enrichThemeMovies，让新增一个"给名单-抓封面评分-上线"类读书主题不用再复制一份采集云函数。
//
// 跟电影版最大的差异是匹配策略：书没有"原名/aka"概念，且书的印次/版本年份跨度很大（同一本书
// 首版、修订版、再版可以横跨几十年），年份不是可靠的校验信号——改成以"书名标准化后精确相等"
// 为主校验信号，作者名重叠作为二次信号（不通过时只警示，不拦截写入）。
//
// 书名规范化：名单条目标题若带版本注记（如"沉重的翅膀（修订本）"）先剥掉注记再搜索；
// 匹配到豆瓣条目后，再用豆瓣标准书名覆盖 title 入库，名单里传入的原始标题留档到 sourceTitle 字段。
const cloud = require('wx-server-sdk');
const axios = require('axios');
const cheerio = require('cheerio');

cloud.init({
    env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const collection = db.collection('generic_theme_books');
const MAX_LIMIT = 100;

const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.3 Mobile/15E148 Safari/604.1';

async function fetchExistingByTheme(theme) {
    const list = [];
    let offset = 0;
    while (true) {
        const res = await collection.where({ theme }).skip(offset).limit(MAX_LIMIT).get();
        list.push(...res.data);
        if (res.data.length < MAX_LIMIT) break;
        offset += MAX_LIMIT;
    }
    return list;
}

function slugify(str) {
    return String(str || '')
        .toLowerCase()
        .replace(/[^a-z0-9一-龥]+/g, '_')
        .replace(/^_+|_+$/g, '') || 'untitled';
}

// 候选校验最多拉几条详情：常规情况第一条就中，这里只是兜住"泛用词首条候选不对"的坏情况
const MAX_VERIFY_PER_QUERY = 2;

function normalizeForMatch(s) {
    return String(s || '')
        .toLowerCase()
        .replace(/[\s·・\-–—.,:;'’"“”!！?？()（）\[\]]/g, '');
}

// 名单标题剥掉尾部版本注记（"（修订本）""（一、二）"等），只影响搜索 query，
// 不影响写库前保留的原始标题（原始标题走 sourceTitle 归档）
function stripAnnotation(title) {
    let t = String(title || '').trim();
    let prev;
    do {
        prev = t;
        t = t.replace(/[（(][^（()）]*[）)]\s*$/, '').trim();
    } while (t !== prev);
    return t || String(title || '').trim();
}

// 基本质量闸门：评分为 0 或没封面——实测这两种情况基本都是撞错条目或空壳条目
function isBasicallyValid(detail) {
    if (!detail) return false;
    if (!detail.rating) return false;
    if (!detail.coverUrl) return false;
    return true;
}

// 书名标准化后精确相等即视为命中——书没有 original_title/aka 概念，书名本身就是身份标识
function isTitleMatch(detailTitle, targetTitle) {
    const a = normalizeForMatch(detailTitle);
    const b = normalizeForMatch(targetTitle);
    return !!a && !!b && a === b;
}

// 作者名是否有重叠（豆瓣作者字符串可能是"金庸"，名单作者可能是"孙力、余小惠"这种多人拼接）——
// 只做粗粒度子串匹配，用于在标题已命中的情况下再给一层信心信号，不通过也不拦截写入，只提示人工核对
function authorOverlap(detailAuthor, targetAuthor) {
    if (!detailAuthor || !targetAuthor) return true; // 任一方缺失时不判定为不匹配，避免误报
    const detailNames = String(detailAuthor).split(/[、,，\/]/).map(s => s.trim()).filter(Boolean);
    const targetNames = String(targetAuthor).split(/[、,，\/]/).map(s => s.trim()).filter(Boolean);
    return targetNames.some(t => detailNames.some(d => d.includes(t) || t.includes(d)));
}

/**
 * 豆瓣 rexxar 图书详情接口：取标准书名/作者/出版社/封面/评分，用于候选校验 + 灌库数据。
 * URL/headers 复用 fetchBookFullInfo 已验证的同款接口；失败时返回 null。
 */
async function fetchDoubanBookDetail(doubanId) {
    try {
        const res = await axios.get(`https://m.douban.com/rexxar/api/v2/book/${doubanId}`, {
            timeout: 10000,
            responseType: 'json',
            headers: {
                'User-Agent': MOBILE_UA,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
                'Referer': 'https://m.douban.com/'
            }
        });
        const j = (res && res.data) || {};
        if (!j || !j.id) return null;
        const authors = Array.isArray(j.author) ? j.author.filter(Boolean) : (j.author ? [String(j.author)] : []);
        return {
            title: j.title || '',
            year: j.pubdate ? String(j.pubdate).slice(0, 4) : (j.year || ''),
            author: authors.join('、'),
            publisher: j.press || j.publisher || '',
            coverUrl: j.cover_url || (j.pic && (j.pic.large || j.pic.normal)) || '',
            rating: j.rating && typeof j.rating.value === 'number' ? j.rating.value : 0,
            ratingCount: j.rating && j.rating.count != null ? Number(j.rating.count) : 0
        };
    } catch (e) {
        console.warn(`Fetch douban book detail failed for ${doubanId}:`, e.message);
        return null;
    }
}

// cast 行 "金庸 / 生活·读书·新知三联书店 / 1999 / 39.00元" → {author}（复用 searchBookByTitle 同款解析）
const PRICE_RE = /(元|¥|\$|USD|HKD|GBP|EUR|CNY)\s*$|^\d+\.\d{1,2}$/;
function parseCastAuthor(text) {
    let parts = String(text || '').split('/').map(s => s.trim()).filter(Boolean);
    if (!parts.length) return '';
    if (PRICE_RE.test(parts[parts.length - 1])) parts.pop();
    if (parts.length && /^\d{4}(-\d{1,2})?$/.test(parts[parts.length - 1])) parts.pop();
    if (!parts.length) return '';
    if (/^\d{4}/.test(parts[0])) return '';
    return parts[0].replace(/\s*(著|编著|主编|编|译)\s*$/, '').trim();
}

function extractIdFromResult($el) {
    const onclick = $el.find('a[onclick]').attr('onclick') || '';
    const m1 = onclick.match(/sid:\s*(\d+)/);
    if (m1) return m1[1];
    const href = $el.find('a').attr('href') || '';
    let dec = href;
    try { dec = decodeURIComponent(href); } catch (e) { /* keep */ }
    const m2 = dec.match(/subject\/(\d+)/);
    return m2 ? m2[1] : '';
}

// 解析豆瓣 /search?cat=1001（cat=1001=书籍）结果页 HTML，逻辑复用 searchBookByTitle
function parseSearchHtml(html) {
    const $ = cheerio.load(html);
    const out = [];
    $('.result').each((i, el) => {
        const $el = $(el);
        const id = extractIdFromResult($el);
        if (!id) return;
        const a = $el.find('.title h3 a, h3 a').first();
        const title = (a.text() || $el.find('a[title]').attr('title') || '').trim();
        if (!title) return;
        const cover = $el.find('.pic img').attr('src') || '';
        const author = parseCastAuthor($el.find('.subject-cast').first().text());
        out.push({ doubanId: id, title, posterUrl: cover, author });
    });
    return out;
}

async function searchDoubanBooks(keyword) {
    try {
        const url = `https://www.douban.com/search?cat=1001&q=${encodeURIComponent(keyword)}`;
        const res = await axios.get(url, {
            headers: {
                'User-Agent': DESKTOP_UA,
                'Referer': 'https://www.douban.com/',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'zh-CN,zh;q=0.9'
            },
            timeout: 12000,
            responseType: 'text',
            transformResponse: x => x,
            validateStatus: () => true
        });
        const html = typeof res.data === 'string' ? res.data : '';
        if (res.status >= 400 || !html) return [];
        return parseSearchHtml(html);
    } catch (e) {
        console.warn(`豆瓣图书搜索失败 "${keyword}":`, e.message);
        return [];
    }
}

// 回退：图书 suggest（前缀匹配，仅书名/封面，无作者）
async function suggestFallback(keyword) {
    try {
        const res = await axios.get(`https://book.douban.com/j/subject_suggest?q=${encodeURIComponent(keyword)}`, {
            headers: { 'User-Agent': DESKTOP_UA, 'Referer': 'https://book.douban.com/' },
            timeout: 10000, responseType: 'json', validateStatus: () => true
        });
        const raw = Array.isArray(res.data) ? res.data : [];
        return raw
            .filter(it => it && it.id && (!it.type || it.type === 'b' || it.type === 'book'))
            .map(it => ({ doubanId: String(it.id), title: it.title || '', posterUrl: it.pic || it.img || '', author: '' }));
    } catch (e) {
        console.warn('图书 suggest 回退失败:', e && e.message);
        return [];
    }
}

/**
 * 搜索豆瓣提取图书封面和评分
 * 搜索策略：依次尝试 "书名 作者"、"书名"——书名+作者组合能显著减少撞同名书的概率
 * 匹配策略：对每条 query 的前 N 条候选逐个拉详情，先过 isBasicallyValid 质量闸门（评分0/无封面排除），
 *   再用书名标准化精确相等做真校验，通过才采纳；全程没有校验通过时，兜底取第一个"至少过了质量闸门"
 *   的候选，标记 matchVerified:false 交给调用方汇总提醒人工核对；若连质量闸门都没有候选通过，
 *   直接返回 null（调用方会跳过该条，计入 unmatchedBooks）。
 */
async function fetchDoubanBookInfo(title, author) {
    const cleanTitle = stripAnnotation(title);
    const searchQueries = [
        author ? `${cleanTitle} ${author}` : null,
        cleanTitle
    ].filter(Boolean);

    let fallback = null; // 全程都没校验通过时兜底：首个通过质量闸门的候选

    for (const query of searchQueries) {
        let candidates = await searchDoubanBooks(query);
        if (!candidates.length) candidates = await suggestFallback(query);
        if (!candidates.length) continue;

        for (const cand of candidates.slice(0, MAX_VERIFY_PER_QUERY)) {
            const detail = await fetchDoubanBookDetail(cand.doubanId);
            if (!isBasicallyValid(detail)) {
                console.warn(`  -> 排除候选 doubanId=${cand.doubanId}（评分0或无封面），query: "${query}"`);
                continue;
            }
            if (isTitleMatch(detail.title, cleanTitle)) {
                console.log(`  -> 已验证匹配 doubanId=${cand.doubanId}「${detail.title}」, query: "${query}"`);
                return {
                    doubanId: cand.doubanId,
                    coverUrl: detail.coverUrl,
                    rating: detail.rating,
                    title: detail.title,
                    author: detail.author,
                    publisher: detail.publisher,
                    matchVerified: true,
                    authorMatched: authorOverlap(detail.author, author)
                };
            }
            if (!fallback) fallback = { cand, detail, query };
        }
    }

    if (fallback) {
        console.warn(`  -> [未验证匹配] 兜底 doubanId=${fallback.cand.doubanId}，query: "${fallback.query}"，需人工核对`);
        return {
            doubanId: fallback.cand.doubanId,
            coverUrl: fallback.detail.coverUrl,
            rating: fallback.detail.rating,
            title: fallback.detail.title,
            author: fallback.detail.author,
            publisher: fallback.detail.publisher,
            matchVerified: false,
            authorMatched: authorOverlap(fallback.detail.author, author)
        };
    }
    return null;
}

/**
 * 下载图片并上传至云存储，失败时回退原图 URL
 */
async function downloadAndUploadImage(imageUrl, theme, bookId) {
    try {
        const response = await axios({
            url: imageUrl,
            responseType: 'arraybuffer',
            timeout: 15000,
            headers: {
                'User-Agent': DESKTOP_UA,
                'Referer': 'https://book.douban.com/'
            }
        });

        const fileName = `${theme}_book_covers/${bookId}_${Date.now()}.jpg`;
        const uploadResult = await cloud.uploadFile({
            cloudPath: fileName,
            fileContent: response.data
        });

        return uploadResult.fileID;

    } catch (e) {
        console.warn(`Image download failed for ${bookId}, fallback to original url`, e.message);
        return imageUrl;
    }
}

// 灌库前自检：写库前把脏数据/字段问题挡下（与电影版 validateMovieList 同源的书籍版）。
// 只做与主题无关的通用检查；不校验 rank 连续性（允许传子集做单条修正）。
function validateBookList(bookList) {
    const errors = [], warns = [];
    const DIRTY = /[<>]|&[a-zA-Z#0-9]+;|[《》\[\]|]|\s{2,}/;
    const curYear = new Date().getFullYear();
    const ranks = new Set();
    bookList.forEach((b, i) => {
        const tag = `#${b && b.rank != null ? b.rank : 'idx' + i} ${(b && b.year) || ''} ${(b && b.title) || ''}`.trim();
        if (!b || typeof b !== 'object') { errors.push(`${tag}: 非对象`); return; }
        if (typeof b.rank !== 'number') errors.push(`${tag}: rank 非数字`);
        else { if (ranks.has(b.rank)) errors.push(`${tag}: rank 重复`); ranks.add(b.rank); }
        if (b.year != null && (typeof b.year !== 'number' || b.year < 1900 || b.year > curYear + 1)) errors.push(`${tag}: year 非法(${b.year})`);
        if (!b.title || !String(b.title).trim()) errors.push(`${tag}: title 为空`);
        if (!b.author || !String(b.author).trim()) warns.push(`${tag}: author 为空`);
        ['title', 'author'].forEach(k => { if (b[k] && DIRTY.test(String(b[k]))) warns.push(`${tag}: ${k} 含可疑字符 → "${b[k]}"`); });
    });
    return { errors, warns };
}

exports.main = async (event, context) => {
    const START_TIME = Date.now();
    const TIME_LIMIT = 45000;

    const {
        theme,
        bookList,
        idStrategy = 'rank',
        forceRefresh = false,
        startFrom = 0,
        autoContinue = false,  // true 时：跑完一批自动调用自身接力，直到全部处理完（只需手动点一次）
        skipValidation = false // true 时：跳过灌库前自检（仅在明知数据有意“不规范”时用）
    } = event || {};

    if (!theme) {
        return { success: false, error: '缺少 theme 参数' };
    }
    if (!Array.isArray(bookList) || bookList.length === 0) {
        return { success: false, error: 'bookList 为空' };
    }

    // ── 灌库前自检：只在首批（startFrom===0）跑一次；有 ERROR 直接拦下，不写脏数据 ──
    let validationWarns = [];
    if (startFrom === 0) {
        const v = validateBookList(bookList);
        validationWarns = v.warns;
        if (v.warns.length) console.warn(`[enrichThemeBooks] 自检 WARN (${v.warns.length}):\n` + v.warns.join('\n'));
        if (v.errors.length && !skipValidation) {
            console.error(`[enrichThemeBooks] 自检 ERROR (${v.errors.length})，已拦下:\n` + v.errors.join('\n'));
            return { success: false, error: `数据自检未通过（${v.errors.length} 个错误）`, validation: v, hint: '修正 bookList 后重试；确要强灌可传 skipValidation:true' };
        }
        if (v.errors.length) console.warn(`[enrichThemeBooks] 自检 ERROR (${v.errors.length}) 被 skipValidation 跳过`);
    }

    try {
        console.log(`[enrichThemeBooks] theme=${theme} idStrategy=${idStrategy} total=${bookList.length} startFrom=${startFrom} forceRefresh=${forceRefresh}`);

        const existingList = await fetchExistingByTheme(theme);
        const existingByRank = {};
        const existingByTitleYear = {};
        existingList.forEach(b => {
            if (b.rank != null) existingByRank[b.rank] = b;
            if (b.title != null && b.year != null) {
                existingByTitleYear[`${b.title}__${b.year}`] = b;
            }
        });

        const pending = bookList.slice(startFrom);
        let processedCount = 0;
        let stoppedEarly = false;
        // 记录本轮已用过的 doubanId → 标题，用于发现「两本不同书匹配到同一个豆瓣条目」的误匹配
        const seenDoubanIds = {};

        const toAdd = [];
        const toUpdate = [];
        const matchWarnings = []; // 豆瓣匹配没通过校验、走兜底或作者不吻合的条目，提醒人工核对
        const unmatchedBooks = []; // 连质量闸门都没有候选通过、完全没写入的条目，需人工手动核对补充

        // 预扫描：调序场景下，同一本书按 title+year 认身份，提前"认领"它在数据库里已有的记录
        const claimedIds = new Set();
        if (idStrategy === 'rank') {
            pending.forEach(bt => {
                if (bt.title != null && bt.year != null) {
                    const im = existingByTitleYear[`${bt.title}__${bt.year}`];
                    if (im && im.rank !== bt.rank) claimedIds.add(im._id);
                }
            });
        }

        for (let i = 0; i < pending.length; i++) {
            if (Date.now() - START_TIME > TIME_LIMIT) {
                console.warn(`[enrichThemeBooks] 超时，已处理 ${processedCount}/${pending.length}，在 index ${startFrom + i} 停止`);
                stoppedEarly = true;
                break;
            }

            const bookTarget = pending[i];
            const { rank, year, title, author } = bookTarget;

            const identityMatch = (idStrategy === 'rank' && title != null && year != null)
                ? existingByTitleYear[`${title}__${year}`]
                : null;

            // 身份对得上（同一本书），但 rank 变了：只是调序，不用重新查豆瓣，直接改序号等名单字段
            if (identityMatch && identityMatch.rank !== rank) {
                const patch = { ...bookTarget, theme };
                delete patch._id;
                if (identityMatch.sourceTitle && patch.title === identityMatch.sourceTitle) delete patch.title;
                const hasChanges = Object.keys(patch).some(k => JSON.stringify(patch[k]) !== JSON.stringify(identityMatch[k]));
                if (hasChanges) {
                    toUpdate.push({ _id: identityMatch._id, data: { ...patch, updateTime: db.serverDate() } });
                    console.log(`[enrichThemeBooks] 仅调整序号（未重新查豆瓣）: "${title}" rank ${identityMatch.rank} → ${rank}`);
                }
                processedCount++;
                continue;
            }

            const existingDoc = idStrategy === 'title-year'
                ? existingByTitleYear[`${title}__${year}`]
                : (existingByRank[rank] && !claimedIds.has(existingByRank[rank]._id) ? existingByRank[rank] : null);

            // 封面已就绪且非强制刷新：不必重新搜豆瓣/重新下载图片，只按需轻量 patch 调用方传入的字段
            if (!forceRefresh && existingDoc && existingDoc.cover && existingDoc.cover.startsWith('cloud://')) {
                const patch = { ...bookTarget, theme };
                delete patch._id;
                // 库内 title 已被豆瓣标准书名覆盖过（sourceTitle 存的是名单原始标题）；
                // 同一份原始名单再跑一遍时，不要把订正后的书名改回名单原始写法
                if (existingDoc.sourceTitle && patch.title === existingDoc.sourceTitle) {
                    delete patch.title;
                }
                const hasChanges = Object.keys(patch).some(k => JSON.stringify(patch[k]) !== JSON.stringify(existingDoc[k]));
                if (hasChanges) {
                    toUpdate.push({ _id: existingDoc._id, data: { ...patch, updateTime: db.serverDate() } });
                }
                processedCount++;
                continue;
            }

            // 名单条目可手动指定 doubanId（人工在豆瓣核实过的正确条目，比如搜索误配到同名书/其他版本时）：
            // 跳过搜索直接取详情，视为已核实，不再走候选校验流程
            let doubanInfo;
            if (bookTarget.doubanId) {
                console.log(`[enrichThemeBooks] 使用名单手动指定的 doubanId=${bookTarget.doubanId}: ${title}`);
                const detail = await fetchDoubanBookDetail(bookTarget.doubanId);
                doubanInfo = detail ? {
                    doubanId: bookTarget.doubanId,
                    coverUrl: detail.coverUrl,
                    rating: detail.rating,
                    title: detail.title,
                    author: detail.author,
                    publisher: detail.publisher,
                    matchVerified: true,
                    authorMatched: true
                } : null;
            } else {
                console.log(`[enrichThemeBooks] 搜索豆瓣: ${title} / ${author} (${year})`);
                doubanInfo = await fetchDoubanBookInfo(title, author);
            }

            if (doubanInfo) {
                if (doubanInfo.doubanId) {
                    if (seenDoubanIds[doubanInfo.doubanId] != null) {
                        console.warn(`[误匹配] "${title}" 与 "${seenDoubanIds[doubanInfo.doubanId]}" 都匹配到豆瓣条目 ${doubanInfo.doubanId}，请人工核对封面`);
                    } else {
                        seenDoubanIds[doubanInfo.doubanId] = title;
                    }
                }

                if (!doubanInfo.matchVerified) {
                    matchWarnings.push(`#${rank != null ? rank : ''} ${year} 《${title}》: 豆瓣匹配未通过校验（doubanId=${doubanInfo.doubanId}），请人工核对`);
                } else if (!doubanInfo.authorMatched) {
                    matchWarnings.push(`#${rank != null ? rank : ''} ${year} 《${title}》: 书名匹配但作者不吻合（豆瓣作者「${doubanInfo.author}」vs 名单作者「${author}」），请人工核对`);
                }

                // 按 rank 生成的"自然" _id（theme_rank）如果已经被别的书身份认领占用了
                const naturalRankId = `${theme}_${rank}`;
                const docId = existingDoc
                    ? existingDoc._id
                    : (idStrategy === 'title-year' || claimedIds.has(naturalRankId)
                        ? `${theme}_${slugify(title)}_${year}`
                        : naturalRankId);

                const finalBookData = {
                    ...bookTarget,
                    theme,
                    doubanId: doubanInfo.doubanId,
                    coverUrl: doubanInfo.coverUrl,
                    rating: doubanInfo.rating,
                    updateTime: db.serverDate()
                };
                delete finalBookData._id;

                // 名单没带出版社时，用豆瓣详情补齐
                if (!finalBookData.publisher && doubanInfo.publisher) finalBookData.publisher = doubanInfo.publisher;

                // 用豆瓣标准书名覆盖名单标题，原始标题留档；接口失败则保留名单标题
                if (doubanInfo.title && doubanInfo.title !== finalBookData.title) {
                    finalBookData.sourceTitle = bookTarget.title;
                    finalBookData.title = doubanInfo.title;
                    console.log(`  -> 书名订正: "${bookTarget.title}" → "${doubanInfo.title}"`);
                }

                if (finalBookData.coverUrl) {
                    finalBookData.cover = await downloadAndUploadImage(finalBookData.coverUrl, theme, docId);
                } else {
                    finalBookData.cover = '';
                }

                if (existingDoc) {
                    if (!forceRefresh && existingDoc.cover && existingDoc.cover.startsWith('cloud://')) {
                        delete finalBookData.cover;
                    }
                    toUpdate.push({ _id: existingDoc._id, data: finalBookData });
                } else {
                    finalBookData._id = docId;
                    finalBookData.createTime = db.serverDate();
                    toAdd.push(finalBookData);
                }
            } else {
                console.warn(`[enrichThemeBooks] 豆瓣未匹配到: ${title} / ${author}`);
                const reason = bookTarget.doubanId
                    ? `手动指定的 doubanId=${bookTarget.doubanId} 详情请求失败，大概率是豆瓣临时限流/反爬验证，建议隔一段时间重试`
                    : '候选全部评分0/无封面，或未搜到书名精确匹配的候选（常见于多卷本/丛书），未写入，需人工核实豆瓣ID';
                unmatchedBooks.push(`#${rank != null ? rank : ''} ${year} 《${title}》（${author}）: ${reason}`);
            }

            processedCount++;
            await new Promise(r => setTimeout(r, 800));
        }

        for (const update of toUpdate) {
            await collection.doc(update._id).update({ data: update.data }).catch(console.error);
        }

        for (let i = 0; i < toAdd.length; i += 20) {
            const batch = toAdd.slice(i, i + 20);
            await Promise.all(batch.map(b => collection.add({ data: b }))).catch(console.error);
        }

        const nextStartFrom = startFrom + processedCount;

        // 自动接力：开启 autoContinue、本轮有进展、且还没跑完时，触发下一棒（fire-and-forget）。
        let autoChained = false;
        if (stoppedEarly && autoContinue && processedCount > 0) {
            try {
                cloud.callFunction({
                    name: 'enrichThemeBooks',
                    data: { theme, bookList, idStrategy, forceRefresh, startFrom: nextStartFrom, autoContinue: true }
                }).catch(e => console.error('[enrichThemeBooks] 自动接力触发失败:', e && e.message));
                await new Promise(r => setTimeout(r, 1200));
                autoChained = true;
                console.log(`[enrichThemeBooks] 自动接力已触发：从 ${nextStartFrom} 继续`);
            } catch (e) {
                console.error('[enrichThemeBooks] 自动接力异常:', e && e.message);
            }
        }

        return {
            success: true,
            processed: processedCount,
            added: toAdd.length,
            updated: toUpdate.length,
            stoppedEarly,
            autoChained,
            validationWarns,   // 首批自检的告警（脏文本/缺 author 等），仅提示不拦截
            matchWarnings,     // 本轮豆瓣匹配没通过校验、走兜底、或作者不吻合的条目，需人工核对
            unmatchedBooks,    // 本轮完全没写入的条目（候选全部评分0/无封面/没有书名精确匹配），需人工核实补充
            nextStartFrom: stoppedEarly ? nextStartFrom : 0,
            hint: !stoppedEarly
                ? '全部处理完成'
                : autoChained
                    ? `已自动接力，从 ${nextStartFrom} 继续（无需再手动，几分钟后用 getThemeBooks 查条数确认）`
                    : `未处理完，下次请传入 { "theme": "${theme}", "bookList": [...同一份名单], "startFrom": ${nextStartFrom} } 继续`
        };

    } catch (err) {
        console.error('[enrichThemeBooks] 执行失败:', err);
        return { success: false, error: err.message };
    }
};
