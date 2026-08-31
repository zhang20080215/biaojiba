// 通用订阅消息授权回报：给 (openid, topic) 增加推送配额
// 入参: { topic, templateId, accepted: true, theme? }
//   topic    业务订阅类型（如 top250_new_entry / top250_rank_change），决定 pushSubscribeMessages 时分发到哪个渲染配置
//   templateId 本次授权对应的模板 ID（用来发送，可换；以 topic 为业务唯一键，模板换不影响配额）
//   theme    可选元数据（如 douban / imdb），仅作记录方便后续查询
//   deferToNextDay 这次授权最早只能在「明天」用掉（每日填字用：用户点的是「看明天的题」，
//              当天再推一条毫无意义）。记成 notBeforeDate，由 pushSubscribeMessages 过滤
// 返回: { success, remaining }

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const quotaCollection = db.collection('SubscribeQuota');

/** 北京时间的 YYYY-MM-DD（云函数跑在 UTC） */
function cnDateStr(ms) {
  const d = new Date((ms == null ? Date.now() : ms) + 8 * 3600 * 1000);
  const p = n => (n < 10 ? '0' : '') + n;
  return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate());
}

exports.main = async (event, context) => {
  const { topic, templateId, accepted, theme, deferToNextDay } = event;
  const wxContext = cloud.getWXContext();
  const openid = wxContext && wxContext.OPENID;

  if (!openid) return { success: false, error: 'NO_OPENID' };
  if (!topic || !templateId) return { success: false, error: 'INVALID_PARAMS' };
  if (!accepted) return { success: false, error: 'NOT_ACCEPTED' };

  try {
    // 明天才生效的授权：算的是北京时间的明天，不信客户端时钟
  const notBeforeDate = deferToNextDay === true ? cnDateStr(Date.now() + 86400000) : null;

    const existRes = await quotaCollection.where({ openid, topic }).limit(1).get();
    if (existRes.data && existRes.data.length > 0) {
      const doc = existRes.data[0];
      await quotaCollection.doc(doc._id).update({
        data: {
          templateId,                        // 保持最新 templateId
          theme: theme || doc.theme || null,
          // 配额是一个池子，同一个人多次授权可能一次带生效日期一次不带。
          // 取宽松的那个：任一次是「立刻可用」就不再设限，否则取较早的日期。
          notBeforeDate: (!doc.notBeforeDate || !notBeforeDate)
            ? null
            : (doc.notBeforeDate < notBeforeDate ? doc.notBeforeDate : notBeforeDate),
          remaining: _.inc(1),
          updatedAt: db.serverDate()
        }
      });
      return { success: true, remaining: (doc.remaining || 0) + 1 };
    }

    await quotaCollection.add({
      data: {
        openid,
        topic,
        templateId,
        theme: theme || null,
        notBeforeDate,
        remaining: 1,
        createdAt: db.serverDate(),
        updatedAt: db.serverDate()
      }
    });
    return { success: true, remaining: 1 };
  } catch (err) {
    console.error('subscribeMessage 失败:', err && err.message);
    return { success: false, error: err && err.message };
  }
};
