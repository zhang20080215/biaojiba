// cloudfunctions/backfillRequestNicknames/index.js
// 一次性运维脚本：给 theme_requests 里缺 nickname 的老记录，按 openid 从 users 表回填昵称。
// 用法：云端测试直接运行（无需参数）。可重复运行，只补缺失的、不覆盖已有的。
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const MAX_LIMIT = 100;

exports.main = async () => {
    const col = db.collection('theme_requests');
    // 缺 nickname：字段不存在 / 空串 / null
    const missWhere = _.or([
        { nickname: _.exists(false) },
        { nickname: '' },
        { nickname: null }
    ]);

    try {
        const countRes = await col.where(missWhere).count();
        const total = countRes.total;
        if (total === 0) return { success: true, total: 0, updated: 0, skipped: 0, msg: '没有需要回填的记录' };

        // 1. 分页取出所有缺昵称的记录（只要 openid）
        let docs = [];
        const times = Math.ceil(total / MAX_LIMIT);
        for (let i = 0; i < times; i++) {
            const r = await col.where(missWhere).skip(i * MAX_LIMIT).limit(MAX_LIMIT).field({ openid: true }).get();
            docs = docs.concat(r.data);
        }

        // 2. 去重 openid，批量查 users 表构建 openid→nickname
        const openids = [...new Set(docs.map(d => d.openid).filter(Boolean))];
        const nickMap = {};
        for (let i = 0; i < openids.length; i += 20) {
            const chunk = openids.slice(i, i + 20);
            const ur = await db.collection('users').where({ openid: _.in(chunk) }).get();
            ur.data.forEach(u => {
                if (u.nickname) nickMap[u.openid] = String(u.nickname).slice(0, 50);
            });
        }

        // 3. 逐条更新（users 表查不到昵称的跳过，保持空）
        let updated = 0, skipped = 0;
        for (const d of docs) {
            const nk = nickMap[d.openid];
            if (!nk) { skipped++; continue; }
            try {
                await col.doc(d._id).update({ data: { nickname: nk } });
                updated++;
            } catch (e) {
                console.error('更新失败', d._id, e && e.message);
            }
        }

        return {
            success: true,
            total,
            updated,
            skipped,
            note: skipped ? `${skipped} 条在 users 表查不到昵称（用户未完善资料），保持昵称为空` : ''
        };
    } catch (err) {
        console.error('backfillRequestNicknames 失败:', err);
        return { success: false, error: err.message };
    }
};
