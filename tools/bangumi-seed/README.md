# Bangumi 动画 Top 250

主题 `bangumi250` 使用 `generic_theme_movies` 和通用列表/分享页面。
备用封面：resolve-covers.js 查询用户报告的30条外链；alt-covers.params.json 登记27条已核对的AniList对应作品图片。
部署 enrichThemeMovies 后先运行 bangumi250.alt-covers.params.json，再运行 bangumi250.alt-covers.run.params.json 自动转存。
备用URL优先于原外链，每批一部；不会更改评分、rank、用户标记。27张备用图片本机下载测试均为HTTP200图片，云端连通性需实际执行确认。
剩余双城之战、六样情、EVA合辑保留原豆瓣来源，不使用错版AniList图。
人工评分补录：部署最新版 enrichThemeMovies，运行 bangumi250.manual-ratings.params.json。
这8条评分由用户在2026-10-10提供；先核对库内Bangumi ID与豆瓣ID，再直接更新rating和来源记录，不调用豆瓣接口，也不修改封面和rank。
分类页新增「动漫」筛选，分类值 `anime`，卡片标签「动漫」。这项前端修改需要发版。
灌库完成后将 `bangumi250.registry.json` 添加到 `theme_registry`；已有记录则更新，避免重复注册。
范围基于 Bangumi 动画排名，用户指定移除死亡笔记（1773）、少女与战车剧场版（72266），由来源第251/252名补位。
展示 rank 重排1..250，sourceRank保留来源名次。不是未经调整的官方前250名单。
本次更新：部署最新版 enrichThemeMovies，先运行 bangumi250.reorder.params.json（保留其余作品评分、封面、文档ID，移除指定两条文档），
完成后运行 bangumi250.final3.params.json，补六样情及新增两条详情。用户Marks不删除。

运行 `node tools/bangumi-seed/collect.js` 生成 `bangumi250.json` 和 `bangumi250.params.json`。
采集结束校验 250 个不同 subject ID 和连续的 1..250 名次，失败不会输出不完整名单。
脚本依赖现有 `cloudfunctions/fetchOscarMovies/node_modules` 的 axios 和 cheerio。

字段 `rating` / `ratingCount` 存豆瓣评分，`bangumiRating` / `bangumiRatingCount` 单独保存 Bangumi 评分。
来源 URL、subject ID 和采集时间随条目保存。两站分季和特别篇的拆分可能不同，不合并季度。
现有豆瓣动画种子只提供同年、完整标题相同的候选 ID；导入前核对候选，补充剩余条目的豆瓣 ID。
缺少 ID 时云端搜索允许剧集，要求同年且完整标题/原名/别名精确命中，不使用仅年份相同的兜底候选。
无法匹配时显示“豆瓣 暂无评分”，保留 Bangumi 封面和榜单位置。

部署 `enrichThemeMovies` 后，在云函数测试中传入生成的 params JSON，自动接力灌库。
调用 `getThemeMovies`：`{"theme":"bangumi250"}`，验证 250 条及双评分，再发布小程序入口。
文档 ID 使用 Bangumi subject ID，重排时应保留 subject ID；全量换榜需要核对离榜条目，导入函数不自动删除。

已通过浏览器采集并生成 250 条名单，其中 60 条具有已有豆瓣名单的同年完整标题对应 ID。
封面空白或外链加载失败：部署最新版 `enrichThemeMovies`，运行
`{"theme":"bangumi250","backfillCovers":true,"autoContinue":true}`。
每批最多处理一条外链封面，单请求默认20秒（coverTimeoutMs可设置6000..20000），本批下载累计不超过30秒。
优先豆瓣、失败再尝试 Bangumi，成功后只更新云存储 cover。
已有 cloud:// 封面不处理。失败条目输出到各批日志的 failed 字段，重跑可重试外链失败项。
尚未执行云端部署和灌库。终端直连两个官方域名超时；可传浏览器导出的响应文件作为脚本第二参数离线解析。
