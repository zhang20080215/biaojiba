// 云函数：getGuessPuzzle —— 猜电影的出题引擎（交叉填格 grid + 线索猜片 clue 共用）
//
// 两种玩法建立在同一套「可判定谓词」上，所以出题逻辑只写一份：
//   谓词 = { key, type, label, test(fact) }，给定一部电影的 movie_facts 文档就能判定真假。
//   · grid 玩法：挑 3 个谓词当行、3 个当列，每格要填一部同时满足行列两条的电影；
//   · clue 玩法：挑 1 部电影当答案，把它命中的谓词按「由泛到精」排成 9 条线索逐次揭示。
//
// 为什么答案要落库而不是每次现算：
//   1. 出题要读全量 movie_facts（约 2650 条）并做 9 次集合求交，每个用户进来都算一遍太贵；
//   2. 每日一题必须**所有人看到同一道**，现算就得保证随机数完全确定，落库更稳；
//   3. 校验（submitGuess）只要读这一份 puzzle 文档就够，不必把谓词逻辑再实现一遍——
//      这是把 answerIds 直接存进 puzzle 的主要原因。
//
// 产出集合 guess_puzzles（_id = `${mode}_${date}`）：
//   grid: { mode:'grid', date, rows[3], cols[3], cells[9]{r,c,answerIds[],count}, poolSize }
//   clue: { mode:'clue', date, answerId, answerTitle, answerYear, answerCover, clues[9], poolSize }
//
// ⚠ puzzle 文档里带答案，**绝不能整份下发**。exports.main 只返回 sanitize 后的视图
//   （grid 只给行列标签和每格候选数，clue 只给已解锁的线索条数）。
//
// 调用：
//   { mode: 'grid' }                  —— 取今天的格子题（没有就现出一道并落库）
//   { mode: 'cross' }                 —— 取今天的纵横填字题
//   { crossStats: true }              —— 填字词库体检（出题前先确认词库够不够），附线索体检样本
//   { crossStress: true, days: 365 }  —— 填字压测：按新规则连出 N 个虚构日期，只算不写
//   { prepare: true, days: 30, mode: 'cross' } —— 批量备 30 天填字
//   { mode: 'clue' }                  —— 取今天的线索题
//   { mode: 'grid', date: '2026-08-26' } —— 取指定日期（「昨天」入口用）
//   { mode: 'grid', regenerate: true }   —— 重出一道覆盖（调试用，会作废当天已有作答）
//   { inspect: true, mode, date }        —— 带答案的完整视图，仅供控制台排查，不走前端

const cloud = require('wx-server-sdk');
const cross = require('./cross.js');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

const FACTS_COLLECTION = 'movie_facts';
const PUZZLE_COLLECTION = 'guess_puzzles';
// 填字出题的两份辅助数据，都可以不存在（不存在就当空）：
//   guess_film_stats    —— analyzeGuess {writeFilmStats:true} 写的单片实测答对率，难度预算用
//   guess_clue_overrides —— 手工改过的线索 { _id: 片 id, clue }，比自动加工的优先
const FILM_STATS_COLLECTION = 'guess_film_stats';
const CLUE_OVERRIDE_COLLECTION = 'guess_clue_overrides';
const CROSS_HISTORY_DAYS = 60;      // 读最近多少天的已出题，算跨批次冷却和出场次数

const READ_LIMIT = 1000;
const CN_TZ_OFFSET_MS = 8 * 60 * 60 * 1000;

// 一格至少要有这么多种正确答案。只有唯一解的格子对玩家是「想不到就是想不到」，
// 而且我们的片库只有几千部，唯一解往往是某部冷门片，体验很差。
// 先按 3 出题，凑不出来再退到 2——宁可题目松一点，也不能出不出来。
const CELL_TARGETS = [3, 2];
// 人物类谓词（演员/导演）至少要在片库里有这么多部作品。
// 这个下限**不是用来防脏数据的，是出题可解性的硬约束**：一个人只有 4 部作品时，
// 要让他这一行的三个格子各有 2 个以上答案，等于要求这 4 部片在三个不同属性上都扎堆，
// 基本不可能——合成片库实测，下限设 4 时 120 次出题只成功 13 次。
const MIN_PERSON_FILMS = 8;
// 而且只从「作品数最多的前 N 个人」里抽。片库里满足 8 部下限的人有上千个，
// 随机抽三个仍然大概率抽到三个刚好 8 部的，照样连不成三列。
const PERSON_CANDIDATE_TOP = 200;
// 属性类谓词的最小覆盖量
const MIN_ATTR_FILMS = 25;
// 属性覆盖上限：一列若覆盖了大半个片库（比如「入选豆瓣 TOP250」在一个以豆瓣为主的库里），
// 这一列就等于没有约束，该格答案就是行的全部作品——题目看着有三列，实际只考了一维。
const MAX_ATTR_RATIO = 0.6;
// 每次试探 = 随机抽 3 人 + 3 属性再验 9 个交集。从 60 天实测反推，合法组合出现率约 1/2400，
// 所以 400 次远远不够 —— 当初 43/60 天「凑不出来」不是片库撑不起，是搜索预算太小提早放弃。
// 抽 2 万次期望命中 8 次以上，失败概率约万分之二，耗时约 0.2 秒。
const MAX_GENERATE_TRIES = 20000;

// 批量备题时的跨天去重冷却：同一个演员/导演 7 天内不再当行，同一个属性 3 天内不再当列。
// 按天现出题做不到这件事（没有跨天记忆），实测 17 个成功日里一个人能独占 6 天。
const PERSON_COOLDOWN_DAYS = 7;
const ATTR_COOLDOWN_DAYS = 3;
const PREPARE_BUDGET_MS = 50000;

/** 中国时区自然日 'YYYY-MM-DD' */
function cnDateStr(ms) {
    const d = new Date((ms == null ? Date.now() : ms) + CN_TZ_OFFSET_MS);
    const p = n => (n < 10 ? '0' : '') + n;
    return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate());
}

// seededRandom / shuffled 三个玩法共用，和填字出题逻辑一起放在 cross.js（纯函数，方便单测）
const { seededRandom, shuffled } = cross;

