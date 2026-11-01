// 豆瓣导入的纯逻辑（不碰网络和数据库），tools/test-douban-import.cjs 直接测这里

const CN_TZ_OFFSET_MS = 8 * 60 * 60 * 1000;

/**
 * 从用户粘贴的内容里取豆瓣 uid。认这几种：
 *   https://www.douban.com/people/4239269/?_i=xxx   （App「分享主页」复制出来的）
 *   https://m.douban.com/people/ahbei/
 *   4239269 / ahbei                                  （直接输 ID）
 * 认不出返回 ''。uid 只允许字母数字下划线点横线，挡掉拼进 URL 的怪字符。
 */
function parseUid(input) {
    const s = String(input || '').trim();
    const m = /people\/([^/?#\s]+)/.exec(s);
    const uid = m ? m[1] : s;
    return /^[A-Za-z0-9_.-]{1,40}$/.test(uid) ? uid : '';
}

/** 豆瓣的 create_time 是北京时间 'YYYY-MM-DD HH:mm:ss'，转成 Marks 用的 ISO 字符串；认不出用 fallback */
function doubanTimeToIso(s, fallback) {
    const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(String(s || ''));
    if (!m) return fallback;
    const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) - CN_TZ_OFFSET_MS;
    return isNaN(ms) ? fallback : new Date(ms).toISOString();
}

function cnDate(ms) {
    const d = new Date(ms + CN_TZ_OFFSET_MS);
    const p = n => (n < 10 ? '0' : '') + n;
    return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate());
}

/**
 * 一页豆瓣条目 + 对片结果 → 要写进 Marks 的计划。
 *
 * entries:  [{ doubanId, status: 'watched'|'wish', markedAt }]
 * factsMap: { doubanId: { movieIds: [...], memberOf: [...] } }   —— movie_facts 查到的
 * existing: { movieId: { _id, status, marked_at } }              —— 用户已有的标记（每个 movieId 最新那条）
 *
 * 写入规则：只增不减、不降级。
 *   没有标记            → 新增
 *   只有「未看」记录     → 改写成豆瓣的状态（按新增计；记下原状态，撤销时还原）
 *   已有「想看」+ 看过   → 升级为看过（记下原状态，撤销时还原）
 *   其余（含已看过 + 想看、状态相同）→ 跳过
 *
 * 返回 { adds, upgrades, films: { matched, unmatched, added, upgraded, skipped, top250 } }
 *   films 按「部」计；adds/upgrades 按「条」计（一部片在几个榜单就是几条）。
 */
function planPage(entries, factsMap, existing, importId) {
    const adds = [];
    const upgrades = [];
    const films = { matched: 0, unmatched: 0, added: 0, upgraded: 0, skipped: 0, top250: 0 };
    const planned = {};   // 同一页里同一个 movieId 只处理一次

    for (const e of entries) {
        const fact = factsMap[e.doubanId];
        const ids = fact && Array.isArray(fact.movieIds) ? fact.movieIds : [];
        if (!ids.length) { films.unmatched++; continue; }
        films.matched++;
        if (e.status === 'watched' && (fact.memberOf || []).indexOf('douban') >= 0) films.top250++;

        let touched = 'skipped';
        for (const movieId of ids) {
            if (planned[movieId]) continue;
            planned[movieId] = true;
            const ex = existing[movieId];
            if (!ex) {
                adds.push({ movieId, status: e.status, marked_at: e.markedAt, source: 'douban_import', importId, importStatus: e.status });
                touched = 'added';
            } else if (ex.status !== 'watched' && ex.status !== 'wish') {
                // 列表页「批量未看」会留一条 status:'unwatched' 的记录，页面上等于没标，按新增算
                upgrades.push({
                    _id: ex._id, movieId,
                    data: { status: e.status, marked_at: e.markedAt, source: 'douban_import', importId, importStatus: e.status, prevStatus: ex.status || null, prevMarkedAt: ex.marked_at || null }
                });
                touched = 'added';
            } else if (ex.status === 'wish' && e.status === 'watched') {
                upgrades.push({
                    _id: ex._id, movieId,
                    data: { status: 'watched', marked_at: e.markedAt, source: 'douban_import', importId, importStatus: 'watched', prevStatus: 'wish', prevMarkedAt: ex.marked_at || null }
                });
                if (touched !== 'added') touched = 'upgraded';
            }
        }
        films[touched]++;
    }
    return { adds, upgrades, films };
}

/**
 * 撤销：只动「导入之后没被用户改过」的记录。
 * 判断「没改过」= 现在的状态仍等于导入时写下的 importStatus（列表页改状态、取消标记都会打破它）。
 *   导入时新增的   → 删掉
 *   导入时升级的   → 还原成原来的「想看」和原标记时间
 *   被改过的       → 保留
 */
function planUndo(docs) {
    const removes = [];
    const restores = [];
    let kept = 0;
    for (const d of docs) {
        if (!d || d.status !== d.importStatus) { kept++; continue; }
        if (d.prevStatus) {
            restores.push({ _id: d._id, data: { status: d.prevStatus, marked_at: d.prevMarkedAt || d.marked_at } });
        } else {
            removes.push(d._id);
        }
    }
    return { removes, restores, kept };
}

module.exports = { parseUid, doubanTimeToIso, cnDate, planPage, planUndo };
