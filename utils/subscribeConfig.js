// 订阅消息模板 ID 集中管理
// 留空时前端订阅按钮 disable + toast 提示"功能即将开放"
// 拿到正式模板 ID 后填入对应字段即可生效；同时记得给云函数
// pushTop250NewEntries 配上环境变量 TOP250_NEW_ENTRY_TPL_ID

const TEMPLATES = {
  // 豆瓣 TOP250 新片入榜提醒
  top250NewEntry: '',
  // 豆瓣 TOP250 排名变化提醒
  top250RankChange: ''
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
