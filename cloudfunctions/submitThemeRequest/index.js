// cloudfunctions/submitThemeRequest/index.js
// 片单/书单需求收集：记录用户在 category 页提交的榜单需求，写入 theme_requests 集合。
// 后台人工查看该集合决定新主题排期（status: pending → done/rejected 由运营手工维护）。
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const COLLECTION = 'theme_requests';
const MAX_CONTENT_LEN = 200;
const DAILY_LIMIT = 5; // 单用户每天最多提交条数，防刷

// 北京时间日期串 YYYY-MM-DD，用于每日限频统计
function cnDateStr() {
    return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

exports.main = async (event, context) => {
    const { OPENID } = cloud.getWXContext();
    const type = ['movie', 'book', 'other'].includes(event && event.type) ? event.type : 'other';
    const content = String((event && event.content) || '').trim();

    if (!OPENID) return { success: false, error: '获取用户身份失败' };
    if (!content) return { success: false, error: '内容不能为空' };
    if (content.length > MAX_CONTENT_LEN) {
        return { success: false, error: `内容请控制在 ${MAX_CONTENT_LEN} 字以内` };
    }

    const dateStr = cnDateStr();
    const doc = {
        openid: OPENID,
        type,            // 'movie' 片单 | 'book' 书单 | 'other'
        content,
        dateStr,
        status: 'pending',
        createTime: db.serverDate()
    };

    try {
        const countRes = await db.collection(COLLECTION).where({ openid: OPENID, dateStr }).count();
        if (countRes.total >= DAILY_LIMIT) {
            return { success: false, error: '今天提交的许愿够多啦，明天再来吧' };
        }
        await db.collection(COLLECTION).add({ data: doc });
        return { success: true };
    } catch (err) {
        // 集合不存在时自动创建后重试一次（首次部署免去控制台手工建集合）
        if (err.errCode === -502005 || /not exist/i.test(err.errMsg || err.message || '')) {
            try {
                await db.createCollection(COLLECTION);
                await db.collection(COLLECTION).add({ data: doc });
                return { success: true };
            } catch (retryErr) {
                console.error('submitThemeRequest 建集合重试失败:', retryErr);
                return { success: false, error: retryErr.message };
            }
        }
        console.error('submitThemeRequest 失败:', err);
        return { success: false, error: err.message };
    }
};
