// 删除"最近查询"列表中的一条记录
// 入参: { doubanId: string, openid?: string }（openid 默认从 wxContext 取）
// 仅从 user_movie_queries 集合移除当前用户的对应 record；searched_movies 主数据不动
// （主数据是跨用户共享的，可能其它用户的历史里还引用）
// 返回: { success, deleted: number }

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

exports.main = async (event, context) => {
  const wxCtx = cloud.getWXContext() || {};
  const openid = (event && event.openid) || wxCtx.OPENID;
  const doubanId = String((event && event.doubanId) || '').trim();

  if (!openid) return { success: false, error: 'NO_OPENID' };
  if (!doubanId) return { success: false, error: 'EMPTY_DOUBAN_ID' };

  try {
    const res = await db.collection('user_movie_queries')
      .where({ openid, doubanId })
      .remove();
    const deleted = (res && res.stats && res.stats.removed) || 0;
    console.log(`[deleteMovieQuery] openid=${openid.slice(0, 6)}… doubanId=${doubanId} deleted=${deleted}`);
    return { success: true, deleted };
  } catch (e) {
    console.error('deleteMovieQuery 失败:', e && e.message);
    return { success: false, error: e && e.message };
  }
};
