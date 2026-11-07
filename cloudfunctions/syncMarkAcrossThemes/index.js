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
//
// ⚠ 目标里**一定包含 movieId 自己**（2026-11 线上反馈「改了标记保存不上」）：批量标记、跨榜单同步、
// 豆瓣导入都是云函数写的，这些记录没有 _openid，小程序端不是创建者，doc().update / where().remove()
// 动不了它们，还不报错（updated: 0）—— 界面提示成功，下次加载旧状态又回来了。只有云函数改得动，
// 所以「修改已有标记」一律在这里落库。自测账号抽样 1000 条里有 408 条没有 _openid。
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
// 重复记录时 _.in 可能命中不止 41 条，云函数端 .get() 默认只给 100 条
const QUERY_LIMIT = 500

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
    // 1. 查兄弟。查不到（绝大多数只在一个榜单里的条目）就只写自己
    let siblings = []
    try {
      const res = await db.collection(ALIAS_COLLECTION).doc(movieId).get()
      siblings = ((res && res.data && res.data.siblings) || []).slice(0, MAX_SIBLINGS)
    } catch (err) {
      siblings = []
    }
    const targets = [movieId].concat(siblings.filter((sid) => sid !== movieId))

    // 2. 查这些目标当前的标记
    const existingRes = await db.collection('Marks')
      .where({ openid, movieId: _.in(targets) })
      .limit(QUERY_LIMIT)
      .get()
    const existingMap = {}
    ;(existingRes.data || []).forEach((m) => {
      // 同 batchUpdateMarks：重复记录取 marked_at 最新的那条，与 dataLoader.processMarks 的口径一致
      const prev = existingMap[m.movieId]
      if (!prev || new Date(m.marked_at) > new Date(prev.marked_at)) existingMap[m.movieId] = m
    })

    const now = new Date().toISOString()
    const clearing = isClearStatus(status)
    const tasks = []

    targets.forEach((sid) => {
      const existing = existingMap[sid]
      const push = (fn) => tasks.push({ sid, fn })
      if (clearing) {
        // 取消：有记录才删。只同步「加」不同步「减」会比不同步更让人困惑。
        if (existing) {
          // 删全部匹配记录而非 doc(existing._id) 只删一条：历史重复记录若只删掉最新那条，
          // 旧的会被下次加载读回来、标记复活。与各列表页取消标记的写法保持一致。
          push(() => db.collection('Marks').where({ openid, movieId: sid }).remove())
        }
        return
      }
      if (existing) {
        // 状态已经对了就别写——扩散的目标多半本来就是对的，每次都写纯属浪费配额
        if (existing.status === status) return
        push(() => db.collection('Marks').doc(existing._id).update({ data: { status, marked_at: now } }))
      } else {
        push(() => db.collection('Marks').add({ data: { movieId: sid, openid, status, marked_at: now } }))
      }
    })

    // 3. 分批写。self = 用户点的这一条写成了（或本来就对）：前端靠它判断这次修改到底存没存上
    const BATCH = 20
    let done = 0
    let self = true
    for (let i = 0; i < tasks.length; i += BATCH) {
      const res = await Promise.all(
        tasks.slice(i, i + BATCH).map((t) =>
          t.fn().then(() => 1).catch((err) => {
            console.error('[syncMarkAcrossThemes] 写入失败', (err && err.errMsg) || err)
            if (t.sid === movieId) self = false
            return 0
          })
        )
      )
      done += res.reduce((a, b) => a + b, 0)
    }

    return { success: true, self, synced: done, candidates: targets.length }
  } catch (err) {
    console.error('[syncMarkAcrossThemes] 失败:', err)
    return { success: false, error: err.message }
  }
}
