# 海报质感升级 · 实施计划

- 设计文档：`docs/superpowers/specs/2026-11-02-poster-upgrade-design.md`（下文简称「设计」）
- 视觉基准：`docs/superpowers/mockups/refined.html`（预览：`node docs/superpowers/mockups/serve.cjs` → http://localhost:5178/refined.html）
- 分支：`feature/poster-upgrade`，每个任务完成后单独提交

## 0. 通用约定

**每个新版式都走同一个流程（设计门）：**
1. 在 `docs/superpowers/mockups/` 出这个版式的 1080 精修 HTML 稿，标准和 `refined.html` 一样：真实封面、字号阶梯、页边距都按设计第 2 节；
2. 请用户确认，**确认后才写 canvas 代码**；
3. canvas 版写完后，在开发者工具里出图，和 HTML 稿并排对比，差异要逐条修掉或者说明原因。

**每个任务的验收：**
- 改过的 `.js` 逐个 `node --check`，`.json` 用 `JSON.parse` 过一遍；
- `node --test tools/test-poster-*.cjs` 全部通过，另外跑一遍受影响的老测试（`test-poster-covers.cjs`）；
- 用户要预览时，运行 `preview.bat`（见 CLAUDE.md「预览」一节）；
- 提交信息使用 `feat(poster): …` / `test(poster): …` 前缀。

**坐标约定：** 所有版式都按 1080 宽的设计坐标写，画布宽度不是 1080 时，统一用 `s = canvasW / 1080` 缩放。长图的宽度固定为 1080，只有高度变化。

**目录：**
```
utils/poster/
  tokens.js      颜色 / 字号 / 间距 / 圆角
  kit.js         canvas 绘图原语（纯 ctx）
  text.js        换行、省略、字距（纯函数，measure 由调用方传入）
  fonts.js       Inter 加载 + 回退
  tint.js        封面取色模糊底
  model.js       三个数据适配器 + 统计口径（纯函数）
  index.js       版式注册表
  layouts/
    ticket.js magazine.js polaroid.js receipt.js agenda.js film.js
tools/
  test-poster-model.cjs   test-poster-text.cjs   test-poster-measure.cjs
```

---

## P0 基础模块

### T0.1 `tokens.js`
- 导出 `COLOR`（`ink #16181D` `ink2 #6B7079` `ink3 #A3A8B0` `line #E6E8EC` `paper #FFFFFF` `mist #F4F5F7` `acc #FF5B3A` `film #16171A`）、`TYPE`（hero 300 / h1 96 / h2 72 / h3 64 / t1 34 / t2 28 / t3 22 / t4 20）、`SPACE`（margin 72、窄页边距 64、卡片圆角 22、封面圆角 8）、`FONT`（`num`：Inter 加载成功后用它，否则回退 `-apple-system, Helvetica Neue, Arial`；`cn`：`PingFang SC, sans-serif`）。
- 值和 `refined.html` 里的 CSS 一一对应，并在文件头注释写明「改这里要同步改精修稿」。

### T0.2 `text.js` + `tools/test-poster-text.cjs`
纯函数，不碰 wx。`measure(text, font)` 由调用方传入（画的时候用 `ctx.measureText`，测试里用「每个字宽 = 字号」这样的假函数）。
- `wrapLines(text, maxW, maxLines, measure)`：按字切行，超出最后一行用「…」收尾；
- `ellipsis(text, maxW, measure)`；
- `spacedWidth(text, letterSpacing, measure)` + `drawSpaced(ctx, text, x, y, letterSpacing, align)`：逐字绘制，用来实现字距（小程序 canvas 不保证支持 `ctx.letterSpacing`）。
- 测试：中英混排、空串、刚好放下、超出 1 行或多行、maxLines=1 的省略。

### T0.3 `model.js` + `tools/test-poster-model.cjs`
实现设计第 4 节的全部口径，**所有统计都只在这里算**，版式文件只管画。

