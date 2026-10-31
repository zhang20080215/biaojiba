// node --test tools/test-guess-cross.cjs
// 每日电影填词的出题规则（cloudfunctions/getGuessPuzzle/cross.js）。纯函数，不连云。
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const cross = require(path.join(__dirname, '..', 'cloudfunctions', 'getGuessPuzzle', 'cross.js'));

// —— 片库：用扩片源快照里的真实片名（评分 ≥5 万），简介统一填一段假剧情。
// 早先用随机汉字拼的合成片名，字和字之间没有真实片名那种共用关系，
// 每天 8 部时几乎排不出来，测的不是线上的样子
const EXTRA = require(path.join(__dirname, '..', 'cloudfunctions', 'buildMovieFacts', 'guessExtraFilms.json'));
function realPool(limit) {
    return EXTRA.filter(x => x.ratingCount >= 50000).slice(0, limit || Infinity).map(x => ({
        _id: x.doubanId, title: x.title, subtype: 'movie', year: x.year,
        countries: ['美国'], genres: ['剧情', '犯罪'], ratingCount: x.ratingCount,
        intro: '主人公在一座小城里遇到了改变命运的陌生人。两人从此结伴踏上漫长旅程，一路经历离别与重逢。'
    }));
}

test('titlesSimilar：包含关系、共用两个字算相近；只共用一个字不算', () => {
    assert.ok(cross.titlesSimilar('危情十日', '危情时速'));
    assert.ok(cross.titlesSimilar('生死时速', '危情时速'));
    assert.ok(cross.titlesSimilar('无依之地', '老无所依'));
    assert.ok(cross.titlesSimilar('怪物', '汉江怪物'));
    assert.ok(cross.titlesSimilar('东京教父', '迷失东京'));
    assert.ok(!cross.titlesSimilar('如父如子', '东京教父'));
    assert.ok(!cross.titlesSimilar('机器战警', '战狼'));
});

test('isTrap：干扰字能和答案拼出另一部真实片名就是陷阱', () => {
    const titles = new Set(['机械战警', '机器战警', '海洋之子']);
    assert.ok(cross.isTrap('械', ['机器战警'], titles));
    assert.ok(cross.isTrap('子', ['海洋之歌'], titles));
    assert.ok(!cross.isTrap('狼', ['机器战警'], titles));
});

test('tierOf：有足够实测数据按答对率，没有按评分人数', () => {
    const stats = new Map([['a', { players: 30, solveRate: 70 }], ['b', { players: 5, solveRate: 50 }]]);
    assert.deepStrictEqual(cross.tierOf({ _id: 'a', ratingCount: 900000 }, stats), { cold: true, hot: true, measured: true });
    // 样本不够，退回评分人数：12 万不算冷门
    assert.strictEqual(cross.tierOf({ _id: 'b', ratingCount: 120000 }, stats).cold, false);
    assert.strictEqual(cross.tierOf({ _id: 'c', ratingCount: 80000 }, stats).cold, true);
});

test('crossClue：片名子串打码、去套话、跳过只有时间地点的短句、去掉改编说明', () => {
    const f = {
        title: '柏林苍穹下', originalTitle: 'Der Himmel über Berlin',
        intro: '本片讲述了柏林由两位天使守护着。天使丹尼尔厌倦了永恒，爱上了马戏团的空中飞人。'
    };
    const c = cross.crossClue(f);
    assert.ok(!c.startsWith('本片'), c);
    assert.ok(c.indexOf('柏林') < 0, c);
    assert.ok(c.indexOf('Berlin') < 0, c);

    const g = { title: '教父', intro: '1945年，纽约。黑手党家族的小儿子原本远离家族生意，一场刺杀让他走上了另一条路。' };
    assert.ok(cross.crossClue(g).startsWith('黑手党'), cross.crossClue(g));

    const h = { title: '某片', intro: '影片根据同名小说改编。一名退役拳手为了女儿重新站上擂台，面对昔日的对手。' };
    assert.ok(cross.crossClue(h).startsWith('一名退役拳手'), cross.crossClue(h));

    // 全被筛掉时退回原句，不能没有线索
    const k = { title: '某片', intro: '1920年代，芝加哥' };
    assert.ok(cross.crossClue(k).length > 0);
});

