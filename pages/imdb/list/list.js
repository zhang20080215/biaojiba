// 重定向桩：IMDB电影TOP250页面已并入 pages/genericList（?theme=imdb）。
// 线上已分发的分享卡片 / 搜索直达 / 后台配置的落地路径仍指向这里，保留路径只做跳转。
Page({
  onLoad() {
    wx.redirectTo({ url: '/pages/genericList/list/list?theme=imdb' });
  }
});
