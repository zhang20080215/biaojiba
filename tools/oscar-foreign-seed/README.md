# 历届奥斯卡最佳外语片 灌库说明（oscarForeign）

走通用主题流水线（`enrichThemeMovies` → 共享集合 `generic_theme_movies` → `getThemeMovies` 读取）。
数据源：中文维基百科「奥斯卡最佳国际影片历届得奖者和提名者」词条（`zh-cn` 简体变体页面）。**范围 1947–2025，共 78 部**，新到旧连续编号。1947–1955 为「荣誉奖」阶段（无固定竞赛类别，含 1953 年空缺），1956 年起成为正式竞赛奖项；2020 年起该奖项由「最佳外语片」更名为「最佳国际影片」，本榜单统一收录历届获奖者。

`oscarForeign.json` 每条含：`rank`、`edition`（奥斯卡届数）、`year`（颁奖年，非影片摄制年）、`title`（维基中文片名，灌库时会被豆瓣简体标准名覆盖）、`originalTitle`（原片名，驱动豆瓣搜索，部分为非拉丁字母原文如日文/俄文，搜索时会自动 fallback 到中文名）、`director`、`country`（均取自维基简体译名）。

## 灌库

`enrichThemeMovies` 云端测试，粘 `oscarForeign.params.json` 整份（`idStrategy:'rank'`，已带 `autoContinue:true`）。

灌完 `getThemeMovies` 测 `{ "theme": "oscarForeign" }`，`movies` 长度应为 78。

## 待确认

- **1953 年空缺**：该年未颁发荣誉奖，历史事实，非抓取遗漏。
- **非拉丁字母原名**（如《驾驶我的车》原名日文 `ドライブ・マイ・カー`）：豆瓣搜索会优先尝试中文名，一般不影响匹配；若撞车可单条 `forceRefresh` 核对。
- **2025（第98届）《情感价值》**：最新一条，如颁奖结果有误可单条 `forceRefresh` 改正或删除 `oscarForeign_1`。
