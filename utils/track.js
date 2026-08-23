/**
 * 轻量埋点封装
 *
 * 底层用 wx.reportEvent（新版事件上报；wx.reportAnalytics 已于基础库 2.31.1 起停止维护）。
 * ⚠️ 必须先在小程序后台「上报管理」里新建同名事件(元事件)与参数，否则静默无效：
 *   小程序后台 → 数据分析 → 上报管理 → 事件管理 → 新建事件
 *   事件ID(英文) = 下方 event 名；参数(英文) = data 里的 key，类型按“字符串/整型”对应。
 *   本项目最低基础库 3.0.0，wx.reportEvent(2.14.4+) 必然可用。
 *
 * 本项目已用到的事件（注册清单）：
 *   poster_view  { route:字符串 }                            —— 打开海报页（查看海报）
 *   poster_save  { route:字符串, gated:数值(0/1) }           —— 每次“保存海报”尝试
 *                 漏斗：poster_view − poster_save = 看了海报但没保存的人
 *   ad_rewarded  { route:字符串, result:字符串 }              —— 激励视频结果
 *                 result ∈ watched(完播,有收入) | abandoned(未完播) |
 *                          nofill(无填充放行,无收入) | showfail_<errCode>(加载失败,码拼在后面) |
 *                          showfail_<errMsg标签>(没拿到码时用 errMsg 归一化出的短标签) |
 *                          timeout | nocallback | fuse(熔断) | noinstance(无广告位)
 *                 showfail_0 = 码和文案都没拿到（2026-08-23 起它只剩这一个含义；
 *                 在那之前它是「没拿到码」的统称，把 1004 和真错误一起吞了）
 *                 **后缀 _r**（watched_r / showfail_0_r / abandoned_r …）= 无码失败后
 *                 重拉素材重试了一次才得到的结果。watched_r 就是重试救回来的曝光。
 *                 ⚠ 统计总量时要把 xxx 与 xxx_r 相加，否则会漏掉重试那部分。
 *                 参数值是自由字符串，后台不用注册新属性
 *   app_open     { scene:数值 }                               —— 启动/回访场景值
 *   ── 第二版（核心动作 + 漏斗）──
 *   theme_open   { theme:字符串 }                              —— 进入榜单/景区/书单主题
 *   mark         { theme:字符串, status:字符串, mode:字符串, count:整型 } —— 标记(去过/想去/看过…)
 *                 status ∈ watched|wish|unmark（书=read|wish）；mode ∈ single|batch；count=批量条数
 *   share        { theme:字符串, channel:字符串, route:字符串 } —— 分享；channel ∈ appmsg|timeline
 *   growth       { step:字符串, age_months:整型 }               —— 育儿漏斗；step ∈ start|submit|result
 *   daily_checkin{ theme:字符串, route:字符串 }                 —— 每日打卡(water/movie/read/sport)
 *
 * 参数值只支持 number / string。
 */
function track(event, data) {
  try {
    if (wx && typeof wx.reportEvent === 'function') {
      wx.reportEvent(event, data || {})
    }
  } catch (e) {
    // 埋点失败绝不影响业务
  }
}

// ── 类型化 helper：页面只调一行，事件名/字段名统一在此，避免写飘 ──
function trackThemeOpen(theme) {
  track('theme_open', { theme: theme || '' })
}
function trackMark(theme, status, mode, count) {
  track('mark', { theme: theme || '', status: status || '', mode: mode || 'single', count: count || 1 })
}
function trackShare(theme, channel, route) {
  track('share', { theme: theme || '', channel: channel || '', route: route || '' })
}
function trackGrowth(step, ageMonths) {
  track('growth', { step: step || '', age_months: ageMonths || 0 })
}
function trackDaily(theme, route) {
  track('daily_checkin', { theme: theme || '', route: route || '' })
}

module.exports = { track, trackThemeOpen, trackMark, trackShare, trackGrowth, trackDaily }
