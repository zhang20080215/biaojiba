// 纵横填字（mode: 'cross'）的出题逻辑 —— 纯函数，不碰数据库，tools/test-guess-cross.cjs 直接 require。
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
//
// 2026-10-30 出题质量改版（数据见 docs/每日填字-优化方案.md），在「能排满一盘」之外加了几条约束：
//   · 跨批次冷却 + 按出场次数降权：星球大战两个月出了 10 次，因为「星 / 大 / 战」这种
//     常用字多的片名天然更容易被选成交叉点；
//   · 一盘里不放字面相近的片名（危情十日 / 危情时速 / 生死时速 那天 25/31 人中途离开）；
//   · 难度预算：冷门片每盘最多 1 部、大热门至少 2 部；两字片名每盘最多 1 个；
//   · 干扰字从「随机字」改成「按片名字频抽、但拼不出另一部真实片名」——
//     原先随机字一眼就能排除，越往后字池里剩的全是答案字，玩着像在组词；
//     而陷阱字（答案机器战警，字池里给个「械」）会让认得片的人也被扣 ♥，同样不要；
//   · 线索前面加一行「年份 · 国家 · 类型」（entry.info），把重心从拼字挪回认片。

const N = 7;                        // 网格边长
// 每天放几部片。2026-10-30 由 5 改 8：用 2591 部真实片名在 7×7 上试过，8 部 50/50 天都排得满、
// 平均 23 格；10 部只有 5/50 天排得满（要 9×9 才稳，前端格子宽度写死 90rpx，放不下）。
// 生命值（3 颗）和免费提示（2 次）不变（10-30 定）
const TARGET_WORDS = 8;
const MIN_VOTES = 50000;            // 片名要够有名，见上面第 2 条
// 字池尺寸：必须是 8 的倍数且不少于 24 —— 前端每行排 8 个，凑整才不会出现
// 最后一行只剩两三个字的豁口。答案字（一格一份）之外的都用干扰字补齐。
const POOL_STEP = 8;
const POOL_MIN = 24;
// 字池最多 4 行（32 个）：每天 8 部时棋盘基本占满 7 行，字池再多一行，一屏就放不下了。
// 答案格子不多于 32 − POOL_TIGHT_DISTRACTORS 个时，宁可少放几个干扰字也停在 32；
// 格子更多的盘才让它进到 40
const POOL_MAX = 32;
const POOL_TIGHT_DISTRACTORS = 4;
// 干扰字下限。原来是 4，实测平均 8.3 个；改成按字频抽之后干扰字不再一眼可辨，
// 下限给到 8；但字池封顶 4 行（见 POOL_MAX），格子多的盘干扰字会少到 4 个。完美通关率掉得多就用 minDistractors 往回调
const MIN_DISTRACTORS = 8;
const CLUE_MAXLEN = 44;             // 一句剧情的字数上限（前端线索卡锁死两行，见 index.wxss）
const CLUE_MIN = 20;                // 剧情句往后接到至少这么长
const COOLDOWN_DAYS = 60;           // 同一部片多少天内不重复出现
const MIN_USABLE = 120;             // 冷却后至少要剩这么多部，否则逐级放宽冷却
// 难度预算
const COLD_VOTES = 100000;          // 没有实测数据时：评分人数低于它算冷门
const HOT_VOTES = 500000;           // 评分人数达到它算大热门
const COLD_SOLVE_RATE = 80;         // 有实测数据时：答对率（%）低于它算冷门
const STATS_MIN_PLAYERS = 20;       // 实测数据至少要这么多人次才算数
const MAX_COLD = 1;
const MIN_HOT = 2;
const MAX_TWO_CHAR = 1;             // 两字片名交叉给出一个字后，剩下那个基本靠试

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

