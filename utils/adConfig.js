/**
 * 广告配置中心
 * 本地默认配置 + 云端远程覆盖（不发版即可开关广告）
 *
 * 远程配置方式：在云数据库 app_config 集合中添加一条记录：
 * {
 *   key: "ad_config",
 *   enabled: true/false,          // 全局开关
 *   placements: {                  // 可选，按需覆盖单个广告位
 *     category_native: { enabled: false },
 *     share_interstitial: { enabled: false },
 *     ...
 *   },
 *   grayRollout: {                 // 可选，按广告位放量百分比（0~100）
 *     save_image_rewarded: 100,    // ⚠ 必须存**数值**，字符串 "100" 会被静默忽略
 *     daily_movie_banner: 20,
 *   },
 *   grayForceIn: {                 // 可选，白名单 openid 直通灰度（自测用）
 *     daily_movie_banner: ["o..."],
 *   },
 *   forceUpdatePrompt: true        // 可选，出 P0 时打开：提示用户立即重启用新版
 * }
 *
 * 灰度只对**接了 adPlacementGate 的展示位**和激励闸门生效；老广告位直接读 getAdUnitId，
 * 不过灰度这一层。
 *
 * ── 免广告白名单 ──
 * 同一条 app_config 文档上再挂一个 `adFreeOpenids: ["oXXX...", ...]` 数组即可按 openid 加白，
 * 不用发版。命中后 getPlacement() 直接返回 null，**全部展示类广告位 + 插屏一次性关掉**
 * （28 处 getAdUnitId 调用、adPlacementGate、adManager.showInterstitial 全都经过它）；
 * 激励闸门另在 rewardedSaveGate.isGated() 首行放行。判定逻辑见 utils/adFree.js。
 */

var adFree = require('./adFree')

// ── 本地默认配置（兜底，云端拉取失败时使用） ──
const adConfig = {
  enabled: true,

  placements: {
    category_native: { unitId: 'adunit-0210c68397d60f88', type: 'native', enabled: true },
    category_banner: { unitId: 'adunit-991294f7567bd2b8', type: 'banner', enabled: false },
    // 已下线：40天数据 eCPM 仅 1.27、CTR 0.1%（占 52% 曝光却是垃圾流量），砍掉后整体 eCPM 显著上抬且改善体验
    movielist_infeed: { unitId: 'adunit-72684185bc7251e5', type: 'native', enabled: false },
    share_interstitial: { unitId: 'adunit-76c494953122488c', type: 'interstitial', enabled: true },
    share_banner: { unitId: 'adunit-d9b45d20a77f545e', type: 'banner', enabled: true },
    // 每日电影日历页底部（内容流末尾、非悬浮）。该页 08/16~08/21 六天 4656 PV / 1282 UV，
    // 是仅次于分类页的第二大内容页面，此前完全没有广告位。后台广告位名「每日电影-底部Banner」。
    daily_movie_banner: { unitId: 'adunit-999e7d872a4458ba', type: 'banner', enabled: true },
    save_image_rewarded: { unitId: 'adunit-16f5506ef74be138', type: 'rewarded', enabled: true },
    // 已下线：育儿结果页曝光近乎为零（40天仅98次、eCPM 1.02），且该页漏斗本就需减负
    growth_result_native: { unitId: 'adunit-a0fdcfcd4703f705', type: 'native', enabled: false },
    // 已下线：仅在未命中激励门（无 openid）的少数用户触发，价值极低；育儿保存统一走激励视频门
    growth_result_interstitial: { unitId: 'adunit-6028748f3e257f56', type: 'interstitial', enabled: false },
  },

  grayRollout: {
    save_image_rewarded: 100,
    // 每日电影底部 banner：本地默认 0 = 谁都不投。发版后线上先静默，
    // 放量完全走云端 app_config.grayRollout.daily_movie_banner（存**数值**），
    // 改完用户下次冷启动生效，不用发版。
    daily_movie_banner: 0,
  },

  grayForceIn: {
    save_image_rewarded: ['ozCMC7vB3JQinqbeqyXzY_7TwSMo'],
    // 灰度还是 0 的时候也能真机自测：白名单命中直接放行，绕过百分比
    daily_movie_banner: ['ozCMC7vB3JQinqbeqyXzY_7TwSMo'],
  },

  frequency: {
    interstitialCooldownMs: 60000,
    maxInterstitialsPerSession: 5,
  },

  infeedPositions: [5, 25],

  // 版本更新提示开关。默认 false = 静默，退回微信原本的「下次冷启动自动应用」，
  // 平时零打扰（本项目两三天一个版本，默认弹窗一个月要打扰用户七八次，
  // 而它换来的收益只是提前一次冷启动）。
  // 出 P0 需要快速铺开修复时，把云端 app_config 的 forceUpdatePrompt 改成 true，
  // 用户下次冷启动即弹窗提示立即重启——不用发版。
  forceUpdatePrompt: false,

  // 免广告白名单（openid 数组）。本地默认空 —— 加白只在云端 app_config 改，不发版。
  adFreeOpenids: [],
}

