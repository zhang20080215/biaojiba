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
//
// ── 返回值语义（改过，别再退回去）──
// `updated`/`added` 是**真实写成功的条数**，不是任务数。任何一条写失败或时间预算耗尽，
// 都返回 `success:false` + `partial:true`，前端据此提示并重新拉取标记。
// 历史教训：曾经每个写任务自带 `.catch(console.error)` 把异常吞掉、再把「任务数」当成功数返回，
// 于是部分写失败时前端照样弹「批量标记成功」并把本地状态刷成已标记——用户看到成功、云端没有。
// 标记数据是这个小程序的核心资产，宁可多报失败让用户重试，也不能谎报成功。

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
// `_.in` 的分片大小。**云函数端 `.get()` 不写 limit 时默认只返回 100 条**，分片大小若也取 100
// 就正好卡在上限、零余量：一旦 Marks 里存在重复的 (openid, movieId)（历史上的 `_.in` 不分片
// 版本批量标记超过 100 部时就会造出重复），同一片就可能匹配到 >100 条而被静默截断，
// 漏掉的会被当成「不存在」再 add 一条，越滚越多。故分片取 50、limit 显式给到 500（10 倍余量）。
const CHUNK = 50;
const QUERY_LIMIT = 500;
// 时间预算自保。函数超时在 config.json 里定死 20s（旧版一次批量只有 2 次顺序往返，新版加上
// alias 扩散后最多 33 次，默认 3s 会被掐死），预算留 15s 给自己收工的余量。
// 预算耗尽时收工并如实上报，不把「没写完」伪装成成功。
const TIME_BUDGET_MS = 15000;

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
        for (let i = 0; i < movieIds.length; i += CHUNK) {
            const chunk = movieIds.slice(i, i + CHUNK);
            const res = await db.collection(ALIAS_COLLECTION)
                .where({ _id: _.in(chunk) })
                .field({ _id: true, siblings: true })
                .limit(CHUNK)   // _id 唯一，一片最多命中 chunk 条
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

/**
 * 分批执行，避免一次性几百个并发写。
 * 每个 task 必须 resolve 成 1（成功）或 0（失败），返回真实成功条数。
 * 时间预算耗尽时提前收工，剩下的算作未完成。
 */
async function runInBatches(tasks, startedAt) {
    let ok = 0;
    let ran = 0;
    for (let i = 0; i < tasks.length; i += WRITE_BATCH) {
        if (Date.now() - startedAt > TIME_BUDGET_MS) break;
        const slice = tasks.slice(i, i + WRITE_BATCH);
        const res = await Promise.all(slice.map((fn) => fn()));
        for (let j = 0; j < res.length; j++) ok += res[j];
        ran += slice.length;
    }
    return { ok, ran, stopped: ran < tasks.length };
}

exports.main = async (event, context) => {
    const startedAt = Date.now();
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

        // 一次性查出用户在这些电影上已有的标记（分片，见 CHUNK 注释）
        const existingMap = {};
        let duplicates = 0;   // 同一 (openid, movieId) 命中多条 = 历史脏数据，上报便于排查
        for (let i = 0; i < allIds.length; i += CHUNK) {
            const existingRes = await db.collection('Marks')
                .where({ openid, movieId: _.in(allIds.slice(i, i + CHUNK)) })
                .limit(QUERY_LIMIT)
                .get();
            existingRes.data.forEach(m => {
                const prev = existingMap[m.movieId];
                if (!prev) { existingMap[m.movieId] = m; return; }
                duplicates++;
                // ⚠ 必须和 dataLoader.processMarks 一致：它按 marked_at 取**最新**那条作准并显示。
                // 这里若挑了旧的去更新，界面认的仍是那条新记录 → 用户会觉得标记没生效。
                if (new Date(m.marked_at) > new Date(prev.marked_at)) existingMap[m.movieId] = m;
            });
        }

        // 分别处理更新和新增。每个 task resolve 成 1/0，由 runInBatches 统计真实成功数。
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
                    }).then(() => 1).catch(err => {
                        console.error(`更新 ${movieId} 失败`, (err && err.errMsg) || err);
                        return 0;
                    })
                );
            } else {
                addTasks.push(() =>
                    db.collection('Marks').add({
                        data: { movieId, openid, status, marked_at: now }
                    }).then(() => 1).catch(err => {
                        console.error(`新增 ${movieId} 失败`, (err && err.errMsg) || err);
                        return 0;
                    })
                );
            }
        });

        const upRes = await runInBatches(updateTasks, startedAt);
        const addRes = await runInBatches(addTasks, startedAt);

        const attempted = upRes.ran + addRes.ran;
        const succeeded = upRes.ok + addRes.ok;
        const pending = (updateTasks.length + addTasks.length) - attempted;  // 时间预算截断，压根没试
        const failed = attempted - succeeded;                                 // 试了但写失败
        const clean = failed === 0 && pending === 0;

        return {
            // 有任何一条没写成，就不许报成功——前端会提示并重新拉标记
            success: clean,
            partial: !clean,
            updated: upRes.ok,
            added: addRes.ok,
            failed,
            pending,
            timedOut: pending > 0,
            duplicates,
            // 前端据此决定要不要刷新本地标记缓存：扩散数 > 传入数，说明别的榜单也变了
            requested: movieIds.length,
            synced: allIds.length - movieIds.length,
            aliasCapped: !!expanded.capped,
            aliasFailed: !!expanded.failed,
            costMs: Date.now() - startedAt
        };
    } catch (err) {
        console.error('batchUpdateMarks 失败:', err);
        return { success: false, partial: true, error: err.message };
    }
};