/** 按权重抽一个。权重全为 0 时退回均匀抽 */
function weightedPick(arr, weightFn, rnd) {
    let total = 0;
    const ws = arr.map(function (x) { const w = Math.max(0, weightFn(x)); total += w; return w; });
    if (total <= 0) return arr[Math.floor(rnd() * arr.length)];
    let t = rnd() * total;
    for (let i = 0; i < arr.length; i++) {
        t -= ws[i];
        if (t < 0) return arr[i];
    }
    return arr[arr.length - 1];
}

/** 'YYYY-MM-DD' -> 自 1970 起的天序号，冷却按它算差值 */
function dayNum(dateStr) {
    return Math.round(Date.parse(dateStr + 'T00:00:00Z') / 86400000);
}

/** 能进填字的片名：纯汉字 2~7 字 */
function usableTitle(t) {
    return typeof t === 'string' && /^[一-龥]{2,7}$/.test(t);
}

/**
 * 两部片名字面相近，不能放进同一盘：一个包含另一个（怪物 / 汉江怪物），
 * 或者共用 2 个及以上不同的字（危情十日 / 危情时速、生死时速 / 危情时速、无依之地 / 老无所依）。
 * 交叉本身只共用 1 个字，所以这条不影响正常排盘。
 */
function titlesSimilar(a, b) {
    a = String(a || ''); b = String(b || '');
    if (!a || !b) return false;
    if (a === b || a.indexOf(b) >= 0 || b.indexOf(a) >= 0) return true;
    const sa = new Set(a);
    let shared = 0;
    new Set(b).forEach(function (c) { if (sa.has(c)) shared++; });
    return shared >= 2;
}

/**
 * 难度分档。有实测数据（guess_film_stats，样本够）就按答对率，没有就按评分人数折算。
 * 一部片可以既是大热门又是冷门（有名但难认，实测答对率低），两条规则各算各的。
 */
function tierOf(w, stats) {
    const votes = Number(w && w.ratingCount) || 0;
    const s = stats && stats.get(String(w && w._id));
    const measured = !!(s && Number(s.players) >= STATS_MIN_PLAYERS && typeof s.solveRate === 'number');
    return {
        cold: measured ? s.solveRate < COLD_SOLVE_RATE : votes < COLD_VOTES,
        hot: votes >= HOT_VOTES,
        measured: measured
    };
}

/**
 * 把干扰字代入任一条答案的任一个位置，能拼出片库里另一部真实片名 —— 那就是陷阱字。
 * 例：答案是机器战警，干扰字「械」能拼出机械战警（另一部电影），认得片的人也会被它坑掉一颗 ♥。
 */
function isTrap(ch, answers, titleSet) {
    for (let k = 0; k < answers.length; k++) {
        const t = answers[k];
        for (let i = 0; i < t.length; i++) {
            if (t[i] === ch) continue;
            if (titleSet.has(t.slice(0, i) + ch + t.slice(i + 1))) return true;
        }
    }
    return false;
}

/**
 * 片名字频表，抽干扰字用。权重取次数的平方根：
 * 直接按次数抽会几乎只抽到「之 / 的 / 人」，平方根让常见字多一些但不至于霸屏。
 * 返回累积权重数组，抽一次是一次二分，一盘要抽上百次，线性扫几千个字太慢。
 */
function buildCharFreq(titles) {
    const cnt = new Map();
    titles.forEach(function (t) {
        for (let i = 0; i < t.length; i++) cnt.set(t[i], (cnt.get(t[i]) || 0) + 1);
    });
    const chars = [], cum = [];
    let acc = 0;
    cnt.forEach(function (n, ch) { acc += Math.sqrt(n); chars.push(ch); cum.push(acc); });
    return { chars: chars, cum: cum, total: acc };
}

function pickByFreq(freq, rnd) {
    const t = rnd() * freq.total;
    let lo = 0, hi = freq.cum.length - 1;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (freq.cum[mid] > t) hi = mid; else lo = mid + 1;
    }
    return freq.chars[lo];
}

/**
 * 挑干扰字：按字频抽，不能是答案里的字（否则拿它去填反而是对的，等于多给了一份），
 * 不能是陷阱字，尽量不重复。凑不够时先放开「不重复」，最后才放开「不是陷阱」——
 * 尺寸必须凑够 8 的倍数，否则前端最后一行会缺口。
 */
