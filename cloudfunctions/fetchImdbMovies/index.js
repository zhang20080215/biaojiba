/**
 * fetchImdbMovies —— IMDb TOP250 灌库
 *
 * 【为什么不再抓 imdb.com】
 * imdb.com 对云函数出口 IP 和开发机都做了反爬（返回 202 + 空 body），
 * 原来每天 3 点的 dailyFetchMovies 定时器早已抓不到数据，榜单停更。
 * 现在名单改为「本地用浏览器取 → 生成 imdbTop250.js → 随函数部署」，
 * 云函数只负责：下封面转云存储、查豆瓣中文译名、写库、软删掉榜影片。
 * 刷新名单的完整流程见 tools/imdb-seed/README.md。
 *
 * 参数（都可省略）：
 *   dryRun       true = 只比对不写库，返回「新进榜/掉榜/名次变化」清单
 *   startFrom    从名单第几个下标继续（断点续跑）
 *   autoContinue true = 超时自动接力跑完
 *   forceRefresh true = 已转存云存储的封面也重下（换封面时用，会产生孤儿文件）
 *   skipTranslate true = 跳过豆瓣译名查询（只想刷名次/评分时更快）
 *   movieList    覆盖内置名单（应急用，格式同 imdbTop250.js）
 *
 * 身份键是 IMDb ID（= imdb_movies 的 _id），重新灌库不会动用户已有的 Marks。
 */

const cloud = require('wx-server-sdk');
const axios = require('axios');
const cheerio = require('cheerio');
const { IMDB_TOP250, SNAPSHOT_DATE } = require('./imdbTop250.js');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const imdbCollection = db.collection('imdb_movies');

const MIN_ACCEPT = 240;      // 名单少于此值视为异常，拒绝写库（防止把好数据覆盖坏）
const TIME_LIMIT = 45000;    // 单次执行安全阈值，超过就存进度、下次续跑
const READ_PAGE = 100;       // 分页读上限

/**
 * IMDb 原图 URL → 180×266 缩略图
 * 原图形如 .../MV5Bxxxx@._V1_.jpg，替换中间的尺寸段
 */
function thumbUrl(url) {
    if (!url) return '';
    return url.replace(/@\._V1_[^.]*\./, '@._V1_QL75_UX180_CR0,0,180,266_.');
}

/**
 * 用 IMDb ID 精准查豆瓣移动版搜索，拿官方中文译名
 * 查不到就返回 fallback（英文原名），不阻塞灌库
 */
async function translateTitle(imdbId, fallbackTitle) {
    try {
        const res = await axios.get(`https://m.douban.com/search/?query=${imdbId}&type=movie`, {
            timeout: 8000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.3 Mobile/15E148 Safari/604.1',
                'Accept-Charset': 'utf-8'
            },
            responseType: 'text',
            responseEncoding: 'utf8'
        });

        const $ = cheerio.load(res.data);
        const zhTitle = $('.subject-title').first().text().trim();

        if (zhTitle && !zhTitle.includes('�') && zhTitle !== '?' && /[一-龥]/.test(zhTitle)) {
            return zhTitle;
        }
        return fallbackTitle;
    } catch (e) {
        console.warn(`译名查询失败 ${imdbId}: ${e.message}`);
        return fallbackTitle;
    }
}

/**
 * 下载 IMDb 封面并转存云存储，返回 fileID；失败返回原始 URL 兜底
 */
async function mirrorCover(imageUrl, movieId, retryCount = 0) {
    try {
        const response = await axios({
            url: imageUrl,
            responseType: 'arraybuffer',
            timeout: 15000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
            }
        });

        console.log(`封面下载 ${movieId} - ${(response.data.length / 1024).toFixed(1)}KB`);

        const uploadResult = await cloud.uploadFile({
            cloudPath: `imdb_covers/${movieId}_${Date.now()}.jpg`,
            fileContent: response.data
        });

        await saveImageInfo(movieId, {
            fileID: uploadResult.fileID,
            cdnUrl: uploadResult.fileID,
            originalUrl: imageUrl,
            uploadTime: new Date()
        });

        return { fileID: uploadResult.fileID, cdnUrl: uploadResult.fileID, originalUrl: imageUrl };
    } catch (error) {
        console.error(`封面处理失败（第 ${retryCount} 次重试, ${movieId}）: ${error.message}`);
        if (retryCount < 2) {
            await new Promise(resolve => setTimeout(resolve, 2000));
            return mirrorCover(imageUrl, movieId, retryCount + 1);
        }
        return { fileID: '', cdnUrl: imageUrl, originalUrl: imageUrl, isFallback: true };
    }
}