`fromDailySingle(entry, { ordinal, hideRatings })` → `{ kind:'single', film, ordinal }`
- `film = { key, title, year, director, genres[], poster, rating(0~5), mood, note, platform:[{label,value}], date:'YYYY-MM-DD', weekday:'SAT', weekdayCn:'周六' }`
- `platform` 由 `meta.platform` 按「豆瓣 / IMDb / 烂番茄」的顺序生成，空值跳过；`hideRatings` 为真时返回空数组。
- `ordinal`：「我记录的第 N 部」，由页面用全量记录算好后传入（见 T1.2）。

`fromDailyRange(entries, { mode:'month'|'year', year, month })` → `{ kind:'range', label, films, groups, stats, favorite, monthsWithData, truncated }`
- `films`：用 `pages/daily/movie/common.js` 现有的 `dedupeMovies` 按「部」去重。**不复制一份**：由页面通过 `opts.dedupe` 传进来（utils 不反向 require pages），测试里传的也是这个真函数。
- （实现备注）观影日 `days` 按**去重前**的记录算：重看那天也是观影日。经典版式的 `summarize` 是按去重后算的，两者在重看时会差几天，新版式以这里的口径为准。平均分用 5 星制，经典版式用的是 10 分制。
- `stats = { count, days, avgStars }`：`days` 是有记录的不同日期数；`avgStars` 只算 `rating>0` 的条目，保留 1 位小数，没有任何评分时为 `null`。
- `favorite`：评分最高的一部，同分取最早；全都没评分时取第一部，并带上 `favoriteKind:'first'`，让版式切换文案。
- `groups`：按日期分组 `[{ date, weekdayCn, films[] }]`，供日程清单使用。
- `monthsWithData`：年度范围内有记录的月份数，用于「2026 · 共 N 个月有记录」。
- 年度标题**不出现「年度总结」**，这个规则写在 model 里（`label` 由 model 生成）。

`fromRanking(items, marks, { title, total })` → `{ kind:'ranking', title, total, watched, wish, unwatched, pct, dots, recent, watchedByRank }`
- `dots`：按 `rank` 升序，每项为 `'w' | 'h' | 'u'`；
- `recent`：已看的条目按标记时间倒序，取前 24 部（标记时间来自 T3.1 新增的 `markTimeMap`）；
- `pct`：保留 1 位小数。

测试覆盖：去重；平均分忽略 0；`avgStars` 为 null；`favorite` 同分取最早、全部未评分时的回退；`groups` 顺序；`monthsWithData`；`recent` 排序和截断；0 条数据；`hideRatings`；年度 label 不含「年度」。

### T0.4 `kit.js`
纯 ctx 绘图原语，坐标单位是设计坐标乘以 `s`：
- `roundRect(ctx,x,y,w,h,r)`；`cover(ctx,node,x,y,w,h,{r,shadow,hairline})`：aspectFill 裁切 + 圆角 + 1px `rgba(0,0,0,.06)` 描边 + 淡投影；`node` 为 null 时画浅灰占位，中间写片名首字；
- `star(ctx,cx,cy,size,filled)`：路径和精修稿的 SVG 一致；`stars(ctx,x,y,n,size,gap)`；
- `hairline`、`dashed(ctx,x1,y1,x2,y2,dash,gap)`；
- `ticketPath(ctx,x,y,w,h,r,notchY,notchR)`：**在 path 里直接画出两侧半圆缺口**，然后 `fill()`，缺口处自然露出下面的背景；
- `zigzagEdge`（小票的锯齿边）、`barcode(ctx,x,y,h,pattern)`、`dotMatrix(ctx,x,y,cols,gapX,gapY,r,dots,colors)`、`filmHoles`；
- `watermark(ctx,cx,y,s)`：「● 使用小程序「标记吧」生成」，圆点用强调色。

### T0.5 `tint.js`
- `drawTintBackground(ctx, node, W, H, { wash:0.5 })`：用 `wx.createOffscreenCanvas({type:'2d', width:24, height:32})` 把封面按 aspectFill 画进去，再把这张小画布 `drawImage` 放大到 W×H（`imageSmoothingEnabled = true`、`imageSmoothingQuality = 'high'`），最后叠一层 `rgba(255,255,255,wash)`；
- 离屏画布创建失败或 `node` 为 null 时，退回 `#F4F5F7` 纯色底；
- 模糊不够匀时，先缩到 12×16，放大一次到 96×128，再放大到最终尺寸（P0 真机验证时确定用哪一种）。

