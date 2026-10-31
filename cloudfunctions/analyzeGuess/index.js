// 每日猜电影 · 参与数据只读分析（控制台跑，前端不调）
//
// 入参：{ mode?: 'cross', days?: 120 }   —— days 只截 byDate 那张表，其余按全量算
//       { writeFilmStats: true }          —— 另把单片实测难度写进 guess_film_stats（出题的难度预算读它）
// 出参只有聚合数字和片名，不含任何 openid。
//
// 口径上的两个先天限制（记录本身没存，事后补不回来）：
//   ① guess_records 没有时间戳，只有题目日期 date。回看前 3 天的题也记在那道题的日期上，
//      所以「某天的玩家」严格说是「做了那天那道题的人」，留存也按题目日期算。
//   ② 记录在**第一次作答/求提示**时才落库，只打开页面看了一眼的人不留痕，
//      所以这里看不到「打开 → 开始作答」这一层漏斗。

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const PAGE = 1000;
const CN_TZ_OFFSET_MS = 8 * 60 * 60 * 1000;
// 开局免费提示 2 次（submitGuess 的 CROSS_FREE_HINTS）。以后若改免费次数，记录里带上 freeHints 就能按局区分
// hintQuota 超出免费次数的部分 = 看视频换的
const FREE_HINTS_LEGACY = 2;

function cnDateStr(ms) {
    const d = new Date((ms == null ? Date.now() : ms) + CN_TZ_OFFSET_MS);
    const p = n => (n < 10 ? '0' : '') + n;
    return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate());
}

function addDays(dateStr, n) {
    return cnDateStr(Date.parse(dateStr + 'T00:00:00Z') - CN_TZ_OFFSET_MS + n * 86400000);
}

async function readAll(coll, where, fields) {
    const out = [];
    for (let skip = 0; ; skip += PAGE) {
        let q = db.collection(coll).where(where);
        if (fields) q = q.field(fields);
        const res = await q.skip(skip).limit(PAGE).get();
        const rows = (res && res.data) || [];
        out.push.apply(out, rows);
        if (rows.length < PAGE) break;
    }
    return out;
}

function hist(values, buckets) {
    // buckets: 升序上界数组，最后一档收「以上」。
    // 单值档标成「=2」而不是「2」：纯整数键会被 JS 对象排到最前，档位顺序就乱了
    const keys = buckets.map(function (b, i) {
        const lo = i === 0 ? null : buckets[i - 1];
        return lo == null ? '≤' + b : (lo + 1 === b ? '=' + b : (lo + 1) + '~' + b);
    });
    keys.push('>' + buckets[buckets.length - 1]);
    const counts = keys.map(function () { return 0; });
    values.forEach(function (v) {
        let i = buckets.findIndex(function (b) { return v <= b; });
        if (i < 0) i = buckets.length;
        counts[i]++;
    });
    const out = {};
    keys.forEach(function (k, i) { out[k] = counts[i]; });
    return out;
}

function countBy(values) {
    const o = {};
    values.forEach(function (v) { o[v] = (o[v] || 0) + 1; });
    return o;
}

/** 答出条数的计数，键写成「答出3」以免被当整数键重排。每天的条数改过（5 → 8），上界取实际最大值 */
function countSolved(values) {
    const o = {};
    const max = Math.max(5, values.reduce((m, v) => Math.max(m, v), 0));
    for (let n = 0; n <= max; n++) o['答出' + n] = 0;
    values.forEach(function (v) { const k = '答出' + v; o[k] = (o[k] || 0) + 1; });
    return o;
}

const pct = (a, b) => (b ? Math.round(a / b * 1000) / 10 : null);
const avg = (arr) => (arr.length ? Math.round(arr.reduce((s, x) => s + x, 0) / arr.length * 100) / 100 : null);

function adHintsOf(r) {
    const free = r.freeHints == null ? FREE_HINTS_LEGACY : r.freeHints;
    return Math.max(0, (r.hintQuota == null ? free : r.hintQuota) - free);
}

