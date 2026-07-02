// cloudfunctions/checkDoubanTitles/index.js
// 一次性核查工具：给一批 doubanId，返回豆瓣（大陆平台）自己收录的标准片名。
// 用于订正从港台维基百科等来源整理的电影名单——豆瓣是大陆标准片名的权威来源，
// 比人工/记忆去猜测港台译名与大陆译名的差异更可靠。
// URL/headers 复用 fetchMovieFullInfo 的 scrapeDoubanDetail 同款已验证接口。
//
// 两种用法：
// 1. { doubanIds: [...] } —— 只查询，返回豆瓣标准片名，不动数据库。
// 2. { theme: 'xxx', apply: false } —— 读 generic_theme_movies 里该主题全部记录（用已存的
//    doubanId），逐条对比库内 title 与豆瓣标准片名，返回差异清单；apply: true 时把豆瓣
//    片名写回 title 字段（繁体/港台译名 → 大陆标准片名的一键订正）。
const cloud = require('wx-server-sdk');
const axios = require('axios');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const MAX_LIMIT = 100;

async function fetchThemeDocs(theme) {
    const collection = db.collection('generic_theme_movies');
    const list = [];
    let offset = 0;
    while (true) {
        const res = await collection.where({ theme })
            .field({ _id: true, doubanId: true, title: true, rank: true, year: true })
            .skip(offset).limit(MAX_LIMIT).get();
        list.push(...res.data);
        if (res.data.length < MAX_LIMIT) break;
        offset += MAX_LIMIT;
    }
    // rank 序稳定输出，配合 startFrom 断点续传
    list.sort((a, b) => (a.rank || 0) - (b.rank || 0));
    return list;
}

function buildDoubanHeaders() {
    return {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.3 Mobile/15E148 Safari/604.1',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Referer': 'https://m.douban.com/'
    };
}

function buildRexxarUrl(doubanId) {
    return `https://m.douban.com/rexxar/api/v2/movie/${doubanId}`;
}

async function fetchDoubanTitle(doubanId) {
    const res = await axios.get(buildRexxarUrl(doubanId), {
        headers: buildDoubanHeaders(),
        timeout: 15000,
        responseType: 'json'
    });
    const j = (res && res.data) || {};
    return {
        title: j.title || '',
        originalTitle: j.original_title || '',
        year: j.year || ''
    };
}

exports.main = async (event, context) => {
    const START_TIME = Date.now();
    const TIME_LIMIT = 40000;

    const { doubanIds, theme, apply = false, startFrom = 0 } = event || {};

    // ── 模式 2：按 theme 读集合，对比/订正库内 title ──
    if (theme) {
        const docs = await fetchThemeDocs(theme);
        if (docs.length === 0) {
            return { success: false, error: `generic_theme_movies 中没有 theme=${theme} 的记录` };
        }

        const pending = docs.slice(startFrom);
        const results = [];
        let processedCount = 0;
        let changedCount = 0;
        let stoppedEarly = false;

        for (let i = 0; i < pending.length; i++) {
            if (Date.now() - START_TIME > TIME_LIMIT) {
                stoppedEarly = true;
                break;
            }
            const docItem = pending[i];
            processedCount++;

            if (!docItem.doubanId) {
                results.push({ _id: docItem._id, rank: docItem.rank, title: docItem.title, error: '无 doubanId，跳过' });
                continue;
            }

            try {
                const info = await fetchDoubanTitle(docItem.doubanId);
                const changed = !!info.title && info.title !== docItem.title;
                const row = {
                    _id: docItem._id,
                    rank: docItem.rank,
                    doubanId: docItem.doubanId,
                    oldTitle: docItem.title,
                    doubanTitle: info.title,
                    changed
                };
                if (changed) {
                    changedCount++;
                    if (apply) {
                        // sourceTitle 留档原标题，与 enrichThemeMovies 的片名订正约定一致：
                        // 之后再拿原始名单跑轻量 patch 时，靠它避免把订正后的片名改回去
                        await db.collection('generic_theme_movies').doc(docItem._id).update({
                            data: { title: info.title, sourceTitle: docItem.title, updateTime: db.serverDate() }
                        });
                        row.applied = true;
                    }
                }
                results.push(row);
            } catch (err) {
                results.push({ _id: docItem._id, rank: docItem.rank, doubanId: docItem.doubanId, oldTitle: docItem.title, error: err.message });
            }
            await new Promise(r => setTimeout(r, 300));
        }

        const nextStartFrom = startFrom + processedCount;
        return {
            success: true,
            mode: apply ? 'theme-apply' : 'theme-check',
            total: docs.length,
            processed: processedCount,
            changed: changedCount,
            // 只回传有差异/出错的行，全量 diff 太长会淹没控制台
            results: results.filter(r => r.changed || r.error),
            stoppedEarly,
            nextStartFrom: stoppedEarly ? nextStartFrom : 0,
            hint: stoppedEarly ? `未处理完，下次请传入 { "theme": "${theme}", "apply": ${apply}, "startFrom": ${nextStartFrom} } 继续` : '全部处理完成'
        };
    }

    // ── 模式 1：手动给 doubanIds，只查不改 ──
    if (!Array.isArray(doubanIds) || doubanIds.length === 0) {
        return { success: false, error: 'doubanIds 为空（或改传 theme 参数走集合订正模式）' };
    }

    const pending = doubanIds.slice(startFrom);
    const results = [];
    let processedCount = 0;
    let stoppedEarly = false;

    for (let i = 0; i < pending.length; i++) {
        if (Date.now() - START_TIME > TIME_LIMIT) {
            stoppedEarly = true;
            break;
        }
        const doubanId = pending[i];
        try {
            const info = await fetchDoubanTitle(doubanId);
            results.push({ doubanId, ...info });
        } catch (err) {
            results.push({ doubanId, error: err.message });
        }
        processedCount++;
        await new Promise(r => setTimeout(r, 300));
    }

    const nextStartFrom = startFrom + processedCount;

    return {
        success: true,
        results,
        processed: processedCount,
        stoppedEarly,
        nextStartFrom: stoppedEarly ? nextStartFrom : 0,
        hint: stoppedEarly ? `未处理完，下次请传入 { "doubanIds": [...同一份名单], "startFrom": ${nextStartFrom} } 继续` : '全部处理完成'
    };
};
