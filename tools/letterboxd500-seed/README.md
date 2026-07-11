# Letterboxd Top 500 灌库说明（letterboxd500）

走通用主题流水线（`enrichThemeMovies` → 共享集合 `generic_theme_movies` → `getThemeMovies` 读取）。
数据源：https://letterboxd.com/official/list/letterboxds-top-500-films/ （通过 `embed.letterboxd.com` 分页抓取，共 5 页，每页 100 部，按 Letterboxd 会员平均评分排序）。**共 500 部，第 1 名在前**，抓取时间点 2026-07（榜单会随时间小幅变动，如需最新排名重新抓取即可）。

`letterboxd500.json` 每条含：`rank`（1-500 连续编号）、`year`、`title` / `originalTitle`（英文原名，灌库时豆瓣按「英文名+年份」匹配并订正为简体中文名）。

## 灌库

`enrichThemeMovies` 云端测试，粘 `letterboxd500.params.json` 整份（`idStrategy:'rank'`，已带 `autoContinue:true`，跑一次自动接力到全部处理完）。

灌完 `getThemeMovies` 测 `{ "theme": "letterboxd500" }`，`movies` 长度应为 500。

## 待确认

- 榜单本身会持续小幅变动（源站说明含「本次更新进出名单」），本次抓取是某一时间点快照；片名冷门老片如豆瓣按英文名撞车，可单条 `forceRefresh` 核对修正。
- 500 部体量较大，`enrichThemeMovies` 每批接近超时会自动停下、`autoContinue` 会自动续跑，全程跑完可能需要几分钟，属正常现象。