/**
 * 记录封面对应关系（movie_images 集合，跨主题共用）
 */
async function saveImageInfo(movieId, imageInfo) {
    try {
        await db.collection('movie_images').where({ movieId }).update({ data: { ...imageInfo } })
            .catch(async (err) => {
                if (err.errCode === -502005) {
                    await db.collection('movie_images').add({ data: { movieId, ...imageInfo } });
                } else {
                    throw err;
                }
            });
    } catch (error) {
        console.error('封面记录写入失败:', error.message);
    }
}

/**
 * 读出 imdb_movies 全量（含已软删的），按 _id 建索引
 */
async function fetchExisting() {
    const { total } = await imdbCollection.count();
    let all = [];
    for (let i = 0; i < total; i += READ_PAGE) {
        const batch = await imdbCollection.skip(i).limit(READ_PAGE).get();
        all = all.concat(batch.data);
    }
    const map = {};
    all.forEach(m => { map[m._id] = m; });
    return { map, all };
}

exports.main = async (event) => {
    const START_TIME = Date.now();
    const {
        dryRun = false,
        startFrom = 0,
        autoContinue = false,
        forceRefresh = false,
        skipTranslate = false,
        movieList
    } = event || {};

    try {
        const list = Array.isArray(movieList) && movieList.length ? movieList : IMDB_TOP250;

        if (list.length < MIN_ACCEPT) {
            return {
                success: false,
                error: `名单只有 ${list.length} 条，少于下限 ${MIN_ACCEPT}，放弃写库`,
                count: list.length
            };
        }

        const { map: existingMap, all: existingAll } = await fetchExisting();
        const currentIds = new Set(list.map(m => m.id));

        // 掉榜：库里还挂着 isTop250 而新名单里没有的
        const toSoftDelete = existingAll
            .filter(m => m.isTop250 !== false && !currentIds.has(m._id))
            .map(m => m._id);

        // —— 预演模式：只报差异，不写库 ——
        if (dryRun) {
            const newEntries = list
                .filter(m => !existingMap[m.id] || existingMap[m.id].isTop250 === false)
                .map(m => `#${m.rank} ${m.title} (${m.year})`);
            const rankMoved = list
                .filter(m => existingMap[m.id] && existingMap[m.id].rank !== m.rank)
                .map(m => `${m.title}: ${existingMap[m.id].rank} → ${m.rank}`);
            const noCnTitle = list
                .filter(m => !existingMap[m.id] || !/[一-龥]/.test(existingMap[m.id].title || ''))
                .map(m => `${m.id} ${m.title}`);

            return {
                success: true,
                dryRun: true,
                snapshotDate: SNAPSHOT_DATE,
                listCount: list.length,
                dbCount: existingAll.length,
                dbInTop250: existingAll.filter(m => m.isTop250 !== false).length,
                newEntryCount: newEntries.length,
                newEntries,
                dropOutCount: toSoftDelete.length,
                dropOuts: toSoftDelete.map(id => `${id} ${(existingMap[id] || {}).title || ''}`),
                rankMovedCount: rankMoved.length,
                rankMoved: rankMoved.slice(0, 40),
                needTranslateCount: noCnTitle.length,
                needTranslate: noCnTitle
            };
        }

        // —— 掉榜软删除（只在首批做一次，避免续跑时重复写）——
        let softDeleted = 0;
        if (startFrom === 0 && toSoftDelete.length > 0) {
            await imdbCollection.where({ _id: _.in(toSoftDelete) }).update({
                data: {
                    isTop250: false,
                    exitTop250Time: db.serverDate(),
                    updateTime: db.serverDate()
                }
            });
            softDeleted = toSoftDelete.length;
            console.log(`软删除掉榜影片 ${softDeleted} 部`);
        }

        const pending = list.slice(startFrom);
        const toAdd = [];
        const toUpdate = [];
        const untranslated = [];
        let processed = 0;
        let coverDownloaded = 0;
        let stoppedEarly = false;

        for (let i = 0; i < pending.length; i++) {
            if (Date.now() - START_TIME > TIME_LIMIT) {
                stoppedEarly = true;
                break;
            }

            const movie = pending[i];
            const prev = existingMap[movie.id];
            const coverUrl = thumbUrl(movie.cover);

            // 封面：已转存云存储且地址没变 → 沿用，不重复下载
            let cover = prev ? prev.cover : '';
            let cdnUrl = prev ? prev.coverUrl : '';
            const cached = prev && String(prev.cover || '').startsWith('cloud://') && prev.originalCover === coverUrl;
            if (coverUrl && (forceRefresh || !cached)) {
                const info = await mirrorCover(coverUrl, movie.id);
                if (info.fileID) {
                    cover = info.fileID;
                    cdnUrl = info.cdnUrl;
                    coverDownloaded++;
                } else if (!cover) {
                    cover = info.cdnUrl;
                    cdnUrl = info.cdnUrl;
                }
            }

            // 中文译名：库里已是中文就沿用，否则查豆瓣
            let title = prev && /[一-龥]/.test(prev.title || '') ? prev.title : movie.title;
            if (!skipTranslate && !/[一-龥]/.test(title)) {
                title = await translateTitle(movie.id, movie.title);
                if (title === movie.title) untranslated.push(`${movie.id} ${movie.title}`);
            }

            const data = {
                rank: movie.rank,
                title,
                originalTitle: movie.title,
                year: String(movie.year),
                rating: movie.rating,
                voteCount: movie.votes,
                cover,
                coverUrl: cdnUrl || cover,
                originalCover: coverUrl,
                isTop250: true,
                theme: 'imdb_movies',
                updateTime: db.serverDate()
            };

            if (prev) {
                // 从榜外回归的，重新打进榜时间
                if (prev.isTop250 === false) data.enterTop250Time = db.serverDate();
                toUpdate.push({ _id: movie.id, data });
            } else {
                toAdd.push({
                    _id: movie.id,
                    ...data,
                    description: '',
                    category: '',
                    createTime: db.serverDate(),
                    enterTop250Time: db.serverDate()
                });
            }
            processed++;
        }

        for (const u of toUpdate) {
            await imdbCollection.doc(u._id).update({ data: u.data })
                .catch(err => console.error(`更新失败 ${u._id}: ${err.message}`));
        }
        for (let i = 0; i < toAdd.length; i += 20) {
            const batch = toAdd.slice(i, i + 20);
            await Promise.all(batch.map(d => imdbCollection.add({ data: d })))
                .catch(err => console.error(`新增失败（下标 ${i}）: ${err.message}`));
        }

        const nextStartFrom = startFrom + processed;

        // 自动接力（fire-and-forget，不能 await，否则嵌套等待必超时）
        let autoChained = false;
        if (stoppedEarly && autoContinue && processed > 0) {
            try {
                cloud.callFunction({
                    name: 'fetchImdbMovies',
                    data: { startFrom: nextStartFrom, autoContinue: true, forceRefresh, skipTranslate }
                }).catch(e => console.error('自动接力触发失败:', e && e.message));
                await new Promise(r => setTimeout(r, 1200));
                autoChained = true;
            } catch (e) {
                console.error('自动接力异常:', e && e.message);
            }
        }

        return {
            success: true,
            snapshotDate: SNAPSHOT_DATE,
            total: list.length,
            processed,
            added: toAdd.length,
            updated: toUpdate.length,
            coverDownloaded,
            softDeleted,
            untranslatedCount: untranslated.length,
            untranslated,
            stoppedEarly,
            autoChained,
            nextStartFrom: stoppedEarly ? nextStartFrom : 0,
            hint: !stoppedEarly
                ? '全部处理完成'
                : autoChained
                    ? `已自动接力，从 ${nextStartFrom} 继续`
                    : `未处理完，下次传 { "startFrom": ${nextStartFrom} } 继续（或加 autoContinue:true 一键跑完）`
        };
    } catch (error) {
        console.error('[fetchImdbMovies] 执行失败:', error);
        return { success: false, error: error.message };
    }
};
