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
const MAX_GENERATE_TRIES = 400;

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
    // 属性谓词统一走这里，好把上下限判断收在一处
    const pushAttr = (p) => {
        if (p.ids.length >= MIN_ATTR_FILMS && p.ids.length <= maxAttr) attrAxis.push(p);
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
    const { personAxis, attrAxis } = buildPredicates(pool, opts);
    if (personAxis.length < 3 || attrAxis.length < 3) {
        return { error: '谓词不足：人物 ' + personAxis.length + ' 个 / 属性 ' + attrAxis.length + ' 个，片库可能还没建好' };
    }

    const idSet = p => (p._idSet || (p._idSet = new Set(p.ids)));

    // 两级放宽：先要求每格 3 解，凑不出来再退到 2。
    for (const minCell of CELL_TARGETS) {
        for (let tries = 0; tries < MAX_GENERATE_TRIES; tries++) {
            const rows = shuffled(personAxis, rnd).slice(0, 3);
            const cols = shuffled(attrAxis, rnd).slice(0, 3);
            // 同类属性不要同时出现在三列里（「2010 年代」和「2000 年代」并排会让人
            // 以为要选两个年代，而且这两列的交集约束其实高度相关）
            if (new Set(cols.map(c => c.type)).size < 3) continue;

            const cells = [];
            let ok = true;
            for (let r = 0; r < 3 && ok; r++) {
                for (let c = 0; c < 3 && ok; c++) {
                    const cs = idSet(cols[c]);
                    const answerIds = rows[r].ids.filter(id => cs.has(id));
                    if (answerIds.length < minCell) { ok = false; break; }
                    cells.push({ r, c, answerIds, count: answerIds.length });
                }
            }
            if (!ok) continue;

            const strip = p => ({ key: p.key, type: p.type, label: p.label, value: p.value, poolCount: p.ids.length });
            return {
                rows: rows.map(strip), cols: cols.map(strip), cells,
                minCellAnswers: minCell,
                hardestCell: Math.min.apply(null, cells.map(c => c.count))
            };
        }
    }
    return {
        error: '每格 ' + CELL_TARGETS.join('/') + ' 解各试了 ' + MAX_GENERATE_TRIES +
            ' 次都没凑出 3×3。片库太小或谓词门槛太高，先确认 buildMovieFacts 跑完了'
    };
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
    const ev = event || {};
    const mode = ev.mode === 'clue' ? 'clue' : 'grid';
    const date = /^\d{4}-\d{2}-\d{2}$/.test(ev.date || '') ? ev.date : cnDateStr();
    const docId = mode + '_' + date;

    try {
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
                maxAttrRatio: Number(ev.maxAttrRatio) || MAX_ATTR_RATIO
            };
            const axes = buildPredicates(mp, opts);
            let failed = 0;
            const hardest = [];
            const cellTarget = {};
            const persons = new Map();
            const attrs = new Map();
            for (let i = 0; i < days; i++) {
                const d = 'stress-' + i;
                let g = generateGrid(mp, seededRandom('grid|' + d), opts);
                for (let salt = 1; g.error && salt <= 5; salt++) {
                    g = generateGrid(mp, seededRandom('grid|' + d + '|retry' + salt), opts);
                }
                if (g.error) { failed++; continue; }
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
                const got = await db.collection(PUZZLE_COLLECTION).doc(docId).get();
                if (got && got.data) {
                    if (ev.inspect === true) return { success: true, puzzle: got.data };
                    return {
                        success: true,
                        puzzle: mode === 'grid' ? sanitizeGrid(got.data) : sanitizeClue(got.data, ev.revealed)
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
            let g = generateGrid(moviePool, rnd);
            for (let salt = 1; g.error && salt <= 5; salt++) {
                g = generateGrid(moviePool, seededRandom(mode + '|' + date + seedSalt + '|retry' + salt));
            }
            if (g.error) return { success: false, error: g.error };
            doc = {
                mode, date, rows: g.rows, cols: g.cols, cells: g.cells,
                minCellAnswers: g.minCellAnswers, hardestCell: g.hardestCell,
                poolSize: moviePool.length
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
            puzzle: mode === 'grid' ? sanitizeGrid(doc) : sanitizeClue(doc, ev.revealed)
        };
    } catch (e) {
        console.error('[getGuessPuzzle] 失败:', e && (e.errMsg || e.message));
        return { success: false, error: (e && (e.errMsg || e.message)) || String(e) };
    }
};
