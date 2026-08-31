// 云函数：buildMovieFacts —— 猜电影玩法的数据底座
//
// 解决的问题：榜单集合里存的是「排名 + 封面 + 评分」这套展示字段，**没有类型、没有演员**，
// 而猜片玩法（交叉填格 / 线索猜片）的每一条线索都建立在这些维度上。
// 好在所有榜单条目都已经存了 doubanId，豆瓣 rexxar 详情接口本身就返回
// genres / actors / tags / durations / languages / intro —— 一次回填就能补齐，
// 不需要引 TMDB，也不用申请 key。
//
// 为什么另起一张表而不是往各榜单集合里加字段：
//   1. 同一部片在多个榜单里有多份文档（豆瓣250 / 奥斯卡 / 通用主题各一份），
//      逐个榜单加字段等于把同一份演员表存 N 遍，还会各自漂移；
//   2. 出题引擎要的是「一部电影」而不是「某榜单第 N 名」，按 doubanId 做 _id 天然去重；
//   3. 榜单集合是线上读路径（getMoviesData / getThemeMovies）在跑的，不动它最安全。
//
// 产出集合 movie_facts（_id = doubanId）：
//   { _id, doubanId, title, originalTitle, year, subtype, genres[], actors[], directors[],
//     countries[], languages[], durationMin, tags[], intro, rating, ratingCount,
//     cover, memberOf[<themeId>], movieIds[<各榜单文档 _id>], factsVersion, updateTime }
//
//   memberOf / movieIds 两个字段是「猜对了顺手标记」和「冷门度算分」的依据：
//   一部片进了几个榜单，既代表它有多大众，也直接给出要往 Marks 里写哪些 movieId。
//
// 调用：
//   { dryRun: true }             —— 只统计（去重后多少部、已建多少、多少条缺 doubanId），不写库。**第一次务必先跑**
//   {}                           —— 增量构建：只处理 movie_facts 里还没有的
//   { autoContinue: true }       —— 自动接力跑到完（单次 50 秒自保，2656 部约跑九到十轮）
//   { startFrom: 600 }           —— 从第 N 条续跑（超时自保后手动接力用）
//   { forceRefresh: true }       —— 连已有的一起重拉（豆瓣评分会漂，隔季度刷一次）
//   { verify: true }             —— 只读回查，看 movie_facts 现状
//   { poolStats: true }          —— 出题池体检：剔掉剧集后还剩多少部、各阈值下人物轴有多少人可用
//   { prune: true, dryRun: true } —— 对账：列出 movie_facts 里已不在骨架中的孤儿（如剧集遗留），去掉 dryRun 才真删
//
// 注：控制台「云端测试」面板常返回 [UPSTREAM] Upstream error (ret=-3)，那是面板网关抖动，
// 函数照常跑完，结果去「云函数 → 日志」按时间捞（每个出口都打了 RESULT 日志）。

const cloud = require('wx-server-sdk');
const axios = require('axios');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

const FACTS_COLLECTION = 'movie_facts';
const FACTS_VERSION = 1;

// 参与汇总的榜单集合。imdb_movies 不在其中——它只有英文标题和 imdbId，没有 doubanId
// （与 buildMovieAlias 同一处取舍，等二期补 doubanId↔imdbId 映射再并进来）。
const SOURCES = ['movies', 'oscar_movies', 'oscar_anime_movies', 'boxoffice_movies', 'generic_theme_movies'];

// 两张老表整表没有 doubanId 字段，只能从 _id 反推。**必须卡位数**：
// 这两张表的 _id 现在是新老混着的（新的是届数 oscar_1~97 / oscar_anime_74~98，
// 老的是 oscar_{doubanId}），不卡位数会把届数 74 当成豆瓣条目 74 去拉详情，
// 灌进来一部毫不相干的电影。届数最多 3 位、豆瓣 subject id 至少 7 位，取 5 位做门槛。
// —— 与 buildMovieAlias 里同一处判断保持一致，改一处要两边一起改。
const MIN_GID_DIGITS = 5;
function gidFromPrefixedId(prefix) {
    const re = new RegExp('^' + prefix + '(\\d{' + MIN_GID_DIGITS + ',})$');
    return function (id) { const m = re.exec(String(id || '')); return m ? m[1] : ''; };
}
const GID_FROM_ID = {
    oscar_movies: gidFromPrefixedId('oscar_'),
    oscar_anime_movies: gidFromPrefixedId('oscar_anime_')
};