/** 一条记录的结局 */
function outcomeOf(r, entryCount) {
    const solved = (r.filled || []).length;
    if (solved >= entryCount && entryCount > 0) return (r.revives || 0) > 0 ? 'solvedWithRevive' : 'solvedClean';
    if (r.finished && (r.lives || 0) <= 0) return 'deadNoRevive';
    return 'leftMidway';   // 没做完也没死：中途走了（或者还在做今天的）
}

exports.main = async (event) => {
    const ev = event || {};
    const mode = ev.mode || 'cross';
    const days = Math.max(7, Math.min(Number(ev.days) || 120, 400));
    const today = cnDateStr();
    const t0 = Date.now();

    const [allRecords, puzzles] = await Promise.all([
        readAll('guess_records', { mode: mode }),
        readAll('guess_puzzles', { mode: mode }, { date: true, entries: true, createdAt: true, charPool: true, filledCells: true })
    ]);
    // 测排行榜塞的假玩家（submitGuess seedRank，fake:true）不算数
    const records = allRecords.filter(r => !r.fake);
    const puzzleByDate = new Map(puzzles.map(p => [p.date, p]));

    // —— 题库存量：今天往后还有几天的题；开服以来哪些天库里没有题
    const puzzleDates = puzzles.map(p => p.date).sort();
    const firstPuzzle = puzzleDates[0] || null;
    const stockAhead = puzzleDates.filter(d => d > today).length;
    const missingDates = [];
    if (firstPuzzle) {
        for (let d = firstPuzzle; d <= today; d = addDays(d, 1)) {
            if (!puzzleByDate.has(d)) missingDates.push(d);
            if (missingDates.length > 60) break;
        }
    }
    // createdAt 与题目日期同一天 = 当天现出题（兜底路径）出的，不是批量备的
    const sameDayGenerated = puzzles.filter(p => {
        const c = p.createdAt ? new Date(p.createdAt).getTime() : NaN;
        return !isNaN(c) && cnDateStr(c) === p.date;
    }).map(p => p.date).sort();

    // —— 按人：首玩日、玩过的天数
    const byPlayer = new Map();
    records.forEach(r => {
        if (!r.openid || !r.date) return;
        if (!byPlayer.has(r.openid)) byPlayer.set(r.openid, []);
        byPlayer.get(r.openid).push(r.date);
    });
    byPlayer.forEach(list => list.sort());
    const firstDate = new Map();
    byPlayer.forEach((list, id) => firstDate.set(id, list[0]));

    // —— 留存：按首玩日，看之后 1 / 7 天内还回来没有（按题目日期，见文件头 ①）
    let d1Base = 0, d1Hit = 0, d7Base = 0, d7Hit = 0;
    byPlayer.forEach(list => {
        const f = list[0];
        const set = new Set(list);
        if (addDays(f, 1) <= today) { d1Base++; if (set.has(addDays(f, 1))) d1Hit++; }
        if (addDays(f, 7) <= today) {
            d7Base++;
            for (let i = 1; i <= 7; i++) if (set.has(addDays(f, i))) { d7Hit++; break; }
        }
    });
    // 最长连续天数
    const streaks = [];
    byPlayer.forEach(list => {
        let best = 1, cur = 1;
        for (let i = 1; i < list.length; i++) {
            if (list[i] === addDays(list[i - 1], 1)) { cur++; best = Math.max(best, cur); } else if (list[i] !== list[i - 1]) cur = 1;
        }
        streaks.push(best);
    });

    // —— 按局
    const entryCountOf = r => {
        const p = puzzleByDate.get(r.date);
        return p && p.entries ? p.entries.length : 5;
    };
    const outcomes = records.map(r => outcomeOf(r, entryCountOf(r)));
    const solvedCounts = records.map(r => (r.filled || []).length);
    const wrongCounts = records.map(r => (r.wrongGuesses || []).length);
    const hintCounts = records.map(r => r.hintsUsed || 0);
    const adHints = records.map(adHintsOf);
    const revives = records.map(r => r.revives || 0);
    const scores = records.map(r => (typeof r.score === 'number' ? r.score : 0));

    // —— 按日期
    const dateRows = new Map();
    records.forEach((r, i) => {
        if (!dateRows.has(r.date)) dateRows.set(r.date, []);
        dateRows.get(r.date).push(i);
    });
    const byDate = Array.from(dateRows.keys()).sort().reverse().slice(0, days).map(d => {
        const idx = dateRows.get(d);
        const p = puzzleByDate.get(d);
        return {
            date: d,
            players: idx.length,
            newPlayers: idx.filter(i => firstDate.get(records[i].openid) === d).length,
            clean: idx.filter(i => outcomes[i] === 'solvedClean').length,
            withRevive: idx.filter(i => outcomes[i] === 'solvedWithRevive').length,
            dead: idx.filter(i => outcomes[i] === 'deadNoRevive').length,
            left: idx.filter(i => outcomes[i] === 'leftMidway').length,
            avgSolved: avg(idx.map(i => solvedCounts[i])),
            avgWrong: avg(idx.map(i => wrongCounts[i])),
            hints: idx.reduce((s, i) => s + hintCounts[i], 0),
            adViews: idx.reduce((s, i) => s + adHints[i] + revives[i], 0),
            words: p && p.entries ? p.entries.map(e => e.word).join('/') : '(库里无题)'
        };
    });

    // —— 按条目（每道题的每部片）：难度到底卡在哪
    const entryStats = [];
    puzzles.forEach(p => {
        const rs = (dateRows.get(p.date) || []).map(i => records[i]);
        if (!rs.length) return;
        (p.entries || []).forEach(e => {
            let solved = 0, wrong = 0, hinted = 0, touched = 0;
            const wrongTexts = [];
            rs.forEach(r => {
                const s = (r.filled || []).map(Number).indexOf(e.no) >= 0;
                const w = (r.wrongGuesses || []).filter(x => x.entryNo === e.no);
                const h = (r.hints || []).filter(x => x.entryNo === e.no).length;
                if (s) solved++;
                wrong += w.length;
                hinted += h;
                if (s || w.length || h) touched++;
                w.forEach(x => wrongTexts.push(x.text));
            });
            entryStats.push({
                date: p.date, no: e.no, word: e.word, len: e.len, dir: e.dir, id: String(e.id),
                players: rs.length, touched, solved, wrong, hinted,
                solveRate: pct(solved, rs.length),
                wrongTexts
            });
        });
    });

    // 片库热度（评分人数 / 年份）拿来对照难度
    const ids = Array.from(new Set(entryStats.map(e => e.id)));
    const facts = new Map();
    for (let i = 0; i < ids.length; i += 100) {
        const res = await db.collection('movie_facts').where({ _id: _.in(ids.slice(i, i + 100)) })
            .field({ ratingCount: true, year: true, rating: true }).limit(100).get();
        ((res && res.data) || []).forEach(f => facts.set(String(f._id), f));
    }
    entryStats.forEach(e => {
        const f = facts.get(e.id) || {};
        e.ratingCount = Number(f.ratingCount) || 0;
        e.year = Number(f.year) || null;
    });

    const groupRate = (keyFn, label) => {
        const g = new Map();
        entryStats.forEach(e => {
            const k = keyFn(e);
            if (!g.has(k)) g.set(k, { [label]: k, entries: 0, players: 0, solved: 0, wrong: 0, hinted: 0 });
            const x = g.get(k);
            x.entries++; x.players += e.players; x.solved += e.solved; x.wrong += e.wrong; x.hinted += e.hinted;
        });
        return Array.from(g.values()).sort((a, b) => (a[label] > b[label] ? 1 : -1)).map(x => ({
            [label]: x[label], entries: x.entries,
            solveRate: pct(x.solved, x.players),
            wrongPerPlayer: x.players ? Math.round(x.wrong / x.players * 100) / 100 : null,
            hintPerPlayer: x.players ? Math.round(x.hinted / x.players * 100) / 100 : null
        }));
    };
    const votesBucket = e => (e.ratingCount >= 1000000 ? 'a.100万+' : e.ratingCount >= 500000 ? 'b.50~100万'
        : e.ratingCount >= 200000 ? 'c.20~50万' : e.ratingCount >= 100000 ? 'd.10~20万' : 'e.10万以下');
    const decade = e => (e.year ? (Math.floor(e.year / 10) * 10) + 's' : '未知');

    const enough = entryStats.filter(e => e.players >= 5);
    const brief = e => ({ date: e.date, word: e.word, len: e.len, votes: e.ratingCount, year: e.year, solveRate: e.solveRate, wrong: e.wrong, hinted: e.hinted });
    const hardest = enough.slice().sort((a, b) => a.solveRate - b.solveRate).slice(0, 15).map(brief);
    const easiest = enough.slice().sort((a, b) => b.solveRate - a.solveRate).slice(0, 10).map(brief);

    // 错答长什么样：同长度的近形词（说明线索指向对了但字池/字形卡住）还是完全无关
    const wrongSamples = [];
    entryStats.forEach(e => e.wrongTexts.forEach(t => wrongSamples.push(e.word + ' ← ' + t)));
    const wrongTop = Object.entries(countBy(wrongSamples)).sort((a, b) => b[1] - a[1]).slice(0, 30)
        .map(x => x[0] + ' ×' + x[1]);
    // 错答里和答案有几个字位置相同——高 = 接近了，低 = 在瞎拼
    const overlap = [];
    entryStats.forEach(e => e.wrongTexts.forEach(t => {
        let same = 0;
        for (let i = 0; i < e.word.length; i++) if (t[i] === e.word[i]) same++;
        overlap.push(e.word.length ? same / e.word.length : 0);
    }));

    // 片重复：同一部片在不同天出现几次
    const filmUse = countBy(puzzles.reduce((a, p) => a.concat((p.entries || []).map(e => e.word)), []));
    const repeated = Object.entries(filmUse).filter(x => x[1] > 1).sort((a, b) => b[1] - a[1]);

    // 字池里干扰字占比：越低，后半局越像「剩下几个字排个序」
    const poolStats = puzzles.filter(p => p.charPool && p.filledCells).map(p => ({
        pool: p.charPool.length, cells: p.filledCells, distractors: p.charPool.length - p.filledCells
    }));

    // 复玩：一个人做过几天
    const daysPlayed = Array.from(byPlayer.values()).map(l => new Set(l).size);

    // —— 按答出顺序：第 k 个答出的那条，答出之前错了几次、求了几次提示。
    // filled 是按答出顺序 append 的，而一条答出后就不能再答，所以它身上的错答都发生在答出之前。
    // 越往后错得越少 = 越靠排除法（字池里剩下的几乎都是答案字），这就是「在组词」的量化口径
    const orderAgg = [0, 1, 2, 3, 4, 5, 6, 7].map(() => ({ n: 0, wrong: 0, hint: 0 }));
    records.forEach(r => {
        (r.filled || []).forEach((no, k) => {
            if (k >= orderAgg.length) return;
            const n = Number(no);
            const s = orderAgg[k];
            s.n++;
            s.wrong += (r.wrongGuesses || []).filter(x => x.entryNo === n).length;
            s.hint += (r.hints || []).filter(x => x.entryNo === n).length;
        });
    });
    const bySolveOrder = orderAgg.filter(s => s.n > 0).map((s, k) => ({
        order: '第' + (k + 1) + '个答出',
        entries: s.n,
        wrongPerEntry: s.n ? Math.round(s.wrong / s.n * 100) / 100 : null,
        hintPerEntry: s.n ? Math.round(s.hint / s.n * 100) / 100 : null
    }));

    // —— 单片实测难度：一部片出过几次、所有出过它的那几天合计的答对率。
    // 分母是当天全部玩家（中途走掉的也算没答出），和上面 byVotes 等口径一致。
    // 出题（getGuessPuzzle 的难度预算）读的就是这份，所以只在 writeFilmStats 时落库
    const filmAgg = new Map();
    entryStats.forEach(e => {
        if (!filmAgg.has(e.id)) filmAgg.set(e.id, { id: e.id, title: e.word, shown: 0, players: 0, solved: 0, wrong: 0, hinted: 0 });
        const x = filmAgg.get(e.id);
        x.shown++; x.players += e.players; x.solved += e.solved; x.wrong += e.wrong; x.hinted += e.hinted;
    });
    const filmStats = Array.from(filmAgg.values()).map(x => Object.assign(x, {
        solveRate: pct(x.solved, x.players),
        wrongPerPlayer: x.players ? Math.round(x.wrong / x.players * 100) / 100 : null
    }));
    let filmStatsWritten = 0;
    if (ev.writeFilmStats === true) {
        try { await db.createCollection('guess_film_stats'); } catch (e) { /* 已存在 */ }
        for (let i = 0; i < filmStats.length; i += 20) {
            await Promise.all(filmStats.slice(i, i + 20).map(x => db.collection('guess_film_stats').doc(x.id).set({
                data: {
                    title: x.title, shown: x.shown, players: x.players, solved: x.solved,
                    wrong: x.wrong, hinted: x.hinted, solveRate: x.solveRate, updateTime: db.serverDate()
                }
            })));
            filmStatsWritten += Math.min(20, filmStats.length - i);
        }
    }

    return {
        success: true,
        mode, today, tookMs: Date.now() - t0,
        overview: {
            players: byPlayer.size,
            rounds: records.length,
            puzzlesInDb: puzzles.length,
            firstPuzzle, lastPuzzle: puzzleDates[puzzleDates.length - 1] || null,
            stockAhead,
            missingDates,
            sameDayGenerated: { count: sameDayGenerated.length, dates: sameDayGenerated.slice(-40) }
        },
        retention: {
            d1: { base: d1Base, back: d1Hit, rate: pct(d1Hit, d1Base) },
            d7Any: { base: d7Base, back: d7Hit, rate: pct(d7Hit, d7Base) },
            daysPlayed: hist(daysPlayed, [1, 2, 3, 5, 10, 20]),
            longestStreak: hist(streaks, [1, 2, 3, 5, 10])
        },
        rounds: {
            outcome: countBy(outcomes),
            solvedCount: countSolved(solvedCounts),
            wrong: hist(wrongCounts, [0, 1, 2, 3, 5, 10]),
            hintsUsed: hist(hintCounts, [0, 1, 2, 3, 5]),
            adHints: hist(adHints, [0, 1, 2, 5]),
            revives: hist(revives, [0, 1, 2, 5]),
            score: hist(scores, [0, 50, 100, 150, 180, 200]),
            totals: {
                hints: hintCounts.reduce((s, x) => s + x, 0),
                adHints: adHints.reduce((s, x) => s + x, 0),
                revives: revives.reduce((s, x) => s + x, 0),
                roundsWithAnyAd: records.filter((r, i) => adHints[i] + revives[i] > 0).length
            }
        },
        difficulty: {
            byLength: groupRate(e => e.len, 'len'),
            byEntryNo: groupRate(e => e.no, 'no'),
            byDir: groupRate(e => e.dir, 'dir'),
            byVotes: groupRate(votesBucket, 'votes'),
            byDecade: groupRate(decade, 'decade'),
            hardest, easiest,
            wrongOverlapAvg: avg(overlap),
            wrongTop,
            bySolveOrder
        },
        filmStats: {
            films: filmStats.length,
            // 样本够（≥20 人次）的才拿去当难度依据，看看有多少部
            reliable: filmStats.filter(x => x.players >= 20).length,
            solveRate: hist(filmStats.filter(x => x.players >= 20).map(x => x.solveRate), [60, 70, 80, 90, 95]),
            written: filmStatsWritten
        },
        content: {
            distinctFilms: Object.keys(filmUse).length,
            repeatedFilms: repeated.slice(0, 15).map(x => x[0] + '×' + x[1]),
            repeatedCount: repeated.length,
            pool: {
                avgPool: avg(poolStats.map(x => x.pool)),
                avgCells: avg(poolStats.map(x => x.cells)),
                avgDistractors: avg(poolStats.map(x => x.distractors))
            }
        },
        byDate
    };
};