/**
 * 从 doc(id).get() 的返回里取出那一份文档，取不到给 null。
 * 云函数端 doc().get() 的 data 是**数组**，文档不存在时是空数组 —— 而 [] 是 truthy，
 * 直接写 if (res.data) 会把「不存在」判成「存在」。两处都踩过：
 * prepare 的跳过判断会跳过全部 30 天，线上路径则会拿 [] 去 sanitize 返回一道空题、
 * 永远走不到「现出一道」的分支。
 */
function oneDoc(res) {
    const d = res && res.data;
    if (Array.isArray(d)) return d.length ? d[0] : null;
    return d || null;
}

/** 按玩法挑下发视图。三个玩法的答案藏法不同，收在一处免得漏掉哪一路。 */
function sanitizeFor(mode, doc, ev) {
    if (mode === 'cross') return cross.sanitizeCross(doc);
    if (mode === 'clue') return sanitizeClue(doc, ev.revealed);
    return sanitizeGrid(doc);
}

/** 读全量 movie_facts（出题用，字段裁到最小） */
async function readPool() {
    const out = [];
    let skip = 0;
    for (;;) {
        const res = await db.collection(FACTS_COLLECTION)
            .field({
                // originalTitle 填字线索打码要用（外文原名也算泄露），原先漏读了
                _id: true, title: true, originalTitle: true, year: true, subtype: true, genres: true, actors: true,
                directors: true, countries: true, durationMin: true, rating: true,
                ratingCount: true, cover: true, memberOf: true, tags: true, intro: true,
                movieIds: true
            })
            .skip(skip).limit(READ_LIMIT).get();
        const rows = (res && res.data) || [];
        out.push.apply(out, rows);
        if (rows.length < READ_LIMIT) break;
        skip += rows.length;
    }
    return out;
}

/** 读一个小集合的全部文档；集合不存在就当空 */
async function readAllSafe(collection) {
    const out = [];
    try {
        for (let skip = 0; ; skip += READ_LIMIT) {
            const res = await db.collection(collection).skip(skip).limit(READ_LIMIT).get();
            const rows = (res && res.data) || [];
            out.push.apply(out, rows);
            if (rows.length < READ_LIMIT) break;
        }
    } catch (e) { /* 集合不存在 */ }
    return out;
}

/** 控制台可覆盖的填字出题参数：一次调用试一档，不用改代码重部署 */
function pickCrossOpts(ev) {
    const o = {};
    ['minVotes', 'filmCooldown', 'minDistractors', 'maxCold', 'minHot', 'maxTwoChar', 'targetWords'].forEach(function (k) {
        if (ev[k] != null && !isNaN(Number(ev[k]))) o[k] = Number(ev[k]);
    });
    return o;
}

/**
 * 填字出题上下文：全量片库 + 手工线索 + 实测难度。
 * prepare / crossStress / crossStats / 按天现出题四条路径都从这里拿，规则只有 cross.js 一份。
 */
async function loadCrossContext(ev) {
    const res = await Promise.all([
        readPool(), readAllSafe(FILM_STATS_COLLECTION), readAllSafe(CLUE_OVERRIDE_COLLECTION)
    ]);
    const pool = res[0];
    const overrides = new Map(res[2].filter(function (o) { return o.clue; })
        .map(function (o) { return [String(o._id), String(o.clue)]; }));
    pool.forEach(function (f) {
        const c = overrides.get(String(f._id));
        if (c) f.clueOverride = c;
    });
    const stats = new Map(res[1].map(function (s) { return [String(s._id), s]; }));
    const opts = Object.assign(pickCrossOpts(ev), { stats: stats });
    return { pool: pool, ctx: cross.buildCrossContext(pool, opts), overrides: overrides.size, stats: stats.size };
}

/**
 * 把 beforeDate 之前 60 天里已经出过的填字题灌进出场记录 ——
 * 冷却和降权要跨批次才有用：原先冷却只在单次 prepare 内生效，
 * 两批题的接缝处同一部片隔二十天就又出来（10-09 和 10-29 都有《霸王别姬》）。
 */
async function loadCrossHistory(ctx, beforeDate) {
    const start = new Date(Date.parse(beforeDate + 'T00:00:00Z') - CROSS_HISTORY_DAYS * 86400000)
        .toISOString().slice(0, 10);
    let n = 0;
    try {
        for (let skip = 0; ; skip += READ_LIMIT) {
            const res = await db.collection(PUZZLE_COLLECTION)
                .where({ mode: 'cross', date: _.gte(start).and(_.lt(beforeDate)) })
                .field({ date: true, entries: true })
                .skip(skip).limit(READ_LIMIT).get();
            const rows = (res && res.data) || [];
            rows.forEach(function (r) {
                cross.recordUsage(ctx, (r.entries || []).map(function (e) { return e.id; }), cross.dayNum(r.date));
            });
            n += rows.length;
            if (rows.length < READ_LIMIT) break;
        }
    } catch (e) { /* 集合不存在：没有历史 */ }
    return n;
}

/** 落库的填字题文档 */
function crossDoc(date, g, poolSize) {
    return {
        mode: 'cross', date: date, n: cross.N, grid: g.grid, entries: g.entries,
        charPool: g.charPool, filledCells: g.filledCells, quality: g.quality,
        poolSize: poolSize, createdAt: db.serverDate()
    };
}

// —— 榜单 id → 给玩家看的名字。memberOf 里存的是主题 id，直接显示玩家看不懂。
const THEME_LABEL = {
    douban: '豆瓣电影 TOP250', oscar: '奥斯卡最佳影片', oscarAnime: '奥斯卡最佳动画长片',
    boxoffice: '全球票房 TOP100', arthouse: '文艺电影必修课', sightsound: '视与听影史 TOP250',
    letterboxd500: 'Letterboxd TOP500', palmeDor: '戛纳金棕榈', rtHorror: '烂番茄恐怖片',
    rtWar: '烂番茄战争片', rtAnimation: '烂番茄动画片', rtAction: '烂番茄动作片',
    oscarDirector: '奥斯卡最佳导演', oscarActor: '奥斯卡最佳男主', oscarActress: '奥斯卡最佳女主',
    oscarScreenplay: '奥斯卡最佳剧本', oscarForeign: '奥斯卡最佳国际影片',
    oscarVFX: '奥斯卡最佳视觉效果', oscarCinematography: '奥斯卡最佳摄影'
};

