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
//   { crossStats: true }              —— 填字词库体检（出题前先确认词库够不够）
//   { prepare: true, days: 30, mode: 'cross' } —— 批量备 30 天填字
//   { mode: 'clue' }                  —— 取今天的线索题
//   { mode: 'grid', date: '2026-08-26' } —— 取指定日期（「昨天」入口用）
//   { mode: 'grid', regenerate: true }   —— 重出一道覆盖（调试用，会作废当天已有作答）
//   { inspect: true, mode, date }        —— 带答案的完整视图，仅供控制台排查，不走前端

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

const FACTS_COLLECTION = 'movie_facts';
const PUZZLE_COLLECTION = 'guess_puzzles';

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

/**
 * 固定种子的伪随机数（mulberry32）。
 * 用日期做种子——两个用户同时打开、谁先触发生成都得到同一道题，
 * 不必依赖「谁先写库谁说了算」的竞态。
 */
function seededRandom(seedStr) {
    let h = 1779033703 ^ seedStr.length;
    for (let i = 0; i < seedStr.length; i++) {
        h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353);
        h = (h << 13) | (h >>> 19);
    }
    let a = h >>> 0;
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function shuffled(arr, rnd) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
}

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
    if (mode === 'cross') return sanitizeCross(doc);
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
                _id: true, title: true, year: true, subtype: true, genres: true, actors: true,
                directors: true, countries: true, durationMin: true, rating: true,
                ratingCount: true, cover: true, memberOf: true, tags: true, intro: true
            })
            .skip(skip).limit(READ_LIMIT).get();
        const rows = (res && res.data) || [];
        out.push.apply(out, rows);
        if (rows.length < READ_LIMIT) break;
        skip += rows.length;
    }
    return out;
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


// ============================================================================
// 纵横填字（mode: 'cross'）
//
// 和 grid/clue 两个玩法共用片库，但用的是**片名的汉字**而不是谓词：
// 若干部电影的中文片名在 7×7 网格里横竖交叉、共用汉字，玩家看剧情线索、
// 从候选字池里点字填格。
//
// 词库比想象中窄，三道过滤缺一不可：
//   1. 必须是**纯汉字 2~7 字**。带数字/冒号/英文的填不进格子
//      （《指环王3：王者无敌》《007：大战皇家赌场》），实测只有约三分之一的片名合格。
//   2. 必须**足够有名**（ratingCount 门槛）。填字里一条冷门或错误的片名会让整天的题无解，
//      因为它还占着交叉点 —— 这比 3×3 里出现一部怪片严重得多，那里它只是九个答案之一。
//      顺带挡掉种子数据里的脏标题（palmeDor 种子里就躺着一条「疯狂富作用」）。
//   3. 还得有 intro，否则没线索可给。
// ============================================================================

const CROSS_N = 7;                  // 网格边长
const CROSS_TARGET_WORDS = 5;       // 每天放几部片
const CROSS_MIN_VOTES = 50000;      // 片名要够有名，见上面第 2 条
const CROSS_DISTRACTORS = 8;        // 候选字池里混几个干扰字
const CROSS_CLUE_MAXLEN = 44;       // 一句剧情的字数上限
const CROSS_COOLDOWN_DAYS = 20;     // 同一部片多少天内不重复出现

/** 能进填字的片名：纯汉字 2~7 字 */
function crossUsableTitle(t) {
    return typeof t === 'string' && /^[一-龥]{2,7}$/.test(t);
}

/** 词库：纯汉字片名 + 有简介 + 够有名 */
function crossWordPool(pool, opts) {
    const o = opts || {};
    const minVotes = o.minVotes == null ? CROSS_MIN_VOTES : Number(o.minVotes);
    return pool.filter(function (f) {
        return f.subtype !== 'tv'
            && crossUsableTitle(f.title)
            && String(f.intro || '').length >= 20
            && Number(f.ratingCount) >= minVotes
            && crossClueOk(crossClue(f));
    });
}

