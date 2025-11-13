// app.js
App({
  onLaunch() {
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力')
    } else {
      wx.cloud.init({
        env: 'cloud1-3gn3wryx716919c6',  // 使用固定的环境ID
        traceUser: true,
      })
    }

    // 获取用户openid
    wx.cloud.callFunction({
      name: 'getOpenid',
      success: res => {
        console.log('云函数调用成功，完整返回：', res);
        if (res.result && res.result.openid) {
          this.globalData.openid = res.result.openid;
        }
      },
      fail: err => {
        console.error('云函数调用失败，错误详情：', err);
      }
    });
  },

  globalData: {
    openid: null
  }
});
