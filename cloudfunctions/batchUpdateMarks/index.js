// cloudfunctions/batchUpdateMarks/index.js
// 批量更新/新增标记，服务端处理循环，客户端只需一次调用
//
// ── 跨榜单同步 ──
// 同一部电影在不同榜单里是不同的 _id（豆瓣250 `movie_{中文名}_`、奥斯卡 `oscar_{doubanId}`、
// 通用主题 `{theme}_...`），用户在一个榜单标了，别的榜单还是未标——在用户心里这是 bug 不是
// 功能，所以**默认同步、不做开关**。
// 关联关系由 movie_alias 索引提供（云函数 buildMovieAlias 离线重建，键是 doubanId）。
// 「取消标记」同样同步：只同步加不同步减，会比不同步更让人困惑。
// 索引缺失/查询失败一律**降级为只标当前榜单**，绝不因为同步失败就让用户这次标记落空。

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

const ALIAS_COLLECTION = 'movie_alias';
// 一次同步最多扩散到这么多条，防止异常索引（比如某个 doubanId 误关联了几百条）
// 把一次批量标记放大成海量写入。
const MAX_TOTAL_IDS = 600;
// 分批并发写。原先是把所有 update/add 一次性 Promise.all，用户批量标 100 部再乘上
// 跨榜单扩散就是几百个并发写，容易触发云开发的并发限制。
const WRITE_BATCH = 25;

/**
 * 用 movie_alias 把 movieIds 扩散成「本榜单 + 其他榜单」的全集。
 * 查不到就原样返回——降级，不阻断标记。
 */
async function expandWithAliases(movieIds) {
    const _ = db.command;
    const result = movieIds.slice();
    const seen = {};
    for (let i = 0; i < movieIds.length; i++) seen[movieIds[i]] = true;

    try {
        // movieIds 可能上百条，_.in 有长度上限，分片查
        const CHUNK = 100;
        for (let i = 0; i < movieIds.length; i += CHUNK) {
            const chunk = movieIds.slice(i, i + CHUNK);
            const res = await db.collection(ALIAS_COLLECTION)
                .where({ _id: _.in(chunk) })
                .field({ _id: true, siblings: true })
                .get();
            const rows = (res && res.data) || [];
            for (let j = 0; j < rows.length; j++) {
                const sibs = rows[j].siblings || [];
                for (let k = 0; k < sibs.length; k++) {
                    if (seen[sibs[k]]) continue;
                    if (result.length >= MAX_TOTAL_IDS) return { ids: result, capped: true };
                    seen[sibs[k]] = true;
                    result.push(sibs[k]);
                }
            }
        }
    } catch (err) {
        // 索引集合还没建、或查询失败：退回只标当前榜单
        console.warn('[batchUpdateMarks] 读取 movie_alias 失败，跳过跨榜单同步:', (err && err.errMsg) || err);
        return { ids: movieIds, failed: true };
    }
    return { ids: result, capped: false };
}

/** 分批执行，避免一次性几百个并发写 */
async function runInBatches(tasks) {
    for (let i = 0; i < tasks.length; i += WRITE_BATCH) {
        await Promise.all(tasks.slice(i, i + WRITE_BATCH).map((fn) => fn()));
    }
}

exports.main = async (event, context) => {
    const { movieIds, status, openid, syncAcrossThemes } = event;

    if (!movieIds || !movieIds.length || !status || !openid) {
        return { success: false, error: '参数不完整' };
    }

    const now = new Date().toISOString();

    try {
        const _ = db.command;

        // 跨榜单扩散。前端可传 syncAcrossThemes:false 显式关掉（目前没有调用方这么传，
        // 留个口子给「取消标记时只想动当前这条」之类的将来需求）。
        const expanded = syncAcrossThemes === false
            ? { ids: movieIds }
            : await expandWithAliases(movieIds);
        const allIds = expanded.ids;

        // 一次性查出用户在这些电影上已有的标记（同样要分片，_.in 有上限）
        const existingMap = {};
        const CHUNK = 100;
        for (let i = 0; i < allIds.length; i += CHUNK) {
            const existingRes = await db.collection('Marks')
                .where({ openid, movieId: _.in(allIds.slice(i, i + CHUNK)) })
                .get();
            existingRes.data.forEach(m => { existingMap[m.movieId] = m; });
        }

        // 分别处理更新和新增
        const updateTasks = [];
        const addTasks = [];

        allIds.forEach(movieId => {
            const existing = existingMap[movieId];
            if (existing) {
                // 状态没变就别写了——跨榜单扩散会让绝大多数目标本来就是对的状态，
                // 每次都写一遍纯属浪费配额。
                if (existing.status === status) return;
                updateTasks.push(() =>
                    db.collection('Marks').doc(existing._id).update({
                        data: { status, marked_at: now }
                    }).catch(err => console.error(`更新 ${movieId} 失败`, (err && err.errMsg) || err))
                );
            } else {
                addTasks.push(() =>
                    db.collection('Marks').add({
                        data: { movieId, openid, status, marked_at: now }
                    }).catch(err => console.error(`新增 ${movieId} 失败`, (err && err.errMsg) || err))
                );
            }
        });

        await runInBatches(updateTasks);
        await runInBatches(addTasks);

        return {
            success: true,
            updated: updateTasks.length,
            added: addTasks.length,
            // 前端据此决定要不要刷新本地标记缓存：扩散数 > 传入数，说明别的榜单也变了
            requested: movieIds.length,
            synced: allIds.length - movieIds.length,
            aliasCapped: !!expanded.capped,
            aliasFailed: !!expanded.failed
        };
    } catch (err) {
        console.error('batchUpdateMarks 失败:', err);
        return { success: false, error: err.message };
    }
};