### T0.6 `fonts.js` + 字体资源
- 字体文件：从 Google Fonts 用 `text=` 参数取 Inter 500 和 700 的子集（只含 `0-9 . % / : - + A-Z a-z ★` 和空格），各约 20~30KB，存成 `tools/poster-fonts/inter-500.woff2` 和 `inter-700.woff2`。如果 P0 验证发现 woff2 不能用，就换成 ttf。
- 用 `uploadStaticAssets` 云函数上传到云存储 `poster_fonts/`（控制台手动上传的文件读不到）。
- `ensureFonts()`：先 `getTempFileURL`，再对每个字重调用 `wx.loadFontFace({ family:'PosterNum', source:'url("…")', desc:{weight}, scopes:['native'] })`；整个过程 1.5 秒超时；结果缓存在模块变量里，整个会话只加载一次。返回 `true` / `false`，`tokens.FONT.num` 据此切换。
- 分享页的 `onLoad` 里先发起加载，和封面加载并行，不阻塞首帧。

### T0.7 `utils/posterCovers.js` 支持 http 封面
- `ensureCoverNodes` 新增参数 `allowHttp`（默认 false，所以每日电影和每日读书的行为不变）。为 true 时，http(s) 封面不再换链，直接交给 `load(url)`（榜单页传的 `load` 就是 `CanvasHelper.loadImage`，它自带下载和缓存）。
- 在 `tools/test-poster-covers.cjs` 里补测试：`allowHttp` 关闭时 http 封面得到 null；打开时调用 `load`；cloud 和 http 混在一起的情况。

### T0.8 埋点加 `layout`
- `rewardedSaveGate`：`poster_view` / `poster_save` 的上报数据里加 `layout: (page && page._posterLayout) || ''`。页面在调用 `refreshHint` 之前设置好 `this._posterLayout`，切换版式时更新它。没设置这个字段的老页面上报空串，不受影响。
- **需要用户在后台操作：**先在「上报管理」里给这两个事件加字符串属性 `layout`。到时候按 memory 里的 JSON 规范给出可直接粘贴的内容。

### T0.9 版式注册表 `index.js`
```js
// kind: 'single' | 'range' | 'ranking'
LAYOUTS = {
  single:  ['ticket', 'magazine', 'polaroid', 'receipt', 'classic'],
  range:   ['agenda', 'magazine', 'polaroid', 'film', 'ticket', 'receipt', 'classic'],
  ranking: ['magazine', 'film', 'receipt', 'classic']
}
DEFAULT = { single:'ticket', rangeMonth:'agenda', rangeYear:'magazine', ranking:'magazine', rankingText:'receipt' }
NAMES = { ticket:'票根', magazine:'杂志', polaroid:'拍立得', film:'胶片', receipt:'小票', agenda:'清单', classic:'经典' }
```
- `get(id)` 返回版式模块；每个模块都实现 `supports(kind)`、`measure(model) → {width,height}`、`draw(ctx, model, covers, env)`，其中 `env = { s, fontsReady, today }`。
- `classic` 没有模块，页面看到 `classic` 就走原来的绘制代码。

### T0.10 真机验证（P0 的出口）
设计文档里说的「调试页」不单独建了（新页面要注册进 `app.json`，还得记得删），改为直接在每日电影单部分享页上验证：在 T1.2 接好票根之后，在 iOS 和安卓各一台真机上逐条确认，结果记在设计文档第 7 节的后面：
1. Inter 在 canvas 2d 里生效（数字明显不是系统字体）；
2. 模糊底的效果均匀，没有色块；
3. 票根缺口导出 jpg 后露出的是模糊底；
4. 安卓上中文 700/900 字重的显示效果。
有一条不通过，就先按设计第 7 节的降级方案改，再进入 P1 的其他版式。

---

## P1 每日电影 · 单部

