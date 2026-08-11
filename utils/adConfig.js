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
 *   }
 * }
 */

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
    save_image_rewarded: { unitId: 'adunit-16f5506ef74be138', type: 'rewarded', enabled: true },
    // 已下线：育儿结果页曝光近乎为零（40天仅98次、eCPM 1.02），且该页漏斗本就需减负
    growth_result_native: { unitId: 'adunit-a0fdcfcd4703f705', type: 'native', enabled: false },
    // 已下线：仅在未命中激励门（无 openid）的少数用户触发，价值极低；育儿保存统一走激励视频门
    growth_result_interstitial: { unitId: 'adunit-6028748f3e257f56', type: 'interstitial', enabled: false },
  },

  grayRollout: {
    save_image_rewarded: 100,
  },

  grayForceIn: {
    save_image_rewarded: ['ozCMC7vB3JQinqbeqyXzY_7TwSMo'],
  },

  frequency: {
    interstitialCooldownMs: 60000,
    maxInterstitialsPerSession: 5,
  },

  infeedPositions: [5, 25],
}

// ── 远程配置缓存 key ──
var CACHE_KEY = 'ad_remote_config'
var CACHE_TTL = 3600000 // 1小时缓存

/**
 * 从云端拉取广告配置并合并到本地（启动时调用一次）
 * 优先使用本地缓存，过期后异步刷新
 */
function fetchRemoteConfig() {
  // 1. 先尝试读取本地缓存
  try {
    var cached = wx.getStorageSync(CACHE_KEY)
    if (cached && cached.data && (Date.now() - cached.timestamp < CACHE_TTL)) {
      _applyRemoteConfig(cached.data)
      return // 缓存未过期，直接使用
    }
  } catch (e) { /* ignore */ }

  // 2. 从云数据库拉取
  if (!wx.cloud) return
  var db = wx.cloud.database()
  db.collection('app_config').where({ key: 'ad_config' }).limit(1).get().then(function (res) {
    if (res.data && res.data.length > 0) {
      var remote = res.data[0]
      _applyRemoteConfig(remote)
      // 写入本地缓存
      try {
        wx.setStorageSync(CACHE_KEY, { data: remote, timestamp: Date.now() })
      } catch (e) { /* ignore */ }
    }
  }).catch(function (err) {
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
}

/**
 * 获取广告位配置
 */
function getPlacement(placementName) {
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

module.exports = {
  adConfig,
  getPlacement,
  getAdUnitId,
  getGrayPercentage,
  isForcedIntoGray,
  fetchRemoteConfig,
}
