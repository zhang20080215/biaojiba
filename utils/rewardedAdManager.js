const { getPlacement } = require('./adConfig')
const { track } = require('./track')

/**
 * 激励视频广告管理
 *
 * ── 关于实例 ──
 * wx.createRewardedVideoAd 对同一个 adUnitId **只有一个实例**（SDK 单例）。
 * 但它又是原生组件，绑定某一个**页面实例**——在别的页面调 show() 会抛
 * "you can only invoke show() on the page where rewardedVideoAd is created"。
 * 所有状态（监听器、素材就绪、当前等待者）都挂在**实例**上，天然跨页面共享。
 *
 * ⚠ **2026-08-25 推翻了「重复 create 会重绑页面」这条假设。** 原先这里写着
 * 「每次 preload/show 都重新 create 一次（拿回同一个实例并重绑到当前页）」，
 * 整条链路都建立在它上面。而线上数据显示：show() 第一行刚在正确的页面上 create 过，
 * 紧接着 show() 仍然报「绑在别的页面」——**重复 create 不重绑**，绑的是**第一次**
 * 创建它的那个页面实例。用户从列表进海报页→返回→再进，页面对象就换了，之后每次
 * show 必失败，这就是失败率长期卡在 ~48% 的原因。
 * 现在的做法：给实例戳上 __xbjOwner（创建时的页面实例标识），preload/show 前比对，
 * 不匹配就 destroy 后重建（见 _bindState / _rebuild）。
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
  var r = String(reason || '')
  // ── 只对「慢失败」熔断 ──
  // 熔断存在的唯一理由是「广告链路挂掉时，用户不必每次保存都白等 6 秒超时」——
  // 只有 timeout / nocallback 这类**慢**失败才会让用户干等。而 show() 的状态错误
  // （素材未就绪 / 实例绑在别的页面）是毫秒级 reject 后**立刻放行保存**的，
  // 把它们计进熔断没有任何收益，害处却很大：2026-08-24 全天 91 次
  // showfail_you_can_only_invoke_show_r 把熔断顶了 14 次，每次停闸 2 小时，
  // 期间保存一律不弹广告**也完全不上报**，曝光机会静默丢失、还不进分母。
  // nofill 是平台没广告、abandoned 是用户自己关的，本来就不该计数。
  // 用 indexOf===0 而不是 ===：report 传进来的是不带 _r 的原始 reason，
  // 但将来若有别的后缀，前缀匹配不会静默失配。
  var broken = (r.indexOf('timeout') === 0 || r.indexOf('nocallback') === 0)
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
// 去掉 "xxx:fail " 前缀、数字折成 #（免得 id/耗时把基数撑爆）、空白折成下划线。
//
// ⚠ 2026-08-24：截断长度从 24 提到 48，这是本次改动里最要紧的一处。
// 当天 91 次失败全落在 `showfail_you_can_only_invoke_show` 这一个标签上，而 24 字
// 恰好把两条**根因完全不同**的微信错误切在了同一个位置：
//   A「you can only invoke show() when the ad is loaded」        → 素材没就绪
//   B「you can only invoke show() on the page where ... created」→ 实例绑在别的页面上
// 两者都截成 `you_can_only_invoke_show`，一模一样。修法南辕北辙：A 要重拉素材，
// B 要重绑页面，重拉一百次也没用。而当天重试（强制重拉素材后再 show）救回的曝光
// ≤ 4 次 / 91 次，这个「重拉不管用」恰恰更像 B。
// 48 字足以让两者分开（分歧点在第 25 个字符）。括号一并去掉，免得标签里带符号。
function _msgTag(msg) {
  if (!msg) return ''
  var s = String(msg)
    .replace(/^[\w.]+:fail\s*/i, '')
    .replace(/\d+/g, '#')
    .replace(/[()]/g, ' ')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/^_+|_+$/g, '')
  return s.slice(0, 48)
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