### T1.1 票根（单部）版式 `layouts/ticket.js`
- 精修稿已经确认（`refined.html` 第三张），这一步不用再过设计门。
- `measure`：固定 1080×1440。
- `draw`：调 `tint` 画模糊底 → 顶部「MARKED / 我记录的第 N 部」→ 票面 `ticketPath` → 封面 → ADMIT ONE 和星级 → 片名（最多 2 行，长片名把字号从 76 降到 60 再降到 48）→ 年份 · 导演 · 类型 → 平台评分三栏（有几栏画几栏，0 栏时整行不画）→ 短评（最多 3 行；没有短评就不画，下面的元素往上移）→ 齿孔线 → 观影日期和条形码 → 署名。
- 条形码的图案用日期字符串做种子生成，同一天的图案每次都一样。

### T1.2 单部接入分享页
`pages/daily/movie/share.{js,wxml,wxss}`：
- 单部模式的选项面板最上面加一行「版式」：票根 / 杂志 / 拍立得 / 小票 / 经典。原来的「比例」行只在选了经典时显示；「评分」开关所有版式都显示。
- 记住选择：storage key `moviePosterStyleSingle`，读到不认识的值时回退默认值。
- `ordinal`：单部入口进来时没有拉全量记录，要补一次 `syncDailyLog {action:'getAll'}`（范围模式本来就会调用），数出 `date <= 这一条` 的条目总数；同一天的多条按 `ts` 排序。拉取和封面加载同时进行，不额外拖慢出图；拉取失败时 `ordinal = null`，版式就不画「第 N 部」。
- `generatePoster`：`layout === 'classic'` 时走原来的 `MoviePosterDrawer`；否则先 `model.fromDailySingle`，再 `layouts.get(id).measure` 定画布尺寸、`draw` 出图。封面加载、导出 jpg、保存流程都复用现有代码。
- 设置 `this._posterLayout`（埋点用，见 T0.8）。
- 这一步完成后做 T0.10 的真机验证。

### T1.3 杂志（单部）
- 设计门：精修稿以 `poster-directions.html` 第一行第三张的结构为起点，做到 1080 精度。
- 整幅封面 + 上下渐变遮罩 + MARKED 刊头 + 右上角日期和「第 N 部」+ 底部白字信息块。**遮罩强度要按封面亮度调**：用 `tint.js` 顺手算出的平均亮度，亮封面的遮罩加深。

### T1.4 拍立得（单部）
- 设计门。
- 模糊底 + 一张大相纸（倾斜 -3°）+ 片名和日期像手写一样斜着跟在下面 + 居中的短评。

### T1.5 小票（单部）
- 设计门。
- 模糊底 + 锯齿边白小票（宽 760）：标题「观影小票」、日期和时刻（**不写时刻**，只写日期和星期）、封面、片名、年份 / 导演 / 各平台评分逐行、「我的评分」那一行加粗并用强调色、备注写短评、条形码。

### T1.6 P1 收尾
- 四个新版式各取三部片测试：长片名、无封面、无短评无评分。在开发者工具里出图，和精修稿对比。
- `preview.bat` 推到真机，请用户验收。
- 提交。

---

## P2 每日电影 · 范围

### T2.1 设计门：范围版式的精修稿
一次性出齐 6 张 1080 稿：日程清单（月度，12 部）、杂志（月度和年度各一张）、拍立得（9 部）、胶片（12 部）、票夹（8 部）、小票（12 部）。另外为日程清单画一张 **3 部** 的稿，确认数据少的时候也好看。请用户确认后再进行 T2.2 及之后的任务。

### T2.2 日程清单 `layouts/agenda.js`
- `measure(model)`：头部固定 338 + 每个日期分组（组间距 18）+ 每张卡片 144（卡片间距 12）+ 底部 140；最多 60 条，超出加一行「还有 N 部」；最小高度 1440（条数少时留白放在列表下方，署名始终贴底）。
- `draw`：完全按 `refined.html` 第二张实现；**右侧不画观影时刻**（设计 4.2），星级下面不再加任何东西。
- 在 `tools/test-poster-measure.cjs` 里测 0 / 1 / 3 / 12 / 60 / 61 条时的高度和截断。

