// 通用订阅消息授权回报：给 (openid, topic) 增加推送配额
// 入参: { topic, templateId, accepted: true, theme? }
//   topic    业务订阅类型（如 top250_new_entry / top250_rank_change），决定 pushSubscribeMessages 时分发到哪个渲染配置
//   templateId 本次授权对应的模板 ID（用来发送，可换；以 topic 为业务唯一键，模板换不影响配额）
//   theme    可选元数据（如 douban / imdb），仅作记录方便后续查询
// 返回: { success, remaining }

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const quotaCollection = db.collection('SubscribeQuota');

exports.main = async (event, context) => {
  const { topic, templateId, accepted, theme } = event;
  const wxContext = cloud.getWXContext();
  const openid = wxContext && wxContext.OPENID;

  if (!openid) return { success: false, error: 'NO_OPENID' };
  if (!topic || !templateId) return { success: false, error: 'INVALID_PARAMS' };
  if (!accepted) return { success: false, error: 'NOT_ACCEPTED' };

  try {
    const existRes = await quotaCollection.where({ openid, topic }).limit(1).get();
    if (existRes.data && existRes.data.length > 0) {
      const doc = existRes.data[0];
      await quotaCollection.doc(doc._id).update({
        data: {
          templateId,                        // 保持最新 templateId
          theme: theme || doc.theme || null,
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