test('crossClue：clueAudit 里的几种坏线索（10-30 实测样本）', () => {
    // 介绍电影本身的句子让位给剧情句
    const a = { title: '荒蛮故事', intro: '《荒蛮故事》是一部黑色喜剧，由6个独立的暴力复仇小故事构成。一名乘客发现整架飞机上的人都和同一个男人结过仇。' };
    assert.ok(cross.crossClue(a).startsWith('一名乘客'), cross.crossClue(a));
    // 打码后几乎没剩字的，要往后接句子
    const b = { title: '穿越时空的少女', intro: '17岁的少女绀野真琴是一个活泼跳脱的少女。某天她在学校的理科实验室里意外获得了穿越时间的能力。' };
    const cb = cross.crossClue(b);
    assert.ok(cb.replace(/███/g, '').length >= 20 && cb.indexOf('理科实验室') > 0, cb);
    // 超长在逗号处截，不在半个词上加省略号
    const c = { title: '模仿游戏', intro: '二战期间，盟军苦于德国的秘密系统“英格玛”无法破译，政府召集了一批民间数学家、逻辑学家进驻布莱切利园。' };
    const cc = cross.crossClue(c);
    assert.ok(!cc.endsWith('…') && cc.endsWith('无法破译'), cc);
    // 删掉拉丁名后汉字之间不留空格
    const d = { title: '星球大战', intro: '黑武士达斯 Darth Vader 秘密捕获了奥德兰公主 Leia 的星际飞船，公主在被俘前把求救信息藏进了机器人。' };
    assert.ok(cross.crossClue(d).indexOf(' ') < 0, cross.crossClue(d));
});

test('crossClue：手工线索优先，原样使用', () => {
    assert.strictEqual(cross.crossClue({ title: 'x', intro: '随便', clueOverride: '一个手工写的线索' }), '一个手工写的线索');
});

test('crossInfo：年份 · 国家 · 类型，和片名重字的不给', () => {
    assert.strictEqual(cross.crossInfo({ title: '肖申克的救赎', year: 1994, countries: ['美国'], genres: ['剧情', '犯罪', '传记'] }),
        '1994 · 美国 · 剧情/犯罪');
    assert.strictEqual(cross.crossInfo({ title: '美国丽人', year: 1999, countries: ['美国'], genres: ['剧情'] }), '1999 · 剧情');
    assert.strictEqual(cross.crossInfo({ title: '战争之王', year: 2005, countries: ['美国', '法国'], genres: ['战争', '犯罪'] }),
        '2005 · 美国 · 犯罪');
});

test('generateCross：一盘满足全部质量约束', () => {
    const ctx = cross.buildCrossContext(realPool(), {});
    // 往片库名单里塞几部「近形片名」，让陷阱检查有东西可查
    ctx.words.slice(0, 50).forEach(w => ctx.titleSet.add('某' + w.title.slice(1)));
    for (let d = 0; d < 20; d++) {
        const g = cross.generateCross(cross.seededRandom('t' + d), {
            words: ctx.words, stats: ctx.stats, titleSet: ctx.titleSet, freq: ctx.freq
        });
        assert.ok(!g.error, g.error);
        const ws = g.entries.map(e => e.word);
        assert.strictEqual(ws.length, 8);
        for (let a = 0; a < ws.length; a++) for (let b = a + 1; b < ws.length; b++) {
            assert.ok(!cross.titlesSimilar(ws[a], ws[b]), ws[a] + ' / ' + ws[b]);
        }
        assert.ok(ws.filter(w => w.length === 2).length <= 1);
        assert.ok(g.quality.cold <= 1);
        assert.ok(g.quality.hot >= 2);
        // 字池：8 的倍数、不少于 24、最多 4 行，且不含答案字、不是陷阱
        assert.strictEqual(g.charPool.length % 8, 0);
        assert.ok(g.charPool.length >= 24);
        const sol = new Set();
        g.grid.forEach(row => row.forEach(ch => { if (ch) sol.add(ch); }));
        const distract = g.charPool.length - g.filledCells;
        // 干扰字至少 8 个；但字池封顶 4 行（32 个），格子多的盘会压到最少 4 个
        if (g.filledCells + 4 <= 32) assert.ok(g.charPool.length <= 32, '字池超过 4 行：' + g.charPool.length);
        assert.ok(distract >= (g.charPool.length === 32 ? 4 : 8), 'distractors ' + distract);
        assert.strictEqual(g.quality.traps, 0);
        const counts = new Map();
        g.charPool.forEach(ch => counts.set(ch, (counts.get(ch) || 0) + 1));
        let extra = 0;
        counts.forEach((n, ch) => { if (!sol.has(ch)) { extra += n; assert.ok(!cross.isTrap(ch, ws, ctx.titleSet), '陷阱字 ' + ch); } });
        assert.strictEqual(extra, distract);
        g.entries.forEach(e => { assert.ok(e.clue && e.info); });
    }
});