### T2.3 杂志（范围）
- 主图为 `model.favorite`，文案按 `favoriteKind` 切换；三格统计；缩略封面一排最多 22 张。
- 年度：标题由 model 给出（「2026 · 共 N 个月有记录」），不写「年度」。

### T2.4 拍立得（范围）
- 最多 9 张：取评分最高的 9 部，同分取最早；标题的统计仍然按全部。
- 每张的倾斜角度和偏移用片的 key 做种子生成，**同一份数据每次画出来都一样**。

### T2.5 胶片（范围）
- 左边竖胶片最多 12 帧，右边片单最多 20 行，片单每行是「序号 片名 … 星级」。

### T2.6 票夹（范围）
- 长图，每部一张横票，高 150，最多 40 张；票头色带用 `tint` 算出的这张封面的平均色（提亮到 L≥70，避免发暗）。

### T2.7 小票（范围）
- 长图，每行「日期 片名 … ★★★★」，最多 300 行；合计区是数量、观影日、平均分。

### T2.8 范围接入分享页
- 「版式」行改为：清单 / 杂志 / 拍立得 / 胶片 / 票夹 / 小票 / 经典（chip 放不下时可横向滚动）。选中「经典」时，下面展开原来的「整体 / 按月份 / 按评分 / 日历」，原有逻辑不动。
- 默认版式：月度 → 清单，年度 → 杂志；用户选过就记住（`moviePosterStyleRange`）。
- 「背景」行只在经典时显示（新版式的底色由版式自己决定）；「标题」输入框对新版式同样生效：model 的 `label` 可以被 `customTitle` 覆盖。
- 去重规则：新版式一律去重；只有经典的日历沿用现有逻辑，不去重。
- 300 部的绘制上限和注脚沿用现有规则（全量统计、只画前 300 部）。

### T2.9 P2 收尾
- 测试数据：1 部、3 部、12 部、60 部，以及跨 3 个月的年度范围，每个版式各出一张，和精修稿对比；
- 性能：30 部封面的月度海报，从点「版式」到出图在 3 秒以内（真机计时）；
- `preview.bat` 推到真机，请用户验收，然后提交。

---

## P3 榜单

### T3.1 `processMarks` 返回标记时间
- `utils/dataLoader.js` 的 `processMarks` 新增返回值 `markTimeMap: { [movieId]: ms }`，和 `markDateMap` 来自同一个 `mark.marked_at`。**只增加字段，不改动原有字段**，其他调用方不受影响。
- 在 `tools/test-poster-model.cjs` 里加一个用例：构造几条 marks 跑 `processMarks`，校验 `markTimeMap`（同一部片有多条标记时取最新的那条）。

### T3.2 设计门：榜单的胶片和小票
出 1080 稿：胶片（137 部看过）和小票（137 行，长图）；杂志（榜单）已经确认（`refined.html` 第一张），另外补一张 **0 部看过** 的空态稿和一张 **N=100 的通用榜单** 稿。

### T3.3 杂志（榜单）`layouts/magazine.js` 的 ranking 分支
- 点阵列数：N≤100 用 20 列，N≤300 用 50 列，更大时按「点直径 10、间距 ≥ 9」从宽度反推列数；行数随 N 变化，下方元素整体下移，画布高度不变（1440）。N 很大、放不下时，点的直径缩到 8。
- 封面墙：`model.recent`，8 列，最多 3 行；不满 8 张时按实际张数居中；0 张时画空态（「还没有标记看过的电影，去列表里标记几部吧」），保存按钮保持可用。
- 右下角写「最近标记的 24 部」，张数按实际数量填写。

### T3.4 胶片（榜单）、T3.5 小票（榜单）
- 胶片：只放看过的，按 rank 排序，每条 9 帧，最多 6 条，超出加「另 N 部」；帧号用 `#rank`。
- 小票：按 rank 列出看过的片，最多 300 行；合计区是已看、想看、完成度。

