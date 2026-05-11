# 微信读书 TOP200 总榜主题 — 设计稿

**日期**：2026-05-08
**分支**：`feat/wechat-reading-top200`
**状态**：设计已批准，待实施

## 一、概述

新增"微信读书 TOP200 总榜"主题，作为已上线的"豆瓣读书 TOP250"（doubanBooks）的姐妹主题。架构与 UI 完全镜像 doubanBooks，差异点限制在：数据源、视觉品牌色、入口卡片标识。用户在两个主题中的"已读/想读"标记**相互独立**（同一本书可独立标记，不影响对方）。

## 二、设计决策

| 维度 | 决策 |
|---|---|
| 主题 key | `weread_books`（与 `douban_books` 平级） |
| 页面路径 | `pages/weread/list/`、`pages/weread/share/` |
| 列表/分享 UI | 100% 镜像 doubanBooks，仅替换标题/路由/品牌色 |
| 标记集合 | 复用 `BookMarks`，新增 `source` 字段（`'douban'` / `'weread'`） |
| 标记状态 | `'read'` / `'wish'` / `'unread'`（与 doubanBooks 一致） |
| 主键字段 | `bookId`（与 doubanBooks 一致） |
| 书籍集合 | 新建 `weread_books` |
| 云存储路径 | `weread_book_covers/`（不另建索引集合，`weread_books.cover` 字段直接存 cloud:// fileID） |
| 云函数 | 新建 `fetchWereadBooks`；改造 `batchUpdateBookMarks` 接受 `source` 参数；改造 `getMoviesData` 支持 `'weread_books'` theme |
| 视觉品牌色 | 微信读书绿 `#3B9F4D`（覆盖默认粉调，不随全局 app 主题切换） |
| 首页卡片 | tag = "微信读书"，category = "reading"，isNew = true |
| 数据规模 | 200 本（vs doubanBooks 的 250 本） |

## 三、文件清单

### 新建（10 个）

```
pages/weread/list/list.{js,wxml,wxss,json}
pages/weread/share/share.{js,wxml,wxss,json}
cloudfunctions/fetchWereadBooks/{index.js,package.json,config.json}   ← 仅骨架，待 F12 后实施
docs/superpowers/specs/2026-05-08-wechat-reading-top200-design.md     ← 本文件
```

### 修改（5 个）

```
app.json                                       ← 注册 pages/weread/list/list、pages/weread/share/share
pages/category/category.js                     ← themes 数组追加 weread_books 卡片（带 NEW 角标）
cloudfunctions/getMoviesData/index.js          ← 加 'weread_books' 分支 + source 过滤
cloudfunctions/batchUpdateBookMarks/index.js   ← 接受可选 source 入参（默认 'douban'）
utils/dataLoader.js                            ← processBookMarks / loadMoviesData 透传 source
```

## 四、Schema 变更

### `BookMarks` 集合

新增字段 `source`：
- `'douban'`（豆瓣读书 TOP250 的标记）
- `'weread'`（微信读书 TOP200 的标记）

**向后兼容**：旧记录无 `source` 字段，runtime 查询时用 `_.or([{ source: 'douban' }, { source: _.exists(false) }])` 视为豆瓣记录。新写入永远带 `source` 字段。后续可补一次性迁移脚本统一为 `'douban'`，但不阻塞本期上线。

### 新集合

- `weread_books`：字段对齐 `douban_books`（rank、title、author、cover、coverUrl、originalCover、description、isTop250 等）。`isTop250` 字段保留是因为 `getMoviesData` 用其作为筛选条件；微信读书场景下含义改为"是否在 TOP200 榜单内"，所有有效记录置 true。
- `cover` 字段就是封面事实来源：刚抓取时是 weread CDN URL，下载到云存储后被覆盖为 `cloud://...` fileID。无需独立的 image 索引表（这是相对 doubanBooks 简化的一点）。

## 五、上线节奏

### Phase 1：UI/架构骨架 ✅ 已完成

- 完成所有页面、云函数骨架、schema 改造
- 不依赖真实数据即可在开发者工具里点穿
- commit `80dbdcd`

### Phase 2：数据抓取（自动化）✅ 已完成

**用户已 F12 抓到 API**：`https://weread.qq.com/web/bookListInCategory/all?maxIndex=X&rank=1`
- 公开接口，**无需登录态**
- 每页 20 本，共 10 页 = 200 本
- 返回字段：bookId、title、author、cover（CDN URL）、intro、newRating（931 = 9.31）、newRatingCount、readingCount、category、publishTime、searchIdx（rank）等

**直接放进云函数 `fetchWereadBooks` 全自动**（无需本地 Python）：
- mode `scrape`（默认）：循环 10 页，upsert 到 `weread_books` 集合，~30s 内完成
- mode `downloadCovers`：分批下载封面到云存储 `weread_book_covers/`，coverBatchSize 默认 30/批（避免 60s 云函数超时），多次调用直至全部完成

**调用流程**：
```
1. 部署 fetchWereadBooks 云函数
2. 开发者工具云函数本地调试 / 在线运行：
   wx.cloud.callFunction({ name: 'fetchWereadBooks' })           // 抓元数据（~30s）
3. 等元数据落库后，分多次调：
   wx.cloud.callFunction({ name: 'fetchWereadBooks',
     data: { skipScrape: true, downloadCovers: true, coverBatchSize: 30 }
   })  // 每次跑 30 本封面（~50s），跑 7 次完成 200 本
```

## 六、风险与未决

1. **数据源稳定性**：weread.qq.com 的 XHR 接口可能加 token / 反爬，可能需要带 cookie（登录态）。如果走这条，需评估更新机制（手动定期跑 vs 云函数定时触发）。
2. **首期数据量**：用户只给书名，元数据（作者、封面、简介）需从 weread 详情页抓取（每本一次详情请求），200 本约 200 次额外请求，需做并发控制 + 重试。
3. **BookMarks 老数据迁移**：runtime 兼容方案可上线，但长期建议跑一次 `update where source not exists set source='douban'` 脚本清理。

## 七、验收标准

- [ ] 首页 category 页面新增"微信读书 TOP200 总榜"卡片，带 NEW 角标
- [ ] 点击卡片进入 `pages/weread/list/list`，UI 与 doubanBooks 一致，但 hero/navbar 为 `#3B9F4D` 系绿色
- [ ] 列表项可标记"已读"/"想读"，写入 BookMarks 集合且带 `source: 'weread'`
- [ ] 切换到豆瓣读书页面，标记互不影响（同一本书在两边可独立标记）
- [ ] 海报生成页（share）支持海报墙 + 文字卡片两种样式
- [ ] 真机预览 200 本完整加载、滚动流畅（与 doubanBooks 同样的性能基线）
- [ ] BookMarks 老记录在 doubanBooks 页面仍正常显示（向后兼容验证）
