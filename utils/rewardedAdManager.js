const { getPlacement } = require('./adConfig')
const { track } = require('./track')

/**
 * 激励视频广告管理
 *
 * ── 关于实例 ──
 * wx.createRewardedVideoAd 对同一个 adUnitId **只有一个实例**（SDK 单例）。
 * 但它又是原生组件，绑定「最后一次 create 它的页面」——在别的页面调 show() 会抛
 * "you can only invoke show() on the page where rewardedVideoAd is created"。
 * 所以：每次 preload/show 都重新 create 一次（拿回同一个实例并重绑到当前页），
 * 而所有状态（监听器、素材就绪、当前等待者）都挂在**实例**上，天然跨页面共享。
 *
 * 历史坑（v1.0.40 线上事故，2026-08）：
 * 1. 之前把实例按页面缓存，跨页面走回头路时没重绑 → show() 直接抛错；
 * 2. 每次 show 都 onClose/onError 注册一遍，单例上监听器越积越多，
 *    旧页面的 handler 会在新页面弹出「未完整观看广告」；
 * 3. 播完后不 load 下一条，第二次 show() 素材没就绪必 reject；
 * 4. reject 出来的对象常常不带 errCode（错误码走 onError 单独下发），
 *    只放行 1004/1005 的写法把其余全判成失败 → 弹「广告加载失败」并拒绝保存。
 * 「每次保存都看广告」的策略下，第 2 次保存是每个用户的必经路径，于是全量卡死。
 *
 * ── 现在的约定 ──
 * · 监听器只绑一次（实例上打 __xbjBound 标记），用「当前等待者」分发结果；
 * · onClose 后立刻 load 下一条，为下一次保存备料；
 * · show 前若素材没就绪，先 load 并给一个轻量 loading，避免用户干等；
 * · 广告侧任何失败（无填充/内部错误/超时/无广告位）一律**放行保存**。
 *   广告是变现手段，不能挡住用户存图——只有「用户主动中途关掉视频」才拦。
 */

// 从点保存到广告真正出现的兜底时限。超时即放行：
// load() 有可能既不 resolve 也不 reject，否则页面会永远卡在「生成中」。
var SHOW_TIMEOUT_MS = 6000
// 广告已经显示出来之后，等 onClose 的兜底时限。正常激励视频不超过 60s，
// 这里只防「回调永远不来」导致等待者残留、把后续所有 show 都挡住。
var CLOSE_TIMEOUT_MS = 180000
// reject 出来的错误对象基本不带 errCode，真码由 onError 单独下发，而且常常比
// reject 晚到一点。失败时先放行用户，把「上报」挂起这么久等真码回填，等不到
// 才按 showfail_0 记。只延迟埋点，不延迟保存。
var LATE_ERR_WINDOW_MS = 1000

// ── 熔断兜底 ──
// 连续多次广告侧异常（不含无填充/用户主动关闭）后，本地自动停闸一段时间。
// 目的：万一广告链路又出问题，用户不必每次保存都白等 6 秒超时，也不必等
// 云端改 app_config 或等发版——客户端自己降级，之后自动恢复。
var FUSE_KEY = 'rewarded_ad_fuse'
var FUSE_THRESHOLD = 3
var FUSE_DURATION_MS = 2 * 60 * 60 * 1000

function _readFuse() {
  try {
    return wx.getStorageSync(FUSE_KEY) || null
  } catch (e) {
    return null
  }
}

function _writeFuse(value) {
  try {
    wx.setStorageSync(FUSE_KEY, value)
  } catch (e) { /* ignore */ }
}

/** 闸门是否已被熔断（rewardedSaveGate 在判灰度前先问一次） */
function isCircuitOpen() {
  var fuse = _readFuse()
  return !!(fuse && fuse.until && Date.now() < fuse.until)
}

function _noteResult(reason, route) {
  // nofill 是平台没广告可给，不是故障；abandoned 是用户自己关的，都不计数
  var r = String(reason || '')
  var broken = (r.indexOf('showfail') === 0 || r === 'timeout' || r === 'nocallback')
  var fuse = _readFuse() || { fails: 0, until: 0 }
  if (!broken) {
    if (fuse.fails) _writeFuse({ fails: 0, until: 0 })
    return
  }
  fuse.fails = (fuse.fails || 0) + 1
  if (fuse.fails >= FUSE_THRESHOLD) {
    fuse.fails = 0
    fuse.until = Date.now() + FUSE_DURATION_MS
    track('ad_rewarded', { route: route || '', result: 'fuse' })
  }
  _writeFuse(fuse)
}