/** 该 page 是否还在页面栈顶（create 绑定的就是栈顶那一页） */
function _isTopPage(page) {
  try {
    var pages = (typeof getCurrentPages === 'function' && getCurrentPages()) || []
    return pages.length > 0 && pages[pages.length - 1] === page
  } catch (e) {
    return true   // 取不到栈就别拦，维持原行为
  }
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

/**
 * 素材「就绪」是否还新鲜。
 *
 * 微信**不派发素材过期事件**，__xbjReady 一旦置 true 就会一直挂着，而
 * rewardedSaveGate.refreshHint 在每次打开海报页时就预热一次、用户平均要在该页
 * 停留 21.8 秒才点保存（挑背景/版式，慢的几分钟）——中间素材早没了，
 * 于是拿着一个假阳性的就绪标记去 show()，SDK 报「未加载完成」。
 * 宁可多拉一次也不要拿过期素材去 show：多拉一次只是几百毫秒 + 一个 loading，
 * 而 show 失败是**永久丢一次曝光**（失败即放行保存，用户拿到图不会再点第二次）。
 */
var READY_TTL_MS = 3 * 60 * 1000

// onLoad 迟迟不来时的兜底等待。有些基础库不派发 onLoad，死等会把保存流程一起卡住，
// 等满这么久就直接 show()，成不成交给 SDK 说。
// 注意这段时间是从 SHOW_TIMEOUT_MS 的 6 秒预算里扣的——若埋点里 timeout 开始变多，
// 说明预算不够，届时先调 SHOW_TIMEOUT_MS 而不是砍这里。
var READY_WAIT_MS = 1500

function _isFresh(ad) {
  if (!ad || !ad.__xbjReady) return false
  if (!ad.__xbjReadyAt) return false
  return Date.now() - ad.__xbjReadyAt < READY_TTL_MS
}

function _markStale(ad) {
  if (!ad) return
  ad.__xbjReady = false
  ad.__xbjReadyAt = 0
}

/**
 * 拉素材，返回 Promise。
 *
 * **在途去重**：preload、失败后的 _reload、show 里的重试三条路径都会调到这里。
 * 同一实例上并发的 load() 会被 SDK 合并（第二次往往立刻 resolve），于是
 * 「await load() 之后 show()」等到的其实是别人那次**还没完成**的加载——
 * 素材没好就 show，照样报「未加载完成」。共用同一个 promise 才是真的等到。
 *
 * **不再把 load() 的 resolve 当就绪信号**：真正的就绪信号只有 onLoad 事件
 * （在 _bind 里置 __xbjReady/__xbjReadyAt）。原来那个「双保险」正是假阳性的来源之一。
 */
function _load(ad) {
  if (!ad || !ad.load) return Promise.resolve()
  if (ad.__xbjLoading) return ad.__xbjLoading
  var p
  try {
    p = Promise.resolve(ad.load())
  } catch (e) {
    return Promise.reject(e)
  }
  var clear = function () { if (ad.__xbjLoading === p) ad.__xbjLoading = null }
  p.then(clear, clear)
  ad.__xbjLoading = p
  return p
}

/** 预拉场景：失败不处理，show 时还会再试。单独包一层免得产生未捕获的 rejection。 */
function _loadQuiet(ad) {
  _load(ad).catch(function () { /* ignore */ })
}

/**
 * 等 onLoad 把 __xbjReady 置起来，最多等 READY_WAIT_MS。
 * 等满了也 resolve —— 让 show() 去试，失败有埋点，总好过把用户卡在这里。
 */
function _awaitReady(ad) {
  if (ad.__xbjReady) return Promise.resolve()
  return new Promise(function (resolve) {
    var deadline = Date.now() + READY_WAIT_MS
    var tick = function () {
      if (ad.__xbjReady || Date.now() >= deadline) return resolve()
      setTimeout(tick, 50)
    }
    setTimeout(tick, 50)
  })
}

// 播完/失败后延迟一点再拉下一条：紧贴着关闭动画调 load 容易和 SDK 自身的
// 回收流程打架，300ms 足够让原生组件收干净。
function _reload(ad) {
  setTimeout(function () { _loadQuiet(ad) }, 300)
}

// ── 页面归属 ──
// 2026-08-25 埋点定案：全天 84 次 `showfail_you_can_only_invoke_show_on_the_page_where_rewar_r`，
// 而「素材未就绪」那一支（..._when_the_ad_is_loaded）**一次都没有**。
// ⇒ 失败的根因是**实例绑在别的页面**，不是素材问题。
//
// 更硬的一条推论：show() 的第一行就是 _acquire() → createRewardedVideoAd()，也就是
// **在正确的页面上刚刚重新 create 过、紧接着 show 仍然报「绑在别的页面」**。
// ⇒ **重复调用 createRewardedVideoAd 并不会重绑页面。** 这条假设自 v1.0.46 起就写在
// 本文件头部、是整条链路的基石，现在被数据推翻了。
//
// 绑定的是**第一次创建它的那个页面实例**。用户从列表进海报页→返回→再进，页面对象就换了，
// 之后每次 show 都失败——这解释了为什么失败率长期卡在一半左右。
//
// 对策：给实例戳上「创建于哪个页面实例」，show/preload 前比对，不匹配就 destroy 重建。
// destroy 是否可用做特性检测，埋点会把结果带出来。
var _pageSeq = 0

function _pageKey(page) {
  if (!page) return ''
  if (!page.__xbjPageKey) page.__xbjPageKey = 'p' + (++_pageSeq)
  return page.__xbjPageKey
}

/**
 * 绑定状态。埋点后缀用，也是决定要不要重建的依据。
 *   x0 = 就绑在当前这个页面实例上（正常）
 *   x1 = 同一路由、不同页面实例（返回后重进海报页）
 *   x2 = 跨页面（在别的海报页创建的）
 *   x3 = 取不到归属信息
 */
function _bindState(ad, page) {
  if (!ad || !page || !ad.__xbjOwner) return 'x3'
  if (ad.__xbjOwner === _pageKey(page)) return 'x0'
  return ad.__xbjOwnerRoute === _routeOf(page) ? 'x1' : 'x2'
}

/**
 * 拿到实例。同一 adUnitId 返回同一对象；**首次创建**时才建立页面绑定。
 * @param {object} page 调用方页面，用于记录归属
 */
function _acquire(placementName, page) {
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
  if (!ad) return null
  // 只在实例还没有归属时戳上——重复 create 不重绑，所以后来的 create 不该改写归属，
  // 否则比对永远相等，问题就被自己盖住了。
  if (!ad.__xbjOwner && page) {
    ad.__xbjOwner = _pageKey(page)
    ad.__xbjOwnerRoute = _routeOf(page)
  }
  _bind(ad)
  return ad
}

/**
 * 销毁并重建实例，让它绑到当前页面。
 * @returns {{ad: object|null, fix: string}} fix: '_d'=已重建 '_nd'=destroy 不可用 '_df'=destroy 了但拿回同一个对象
 */
function _rebuild(ad, placementName, page) {
  if (!ad || typeof ad.destroy !== 'function') return { ad: ad, fix: '_nd' }
  // 正在播 / 有活着的等待者时绝不销毁，会把在途那次保存打断
  if (ad.__xbjWaiter) return { ad: ad, fix: '' }
  try {
    ad.destroy()
  } catch (e) {
    console.warn('[rewardedAdManager] destroy 失败', e)
    return { ad: ad, fix: '_nd' }
  }
  var fresh = _acquire(placementName, page)
  if (!fresh) return { ad: null, fix: '_d' }
  // destroy 后 create 若仍拿回同一个对象，说明这条路走不通——埋点要能看出来
  if (fresh === ad) return { ad: fresh, fix: '_df' }
  return { ad: fresh, fix: '_d' }
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
      // 唯一权威的就绪信号。带上时间戳，_isFresh 靠它判素材有没有放过期。
      ad.onLoad(function () {
        ad.__xbjReady = true
        ad.__xbjReadyAt = Date.now()
      })
    }
    ad.onError(function (err) {
      _markStale(ad)
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
      _markStale(ad)
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
  // ── 只在该页面仍处于栈顶时才创建实例 ──
  // _acquire 会 createRewardedVideoAd，而这个调用决定实例绑在**哪个页面**上，
  // 绑错了以后在别的页面 show() 会抛
  // "you can only invoke show() on the page where rewardedVideoAd is created"。
  // preload 的调用点 rewardedSaveGate.refreshHint 是在 awaitOpenid(...).then 里跑的，
  // 最多晚 1.5 秒；用户要是这期间已经返回上一页，这次 create 就把实例绑到了错误的页面。
  // 2026-08-24 那 91 次失败有可能正是这条路径（标签被截断，分不清是它还是素材未就绪，
  // 见 _msgTag 的注释）。栈顶校验成本为零，无论最终是不是它都该加。
  if (page && !_isTopPage(page)) return
  var ad = _acquire(placementName, page)
  if (!ad) return
  // 归属不是当前页就在这里重建：代价（销毁 + 重新拉素材）摊在**打开海报页**时，
  // 而不是等用户点了保存再在 6 秒预算里现做。
  if (page && _bindState(ad, page) !== 'x0') {
    var r = _rebuild(ad, placementName, page)
    if (r.ad) ad = r.ad
  }
  if (!_isFresh(ad)) _loadQuiet(ad)
}

/**
 * 展示激励广告
 * @returns {Promise<boolean>} true = 放行保存，false = 用户中途关闭
 */
function show(placementName, page) {
  var ad = _acquire(placementName, page)
  if (!ad) {
    // 无广告位/不支持：直接放行，记为无实例（无收入）
    track('ad_rewarded', { route: _routeOf(page), result: 'noinstance' })
    return Promise.resolve(true)
  }

  // ── 页面绑定校验（兜底；正常情况 preload 已经处理过了）──
  // bindState 记的是**修之前**的状态，失败埋点带出去：既能看出错绑有多频繁，
  // 也能看出重建到底有没有救回来。
  var bindState = _bindState(ad, page)
  var bindFix = ''
  if (bindState !== 'x0') {
    var rebuilt = _rebuild(ad, placementName, page)
    bindFix = rebuilt.fix
    if (rebuilt.ad) ad = rebuilt.ad
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
      // 埋点后缀：
      //   _r  —— 无码失败后重试过一次。⚠ 看总量时要把 xxx 和 xxx_r 相加。
      //   _xN —— 本次 show 之前的页面绑定状态（见 _bindState），只加在 showfail 上，
      //          免得把 watched/abandoned 这两个常看的指标打散。
      //   _d / _nd / _df —— 是否做了销毁重建 / destroy 不可用 / 销毁后仍拿回同一对象。
      var result = retried ? reason + '_r' : reason
      if (result.indexOf('showfail') === 0) result += '_' + bindState + bindFix
      track('ad_rewarded', { route: route, result: result })
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
      if (!_isFresh(ad)) _reload(ad)
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

    // 素材没就绪（或就绪得太久了）就先 load，期间给个轻量 loading，别让用户对着静止界面等。
    // 三点与之前不同：① 用 _isFresh 而不是裸的 __xbjReady，过期的就绪标记不认；
    // ② 走 _load 的在途去重，不再自己调 ad.load()，避免等到别人那次没完成的加载；
    // ③ load() resolve 之后还要等 onLoad（_awaitReady），resolve 本身不算就绪。
    var prepare = function () {
      if (_isFresh(ad)) return Promise.resolve()
      try {
        wx.showLoading({ title: '广告加载中', mask: true })
        loading = true
      } catch (e) { /* ignore */ }
      _markStale(ad)
      return _load(ad).then(function () { return _awaitReady(ad) })
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
        _markStale(ad)
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
