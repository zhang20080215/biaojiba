// cloudfunctions/getProvinces/index.js
// 全国旅游省份读取函数：读 travel_provinces 全量（按 rank 升序）+ 该用户的 Marks，
// 返回形状与 getScenicSpots / getThemeMovies 对齐（{ success, movies, marks, listVersion }），
// 以便前端复用 utils/dataLoader.js + processMarks（去过=watched、想去=wish 语义与电影线一致）。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const MAX_LIMIT = 100;

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

exports.main = async (event) => {
    const { openid, marksOnly } = event || {};

    try {
        if (marksOnly) {
            const marks = openid
                ? await readAll(db.collection('Marks').where({ openid }))
                : [];
            return { success: true, movies: [], marks, listVersion: null };
        }

        const listQuery = db.collection('travel_provinces').orderBy('rank', 'asc');
        const [movies, marks] = await Promise.all([
            readAll(listQuery),
            openid ? readAll(db.collection('Marks').where({ openid })) : Promise.resolve([])
        ]);

        return { success: true, movies, marks, listVersion: null };
    } catch (err) {
        console.error('getProvinces 失败:', err);
        return { success: false, error: err.message, movies: [], marks: [] };
    }
};
