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
    category_banner: { unitId: 'adunit-991294f7567bd2b8', type: 'banner', enabled: true },
    movielist_infeed: { unitId: 'adunit-72684185bc7251e5', type: 'native', enabled: true },
    share_interstitial: { unitId: 'adunit-76c494953122488c', type: 'interstitial', enabled: true },
    share_banner: { unitId: 'adunit-d9b45d20a77f545e', type: 'banner', enabled: true },
    growth_result_native: { unitId: 'adunit-a0fdcfcd4703f705', type: 'native', enabled: true },
    growth_result_interstitial: { unitId: 'adunit-6028748f3e257f56', type: 'interstitial', enabled: true },
  },

  frequency: {
    interstitialCooldownMs: 120000,
    maxInterstitialsPerSession: 3,
  },

  infeedPositions: [10, 50],
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

module.exports = {
  adConfig,
  getPlacement,
  getAdUnitId,
  fetchRemoteConfig,
}
