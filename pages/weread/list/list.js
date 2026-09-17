// 重定向桩：微信读书 TOP200 总榜页面已并入 pages/genericBookList（?theme=weread_books）。
// 线上已分发的分享卡片 / 搜索直达 / 后台配置的落地路径仍指向这里，保留路径只做跳转。
Page({
  onLoad() {
    wx.redirectTo({ url: '/pages/genericBookList/list/list?theme=weread_books' });
  }
});
