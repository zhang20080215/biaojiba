# 历届奥斯卡最佳女主角 灌库说明（oscarActress）

走电影通用流水线（`enrichThemeMovies` → `generic_theme_movies` → `getThemeMovies`），前端共享 `pages/genericList`，主题配置 `utils/genericThemeConfig.js`（`oscarActress`，`showEdition:true`）。

数据源：维基百科「奥斯卡最佳女主角奖」词条。**范围：第1届(1927)～第98届(2025)历届影后，共 99 条**。取每届获奖影片（名单里每届 ‡ 那部）。**第41届(1968)凯瑟琳·赫本《冬狮》与芭芭拉·斯特赖桑德《滑稽女郎》并列影后**，故 rank 58/59 同属第41届。

字段：`rank`（新到旧，rank 1=第98届）、`edition`（届数）、`year`（影片年份）、`title`（中文片名，灌库被豆瓣标准名覆盖）、`originalTitle`（英文原名，驱动匹配）、**`winner`（获奖影后本人）**。列表页以「🏆获奖人」高亮显示。

**不带 `director`/`country`**——表演奖颁给演员，导演/国家由豆瓣补齐。

> 维基这个词条最近几届用「颁奖典礼年」标注（2025=第97届、2026=第98届），本 seed 统一用**影片年**（与男主角/导演/视效三主题一致）：第98届《哈姆奈特》记 2025、第97届《阿诺拉》记 2024。

## 灌库

`enrichThemeMovies` 云端测试，粘 `oscarActress.params.json` 整份。`autoContinue:true` 跑完自动接力。灌完 `getThemeMovies {theme:"oscarActress"}` 应返回 99 条。

## 少数需核对

- 1920-40 年代老片靠英文原名匹配，个别可能 `[未验证匹配]`，看日志核对必要时加 `doubanId`。
- 《玫瑰人生》(rank 19) 豆瓣 `original_title` 为法语 `La môme`，这里 `originalTitle` 填英文别名 `La Vie en Rose`——若精确匹配不上会走年份(2007)±1 兜底；失配则手动 pin。
- 第1届珍妮特·盖纳凭《第七天堂》《马路天使》《日出》三片获奖，这里取《第七天堂》(7th Heaven) 一部。
- `winner` 显示依赖 `pages/genericList/list` 的 `winner` meta 改动，部署前端需一并带上。