// 线上诊断需要：2026-08-13~19 埋点里 showfail 占 82%、而 nofill 只有 0.5%，
// 说明失败不是「平台没广告」而是别的层面出的问题，但笼统的 'showfail' 看不出
// 到底哪个错误码在挂。把 errCode 拼进 result（参数值是自由字符串，后台不用
// 额外注册属性），事件分析里就能直接按错误码分组定位。
// 2026-08-21 补：上面这套只在「reject 带码」时有效，而实测绝大多数 reject 不带码，
// 于是 45% 的失败全挤在 showfail_0 里，连 1004（平台无填充，属正常库存不足、没什么
// 可修）也被吞了进去——「失败是技术性的不是库存性的」这个结论因此无从验证。
// 真码走 onError，见 __xbjLastErr / LATE_ERR_WINDOW_MS。
// 2026-08-23 再补：errCode 回填上线后 nofill 仍然是 0、失败依旧全是 showfail_0，
// 说明 reject 不带码、onError 也没在 1 秒窗口内送来码——不是「拿到码发现不是 1004」，
// 而是压根没拿到码。但 wx 的失败对象几乎总带 errMsg，之前被我们直接丢了。
// 所以没有码的时候改用 errMsg 归一化出的标签，别再一律记成黑盒 showfail_0。
//
// 微信 SDK 的 errMsg 是有限的几种模板串，但我们还没看清它们长什么样，
// 所以这里不写关键词表（写了也是瞎猜），直接把整条消息压成短 slug：
// 去掉 "xxx:fail " 前缀、数字折成 #（免得 id/耗时把基数撑爆）、空白折成下划线、截断 24 字。
// 等线上看清楚是哪几种，再决定要不要收敛成固定标签。
function _msgTag(msg) {
  if (!msg) return ''
  var s = String(msg)
    .replace(/^[\w.]+:fail\s*/i, '')
    .replace(/\d+/g, '#')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/^_+|_+$/g, '')
  return s.slice(0, 24)
}

function _failReason(code, msg) {
  if (code === 1004) return 'nofill'
  if (code) return 'showfail_' + code
  var tag = _msgTag(msg)
  // showfail_0 从此只剩一个含义：码和文案都没有
  return tag ? 'showfail_' + tag : 'showfail_0'
}

// onError 早于 reject 到达时，错误已经挂在实例上了，直接取用。
// 只认本次 show 开始之后到的，免得把上一次失败的码安到这次头上。
function _recentErr(ad, since) {
  var last = ad && ad.__xbjLastErr
  if (!last) return null
  if (last.at < since) return null
  if (!last.code && !last.msg) return null
  return last
}

function _routeOf(page) {
  return (page && page.route) || ''
}

// Promise.resolve 包一层：异常实现下 show()/load() 可能不返回 Promise，
// 直接 .then 会同步抛错，把整条保存链路带成 reject。
function _call(fn) {
  try {
    return Promise.resolve(fn())
  } catch (e) {
    return Promise.reject(e)
  }
}

function _load(ad) {
  if (!ad || !ad.load) return
  try {
    var p = ad.load()
    if (p && p.then) {
      // 双保险：onLoad 事件是主信号，load() 的 resolve 也算就绪，
      // 免得某些基础库不派发 onLoad 时 __xbjReady 永远为 false、每次都白等一轮。
      p.then(function () { ad.__xbjReady = true }).catch(function () { /* 预拉失败不处理，show 时还会再试 */ })
    }
  } catch (e) { /* ignore */ }
}

// 播完/失败后延迟一点再拉下一条：紧贴着关闭动画调 load 容易和 SDK 自身的
// 回收流程打架，300ms 足够让原生组件收干净。
function _reload(ad) {
  setTimeout(function () { _load(ad) }, 300)
}

/**
 * 拿到实例并绑定到当前页面。
 * 同一 adUnitId 返回同一对象，重复调用只是重绑页面，代价极低。
 */
function _acquire(placementName) {
  if (!wx.createRewardedVideoAd) return null
  var placement = getPlacement(placementName)
  if (!placement || placement.type !== 'rewarded' || !placement.unitId) return null
  var ad = null
  try {
    ad = wx.createRewardedVideoAd({ adUnitId: placement.unitId })
  } catch (err) {
    console.error('[rewardedAdManager] createRewardedVideoAd failed', err)
    return null
  }
  if (ad) _bind(ad)
  return ad
}

/**
 * 监听器只绑一次，结果分发给「当前等待者」。
 * 实例是单例，这些标记跟着实例走，页面来回切换也不会重复注册。
 */
