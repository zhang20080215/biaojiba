# 历届金棕榈奖 灌库说明（palmeDor）

走通用主题流水线（`enrichThemeMovies` → `generic_theme_movies` → `getThemeMovies`）。
数据源：维基百科「金棕榈奖」词条（简体版）。**范围：严格金棕榈，1955–2025，共 77 部**（1955 前的「国际电影节大奖」时代未收录）。

`palmeDor.json` 每条含：`rank`（新到旧连续编号）、`edition`（戛纳届数=年份-1947）、`year`（获奖年）、`title`（维基片名，灌库时会被豆瓣简体标准名覆盖）、`originalTitle`（原名，驱动豆瓣搜索）、`director`、`country`。

> `director` / `country` 取自维基译名（偏港台译法，如「肯·洛区」「西恩·贝克」），豆瓣只订正 `title`，不会订正导演/国家。列表页展示的就是这两个字段。

## 灌库

`enrichThemeMovies` 云端测试，粘 `palmeDor.params.json` 整份（`idStrategy:'rank'`）。没跑完就把 `startFrom` 改成返回的 `nextStartFrom` 续跑到「全部处理完成」。

灌完 `getThemeMovies` 测 `{ "theme": "palmeDor" }`，`movies` 长度应为 77。

## 未收录 / 待确认

- **2026 年**：维基现有一条 2026 获奖记录（峡湾 / Fjord / 蒙久），暂无法核实真伪，未收录。确认属实后追加一条 `{ rank:0(置顶前插), edition:79, year:2026, ... }` 并整体重排即可。
- 片名冷门老片若豆瓣按中文名撞车，改用英文 `originalTitle` 驱动搜索（同恐怖/摄影主题的处理经验）。
