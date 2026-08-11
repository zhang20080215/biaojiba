/**
 * 轻量埋点封装
 *
 * 底层用 wx.reportAnalytics。⚠️ 必须先在小程序后台注册同名事件与字段，否则静默无效：
 *   小程序后台 → 数据分析 → 自定义分析 → 事件管理 → 新建事件
 *   事件标识 = 下方 event 名；字段 = data 里的 key，类型按“字符串/数值”对应。
 *
 * 本项目已用到的事件（注册清单）：
 *   poster_view  { route:字符串 }                            —— 打开海报页（查看海报）
 *   poster_save  { route:字符串, gated:数值(0/1) }           —— 每次“保存海报”尝试
 *                 漏斗：poster_view − poster_save = 看了海报但没保存的人
 *   ad_rewarded  { route:字符串, result:字符串 }              —— 激励视频结果
 *                 result ∈ watched(完播,有收入) | abandoned(未完播) |
 *                          nofill(无广告放行,无收入) | showfail(加载失败) | noinstance(无广告位)
 *   app_open     { scene:数值 }                               —— 启动/回访场景值
 *
 * wx.reportAnalytics 的字段值只支持 number / string。
 */
function track(event, data) {
  try {
    if (wx && typeof wx.reportAnalytics === 'function') {
      wx.reportAnalytics(event, data || {})
    }
  } catch (e) {
    // 埋点失败绝不影响业务
  }
}

module.exports = { track }
