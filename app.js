// app.js
var adConfig = require('./utils/adConfig')
var { track } = require('./utils/track')

// 「免广告已开通」弹窗只弹一次。存的是 openid，同设备换号 / 撤销后重新加白都能再弹。
var AD_FREE_NOTIFIED_KEY = 'ad_free_notified'

// 各页面渲染广告用的显隐布尔字段。全项目的广告都是 <ad>/<ad-custom> 绑 adUnitIds.xxx，
// 把 adUnitIds 清空即可移除；这两个 flag 是外层容器，一并收掉免得留下空白占位。
var AD_VISIBILITY_FLAGS = ['showNativeAd', 'showBannerAd']

App({
  onShow(options) {
    // 每次启动/回到前台埋点场景值（1007/1008 会话、1044 朋友圈、1047 扫码等），用于分享/回流来源分析
    track('app_open', { scene: (options && options.scene) || 0 })

    // 每次进入小程序都刷一次远程广告配置 + 会员状态（两者内部各有 3 秒节流）。
    // onShow 冷启动和热启动都会触发，而 onLaunch 只在冷启动触发——会员开通要做到
    // 「加完表后用户下一次进入即生效」，就必须挂在这里：热启动（从「最近使用」打开、
    // 保活期内切回前台）根本不走 onLaunch。
    // 放进 setTimeout 是不占启动同步路径，与 onLaunch 里那次保持一致。
    setTimeout(function () {
      adConfig.fetchRemoteConfig()
      adConfig.refreshAdFree()
    }, 0)
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

    // 会员状态翻转时的处理：立刻撤掉当前页面上已经渲染出来的广告，
    // 并给刚开通的用户弹一次确认。必须在 refreshAdFree 之前注册好。
    adConfig.onAdFreeChange((adFree) => {
      if (adFree) {
        this.clearAdsOnLivePages()
        this.notifyAdFreeGranted()
      } else {
        // 被撤销/到期：清掉「已通知」标记，将来续期或重新开通时还能再弹一次。
        // 广告本身不用管，用户进入下一个页面时自然恢复。
        try { wx.removeStorageSync(AD_FREE_NOTIFIED_KEY) } catch (e) { /* ignore */ }
      }
    })

    // 非关键启动任务延迟到首屏渲染后发起，避免阻塞 onLaunch 同步路径
    setTimeout(() => {
      // 拉取远程广告配置（含一次本地缓存读取）
      adConfig.fetchRemoteConfig()

      // 查会员状态。openid 由云函数从 wxContext 取，不依赖下面这行 ensureOpenid，
      // 所以两者顺序无关、并行即可。
      adConfig.refreshAdFree()

      // 获取用户 openid
      this.ensureOpenid()
    }, 0);
  },

  /**
   * 拉取 openid，失败自动退避重试；已有则直接返回。
   *
   * 为什么要重试：openid 拿不到时 rewardedSaveGate.isGated 首行就 return false，
   * 广告闸门对这个用户**整个会话永久失效**（历史埋点里约 17% 的保存没触发闸门，
   * 大概率就是这条路径）。原来只在启动时打一次，失败就再也没有第二次机会。
   *
   * 也可由业务方按需调用（如 awaitOpenid 发现仍为空时补一次），
   * 覆盖「启动那几秒失败、用户很久之后才去保存海报」的情况。
   */
  ensureOpenid() {
    if (this.globalData.openid) return
    if (this._openidFetching) return          // 已有一次在飞，别叠加
    if (!wx.cloud) return
    this._openidFetching = true

    var attempt = this._openidAttempt || 0
    var self = this
    var onDone = function (openid) {
      self._openidFetching = false
      if (openid) {
        self.globalData.openid = openid
        self._openidAttempt = 0
        return
      }
      // 退避重试 1s / 2s / 4s，共 3 次；再失败就交给后续 ensureOpenid 调用
      self._openidAttempt = attempt + 1
      if (self._openidAttempt >= 3) return
      setTimeout(function () { self.ensureOpenid() }, 1000 * Math.pow(2, attempt))
    }

    try {
      wx.cloud.callFunction({
        name: 'getOpenid',
        success: function (res) {
          onDone(res && res.result && res.result.openid)
        },
        fail: function (err) {
          console.error('[app] getOpenid 调用失败:', err && (err.errMsg || err))
          onDone(null)
        }
      })
    } catch (e) {
      console.error('[app] getOpenid 抛错:', e)
      onDone(null)
    }
  },

  /**
   * 立刻撤掉当前所有存活页面上已经渲染出来的广告。
   *
   * 为什么需要：页面是在 onLoad 里同步取 unitId 的，等云端名单异步到达时那一步早过去了。
   * 不扫这一遍的话，用户当次进入仍会看着广告，直到重新进入该页面。
   *
   * 全项目每个广告位都是 <ad>/<ad-custom> 绑 adUnitIds.xxx（已核对：banner、原生、
   * 信息流、每日电影 banner 无一例外），所以把 adUnitIds 的每个 key 置空就是通用解，
   * 不用逐页写适配。
   */
  clearAdsOnLivePages() {
    var pages = []
    try {
      pages = (typeof getCurrentPages === 'function' && getCurrentPages()) || []
    } catch (e) {
      return
    }
    for (var i = 0; i < pages.length; i++) {
      var page = pages[i]
      if (!page || !page.data || typeof page.setData !== 'function') continue

      var patch = {}
      var ids = page.data.adUnitIds
      if (ids) {
        var keys = Object.keys(ids)
        for (var j = 0; j < keys.length; j++) {
          if (ids[keys[j]]) patch['adUnitIds.' + keys[j]] = ''
        }
      }
      for (var k = 0; k < AD_VISIBILITY_FLAGS.length; k++) {
        if (page.data[AD_VISIBILITY_FLAGS[k]] === true) patch[AD_VISIBILITY_FLAGS[k]] = false
      }

      if (Object.keys(patch).length === 0) continue
      try {
        page.setData(patch)
      } catch (e) {
        console.warn('[app] 撤广告失败:', page.route, e)
      }
    }
  },

  /**
   * 给刚开通的用户弹一次确认，之后不再弹（按 openid 记）。
   *
   * 延迟 1.2 秒有两个原因：一是避开 onUpdateReady 那个「有新版本」弹窗，
   * 两个 showModal 撞在一起后一个会被丢掉；二是让首屏先渲染完再打断。
   * 文案避开「免费 / 解锁 / 无限制 / 奖励」等《小程序广告规范》敏感措辞。
   */
  notifyAdFreeGranted() {
    var openid = this.globalData.openid
    if (!openid) return
    try {
      if (wx.getStorageSync(AD_FREE_NOTIFIED_KEY) === openid) return
      wx.setStorageSync(AD_FREE_NOTIFIED_KEY, openid)
    } catch (e) { /* ignore */ }

    setTimeout(function () {
      wx.showModal({
        title: '会员已开通',
        content: '小程序内的广告已经关闭，保存图片也不用再看视频了。感谢支持！',
        showCancel: false,
        confirmText: '知道了',
      })
    }, 1200)
  },

  globalData: {
    openid: null,
    // 主题色：'theme-green' (橄榄绿，默认) | '' (粉色) | 'theme-gold' (暖金) | 'theme-sand' (暖沙)
    theme: 'theme-green'
  }
});