/**
 * 把一句简介加工成填字线索。比 grid/clue 玩法的打码严格得多，原因是这里泄露的
 * 是**要填的那几个字本身**，不是「哪部片」——漏一点点就等于白送格子。
 *
 * 实测（2026-08-29 那道题）暴露的三个泄露源，缺一道都不行：
 *   ① 片名子串。maskSpoilers 只替换完整片名，而中文片名的片段极常出现在简介里：
 *      《柏林苍穹下》的简介第一句就是「柏林由两位天使守护着」，答案前两字直接白送；
 *      《奇幻森林》的「茂密的原始森林中」同理。所以要按片名的**所有 2 字以上子串**打码。
 *   ② 括号里的演职员。「（███ Scarlett Johansson 饰）」中文名打了码、拉丁原名还在，
 *      等于点名。而这段对线索本身毫无价值，整段删掉最干净，顺带省出字数。
 *   ③ 兜底：剩下的长串拉丁字母一律去掉（简介里偶尔直接写外文原名）。
 */
function crossClue(fact) {
    let s = String(fact.intro || '');
    // ② 括号连内容一起删（中英文括号都有）
    s = s.replace(/[（(][^）)]*[）)]/g, '');
    // ① 片名 / 原名 / 人名，以及片名的所有 2 字以上子串
    const secrets = [];
    const pushWord = function (w) {
        if (w && String(w).length >= 2) secrets.push(String(w));
    };
    [fact.title, fact.originalTitle].forEach(function (t) {
        const str = String(t || '');
        for (let len = str.length; len >= 2; len--) {
            for (let i = 0; i + len <= str.length; i++) pushWord(str.slice(i, i + len));
        }
    });
    (fact.actors || []).forEach(pushWord);
    (fact.directors || []).forEach(pushWord);
    // 长的先替换，否则短子串会先把长串打散
    secrets.sort(function (a, b) { return b.length - a.length; });
    secrets.forEach(function (w) {
        const parts = s.split(w);
        if (parts.length > 1) s = parts.join('███');
    });
    // ③ 残留的拉丁字母串
    s = s.replace(/[A-Za-z][A-Za-z.'\- ]{2,}/g, '');
    // 连续的码合并，免得出现 ██████████ 这种长条
    s = s.replace(/(?:███)+/g, '███').replace(/\s+/g, ' ');

    const parts = s.split(/[。！？；\n]/).map(function (x) { return x.trim(); }).filter(Boolean);
    let out = '';
    for (let i = 0; i < parts.length && out.length < 16; i++) out += (out ? '，' : '') + parts[i];
    if (!out) out = s.trim();
    if (out.length > CROSS_CLUE_MAXLEN) out = out.slice(0, CROSS_CLUE_MAXLEN) + '…';
    return out;
}

/**
 * 线索可用吗。打完码后可能只剩一堆 ███ 或者短得毫无信息，
 * 这种片直接不进词库 —— 填字里一条没法推的线索会卡死整盘。
 */
function crossClueOk(clue) {
    const s = String(clue || '');
    if (s.length < 14) return false;
    const masked = (s.match(/███/g) || []).length * 3;
    return masked / s.length < 0.35;
}


/** 汉字 -> [{ id, title, pos }]，交叉点从这里找 */
function crossCharIndex(words) {
    const m = new Map();
    words.forEach(function (w) {
        for (let i = 0; i < w.title.length; i++) {
            const c = w.title[i];
            if (!m.has(c)) m.set(c, []);
            m.get(c).push({ id: w._id, title: w.title, pos: i });
        }
    });
    return m;
}

/**
 * 能否把 word 放在 (r,c) 起始、dir 方向。返回交叉数，放不下给 -1。
 * 稀疏式填字的规矩：词与词只允许在交叉点接触。
 *   - 词的首尾外侧必须留白，否则会和相邻的词连成一串读不断
 *   - 非交叉格的两侧必须留白，否则会在垂直方向拼出一个没有定义的「词」
 */
function crossCanPlace(g, word, r, c, dir) {
    const L = word.length;
    const dr = dir === 'V' ? 1 : 0, dc = dir === 'H' ? 1 : 0;
    if (r < 0 || c < 0 || r + dr * (L - 1) >= CROSS_N || c + dc * (L - 1) >= CROSS_N) return -1;
    const br = r - dr, bc = c - dc, ar = r + dr * L, ac = c + dc * L;
    if (br >= 0 && bc >= 0 && g[br][bc]) return -1;
    if (ar < CROSS_N && ac < CROSS_N && g[ar][ac]) return -1;
    let cross = 0;
    for (let i = 0; i < L; i++) {
        const rr = r + dr * i, cc = c + dc * i, ch = word[i], cur = g[rr][cc];
        if (cur) {
            if (cur !== ch) return -1;
            cross++;
            continue;
        }
        const sr = dir === 'H' ? 1 : 0, sc = dir === 'H' ? 0 : 1;
        if (rr - sr >= 0 && cc - sc >= 0 && g[rr - sr][cc - sc]) return -1;
        if (rr + sr < CROSS_N && cc + sc < CROSS_N && g[rr + sr][cc + sc]) return -1;
    }
    return cross;
}

function crossPut(g, word, r, c, dir) {
    const dr = dir === 'V' ? 1 : 0, dc = dir === 'H' ? 1 : 0;
    for (let i = 0; i < word.length; i++) g[r + dr * i][c + dc * i] = word[i];
}

/**
 * 出一道填字。策略：先横放一个种子词，然后反复「挑一个已放的词 → 挑它的一个字 →
 * 找另一部片名里有这个字 → 垂直放上去」，直到放够 target 部。
 * 放不满就整盘重来（很便宜：真实片名下实测毫秒级、60/60 天都能成）。
 */
function generateCross(pool, rnd, opts) {
    const o = opts || {};
    const target = o.targetWords || CROSS_TARGET_WORDS;
    const words = o.words || crossWordPool(pool, o);
    if (words.length < 40) {
        return { error: '可用片名只有 ' + words.length + ' 条（需纯汉字 2~7 字 + 有简介 + 评分人数达标），词库太小' };
    }
    const byChar = o.byChar || crossCharIndex(words);
    const byTitle = new Map(words.map(function (w) { return [w.title, w]; }));
    const pick = function (a) { return a[Math.floor(rnd() * a.length)]; };
    const seeds = words.filter(function (w) { return w.title.length >= 4 && w.title.length <= 6; });
    if (!seeds.length) return { error: '没有 4~6 字的种子片名' };

    for (let attempt = 0; attempt < 300; attempt++) {
        const g = Array.from({ length: CROSS_N }, function () { return Array(CROSS_N).fill(''); });
        const placed = [];
        const seed = pick(seeds);
        const r0 = Math.floor(rnd() * CROSS_N);
        const c0 = Math.floor(rnd() * (CROSS_N - seed.title.length + 1));
        if (crossCanPlace(g, seed.title, r0, c0, 'H') < 0) continue;
        crossPut(g, seed.title, r0, c0, 'H');
        placed.push({ id: seed._id, word: seed.title, r: r0, c: c0, dir: 'H' });

        for (let round = 0; round < 500 && placed.length < target; round++) {
            const base = pick(placed);
            const bi = Math.floor(rnd() * base.word.length);
            const cands = byChar.get(base.word[bi]) || [];
            if (!cands.length) continue;
            const cand = pick(cands);
            if (placed.some(function (p) { return p.word === cand.title; })) continue;
            const dir = base.dir === 'H' ? 'V' : 'H';
            const br = base.dir === 'H' ? base.r : base.r + bi;
            const bc = base.dir === 'H' ? base.c + bi : base.c;
            const r = dir === 'V' ? br - cand.pos : br;
            const c = dir === 'H' ? bc - cand.pos : bc;
            if (crossCanPlace(g, cand.title, r, c, dir) > 0) {
                crossPut(g, cand.title, r, c, dir);
                placed.push({ id: cand.id, word: cand.title, r: r, c: c, dir: dir });
            }
        }
        if (placed.length < target) continue;

        const entries = placed.map(function (p, i) {
            const f = byTitle.get(p.word);
            return {
                no: i + 1, id: p.id, word: p.word, r: p.r, c: p.c, dir: p.dir, len: p.word.length,
                clue: crossClue(f), year: f.year || null, cover: f.cover || ''
            };
        });
        const solutionChars = new Set();
        g.forEach(function (row) { row.forEach(function (ch) { if (ch) solutionChars.add(ch); }); });
        // 干扰字从别的片名里取，且不能和答案字重复
        const distract = [];
        const allChars = Array.from(byChar.keys());
        for (let i = 0; i < CROSS_DISTRACTORS * 20 && distract.length < CROSS_DISTRACTORS; i++) {
            const ch = pick(allChars);
            if (!solutionChars.has(ch) && distract.indexOf(ch) < 0) distract.push(ch);
        }
        const charPool = shuffled(Array.from(solutionChars).concat(distract), rnd);

        return {
            grid: g.map(function (row) { return row.slice(); }),
            entries: entries,
            charPool: charPool,
            filledCells: g.reduce(function (n, row) { return n + row.filter(Boolean).length; }, 0),
            attempt: attempt
        };
    }
    return { error: '试了 300 盘都没排满 ' + target + ' 部片，词库或网格尺寸有问题' };
}

/**
 * 下发给前端的视图：只给「哪些格子要填」和线索，**不给答案字**。
 * charPool 里含全部答案字，这是点选输入这个玩法本身要求的；
 * 但绝不能同时下发 entries[].word —— 那等于直接把答案送出去。
 */
function sanitizeCross(doc) {
    return {
        mode: 'cross', date: doc.date,
        n: doc.n,
        // 1 = 要填的格子，0 = 空白
        mask: (doc.grid || []).map(function (row) { return row.map(function (ch) { return ch ? 1 : 0; }); }),
        entries: (doc.entries || []).map(function (e) {
            return { no: e.no, r: e.r, c: e.c, dir: e.dir, len: e.len, clue: e.clue };
        }),
        charPool: doc.charPool,
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
            const pool0 = await readPool();
            const mp0 = pool0.filter(function (f) { return f.subtype !== 'tv'; });
            const pureTitle = mp0.filter(function (f) { return crossUsableTitle(f.title); });
            const withIntro = pureTitle.filter(function (f) { return String(f.intro || '').length >= 20; });
            const words = crossWordPool(mp0, ev);
            const byLen = {};
            words.forEach(function (w) { byLen[w.title.length] = (byLen[w.title.length] || 0) + 1; });
            const cf = new Map();
            words.forEach(function (w) {
                new Set(w.title.split('')).forEach(function (c) { cf.set(c, (cf.get(c) || 0) + 1); });
            });
            const crossable = Array.from(cf.values()).filter(function (v) { return v >= 2; }).length;
            return {
                success: true, mode: 'crossStats',
                minVotes: ev.minVotes == null ? CROSS_MIN_VOTES : Number(ev.minVotes),
                moviePool: mp0.length,
                afterPureTitle: pureTitle.length,      // 纯汉字 2~7 字
                afterIntro: withIntro.length,          // 再要求有简介
                wordPool: words.length,                // 再要求评分人数达标 = 最终词库
                lenDist: byLen,
                seeds: words.filter(function (w) { return w.title.length >= 4 && w.title.length <= 6; }).length,
                distinctChars: cf.size,
                crossableChars: crossable,             // 出现在 ≥2 部片名里，能当交叉点
                topChars: Array.from(cf.entries()).sort(function (a, b) { return b[1] - a[1]; })
                    .slice(0, 12).map(function (e) { return e[0] + ':' + e[1]; }),
                sampleTitles: words.slice(0, 12).map(function (w) { return w.title; })
            };
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
            const pool = await readPool();
            if (!pool.length) return { success: false, error: 'movie_facts 是空的，先跑 buildMovieFacts' };
            const mp = pool.filter(f => f.subtype !== 'tv');
            const pmode = ev.mode === 'cross' ? 'cross' : 'grid';
            const days = Math.max(1, Math.min(Number(ev.days) || 30, 60));
            const from = /^\d{4}-\d{2}-\d{2}$/.test(ev.from || '') ? ev.from : cnDateStr();
            const overwrite = ev.overwrite === true;
            const personCool = ev.personCooldown == null ? PERSON_COOLDOWN_DAYS : Number(ev.personCooldown);
            const attrCool = ev.attrCooldown == null ? ATTR_COOLDOWN_DAYS : Number(ev.attrCooldown);

            // 两个玩法各自的候选集只建一次，30 天复用
            const axes = pmode === 'grid' ? buildPredicates(mp) : null;
            const crossWords = pmode === 'cross' ? crossWordPool(mp, ev) : null;
            if (pmode === 'cross' && crossWords.length < 120) {
                return { success: false, mode: 'prepare', error: '填字词库只有 ' + crossWords.length + ' 条，太小。放宽 minVotes 再试' };
            }
            const filmCool = ev.filmCooldown == null ? CROSS_COOLDOWN_DAYS : Number(ev.filmCooldown);
            try { await db.createCollection(PUZZLE_COLLECTION); } catch (e) { /* 已存在 */ }

            const fromMs = Date.parse(from + 'T00:00:00Z');
            const lastPerson = new Map();   // key -> 上次用它的天序号
            const lastFilm = new Map();     // cross 用：片 id -> 上次用它的天序号
            const lastAttr = new Map();
            const made = [], skipped = [], failedDays = [];
            let stoppedEarly = false;

            for (let i = 0; i < days; i++) {
                if (Date.now() - startedAt > PREPARE_BUDGET_MS) { stoppedEarly = true; break; }
                const date = cnDateStr(fromMs - CN_TZ_OFFSET_MS + i * 86400000);
                const docId = pmode + '_' + date;

                if (!overwrite) {
                    let exists = false;
                    try { exists = !!oneDoc(await db.collection(PUZZLE_COLLECTION).doc(docId).get()); }
                    catch (e) { /* 不存在 */ }
                    if (exists) { skipped.push(date); continue; }
                }

                let g = null, doc = null;

                if (pmode === 'cross') {
                    // 冷却：同一部片 20 天内不再出现。词库本来就窄（纯汉字 + 够有名），
                    // 不去重的话热门片名会反复出现在格子里。
                    const usableWords = crossWords.filter(function (w) {
                        return !(lastFilm.has(w._id) && i - lastFilm.get(w._id) < filmCool);
                    });
                    // 削太狠就退回全量：宁可重复，也不能这天没题
                    const wset = usableWords.length >= 120 ? usableWords : crossWords;
                    const xopts = { words: wset, byChar: crossCharIndex(wset) };
                    for (let salt = 0; salt < 8 && !g; salt++) {
                        const cand = generateCross(mp, seededRandom('cross|' + date + (salt ? '|p' + salt : '')), xopts);
                        if (!cand.error) g = cand;
                    }
                    if (!g) { failedDays.push(date); continue; }
                    g.entries.forEach(function (e) { lastFilm.set(e.id, i); });
                    doc = {
                        mode: 'cross', date: date, n: CROSS_N, grid: g.grid, entries: g.entries,
                        charPool: g.charPool, filledCells: g.filledCells,
                        poolSize: mp.length, createdAt: db.serverDate()
                    };
                    made.push({ date: date, words: g.entries.map(function (e) { return e.word; }) });
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
                base.wordPoolSize = crossWords.length;
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
            let x = generateCross(moviePool, rnd);
            for (let salt = 1; x.error && salt <= 5; salt++) {
                x = generateCross(moviePool, seededRandom(mode + '|' + date + seedSalt + '|retry' + salt));
            }
            if (x.error) return { success: false, error: x.error };
            doc = {
                mode, date, n: CROSS_N, grid: x.grid, entries: x.entries,
                charPool: x.charPool, filledCells: x.filledCells, poolSize: moviePool.length
            };
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
