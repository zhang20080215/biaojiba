# 历届奥斯卡最佳原创剧本 灌库说明（oscarScreenplay）

走通用主题流水线（`enrichThemeMovies` → `generic_theme_movies` → `getThemeMovies`）。
数据源：英文维基百科「Academy Award for Best Original Screenplay」获奖表（获奖行的年份在 `<th>`，提名行只有 `<td>`，只取获奖行）。**范围 1940–2025，共 86 部**，新到旧连续编号。

`oscarScreenplay.json` 每条含：`rank`、`edition`（奥斯卡届数，如第98届）、`year`（影片年度）、`title` / `originalTitle`（英文片名，灌库时豆瓣按「英文名+年份」匹配并订正为简体中文名）。list 页展示「第X届 · YYYY年」。

## 灌库

`enrichThemeMovies` 云端测试，粘 `oscarScreenplay.params.json` 整份（`idStrategy:'rank'`）。没跑完把 `startFrom` 改成返回的 `nextStartFrom` 续跑到「全部处理完成」。灌完 `getThemeMovies` 测 `{ "theme": "oscarScreenplay" }`，`movies` 应为 86。

> 已用改进后的搜索逻辑（英文名+年份优先、跨查询优先年份吻合），冷门老片匹配率更高；个别若仍撞车，单条 `forceRefresh` 补即可。

## 待确认

- **第98届 / 2025 /《Sinners》**：最新一条，颁奖虽已过但未独立核实，如有误单条 `forceRefresh` 改正或删除 `oscarScreenplay_1`。
