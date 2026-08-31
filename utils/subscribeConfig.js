// 订阅消息模板 ID 集中管理
// 留空时前端订阅按钮 disable + toast 提示"功能即将开放"
// 拿到正式模板 ID 后填入对应字段即可生效；同时记得给云函数
// pushTop250NewEntries 配上环境变量 TOP250_NEW_ENTRY_TPL_ID

const TEMPLATES = {
  // 豆瓣 TOP250 新片入榜提醒
  top250NewEntry: '5dwmndMuaw3O3v3oEq9PZDlYjxgmJHPistZYEpquHfc',
  // 豆瓣 TOP250 排名变化提醒（待申请）
  top250RankChange: '',
  // 每日喝水提醒（daily 主题，预留）
  dailyWaterReminder: 'BvLJBlkFNwROHvLjn64qyixXax6lDGjkh8Zbg5D8Mao',
  // 每日填字新题提醒（用户点「明天」时弹窗订阅，次日 10:00 推一条）
  // ⚠ 与 top250NewEntry 共用同一个模板（字段同为 任务名称/提醒时间/备注），
  // 微信侧的订阅次数是按「用户+模板」记的，两个 topic 会共享同一份授权额度。
  guessCrossDaily: '5dwmndMuaw3O3v3oEq9PZDlYjxgmJHPistZYEpquHfc'
};

function getTemplateId(key) {
  return TEMPLATES[key] || '';
}

function isTemplateReady(key) {
  return !!getTemplateId(key);
}

module.exports = {
  TEMPLATES,
  getTemplateId,
  isTemplateReady
};