// 没有 theme 字段的集合，用集合名映射出主题 id（memberOf 里要能区分来源）
// 剧集不进猜片玩法，从骨架阶段就排掉，不是拉回来再按 subtype 丢弃 ——
// 后者会让这 758 条永远不在 movie_facts 里，于是每次增量跑都被当成「待建」反复重拉。
// 注意这里排的是**行**不是**片**：一部电影若同时在剧集主题和电影榜单里，
// 仍会从电影那行被收进来，只是 memberOf 里不带剧集主题。
const EXCLUDED_THEMES = new Set(['doubanTvCn', 'doubanTvForeign', 'doubanTvAnime']);

const THEME_OF_COLLECTION = {
    movies: 'douban',
    oscar_movies: 'oscar',
    oscar_anime_movies: 'oscarAnime',
    boxoffice_movies: 'boxoffice'
};

const READ_LIMIT = 1000;       // 云函数侧单次最多 1000 条
const TIME_BUDGET_MS = 50000;  // 自保：超时前收工并告诉调用方从哪续
const CONCURRENCY = 3;         // 豆瓣详情接口的并发。顺序跑一轮只能推进 ~30 条，
                               // 2656 部要跑近百轮；并发拉到 3 大约 8~10 倍，又不至于触发限流。

/** movie_facts 不存在时所有写入都会失败，先建一次（已存在会抛，吞掉即可） */
async function ensureCollection() {
    try { await db.createCollection(FACTS_COLLECTION); } catch (e) { /* already exists */ }
}

/** durations 形如 ["142分钟"] 或 ["120分钟(剧场版)", "125分钟(导演剪辑版)"]，取第一个数字 */
function parseDuration(durations) {
    const s = (Array.isArray(durations) ? durations : []).join(' ');
    const m = /(\d+)\s*分钟/.exec(s) || /(\d+)/.exec(s);
    return m ? parseInt(m[1], 10) : 0;
}

/**
 * 豆瓣 rexxar 详情：猜片玩法要的全部维度一次拿全。
 * URL/headers 沿用 enrichThemeMovies 里已验证的同款（换 UA 或去掉 Referer 会被挡）。
 */
