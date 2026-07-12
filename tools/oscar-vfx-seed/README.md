# 历届奥斯卡最佳视觉效果 灌库说明（oscarVFX）

走电影通用流水线（`enrichThemeMovies` → `generic_theme_movies` → `getThemeMovies`），前端共享 `pages/genericList`，主题配置 `utils/genericThemeConfig.js`（`oscarVFX`，`showEdition:true`）。

数据源：维基百科「奥斯卡最佳视觉效果奖」词条。**范围：第11届(1938)～第98届(2025)历届获奖影片，共 88 部**。取每届获奖片（名单里每届第一部）。

历史沿革说明（都算作获奖，README 备注即可，不影响灌库）：
- 1938（第11届）《北方之子》以**荣誉奖**形式颁授（非竞赛类）。
- 1972/1974/1975/1976/1978/1980/1983/1990 若干年以**特别成就奖**形式颁授。
- **1973（第46届）未颁发**，已跳过。
- **1976（第49届）两部并列**（《金刚》《逃离地下天堂》），故 rank 50/51 同属第49届。

字段：`rank`（新到旧，rank 1=第98届）、`edition`（届数）、`year`（影片年份）、`title`（中文名，灌库被豆瓣标准名覆盖）、`originalTitle`（英文原名，驱动匹配）。**不带 `director`/`country`**——视觉效果奖颁给特效团队而非导演，列表页的导演/国家由豆瓣详情自动补齐（展示真实导演，符合观影语境）。

## 灌库

`enrichThemeMovies` 云端测试，粘 `oscarVFX.params.json` 整份。`autoContinue:true` 跑完自动接力。灌完 `getThemeMovies {theme:"oscarVFX"}` 应返回 88 条。

## 少数需核对

- 1938–1962 的老特效片较冷门，靠英文原名匹配，个别可能 `[未验证匹配]`，看日志核对必要时加 `doubanId`。
- `tom thumb`（1958）英文原名本就是全小写；`20,000 Leagues Under the Sea` 含逗号；这类照豆瓣 `original_title` 核对即可。
- 部分片名与「最佳导演」主题重复（如《泰坦尼克号》《阿凡达》《少年派》《地心引力》《1917》），属正常——两个主题各自独立集合、独立标记，互不影响。
