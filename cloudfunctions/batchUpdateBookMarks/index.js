// cloudfunctions/batchUpdateBookMarks/index.js
// 图书批量标记。集合：BookMarks（豆瓣读书 + 微信读书共用，通过 source 字段区分）。
// 字段：bookId, openid, status, marked_at, source('douban' | 'weread')
// 老记录无 source 字段，runtime 视为 'douban'（向后兼容）。
// status='unread' 时直接删除记录，避免无意义条目堆积。

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

exports.main = async (event) => {
    const { bookIds, status, openid, source } = event;

    if (!Array.isArray(bookIds) || bookIds.length === 0 || !status || !openid) {
        return { success: false, error: '参数不完整' };
    }
    if (!['read', 'wish', 'unread'].includes(status)) {
        return { success: false, error: 'status 仅支持 read/wish/unread' };
    }

    // source 默认为 'douban'（向后兼容老调用）
    const effectiveSource = source === 'weread' ? 'weread' : 'douban';
    const now = new Date().toISOString();
    const _ = db.command;

    try {
        // 一次性查出该用户在这些图书上已有的标记
        // douban 源：兼容老记录（无 source 字段视为 douban）
        // weread 源：仅匹配 source='weread' 的记录
        const sourceFilter = effectiveSource === 'weread'
            ? { source: 'weread' }
            : { source: _.or([_.eq('douban'), _.exists(false)]) };

        const existingRes = await db.collection('BookMarks')
            .where({ openid, bookId: _.in(bookIds), ...sourceFilter })
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
                        data: { status, marked_at: now, source: effectiveSource }
                    })
                );
            } else {
                addTasks.push(
                    db.collection('BookMarks').add({
                        data: { bookId, openid, status, marked_at: now, source: effectiveSource }
                    })
                );
            }
        });

        await Promise.all([...updateTasks, ...addTasks, ...deleteTasks]);

        return {
            success: true,
            source: effectiveSource,
            updated: updateTasks.length,
            added: addTasks.length,
            deleted: deleteTasks.length
        };
    } catch (err) {
        console.error('batchUpdateBookMarks 失败:', err);
        return { success: false, error: err.message };
    }
};
