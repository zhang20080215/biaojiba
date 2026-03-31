// 云函数：initAdConfig
// 用途：初始化 app_config 集合中的广告配置记录
// 部署后调用一次即可，后续通过云数据库控制台直接修改
const cloud = require('wx-server-sdk')

cloud.init({ env: 'cloud1-3gn3wryx716919c6' })
const db = cloud.database()

exports.main = async () => {
  const collection = db.collection('app_config')

  // 检查是否已存在
  const existing = await collection.where({ key: 'ad_config' }).get()
  if (existing.data.length > 0) {
    // 已存在则更新
    await collection.doc(existing.data[0]._id).update({
      data: {
        enabled: true,
        placements: {
          category_native:            { enabled: true },
          category_banner:            { enabled: true },
          movielist_infeed:           { enabled: true },
          share_interstitial:         { enabled: true },
          share_banner:               { enabled: true },
          growth_result_native:       { enabled: true },
          growth_result_interstitial: { enabled: true },
        },
        frequency: {
          interstitialCooldownMs: 120000,
          maxInterstitialsPerSession: 3,
        },
        updated_at: new Date(),
      }
    })
    return { success: true, action: 'updated' }
  }

  // 不存在则新增
  await collection.add({
    data: {
      key: 'ad_config',
      enabled: true,
      placements: {
        category_native:            { enabled: true },
        category_banner:            { enabled: true },
        movielist_infeed:           { enabled: true },
        share_interstitial:         { enabled: true },
        share_banner:               { enabled: true },
        growth_result_native:       { enabled: true },
        growth_result_interstitial: { enabled: true },
      },
      frequency: {
        interstitialCooldownMs: 120000,
        maxInterstitialsPerSession: 3,
      },
      created_at: new Date(),
      updated_at: new Date(),
    }
  })
  return { success: true, action: 'created' }
}