/** 中文片名字数：只数汉字，忽略标点/空格/罗马数字后缀 */
function cnTitleLen(title) {
    const m = String(title || '').match(/[一-龥]/g);
    return m ? m.length : 0;
}

/**
 * 构建全部候选谓词。
 * 分两个轴：人物轴（演员/导演）当行，属性轴当列——这也是 moviegrid 的排布，
 * 「某演员 ∩ 某类型」比「某类型 ∩ 某年代」有意思得多，后者往往一堆答案。
 */
function buildPredicates(pool, opts) {
    const personAxis = [];
    const attrAxis = [];
    // opts 只有压测模式会传，线上调用一律走常数
    const o = opts || {};
    const minPerson = o.minPersonFilms || MIN_PERSON_FILMS;
    const personTop = o.personTop || PERSON_CANDIDATE_TOP;
    const maxAttr = Math.floor(pool.length * (o.maxAttrRatio || MAX_ATTR_RATIO));
    // 属性列的覆盖下限。这是交集厚度最灵敏的旋钮：一个只覆盖 25 部（1.4%）的列
    // 和一个 12 部片的演员求交，期望值才 0.17，必然出空格；
    // 抬高它能直接让格子变厚，而且不用牺牲每格解数。
    const minAttr = o.minAttrFilms || MIN_ATTR_FILMS;
    // 属性谓词统一走这里，好把上下限判断收在一处
    const pushAttr = (p) => {
        if (p.ids.length >= minAttr && p.ids.length <= maxAttr) attrAxis.push(p);
    };

    const countBy = (getList) => {
        const map = new Map();
        pool.forEach(f => (getList(f) || []).forEach(v => {
            if (!v) return;
            if (!map.has(v)) map.set(v, []);
            map.get(v).push(f._id);
        }));
        return map;
    };

    // —— 人物轴
    countBy(f => f.actors).forEach((ids, name) => {
        if (ids.length >= minPerson) {
            personAxis.push({ key: 'actor:' + name, type: 'actor', label: name, value: name, ids });
        }
    });
    countBy(f => f.directors).forEach((ids, name) => {
        if (ids.length >= minPerson) {
            personAxis.push({ key: 'director:' + name, type: 'director', label: name + '（导演）', value: name, ids });
        }
    });

    // —— 属性轴：类型
    countBy(f => f.genres).forEach((ids, g) => {
        pushAttr({ key: 'genre:' + g, type: 'genre', label: g, value: g, ids });
    });
    // 国家/地区
    countBy(f => f.countries).forEach((ids, c) => {
        pushAttr({ key: 'country:' + c, type: 'country', label: c + '出品', value: c, ids });
    });
    // 榜单归属——这是别家猜片游戏没有的维度，正好把标记吧的片库变成玩法的一部分。
    // 注意豆瓣 TOP250 这类主榜很可能超过 MAX_ATTR_RATIO 被 pushAttr 挡掉，那是对的：
    // 片库本身就是以豆瓣为主干攒起来的，拿它当一列约束不了任何东西。
    countBy(f => f.memberOf).forEach((ids, t) => {
        if (THEME_LABEL[t]) {
            pushAttr({ key: 'list:' + t, type: 'list', label: '入选' + THEME_LABEL[t], value: t, ids });
        }
    });

    // 年代
    const decades = new Map();
    pool.forEach(f => {
        const y = Number(f.year);
        if (!y || y < 1900) return;
        const d = Math.floor(y / 10) * 10;
        if (!decades.has(d)) decades.set(d, []);
        decades.get(d).push(f._id);
    });
    decades.forEach((ids, d) => {
        pushAttr({ key: 'decade:' + d, type: 'decade', label: d + ' 年代', value: d, ids });
    });

    // 评分档（只做高分档，「评分低于 7」在我们这种精选片库里几乎没有候选）
    [[9, '豆瓣 9 分以上'], [8.5, '豆瓣 8.5 分以上']].forEach(([min, label]) => {
        const ids = pool.filter(f => Number(f.rating) >= min).map(f => f._id);
        pushAttr({ key: 'rating:' + min, type: 'rating', label, value: min, ids });
    });

    // 时长
    [[150, 'gte', '片长 150 分钟以上'], [90, 'lte', '片长 90 分钟以内']].forEach(([v, op, label]) => {
        const ids = pool.filter(f => {
            const d = Number(f.durationMin);
            return d > 0 && (op === 'gte' ? d >= v : d <= v);
        }).map(f => f._id);
        pushAttr({ key: 'duration:' + op + v, type: 'duration', label, value: v, op, ids });
    });

    // 片名字数——中文语境下最有「猜词」味道的一条
    [2, 3, 4, 5].forEach(n => {
        const ids = pool.filter(f => cnTitleLen(f.title) === n).map(f => f._id);
        pushAttr({ key: 'titlelen:' + n, type: 'titleLen', label: '片名 ' + n + ' 个字', value: n, ids });
    });

    // 人物轴按作品数降序截断：见 PERSON_CANDIDATE_TOP 的注释，
    // 不截断的话随机抽样几乎必然抽到三个作品数刚过下限的人，凑不出可解的三行三列。
    personAxis.sort((a, b) => b.ids.length - a.ids.length);
    return { personAxis: personAxis.slice(0, personTop), attrAxis };
}

/**
 * 出一道 3×3。
 * 策略：随机取 3 个人物当行、3 个属性当列，检查 9 个交集都 >= MIN_CELL_ANSWERS；
 * 不满足就整体重来。纯随机重试而不是回溯搜索——谓词只有几百个，
 * 实测几十次内基本能中，代码简单得多。
 */
