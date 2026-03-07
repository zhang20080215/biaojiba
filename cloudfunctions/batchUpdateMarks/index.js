// cloudfunctions/batchUpdateMarks/index.js
// 批量更新/新增标记，服务端处理循环，客户端只需一次调用

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

exports.main = async (event, context) => {
    const { movieIds, status, openid } = event;

    if (!movieIds || !movieIds.length || !status || !openid) {
        return { success: false, error: '参数不完整' };
    }

    const now = new Date().toISOString();

    try {
        // 一次性查出用户在这些电影上已有的标记
        const _ = db.command;
        const existingRes = await db.collection('Marks')
            .where({ openid, movieId: _.in(movieIds) })
            .get();

        const existingMap = {};
        existingRes.data.forEach(m => { existingMap[m.movieId] = m; });

        // 分别处理更新和新增
        const updateTasks = [];
        const addTasks = [];

        movieIds.forEach(movieId => {
            if (existingMap[movieId]) {
                updateTasks.push(
                    db.collection('Marks').doc(existingMap[movieId]._id).update({
                        data: { status, marked_at: now }
                    })
                );
            } else {
                addTasks.push(
                    db.collection('Marks').add({
                        data: { movieId, openid, status, marked_at: now }
                    })
                );
            }
        });

        await Promise.all([...updateTasks, ...addTasks]);

        return {
            success: true,
            updated: updateTasks.length,
            added: addTasks.length
        };
    } catch (err) {
        console.error('batchUpdateMarks 失败:', err);
        return { success: false, error: err.message };
    }
};