// ── 远程配置缓存 key ──
var CACHE_KEY = 'ad_remote_config'

// 云端那次网络拉取是否已经收口（成功或失败都算）。
// 注意不含「套用了本地缓存」——缓存可能是旧的，事故时正需要最新那份。
var _remoteFetched = false

/**
 * 从云端拉取广告配置并合并到本地（启动时调用一次）
 *
 * stale-while-revalidate：先用本地缓存立即生效（不阻塞启动），再**无条件**异步刷新。
 * 原先是「缓存 1 小时内直接 return 不请求云端」——出事时那 1 小时就是止血延迟的下限，
 * 且杀进程重进也没用。改成每次冷启都刷新后，云端改配置在用户下一次冷启动即生效；
 * 代价是每次冷启多一次数据库读（按日打开次数计，远在免费额度内）。
 */
function fetchRemoteConfig() {
  // 1. 有缓存就先套用，保证启动瞬间就有配置可用
  try {
    var cached = wx.getStorageSync(CACHE_KEY)
    if (cached && cached.data) {
      _applyRemoteConfig(cached.data)
      // 缓存里的名单可能已过期（云端撤销了但还没拉到），只授予不撤销
      syncAdFree(false)
    }
  } catch (e) { /* ignore */ }

  // 2. 再从云数据库拉一次最新的覆盖上去
  if (!wx.cloud) return
  // cloud 存在不等于 init 成功过，database() 可能抛。这里在 setTimeout 回调里，
  // 抛出去会打断同一个回调中紧随其后的逻辑（比如 getOpenid），必须包住。
  var db
  try {
    db = wx.cloud.database()
  } catch (e) {
    _remoteFetched = true
    console.warn('[adConfig] 云数据库不可用，使用本地默认:', e)
    return
  }
  db.collection('app_config').where({ key: 'ad_config' }).limit(1).get().then(function (res) {
    if (res.data && res.data.length > 0) {
      var remote = res.data[0]
      _applyRemoteConfig(remote)
      // 写入本地缓存
      try {
        wx.setStorageSync(CACHE_KEY, { data: remote, timestamp: Date.now() })
      } catch (e) { /* ignore */ }
    }
    _remoteFetched = true
    // 云端名单已到位，此刻才允许撤销
    syncAdFree(true)
  }).catch(function (err) {
    _remoteFetched = true
    console.warn('[adConfig] 拉取远程配置失败，使用本地默认:', err.errMsg || err)
  })
}

/**
 * 将远程配置合并到 adConfig
 */
