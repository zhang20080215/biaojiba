// app.js
App({
  onLaunch() {
    // 在小程序启动时调用云函数来抓取豆瓣TOP250电影数据
    wx.cloud.callFunction({
      name: 'fetchMovies', // 云函数的名称
      success: res => {
        console.log('数据抓取成功', res);
      },
      fail: err => {
        console.error('数据抓取失败', err);
      }
    });
  }
});
