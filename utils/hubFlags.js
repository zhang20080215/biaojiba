// 底部 tab 页的发布开关（改这里即可，不用动页面结构）。
// recordsOpen=false：「记录」tab 保留入口但显示「打磨中」蒙版，不拉时间轴、不发 markTimeline 请求。
// 下拉刷新（pages/records/index.json）常开：蒙版态下 hubPage.onPullDownRefresh 直接收起不刷新。
// 这个本地常量是「发版强制开放」；不发版的开放走云端 app_config 的灰度（grayRollout.records_open 全员 / 百分比，
// grayForceIn.records_open 指定 openid，见 utils/adConfig.js），任一为开即放开。
// 各列表页的标记事件仍照常写入本地待同步队列并上传，开放时已有历史可看。
module.exports = {
  recordsOpen: false
};