function _applyRemoteConfig(remote) {
  // 全局开关
  if (remote.enabled === false) {
    adConfig.enabled = false
  } else if (remote.enabled === true) {
    adConfig.enabled = true
  }

  // 按广告位覆盖 enabled 状态
  if (remote.placements) {
    var keys = Object.keys(remote.placements)
    for (var i = 0; i < keys.length; i++) {
      var name = keys[i]
      if (adConfig.placements[name] && remote.placements[name]) {
        if (remote.placements[name].enabled === false) {
          adConfig.placements[name].enabled = false
        } else if (remote.placements[name].enabled === true) {
          adConfig.placements[name].enabled = true
        }
      }
    }
  }

  // 频控参数覆盖
  if (remote.frequency) {
    if (remote.frequency.interstitialCooldownMs) {
      adConfig.frequency.interstitialCooldownMs = remote.frequency.interstitialCooldownMs
    }
    if (remote.frequency.maxInterstitialsPerSession) {
      adConfig.frequency.maxInterstitialsPerSession = remote.frequency.maxInterstitialsPerSession
    }
  }

  if (remote.grayRollout) {
    var grayKeys = Object.keys(remote.grayRollout)
    for (var j = 0; j < grayKeys.length; j++) {
      var rolloutName = grayKeys[j]
      var percentage = remote.grayRollout[rolloutName]
      if (typeof percentage === 'number' && !isNaN(percentage)) {
        adConfig.grayRollout[rolloutName] = Math.max(0, Math.min(100, percentage))
      }
    }
  }

  // 版本更新提示开关（出 P0 时云端打开，加速修复铺开）
  if (remote.forceUpdatePrompt === true) {
    adConfig.forceUpdatePrompt = true
  } else if (remote.forceUpdatePrompt === false) {
    adConfig.forceUpdatePrompt = false
  }

  if (remote.grayForceIn) {
    var forceKeys = Object.keys(remote.grayForceIn)
    for (var k = 0; k < forceKeys.length; k++) {
      var forceName = forceKeys[k]
      var list = remote.grayForceIn[forceName]
      if (Array.isArray(list)) {
        adConfig.grayForceIn[forceName] = list.slice()
      }
    }
  }

  // 免广告白名单。**整份替换而不是合并**——合并的话云端删掉一个 openid 就撤销不了。
  if (Array.isArray(remote.adFreeOpenids)) {
    adConfig.adFreeOpenids = remote.adFreeOpenids.slice()
  }
}

/**
 * 用当前 openid + 当前名单重新判定「是否免广告」。
 *
 * @param {boolean} trusted 名单是否来自云端本次拉取成功（决定允不允许撤销，见 adFree.js）
 * @returns {boolean} 判定是否发生变化
 */
function syncAdFree(trusted) {
  var openid = null
  try {
    var app = getApp()
    openid = app && app.globalData && app.globalData.openid
  } catch (e) { /* getApp 在极早期可能不可用 */ }
  return adFree.apply(openid, adConfig.adFreeOpenids, trusted === true)
}

/**
 * 获取广告位配置
 *
 * 免广告白名单命中时全局返回 null——这是所有展示类广告位（banner / 原生 / 信息流）
 * 和插屏的唯一收口点，一处拦住等于 28 个调用点全关。激励视频不经过这里，
 * 由 rewardedSaveGate.isGated() 单独放行。
 */
function getPlacement(placementName) {
  if (adFree.isAdFree()) return null
  if (!adConfig.enabled) return null
  var placement = adConfig.placements[placementName]
  if (!placement || !placement.enabled) return null
  return placement
}

/**
 * 获取广告单元 ID
 */
function getAdUnitId(placementName) {
  var placement = getPlacement(placementName)
  return placement ? placement.unitId : null
}

function getGrayPercentage(name) {
  var percentage = adConfig.grayRollout && adConfig.grayRollout[name]
  if (typeof percentage !== 'number' || isNaN(percentage)) return 0
  return Math.max(0, Math.min(100, percentage))
}

function isForcedIntoGray(name, openid) {
  if (!openid) return false
  var list = adConfig.grayForceIn && adConfig.grayForceIn[name]
  if (!Array.isArray(list)) return false
  return list.indexOf(openid) !== -1
}

/** 是否要提示用户立即重启用新版（默认 false=静默，出 P0 时云端打开） */
function shouldPromptUpdate() {
  return adConfig.forceUpdatePrompt === true
}

/** 云端那次网络拉取是否已收口。用于区分「确实关着」和「配置还没到」 */
function isRemoteFetched() {
  return _remoteFetched
}

module.exports = {
  adConfig,
  getPlacement,
  getAdUnitId,
  getGrayPercentage,
  isForcedIntoGray,
  fetchRemoteConfig,
  shouldPromptUpdate,
  isRemoteFetched,
  // 免广告白名单（实现在 utils/adFree.js，这里转出去省得各处再 require 一个模块）
  syncAdFree,
  isAdFree: adFree.isAdFree,
  onAdFreeChange: adFree.onChange,
  offAdFreeChange: adFree.offChange,
}
