// cloudfunctions/checkThemeRankGaps/index.js
// 一次性排查工具：查某个 generic_theme_movies 主题的 rank 序号有没有缺号/重号。
// 用法：云端测试传 { "theme": "letterboxd500", "expectedCount": 500 }
// expectedCount 可省略，省略时用实际查到的最大 rank 作为上限。
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const MAX_LIMIT = 100;

async function readAllRanks(theme) {
    const col = db.collection('generic_theme_movies');
    const countRes = await col.where({ theme }).count();
    const total = countRes.total;
    if (total === 0) return [];

    const times = Math.ceil(total / MAX_LIMIT);
    let ranks = [];
    for (let i = 0; i < times; i++) {
        const r = await col.where({ theme }).skip(i * MAX_LIMIT).limit(MAX_LIMIT).field({ rank: true, title: true }).get();
        ranks = ranks.concat(r.data);
    }
    return ranks;
}

exports.main = async (event) => {
    const { theme, expectedCount } = event || {};
    if (!theme) return { success: false, error: '缺少 theme 参数' };

    try {
        const docs = await readAllRanks(theme);
        const total = docs.length;

        const rankCount = {};
        docs.forEach(d => {
            rankCount[d.rank] = (rankCount[d.rank] || 0) + 1;
        });

        const maxRank = docs.reduce((m, d) => Math.max(m, d.rank || 0), 0);
        const upper = expectedCount || maxRank;

        const missingRanks = [];
        for (let i = 1; i <= upper; i++) {
            if (!rankCount[i]) missingRanks.push(i);
        }

        const duplicateRanks = Object.keys(rankCount)
            .filter(r => rankCount[r] > 1)
            .map(r => ({ rank: Number(r), count: rankCount[r], titles: docs.filter(d => d.rank === Number(r)).map(d => d.title) }));

        return {
            success: true,
            theme,
            total,
            expectedCount: upper,
            missingRanks,
            duplicateRanks
        };
    } catch (err) {
        console.error('checkThemeRankGaps 失败:', err);
        return { success: false, error: err.message };
    }
};
