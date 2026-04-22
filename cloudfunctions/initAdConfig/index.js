// 云函数：initAdConfig
// 用途：初始化 app_config 集合中的广告配置记录
// 部署后调用一次即可，后续通过云数据库控制台直接修改
const cloud = require('wx-server-sdk')

cloud.init({ env: 'cloud1-3gn3wryx716919c6' })
const db = cloud.database()

const CONFIG_DATA = {
  enabled: true,
  placements: {
    category_native:            { enabled: true },
    category_banner:            { enabled: true },
    movielist_infeed:           { enabled: true },
    share_interstitial:         { enabled: false },  // 与云端当前状态保持一致
    share_banner:               { enabled: true },
    growth_result_native:       { enabled: true },
    growth_result_interstitial: { enabled: true },
    save_image_rewarded:        { enabled: true },   // 激励视频：保存图片前观看
  },
  frequency: {
    interstitialCooldownMs: 120000,
    maxInterstitialsPerSession: 3,
  },
  // 激励广告灰度首发 10%；稳定后改 30/50/100
  grayRollout: {
    save_image_rewarded: 10,
  },
  // 命中白名单的 openid 强制走闸门（便于开发者回归）
  grayForceIn: {
    save_image_rewarded: ['ozCMC7vB3JQinqbeqyXzY_7TwSMo'],
  },
}

exports.main = async () => {
  const collection = db.collection('app_config')

  const existing = await collection.where({ key: 'ad_config' }).get()
  if (existing.data.length > 0) {
    await collection.doc(existing.data[0]._id).update({
      data: Object.assign({}, CONFIG_DATA, { updated_at: new Date() }),
    })
    return { success: true, action: 'updated', config: CONFIG_DATA }
  }

  await collection.add({
    data: Object.assign({}, CONFIG_DATA, {
      key: 'ad_config',
      created_at: new Date(),
      updated_at: new Date(),
    }),
  })
  return { success: true, action: 'created', config: CONFIG_DATA }
}
