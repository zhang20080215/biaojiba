# 历届奥斯卡最佳男主角 灌库说明（oscarActor）

走电影通用流水线（`enrichThemeMovies` → `generic_theme_movies` → `getThemeMovies`），前端共享 `pages/genericList`，主题配置 `utils/genericThemeConfig.js`（`oscarActor`，`showEdition:true`）。

数据源：维基百科「奥斯卡最佳男主角奖」词条。**范围：第1届(1927)～第98届(2025)历届影帝，共 99 条**。取每届获奖影片（名单里每届第一部）。**第5届(1931)弗雷德里克·马奇《化身博士》与华莱士·比里《舐犊情深》并列影帝**，故 rank 94/95 同属第5届。

字段：`rank`（新到旧，rank 1=第98届）、`edition`（届数）、`year`（影片年份）、`title`（中文片名，灌库被豆瓣标准名覆盖）、`originalTitle`（英文原名，驱动匹配）、**`winner`（获奖影帝本人）**。列表页会以「🏆获奖人」形式高亮显示（genericList 的 `winner` meta 类型），这是表演奖主题的关键信息。

**不带 `director`/`country`**——表演奖颁给演员，列表页导演/国家由豆瓣补齐（展示影片真实导演，与获奖人并列显示，信息更全）。

## 灌库

`enrichThemeMovies` 云端测试，粘 `oscarActor.params.json` 整份。`autoContinue:true` 跑完自动接力。灌完 `getThemeMovies {theme:"oscarActor"}` 应返回 99 条。

## 少数需核对

- 1920-40 年代老片靠英文原名匹配，个别可能 `[未验证匹配]`，看日志核对必要时加 `doubanId`。
- 第1届埃米尔·扬宁斯实际凭《最后命令》+《众生之路》两片获奖，这里取《最后命令》(The Last Command) 一部。
- 部分片名与其它奥斯卡主题重复（如《角斗士》《钢琴家》《阿甘正传》），属正常——各主题独立集合、独立标记。
- `winner` 显示逻辑依赖本次改动（`pages/genericList/list` 新增的 `winner` meta 渲染 + `.meta-winner` 样式），部署前端时需一并带上。
