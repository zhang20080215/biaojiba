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
//
// 定时器：每天 05:00 全量重建（config.json 的 dailyAliasRebuild）。排在 fetchMovies 的 04:00
// 之后一小时——TOP250 每天有进出榜、片名变化会带来 _id 漂移，索引不跟着重建就会指向已失效的
// movieId，同步就会往不存在的电影上写标记、堆孤儿记录。定时器事件不带任何参数，
// 自然走全量重建分支（dryRun/startFrom 都是 undefined），无需识别 Timer 封装。

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

const ALIAS_COLLECTION = 'movie_alias'

// 参与关联的集合。imdb_movies 不在其中——没有 doubanId。
// generic_theme_movies 里含豆瓣剧集三主题，它们的 doubanId 与电影不会撞，无害。
const SOURCES = ['movies', 'oscar_movies', 'oscar_anime_movies', 'boxoffice_movies', 'generic_theme_movies']

// 老表整张表都没有 doubanId 字段（建表早于跨榜单同步；sampleKeys 已确认也没有换名字的同类字段）。
// 唯一的救法是从 _id 反推，零成本、不动数据：
//   oscar_movies       线上是 `oscar_{doubanId}`（如 oscar_35021438）
//   oscar_anime_movies 线上是 `oscar_anime_{doubanId}`（如 oscar_anime_35391124）
//   boxoffice_movies   是 add() 的随机 id，推不出来，只能靠单独回填 doubanId 字段。
//
// ⚠ **必须卡位数**。两个抓取函数现在的代码都改用「届数」生成 _id（oscar 1~97、
// oscar_anime 74~98），而更新路径 `foundInDb ? foundInDb._id : ...` 会保留老文档的 _id，
// 所以这两张表随时可能是**新老 _id 混着**的。若不卡位数，`oscar_anime_74` 会被当成
// 豆瓣条目 74 去分组，和一部毫不相干的电影结成兄弟——标一部亮另一部，正是最不能出的错。
// 届数最多 3 位，豆瓣 subject id 至少 7 位，取 5 位做门槛，两边都留足余量。
const MIN_GID_DIGITS = 5
function gidFromPrefixedId(prefix) {
  const re = new RegExp('^' + prefix + '(\\d{' + MIN_GID_DIGITS + ',})$')
  return function (id) { const m = re.exec(String(id || '')); return m ? m[1] : '' }
}
const GID_FROM_ID = {
  oscar_movies: gidFromPrefixedId('oscar_'),
  oscar_anime_movies: gidFromPrefixedId('oscar_anime_')
}

const READ_LIMIT = 1000        // 云函数侧单次最多 1000 条
const WRITE_BATCH = 20         // 并发写批大小
const TIME_BUDGET_MS = 50000   // 自保：超时前收工并告诉调用方从哪继续

/** movie_alias 不存在时所有写入都会失败，先建一次（已存在会抛，吞掉即可） */
async function ensureCollection() {
  try { await db.createCollection(ALIAS_COLLECTION) } catch (e) { /* already exists */ }
}

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
  // 控制台的「云端测试」面板经常返回 [UPSTREAM] Upstream error (ret=-3)——那是面板的网关
  // 抖动/超时，函数本身照常跑完，只是返回值丢了。所以每个出口都把结果打进日志，
  // 事后去「云函数 → 日志」按时间捞即可，不用靠重跑来确认（重跑还有互删风险，见下）。
  const done_ = (r) => { console.log('[buildMovieAlias] RESULT ' + JSON.stringify(r)); return r }

  // { verify: true } —— 只读回查，不写不删。跑完一次拿它确认结果，比盯控制台可靠。
  if (event && event.verify === true) {
    try {
      const cnt = await db.collection(ALIAS_COLLECTION).count()
      const some = await db.collection(ALIAS_COLLECTION).limit(5).get()
      const buildIds = {}
      let skip = 0
      for (;;) {
        const page = await db.collection(ALIAS_COLLECTION).field({ buildId: true }).skip(skip).limit(1000).get()
        const rows = (page && page.data) || []
        rows.forEach((r) => { buildIds[r.buildId] = (buildIds[r.buildId] || 0) + 1 })
        if (rows.length < 1000) break
        skip += rows.length
      }
      // buildId 只有一个值 = 上一轮完整跑完并清理过；多个值 = 中途断了或有并发重跑
      return done_({ success: true, verify: true, total: cnt.total, buildIds, sample: (some && some.data) || [] })
    } catch (err) {
      return done_({ success: false, verify: true, error: (err && err.errMsg) || String(err) })
    }
  }

  const dryRun = event && event.dryRun === true
  const startFrom = (event && Number(event.startFrom)) || 0
  const autoContinue = event && event.autoContinue === true
  const buildId = (event && event.buildId) || String(Date.now())

  // ── 1. 读全部来源 ──
  const all = []
  const perSource = {}
  for (let i = 0; i < SOURCES.length; i++) {
    const rows = await readAll(SOURCES[i])
    perSource[SOURCES[i]] = { total: rows.length, withDoubanId: 0, gidFromId: 0, noGid: 0 }
    const fromId = GID_FROM_ID[SOURCES[i]]
    for (let j = 0; j < rows.length; j++) {
      let gid = rows[j].doubanId ? String(rows[j].doubanId).trim() : ''
      if (gid) perSource[SOURCES[i]].withDoubanId++
      if (!gid && fromId) { gid = fromId(rows[j]._id); if (gid) perSource[SOURCES[i]].gidFromId++ }
      if (!gid) { perSource[SOURCES[i]].noGid++; continue }
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
    // 诊断：每张表取一条完整文档列出字段名。老表到底有没有 doubanId、是不是叫别的名字
    // （douban_id / subjectId / …），靠猜没用，直接把字段名摆出来看。
    const sampleKeys = {}
    const sampleDoc = {}
    for (let k = 0; k < SOURCES.length; k++) {
      try {
        const one = await db.collection(SOURCES[k]).limit(1).get()
        const d = one && one.data && one.data[0]
        sampleKeys[SOURCES[k]] = d ? Object.keys(d) : []
        sampleDoc[SOURCES[k]] = d ? { _id: d._id, title: d.title } : null
      } catch (e) {
        sampleKeys[SOURCES[k]] = ['<读取失败: ' + ((e && e.errMsg) || e) + '>']
      }
    }
    return done_({ success: true, dryRun: true, stats, sample, sampleKeys, sampleDoc })
  }

  // ── 4. 写入（可续跑）──
  await ensureCollection()
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
      return done_({ success: true, done: false, stats, written, nextStartFrom: i, buildId, hint: '再用同一个 buildId 调一次，带上 startFrom' })
    }
    return done_({ success: true, done: false, stats, written, nextStartFrom: i, buildId })
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

  return done_({ success: true, done: true, stats, written, removed, buildId })
}