test('planCrossDay：冷却期内同一部片不重复，出场多的被降权', () => {
    const ctx = cross.buildCrossContext(realPool(), { filmCooldown: 60 });
    const last = new Map();
    for (let d = 0; d < 30; d++) {
        const g = cross.planCrossDay(ctx, d, 'day|' + d);
        assert.ok(g, 'day ' + d + ' 没出来');
        assert.strictEqual(g.relaxed, 0);
        g.entries.forEach(e => {
            if (last.has(e.id)) assert.ok(d - last.get(e.id) >= g.cooldownUsed, e.word + ' 冷却内重复');
            last.set(e.id, d);
        });
    }
});

test('weightedPick：出场 9 次的片（权重 1/10）被抽中的次数约为没出过的十分之一', () => {
    const rnd = cross.seededRandom('w');
    const n = { fresh: 0, used: 0 };
    for (let i = 0; i < 20000; i++) {
        n[cross.weightedPick(['fresh', 'used'], x => (x === 'used' ? 1 / 10 : 1), rnd)]++;
    }
    const ratio = n.used / n.fresh;
    assert.ok(ratio > 0.07 && ratio < 0.13, 'ratio ' + ratio);
});

test('stressCross：真实片名连出 30 天不失败、无相近片名、无陷阱、不重复', () => {
    const ctx = cross.buildCrossContext(realPool(), {});
    const r = cross.stressCross(ctx, 30, 's');
    assert.strictEqual(r.failed, 0);
    assert.strictEqual(r.similarPairs, 0);
    assert.strictEqual(r.traps, 0);
    assert.ok(r.maxRepeat <= 1, '冷却内不该重复：' + r.topRepeated.join(','));
});

test('crossWordPool：同名不同片只留评分人数最多的', () => {
    const intro = '主人公在一座小城里遇到了改变命运的陌生人。两人从此结伴踏上漫长旅程，一路经历离别与重逢。';
    const ws = cross.crossWordPool([
        { _id: 'a', title: '小妇人', ratingCount: 300000, intro: intro },
        { _id: 'b', title: '小妇人', ratingCount: 900000, intro: intro },
        { _id: 'c', title: '大鱼', ratingCount: 900000, intro: intro }
    ], {});
    assert.deepStrictEqual(ws.map(w => w._id).sort(), ['b', 'c']);
});

test('sanitizeCross：下发视图带 info，不带答案字', () => {
    const v = cross.sanitizeCross({
        date: '2026-10-30', n: 7, grid: [['甲', '']], charPool: ['甲'],
        entries: [{ no: 1, r: 0, c: 0, dir: 'H', len: 1, clue: 'c', info: '1994 · 美国', word: '甲', id: 'x' }]
    });
    assert.strictEqual(v.entries[0].info, '1994 · 美国');
    assert.strictEqual(v.entries[0].word, undefined);
    assert.deepStrictEqual(v.mask, [[1, 0]]);
});
