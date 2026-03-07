// cloudfunctions/getMoviesData/index.js
// 聚合云函数：一次性加载电影列表 + 用户标记，减少客户端 API 调用次数

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const MAX_LIMIT = 100; // 云函数端单次最多读 1000，100 条一批足够快

/**
 * 分批读取集合数据（云函数端无 20 条限制，但建议批量到 100 以内）
 */
async function readAll(collectionName, query) {
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
    const { theme, openid, marksOnly } = event;
    // theme: 'douban' | 'imdb'
    // marksOnly: 只返回标记，跳过电影列表查询（缓存命中后的轻量刷新）

    try {
        // 仅刷新标记，不重新拉取电影列表
        if (marksOnly) {
            const marks = openid
                ? await readAll('Marks', db.collection('Marks').where({ openid }))
                : [];
            return { success: true, movies: [], marks };
        }

        const collectionName = theme === 'imdb' ? 'imdb_movies' : 'movies';
        const _ = db.command;

        // 并发查询：电影列表 + 用户标记（如果有 openid）
        const moviesQuery = db
            .collection(collectionName)
            .where({ isTop250: _.neq(false) })
            .orderBy('rank', 'asc');

        const [movies, marks] = await Promise.all([
            readAll(collectionName, moviesQuery),
            openid
                ? readAll('Marks', db.collection('Marks').where({ openid }))
                : Promise.resolve([])
        ]);

        return { success: true, movies, marks };
    } catch (err) {
        console.error('getMoviesData 失败:', err);
        return { success: false, error: err.message, movies: [], marks: [] };
    }
};