function generateGrid(pool, rnd, opts) {
    // opts.axes = 调用方预先建好的谓词。换种重试和压测都要反复调本函数，
    // 而重建一次谓词要把整个片库按演员/导演/类型/国家/榜单/年代…全量扫一遍，
    // 且 predicate 上 idSet() 的记忆化也会跟着丢 —— 不复用的话开销是几百倍。
    const { personAxis, attrAxis } = (opts && opts.axes) || buildPredicates(pool, opts);
    if (personAxis.length < 3 || attrAxis.length < 3) {
        return { error: '谓词不足：人物 ' + personAxis.length + ' 个 / 属性 ' + attrAxis.length + ' 个，片库可能还没建好' };
    }

    const idSet = p => (p._idSet || (p._idSet = new Set(p.ids)));

    // 单趟搜索 + 全程保留最优。
    // 原先是「按每格 3 解试 400 次，不行再按 2 解重新试 400 次」两趟独立随机，
    // 问题是第一趟里凑出的 minSeen=2 组合因为 2<3 被直接丢掉，第二趟重新随机未必再撞上 ——
    // 真实片库压测里 60 天有 2 天就死在这：明明见过合格解，却报凑不出来。
    // 改成只随机一趟，记住见过的最好组合，末尾按它实际达到的水平判定；
    // 撞上理想档就提前收工。顺带把最坏开销从 800 次试探砍到 400 次。
    const targets = (opts && opts.cellTargets) || CELL_TARGETS;
    const wanted = targets[0];                        // 理想：够了就收
    const floor = targets[targets.length - 1];        // 底线：低于它才算失败
    const strip = p => ({ key: p.key, type: p.type, label: p.label, value: p.value, poolCount: p.ids.length });

    let best = null, bestMin = -1;
    for (let tries = 0; tries < MAX_GENERATE_TRIES; tries++) {
        const rows = shuffled(personAxis, rnd).slice(0, 3);
        const cols = shuffled(attrAxis, rnd).slice(0, 3);
        // 同类属性不要同时出现在三列里（「2010 年代」和「2000 年代」并排会让人
        // 以为要选两个年代，而且这两列的交集约束其实高度相关）
        if (new Set(cols.map(c => c.type)).size < 3) continue;

        // 9 个交集全算完再判定（不提前退出）：交集本身很廉价，
        // 而算满才拿得到 minSeen —— 既是择优的依据，也是失败时唯一有诊断价值的数。
        const cells = [];
        let minSeen = Infinity;
        for (let r = 0; r < 3; r++) {
            for (let c = 0; c < 3; c++) {
                const cs = idSet(cols[c]);
                const answerIds = rows[r].ids.filter(id => cs.has(id));
                if (answerIds.length < minSeen) minSeen = answerIds.length;
                cells.push({ r, c, answerIds, count: answerIds.length });
            }
        }
        if (minSeen > bestMin) {
            bestMin = minSeen;
            best = { rows: rows.map(strip), cols: cols.map(strip), cells };
        }
        if (bestMin >= wanted) break;
    }

    if (!best || bestMin < floor) {
        return {
            bestMinCell: bestMin,
            error: '试了 ' + MAX_GENERATE_TRIES + ' 次，最小格最多只到 ' + bestMin +
                ' 解（底线 ' + floor + '）。片库太小或谓词门槛太高，先确认 buildMovieFacts 跑完了'
        };
    }
    // minCellAnswers 记它实际满足的档位，hardestCell 记真实最小值（两者常相等）
    let tier = floor;
    for (let i = 0; i < targets.length; i++) if (bestMin >= targets[i]) { tier = targets[i]; break; }
    return Object.assign({}, best, { minCellAnswers: tier, hardestCell: bestMin });

}

/**
 * 出一道线索题：挑一部答案，把它命中的谓词排成 9 条由泛到精的线索。
 * 答案从「进了 2 个以上榜单且评分人数多」的片里挑——线索猜片是单一答案，
 * 选冷门片会变成纯粹的运气游戏。
 */
function generateClue(pool, rnd) {
    const candidates = pool.filter(f =>
        f.subtype !== 'tv' &&
        (f.memberOf || []).length >= 2 &&
        Number(f.ratingCount) >= 100000 &&
        (f.genres || []).length > 0 &&
        (f.actors || []).length >= 2
    );
    if (!candidates.length) return { error: '没有符合条件的答案候选，先把 movie_facts 建起来' };

    const answer = candidates[Math.floor(rnd() * candidates.length)];

    // 线索按「泄露程度」从低到高排：先给年代/类型这种大范围的，最后才给主演和导演。
    // order 越小越先揭示。同一档内按 rnd 打散，避免每天都是一样的顺序。
    const clues = [];
    const push = (order, type, label, text) => clues.push({ order, type, label, text });

    const y = Number(answer.year);
    if (y) push(1, 'decade', '年代', Math.floor(y / 10) * 10 + ' 年代');
    if ((answer.countries || []).length) push(1, 'country', '地区', answer.countries[0]);
    if ((answer.genres || []).length) push(2, 'genre', '类型', answer.genres.slice(0, 2).join(' / '));
    if (Number(answer.durationMin) > 0) push(2, 'duration', '片长', answer.durationMin + ' 分钟');
    const len = cnTitleLen(answer.title);
    if (len) push(3, 'titleLen', '片名', '中文片名 ' + len + ' 个字');
    if (Number(answer.rating) > 0) push(3, 'rating', '豆瓣评分', Number(answer.rating).toFixed(1));
    const lists = (answer.memberOf || []).map(t => THEME_LABEL[t]).filter(Boolean);
    if (lists.length) push(4, 'list', '入选榜单', lists[0]);
    if ((answer.tags || []).length) push(4, 'tag', '豆瓣标签', answer.tags.slice(0, 3).join(' / '));
    if (y) push(5, 'year', '上映年份', String(y));
    if ((answer.directors || []).length) push(6, 'director', '导演', answer.directors[0]);
    if ((answer.actors || []).length) push(7, 'actor', '主演', answer.actors[0]);
    if ((answer.actors || []).length > 1) push(7, 'actor', '主演', answer.actors[1]);
    if (answer.intro) {
        // 简介里会直接写片名/人名，直接给等于送答案——先打码再当线索
        const masked = maskSpoilers(answer.intro, answer);
        if (masked) push(8, 'intro', '剧情', masked.slice(0, 60));
    }

    const ordered = clues
        .map(c => ({ c, k: c.order * 100 + rnd() * 99 }))
        .sort((a, b) => a.k - b.k)
        .map((x, i) => ({ order: i + 1, type: x.c.type, label: x.c.label, text: x.c.text }))
        .slice(0, 9);

    return {
        answerId: answer._id,
        answerTitle: answer.title,
        answerYear: answer.year,
        answerCover: answer.cover || '',
        clues: ordered,
        candidatePool: candidates.length
    };
}