### T3.6 豆瓣 TOP250 分享页改成 canvas 预览
`pages/douban/share/share.{js,wxml,wxss}`：
- 去掉 DOM 预览（`.share-card` 及其中所有内容），换成和每日电影分享页一样的 `preview-slot` + 可见的 `<canvas type="2d">`（backing store 用导出分辨率，CSS 缩放显示）。
- 选项面板：「版式」行（杂志 / 胶片 / 小票 / 经典），经典下面保留原来的「背景」和「样式（胶囊 / 列表）」。
- 经典：把现有的 `startDrawing`（`drawCard` / `drawPosterWall` / `drawTextCard`）改成画在这块可见 canvas 上。绘制代码本身不改；原来「保存时才画」的流程改为「切换选项即画，保存时只导出」。**同一份数据下，经典版式的输出要和改动前逐像素一致**：在开发者工具里，改动前后各用同一个账号出一次图，对 `ctx.getImageData` 的结果算哈希并打日志比较（日志是临时调试代码，不提交）。哈希对不上时，两张图并排目视比对，并说明差异来自哪里。
- 封面加载：新版式走 `ensureCoverNodes({ allowHttp:true })`；经典还是用它原来的 `drawPosterItem`。
- 默认版式和灰度：入口 `type=poster` 时，默认版式由灰度决定：`grayBucket.isInBucket(openid, adConfig.getGrayPercentage('poster_magazine_default'))` 或者 openid 在 `grayForceIn` 名单里 → 杂志；否则 → 经典。入口 `type=text` 同理，命中灰度 → 小票，否则 → 经典。用户手动选过的版式（`doubanPosterStyle`）优先于灰度默认值。本地默认灰度为 0。
- 广告位（底部 banner）和保存闸门的逻辑不变。
- 设置 `_posterLayout`。

### T3.7 通用榜单分享页
`pages/genericList/share`：和 T3.6 做同样的改造。榜单名取 `THEME_CONFIG[theme].title`，总数取条目数。自定义影单（`cfg.custom`）同样适用。灰度使用同一个 key。`genericBookList` 这一轮不改。

### T3.8 P3 收尾
- 测试数据：豆瓣 TOP250（0 / 1 / 137 / 250 部看过）、一个 N=100 的通用榜单、一个只有 20 部的自定义影单；
- 经典版式的像素比对通过；
- `preview.bat` 推到真机，请用户验收，然后提交。

---

## P4 发布

### T4.1 文档
- CLAUDE.md：在「Key Shared Utilities」里加 `utils/poster/` 一段（注册表、model 口径、版式接口、设计门流程）；在每日电影海报那一段注明新版式和「经典」的关系；写清楚豆瓣分享页已改为 canvas 预览。
- 设计文档第 7 节补上真机验证的结论。

### T4.2 上线前的后台操作（需要用户在后台完成，我给出可直接粘贴的内容）
1. 「上报管理」：给 `poster_view` / `poster_save` 加 `layout` 属性；
2. 云存储：通过 `uploadStaticAssets` 上传两份 Inter 字体，并核对能读到；
3. 云端 `app_config`：`grayRollout.poster_magazine_default = 0`，把自测 openid 加进 `grayForceIn.poster_magazine_default`；过审后改成 50。

### T4.3 上线后的观察
- 两周后按 `layout` 拆开比较 `poster_save ÷ poster_view`：豆瓣页灰度组和对照组；每日电影各版式之间。
- 判定标准按设计第 8 节：豆瓣页灰度组的保存率不低于对照组，才能把灰度放到 100%。

---

## 任务依赖

```
T0.1 → T0.2 → T0.3 ─┐
T0.4 → T0.5         ├→ T1.1 → T1.2 → T0.10 → T1.3~T1.5 → T1.6
T0.6, T0.7, T0.8, T0.9 ┘
T1.6 → T2.1 → T2.2~T2.7 → T2.8 → T2.9
T2.9 → T3.1 → T3.2 → T3.3~T3.5 → T3.6 → T3.7 → T3.8 → P4
```
T0.6（字体）、T0.7（http 封面）、T0.8（埋点）互相独立，可以和 T0.1~T0.5 同时做。
