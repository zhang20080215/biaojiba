// 云函数：buildMovieAlias —— 重建跨榜单同一部电影的关联索引
//
// 解决的问题：同一部电影出现在多个榜单里，各自是独立的 _id（豆瓣250 是
// `movie_{中文名}_`、奥斯卡是 `oscar_{doubanId}`、通用主题是 `{theme}_...`），
// 于是在一个榜单标记之后，别的榜单还是未标状态。
//
// 关联键用 **doubanId**：奥斯卡四奖、票房榜、18 个通用主题都存了它（都走
// enrichThemeMovies 的豆瓣搜索匹配）；豆瓣 TOP250 原先没有，已在 fetchMovies 里
// 从列表页的 subject 链接补上（每天定时重爬，自动回填存量）。
// imdb_movies 只有英文标题与 imdbId，**本期不参与**，留待二期补一层 doubanId↔imdbId 映射。
//
// 产出集合 movie_alias：
//   { _id: <某榜单里的 movieId>, gid: <doubanId>, siblings: [<其他榜单里的 movieId>...], buildId }
// 冗余成「每条都带兄弟列表」而不是「按组存一条」，是因为**读远多于写**：
// 标记时只要 `where({_id: _.in(movieIds)})` 一跳就拿到要同步的目标，
// 而重建是低频离线任务，慢一点无所谓。
//
// 只给**有兄弟**的电影建索引（只出现在一个榜单里的不写），能省掉一大半文档。
//
// 注：alias 的 _id 直接用 movieId，而豆瓣250 的 id 形如 `movie_肖申克的救赎_`（带中文）。
// 这是合法的 —— movies 集合本身的 _id 就是这个格式、线上跑了几年，不用另做转义。
//
// 调用：
//   { dryRun: true }            —— 只统计覆盖情况，不写库（**第一次务必先跑这个**）
//   {}                          —— 重建
//   { startFrom: 1200 }         —— 从第 N 条续跑（超时自保后用）
//   { autoContinue: true }      —— 自动续跑直到写完

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

const ALIAS_COLLECTION = 'movie_alias'

// 参与关联的集合。imdb_movies 不在其中——没有 doubanId。
// generic_theme_movies 里含豆瓣剧集三主题，它们的 doubanId 与电影不会撞，无害。
const SOURCES = ['movies', 'oscar_movies', 'oscar_anime_movies', 'boxoffice_movies', 'generic_theme_movies']

const READ_LIMIT = 1000        // 云函数侧单次最多 1000 条
const WRITE_BATCH = 20         // 并发写批大小
const TIME_BUDGET_MS = 50000   // 自保：超时前收工并告诉调用方从哪继续

/** 读一个集合的全部 (_id, doubanId, title, year)，分页 */
async function readAll(collection) {
  const out = []
  let skip = 0
  for (;;) {
    let res
    try {
      res = await db.collection(collection)
        .field({ _id: true, doubanId: true, title: true, year: true, theme: true })
        .skip(skip).limit(READ_LIMIT).get()
    } catch (err) {
      // 集合不存在等情况：跳过，不要让整个重建挂掉
      console.warn(`[buildMovieAlias] 读取 ${collection} 失败:`, (err && err.errMsg) || err)
      break
    }
    const rows = (res && res.data) || []
    for (let i = 0; i < rows.length; i++) out.push({ ...rows[i], _collection: collection })
    if (rows.length < READ_LIMIT) break
    skip += rows.length
  }
  return out
}

exports.main = async (event) => {
  const startedAt = Date.now()
  const dryRun = event && event.dryRun === true
  const startFrom = (event && Number(event.startFrom)) || 0
  const autoContinue = event && event.autoContinue === true
  const buildId = (event && event.buildId) || String(Date.now())

  // ── 1. 读全部来源 ──
  const all = []
  const perSource = {}
  for (let i = 0; i < SOURCES.length; i++) {
    const rows = await readAll(SOURCES[i])
    perSource[SOURCES[i]] = { total: rows.length, withDoubanId: 0 }
    for (let j = 0; j < rows.length; j++) {
      const gid = rows[j].doubanId ? String(rows[j].doubanId).trim() : ''
      if (!gid) continue
      perSource[SOURCES[i]].withDoubanId++
      all.push({ id: rows[j]._id, gid, title: rows[j].title || '', collection: SOURCES[i] })
    }
  }

  // ── 2. 按 doubanId 分组 ──
  const groups = {}
  for (let i = 0; i < all.length; i++) {
    const g = all[i].gid
    if (!groups[g]) groups[g] = []
    // 同一榜单里理论上不会有重复 doubanId，真有也去个重，免得自己成自己的兄弟
    if (groups[g].indexOf(all[i].id) === -1) groups[g].push(all[i].id)
  }

  // ── 3. 生成待写文档（只要有兄弟的）──
  const docs = []
  const gids = Object.keys(groups)
  let multiGroups = 0
  for (let i = 0; i < gids.length; i++) {
    const ids = groups[gids[i]]
    if (ids.length < 2) continue
    multiGroups++
    for (let j = 0; j < ids.length; j++) {
      docs.push({
        _id: ids[j],
        gid: gids[i],
        siblings: ids.filter((x) => x !== ids[j]),
        buildId,
      })
    }
  }

  const stats = {
    perSource,
    带doubanId的记录数: all.length,
    分组数: gids.length,
    跨榜单分组数: multiGroups,
    待写文档数: docs.length,
    最大组: gids.reduce((max, g) => Math.max(max, groups[g].length), 0),
  }

  if (dryRun) {
    // 抽样看几个大组，便于人工确认关联是对的
    const sample = gids
      .filter((g) => groups[g].length >= 3)
      .slice(0, 5)
      .map((g) => ({ doubanId: g, ids: groups[g] }))
    return { success: true, dryRun: true, stats, sample }
  }

  // ── 4. 写入（可续跑）──
  let written = 0
  let i = startFrom
  for (; i < docs.length; i += WRITE_BATCH) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) break
    const batch = docs.slice(i, i + WRITE_BATCH)
    await Promise.all(
      batch.map((d) =>
        db.collection(ALIAS_COLLECTION).doc(d._id)
          .set({ data: { gid: d.gid, siblings: d.siblings, buildId: d.buildId, updatedAt: db.serverDate() } })
          .catch((err) => console.error('[buildMovieAlias] 写入失败', d._id, (err && err.errMsg) || err))
      )
    )
    written += batch.length
  }

  const done = i >= docs.length
  if (!done) {
    if (autoContinue) {
      // 交给调用方按 nextStartFrom 再调一次；这里不自调用，避免递归失控
      return { success: true, done: false, stats, written, nextStartFrom: i, buildId, hint: '再用同一个 buildId 调一次，带上 startFrom' }
    }
    return { success: true, done: false, stats, written, nextStartFrom: i, buildId }
  }

  // ── 5. 清理上一轮留下、这一轮已不成立的关联 ──
  // （电影跌出榜单、榜单重灌导致 _id 变化等）
  let removed = 0
  try {
    const res = await db.collection(ALIAS_COLLECTION).where({ buildId: _.neq(buildId) }).remove()
    removed = (res && res.stats && res.stats.removed) || 0
  } catch (err) {
    console.warn('[buildMovieAlias] 清理旧索引失败:', (err && err.errMsg) || err)
  }

  return { success: true, done: true, stats, written, removed, buildId }
}