async function fetchDoubanDetail(doubanId) {
    try {
        const res = await axios.get('https://m.douban.com/rexxar/api/v2/movie/' + doubanId, {
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
        const names = arr => (Array.isArray(arr) ? arr : []).map(x => x && x.name).filter(Boolean);
        return {
            title: j.title || '',
            originalTitle: j.original_title || '',
            year: j.year ? parseInt(j.year, 10) : null,
            subtype: j.subtype || '',                       // 'movie' | 'tv'，剧集三主题会灌进来 tv，出题时按玩法过滤
            genres: (j.genres || []).filter(Boolean),
            // 演员只留前 8 位：豆瓣返回的是完整演职员表，几十号人，
            // 而线索只可能用到主演；全量存进去会把文档撑大一倍且毫无用处。
            actors: names(j.actors).slice(0, 8),
            directors: names(j.directors),
            countries: (j.countries || []).filter(Boolean),
            languages: (j.languages || []).filter(Boolean),
            durationMin: parseDuration(j.durations),
            // 豆瓣的推荐标签（「越狱」「励志」「信念」），是官方接口里唯一带主题色彩的维度，
            // 线索猜片模式里比类型好用得多——类型只有二十来种，标签能到几千种。
            tags: (j.tags || []).map(t => t && t.name).filter(Boolean),
            intro: j.intro || '',
            rating: j.rating && typeof j.rating.value === 'number' ? j.rating.value : 0,
            ratingCount: j.rating && typeof j.rating.count === 'number' ? j.rating.count : 0,
            doubanCover: (j.pic && (j.pic.large || j.pic.normal)) || j.cover_url || ''
        };
    } catch (e) {
        console.warn('[buildMovieFacts] 详情失败 ' + doubanId + ': ' + (e && e.message));
        return null;
    }
}

/** 读一个集合的全部条目（只取汇总要用的字段），分页 */
async function readAll(collection) {
    const out = [];
    let skip = 0;
    for (;;) {
        let res;
        try {
            res = await db.collection(collection)
                .field({ _id: true, doubanId: true, title: true, year: true, theme: true, cover: true })
                .skip(skip).limit(READ_LIMIT).get();
        } catch (err) {
            // 集合不存在等情况：跳过，不要让整个构建挂掉
            console.warn('[buildMovieFacts] 读取 ' + collection + ' 失败:', (err && err.errMsg) || err);
            break;
        }
        const rows = (res && res.data) || [];
        for (let i = 0; i < rows.length; i++) out.push(Object.assign({}, rows[i], { _collection: collection }));
        if (rows.length < READ_LIMIT) break;
        skip += rows.length;
    }
    return out;
}

/**
 * 扫全部榜单集合，按 doubanId 归并出「一部电影」的骨架。
 * @returns {{ movies: Array, noDoubanId: Array }}
 */
async function collectSkeletons() {
    const byGid = new Map();
    const noDoubanId = [];

    for (const collection of SOURCES) {
        const rows = await readAll(collection);
        for (const row of rows) {
            let gid = row.doubanId ? String(row.doubanId).trim() : '';
            if (!gid && GID_FROM_ID[collection]) gid = GID_FROM_ID[collection](row._id);
            if (!gid) {
                noDoubanId.push(collection + '/' + row._id + (row.title ? ' ' + row.title : ''));
                continue;
            }
            // 映射表优先于 row.theme：oscar_movies / oscar_anime_movies / boxoffice_movies
            // 这三个抓取函数都把 **集合名** 写进了文档的 theme 字段（如 theme:'oscar_anime_movies'），
            // 原先的 row.theme 优先会让映射表整个失效，memberOf 里存进集合名。
            // 后果是静默的：getGuessPuzzle 的 THEME_LABEL 查不到就跳过，
            // 「入选奥斯卡最佳影片/最佳动画长片」两个谓词直接不会出现在题面上。
            // 表里只有这 4 个老集合的键，generic_theme_movies 不在其中，仍然走 row.theme。
            const themeId = THEME_OF_COLLECTION[collection] || row.theme || collection;
            if (EXCLUDED_THEMES.has(themeId)) continue;
            let ent = byGid.get(gid);
            if (!ent) {
                ent = { doubanId: gid, memberOf: [], movieIds: [], cover: '', title: row.title || '', year: row.year || null };
                byGid.set(gid, ent);
            }
            if (!ent.memberOf.includes(themeId)) ent.memberOf.push(themeId);
            if (!ent.movieIds.includes(row._id)) ent.movieIds.push(row._id);
            // 封面用榜单里已有的那份（已经是云存储链接，前端能直接用；
            // 豆瓣直链有防盗链，且 webp 在 iOS 真机不渲染）
            if (!ent.cover && row.cover) ent.cover = row.cover;
            if (!ent.title && row.title) ent.title = row.title;
        }
    }

    // 按 doubanId 字典序固定顺序，保证 startFrom 续跑指向同一批
    const movies = Array.from(byGid.values())
        .sort((a, b) => (a.doubanId < b.doubanId ? -1 : a.doubanId > b.doubanId ? 1 : 0));
    return { movies, noDoubanId };
}

/** 读 movie_facts 里已有的 doubanId → factsVersion（只取两个字段，负载很小） */
async function readExistingIds() {
    const map = new Map();
    let skip = 0;
    for (;;) {
        let res;
        try {
            res = await db.collection(FACTS_COLLECTION)
                .field({ _id: true, factsVersion: true })
                .skip(skip).limit(READ_LIMIT).get();
        } catch (err) {
            console.warn('[buildMovieFacts] 读取 movie_facts 失败（首次构建时集合还不存在，正常）:', (err && err.errMsg) || err);
            break;
        }
        const rows = (res && res.data) || [];
        rows.forEach(r => map.set(String(r._id), r.factsVersion || 0));
        if (rows.length < READ_LIMIT) break;
        skip += rows.length;
    }
    return map;
}

/** 拉详情 + 写库，单条。返回 'ok' | 'fetch_failed' | 'write_failed' */
async function buildOne(skeleton) {
    const detail = await fetchDoubanDetail(skeleton.doubanId);
    if (!detail) return 'fetch_failed';
    const data = {
        doubanId: skeleton.doubanId,
        title: detail.title || skeleton.title,
        originalTitle: detail.originalTitle,
        year: detail.year != null ? detail.year : skeleton.year,
        subtype: detail.subtype,
        genres: detail.genres,
        actors: detail.actors,
        directors: detail.directors,
        countries: detail.countries,
        languages: detail.languages,
        durationMin: detail.durationMin,
        tags: detail.tags,
        intro: detail.intro,
        rating: detail.rating,
        ratingCount: detail.ratingCount,
        cover: skeleton.cover || '',            // 云存储封面优先
        originalCover: detail.doubanCover,      // 榜单没封面时的兜底（豆瓣直链，前端需谨慎用）
        memberOf: skeleton.memberOf,
        movieIds: skeleton.movieIds,
        factsVersion: FACTS_VERSION,
        updateTime: db.serverDate()
    };
    try {
        await db.collection(FACTS_COLLECTION).doc(String(skeleton.doubanId)).set({ data });
        return 'ok';
    } catch (e) {
        console.warn('[buildMovieFacts] 写库失败 ' + skeleton.doubanId + ': ' + (e && e.message));
        return 'write_failed';
    }
}

exports.main = async (event) => {
    const startedAt = Date.now();
    const done_ = (r) => { console.log('[buildMovieFacts] RESULT ' + JSON.stringify(r)); return r; };
    const ev = event || {};

    // —— 清理孤儿：movie_facts 里有、但当前骨架里已经没有的条目，删掉。
    // 直接触发场景是剧集三主题被移出 SOURCES 后遗留的 758 条，
    // 但写成通用的「按骨架对账」而不是「删 subtype=tv」，是因为后者会误伤
    // 从电影榜单进来的剧集型条目（视与听里的《双峰：回归》《电影史》那类），
    // 删掉后它们仍在骨架里，下次增量跑又会被重新拉回来，白费一次豆瓣配额。
    // { prune: true, dryRun: true } 先看要删什么，{ prune: true } 才真删。
    if (ev.prune === true) {
        const { movies } = await collectSkeletons();
        const keep = new Set(movies.map(m => m.doubanId));
        const existingIds = Array.from((await readExistingIds()).keys());
        const orphans = existingIds.filter(id => !keep.has(String(id)));
        if (ev.dryRun === true) {
            return done_({
                success: true, mode: 'prune-dryRun',
                inFacts: existingIds.length,
                inSkeleton: keep.size,
                toDelete: orphans.length,
                sample: orphans.slice(0, 10),
                note: 'dryRun 不删。确认数目对得上后去掉 dryRun 再跑一次'
            });
        }
        let deleted = 0, failed = 0, stoppedEarly = false;
        for (let i = 0; i < orphans.length; i += CONCURRENCY) {
            if (Date.now() - startedAt > TIME_BUDGET_MS) { stoppedEarly = true; break; }
            const batch = orphans.slice(i, i + CONCURRENCY);
            const rs = await Promise.all(batch.map(async id => {
                try { await db.collection(FACTS_COLLECTION).doc(String(id)).remove(); return true; }
                catch (e) { console.warn('[buildMovieFacts] 删除失败 ' + id + ': ' + (e && e.message)); return false; }
            }));
            rs.forEach(ok => { if (ok) deleted++; else failed++; });
        }
        return done_({
            success: true, mode: 'prune',
            toDelete: orphans.length, deleted, failed, stoppedEarly,
            remaining: orphans.length - deleted - failed,
            note: stoppedEarly ? '未删完，再跑一次同样的参数即可续上' : '已删完'
        });
    }

    // —— 出题池体检：剧集占比 + 人物轴可行性。
    // getGuessPuzzle 用 subtype!=='tv' 过滤，所以 movie_facts 的 total 不等于出题池；
    // 而 MIN_PERSON_FILMS 该定多少，取决于池子里够得着门槛的演员/导演有几个——
    // 这里按 getGuessPuzzle 的同一口径（演员、导演分开计数）把几档阈值都算出来，
    // 免得凭池子大小拍脑袋。
    if (ev.poolStats === true) {
        try {
            const rows = [];
            let skip = 0;
            for (;;) {
                const r = await db.collection(FACTS_COLLECTION)
                    .field({ subtype: true, actors: true, directors: true })
                    .skip(skip).limit(READ_LIMIT).get();
                const batch = (r && r.data) || [];
                for (let i = 0; i < batch.length; i++) rows.push(batch[i]);
                if (batch.length < READ_LIMIT) break;
                skip += batch.length;
            }
            const moviePool = rows.filter(f => f.subtype !== 'tv');
            const tally = (getList) => {
                const m = new Map();
                moviePool.forEach(f => (getList(f) || []).forEach(v => {
                    if (v) m.set(v, (m.get(v) || 0) + 1);
                }));
                return m;
            };
            const actorFilms = tally(f => f.actors);
            const directorFilms = tally(f => f.directors);
            const atLeast = (m, k) => Array.from(m.values()).filter(v => v >= k).length;
            const thresholds = {};
            [4, 5, 6, 8, 10].forEach(k => {
                thresholds['>=' + k] = {
                    actors: atLeast(actorFilms, k),
                    directors: atLeast(directorFilms, k),
                    personAxisTotal: atLeast(actorFilms, k) + atLeast(directorFilms, k)
                };
            });
            const top = (m) => Array.from(m.entries()).sort((a, b) => b[1] - a[1])
                .slice(0, 8).map(e => e[0] + '(' + e[1] + ')');
            return done_({
                success: true, mode: 'poolStats',
                total: rows.length,
                tvCount: rows.length - moviePool.length,
                moviePool: moviePool.length,          // ← getGuessPuzzle 真正能用的池子
                currentMinPersonFilms: 8,             // 与 getGuessPuzzle 的 MIN_PERSON_FILMS 对齐，改那边记得改这里
                thresholds,
                topActors: top(actorFilms),
                topDirectors: top(directorFilms)
            });
        } catch (e) {
            return done_({ success: false, mode: 'poolStats', error: (e && e.errMsg) || String(e) });
        }
    }

    // —— 只读回查：跑完之后拿它确认结果，比盯控制台可靠
    if (ev.verify === true) {
        try {
            const cnt = await db.collection(FACTS_COLLECTION).count();
            const noGenre = await db.collection(FACTS_COLLECTION).where({ genres: [] }).count();
            const some = await db.collection(FACTS_COLLECTION).limit(3).get();
            return done_({
                success: true, mode: 'verify',
                total: cnt.total,
                emptyGenres: noGenre.total,
                sample: (some.data || []).map(d => ({
                    _id: d._id, title: d.title, year: d.year, subtype: d.subtype,
                    genres: d.genres, actors: (d.actors || []).slice(0, 3), memberOf: d.memberOf
                }))
            });
        } catch (e) {
            return done_({ success: false, mode: 'verify', error: (e && e.errMsg) || String(e) });
        }
    }

    const { movies, noDoubanId } = await collectSkeletons();
    const existing = await readExistingIds();

    const forceRefresh = ev.forceRefresh === true;
    // 增量：跳过已有且版本号不低于当前的；forceRefresh 时全部重拉
    const targets = forceRefresh
        ? movies
        : movies.filter(m => (existing.get(m.doubanId) || 0) < FACTS_VERSION);

    if (ev.dryRun === true) {
        return done_({
            success: true, mode: 'dryRun',
            sourcesScanned: SOURCES,
            uniqueMovies: movies.length,
            alreadyBuilt: existing.size,
            toBuild: targets.length,
            noDoubanIdCount: noDoubanId.length,
            noDoubanIdSample: noDoubanId.slice(0, 15),
            multiListSample: movies.filter(m => m.memberOf.length >= 3).slice(0, 5)
                .map(m => m.title + '(' + m.doubanId + ') ∈ ' + m.memberOf.join(',')),
            note: 'dryRun 不写库。确认 uniqueMovies 量级合理后，用 { autoContinue: true } 正式构建'
        });
    }

    await ensureCollection();

    const startFrom = Number(ev.startFrom) || 0;
    const pending = targets.slice(startFrom);
    let processed = 0, built = 0, fetchFailed = 0, writeFailed = 0, stoppedEarly = false;
    const failedIds = [];

    for (let i = 0; i < pending.length; i += CONCURRENCY) {
        if (Date.now() - startedAt > TIME_BUDGET_MS) { stoppedEarly = true; break; }
        const batch = pending.slice(i, i + CONCURRENCY);
        const results = await Promise.all(batch.map(buildOne));
        results.forEach((r, k) => {
            processed++;
            if (r === 'ok') built++;
            else {
                if (r === 'fetch_failed') fetchFailed++; else writeFailed++;
                if (failedIds.length < 20) failedIds.push(batch[k].doubanId);
            }
        });
    }

    const nextStart = startFrom + processed;
    const result = {
        success: true,
        mode: forceRefresh ? 'forceRefresh' : 'incremental',
        uniqueMovies: movies.length,
        targets: targets.length,
        startFrom, processed, built, fetchFailed, writeFailed,
        failedIdsSample: failedIds,
        remaining: Math.max(0, targets.length - nextStart),
        nextStart: nextStart < targets.length ? nextStart : null,
        stoppedEarly,
        elapsedMs: Date.now() - startedAt
    };

    // 自动接力：还没跑完就再调自己一轮。失败的条目留给下一次增量跑
    // （拉不到详情基本是豆瓣临时限流，隔一会儿重跑同一条就好）。
    if (ev.autoContinue === true && result.nextStart != null) {
        console.log('[buildMovieFacts] 接力：已建 ' + nextStart + '/' + targets.length);
        try {
            await cloud.callFunction({
                name: 'buildMovieFacts',
                data: { autoContinue: true, startFrom: nextStart, forceRefresh }
            });
            result.autoContinued = true;
        } catch (e) {
            result.autoContinued = false;
            result.autoContinueError = (e && e.message) || String(e);
        }
    }

    return done_(result);
};