/** 把简介里出现的片名、演员名、导演名替换成方框，避免线索直接泄题 */
function maskSpoilers(intro, fact) {
    let s = String(intro || '');
    const secrets = [fact.title, fact.originalTitle]
        .concat(fact.actors || [], fact.directors || [])
        .filter(x => x && String(x).length >= 2);
    secrets.forEach(w => {
        // 人名/片名当字面量替换，不走正则元字符（片名里有 () 、+ 之类的很常见）
        const parts = s.split(w);
        if (parts.length > 1) s = parts.join('███');
    });
    return s.trim();
}

/** 下发给前端的视图：grid 只给标签和候选数，不给 answerIds */
function sanitizeGrid(doc) {
    return {
        mode: 'grid', date: doc.date,
        rows: doc.rows, cols: doc.cols,
        cells: (doc.cells || []).map(c => ({ r: c.r, c: c.c, count: c.count })),
        poolSize: doc.poolSize
    };
}

/** 下发给前端的视图：clue 只给已解锁的前 revealed 条，答案一律不给 */
function sanitizeClue(doc, revealed) {
    const n = Math.max(1, Math.min(Number(revealed) || 1, (doc.clues || []).length));
    return {
        mode: 'clue', date: doc.date,
        clues: (doc.clues || []).slice(0, n),
        totalClues: (doc.clues || []).length,
        revealed: n,
        poolSize: doc.poolSize
    };
}



