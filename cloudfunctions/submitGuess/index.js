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
//
// 集合：
//   guess_records  _id = `${openid}_${mode}_${date}` —— 每人每题一份进度
//   guess_stats    _id = `${mode}_${date}` —— 全体作答分布，用来算「冷门加分」

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

const FACTS_COLLECTION = 'movie_facts';
const PUZZLE_COLLECTION = 'guess_puzzles';
const RECORD_COLLECTION = 'guess_records';
const STATS_COLLECTION = 'guess_stats';

const CN_TZ_OFFSET_MS = 8 * 60 * 60 * 1000;
const MAX_GUESSES = 9;          // 与 moviegrid 一致：一局 9 次机会
// 填字给宽一点：一局要答出 5 条，且求提示同样扣机会，9 次会让「卡在一条上」直接终局。
// —— 填字的规则常数（和另外两个玩法完全不共用）
const CROSS_LIVES = 3;          // 生命值：答错一次扣一颗，扣完失败
const CROSS_FREE_HINTS = 2;     // 每天免费提示次数
// 提示/复活的上限是**反作弊的一部分**，不是运营参数：看广告能换次数，
// 不封顶的话看几次广告就能错几次、揭几个字，三条命就形同虚设。
const CROSS_MAX_HINTS = 5;      // 含免费的，看广告最多再换 3 次
const CROSS_MAX_REVIVES = 2;    // 复活上限，即一天最多错 5 次
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

        const mode = (ev.mode === 'clue' || ev.mode === 'cross') ? ev.mode : 'grid';
        // 只有 grid/clue 还用「机会数」这套；cross 改成了生命值，走自己那一套判定
        const date = /^\d{4}-\d{2}-\d{2}$/.test(ev.date || '') ? ev.date : cnDateStr();
        if (!openid) return { success: false, error: '没有拿到 openid' };

        const rec = await loadRecord(openid, mode, date);

        if (action === 'state') {
            if (mode === 'cross') {
                // 断线重连要能把已答出的条目重新填回格子，所以 state 得连字一起给回来
                let p = null;
                try { p = oneDoc(await db.collection(PUZZLE_COLLECTION).doc(mode + '_' + date).get()); } catch (e) { /* 还没出题 */ }
                const done = (rec.filled || []).map(Number);
                const solved = ((p && p.entries) || [])
                    .filter(function (e) { return done.indexOf(e.no) >= 0; })
                    .map(function (e) { return { no: e.no, r: e.r, c: e.c, dir: e.dir, len: e.len, word: e.word }; });
                return {
                    success: true, record: rec, solved: solved,
                    lives: rec.lives, maxLives: CROSS_LIVES,
                    hintsLeft: Math.max(0, (rec.hintQuota || 0) - (rec.hintsUsed || 0)),
                    canBuyHint: (rec.hintQuota || 0) < CROSS_MAX_HINTS,
                    canRevive: (rec.revives || 0) < CROSS_MAX_REVIVES
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
        if (!puzzle) return { success: false, error: '今天的题还没生成，先调 getGuessPuzzle' };

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
                return Object.assign({
                    success: true,
                    record: rec,
                    lives: rec.lives,
                    maxLives: CROSS_LIVES,
                    hintsLeft: Math.max(0, (rec.hintQuota || 0) - (rec.hintsUsed || 0)),
                    canBuyHint: (rec.hintQuota || 0) < CROSS_MAX_HINTS,
                    canRevive: (rec.revives || 0) < CROSS_MAX_REVIVES
                }, extra || {});
            };

            // —— 看完激励视频换一次提示机会。
            // 广告是否真的看完只有客户端知道（本项目没有服务端回调），所以这里靠上限兜底，
            // 而不是靠信任：hintQuota 最多加到 CROSS_MAX_HINTS 为止。
            if (action === 'grantHint') {
                if ((rec.hintQuota || 0) >= CROSS_MAX_HINTS) {
                    return wrap({ granted: false, error: '今天的提示次数已经用到上限了' });
                }
                rec.hintQuota = (rec.hintQuota || 0) + 1;
                await saveRecord(rec);
                return wrap({ granted: true });
            }

            // —— 看完激励视频复活一颗星
            if (action === 'revive') {
                if ((rec.revives || 0) >= CROSS_MAX_REVIVES) {
                    return wrap({ revived: false, error: '今天的复活次数已经用完了' });
                }
                if ((rec.lives || 0) >= CROSS_LIVES) {
                    return wrap({ revived: false, error: '生命值是满的，不用复活' });
                }
                rec.lives = (rec.lives || 0) + 1;
                rec.revives = (rec.revives || 0) + 1;
                // 因为没命而结束的那局可以继续；已经答完的那局不会被复活「解锁」
                if (rec.finished && solvedNos.length < entries.length) rec.finished = false;
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
                    return wrap({ hinted: false, needAd: (rec.hintQuota || 0) < CROSS_MAX_HINTS, error: '提示次数用完了' });
                }
                // 每求一次多揭一个字，从头开始揭。同一条反复求提示是逐步揭开，
                // 不是每次换个位置——后者会让「求两次」直接凑出大半个片名。
                const used = (rec.hints || []).filter(function (h) { return h.entryNo === e.no; }).length;
                if (used >= e.len - 1) {
                    return wrap({ hinted: false, error: '这条已经提示到头了，再揭就是白给答案' });
                }
                const revealed = e.word.slice(0, used + 1);
                rec.hints = (rec.hints || []).concat([{ entryNo: e.no, chars: revealed }]);
                rec.hintsUsed = (rec.hintsUsed || 0) + 1;
                rec.score = (rec.score || 0) + SCORE_HINT;
                await saveRecord(rec);
                return wrap({
                    hinted: true,
                    hint: { entryNo: e.no, r: e.r, c: e.c, dir: e.dir, chars: revealed }
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
