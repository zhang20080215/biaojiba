// cloudfunctions/getThemeBooks/index.js
// 通用读书主题读取函数：按 theme 字段查询共享集合 generic_theme_books，
// 返回形状与 getThemeMovies/getMoviesData 对齐（{ success, movies, marks, listVersion }）——
// 字段名仍叫 movies 不是笔误，是刻意跟 utils/dataLoader.js 的 loadMoviesData() 通用壳子对齐，
// 让 pages/genericBookList 复用跟电影通用页完全一致的数据加载/缓存逻辑。
// 标记查 BookMarks（不是 Marks），供 utils/dataLoader.js 的 processBookMarks 消费。
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
                ? await readAll(db.collection('BookMarks').where({ openid }))
                : [];
            return { success: true, movies: [], marks, listVersion: null };
        }

        const booksQuery = db.collection('generic_theme_books')
            .where({ theme })
            .orderBy(orderByField, orderDirection);

        const [books, marks] = await Promise.all([
            readAll(booksQuery),
            openid ? readAll(db.collection('BookMarks').where({ openid })) : Promise.resolve([])
        ]);

        return { success: true, movies: books, marks, listVersion: null };
    } catch (err) {
        console.error('getThemeBooks 失败:', err);
        return { success: false, error: err.message, movies: [], marks: [] };
    }
};