function _bind(ad) {
  if (ad.__xbjBound) return
  ad.__xbjBound = true
  try {
    if (ad.onLoad) {
      ad.onLoad(function () { ad.__xbjReady = true })
    }
    ad.onError(function (err) {
      ad.__xbjReady = false
      var code = (err && err.errCode) || 0
      console.warn('[rewardedAdManager] ad error', code, err && err.errMsg)
      // 码先挂到实例上：这条回调可能早于 reject（则由 _recentErr 取走），
      // 也可能晚于 reject（则由挂起的上报回填）。
      ad.__xbjLastErr = { code: code, msg: (err && err.errMsg) || '', at: Date.now() }
      var pending = ad.__xbjPendingReport
      // 原先只在 code 非 0 时回填，于是「有文案没有码」的 onError 被白白丢掉，
      // 挂起的上报只能超时后记成 showfail_0。现在有文案也算数。
      if (pending && (code || (err && err.errMsg))) {
        ad.__xbjPendingReport = null
        pending(code, (err && err.errMsg) || '')
      }
      var waiter = ad.__xbjWaiter
      if (waiter) waiter.onError(err)
    })
    ad.onClose(function (res) {
      ad.__xbjReady = false
      var waiter = ad.__xbjWaiter
      if (waiter) waiter.onClose(res)
      // 「每次保存都看广告」下，用户很可能马上就要存第二张，立刻备料
      _reload(ad)
    })
  } catch (e) { /* ignore */ }
}

/**
 * 预热：在页面 onLoad / refreshHint 中调用。
 * 绑定实例到当前页 + 触发素材下发，用户点保存时几乎零延迟。
 */
function preload(placementName, page) {
  var ad = _acquire(placementName)
  if (!ad) return
  if (!ad.__xbjReady) _load(ad)
}

/**
 * 展示激励广告
 * @returns {Promise<boolean>} true = 放行保存，false = 用户中途关闭
 */
