// 云函数：submitGuess —— 猜电影的作答端（联想输入 + 校验 + 计分 + 进度存档）
//
// 校验为什么必须在服务端：guess_puzzles 文档里带着每格的正确答案集合，
// 下发到前端等于直接把答案给玩家。前端只拿到行列标签，作答一律回到这里判。
//
// 这个函数不重复实现任何谓词逻辑——getGuessPuzzle 出题时已经把每格算出的
// answerIds 存进了 puzzle 文档，这里只做一次「猜的片在不在这一格的答案集里」的查表。
// 谓词规则将来要改，只改 getGuessPuzzle 一处，历史题目也不会因此变得前后不一致。
//
// action：
//   'suggest' —— { keyword } 输入联想，返回片库里匹配的候选（前端下拉用）
//   'answer'  —— { mode, date, guessId|guessTitle, r, c } 提交作答
//   'cross' 玩法：answer 传 { mode:'cross', entryNo, chars } 按整条校验；
//                hint 传 { mode:'cross', entryNo } 逐字揭开该条（每次多揭一个，不是换位置）
//   'state'   —— { mode, date } 取当前用户在这道题上的进度（切后台回来/换设备要能续上）
//   'hint'    —— { mode:'grid', date, r, c } 求提示：透露该格某个正确答案的一个侧面，扣一次机会
//   'players' —— {} 各玩法的参与人数（分类页玩法卡展示），不认人、不写库
//   'summary' —— { mode:'cross', date } 结束面板要的数：连续天数 / 累计天数 / 完美次数 /
//                当天排行榜（前 10 名；自己在榜上才给名次）/ 本局用时。不写库
//
// 集合：
//   guess_records  _id = `${openid}_${mode}_${date}` —— 每人每题一份进度
//                  （2026-10-30 起带 createdAt / updatedAt / finishedAt，排行榜和用时靠它们）
//   guess_stats    _id = `${mode}_${date}` —— 全体作答分布，用来算「冷门加分」
//   guess_opens    _id = `${openid}_${mode}_${date}` —— 第一次打开这道题的时间（firstAt，只写一次）
//                  + 累计的作答用时 activeSeconds。guess_records 要第一次作答才落库，光打开看了一眼的人
//                  原先不留痕；用时也放这里，因为还没作答时就已经在计时了
//   'tick'    —— { mode:'cross', date, activeDelta } 填字页切到后台 / 离开时把这段前台时长报上来

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

const FACTS_COLLECTION = 'movie_facts';
const PUZZLE_COLLECTION = 'guess_puzzles';
const OPEN_COLLECTION = 'guess_opens';
const RANK_TOP = 10;            // 排行榜显示前几名
const RECORD_COLLECTION = 'guess_records';
const STATS_COLLECTION = 'guess_stats';

const CN_TZ_OFFSET_MS = 8 * 60 * 60 * 1000;
const MAX_GUESSES = 9;          // 与 moviegrid 一致：一局 9 次机会
// 填字给宽一点：一局要答出 5 条，且求提示同样扣机会，9 次会让「卡在一条上」直接终局。
// —— 填字的规则常数（和另外两个玩法完全不共用）
const CROSS_LIVES = 3;          // 生命值：答错一次扣一颗，扣完失败
const CROSS_FREE_HINTS = 2;     // 每天免费提示次数
// 提示和复活都不限次数，代价交给分数。
// 防「揭穿答案」靠的**不是每天几次**，而是单条的两道闸（最多揭一半、且至少留 2 个字未知）——
// 那是结构性的：5 条片名加起来最多也就揭 8 个字，跟买了几次无关。
// 每日总次数上限只会限制广告库存，不增加任何安全性，所以拆掉。
// 初始 100 分是为了不出现负分：扣分项被上限卡死 —— 最多错 5 次(−50)、
// 最多用 5 次提示(−25)，合计 −75，所以垫 100 分底就一定为正（最差 25 分）。
const CROSS_START_SCORE = 100;
const SCORE_CORRECT = 20;
const SCORE_WRONG = -10;
const SCORE_HINT = -5;
const SUGGEST_LIMIT = 10;

/**
 * 从 doc(id).get() 的返回里取出那一份文档，取不到给 null。
 * 云函数端 doc().get() 的 data 是**数组**，文档不存在时是空数组，而 [] 是 truthy ——
 * 直接 if (res.data) 会把「不存在」判成「存在」，且拿到的是个空数组而不是文档。
 * 本文件三处都踩过：首次作答的进度记录、当天题目、按 id 取影片事实。
 * getGuessPuzzle 里有一份同样的实现，改一处记得两边一起改。
 */
function oneDoc(res) {
    const d = res && res.data;
    if (Array.isArray(d)) return d.length ? d[0] : null;
    return d || null;
}

function cnDateStr(ms) {
    const d = new Date((ms == null ? Date.now() : ms) + CN_TZ_OFFSET_MS);
    const p = n => (n < 10 ? '0' : '') + n;
    return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate());
}

/** 'HH:MM'（北京时间） */
function cnClock(t) {
    const ms = msOf(t);
    if (isNaN(ms)) return '';
    const d = new Date(ms + CN_TZ_OFFSET_MS);
    const p = n => (n < 10 ? '0' : '') + n;
    return p(d.getUTCHours()) + ':' + p(d.getUTCMinutes());
}

function msOf(t) {
    if (!t) return NaN;
    return t instanceof Date ? t.getTime() : Date.parse(t);
}

/**
 * 排行榜上的称呼。没有昵称体系，又不能露 openid，就用 openid 哈希出一个四位数：
 * 同一个人每天都是同一个号，看得出「又是他」，但反推不出是谁
 */
function playerName(openid) {
    let h = 2166136261;
    for (let i = 0; i < openid.length; i++) h = Math.imul(h ^ openid.charCodeAt(i), 16777619);
    return '影迷 #' + String((h >>> 0) % 10000).padStart(4, '0');
}

/**
 * 昵称打码：留首尾、中间换成 *（「张三丰」→「张*丰」，「小明」→「小*」）。
 * 按字符而不是按 UTF-16 码元切，昵称里的 emoji 才不会被切成半个
 */
