// cloudfunctions/getThemeMovies/index.js
// 通用电影主题读取函数：按 theme 字段查询共享集合 generic_theme_movies，
// 返回形状与 getMoviesData 对齐（{ success, movies, marks, listVersion }），
// 供用 enrichThemeMovies 灌入数据的新主题复用现有 list/share 页面消费逻辑，且不用改动 getMoviesData。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const MAX_LIMIT = 100;

/**
 * 分批读取集合数据（云函数端单次查询有 100 条上限）
 */
async function readAll(query) {
    const countRes = await query.count();
    const total = countRes.total;
    if (total === 0) return [];

    const batchTimes = Math.ceil(total / MAX_LIMIT);
    const tasks = [];
    for (let i = 0; i < batchTimes; i++) {
        tasks.push(query.skip(i * MAX_LIMIT).limit(MAX_LIMIT).get());
    }
    const results = await Promise.all(tasks);
    let data = [];
    results.forEach(r => { data = data.concat(r.data); });
    return data;
}

exports.main = async (event, context) => {
    const {
        theme,
        openid,
        marksOnly,
        orderByField = 'rank',
        orderDirection = 'asc'
    } = event || {};

    if (!theme) {
        return { success: false, error: '缺少 theme 参数', movies: [], marks: [] };
    }

    try {
        if (marksOnly) {
            const marks = openid
                ? await readAll(db.collection('Marks').where({ openid }))
                : [];
            return { success: true, movies: [], marks, listVersion: null };
        }

        const moviesQuery = db.collection('generic_theme_movies')
            .where({ theme })
            .orderBy(orderByField, orderDirection);

        const [movies, marks] = await Promise.all([
            readAll(moviesQuery),
            openid ? readAll(db.collection('Marks').where({ openid })) : Promise.resolve([])
        ]);

        return { success: true, movies, marks, listVersion: null };
    } catch (err) {
        console.error('getThemeMovies 失败:', err);
        return { success: false, error: err.message, movies: [], marks: [] };
    }
};