function show(placementName, page) {
  var ad = _acquire(placementName)
  if (!ad) {
    // 无广告位/不支持：直接放行，记为无实例（无收入）
    track('ad_rewarded', { route: _routeOf(page), result: 'noinstance' })
    return Promise.resolve(true)
  }
  // 同一实例同一时刻只服务一个等待者（用户连点、或前一次还没收场）。
  // 但等待者不能无限期霸占：异常情况下（页面被销毁、定时器在后台被节流）
  // 它可能残留，之后所有 show() 都会拿到那个死 promise。超过兜底时限就丢弃重来。
  var prev = ad.__xbjWaiter
  if (prev && prev.promise) {
    if (Date.now() - (prev.startedAt || 0) < CLOSE_TIMEOUT_MS + 5000) return prev.promise
    console.warn('[rewardedAdManager] 丢弃过期的等待者')
    ad.__xbjWaiter = null
  }

  // 上一次失败若还挂着回填窗口，到这里作废（它自己的兜底定时器会按 0 收口），
  // 免得这次的错误码被算到上一次头上。
  ad.__xbjPendingReport = null

  var route = _routeOf(page)
  var waiter = { startedAt: Date.now() }

  var promise = new Promise(function (resolve) {
    var settled = false
    var timer = null
    var loading = false
    var playing = false      // ad.show() 已 resolve = 广告真的放出来了
    var retried = false      // 无码失败后是否已经重拉素材重试过一次

    ad.__xbjWaiter = waiter

    var hideLoading = function () {
      if (!loading) return
      loading = false
      try { wx.hideLoading() } catch (e) { /* ignore */ }
    }

    // 收场与上报拆开：失败时可能还要多等一会儿真的错误码，但用户不该跟着等。
    var reported = false
    var report = function (reason) {
      if (reported) return
      reported = true
      // 熔断计数用原始 reason：加了后缀 'timeout_r' 就不再等于 'timeout'，
      // _noteResult 里那几个字符串比较会静默失配。
      _noteResult(reason, route)
      // 埋点带上 _r：用来量「重试到底救回了多少次曝光」。watched_r 就是重试救回来的那些，
      // ⚠ 看总量时要把 xxx 和 xxx_r 相加。
      track('ad_rewarded', { route: route, result: retried ? reason + '_r' : reason })
    }

    var settle = function (result) {
      if (settled) return false
      settled = true
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      hideLoading()
      if (ad.__xbjWaiter === waiter) ad.__xbjWaiter = null
      resolve(result)
      // 无论成败都为下一次保存备料（onClose 那条路径已经拉过，这里只兜失败路径）
      if (!ad.__xbjReady) _reload(ad)
      return true
    }

    var finish = function (result, reason) {
      if (!settle(result)) return
      report(reason)
    }

    // 广告侧失败的统一入口：立刻放行保存，同时尽量把真的 errCode / errMsg 记进埋点。
    var failWith = function (err) {
      var code = (err && err.errCode) || 0
      var msg = (err && err.errMsg) || ''
      var recent = _recentErr(ad, waiter.startedAt)
      if (recent) {
        if (!code) code = recent.code || 0
        if (!msg) msg = recent.msg || ''
      }
      if (code) return finish(true, _failReason(code, msg))
      // 有文案但没码时**仍然等**这一秒：1004 只能靠 onError 送来的真码才认得出 nofill，
      // 提前用文案收场就再也分不清「平台没广告」和「真出错」了。等不到码再用文案兜底。
      if (!settle(true)) return
      var pending = function (lateCode, lateMsg) { report(_failReason(lateCode, lateMsg || msg)) }
      ad.__xbjPendingReport = pending
      setTimeout(function () {
        if (ad.__xbjPendingReport === pending) ad.__xbjPendingReport = null
        report(_failReason(0, msg))
      }, LATE_ERR_WINDOW_MS)
    }

    waiter.onClose = function (res) {
      if (res === undefined || (res && res.isEnded)) {
        finish(true, 'watched')
        return
      }
      wx.showToast({ title: '未完整观看广告，暂无法保存', icon: 'none' })
      finish(false, 'abandoned')
    }

    // 广告侧的错误统一按「平台问题」处理：放行，不拦用户。
    // 但广告**已经在播**之后到达的 onError（多半来自后台预拉下一条失败）
    // 不能收场——否则一次本该记 watched 的观看会被记成 nofill/showfail，
    // 埋点失真，而埋点是判断修复是否生效的唯一依据。交给 onClose 收尾。
    waiter.onError = function (err) {
      if (playing) {
        console.warn('[rewardedAdManager] 播放中的 onError，忽略', err && err.errCode)
        return
      }
      failWith(err)
    }

    timer = setTimeout(function () { finish(true, 'timeout') }, SHOW_TIMEOUT_MS)

    // 素材没就绪就先 load，期间给个轻量 loading，别让用户对着静止界面等
    var prepare = function () {
      if (ad.__xbjReady) return Promise.resolve()
      try {
        wx.showLoading({ title: '广告加载中', mask: true })
        loading = true
      } catch (e) { /* ignore */ }
      return _call(function () { return ad.load() })
    }

    var attempt = function () {
      return prepare().then(function () {
        if (settled) return null
        hideLoading()
        return _call(function () { return ad.show() }).then(function () {
          // 广告已经显示，撤掉「打不开」的兜底，换成等 onClose 的长兜底
          if (settled) return
          playing = true
          if (timer) clearTimeout(timer)
          timer = setTimeout(function () { finish(true, 'nocallback') }, CLOSE_TIMEOUT_MS)
        })
      })
    }

    attempt().catch(function (err) {
      if (settled) return
      var code = (err && err.errCode) || 0
      console.warn('[rewardedAdManager] show failed', code, err && err.errMsg)

      // ── 无码失败重试一次 ──
      // 2026-08-23：线上约 46% 的尝试记成 showfail_0（无码、非超时、非无回调），
      // 而 nofill 恒为 0，说明这些不是平台无填充。最可能是 __xbjReady 假阳性：
      // 上面 prepare() 只要标记为 true 就跳过 load 直接 show，而这个标记只在
      // onError/onClose/下一轮 _load 时才置 false——**素材自然过期不派发任何事件**，
      // 标记就一直挂着 true。而 refreshHint 在每次打开海报页时就预热，用户往往
      // 挑完背景/版式（该页均停留 21.8 秒，慢的几分钟）才点保存，中间素材早过期了。
      // 这种 show() 是**状态错误而非广告请求失败**，所以不走 onError、拿不到任何码。
      //
      // 对策：清掉假阳性标记 → 强制重新 load → 再 show 一次。
      // 有码的失败不重试（1004 是真没广告，重试纯浪费额度和用户时间）。
      // 不额外延长 6 秒的 SHOW_TIMEOUT_MS：宁可超时放行用户，也不让人干等；
      // 如果埋点里 timeout 开始变多，就说明重试挤不进这个预算，届时再调。
      if (!code && !retried && !playing) {
        retried = true
        ad.__xbjReady = false
        return attempt().catch(function (err2) {
          if (settled) return
          var e = err2 || err
          console.warn('[rewardedAdManager] retry failed', (e && e.errCode) || 0, e && e.errMsg)
          failWith(e)
        })
      }

      failWith(err)
    })
  })

  waiter.promise = promise
  return promise
}

module.exports = {
  preload,
  show,
  isCircuitOpen,
}
