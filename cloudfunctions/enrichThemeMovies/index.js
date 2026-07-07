// cloudfunctions/enrichThemeMovies/index.js
// 通用电影主题录入函数：给定 movieList，批量搜索豆瓣封面+评分，写入共享集合 generic_theme_movies（按 theme 字段区分主题）。
// 豆瓣搜索/封面下载上传/断点续传逻辑沿用 fetchOscarAnimeMovies，把 collection 和名单参数化，
// 让新增一个"给名单-抓封面评分-上线"类主题不用再复制一份采集云函数。
//
// 片名规范化：匹配到豆瓣条目后，会再调豆瓣详情接口取大陆标准（简体）片名覆盖 title 入库，
// 名单里传入的原始标题留档到 sourceTitle 字段——名单来源是港台繁体译名时无需人工订正。
const cloud = require('wx-server-sdk');
const axios = require('axios');
const cheerio = require('cheerio');

cloud.init({
    env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const collection = db.collection('generic_theme_movies');
const MAX_LIMIT = 100;

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

/**
 * 搜索豆瓣提取封面和评分
 * 搜索策略：依次尝试 "中文名 年份"、"英文名 年份"、"中文名"、"英文名"
 *   —— 「英文名 年份」提到前面，泛用中文名（如「南极探险」）易撞热门条目，英文名基本不撞车。
 * 匹配策略：跨所有查询优先返回「年份吻合」的候选（避免同名/撞名误匹配），
 *   全程都没有年份吻合时，才兜底取首个成功查询的第一条。
 */
async function fetchDoubanInfo(originalTitle, chineseTitle, year) {
    const searchQueries = [
        chineseTitle && year ? `${chineseTitle} ${year}` : null,
        originalTitle && year ? `${originalTitle} ${year}` : null,
        chineseTitle,
        originalTitle
    ].filter(Boolean);

    const toInfo = (c) => ({
        doubanId: c.doubanId,
        coverUrl: c.coverUrl || '',
        rating: c.rating ? parseFloat(c.rating) : 0
    });

    let fallback = null; // 首个非年份吻合的候选，全程没年份吻合时兜底

    for (const query of searchQueries) {
        try {
            const searchUrl = `https://m.douban.com/search/?query=${encodeURIComponent(query)}`;
            const res = await axios.get(searchUrl, {
                timeout: 10000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.3 Mobile/15E148 Safari/604.1',
                    'Accept-Charset': 'utf-8'
                }
            });

            const $ = cheerio.load(res.data);
            const candidates = [];
            $('.search-module li').each((i, el) => {
                const href = $(el).find('a').attr('href');
                if (href && href.includes('/movie/subject/')) {
                    const coverUrl = $(el).find('img').attr('src');
                    const rating = $(el).find('.rating span:nth-child(2)').text().trim();
                    const infoText = $(el).text();

                    let doubanId = '';
                    const match = href.match(/\/subject\/(\d+)\//);
                    if (match && match[1]) doubanId = match[1];

                    const yearMatch = year ? infoText.includes(String(year)) : false;

                    if (doubanId) candidates.push({ coverUrl, rating, doubanId, yearMatch });
                }
            });

            if (candidates.length === 0) continue;

            // 有年份的场景：优先返回本次查询里年份吻合的候选
            const yearHit = year ? candidates.find(c => c.yearMatch) : null;
            if (yearHit) {
                console.log(`  -> Matched douban ID: ${yearHit.doubanId}, year match: true, query: "${query}"`);
                return toInfo(yearHit);
            }

            // 没年份约束（year 为空）：沿用旧行为，直接取第一条
            if (!year) {
                console.log(`  -> Matched douban ID: ${candidates[0].doubanId}, year match: false, query: "${query}"`);
                return toInfo(candidates[0]);
            }

            // 有年份但本次无吻合：记下兜底候选，继续尝试后续查询（尤其「英文名 年份」）
            if (!fallback) fallback = { cand: candidates[0], query };
        } catch (error) {
            console.error(`Fetch douban info failed for "${query}":`, error.message);
        }
    }

    if (fallback) {
        console.log(`  -> Fallback douban ID: ${fallback.cand.doubanId}, year match: false, query: "${fallback.query}"`);
        return toInfo(fallback.cand);
    }
    return null;
}

/**
 * 豆瓣 rexxar 详情接口：取大陆标准（简体）片名。
 * URL/headers 复用 checkDoubanTitles 已验证的同款接口；失败时返回 null，调用方保留名单原标题。
 */
async function fetchDoubanStandardTitle(doubanId) {
    try {
        const res = await axios.get(`https://m.douban.com/rexxar/api/v2/movie/${doubanId}`, {
            timeout: 10000,
            responseType: 'json',
            headers: {
                'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.3 Mobile/15E148 Safari/604.1',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
                'Referer': 'https://m.douban.com/'
            }
        });
        const j = (res && res.data) || {};
        return j.title || '';
    } catch (e) {
        console.warn(`Fetch standard title failed for douban ${doubanId}:`, e.message);
        return '';
    }
}

/**
 * 下载图片并上传至云存储，失败时回退原图 URL
 */
async function downloadAndUploadImage(imageUrl, theme, movieId) {
    try {
        const highResUrl = imageUrl.replace('/s_ratio_poster/', '/m_ratio_poster/');

        const response = await axios({
            url: highResUrl,
            responseType: 'arraybuffer',
            timeout: 15000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Referer': 'https://movie.douban.com/'
            }
        });

        const fileName = `${theme}_covers/${movieId}_${Date.now()}.jpg`;
        const uploadResult = await cloud.uploadFile({
            cloudPath: fileName,
            fileContent: response.data
        });

        return uploadResult.fileID;

    } catch (e) {
        console.warn(`Image download failed for ${movieId}, fallback to original url`, e.message);
        return imageUrl;
    }
}

exports.main = async (event, context) => {
    const START_TIME = Date.now();
    const TIME_LIMIT = 45000;

    const {
        theme,
        movieList,
        idStrategy = 'rank',
        forceRefresh = false,
        startFrom = 0
    } = event || {};

    if (!theme) {
        return { success: false, error: '缺少 theme 参数' };
    }
    if (!Array.isArray(movieList) || movieList.length === 0) {
        return { success: false, error: 'movieList 为空' };
    }

    try {
        console.log(`[enrichThemeMovies] theme=${theme} idStrategy=${idStrategy} total=${movieList.length} startFrom=${startFrom} forceRefresh=${forceRefresh}`);

        const existingList = await fetchExistingByTheme(theme);
        const existingByRank = {};
        const existingByTitleYear = {};
        existingList.forEach(m => {
            if (m.rank != null) existingByRank[m.rank] = m;
            if (m.originalTitle != null && m.year != null) {
                existingByTitleYear[`${m.originalTitle}__${m.year}`] = m;
            }
        });

        const pending = movieList.slice(startFrom);
        let processedCount = 0;
        let stoppedEarly = false;
        // 记录本轮已用过的 doubanId → 标题，用于发现「两部不同电影匹配到同一个豆瓣条目」的误匹配
        const seenDoubanIds = {};

        const toAdd = [];
        const toUpdate = [];

        for (let i = 0; i < pending.length; i++) {
            if (Date.now() - START_TIME > TIME_LIMIT) {
                console.warn(`[enrichThemeMovies] 超时，已处理 ${processedCount}/${pending.length}，在 index ${startFrom + i} 停止`);
                stoppedEarly = true;
                break;
            }

            const movieTarget = pending[i];
            const { rank, year, title, originalTitle } = movieTarget;

            const existingDoc = idStrategy === 'title-year'
                ? existingByTitleYear[`${originalTitle}__${year}`]
                : existingByRank[rank];

            // 封面已就绪且非强制刷新：不必重新搜豆瓣/重新下载图片，只按需轻量 patch 调用方传入的字段
            // （比如后续发现片名要从港台译名改成大陆译名），避免每次订正元数据都重新爬一遍豆瓣。
            if (!forceRefresh && existingDoc && existingDoc.cover && existingDoc.cover.startsWith('cloud://')) {
                const patch = { ...movieTarget, theme };
                delete patch._id;
                // 库内 title 已被豆瓣标准片名覆盖过（sourceTitle 存的是名单原始标题）；
                // 同一份原始名单再跑一遍时，不要把订正后的片名改回繁体/港台译名
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

            console.log(`[enrichThemeMovies] 搜索豆瓣: ${title} / ${originalTitle} (${year})`);
            const doubanInfo = await fetchDoubanInfo(originalTitle, title, year);

            if (doubanInfo) {
                if (doubanInfo.doubanId) {
                    if (seenDoubanIds[doubanInfo.doubanId] != null) {
                        console.warn(`[误匹配] "${title}" 与 "${seenDoubanIds[doubanInfo.doubanId]}" 都匹配到豆瓣条目 ${doubanInfo.doubanId}，请人工核对封面`);
                    } else {
                        seenDoubanIds[doubanInfo.doubanId] = title;
                    }
                }

                const docId = existingDoc
                    ? existingDoc._id
                    : (idStrategy === 'title-year' ? `${theme}_${slugify(originalTitle)}_${year}` : `${theme}_${rank}`);

                const finalMovieData = {
                    ...movieTarget,
                    theme,
                    doubanId: doubanInfo.doubanId,
                    coverUrl: doubanInfo.coverUrl,
                    rating: doubanInfo.rating,
                    updateTime: db.serverDate()
                };
                delete finalMovieData._id;

                // 用豆瓣标准（简体）片名覆盖名单标题，原始标题留档；接口失败则保留名单标题
                if (doubanInfo.doubanId) {
                    const standardTitle = await fetchDoubanStandardTitle(doubanInfo.doubanId);
                    if (standardTitle && standardTitle !== finalMovieData.title) {
                        finalMovieData.sourceTitle = movieTarget.title;
                        finalMovieData.title = standardTitle;
                        console.log(`  -> 片名订正: "${movieTarget.title}" → "${standardTitle}"`);
                    }
                }

                if (finalMovieData.coverUrl) {
                    finalMovieData.cover = await downloadAndUploadImage(finalMovieData.coverUrl, theme, docId);
                } else {
                    finalMovieData.cover = '';
                }

                if (existingDoc) {
                    if (!forceRefresh && existingDoc.cover && existingDoc.cover.startsWith('cloud://')) {
                        delete finalMovieData.cover;
                    }
                    toUpdate.push({ _id: existingDoc._id, data: finalMovieData });
                } else {
                    finalMovieData._id = docId;
                    finalMovieData.createTime = db.serverDate();
                    toAdd.push(finalMovieData);
                }
            } else {
                console.warn(`[enrichThemeMovies] 豆瓣未匹配到: ${title} / ${originalTitle}`);
            }

            processedCount++;
            await new Promise(r => setTimeout(r, 800));
        }

        for (const update of toUpdate) {
            await collection.doc(update._id).update({ data: update.data }).catch(console.error);
        }

        for (let i = 0; i < toAdd.length; i += 20) {
            const batch = toAdd.slice(i, i + 20);
            await Promise.all(batch.map(m => collection.add({ data: m }))).catch(console.error);
        }

        const nextStartFrom = startFrom + processedCount;

        return {
            success: true,
            processed: processedCount,
            added: toAdd.length,
            updated: toUpdate.length,
            stoppedEarly,
            nextStartFrom: stoppedEarly ? nextStartFrom : 0,
            hint: stoppedEarly ? `未处理完，下次请传入 { "theme": "${theme}", "movieList": [...同一份名单], "startFrom": ${nextStartFrom} } 继续` : '全部处理完成'
        };

    } catch (err) {
        console.error('[enrichThemeMovies] 执行失败:', err);
        return { success: false, error: err.message };
    }
};
