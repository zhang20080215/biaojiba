# 历届奥斯卡最佳导演 灌库说明（oscarDirector）

走电影通用流水线（`enrichThemeMovies` → `generic_theme_movies` → `getThemeMovies`），前端共享 `pages/genericList`，主题配置在 `utils/genericThemeConfig.js`（`oscarDirector` 一行，`showEdition:true` + `editionField:'edition'`）。

数据源：维基百科「奥斯卡最佳导演奖」词条。**范围：第1届(1927)～第98届(2025)全部获奖者，共 99 条**（第1届分「戏剧类/喜剧类」两个最佳导演奖，故 rank 98/99 两条都属第1届）。

字段：`rank`（新到旧连续编号，rank 1=第98届最新，配合 `orderDirection:'asc'`）、`edition`（届数）、`year`（影片年份，仅展示）、`title`（中文名，灌库时被豆瓣简体标准名覆盖）、`originalTitle`（英文原名，**驱动豆瓣搜索+精确匹配**）、`director`（获奖导演，作为展示字段，豆瓣不覆盖）。

**匹配质量高**：`enrichThemeMovies` 的 `isDetailMatch` 用英文原名精确匹配豆瓣 `original_title`/`aka`（对上即命中，年份仅±1 兜底）。奥斯卡影片英文原名都规范，命中率远高于书籍主题。

## 灌库

`enrichThemeMovies` 云端测试，粘 `oscarDirector.params.json` 整份。`autoContinue:true` 跑完自动接力，只需点一次。灌完 `getThemeMovies {theme:"oscarDirector"}` 应返回 99 条。

## 少数需核对

- 极老默片（rank 94-99，1920-30 年代）豆瓣条目冷门或英文原名有别名差异，可能 `[未验证匹配]`，看日志核对，必要时加 `"doubanId"` 重灌。
- 泛用中文名易撞车的（如《黄金时代》rank 80 可能撞萧红传记片），靠英文原名 `The Best Years of Our Lives` 兜底；若仍失配则手动 pin。
- `director` 用维基译名（偏港台，如「大卫·里恩」），列表页展示的就是这个字段，豆瓣只订正片名不订正导演。
