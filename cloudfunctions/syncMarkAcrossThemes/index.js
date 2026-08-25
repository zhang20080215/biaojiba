// 云函数：syncMarkAcrossThemes —— 把一次标记扩散到其他榜单里的同一部电影
//
// 为什么单独一个函数、而不是让各列表页改走 batchUpdateMarks：
// 单个标记（点一部电影）的逻辑在 14 个列表页里各复制了一份，写法还都不一样
// （有的 remove、有的 update、有的带 existingRecordId 优化）。一次性把它们
// 全改成走云函数，风险远大于收益。所以这里**只做扩散**：页面本地那次写照旧、
// 一行不改，写成功之后 fire-and-forget 调一次本函数补上其他榜单。
// 不原子，但这个场景不需要原子——扩散失败最坏就是「别的榜单没同步」，
// 用户本次标记始终有效。
//
// 关联关系来自 movie_alias（云函数 buildMovieAlias 离线重建，键是 doubanId）。
// 没有兄弟（只出现在一个榜单、或旅游/书籍这类没有 doubanId 的条目）时直接返回，
// 是个廉价的空操作。
//
// 入参：{ movieId, status }
//   status: 'watched' | 'wish' —— 设为该状态
//   status: null / '' / 'unwatched' —— 取消标记（删掉记录）
// openid 一律从 wxContext 取，不接受前端传参。

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

const ALIAS_COLLECTION = 'movie_alias'
// 单条标记最多扩散到这么多个榜单。正常一部电影顶多出现在十几个榜单里，
// 超过这个数说明索引有问题，宁可少同步也不要放大成海量写入。
const MAX_SIBLINGS = 40

// 'unwatched' 是前端表示「取消标记」的值（书籍那边叫 'unread'），一并当作删除
function isClearStatus(status) {
  return !status || status === 'unwatched' || status === 'unread'
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext.OPENID
  const movieId = event && event.movieId
  const status = event && event.status

  if (!openid || !movieId) return { success: false, error: '参数不完整' }

  try {
    // 1. 查兄弟
    let aliasDoc = null
    try {
      const res = await db.collection(ALIAS_COLLECTION).doc(movieId).get()
      aliasDoc = res && res.data
    } catch (err) {
      // 文档不存在是绝大多数条目的正常路径（只在一个榜单里），不当错误记
      return { success: true, synced: 0, reason: 'no_alias' }
    }

    const siblings = ((aliasDoc && aliasDoc.siblings) || []).slice(0, MAX_SIBLINGS)
    if (!siblings.length) return { success: true, synced: 0, reason: 'no_siblings' }

    // 2. 查这些兄弟当前的标记
    const existingRes = await db.collection('Marks')
      .where({ openid, movieId: _.in(siblings) })
      .get()
    const existingMap = {}
    ;(existingRes.data || []).forEach((m) => { existingMap[m.movieId] = m })

    const now = new Date().toISOString()
    const clearing = isClearStatus(status)
    const tasks = []

    siblings.forEach((sid) => {
      const existing = existingMap[sid]
      if (clearing) {
        // 取消：有记录才删。只同步「加」不同步「减」会比不同步更让人困惑。
        if (existing) {
          tasks.push(() => db.collection('Marks').doc(existing._id).remove())
        }
        return
      }
      if (existing) {
        // 状态已经对了就别写——扩散的目标多半本来就是对的，每次都写纯属浪费配额
        if (existing.status === status) return
        tasks.push(() => db.collection('Marks').doc(existing._id).update({ data: { status, marked_at: now } }))
      } else {
        tasks.push(() => db.collection('Marks').add({ data: { movieId: sid, openid, status, marked_at: now } }))
      }
    })

    // 3. 分批写
    const BATCH = 20
    let done = 0
    for (let i = 0; i < tasks.length; i += BATCH) {
      const res = await Promise.all(
        tasks.slice(i, i + BATCH).map((fn) =>
          fn().then(() => 1).catch((err) => {
            console.error('[syncMarkAcrossThemes] 写入失败', (err && err.errMsg) || err)
            return 0
          })
        )
      )
      done += res.reduce((a, b) => a + b, 0)
    }

    return { success: true, synced: done, candidates: siblings.length }
  } catch (err) {
    console.error('[syncMarkAcrossThemes] 失败:', err)
    return { success: false, error: err.message }
  }
}
