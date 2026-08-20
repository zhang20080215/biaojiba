// app.js
var adConfig = require('./utils/adConfig')
var { track } = require('./utils/track')

App({
  onShow(options) {
    // 每次启动/回到前台埋点场景值（1007/1008 会话、1044 朋友圈、1047 扫码等），用于分享/回流来源分析
    track('app_open', { scene: (options && options.scene) || 0 })
  },

  onLaunch() {
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力')
    } else {
      wx.cloud.init({
        env: 'cloud1-3gn3wryx716919c6',  // 使用固定的环境ID
        traceUser: true,
      })
    }

    // 主题色一次性载入内存，后续全站读 globalData.theme，避免各页重复 getStorageSync('appTheme')
    try {
      this.globalData.theme = wx.getStorageSync('appTheme') || 'theme-green'
    } catch (e) {
      this.globalData.theme = 'theme-green'
    }

    // 版本更新：微信默认「静默下载 + 下次冷启动才生效」，一个修复铺开可能拖好几天。
    // v1.0.46 修掉激励广告闸门的线上 P0 后，老版本用户仍在继续被卡，就是因为缺这个入口。
    // 必须同步注册（不能塞进下面的 setTimeout）——回调要早于「下载完成」事件到达。
    try {
      var updateManager = wx.getUpdateManager && wx.getUpdateManager()
      if (updateManager) {
        // 默认**不弹窗**：微信本来就会在下次冷启动应用已下载的新版，平时提示只能
        // 提前一次冷启动，而本项目两三天一个版本，默认弹窗一个月要打扰用户七八次。
        // 只有云端 app_config 把 forceUpdatePrompt 打开时（出 P0 需要快速铺开修复）
        // 才提示。开关走已有的远程配置通道，改完下次冷启动即生效，不用发版。
        var promptUpdate = function (retried) {
          if (adConfig.shouldPromptUpdate()) {
            // 保留取消按钮：applyUpdate 会强制重启小程序，用户可能正在填育儿评估
            // 表单或批量标记榜单，强制打断会丢数据。点「稍后」退回微信原本的行为。
            wx.showModal({
              title: '有新版本',
              content: '新版本已经准备好，重启后生效',
              confirmText: '立即重启',
              cancelText: '稍后',
              success: function (res) {
                if (res.confirm) updateManager.applyUpdate()
              }
            })
            return
          }
          // onUpdateReady 和远程配置是两条独立的异步线，可能配置还没拉回来。
          // 给一次重试；仍未打开就静默，交给微信下次冷启动自然生效。
          if (!retried && !adConfig.isRemoteFetched()) {
            setTimeout(function () { promptUpdate(true) }, 3000)
          }
        }
        updateManager.onUpdateReady(function () { promptUpdate(false) })
        updateManager.onUpdateFailed(function () {
          // 静默：下次启动微信会自己重试，不打扰用户
          console.warn('[app] 新版本下载失败')
        })
      }
    } catch (e) { /* 低版本基础库无此能力，忽略 */ }

    // 非关键启动任务延迟到首屏渲染后发起，避免阻塞 onLaunch 同步路径
    setTimeout(() => {
      // 拉取远程广告配置（含一次本地缓存读取）
      adConfig.fetchRemoteConfig()

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
    }, 0);
  },

  globalData: {
    openid: null,
    // 主题色：'' (默认粉色) | 'theme-gold' (暖金) | 'theme-green' (橄榄绿) | 'theme-sand' (暖沙)
    theme: 'theme-green'
  }
});
