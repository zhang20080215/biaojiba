/**
 * 跨榜单标记同步（前端触发器）
 *
 * 同一部电影出现在多个榜单里时是不同的 _id（豆瓣250 `movie_{中文名}_`、
 * 奥斯卡 `oscar_{doubanId}`、通用主题 `{theme}_...`），在一个榜单标了、别的榜单
 * 还是未标——在用户心里这是 bug 不是功能，所以**默认同步、不做开关**。
 *
 * 用法：各列表页**本地那次写照旧、一行不改**，写成功之后补一句：
 *
 *   const markSync = require('../../../utils/markSync.js')
 *   ...
 *   markSync.sync(movieId, targetStatus)   // 取消标记传 '' 或 'unwatched'
 *
 * 之所以做成「事后补一刀」而不是把 14 个列表页的 toggle 都改成走云函数：
 * 那 14 份逻辑各不相同（有的 remove、有的 update、有的带 existingRecordId 优化），
 * 一次性全改的风险远大于收益。这里失败最坏就是「别的榜单没同步」，
 * 用户本次标记始终有效。
 *
 * **fire-and-forget**：不返回给调用方等待、不抛错、不弹任何提示。
 * 同步是锦上添花，绝不能因为它失败而打断标记流程或惊扰用户。
 *
 * 批量标记不用调这个 —— batchUpdateMarks 已经在服务端扩散过了。
 */

// 同一条 (movieId,status) 在极短时间内重复触发时去重：
// 列表页连点、或「标记后立刻取消再标记」会打出多次调用，扩散结果一样，白费配额。
var _recent = {}
var DEDUPE_MS = 1500

function sync(movieId, status) {
  if (!movieId) return
  if (!wx.cloud) return

  var key = movieId + '|' + (status || '')
  var now = Date.now()
  if (_recent[key] && now - _recent[key] < DEDUPE_MS) return
  _recent[key] = now

  // _recent 会随会话增长，但一次会话里标记量有限（几百条顶天），
  // 且每条只存一个时间戳，不值得为它加淘汰逻辑。

  try {
    wx.cloud.callFunction({
      name: 'syncMarkAcrossThemes',
      data: { movieId: movieId, status: status || '' },
      fail: function (err) {
        // 云函数没部署、网络不通等等：静默。用户本次标记不受影响。
        console.warn('[markSync] 跨榜单同步失败（不影响本次标记）:', (err && err.errMsg) || err)
      }
    })
  } catch (e) {
    console.warn('[markSync] 调用异常:', e)
  }
}

module.exports = {
  sync: sync,
}
