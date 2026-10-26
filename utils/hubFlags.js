// 底部 tab 页的发布开关（改这里即可，不用动页面结构）。
// recordsOpen=false：「记录」tab 保留入口但显示「打磨中」蒙版，不拉时间轴、不发 markTimeline 请求。
// 未开放时 pages/records/index.json 关了下拉刷新（没有可刷新的数据）；开放时改回 true。
// 各列表页的标记事件仍照常写入本地待同步队列并上传，开放时已有历史可看。
module.exports = {
  recordsOpen: false
};