function maskNickname(n) {
    const s = Array.from(String(n || '').trim());
    if (!s.length) return '';
    if (s.length <= 2) return s[0] + '*';
    return s[0] + '*'.repeat(Math.min(s.length - 2, 3)) + s[s.length - 1];
}

/**
 * 排行榜上这些人的头像和打码昵称。资料来自「我的」页登录时用户自己设的（users 集合），
 * 没设过的人照旧是「影迷 #四位数」+ 默认头像。
 * 头像存的是云存储 fileID，而云存储只有上传者本人能读，别人的手机上直接显示不出来，
 * 所以在这里（服务端有管理权限）换成临时链接再下发
 */
async function profilesOf(openids) {
    const out = new Map();
    const ids = Array.from(new Set(openids.filter(Boolean)));
    if (!ids.length) return out;
    try {
        const res = await db.collection('users').where({ openid: _.in(ids) })
            .field({ openid: true, nickname: true, avatarUrl: true }).limit(100).get();
        ((res && res.data) || []).forEach(u => {
            if (!out.has(u.openid)) out.set(u.openid, { name: maskNickname(u.nickname), avatar: u.avatarUrl || '' });
        });
        const fileIds = Array.from(out.values()).map(p => p.avatar).filter(a => /^cloud:\/\//.test(a));
        if (fileIds.length) {
            const t = await cloud.getTempFileURL({ fileList: fileIds });
            const urlOf = new Map(((t && t.fileList) || []).map(f => [f.fileID, f.tempFileURL || '']));
            out.forEach(p => { if (/^cloud:\/\//.test(p.avatar)) p.avatar = urlOf.get(p.avatar) || ''; });
        }
    } catch (e) {
        console.warn('[submitGuess] 读排行榜头像昵称失败（照旧显示影迷编号）:', e && (e.errMsg || e.message));
    }
    return out;
}

/**
 * 完美：全答出、没错、没用提示、没复活。
 * 不看 lives：最早的记录（生命值规则之前）没有这个字段，按 lives > 0 判会把它们全漏掉；
 * 而「已结束且一次没错」本身就只可能是全答出了（♥ 是答错才扣的）
 */
function isPerfectRound(r) {
    return !!r.finished && !(r.wrongGuesses || []).length
        && !(r.hintsUsed || 0) && !(r.revives || 0);
}

/**
 * 结束面板的数。连续天数按「做过这天的题」算（有作答记录即算），从这道题的日期往回数；
 * 排行榜只排已结束、而且带 finishedAt 的局 —— 10-30 之前的记录没有这个字段，那之前的日期没有榜
 */
async function crossSummary(openid, mode, date, rec) {
    const mine = [];
    for (let skip = 0; ; skip += 100) {
        const res = await db.collection(RECORD_COLLECTION).where({ openid: openid, mode: mode })
            .field({ date: true, finished: true, lives: true, wrongGuesses: true, hintsUsed: true, revives: true })
            .skip(skip).limit(100).get();
        const rows = (res && res.data) || [];
        mine.push.apply(mine, rows);
        if (rows.length < 100) break;
    }
    const days = new Set(mine.map(r => r.date));
    let streak = 0;
    for (let d = date; days.has(d); d = cnDateStr(Date.parse(d + 'T00:00:00Z') - CN_TZ_OFFSET_MS - 86400000)) streak++;

    const done = { mode: mode, date: date, finished: true, finishedAt: _.gt(new Date(0)) };
    const coll = db.collection(RECORD_COLLECTION);
    const res = await Promise.all([
        coll.where(done).orderBy('score', 'desc').orderBy('finishedAt', 'asc')
            .field({ openid: true, score: true, finishedAt: true }).limit(RANK_TOP).get(),
        coll.where(done).count()
    ]);
    const topRows = (res[0] && res[0].data) || [];
    const profiles = await profilesOf(topRows.map(r => r.openid).concat([openid]));
    const nameOf = id => (profiles.get(id) && profiles.get(id).name) || playerName(id || '');
    const avatarOf = id => (profiles.get(id) && profiles.get(id).avatar) || '';
    const top = topRows.map((r, i) => ({
        rank: i + 1, name: nameOf(r.openid), avatar: avatarOf(r.openid), score: r.score || 0,
        time: cnClock(r.finishedAt), me: r.openid === openid
    }));
    // 名次只给前 10 名：不在榜上的人只显示「未上榜」，不报具体第几名（10-30 定）
    const idx = top.findIndex(x => x.me);
    const myRank = idx >= 0 ? idx + 1 : null;

    // 用时：累计的前台作答时长（见 addActive）。部署前做完的局没有这个数
    let seconds = null;
    if (rec.finished) {
        try {
            const o = oneDoc(await db.collection(OPEN_COLLECTION).doc(openid + '_' + mode + '_' + date).get());
            if (o && typeof o.activeSeconds === 'number' && o.activeSeconds > 0) seconds = o.activeSeconds;
        } catch (e) { /* 没有打开记录 */ }
    }

    return {
        streak: streak,
        totalDays: days.size,
        perfectDays: mine.filter(isPerfectRound).length,
        seconds: seconds,
        rank: {
            total: res[1].total,
            myRank: myRank,           // 前 10 名之内才有，否则 null（前端显示「未上榜」）
            // 没进前 10 时，榜单末尾补一行「我 · 未上榜」要用的头像
            meAvatar: avatarOf(openid),
            top: top
        }
    };
}

/** 记一笔「第一次打开这道题」。add 带固定 _id，已经有了就会抛错 —— 正好就是「只记第一次」 */
async function logOpen(openid, mode, date) {
    const id = openid + '_' + mode + '_' + date;
    const doc = { _id: id, openid: openid, mode: mode, date: date, firstAt: db.serverDate(), activeSeconds: 0 };
    try {
        await db.collection(OPEN_COLLECTION).add({ data: doc });
        return 0;
    } catch (e) {
        // 集合还没建：建一次再写
        if (/not exist|不存在/i.test(String(e && (e.errMsg || e.message)))) {
            try {
                await db.createCollection(OPEN_COLLECTION);
                await db.collection(OPEN_COLLECTION).add({ data: doc });
            } catch (e2) { /* 算了 */ }
            return 0;
        }
    }
    // 已经有这条：把累计用时读回去，页面上的计时器接着走
    try {
        const o = oneDoc(await db.collection(OPEN_COLLECTION).doc(id).get());
        return (o && Number(o.activeSeconds)) || 0;
    } catch (e) {
        return 0;
    }
}

/**
 * 累计作答用时：只算填字页停在前台、这一局还没结束的时间（前端掐表，切后台 / 看激励视频时暂停）。
 * 每次作答、求提示、复活带上 activeDelta，切后台时单独报一次（action:'tick'）。
 * 用时不参与排名，只在结束面板和成绩卡上显示，所以不防伪造；单次封顶 1 小时，免得一次异常把数撑爆
 */
async function addActive(openid, mode, date, delta) {
    const d = Math.min(3600, Math.max(0, Math.round(Number(delta) || 0)));
    if (!d) return;
    const id = openid + '_' + mode + '_' + date;
    try {
        await db.collection(OPEN_COLLECTION).doc(id).update({ data: { activeSeconds: _.inc(d) } });
    } catch (e) {
        // 没有打开记录（部署前就打开着的页面）：补一条
        try {
            await db.collection(OPEN_COLLECTION).add({ data: { _id: id, openid: openid, mode: mode, date: date, firstAt: db.serverDate(), activeSeconds: d } });
        } catch (e2) { /* 算了，少记一段 */ }
    }
}

/** 正则元字符转义：片名里带 ()、+、. 的非常多（《这个杀手不太冷》还好，《V字仇杀队》《007》就会出事） */
function escapeRe(s) {
    return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 归一化：去掉空格和常见标点，大小写统一。用户手输的片名和库里的写法差一个空格是常事 */
function normalize(s) {
    return String(s || '').toLowerCase().replace(/[\s·・\-–—.,:;'"!！?？()（）《》【】\[\]]/g, '');
}

/**
 * 把玩家输入的片名解析成片库里的一部电影。
 * 三级：精确 → 全名正则（忽略大小写）→ 包含。命中多条时取评分人数最多的那部
 * （同名片撞车时，玩家想的基本是更有名的那部）。
 */
async function resolveGuess(guessTitle) {
    const kw = String(guessTitle || '').trim();
    if (!kw) return null;

    const pick = rows => {
        if (!rows || !rows.length) return null;
        return rows.slice().sort((a, b) => (Number(b.ratingCount) || 0) - (Number(a.ratingCount) || 0))[0];
    };

    const exact = await db.collection(FACTS_COLLECTION)
        .where(_.or([{ title: kw }, { originalTitle: kw }])).limit(20).get();
    let hit = pick(exact.data);
    if (hit) return hit;

    const anchored = new db.RegExp({ regexp: '^' + escapeRe(kw) + '$', options: 'i' });
    const loose = await db.collection(FACTS_COLLECTION)
        .where(_.or([{ title: anchored }, { originalTitle: anchored }])).limit(20).get();
    hit = pick(loose.data);
    if (hit) return hit;

    const contains = new db.RegExp({ regexp: escapeRe(kw), options: 'i' });
    const partial = await db.collection(FACTS_COLLECTION)
        .where(_.or([{ title: contains }, { originalTitle: contains }])).limit(20).get();
    // 包含匹配容易误伤（输「教父」会命中《教父2》《教父3》），只在归一化后完全相等时才认
    const nk = normalize(kw);
    return pick((partial.data || []).filter(d => normalize(d.title) === nk || normalize(d.originalTitle) === nk));
}

/** 输入联想：前缀优先，其次包含 */
async function suggest(keyword) {
    const kw = String(keyword || '').trim();
    if (kw.length < 1) return [];
    const prefix = new db.RegExp({ regexp: '^' + escapeRe(kw), options: 'i' });
    const contains = new db.RegExp({ regexp: escapeRe(kw), options: 'i' });

    const seen = new Set();
    const out = [];
    const collect = rows => (rows || []).forEach(d => {
        if (seen.has(d._id) || out.length >= SUGGEST_LIMIT) return;
        seen.add(d._id);
        out.push({ id: d._id, title: d.title, year: d.year, cover: d.cover || '' });
    });

    const a = await db.collection(FACTS_COLLECTION)
        .where(_.or([{ title: prefix }, { originalTitle: prefix }]))
        .orderBy('ratingCount', 'desc').limit(SUGGEST_LIMIT)
        .field({ _id: true, title: true, year: true, cover: true, ratingCount: true }).get();
    collect(a.data);

    if (out.length < SUGGEST_LIMIT) {
        const b = await db.collection(FACTS_COLLECTION)
            .where(_.or([{ title: contains }, { originalTitle: contains }]))
            .orderBy('ratingCount', 'desc').limit(SUGGEST_LIMIT)
            .field({ _id: true, title: true, year: true, cover: true, ratingCount: true }).get();
        collect(b.data);
    }
    return out;
}

/**
 * 求提示：从这一格的正确答案里挑一部，只透露它的一个侧面。
 * 这是「线索猜片」那套逐条揭示的机制接到格子玩法里——同一格连着要提示会越给越具体。
 * 每次提示扣一次猜测机会，否则可以把九格全提示出来，题就没意义了。
 *
 * 挑哪一部用 (cellKey, level) 做确定性取模而不是随机：同一个人反复求同一格的提示，
 * 拿到的必须是同一部片的更多侧面，而不是三部不同片各一条——后者等于白送答案。
 */
function buildHint(cellAnswerFacts, cellKey, level) {
    if (!cellAnswerFacts.length) return null;
    let h = 0;
    for (let i = 0; i < cellKey.length; i++) h = (h * 31 + cellKey.charCodeAt(i)) >>> 0;
    const fact = cellAnswerFacts[h % cellAnswerFacts.length];

    const title = String(fact.title || '');
    const cn = title.match(/[一-龥]/g) || [];
    const steps = [];
    if ((fact.directors || []).length) steps.push('这一格有一部是 ' + fact.directors[0] + ' 导演的');
    if (fact.year) steps.push('其中一部上映于 ' + fact.year + ' 年');
    if (cn.length) steps.push('有一部中文片名 ' + cn.length + ' 个字，第一个字是「' + cn[0] + '」');
    if ((fact.actors || []).length) steps.push('其中一部由 ' + fact.actors[0] + ' 主演');
    if (!steps.length) return null;
    return { text: steps[Math.min(level, steps.length - 1)], exhausted: level >= steps.length - 1 };
}

/** 取（或初始化）某人在某题上的进度 */
/**
 * cross 的字段补默认值。既覆盖首次作答，也覆盖规则改动之前存下的老记录 ——
 * 老记录没有 lives/hintQuota，不补的话 lives 是 undefined，一减就成 NaN，
 * 生命值和分数会一起烂掉。
 */
function normalizeCross(rec) {
    if (rec.lives == null) rec.lives = CROSS_LIVES;
    if (rec.hintQuota == null) rec.hintQuota = CROSS_FREE_HINTS;
    if (rec.hintsUsed == null) rec.hintsUsed = 0;
    if (rec.revives == null) rec.revives = 0;
    if (rec.score == null) rec.score = CROSS_START_SCORE;
    if (!Array.isArray(rec.filled)) rec.filled = [];
    if (!Array.isArray(rec.hints)) rec.hints = [];
    return rec;
}

/**
 * 一条 entry 里玩家**已经知道**的位置集合（0 起）。两个来源：
 *   ① 之前提示揭开过的；② 与已答出的其它条交叉、那一格早就填上了。
 * 随机揭字要从这个集合之外挑 —— 否则会出现「花 5 分揭出一个早就看得见的字」。
 */
function knownPositions(entry, solvedEntries, hints) {
    const known = new Set();
    (hints || []).forEach(function (h) {
        if (h.entryNo === entry.no && typeof h.pos === 'number') known.add(h.pos);
    });
    for (let i = 0; i < entry.len; i++) {
        const r = entry.r + (entry.dir === 'V' ? i : 0);
        const c = entry.c + (entry.dir === 'H' ? i : 0);
        const covered = solvedEntries.some(function (o) {
            for (let k = 0; k < o.len; k++) {
                const or = o.r + (o.dir === 'V' ? k : 0);
                const oc = o.c + (o.dir === 'H' ? k : 0);
                if (or === r && oc === c) return true;
            }
            return false;
        });
        if (covered) known.add(i);
    }
    return known;
}

async function loadRecord(openid, mode, date) {
    const id = openid + '_' + mode + '_' + date;
    try {
        const rec = oneDoc(await db.collection(RECORD_COLLECTION).doc(id).get());
        if (rec) return mode === 'cross' ? normalizeCross(rec) : rec;
    } catch (e) { /* 首次作答 */ }
    const fresh = {
        _id: id, openid, mode, date,
        guessesUsed: 0, filled: [], wrongGuesses: [], hints: [],
        score: mode === 'cross' ? CROSS_START_SCORE : 0,
        finished: false
    };
    return mode === 'cross' ? normalizeCross(fresh) : fresh;
}

async function saveRecord(rec) {
    const { _id, ...data } = rec;
    // 时间戳：排行榜「同分比谁先做完」、用时，都靠这三个。
    // finishedAt 只在「结束」那一刻写：复活会把 finished 改回 false 并清掉它（见 revive），
    // 之后再做完就重新记，所以它总是最后一次做完的时间
    const now = db.serverDate();
    if (!data.createdAt) data.createdAt = now;
    data.updatedAt = now;
    if (data.finished && !data.finishedAt) data.finishedAt = now;
    try { await db.createCollection(RECORD_COLLECTION); } catch (e) { /* 已存在 */ }
    await db.collection(RECORD_COLLECTION).doc(_id).set({ data });
}

/**
 * 冷门加分。
 * 理想口径是「多少比例的玩家也选了这部」——那要有作答分布，第一天没有。
 * 所以用评分人数在本格候选里的相对位置做代理：本格里最没人看过的那部得满分。
 * 等 guess_stats 攒够样本再切到真实分布（cell.picks 已经在累计了）。
 */
function rarityScore(fact, cellFacts) {
    const mine = Number(fact.ratingCount) || 0;
    const rarer = cellFacts.filter(f => (Number(f.ratingCount) || 0) < mine).length;
    const rarity = cellFacts.length > 1 ? rarer / (cellFacts.length - 1) : 0.5;
    return Math.round(60 + 40 * rarity);
}

/** 累计作答分布（用于后续把冷门加分换成真实口径），失败不影响主流程 */
async function bumpStats(mode, date, cellKey, factId) {
    const id = mode + '_' + date;
    try { await db.createCollection(STATS_COLLECTION); } catch (e) { /* 已存在 */ }
    const field = 'picks.' + cellKey + '.' + factId;
    try {
        await db.collection(STATS_COLLECTION).doc(id).update({ data: { [field]: _.inc(1) } });
    } catch (e) {
        try {
            await db.collection(STATS_COLLECTION).doc(id).set({
                data: { mode, date, picks: { [cellKey]: { [factId]: 1 } } }
            });
        } catch (e2) {
            console.warn('[submitGuess] 统计写入失败（不影响作答）:', e2 && e2.message);
        }
    }
}

exports.main = async (event) => {
    const ev = event || {};
    const openid = (cloud.getWXContext() || {}).OPENID || '';
    const action = ev.action || 'answer';

    try {
        if (action === 'suggest') {
            return { success: true, candidates: await suggest(ev.keyword) };
        }

        // 参与人数。放在 openid 校验之前：这是个公开读数，不认人也不写库。
        // guess_records 是「每人每局一条」(openid+mode+date)，所以先按 (mode, openid) 去重
        // 再按 mode 计数——同一个人玩了多少天都只算一个人。
        // **必须在服务端算**：这张表是各人自己的进度，小程序端直接聚合受集合读权限限制，
        // 拿回来的很可能只有调用者自己那几条。
        if (action === 'players') {
            try {
                const $ = db.command.aggregate;
                const res = await db.collection(RECORD_COLLECTION).aggregate()
                    .match({ fake: _.neq(true) })   // 测排行榜塞的假玩家不算参与人数
                    .group({ _id: { mode: '$mode', openid: '$openid' } })
                    .group({ _id: '$_id.mode', total: $.sum(1) })
                    .end();
                const players = {};
                (res.list || []).forEach(function (r) { players[r._id] = r.total; });
                // { detail: true } 只给控制台排查用：拆出「玩过的人 / 通关过的人 / 总局数」，
                // 用来核对 players 到底是哪个口径（前端不传这个开关，返回结构不受影响）
                if (ev.detail === true) {
                    const fin = await db.collection(RECORD_COLLECTION).aggregate()
                        .match({ finished: true })
                        .group({ _id: { mode: '$mode', openid: '$openid' } })
                        .group({ _id: '$_id.mode', total: $.sum(1) })
                        .end();
                    const rounds = await db.collection(RECORD_COLLECTION).aggregate()
                        .group({ _id: '$mode', total: $.sum(1) })
                        .end();
                    const pick = function (list) {
                        const o = {};
                        (list || []).forEach(function (r) { o[r._id] = r.total; });
                        return o;
                    };
                    return {
                        success: true, players,
                        detail: { finishedPlayers: pick(fin.list), rounds: pick(rounds.list) }
                    };
                }
                return { success: true, players };
            } catch (e) {
                // 集合还没建（一个人都没玩过）也会走到这儿。给空表，前端自己降级成不显示人数
                console.warn('[submitGuess] 参与人数统计失败:', e && (e.errMsg || e.message));
                return { success: true, players: {} };
            }
        }

        const mode = (ev.mode === 'clue' || ev.mode === 'cross') ? ev.mode : 'grid';
        // 只有 grid/clue 还用「机会数」这套；cross 改成了生命值，走自己那一套判定
        const date = /^\d{4}-\d{2}-\d{2}$/.test(ev.date || '') ? ev.date : cnDateStr();

        // —— 测排行榜用的假玩家（只能在云函数控制台跑：控制台调用没有 OPENID，小程序里调不到）。
        //   { action:'seedRank', mode:'cross', date:'2026-10-28', count:25 }  —— 往这天塞 count 个假玩家
        //   { ..., patchOpenid:'o_xxx' }  —— 顺手给这个人这天已做完的记录补上 finishedAt（老记录没有，进不了榜）
        //   { action:'seedRank', mode:'cross', date:'2026-10-28', clear:true } —— 删掉这天的假玩家
        // 假记录带 fake:true、openid 以 fake_ 开头；analyzeGuess 会跳过它们。测完记得 clear
        if (action === 'seedRank') {
            if (openid) return { success: false, error: '只能在云函数控制台跑' };
            if (mode !== 'cross') return { success: false, error: '只有填字有排行榜' };
            if (!/^\d{4}-\d{2}-\d{2}$/.test(ev.date || '')) return { success: false, error: '要写明 date，别往今天塞' };
            if (ev.clear === true) {
                const r = await db.collection(RECORD_COLLECTION).where({ fake: true, mode: mode, date: date }).remove();
                return { success: true, removed: (r && r.stats && r.stats.removed) || 0 };
            }
            const p = oneDoc(await db.collection(PUZZLE_COLLECTION).doc(mode + '_' + date).get().catch(() => null));
            if (!p) return { success: false, error: '这天没有题' };
            const n = (p.entries || []).length;
            const count = Math.max(1, Math.min(Number(ev.count) || 25, 60));
            const base = Date.parse(date + 'T00:00:00Z') - CN_TZ_OFFSET_MS + 7 * 3600000;   // 北京 07:00 起
            const rows = [];
            for (let i = 0; i < count; i++) {
                // 分数：前几名满分（看同分按时间排），往后逐渐有错 / 用提示，最后几个 ♥ 用完
                const wrong = i < 4 ? 0 : Math.min(3, Math.floor(i / 6));
                const hints = i % 5 === 3 ? 1 : 0;
                const dead = i >= count - 2;
                const solved = dead ? Math.max(1, n - 3) : n;
                const start = base + i * 23 * 60000;
                rows.push({
                    _id: 'fake_' + i + '_' + mode + '_' + date,
                    openid: 'fake_' + i, mode: mode, date: date, fake: true,
                    filled: Array.from({ length: solved }, (_v, k) => k + 1),
                    wrongGuesses: Array.from({ length: dead ? 3 : wrong }, () => ({ entryNo: n, text: '假' })),
                    hints: [], hintsUsed: hints, hintQuota: CROSS_FREE_HINTS, revives: 0,
                    lives: dead ? 0 : CROSS_LIVES - wrong, finished: true,
                    score: CROSS_START_SCORE + solved * SCORE_CORRECT + (dead ? 3 : wrong) * SCORE_WRONG + hints * SCORE_HINT,
                    createdAt: new Date(start),
                    updatedAt: new Date(start + (5 + i % 7) * 60000),
                    finishedAt: new Date(start + (5 + i % 7) * 60000)
                });
            }
            for (let i = 0; i < rows.length; i += 20) {
                await Promise.all(rows.slice(i, i + 20).map(r => {
                    const { _id, ...data } = r;
                    return db.collection(RECORD_COLLECTION).doc(_id).set({ data: data });
                }));
            }
            let patched = 0;
            if (ev.patchOpenid) {
                const id = String(ev.patchOpenid) + '_' + mode + '_' + date;
                const mine = oneDoc(await db.collection(RECORD_COLLECTION).doc(id).get().catch(() => null));
                if (mine && mine.finished && !mine.finishedAt) {
                    await db.collection(RECORD_COLLECTION).doc(id).update({ data: { finishedAt: db.serverDate() } });
                    patched = 1;
                }
            }
            return { success: true, seeded: rows.length, patched: patched, note: '测完用 clear:true 删掉' };
        }

        // 这句会原样弹给用户，别写成开发者口吻
        if (!openid) return { success: false, error: '没能识别身份，退出重进试试' };

        const rec = await loadRecord(openid, mode, date);

        // 作答用时：作答 / 求提示 / 复活 / 切后台都会带上这段前台时长。这一局已经结束的不再记
        // （结束后前端也不再计时；复活那一下带的是看完结束面板之前的零头，同样不记）
        if (mode === 'cross' && ev.activeDelta && !rec.finished) {
            await addActive(openid, mode, date, ev.activeDelta);
        }
        if (action === 'tick') return { success: true };

        // —— 首页「每日电影填词」卡片：今天几个人在玩 + 我今天的进度 + 连续天数 + 进没进前 10。
        // 首页每次进来都调，所以只做几条轻查询（一次计数、我最近 60 天的记录、前 10 名），不读头像昵称
        if (action === 'hubCard') {
            if (mode !== 'cross') return { success: false, error: '只有填字有首页卡片' };
            const coll = db.collection(RECORD_COLLECTION);
            const since = cnDateStr(Date.parse(date + 'T00:00:00Z') - CN_TZ_OFFSET_MS - 60 * 86400000);
            const res = await Promise.all([
                coll.where({ mode: mode, date: date, fake: _.neq(true) }).count(),
                coll.where({ openid: openid, mode: mode, date: _.gte(since).and(_.lte(date)) })
                    .field({ date: true }).limit(100).get(),
                coll.where({ mode: mode, date: date, finished: true, finishedAt: _.gt(new Date(0)) })
                    .orderBy('score', 'desc').orderBy('finishedAt', 'asc').field({ openid: true }).limit(RANK_TOP).get(),
                db.collection(PUZZLE_COLLECTION).doc(mode + '_' + date).get().catch(() => null)
            ]);
            const puzzle = oneDoc(res[3]);
            const days = new Set(((res[1] && res[1].data) || []).map(r => r.date));
            let streak = 0;
            for (let d = date; days.has(d); d = cnDateStr(Date.parse(d + 'T00:00:00Z') - CN_TZ_OFFSET_MS - 86400000)) streak++;
            // 今天还没玩时，连续天数从昨天往回数（今天玩了就接上）
            if (!streak) {
                for (let d = cnDateStr(Date.parse(date + 'T00:00:00Z') - CN_TZ_OFFSET_MS - 86400000); days.has(d);
                    d = cnDateStr(Date.parse(d + 'T00:00:00Z') - CN_TZ_OFFSET_MS - 86400000)) streak++;
            }
            const total = ((puzzle && puzzle.entries) || []).length;
            const solved = (rec.filled || []).length;
            const played = !!(rec.createdAt || solved || (rec.wrongGuesses || []).length || (rec.hints || []).length);
            const idx = ((res[2] && res[2].data) || []).findIndex(r => r.openid === openid);
            return {
                success: true, date: date,
                players: (res[0] && res[0].total) || 0,
                // none 还没开始 / playing 做到一半 / done 做完了
                status: rec.finished ? 'done' : (played ? 'playing' : 'none'),
                solved: solved, total: total,
                grade: !rec.finished ? '' : (solved < total ? 'dead' : (isPerfectRound(rec) ? 'perfect' : 'clear')),
                rank: idx >= 0 ? idx + 1 : null,
                streak: streak
            };
        }

        if (action === 'summary') {
            if (mode !== 'cross') return { success: false, error: '只有填字有结束面板' };
            return Object.assign({ success: true }, await crossSummary(openid, mode, date, rec));
        }

        if (action === 'state') {
            if (mode === 'cross') {
                // 打开即记（只记第一次），顺便把累计的作答用时带回去，页面计时器从这里接着走
                const activeSeconds = await logOpen(openid, mode, date);
                // 断线重连要能把已答出的条目重新填回格子，所以 state 得连字一起给回来
                let p = null;
                try { p = oneDoc(await db.collection(PUZZLE_COLLECTION).doc(mode + '_' + date).get()); } catch (e) { /* 还没出题 */ }
                const done = (rec.filled || []).map(Number);
                const solved = ((p && p.entries) || [])
                    .filter(function (e) { return done.indexOf(e.no) >= 0; })
                    .map(function (e) { return { no: e.no, r: e.r, c: e.c, dir: e.dir, len: e.len, word: e.word }; });
                // 揭过的字也要带回去，否则退出重进后花掉的提示就白花了
                const revealedCells = (rec.hints || [])
                    .filter(function (h) { return typeof h.pos === 'number'; })
                    .map(function (h) {
                        const en = ((p && p.entries) || []).find(function (x) { return x.no === h.entryNo; });
                        if (!en) return null;
                        return {
                            entryNo: h.entryNo, ch: h.ch,
                            r: en.r + (en.dir === 'V' ? h.pos : 0),
                            c: en.c + (en.dir === 'H' ? h.pos : 0)
                        };
                    })
                    .filter(Boolean);
                const allEntries = (p && p.entries) || [];
                return {
                    success: true, record: rec, solved: solved, revealed: revealedCells,
                    answers: rec.finished
                        ? allEntries.map(function (x) { return { no: x.no, word: x.word, year: x.year }; })
                        : null,
                    activeSeconds: activeSeconds,
                    lives: rec.lives, maxLives: CROSS_LIVES,
                    hintsLeft: Math.max(0, (rec.hintQuota || 0) - (rec.hintsUsed || 0)),
                    canBuyHint: true,
                    canRevive: (rec.lives || 0) < CROSS_LIVES
                };
            }
            return { success: true, record: rec, maxGuesses: MAX_GUESSES };
        }

        // —— 作答
        // cross 有自己的结束判定（生命值），而且结束之后还要能调 revive，
        // 所以不走这条通用早退
        if (mode !== 'cross' && (rec.finished || rec.guessesUsed >= MAX_GUESSES)) {
            return { success: true, finished: true, record: rec, reason: 'NO_GUESSES_LEFT' };
        }

        let puzzle;
        try {
            puzzle = oneDoc(await db.collection(PUZZLE_COLLECTION).doc(mode + '_' + date).get());
        } catch (e) { /* below */ }
        if (!puzzle) return { success: false, error: '这天的题还没准备好，稍后再试' };

        // ====================================================================
        // 纵横填字：计分 / 生命值 / 提示次数
        //
        // 计分：答对 +20、答错 −10、用一次提示 −5，初始 0。5 条一次做对 = 满分 100。
        //
        // **全部状态只认服务端这份记录**（openid+mode+date 一天一条，答完即锁）。
        // 这既是防作弊的根本，也是「多次尝试试出答案再一次性填对刷分」这条路走不通的原因：
        // 同一天没有第二次机会，而当天的尝试次数被生命值卡死。
        //
        // 生命值 3 颗星，答错一次扣一颗，扣完即失败。看激励视频可复活，
        // **但复活次数必须有上限** —— 不封顶的话看几次广告就能错几次，
        // 三条命的反作弊作用会被完全抹掉。提示同理，无限提示等于白给答案。
        // ====================================================================
        if (mode === 'cross') {
            const entries = puzzle.entries || [];
            const solvedNos = (rec.filled || []).map(Number);
            const hintsLeft = Math.max(0, (rec.hintQuota || 0) - (rec.hintsUsed || 0));
            const viewOf = function (e) {
                return { no: e.no, r: e.r, c: e.c, dir: e.dir, len: e.len, word: e.word };
            };
            const wrap = function (extra) {
                // 一局已经结束就把五条答案都给出来：填字做完（或做砸）之后，
                // 玩家最想看的就是「到底是哪五部片」。这不构成泄题 —— 当天这份记录
                // 已经锁死，看到答案也换不回分数。
                const answers = rec.finished
                    ? entries.map(function (x) { return { no: x.no, word: x.word, year: x.year }; })
                    : null;
                return Object.assign({
                    answers: answers,
                    success: true,
                    record: rec,
                    lives: rec.lives,
                    maxLives: CROSS_LIVES,
                    hintsLeft: Math.max(0, (rec.hintQuota || 0) - (rec.hintsUsed || 0)),
                    canBuyHint: true,
                    // 复活不限次；生命值满的时候没必要复活，也就没必要显示入口
                    canRevive: (rec.lives || 0) < CROSS_LIVES
                }, extra || {});
            };

            // —— 看完激励视频换一次提示机会。
            // 广告是否真的看完只有客户端知道（本项目没有服务端回调）。不设次数上限，
            // 因为多换几次也只是让人更快撞上单条那两道闸，且每揭一次实打实扣 5 分。
            if (action === 'grantHint') {
                // 不限次数；能不能真的揭出字由单条那两道闸决定
                rec.hintQuota = (rec.hintQuota || 0) + 1;
                await saveRecord(rec);
                return wrap({ granted: true });
            }

            // —— 看完激励视频复活一颗星
            if (action === 'revive') {
                // 不限次数。revives 仍然累计，只用来看「一局要复活几次」这类分布。
                if ((rec.lives || 0) >= CROSS_LIVES) {
                    return wrap({ revived: false, error: '爱心已经是满的' });
                }
                rec.lives = (rec.lives || 0) + 1;
                rec.revives = (rec.revives || 0) + 1;
                // 因为没命而结束的那局可以继续；已经答完的那局不会被复活「解锁」
                if (rec.finished && solvedNos.length < entries.length) {
                    rec.finished = false;
                    rec.finishedAt = null;   // 接着做完时重新记（排行榜看的是最后一次做完的时间）
                }
                await saveRecord(rec);
                return wrap({ revived: true });
            }

            if (rec.finished) {
                return wrap({
                    finished: true,
                    reason: (rec.lives || 0) <= 0 ? 'NO_LIVES' : 'ALL_SOLVED'
                });
            }

            if (action === 'hint') {
                const e = entries.find(function (x) { return x.no === Number(ev.entryNo); });
                if (!e) return { success: false, error: '没有第 ' + ev.entryNo + ' 条' };
                if (solvedNos.indexOf(e.no) >= 0) return { success: false, error: '这条已经答出来了' };
                if (hintsLeft <= 0) {
                    return wrap({ hinted: false, needAd: true, error: '提示用完了' });
                }
                // **随机揭一个玩家还不知道的字**，而不是从头顺着揭。
                // 顺着揭有两个毛病：第 n 个位置很可能已经被交叉的另一条填好了，
                // 5 分换来一个早就看得见的字；而且前缀效应太强 ——《柏林苍穹下》
                // 揭两次就是「柏林」，基本等于送答案。
                // （早先注释里「换位置揭会让求两次凑出大半个片名」是错的：
                //   揭两个字就是两个字，位置在哪信息量一样。）
                const solvedEntries = entries.filter(function (x) { return solvedNos.indexOf(x.no) >= 0; });
                const known = knownPositions(e, solvedEntries, rec.hints);
                const candidates = [];
                for (let i = 0; i < e.len; i++) if (!known.has(i)) candidates.push(i);

                // 两道闸，都是为了别让提示变成「白给答案」：
                // ① 揭完之后至少还要剩 2 个字不知道。只剩 1 个未知时那个字根本不用猜 ——
                //    四个字揭掉三个等于把答案念出来。candidates 已经排除了交叉格带来的
                //    已知位，所以这道闸是按**真实未知数**算的，不是按提示次数算的。
                // ② 单条最多揭一半，长片名不能靠连揭把自己揭穿。
                const usedOnEntry = (rec.hints || []).filter(function (h) { return h.entryNo === e.no; }).length;
                if (candidates.length < 3) {
                    return wrap({ hinted: false, error: '这条只剩两个字没揭开，不能再提示了' });
                }
                if (usedOnEntry >= Math.floor(e.len / 2)) {
                    return wrap({ hinted: false, error: '一条最多揭一半，这条揭不动了' });
                }

                const pos = candidates[Math.floor(Math.random() * candidates.length)];
                const ch = e.word[pos];
                rec.hints = (rec.hints || []).concat([{ entryNo: e.no, pos: pos, ch: ch }]);
                rec.hintsUsed = (rec.hintsUsed || 0) + 1;
                rec.score = (rec.score || 0) + SCORE_HINT;
                await saveRecord(rec);
                return wrap({
                    hinted: true,
                    hint: {
                        entryNo: e.no, pos: pos, ch: ch,
                        r: e.r + (e.dir === 'V' ? pos : 0),
                        c: e.c + (e.dir === 'H' ? pos : 0)
                    }
                });
            }

            // —— 作答：提交一整条
            const e = entries.find(function (x) { return x.no === Number(ev.entryNo); });
            if (!e) return { success: false, error: '没有第 ' + ev.entryNo + ' 条' };
            if (solvedNos.indexOf(e.no) >= 0) {
                return wrap({ correct: true, already: true, entry: viewOf(e) });
            }
            const submitted = Array.isArray(ev.chars) ? ev.chars.join('') : String(ev.chars || '');
            if (!submitted) return { success: false, error: '没有提交内容' };

            if (submitted !== e.word) {
                rec.lives = Math.max(0, (rec.lives || 0) - 1);
                rec.score = (rec.score || 0) + SCORE_WRONG;
                rec.wrongGuesses = (rec.wrongGuesses || []).concat([{ entryNo: e.no, text: submitted }]);
                rec.finished = rec.lives <= 0;
                await saveRecord(rec);
                return wrap({ correct: false, finished: rec.finished, reason: rec.finished ? 'NO_LIVES' : '' });
            }

            rec.filled = (rec.filled || []).concat([e.no]);
            rec.score = (rec.score || 0) + SCORE_CORRECT;
            rec.finished = rec.filled.length >= entries.length;
            await saveRecord(rec);
            await bumpStats(mode, date, 'entry' + e.no, e.id);
            // 老的 puzzle 文档没存 movieIds（加这个字段之前备的题），回查兜一下
            let movieIds = e.movieIds || [];
            if (!movieIds.length) {
                const fct = oneDoc(await db.collection(FACTS_COLLECTION).doc(String(e.id)).get().catch(function () { return null; }));
                movieIds = (fct && fct.movieIds) || [];
            }
            return wrap({
                correct: true,
                entry: viewOf(e),
                movieId: e.id, movieIds: movieIds,
                allSolved: rec.finished
            });
        }

        // —— 求提示（只有格子玩法有；线索玩法本身就是逐条给线索）
        if (action === 'hint') {
            if (mode !== 'grid') return { success: false, error: '线索玩法不需要求提示' };
            const r = Number(ev.r), c = Number(ev.c);
            const cell = (puzzle.cells || []).find(x => x.r === r && x.c === c);
            if (!cell) return { success: false, error: '格子坐标不对：r=' + ev.r + ' c=' + ev.c };
            const cellKey = r + '_' + c;
            if ((rec.filled || []).some(f => f.cellKey === cellKey)) {
                return { success: true, alreadyFilled: true, costGuess: false, record: rec };
            }
            const level = (rec.hints || []).filter(h => h.cellKey === cellKey).length;
            const answers = await db.collection(FACTS_COLLECTION)
                .where({ _id: _.in(cell.answerIds) })
                .field({ _id: true, title: true, year: true, directors: true, actors: true })
                .limit(200).get();
            const hint = buildHint(answers.data || [], cellKey, level);
            if (!hint) return { success: false, error: '这一格给不出更多提示了' };

            rec.guessesUsed = (rec.guessesUsed || 0) + 1;
            rec.hints = (rec.hints || []).concat([{ cellKey, level, text: hint.text }]);
            rec.finished = (rec.filled || []).length >= 9 || rec.guessesUsed >= MAX_GUESSES;
            await saveRecord(rec);
            return { success: true, hint: hint.text, exhausted: hint.exhausted, costGuess: true, record: rec, maxGuesses: MAX_GUESSES };
        }

        const fact = ev.guessId
            ? oneDoc(await db.collection(FACTS_COLLECTION).doc(String(ev.guessId)).get().catch(() => null))
            : await resolveGuess(ev.guessTitle);

        if (!fact) {
            // 猜了一部片库里没有的电影：不扣机会——本玩法明确限定「答案须在标记吧片库内」，
            // 因为库外的片我们没有演员/类型数据，判不了对错。让它白扣机会是不讲道理的。
            return { success: true, resolved: false, costGuess: false, record: rec,
                     message: '这部还不在标记吧片库里，换一部试试' };
        }

        let correct = false, gained = 0, cellKey = '';

        if (mode === 'grid') {
            const r = Number(ev.r), c = Number(ev.c);
            const cell = (puzzle.cells || []).find(x => x.r === r && x.c === c);
            if (!cell) return { success: false, error: '格子坐标不对：r=' + ev.r + ' c=' + ev.c };
            cellKey = r + '_' + c;
            if ((rec.filled || []).some(f => f.cellKey === cellKey)) {
                return { success: true, alreadyFilled: true, costGuess: false, record: rec };
            }
            correct = (cell.answerIds || []).indexOf(fact._id) >= 0;
            if (correct) {
                // 冷门加分要拿本格全部候选的评分人数，只读这几十条，成本可控
                const cellFacts = await db.collection(FACTS_COLLECTION)
                    .where({ _id: _.in(cell.answerIds) })
                    .field({ _id: true, ratingCount: true }).limit(200).get();
                gained = rarityScore(fact, cellFacts.data || []);
            }
        } else {
            cellKey = 'answer';
            correct = String(fact._id) === String(puzzle.answerId);
            if (correct) {
                // 线索题：用得越少线索分越高（9 次机会用掉 n 次，剩下的就是分）
                gained = Math.max(20, 100 - rec.guessesUsed * 10);
            }
        }

        rec.guessesUsed = (rec.guessesUsed || 0) + 1;
        if (correct) {
            rec.filled = (rec.filled || []).concat([{
                cellKey, factId: fact._id, title: fact.title, year: fact.year,
                cover: fact.cover || '', score: gained
            }]);
            rec.score = (rec.score || 0) + gained;
            await bumpStats(mode, date, cellKey, fact._id);
        } else {
            // 带上第几次猜：同一部片可能被猜两次（不同格子），factId 当不了 wx:key
            rec.wrongGuesses = (rec.wrongGuesses || []).concat([
                { n: rec.guessesUsed, cellKey, factId: fact._id, title: fact.title }
            ]);
        }

        const totalCells = mode === 'grid' ? 9 : 1;
        rec.finished = rec.filled.length >= totalCells || rec.guessesUsed >= MAX_GUESSES;
        await saveRecord(rec);

        return {
            success: true,
            resolved: true,
            correct,
            gained,
            movie: { id: fact._id, title: fact.title, year: fact.year, cover: fact.cover || '' },
            // 答对了前端可以顺手提供「标记为看过」：movieIds 是这部片在各榜单里的文档 id，
            // 直接交给 batchUpdateMarks 就能把所有榜单一起点亮
            movieIds: correct ? (fact.movieIds || []) : [],
            record: rec,
            maxGuesses: MAX_GUESSES,
            // 线索题答完（对了或用光机会）才把答案给前端
            answer: (mode === 'clue' && rec.finished)
                ? { title: puzzle.answerTitle, year: puzzle.answerYear, cover: puzzle.answerCover }
                : null
        };
    } catch (e) {
        console.error('[submitGuess] 失败:', e && (e.errMsg || e.message));
        return { success: false, error: (e && (e.errMsg || e.message)) || String(e) };
    }
};
