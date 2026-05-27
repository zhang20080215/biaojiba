// 通用订阅消息推送：扫 push_events 未推送事件，按 topic 派发到对应模板
// 加新 topic 只需在 TOPIC_CONFIG 表里加一行 + 给云函数加对应环境变量，不需要新建云函数 / 定时器
// 建议挂定时触发器：每日 04:30（在 fetchMovies 04:00 之后）

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const MAX_LIMIT = 100;

// ───────── topic 配置表（加新订阅在这里加一行即可）─────────
// envVar: 模板 ID 来自哪个环境变量
// page: 点击消息跳转的小程序内页面
// render(payload, evt): 把事件 payload 渲染成微信模板的 data 字段
const TOPIC_CONFIG = {
  top250NewEntry: {
    envVar: 'TOP250_NEW_ENTRY_TPL_ID',
    page: 'pages/douban/list/list',
    render: (payload, evt) => {
      const entries = (payload && payload.entries) || [];
      const headline = entries.slice(0, 3).map(e => e.title).join('、');
      const more = entries.length > 3 ? ` 等${entries.length}部` : '';
      return {
        thing1: { value: (headline + more).slice(0, 20) },
        number2: { value: entries.length },
        date3: { value: evt.eventDate || new Date().toISOString().slice(0, 10) }
      };
    }
  },
  top250RankChange: {
    envVar: 'TOP250_RANK_CHANGE_TPL_ID',
    page: 'pages/douban/list/list',
    render: (payload, evt) => {
      const changes = (payload && payload.changes) || [];
      const top = [...changes].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
      const headline = top.slice(0, 3).map(c => {
        const arrow = c.delta < 0 ? '↑' : '↓';
        return `${c.title}${arrow}${Math.abs(c.delta)}`;
      }).join('、');
      const more = changes.length > 3 ? ` 等${changes.length}部` : '';
      return {
        thing1: { value: (headline + more).slice(0, 20) },
        number2: { value: changes.length },
        date3: { value: evt.eventDate || new Date().toISOString().slice(0, 10) }
      };
    }
  }
};

async function readAll(collection, query) {
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
  let pendingEvents;
  try {
    pendingEvents = await readAll(
      'push_events',
      db.collection('push_events').where({ pushedAt: null })
    );
  } catch (e) {
    return { success: false, error: 'READ_EVENTS_FAIL', detail: e && e.message };
  }

  if (pendingEvents.length === 0) {
    return { success: true, pushedEvents: 0, pushedMessages: 0 };
  }

  let pushedEvents = 0;
  let pushedMessages = 0;
  const skipped = [];

  for (const evt of pendingEvents) {
    const config = TOPIC_CONFIG[evt.topic];
    if (!config) {
      skipped.push({ topic: evt.topic, reason: 'unknown_topic' });
      continue;
    }
    const templateId = process.env[config.envVar];
    if (!templateId) {
      // 模板未配置：事件保留 pushedAt=null，等模板就绪后下次跑还能推
      skipped.push({ topic: evt.topic, reason: 'no_template' });
      continue;
    }

    let quotaUsers;
    try {
      quotaUsers = await readAll(
        'SubscribeQuota',
        db.collection('SubscribeQuota').where({ topic: evt.topic, remaining: _.gt(0) })
      );
    } catch (e) {
      console.error(`读 SubscribeQuota 失败 (topic=${evt.topic}):`, e && e.message);
      continue;
    }

    let data;
    try {
      data = config.render(evt.payload || {}, evt);
    } catch (e) {
      console.error(`render 失败 (topic=${evt.topic}):`, e && e.message);
      continue;
    }

    let eventPushCount = 0;
    for (const user of quotaUsers) {
      try {
        await cloud.openapi.subscribeMessage.send({
          touser: user.openid,
          templateId,
          page: config.page,
          data
        });
        await db.collection('SubscribeQuota').doc(user._id).update({
          data: { remaining: _.inc(-1), updatedAt: db.serverDate() }
        });
        eventPushCount += 1;
        pushedMessages += 1;
      } catch (err) {
        console.error(`推送给 ${user.openid} 失败 (topic=${evt.topic}):`, err && err.errMsg);
      }
    }

    try {
      await db.collection('push_events').doc(evt._id).update({
        data: { pushedAt: db.serverDate(), pushedCount: eventPushCount }
      });
      pushedEvents += 1;
    } catch (e) {
      console.error('标记事件已推送失败:', e && e.message);
    }
  }

  return { success: true, pushedEvents, pushedMessages, skipped };
};
