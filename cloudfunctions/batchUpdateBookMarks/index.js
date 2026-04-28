// cloudfunctions/batchUpdateBookMarks/index.js
// 豆瓣读书 TOP250 批量标记。集合：BookMarks。
// 与 batchUpdateMarks 的差异：
//   - 字段名 bookId（非 movieId）
//   - status='unread' 时直接删除记录，避免无意义条目堆积
//     （这是与电影线 'unwatched' 写入空记录的有意分歧）

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

exports.main = async (event) => {
    const { bookIds, status, openid } = event;

    if (!Array.isArray(bookIds) || bookIds.length === 0 || !status || !openid) {
        return { success: false, error: '参数不完整' };
    }
    if (!['read', 'wish', 'unread'].includes(status)) {
        return { success: false, error: 'status 仅支持 read/wish/unread' };
    }

    const now = new Date().toISOString();
    const _ = db.command;

    try {
        // 一次性查出该用户在这些图书上已有的标记
        const existingRes = await db.collection('BookMarks')
            .where({ openid, bookId: _.in(bookIds) })
            .get();
        const existingMap = {};
        existingRes.data.forEach((m) => { existingMap[m.bookId] = m; });

        const updateTasks = [];
        const addTasks = [];
        const deleteTasks = [];

        bookIds.forEach((bookId) => {
            const existing = existingMap[bookId];

            if (status === 'unread') {
                // 取消标记：有记录则删，没有就跳过
                if (existing) {
                    deleteTasks.push(
                        db.collection('BookMarks').doc(existing._id).remove()
                    );
                }
                return;
            }

            if (existing) {
                updateTasks.push(
                    db.collection('BookMarks').doc(existing._id).update({
                        data: { status, marked_at: now }
                    })
                );
            } else {
                addTasks.push(
                    db.collection('BookMarks').add({
                        data: { bookId, openid, status, marked_at: now }
                    })
                );
            }
        });

        await Promise.all([...updateTasks, ...addTasks, ...deleteTasks]);

        return {
            success: true,
            updated: updateTasks.length,
            added: addTasks.length,
            deleted: deleteTasks.length
        };
    } catch (err) {
        console.error('batchUpdateBookMarks 失败:', err);
        return { success: false, error: err.message };
    }
};