exports.main = async (event) => {
    const startedAt = Date.now();
    const ev = event || {};
    const mode = (ev.mode === 'clue' || ev.mode === 'cross') ? ev.mode : 'grid';
    const date = /^\d{4}-\d{2}-\d{2}$/.test(ev.date || '') ? ev.date : cnDateStr();
    const docId = mode + '_' + date;

    try {
        // —— 填字词库体检：出题前先确认词库够不够，以及门槛卡在哪合适。
        // 词库窄是这个玩法唯一的结构性风险：纯汉字片名只占约三分之一，
        // 再叠一道「够有名」的门槛后还剩多少，必须拿真实数据看，不能拍。
        // { crossStats: true }                  —— 按默认门槛体检
        // { crossStats: true, minVotes: 20000 } —— 试试放宽门槛能多出多少条
        if (ev.crossStats === true) {
            const loaded = await loadCrossContext(ev);
            const mp0 = loaded.pool.filter(function (f) { return f.subtype !== 'tv'; });
            const pureTitle = mp0.filter(function (f) { return cross.usableTitle(f.title); });
            const withIntro = pureTitle.filter(function (f) { return String(f.intro || '').length >= 20; });
            const minV = ev.minVotes == null ? cross.MIN_VOTES : Number(ev.minVotes);
            const afterVotes = withIntro.filter(function (f) { return Number(f.ratingCount) >= minV; });
            const words = loaded.ctx.words;
            const byLen = {};
            words.forEach(function (w) { byLen[w.title.length] = (byLen[w.title.length] || 0) + 1; });
            const cf = new Map();
            words.forEach(function (w) {
                new Set(w.title.split('')).forEach(function (c) { cf.set(c, (cf.get(c) || 0) + 1); });
            });
            const crossable = Array.from(cf.values()).filter(function (v) { return v >= 2; }).length;
            const tiers = words.map(function (w) { return cross.tierOf(w, loaded.ctx.stats); });
            // 线索体检：最短的、打码最多的、开头还是时间地点的，各给 10 条人工过目。
            // 不满意的在 guess_clue_overrides 里手改（{ _id: 片 id, clue: '...' }）
            const clued = words.map(function (w) {
                const c = cross.crossClue(w);
                return { id: String(w._id), title: w.title, clue: c, masked: (c.match(/███/g) || []).length * 3 / c.length };
            });
            const brief = function (x) { return x.id + ' ' + x.title + ' → ' + x.clue; };
            return {
                success: true, mode: 'crossStats',
                minVotes: minV,
                moviePool: mp0.length,
                afterPureTitle: pureTitle.length,      // 纯汉字 2~7 字
                afterIntro: withIntro.length,          // 再要求有简介
                afterVotes: afterVotes.length,         // 再要求评分人数达标
                wordPool: words.length,                // 再过线索质量闸门 = 最终词库
                droppedByClue: afterVotes.length - words.length,
                lenDist: byLen,
                seeds: words.filter(function (w) { return w.title.length >= 4 && w.title.length <= 6; }).length,
                // 难度分档：冷门 / 大热门各多少部，实测数据覆盖了多少部
                cold: tiers.filter(function (t) { return t.cold; }).length,
                hot: tiers.filter(function (t) { return t.hot; }).length,
                measured: tiers.filter(function (t) { return t.measured; }).length,
                clueOverrides: loaded.overrides,
                distinctChars: cf.size,
                crossableChars: crossable,             // 出现在 ≥2 部片名里，能当交叉点
                topChars: Array.from(cf.entries()).sort(function (a, b) { return b[1] - a[1]; })
                    .slice(0, 12).map(function (e) { return e[0] + ':' + e[1]; }),
                sampleTitles: words.slice(0, 12).map(function (w) { return w.title; }),
                // 打完码的线索长什么样，直接在这看，不用再单独 inspect
                sampleClues: words.slice(0, 5).map(function (w) {
                    return w.title + ' → ' + cross.crossInfo(w) + '｜' + cross.crossClue(w);
                }),
                clueAudit: {
                    shortest: clued.slice().sort(function (a, b) { return a.clue.length - b.clue.length; }).slice(0, 10).map(brief),
                    mostMasked: clued.slice().sort(function (a, b) { return b.masked - a.masked; }).slice(0, 10).map(brief),
                    startsWithTime: clued.filter(function (x) { return /^(\d{2,4}|[一二三四五六七八九十〇零]{2,4})(年|世纪)/.test(x.clue); })
                        .slice(0, 10).map(brief)
                },
                // 被闸门刷掉的样本：确认刷的是该刷的（简介太短/全是码）
                droppedSamples: afterVotes.filter(function (f) { return !cross.crossClueOk(cross.crossClue(f)); })
                    .slice(0, 5).map(function (w) { return w.title + ' → ' + cross.crossClue(w); })
            };
        }

        // —— 填字压测：只算不写，按真实片库连着出 N 个虚构日期，看新规则下的题长什么样。
        //   { crossStress: true, days: 365 }                    —— 从零开始备
        //   { crossStress: true, days: 365, withHistory: true } —— 先灌最近 60 天真实出场记录，模拟接着现有题库往后备
        // 同样认 minVotes / filmCooldown / minDistractors / maxCold / minHot / maxTwoChar / targetWords，一次调用试一档。
        // 看：failed 必须是 0；similarPairs、traps 应为 0；relaxedLevel 里 >0 的天数越多说明规则越紧；
        // maxRepeat / topRepeated 看重复；samples 是前三天的「片名｜元信息｜线索」
        if (ev.crossStress === true) {
            const loaded = await loadCrossContext(ev);
            if (!loaded.pool.length) return { success: false, error: 'movie_facts 是空的，先跑 buildMovieFacts' };
            const days = Math.max(1, Math.min(Number(ev.days) || 365, 400));
            let history = 0;
            if (ev.withHistory === true) {
                // 压测的天序号是虚构的 0..N，把真实历史平移到 0 之前，保持相对间隔
                const real = cross.buildCrossContext([], {});
                history = await loadCrossHistory(real, cnDateStr());
                const offset = cross.dayNum(cnDateStr());
                real.usage.forEach(function (u, id) {
                    loaded.ctx.usage.set(id, { count: u.count, last: u.last - offset });
                });
            }
            const r = cross.stressCross(loaded.ctx, days, 'stress', startedAt + PREPARE_BUDGET_MS);
            return Object.assign({
                success: true, mode: 'crossStress',
                opts: pickCrossOpts(ev), wordPool: loaded.ctx.words.length,
                filmStats: loaded.stats, clueOverrides: loaded.overrides, historyPuzzles: history,
                note: r.days < days ? '超时前只跑了 ' + r.days + ' 天' : ''
            }, r);
        }

        // —— 批量备题：一次备好未来 N 天，写进 guess_puzzles。
        //
        // 这是这个玩法的正式出题方式，按天现出题只作兜底。理由有两条：
        //   1. 单个种子凑不出 3×3 是常态（合法组合出现率约 1/2400），现出题一旦失败
        //      那天就没题了；批量备题里失败无所谓，换个种子接着抽，只留成功的。
        //   2. 跨天去重只有批量时做得到。按天现出题没有跨天记忆，实测 17 个成功日里
        //      尼古拉斯·凯奇独占 6 天。这里对人物/属性各设冷却天数，直接从候选里剔掉。
        //
        // { prepare: true, days: 30 }                     —— 从今天起备 30 天，已有的跳过
        // { prepare: true, days: 30, from: '2026-09-01' } —— 指定起始日
        // { prepare: true, days: 30, overwrite: true }    —— 连已有的一起重出
        if (ev.prepare === true) {
            const pmode = ev.mode === 'cross' ? 'cross' : 'grid';
            // 填字的词库、实测难度、手工线索一次读好；grid 只要片库
            const loaded = pmode === 'cross' ? await loadCrossContext(ev) : null;
            const pool = loaded ? loaded.pool : await readPool();
            if (!pool.length) return { success: false, error: 'movie_facts 是空的，先跑 buildMovieFacts' };
            const mp = pool.filter(f => f.subtype !== 'tv');
            const days = Math.max(1, Math.min(Number(ev.days) || 30, 60));
            const from = /^\d{4}-\d{2}-\d{2}$/.test(ev.from || '') ? ev.from : cnDateStr();
            const overwrite = ev.overwrite === true;
            const personCool = ev.personCooldown == null ? PERSON_COOLDOWN_DAYS : Number(ev.personCooldown);
            const attrCool = ev.attrCooldown == null ? ATTR_COOLDOWN_DAYS : Number(ev.attrCooldown);

            // 两个玩法各自的候选集只建一次，30 天复用
            const axes = pmode === 'grid' ? buildPredicates(mp) : null;
            const crossCtx = loaded ? loaded.ctx : null;
            if (crossCtx && crossCtx.words.length < cross.MIN_USABLE) {
                return { success: false, mode: 'prepare', error: '填字词库只有 ' + crossCtx.words.length + ' 条，太小。放宽 minVotes 再试' };
            }
            try { await db.createCollection(PUZZLE_COLLECTION); } catch (e) { /* 已存在 */ }
            // 填字的冷却和降权跨批次：先把 from 之前 60 天已出的题灌进出场记录
            const historyPuzzles = crossCtx ? await loadCrossHistory(crossCtx, from) : 0;

            const fromMs = Date.parse(from + 'T00:00:00Z');
            const lastPerson = new Map();   // key -> 上次用它的天序号
            const lastAttr = new Map();
            const made = [], skipped = [], failedDays = [];
            let stoppedEarly = false;

            for (let i = 0; i < days; i++) {
                if (Date.now() - startedAt > PREPARE_BUDGET_MS) { stoppedEarly = true; break; }
                const date = cnDateStr(fromMs - CN_TZ_OFFSET_MS + i * 86400000);
                const docId = pmode + '_' + date;

                if (!overwrite) {
                    let existing = null;
                    try { existing = oneDoc(await db.collection(PUZZLE_COLLECTION).doc(docId).get()); }
                    catch (e) { /* 不存在 */ }
                    if (existing) {
                        // 跳过的那天照样算出场，后面的天才不会和它撞片
                        if (crossCtx) {
                            cross.recordUsage(crossCtx, (existing.entries || []).map(function (e) { return e.id; }), cross.dayNum(date));
                        }
                        skipped.push(date);
                        continue;
                    }
                }

                let g = null, doc = null;

                if (pmode === 'cross') {
                    // 冷却、降权、难度预算、干扰字、线索都在 cross.planCrossDay 里（见 cross.js 文件头）
                    g = cross.planCrossDay(crossCtx, cross.dayNum(date), 'cross|' + date);
                    if (!g) { failedDays.push(date); continue; }
                    doc = crossDoc(date, g, mp.length);
                    made.push({
                        date: date, words: g.entries.map(function (e) { return e.word; }),
                        relaxed: g.relaxed, cooldownUsed: g.cooldownUsed
                    });
                } else {
                    // 冷却期内用过的人物/属性直接不进候选
                    const usable = {
                        personAxis: axes.personAxis.filter(p => !(lastPerson.has(p.key) && i - lastPerson.get(p.key) < personCool)),
                        attrAxis: axes.attrAxis.filter(p => !(lastAttr.has(p.key) && i - lastAttr.get(p.key) < attrCool))
                    };
                    // 冷却把候选削太狠时退回全量，宁可重复也不能没题
                    const gopts = {
                        axes: (usable.personAxis.length >= 6 && usable.attrAxis.length >= 6) ? usable : axes
                    };
                    for (let salt = 0; salt < 8 && !g; salt++) {
                        const cand = generateGrid(mp, seededRandom('grid|' + date + (salt ? '|p' + salt : '')), gopts);
                        if (!cand.error) g = cand;
                    }
                    if (!g) { failedDays.push(date); continue; }
                    g.rows.forEach(r => lastPerson.set(r.key, i));
                    g.cols.forEach(c => lastAttr.set(c.key, i));
                    doc = {
                        mode: 'grid', date: date, rows: g.rows, cols: g.cols, cells: g.cells,
                        minCellAnswers: g.minCellAnswers, hardestCell: g.hardestCell,
                        poolSize: mp.length, createdAt: db.serverDate()
                    };
                    made.push({ date: date, hardestCell: g.hardestCell, rows: g.rows.map(r => r.label) });
                }

                // ⚠ 这一句原本漏了：批量备题只在内存里出题，报完 generated 就扔掉，
                // 库里一道没多。表现是「prepare 说备完 30 天，页面拿到的还是旧题」——
                // 因为页面实际吃的是下面按天现出题那条兜底路径（全文件只有它 set 过库）。
                await db.collection(PUZZLE_COLLECTION).doc(docId).set({ data: doc });
            }

            const base = {
                success: true, mode: 'prepare', puzzleMode: pmode,
                from: from, days: days, poolSize: mp.length,
                generated: made.length, skipped: skipped.length, failed: failedDays.length,
                failedDays: failedDays,
                stoppedEarly: stoppedEarly,
                note: stoppedEarly ? '未备完，用同样参数再跑一次会跳过已有的接着备' : '已备完',
                sample: made.slice(0, 3)
            };
            if (pmode === 'cross') {
                const films = new Map();
                made.forEach(function (m) {
                    m.words.forEach(function (w) { films.set(w, (films.get(w) || 0) + 1); });
                });
                base.wordPoolSize = crossCtx.words.length;
                base.historyPuzzles = historyPuzzles;
                base.filmStats = loaded.stats;
                base.clueOverrides = loaded.overrides;
                // 规则放松过的天（日期:档位）。档位见 cross.planCrossDay 的 relax 表，正常应为空
                base.relaxedDays = made.filter(function (m) { return m.relaxed > 0; }).map(function (m) { return m.date + ':' + m.relaxed; });
                base.distinctFilms = films.size;
                base.repeatedFilms = Array.from(films.entries()).filter(function (e) { return e[1] > 1; })
                    .sort(function (a, b) { return b[1] - a[1]; }).slice(0, 8)
                    .map(function (e) { return e[0] + '×' + e[1]; });
            } else {
                const persons = new Map();
                made.forEach(function (m) {
                    m.rows.forEach(function (l) { persons.set(l, (persons.get(l) || 0) + 1); });
                });
                base.distinctPersons = persons.size;
                base.topPersons = Array.from(persons.entries()).sort(function (a, b) { return b[1] - a[1]; })
                    .slice(0, 5).map(function (e) { return e[0] + '×' + e[1]; });
                base.hardestCellDist = made.reduce(function (m, x) {
                    m['最难格=' + x.hardestCell] = (m['最难格=' + x.hardestCell] || 0) + 1;
                    return m;
                }, {});
            }
            return base;

        }

        // —— 压测：只算不写，按真实片库复核 MIN_PERSON_FILMS 这几个常数。
        // 原始的 8/200/0.6 是拿「约 4000 部」的合成片库压出来的，而实到的 moviePool 只有 1800 上下，
        // 常数不能照搬。跑 N 个虚构日期（不是真实日期，所以不落库、随便跑），看三件事：
        //   failed —— 凑不出 3×3 的天数，>0 就说明门槛偏高
        //   hardestCellMedian —— 最难那格的解数中位数，当初压测的目标是 3
        //   distinctPersons —— N 天里一共用到几个不同的人，这才是「会不会天天德尼罗」的判据
        // 可用 minPersonFilms/personTop/maxAttrRatio 覆盖常数，一次调用试一档，不用改代码重部署。
        if (ev.stress === true) {
            const pool0 = await readPool();
            const mp = pool0.filter(f => f.subtype !== 'tv');
            if (!mp.length) return { success: false, error: 'movie_facts 是空的，先跑 buildMovieFacts' };
            const days = Math.max(1, Math.min(Number(ev.days) || 120, 400));
            const opts = {
                minPersonFilms: Number(ev.minPersonFilms) || MIN_PERSON_FILMS,
                personTop: Number(ev.personTop) || PERSON_CANDIDATE_TOP,
                maxAttrRatio: Number(ev.maxAttrRatio) || MAX_ATTR_RATIO,
                cellTargets: Array.isArray(ev.cellTargets) && ev.cellTargets.length ? ev.cellTargets : CELL_TARGETS,
                minAttrFilms: Number(ev.minAttrFilms) || MIN_ATTR_FILMS
            };
            const axes = buildPredicates(mp, opts);
            const gopts = Object.assign({}, opts, { axes });
            let failed = 0;
            const bestFails = [];
            const hardest = [];
            const cellTarget = {};
            const persons = new Map();
            const attrs = new Map();
            for (let i = 0; i < days; i++) {
                const d = 'stress-' + i;
                let g = generateGrid(mp, seededRandom('grid|' + d), gopts);
                for (let salt = 1; g.error && salt <= 5; salt++) {
                    g = generateGrid(mp, seededRandom('grid|' + d + '|retry' + salt), gopts);
                }
                if (g.error) { failed++; bestFails.push(g.bestMinCell); continue; }
                hardest.push(g.hardestCell);
                const k = '每格>=' + g.minCellAnswers;
                cellTarget[k] = (cellTarget[k] || 0) + 1;
                g.rows.forEach(r => persons.set(r.label, (persons.get(r.label) || 0) + 1));
                g.cols.forEach(c => attrs.set(c.label, (attrs.get(c.label) || 0) + 1));
            }
            hardest.sort((a, b) => a - b);
            const topN = (m, n) => Array.from(m.entries()).sort((a, b) => b[1] - a[1])
                .slice(0, n).map(e => e[0] + '×' + e[1]);
            return {
                success: true, mode: 'stress',
                opts, poolSize: mp.length, days,
                predicates: { person: axes.personAxis.length, attr: axes.attrAxis.length },
                failed,
                // 失败日里「最小格」最好能到几：0 = 总有空格，1 = 差一点点（把 cellTargets 退到 1 就能出题）
                failedBestMinCell: (function () {
                    const m = {};
                    bestFails.forEach(v => { m['最好=' + v] = (m['最好=' + v] || 0) + 1; });
                    return m;
                })(),
                cellTarget,
                hardestCellMedian: hardest.length ? hardest[Math.floor(hardest.length / 2)] : 0,
                hardestCellMin: hardest.length ? hardest[0] : 0,
                distinctPersons: persons.size,
                distinctAttrs: attrs.size,
                topPersons: topN(persons, 8),
                topAttrs: topN(attrs, 8)
            };
        }

        // 已有就直接返回（每日一题：所有人看到同一道）
        if (ev.regenerate !== true) {
            try {
                const existing = oneDoc(await db.collection(PUZZLE_COLLECTION).doc(docId).get());
                if (existing) {
                    if (ev.inspect === true) return { success: true, puzzle: existing };
                    return {
                        success: true,
                        puzzle: sanitizeFor(mode, existing, ev)
                    };
                }
            } catch (e) { /* 文档不存在，往下现出一道 */ }
        }

        const pool = await readPool();
        if (!pool.length) {
            return { success: false, error: 'movie_facts 是空的，先跑 buildMovieFacts' };
        }
        // grid 玩法只用电影，剧集三主题的条目排除（「某演员 ∩ 某类型」混进剧集会很怪）
        const moviePool = pool.filter(f => f.subtype !== 'tv');
        // 种子固定用「玩法|日期」，两个用户同时打开谁先触发生成都得到同一道题。
        // regenerate 是调试用的重出：不加盐的话同一个种子只会算出同一道，重出等于没重出。
        const seedSalt = ev.regenerate === true ? '|regen' + Date.now() : '';
        const rnd = seededRandom(mode + '|' + date + seedSalt);

        let doc;
        if (mode === 'grid') {
            // 换种重试：极少数种子的洗牌流就是凑不出可解的 3×3（合成片库实测 120 天里碰上 1 天）。
            // 换个后缀重新起一条随机流即可，仍然是确定性的——同一天任何人算出来的还是同一道题。
            // 谓词只建一次，5 次换种重试复用同一份
            const gopts = { axes: buildPredicates(moviePool) };
            let g = generateGrid(moviePool, rnd, gopts);
            for (let salt = 1; g.error && salt <= 5; salt++) {
                g = generateGrid(moviePool, seededRandom(mode + '|' + date + seedSalt + '|retry' + salt), gopts);
            }
            if (g.error) return { success: false, error: g.error };
            doc = {
                mode, date, rows: g.rows, cols: g.cols, cells: g.cells,
                minCellAnswers: g.minCellAnswers, hardestCell: g.hardestCell,
                poolSize: moviePool.length
            };
        } else if (mode === 'cross') {
            // 和 prepare 同一套规则；这里多读一遍片库没关系，兜底路径一天最多走一次。
            // 冷却只看这天之前 60 天的题（这条路径本来就是题库断档时才走）
            const loaded = await loadCrossContext(ev);
            await loadCrossHistory(loaded.ctx, date);
            const x = cross.planCrossDay(loaded.ctx, cross.dayNum(date), mode + '|' + date + seedSalt);
            if (!x) return { success: false, error: '填字出题失败，先跑 { crossStress: true } 看看词库和规则' };
            doc = crossDoc(date, x, moviePool.length);
            delete doc.createdAt;   // 下面统一补
        } else {
            const c = generateClue(moviePool, rnd);
            if (c.error) return { success: false, error: c.error };
            doc = {
                mode, date, answerId: c.answerId, answerTitle: c.answerTitle,
                answerYear: c.answerYear, answerCover: c.answerCover,
                clues: c.clues, poolSize: moviePool.length
            };
        }
        doc.createdAt = db.serverDate();

        try { await db.createCollection(PUZZLE_COLLECTION); } catch (e) { /* 已存在 */ }
        await db.collection(PUZZLE_COLLECTION).doc(docId).set({ data: doc });

        if (ev.inspect === true) return { success: true, puzzle: Object.assign({ _id: docId }, doc), generated: true };
        return {
            success: true, generated: true,
            puzzle: sanitizeFor(mode, doc, ev)
        };
    } catch (e) {
        console.error('[getGuessPuzzle] 失败:', e && (e.errMsg || e.message));
        return { success: false, error: (e && (e.errMsg || e.message)) || String(e) };
    }
};
