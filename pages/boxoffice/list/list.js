// 重定向桩：全球电影票房榜页面已并入 pages/genericList（?theme=boxoffice）。
// 线上已分发的分享卡片 / 搜索直达 / 后台配置的落地路径仍指向这里，保留路径只做跳转。
Page({
  onLoad() {
    wx.redirectTo({ url: '/pages/genericList/list/list?theme=boxoffice' });
  }
});
