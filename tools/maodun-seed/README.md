# 历届茅盾文学奖 灌库说明（maodun）

走书籍通用流水线（`enrichThemeBooks` → `generic_theme_books` → `getThemeBooks`），前端共享 `pages/genericBookList`，主题配置在 `utils/genericBookThemeConfig.js`。

数据源：维基百科「茅盾文学奖」词条（简体）。**范围：第1届(1982)～第11届(2023)，共 53 部**（含第3届 2 部荣誉奖 rank 43/44）。

`maodun.params.json` 每条含：`rank`（新到旧连续编号，rank 1=第11届最新，配合 `orderDirection:'asc'`）、`edition`（届数）、`year`（颁奖年）、`title`（书名，灌库时会被豆瓣简体标准名覆盖，原始写法存 `sourceTitle`）、`author`（驱动豆瓣搜索 + 作者重合度二次确认）。

书名已去掉版本注记（《李自成》第二卷 / 《沉重的翅膀》修订本 / 《白鹿原》修订本 / 《白门柳》一、二 / 《茶人三部曲》一、二），只留干净书名，避免豆瓣搜不到。

## 灌库

`enrichThemeBooks` 云端测试，粘 `maodun.params.json` 整份。`autoContinue:true` 会跑完一批自动接力直到全部处理完，只需点一次。

灌完 `getThemeBooks` 测 `{ "theme": "maodun" }`，`movies` 长度应为 53，逐条核对封面/书名/评分。

## 短书名易误配，需人工核对 doubanId

书名过短或作者是笔名的条目，豆瓣搜索可能撞车（同名书/其它版本），灌完看日志里 `[未验证匹配]` / `匹配未通过校验` 的告警，人工去豆瓣核实后在对应条目加 `"doubanId": "xxx"` 重灌（同 palmeDor《樱桃的滋味》的处理）。重点核对：《蛙》《无字》《本巴》《回响》（作者「东西」是笔名）《暗算》《主角》。
