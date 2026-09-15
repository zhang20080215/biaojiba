// 重定向桩：中国国家一级博物馆页面已并入 pages/scenic（?theme=museum）。
// 线上已分发的分享卡片 / 搜索直达 / 后台配置的落地路径仍指向这里，保留路径只做跳转。
Page({
  onLoad(options) {
    wx.redirectTo({ url: '/pages/scenic/list/list?theme=museum' });
  }
});