function pickDistractors(rnd, need, solutionChars, answers, freq, titleSet) {
    const out = [];
    let traps = 0;
    const ok = function (ch, allowDup) {
        if (solutionChars.has(ch)) return false;
        if (!allowDup && out.indexOf(ch) >= 0) return false;
        return !isTrap(ch, answers, titleSet);
    };
    for (let i = 0; i < need * 80 && out.length < need; i++) {
        const ch = pickByFreq(freq, rnd);
        if (ok(ch, false)) out.push(ch);
    }
    for (let i = 0; i < need * 80 && out.length < need; i++) {
        const ch = pickByFreq(freq, rnd);
        if (ok(ch, true)) out.push(ch);
    }
    while (out.length < need && freq.chars.length) {
        const ch = pickByFreq(freq, rnd);
        if (!solutionChars.has(ch)) { out.push(ch); traps++; }
    }
    return { chars: out, traps: traps };
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
 *
 * 2026-10-30 起再做几件事，让线索更像「这部片讲什么」（问题样本来自 crossStats 的 clueAudit）：
 *   ④ 去掉开头的套话（「本片讲述了」）和「根据某某改编」这种不讲剧情的句子；
 *   ⑤ 跳过只交代时间地点的短句（「1920年代，芝加哥」）；
 *   ⑥ 有剧情句可用时，不用「介绍这部电影」的句子：「《███》是一部黑色喜剧」（荒蛮故事）、
 *      「《███》定于6月全球上映」（功夫熊猫）、「本片是超现实主义电影之父███和…的跨界合作」；
 *   ⑦ 字数按**去掉 ███ 之后**算，至少接到 CLUE_MIN 字 —— 按含码长度算时，《穿越时空的少女》
 *      只剩「17岁███绀野真琴是一个活泼跳脱███」，看着够长，其实没几个字能用；
 *   ⑧ 超长时尽量在逗号处截断，不在半个词上加「…」；
 *   ⑨ 删掉拉丁名后汉字之间留下的空格（「奥德兰公主 的星际飞船」）。
 * 手工改过的线索（guess_clue_overrides，出题时并进 fact.clueOverride）直接用，不再加工。
 */
const BOILERPLATE = /^(?:本片|影片|该片|电影|故事|这部电影|本剧)?(?:主要)?(?:讲述了?|讲的是|描写了?|描述了?|叙述了?)/;
const ADAPTATION = /^(?:本片|影片|该片|电影)?(?:根据|改编自)/;
const SETTING_ONLY = /^(?:\d{2,4}|[一二三四五六七八九十〇零]{2,4})(?:年代?|世纪)/;
const META = /《|》|上映|票房|是一部|本片是|该片是|影片是|系列电影|续集/;
// 新闻稿口吻（2026-11-02 crossStats 实测，多来自扩片源）：「███将加盟███执导新片」「《███》主演███、███…」。
// 和 META 一样只在有剧情句时让位；整段都是这种句子的片，crossClueOk 直接拒掉，不进词库
const NEWS = /执导|主演|领衔|加盟|开拍|杀青|新片|定档|饰演|特辑/;
const plainLen = function (s) { return String(s).replace(/███/g, '').length; };

function hasClueOverride(fact) {
    return !!(fact && typeof fact.clueOverride === 'string' && fact.clueOverride.trim());
}

function crossClue(fact) {
    if (hasClueOverride(fact)) {
        return fact.clueOverride.trim().slice(0, CLUE_MAXLEN);
    }
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
    // ⑨ 空格只留在两个半角字符之间，汉字旁边的都删掉
    s = s.replace(/[ \t　]+/g, ' ').replace(/ (?=[^\x00-\x7F])|(?<=[^\x00-\x7F]) /g, '');
    // 连续的码合并，免得出现 ██████████ 这种长条
    s = s.replace(/(?:███)+/g, '███');

    const raw = s.split(/[。！？；\n]/).map(function (x) { return x.trim(); }).filter(Boolean);
    // ④⑤⑥ 清洗。全被筛掉的话退回原句，宁可线索平淡也别没线索
    let parts = raw
        .filter(function (p) { return !ADAPTATION.test(p); })
        .map(function (p) { return p.replace(BOILERPLATE, '').replace(/^[，、：:\s]+/, ''); })
        .filter(function (p) { return p && !(plainLen(p) <= 12 && SETTING_ONLY.test(p)); });
    const story = parts.filter(function (p) { return !META.test(p) && !NEWS.test(p); });
    if (story.length) parts = story;
    if (!parts.length) parts = raw;
    // ⑦ 按去码后的字数接句子
    let out = '';
    for (let i = 0; i < parts.length && plainLen(out) < CLUE_MIN; i++) out += (out ? '，' : '') + parts[i];
    if (!out) out = s.trim();
    // ⑧ 超长：逗号处截断，截完还够 CLUE_MIN 才这么截，否则硬切加省略号
    if (out.length > CLUE_MAXLEN) {
        const cut = out.lastIndexOf('，', CLUE_MAXLEN);
        out = cut > 0 && plainLen(out.slice(0, cut)) >= CLUE_MIN ? out.slice(0, cut) : out.slice(0, CLUE_MAXLEN) + '…';
    }
    return out;
}

/**
 * 线索可用吗。打完码后可能只剩一堆 ███ 或者短得毫无信息，
 * 这种片直接不进词库 —— 填字里一条没法推的线索会卡死整盘。
 * crossClue 有剧情句时只用剧情句，所以成品里还带 META / NEWS 的，说明简介里一句剧情都没有，也拒掉。
 * 手工线索不走这里（crossWordPool 里直接放行）。
 */
function crossClueOk(clue) {
    const s = String(clue || '');
    if (s.length < 14) return false;
    if (META.test(s) || NEWS.test(s)) return false;
    const masked = (s.match(/███/g) || []).length * 3;
    return masked / s.length < 0.35;
}

/**
 * 线索前那一行「1994 · 美国 · 剧情/犯罪」。国家、类型若和片名共用 2 字以上就不给
 * （《美国丽人》不能写「美国」，《战争之王》不能写「战争」），否则又是白送格子。
 */
function crossInfo(fact) {
    const title = String(fact.title || '');
    const leaks = function (s) {
        for (let i = 0; i + 2 <= s.length; i++) if (title.indexOf(s.slice(i, i + 2)) >= 0) return true;
        return false;
    };
    const parts = [];
    if (fact.year) parts.push(String(fact.year));
    const country = (fact.countries || []).find(function (c) { return c && !leaks(String(c)); });
    if (country) parts.push(String(country));
    const genres = (fact.genres || []).filter(function (g) { return g && !leaks(String(g)); }).slice(0, 2);
    if (genres.length) parts.push(genres.join('/'));
    return parts.join(' · ');
}

/**
 * 词库：纯汉字片名 + 有简介 + 够有名 + 线索过得了闸门。
 * 同名不同片（两部《小妇人》、两部《倩女幽魂》）只留评分人数最多的那部：
 * 填的是片名，两部答案一样，留两份只会让同一个片名绕过冷却隔几天又出来，
 * 线索也该用大家最熟的那一部
 */
function crossWordPool(pool, opts) {
    const o = opts || {};
    const minVotes = o.minVotes == null ? MIN_VOTES : Number(o.minVotes);
    const best = new Map();
    pool.forEach(function (f) {
        const ok = f.subtype !== 'tv'
            && usableTitle(f.title)
            && String(f.intro || '').length >= 20
            && Number(f.ratingCount) >= minVotes
            && (hasClueOverride(f) || crossClueOk(crossClue(f)));
        if (!ok) return;
        const cur = best.get(f.title);
        if (!cur || Number(f.ratingCount) > Number(cur.ratingCount)) best.set(f.title, f);
    });
    return Array.from(best.values());
}

/** 汉字 -> [{ id, title, pos }]，交叉点从这里找 */
function crossCharIndex(words) {
    const m = new Map();
    words.forEach(function (w) {
        for (let i = 0; i < w.title.length; i++) {
            const c = w.title[i];
            if (!m.has(c)) m.set(c, []);
            m.get(c).push({ id: String(w._id), title: w.title, pos: i });
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
    if (r < 0 || c < 0 || r + dr * (L - 1) >= N || c + dc * (L - 1) >= N) return -1;
    const br = r - dr, bc = c - dc, ar = r + dr * L, ac = c + dc * L;
    if (br >= 0 && bc >= 0 && g[br][bc]) return -1;
    if (ar < N && ac < N && g[ar][ac]) return -1;
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
        if (rr + sr < N && cc + sc < N && g[rr + sr][cc + sc]) return -1;
    }
    return cross;
}

function crossPut(g, word, r, c, dir) {
    const dr = dir === 'V' ? 1 : 0, dc = dir === 'H' ? 1 : 0;
    for (let i = 0; i < word.length; i++) g[r + dr * i][c + dc * i] = word[i];
}

/**
 * 出一道填字。策略：先横放一个种子词，然后反复「列出所有能和已放的词交叉的片名及位置 →
 * 抽一个放上去」，直到放够 target 部。走进死胡同（没有能放的了）就整盘重来。
 *
 * 约束在**每放一部之前**检查，不合格就换候选；整盘放完只剩「大热门够不够」要回头看，
 * 而那一条也在放的过程中提前收口：剩下的空位刚好等于还差的大热门数时，只收大热门。
 *
 * o: { words, byChar?, stats?: Map(id -> {players, solveRate}), weightOf?: id -> 权重,
 *      titleSet: Set(全库片名，查陷阱字用), freq: buildCharFreq 的结果,
 *      rules?: false 关掉全部质量约束（兜底用）, maxCold?, minHot?, maxTwoChar?, minDistractors?, targetWords? }
 */
function generateCross(rnd, o) {
    const target = o.targetWords || TARGET_WORDS;
    const words = o.words || [];
    if (words.length < 40) {
        return { error: '可用片名只有 ' + words.length + ' 条（需纯汉字 2~7 字 + 有简介 + 评分人数达标），词库太小' };
    }
    const byChar = o.byChar || crossCharIndex(words);
    const byId = new Map(words.map(function (w) { return [String(w._id), w]; }));
    const weightOf = o.weightOf || function () { return 1; };
    const rules = o.rules !== false;
    const maxCold = o.maxCold == null ? MAX_COLD : Number(o.maxCold);
    const minHot = o.minHot == null ? MIN_HOT : Number(o.minHot);
    const maxTwo = o.maxTwoChar == null ? MAX_TWO_CHAR : Number(o.maxTwoChar);
    const minDistractors = o.minDistractors == null ? MIN_DISTRACTORS : Number(o.minDistractors);
    const tierCache = new Map();
    const tier = function (w) {
        const k = String(w._id);
        if (!tierCache.has(k)) tierCache.set(k, tierOf(w, o.stats));
        return tierCache.get(k);
    };
    const pick = function (a) { return a[Math.floor(rnd() * a.length)]; };
    const seeds = words.filter(function (w) { return w.title.length >= 4 && w.title.length <= 6; });
    if (!seeds.length) return { error: '没有 4~6 字的种子片名' };

    for (let attempt = 0; attempt < 400; attempt++) {
        const g = Array.from({ length: N }, function () { return Array(N).fill(''); });
        const placed = [];
        const cnt = { cold: 0, hot: 0, two: 0 };
        const canTake = function (w) {
            if (!w || placed.some(function (p) { return p.id === String(w._id); })) return false;
            if (placed.some(function (p) { return p.word === w.title; })) return false;
            if (!rules) return true;
            const t = tier(w);
            if (w.title.length === 2 && cnt.two >= maxTwo) return false;
            if (t.cold && cnt.cold >= maxCold) return false;
            if (placed.some(function (p) { return titlesSimilar(p.word, w.title); })) return false;
            if (minHot - cnt.hot >= target - placed.length && !t.hot) return false;
            return true;
        };
        const take = function (w, r, c, dir) {
            crossPut(g, w.title, r, c, dir);
            placed.push({ id: String(w._id), word: w.title, r: r, c: c, dir: dir });
            const t = tier(w);
            if (t.cold) cnt.cold++;
            if (t.hot) cnt.hot++;
            if (w.title.length === 2) cnt.two++;
        };

        const seed = weightedPick(seeds, function (w) { return weightOf(String(w._id)); }, rnd);
        if (!canTake(seed)) continue;
        const r0 = Math.floor(rnd() * N);
        const c0 = Math.floor(rnd() * (N - seed.title.length + 1));
        if (crossCanPlace(g, seed.title, r0, c0, 'H') < 0) continue;
        take(seed, r0, c0, 'H');

        // 每一步把「所有能放的位置」列全再抽，而不是随机试 —— 每天 8 部时随机试的命中率太低，
        // 一盘要算半秒，备 60 天会撞云函数的时间上限。
        // 先按片抽（出场次数降权），再在这部片的几个可放位置里均匀抽：直接在位置上抽的话，
        // 「之 / 的 / 大」这种常用字多的片名可放位置多，又会被偏爱
        while (placed.length < target) {
            const spots = new Map();       // 片 id -> [{ w, r, c, dir }]
            const ok = new Map();          // 片 id -> canTake，同一步里只算一次
            placed.forEach(function (base) {
                const dir = base.dir === 'H' ? 'V' : 'H';
                for (let bi = 0; bi < base.word.length; bi++) {
                    const br = base.dir === 'H' ? base.r : base.r + bi;
                    const bc = base.dir === 'H' ? base.c + bi : base.c;
                    (byChar.get(base.word[bi]) || []).forEach(function (cand) {
                        if (!ok.has(cand.id)) ok.set(cand.id, canTake(byId.get(cand.id)));
                        if (!ok.get(cand.id)) return;
                        const r = dir === 'V' ? br - cand.pos : br;
                        const c = dir === 'H' ? bc - cand.pos : bc;
                        if (crossCanPlace(g, cand.title, r, c, dir) <= 0) return;
                        if (!spots.has(cand.id)) spots.set(cand.id, []);
                        spots.get(cand.id).push({ w: byId.get(cand.id), r: r, c: c, dir: dir });
                    });
                }
            });
            if (!spots.size) break;
            const id = weightedPick(Array.from(spots.keys()), weightOf, rnd);
            const s = pick(spots.get(id));
            take(s.w, s.r, s.c, s.dir);
        }
        if (placed.length < target) continue;
        if (rules && cnt.hot < minHot) continue;

        const entries = placed.map(function (p, i) {
            const f = byId.get(p.id);
            return {
                no: i + 1, id: p.id, word: p.word, r: p.r, c: p.c, dir: p.dir, len: p.word.length,
                clue: crossClue(f), info: crossInfo(f), year: f.year || null, cover: f.cover || '',
                // 答对后「顺手标记」要用：这部片在各榜单里的文档 id。
                // 存进 puzzle 而不是作答时现查，和 grid 把 answerIds 存进去是同一个理由 ——
                // 校验只读这一份文档就够，不必再回 movie_facts。
                movieIds: f.movieIds || []
            };
        });
        // 字池**按格子逐个给**，不是按不同的字给：每个字只能用一次，
        // 所以《虫虫危机》那种重复字的片名要给两个「虫」才填得满。
        // 交叉格只算一次（它本来就只有一个格子），这一点由「遍历格子」天然保证。
        const poolChars = [];
        g.forEach(function (row) { row.forEach(function (ch) { if (ch) poolChars.push(ch); }); });
        let poolTarget = Math.max(
            POOL_MIN,
            Math.ceil((poolChars.length + minDistractors) / POOL_STEP) * POOL_STEP
        );
        if (poolTarget > POOL_MAX && poolChars.length + POOL_TIGHT_DISTRACTORS <= POOL_MAX) poolTarget = POOL_MAX;
        const d = pickDistractors(rnd, poolTarget - poolChars.length, new Set(poolChars),
            placed.map(function (p) { return p.word; }), o.freq, o.titleSet || new Set());

        return {
            grid: g.map(function (row) { return row.slice(); }),
            entries: entries,
            charPool: shuffled(poolChars.concat(d.chars), rnd),
            filledCells: poolChars.length,
            attempt: attempt,
            quality: {
                cold: cnt.cold, hot: cnt.hot, twoChar: cnt.two,
                distractors: d.chars.length, traps: d.traps, rules: rules
            }
        };
    }
    return { error: '试了 400 盘都没排满 ' + target + ' 部片，词库或约束有问题' };
}

/**
 * 出题上下文：词库、全库片名（查陷阱字）、字频表、实测难度、出场记录。
 * prepare / 压测 / 按天现出题三条路径共用，规则才不会三处各写一份。
 *   pool  —— movie_facts 全量（含剧集，这里自己滤）
 *   opts  —— { stats?: Map, minVotes?, filmCooldown?, minDistractors?, maxCold?, minHot?, maxTwoChar? }
 */
function buildCrossContext(pool, opts) {
    const o = opts || {};
    const movies = pool.filter(function (f) { return f.subtype !== 'tv'; });
    return {
        words: crossWordPool(movies, o),
        titleSet: new Set(movies.map(function (f) { return String(f.title || ''); }).filter(Boolean)),
        freq: buildCharFreq(movies.map(function (f) { return f.title; }).filter(usableTitle)),
        stats: o.stats || new Map(),
        usage: new Map(),          // 片 id -> { count, last(天序号) }
        opts: o
    };
}

/** 记一笔出场：count 累加，last 取最近 */
function recordUsage(ctx, ids, day) {
    ids.forEach(function (id) {
        const k = String(id);
        const u = ctx.usage.get(k) || { count: 0, last: -Infinity };
        u.count++;
        u.last = Math.max(u.last, day);
        ctx.usage.set(k, u);
    });
}

/**
 * 出某一天的题。冷却期内出过的片不进候选，其余按 1 / (1 + 出场次数) 加权抽。
 * 冷却削太狠（剩不到 MIN_USABLE 部）就逐级放宽；规则太紧排不出来就逐级放松 ——
 * 宁可这天的题松一点，也不能没题。成功后把这天的片记进出场记录。
 *   day      —— 天序号（dayNum），压测用虚构的 0..N
 *   seedStr  —— 随机种子前缀，同一天任何人算出来都是同一道
 */
function planCrossDay(ctx, day, seedStr) {
    const o = ctx.opts || {};
    const cool = o.filmCooldown == null ? COOLDOWN_DAYS : Number(o.filmCooldown);
    const steps = [cool, Math.floor(cool * 2 / 3), Math.floor(cool / 3), 0]
        .filter(function (v, i, a) { return a.indexOf(v) === i; });
    const weightOf = function (id) {
        const u = ctx.usage.get(id);
        return 1 / (1 + (u ? u.count : 0));
    };
    const relax = [
        {},                                  // 全部规则
        { minHot: 1 },                       // 大热门放到 1 部
        { rules: false }                     // 只保证排得满
    ];
    for (let ri = 0; ri < relax.length; ri++) {
        for (let si = 0; si < steps.length; si++) {
            const cd = steps[si];
            const usable = ctx.words.filter(function (w) {
                const u = ctx.usage.get(String(w._id));
                return !(u && day - u.last < cd);
            });
            if (usable.length < MIN_USABLE && cd > 0) continue;
            const gopts = Object.assign({}, o, relax[ri], {
                words: usable, byChar: crossCharIndex(usable),
                stats: ctx.stats, titleSet: ctx.titleSet, freq: ctx.freq, weightOf: weightOf
            });
            for (let salt = 0; salt < 8; salt++) {
                const g = generateCross(seededRandom(seedStr + (salt ? '|p' + salt : '')), gopts);
                if (g.error) continue;
                recordUsage(ctx, g.entries.map(function (e) { return e.id; }), day);
                g.cooldownUsed = cd;
                g.relaxed = ri;
                return g;
            }
            // 这一档冷却下排不出来，再放宽冷却试；已经是 0 就换下一档规则
        }
    }
    return null;
}

/**
 * 压测：连着出 days 天（虚构日期，不落库），报质量指标。
 * ctx 的 usage 可以预先灌真实出场记录，模拟「接着现有题库往后备」。
 */
function stressCross(ctx, days, seedPrefix, deadline) {
    const dist = function (arr) {
        const m = {};
        arr.forEach(function (v) { const k = '=' + v; m[k] = (m[k] || 0) + 1; });
        return m;
    };
    const filmUse = new Map();
    const cold = [], hot = [], two = [], pool = [], distract = [], cools = [], relaxed = [], clueLen = [];
    let failed = 0, traps = 0, similarPairs = 0, done = 0;
    const samples = [];
    for (let i = 0; i < days; i++) {
        if (deadline && Date.now() > deadline) break;
        done++;
        const g = planCrossDay(ctx, i, (seedPrefix || 'stress') + '|' + i);
        if (!g) { failed++; continue; }
        const ws = g.entries.map(function (e) { return e.word; });
        ws.forEach(function (w) { filmUse.set(w, (filmUse.get(w) || 0) + 1); });
        for (let a = 0; a < ws.length; a++) {
            for (let b = a + 1; b < ws.length; b++) if (titlesSimilar(ws[a], ws[b])) similarPairs++;
        }
        cold.push(g.quality.cold); hot.push(g.quality.hot); two.push(g.quality.twoChar);
        pool.push(g.charPool.length); distract.push(g.quality.distractors);
        cools.push(g.cooldownUsed); relaxed.push(g.relaxed);
        traps += g.quality.traps;
        g.entries.forEach(function (e) { clueLen.push(e.clue.length); });
        if (samples.length < 3) {
            samples.push(g.entries.map(function (e) { return e.word + '｜' + e.info + '｜' + e.clue; }));
        }
    }
    const repeats = Array.from(filmUse.entries()).sort(function (a, b) { return b[1] - a[1]; });
    return {
        days: done, failed: failed,
        distinctFilms: filmUse.size,
        maxRepeat: repeats.length ? repeats[0][1] : 0,
        topRepeated: repeats.slice(0, 10).map(function (e) { return e[0] + '×' + e[1]; }),
        coldPerPuzzle: dist(cold), hotPerPuzzle: dist(hot), twoCharPerPuzzle: dist(two),
        similarPairs: similarPairs, traps: traps,
        poolSize: dist(pool), distractors: dist(distract),
        cooldownUsed: dist(cools),
        // 0 = 全部规则，1 = 大热门放到 1 部，2 = 规则全关。>0 的天数越多说明规则越紧
        relaxedLevel: dist(relaxed),
        avgClueLen: clueLen.length ? Math.round(clueLen.reduce(function (s, x) { return s + x; }, 0) / clueLen.length * 10) / 10 : 0,
        samples: samples
    };
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
            return { no: e.no, r: e.r, c: e.c, dir: e.dir, len: e.len, clue: e.clue, info: e.info || '' };
        }),
        charPool: doc.charPool,
        poolSize: doc.poolSize
    };
}

module.exports = {
    N, MIN_VOTES, MIN_USABLE, COOLDOWN_DAYS,
    seededRandom, shuffled, weightedPick, dayNum,
    usableTitle, titlesSimilar, tierOf, isTrap, buildCharFreq, pickDistractors,
    crossClue, crossClueOk, crossInfo, crossWordPool, crossCharIndex, crossCanPlace,
    generateCross, buildCrossContext, recordUsage, planCrossDay, stressCross, sanitizeCross
};
