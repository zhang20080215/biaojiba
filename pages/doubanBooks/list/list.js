// 重定向桩：豆瓣读书 TOP250页面已并入 pages/genericBookList（?theme=douban_books）。
// 线上已分发的分享卡片 / 搜索直达 / 后台配置的落地路径仍指向这里，保留路径只做跳转。
Page({
  onLoad() {
    wx.redirectTo({ url: '/pages/genericBookList/list/list?theme=douban_books' });
  }
});
