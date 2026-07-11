# 史上最佳动作电影 灌库说明（rtAction）

走通用主题流水线（`enrichThemeMovies` → 共享集合 `generic_theme_movies` → `getThemeMovies` 读取），同恐怖/战争/动画三榜单一致。
数据源：https://editorial.rottentomatoes.com/guide/140-essential-action-movies-to-watch-now/ （倒数榜单，页面 `#140` 到 `#1`，`#1` 为最佳）。**源站标题为「140部」，实际编号跳过 #53，真实数量 139 部**，按源站真实数量收录。

`rtAction.json` 每条含：`rank`（源站编号跳过 #53，已重新连续编号为 1-139，最佳在前）、`year`、`title` / `originalTitle`（英文名，灌库时豆瓣按「英文名+年份」匹配并订正为简体中文名）、`rtScore`（烂番茄新鲜度，仅存档展示无强制用途）。

## 灌库

`enrichThemeMovies` 云端测试，粘 `rtAction.params.json` 整份（`idStrategy:'rank'`，已带 `autoContinue:true`）。

灌完 `getThemeMovies` 测 `{ "theme": "rtAction" }`，`movies` 长度应为 139。

## 待确认

- **源站 #53 缺失**：源站自身编号跳过，非抓取遗漏（同 rtAnimation 跳 #45/#98 的先例）；本仓库 `rtAction.json` 已重新连续编号（1-139），不留空位。
- 个别港片英文译名（如《英雄》→ `Hero`）可能撞车热门同名英文片，如匹配到人工核对不对的条目，单条 `forceRefresh` 改用更精确的原始中文名重跑即可。

## 待补充：封面图

`pages/category/category.js` 走的是动态封面（榜单 rank=1 的豆瓣封面自动叠色），无需手动补图。
