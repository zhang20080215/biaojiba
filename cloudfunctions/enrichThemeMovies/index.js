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

// 候选校验最多拉几条详情：常规情况第一条就中，这里只是兜住"泛用词首条候选不对"的坏情况
const MAX_VERIFY_PER_QUERY = 2;

function normalizeForMatch(s) {
    return String(s || '')
        .toLowerCase()
        .replace(/[\s·・\-–—.,:;'’"“”!！?？()（）\[\]]/g, '');
}

// 基本质量闸门：评分为 0、没封面、或不是电影（综艺/电视剧等 subtype !== 'movie'）——
// 实测这三种情况基本都是撞错条目，不管标题/年份是否对得上都直接排除，不进入候选甚至不当兜底。
function isBasicallyValid(detail) {
    if (!detail) return false;
    if (detail.subtype && detail.subtype !== 'movie') return false;
    if (!detail.rating) return false;
    if (!detail.coverUrl) return false;
    return true;
}

// 详情是否可信匹配目标：original_title/aka 精确对上，或年份相差 ≤1（regional release 常见偏差）
function isDetailMatch(detail, year, originalTitle) {
    if (!detail) return false;
    const normTarget = normalizeForMatch(originalTitle);
    const normDetailOrig = normalizeForMatch(detail.originalTitle);
    if (normTarget && normDetailOrig && normDetailOrig === normTarget) return true;
    if (normTarget && (detail.aka || []).some(a => normalizeForMatch(a) === normTarget)) return true;
    return detail.year != null && year != null && Math.abs(detail.year - year) <= 1;
}

/**
 * 豆瓣 rexxar 详情接口：取标准片名/年份/原名/别名/封面/评分，用于候选校验 + 灌库数据。
 * URL/headers 复用 checkDoubanTitles 已验证的同款接口；失败时返回 null。
 */
async function fetchDoubanDetail(doubanId) {
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
        if (!j || !j.id) return null;
        return {
            title: j.title || '',
            year: j.year ? parseInt(j.year, 10) : null,
            originalTitle: j.original_title || '',
            aka: j.aka || [],
            directors: (j.directors || []).map(d => d.name).filter(Boolean).join('、'),
            countries: (j.countries || []).filter(Boolean)[0] || '', // 合拍片只取第一个国家，不要罗列一长串
            coverUrl: (j.pic && (j.pic.large || j.pic.normal)) || j.cover_url || '',
            rating: j.rating && typeof j.rating.value === 'number' ? j.rating.value : 0,
            subtype: j.subtype || '' // 'movie' | 'tv'，非电影（综艺/电视剧）用来在校验阶段直接排除
        };
    } catch (e) {
        console.warn(`Fetch douban detail failed for ${doubanId}:`, e.message);
        return null;
    }
}

/**
 * 搜索豆瓣提取封面和评分
 * 搜索策略：依次尝试 "中文名 年份"、"英文名 年份"、"中文名"、"英文名"
 *   —— 「英文名 年份」提到前面，泛用中文名（如「南极探险」）易撞热门条目，英文名基本不撞车。
 * 匹配策略：豆瓣搜索结果页文案早已不带年份，光靠候选列表文本猜年份等于没校验（曾误配「地下」
 *   「寄生上流」等条目）——改成对每条 query 的前 N 条候选逐个拉详情，先过 isBasicallyValid 质量闸门
 *   （评分0/无封面/非电影一律排除，实测这三种信号基本都是撞错条目——比如撞到同名综艺/电视剧），
 *   再用 original_title/aka/year 做真校验，通过才采纳；全程都没标题/年份校验通过时，兜底取第一个
 *   "至少过了质量闸门"的候选，标记 matchVerified:false 交给调用方汇总提醒人工核对；
 *   若连质量闸门都没有候选通过，直接返回 null（调用方会跳过该条，计入 unmatchedMovies）。
 */
async function fetchDoubanInfo(originalTitle, chineseTitle, year) {
    const searchQueries = [
        chineseTitle && year ? `${chineseTitle} ${year}` : null,
        originalTitle && year ? `${originalTitle} ${year}` : null,
        chineseTitle,
        originalTitle
    ].filter(Boolean);

    let fallback = null; // 全程都没校验通过时兜底：首个成功查询的第一条候选

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

                    let doubanId = '';
                    const match = href.match(/\/subject\/(\d+)\//);
                    if (match && match[1]) doubanId = match[1];

                    if (doubanId) candidates.push({ coverUrl, rating, doubanId });
                }
            });

            if (candidates.length === 0) continue;

            for (const cand of candidates.slice(0, MAX_VERIFY_PER_QUERY)) {
                const detail = await fetchDoubanDetail(cand.doubanId);
                // 质量闸门先过：评分0/无封面/非电影（综艺、电视剧等）直接排除，连兜底候选都不当
                if (!isBasicallyValid(detail)) {
                    console.warn(`  -> 排除候选 doubanId=${cand.doubanId}（评分0或无封面或非电影 subtype=${detail && detail.subtype}），query: "${query}"`);
                    continue;
                }
                if (isDetailMatch(detail, year, originalTitle)) {
                    console.log(`  -> 已验证匹配 doubanId=${cand.doubanId}「${detail.title}」, query: "${query}"`);
                    return {
                        doubanId: cand.doubanId,
                        coverUrl: detail.coverUrl || cand.coverUrl || '',
                        rating: detail.rating || (cand.rating ? parseFloat(cand.rating) : 0),
                        title: detail.title,
                        directors: detail.directors,
                        countries: detail.countries,
                        matchVerified: true
                    };
                }
                if (!fallback) fallback = { cand, detail, query };
            }
        } catch (error) {
            console.error(`Fetch douban info failed for "${query}":`, error.message);
        }
    }

    if (fallback) {
        console.warn(`  -> [未验证匹配] 兜底 doubanId=${fallback.cand.doubanId}，query: "${fallback.query}"，需人工核对`);
        return {
            doubanId: fallback.cand.doubanId,
            coverUrl: fallback.detail.coverUrl || fallback.cand.coverUrl || '',
            rating: fallback.detail.rating || (fallback.cand.rating ? parseFloat(fallback.cand.rating) : 0),
            title: fallback.detail.title,
            directors: fallback.detail.directors,
            countries: fallback.detail.countries,
            matchVerified: false
        };
    }
    return null;
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

// 灌库前自检：写库前把脏数据/字段问题挡下（与 tools/validate-seed.js 同源的精简版）。
// 只做与主题无关的通用检查；不校验 rank 连续性（允许传子集做单条修正）。
function validateMovieList(movieList) {
    const errors = [], warns = [];
    const TW = { '义大利': '意大利', '纽西兰': '新西兰', '南韩': '韩国', '北韩': '朝鲜', '俄国': '俄罗斯', '寮国': '老挝' };
    const DIRTY = /[<>]|&[a-zA-Z#0-9]+;|（[^）]*(语|語)[:：]|[《》\[\]|]|\s{2,}/;
    const curYear = new Date().getFullYear();
    const ranks = new Set();
    movieList.forEach((m, i) => {
        const tag = `#${m && m.rank != null ? m.rank : 'idx' + i} ${(m && m.year) || ''} ${(m && m.title) || ''}`.trim();
        if (!m || typeof m !== 'object') { errors.push(`${tag}: 非对象`); return; }
        if (typeof m.rank !== 'number') errors.push(`${tag}: rank 非数字`);
        else { if (ranks.has(m.rank)) errors.push(`${tag}: rank 重复`); ranks.add(m.rank); }
        if (typeof m.year !== 'number' || m.year < 1910 || m.year > curYear + 1) errors.push(`${tag}: year 非法(${m.year})`);
        if (!m.title || !String(m.title).trim()) errors.push(`${tag}: title 为空`);
        if (!m.originalTitle || !String(m.originalTitle).trim()) warns.push(`${tag}: originalTitle 为空`);
        ['title', 'originalTitle', 'director', 'country'].forEach(k => { if (m[k] && DIRTY.test(String(m[k]))) warns.push(`${tag}: ${k} 含可疑字符 → "${m[k]}"`); });
        if (m.director && /[（(]/.test(m.director)) warns.push(`${tag}: director 含括注 → "${m.director}"`);
        ['director', 'country', 'title'].forEach(k => { const v = String(m[k] || ''); Object.keys(TW).forEach(tw => { if (v.includes(tw)) warns.push(`${tag}: ${k} 港台译名「${tw}」→ 建议「${TW[tw]}」`); }); });
    });
    return { errors, warns };
}

exports.main = async (event, context) => {
    const START_TIME = Date.now();
    const TIME_LIMIT = 45000;

    const {
        theme,
        movieList,
        idStrategy = 'rank',
        forceRefresh = false,
        startFrom = 0,
        autoContinue = false,  // true 时：跑完一批自动调用自身接力，直到全部处理完（只需手动点一次）
        skipValidation = false // true 时：跳过灌库前自检（仅在明知数据有意“不规范”时用）
    } = event || {};

    if (!theme) {
        return { success: false, error: '缺少 theme 参数' };
    }
    if (!Array.isArray(movieList) || movieList.length === 0) {
        return { success: false, error: 'movieList 为空' };
    }

    // ── 灌库前自检：只在首批（startFrom===0）跑一次；有 ERROR 直接拦下，不写脏数据 ──
    let validationWarns = [];
    if (startFrom === 0) {
        const v = validateMovieList(movieList);
        validationWarns = v.warns;
        if (v.warns.length) console.warn(`[enrichThemeMovies] 自检 WARN (${v.warns.length}):\n` + v.warns.join('\n'));
        if (v.errors.length && !skipValidation) {
            console.error(`[enrichThemeMovies] 自检 ERROR (${v.errors.length})，已拦下:\n` + v.errors.join('\n'));
            return { success: false, error: `数据自检未通过（${v.errors.length} 个错误）`, validation: v, hint: '修正 movieList 后重试；确要强灌可传 skipValidation:true' };
        }
        if (v.errors.length) console.warn(`[enrichThemeMovies] 自检 ERROR (${v.errors.length}) 被 skipValidation 跳过`);
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
        const matchWarnings = []; // 豆瓣匹配没通过校验、走兜底的条目，提醒人工核对
        const unmatchedMovies = []; // 连质量闸门都没有候选通过、完全没写入的条目（评分0/无封面/非电影），需人工手动核对补充

        // 预扫描：调序（插入/删除导致其余条目整体错位）场景下，同一部电影按 originalTitle+year 认身份，
        // 提前"认领"它在数据库里已有的记录（不管当前 rank 是多少）——避免它被当成"这个 rank 位置上的
        // 另一部电影"而重新搜豆瓣，也避免它的旧 _id 被后面按 rank 匹配到的新电影顶替内容。
        // 只claim「rank 真的变了」的记录——rank 没变的正常情况不进 claimedIds，
        // 否则下面 existingDoc 查找会把"就是它自己"误判成"被占用"，反而造出一条重复记录。
        const claimedIds = new Set();
        if (idStrategy === 'rank') {
            pending.forEach(mt => {
                if (mt.originalTitle != null && mt.year != null) {
                    const im = existingByTitleYear[`${mt.originalTitle}__${mt.year}`];
                    if (im && im.rank !== mt.rank) claimedIds.add(im._id);
                }
            });
        }

        for (let i = 0; i < pending.length; i++) {
            if (Date.now() - START_TIME > TIME_LIMIT) {
                console.warn(`[enrichThemeMovies] 超时，已处理 ${processedCount}/${pending.length}，在 index ${startFrom + i} 停止`);
                stoppedEarly = true;
                break;
            }

            const movieTarget = pending[i];
            const { rank, year, title, originalTitle } = movieTarget;

            const identityMatch = (idStrategy === 'rank' && originalTitle != null && year != null)
                ? existingByTitleYear[`${originalTitle}__${year}`]
                : null;

            // 身份对得上（同一部电影），但 rank 变了：只是调序，不用重新查豆瓣，直接改序号等名单字段
            if (identityMatch && identityMatch.rank !== rank) {
                const patch = { ...movieTarget, theme };
                delete patch._id;
                if (identityMatch.sourceTitle && patch.title === identityMatch.sourceTitle) delete patch.title;
                const hasChanges = Object.keys(patch).some(k => JSON.stringify(patch[k]) !== JSON.stringify(identityMatch[k]));
                if (hasChanges) {
                    toUpdate.push({ _id: identityMatch._id, data: { ...patch, updateTime: db.serverDate() } });
                    console.log(`[enrichThemeMovies] 仅调整序号（未重新查豆瓣）: "${title}" rank ${identityMatch.rank} → ${rank}`);
                }
                processedCount++;
                continue;
            }

            const existingDoc = idStrategy === 'title-year'
                ? existingByTitleYear[`${originalTitle}__${year}`]
                : (existingByRank[rank] && !claimedIds.has(existingByRank[rank]._id) ? existingByRank[rank] : null);

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
                // 名单本身没带导演/国家（比如 oscarScreenplay 只有片名+年份）且库里也缺：
                // doubanId 已知，查一次详情补齐，不重新搜索/不重下封面
                if ((!existingDoc.director || !existingDoc.country) && existingDoc.doubanId) {
                    const detail = await fetchDoubanDetail(existingDoc.doubanId);
                    if (detail) {
                        if (!existingDoc.director && !patch.director && detail.directors) patch.director = detail.directors;
                        if (!existingDoc.country && !patch.country && detail.countries) patch.country = detail.countries;
                    }
                }
                const hasChanges = Object.keys(patch).some(k => JSON.stringify(patch[k]) !== JSON.stringify(existingDoc[k]));
                if (hasChanges) {
                    toUpdate.push({ _id: existingDoc._id, data: { ...patch, updateTime: db.serverDate() } });
                }
                processedCount++;
                continue;
            }

            // 名单条目可手动指定 doubanId（人工在豆瓣核实过的正确条目，比如搜索误配到同名综艺/其他影片时）：
            // 跳过搜索直接取详情，视为已核实，不再走候选校验流程
            let doubanInfo;
            if (movieTarget.doubanId) {
                console.log(`[enrichThemeMovies] 使用名单手动指定的 doubanId=${movieTarget.doubanId}: ${title}`);
                const detail = await fetchDoubanDetail(movieTarget.doubanId);
                doubanInfo = detail ? {
                    doubanId: movieTarget.doubanId,
                    coverUrl: detail.coverUrl || '',
                    rating: detail.rating || 0,
                    title: detail.title,
                    directors: detail.directors,
                    countries: detail.countries,
                    matchVerified: true
                } : null;
            } else {
                console.log(`[enrichThemeMovies] 搜索豆瓣: ${title} / ${originalTitle} (${year})`);
                doubanInfo = await fetchDoubanInfo(originalTitle, title, year);
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
                    matchWarnings.push(`#${rank != null ? rank : ''} ${year} ${title}: 豆瓣匹配未通过校验（doubanId=${doubanInfo.doubanId}），请人工核对是否为「${originalTitle}」`);
                }

                // 按 rank 生成的"自然" _id（theme_rank）如果已经被别的电影身份认领占用了
                // （调序场景下常见），改用按身份生成的 _id，避免新增时撞车已有文档
                const naturalRankId = `${theme}_${rank}`;
                const docId = existingDoc
                    ? existingDoc._id
                    : (idStrategy === 'title-year' || claimedIds.has(naturalRankId)
                        ? `${theme}_${slugify(originalTitle)}_${year}`
                        : naturalRankId);

                const finalMovieData = {
                    ...movieTarget,
                    theme,
                    doubanId: doubanInfo.doubanId,
                    coverUrl: doubanInfo.coverUrl,
                    rating: doubanInfo.rating,
                    updateTime: db.serverDate()
                };
                delete finalMovieData._id;

                // 名单没带导演/国家（比如 oscarScreenplay）时，用豆瓣详情里的数据补齐；
                // 名单已经手工提供的（比如 palmeDor）不覆盖
                if (!finalMovieData.director && doubanInfo.directors) finalMovieData.director = doubanInfo.directors;
                if (!finalMovieData.country && doubanInfo.countries) finalMovieData.country = doubanInfo.countries;

                // 用豆瓣标准（简体）片名覆盖名单标题，原始标题留档；接口失败则保留名单标题
                if (doubanInfo.title && doubanInfo.title !== finalMovieData.title) {
                    finalMovieData.sourceTitle = movieTarget.title;
                    finalMovieData.title = doubanInfo.title;
                    console.log(`  -> 片名订正: "${movieTarget.title}" → "${doubanInfo.title}"`);
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
                // 手动指定 doubanId 时走的是直接取详情（非搜索候选），失败原因跟"候选全被质量闸门拦下"不是一回事，
                // 常见是豆瓣临时限流/反爬验证（need_permission），消息分开避免误导排查方向
                const reason = movieTarget.doubanId
                    ? `手动指定的 doubanId=${movieTarget.doubanId} 详情请求失败，大概率是豆瓣临时限流/反爬验证，建议隔一段时间重试`
                    : '候选全部评分0/无封面/非电影，未写入，需人工核实豆瓣ID';
                unmatchedMovies.push(`#${rank != null ? rank : ''} ${year} ${title}（${originalTitle}）: ${reason}`);
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

        // 自动接力：开启 autoContinue、本轮有进展、且还没跑完时，触发下一棒（fire-and-forget）。
        // 注意：cloud.callFunction 是同步调用（会等子任务返回），不能 await —— 否则整条链嵌套等待必然超时；
        // 只创建调用（请求即刻发出）+ 短暂等待确保请求离开容器，随后本轮正常结束，子任务在独立容器继续。
        let autoChained = false;
        if (stoppedEarly && autoContinue && processedCount > 0) {
            try {
                cloud.callFunction({
                    name: 'enrichThemeMovies',
                    data: { theme, movieList, idStrategy, forceRefresh, startFrom: nextStartFrom, autoContinue: true }
                }).catch(e => console.error('[enrichThemeMovies] 自动接力触发失败:', e && e.message));
                await new Promise(r => setTimeout(r, 1200));
                autoChained = true;
                console.log(`[enrichThemeMovies] 自动接力已触发：从 ${nextStartFrom} 继续`);
            } catch (e) {
                console.error('[enrichThemeMovies] 自动接力异常:', e && e.message);
            }
        }

        return {
            success: true,
            processed: processedCount,
            added: toAdd.length,
            updated: toUpdate.length,
            stoppedEarly,
            autoChained,
            validationWarns,   // 首批自检的告警（脏文本/港台译名/缺 originalTitle 等），仅提示不拦截
            matchWarnings,     // 本轮豆瓣匹配没通过 original_title/aka/year 校验、走兜底的条目，需人工核对
            unmatchedMovies,   // 本轮完全没写入的条目（候选全部评分0/无封面/非电影），需人工核实补充
            nextStartFrom: stoppedEarly ? nextStartFrom : 0,
            hint: !stoppedEarly
                ? '全部处理完成'
                : autoChained
                    ? `已自动接力，从 ${nextStartFrom} 继续（无需再手动，几分钟后用 getThemeMovies 查条数确认）`
                    : `未处理完，下次请传入 { "theme": "${theme}", "movieList": [...同一份名单], "startFrom": ${nextStartFrom} } 继续`
        };

    } catch (err) {
        console.error('[enrichThemeMovies] 执行失败:', err);
        return { success: false, error: err.message };
    }
};
