# 东野圭吾作品集（higashino）

数据来自用户提供的书目，共 **105 部，1985–2024 年**。年份和同年顺序均按原表保留，不代表中文版本出版年，也不宣称收录截至当前的全部作品。

使用现有动态主题注册表和通用书籍流水线：`enrichThemeBooks` → `generic_theme_books` → `getThemeBooks`，页面复用 `pages/genericBookList`。无需修改前端硬编码配置或新增云函数。

## 文件

- `higashino.params.json`：可直接用于 `enrichThemeBooks` 云端测试的完整参数。`rank` 按原表从 1 连续编号到 105；`author` 统一为东野圭吾。
- `higashino.registry.json`：`theme_registry` 集合中的主题文档，含分类卡片、年份展示、海报配色和标记来源配置。

两处多译名各计为一本：主标题取斜杠前的《没有凶手的暗夜》《第十年的情人节》，另一个译名保存在 `aliases`，原始写法保存在 `providedTitle`。现有采集函数只按 `title` 搜索，别名用于留档和人工核对，不会自动重试别名。

## 入库与上线

1. 确认现有 `enrichThemeBooks`、`getThemeBooks`、`getThemeRegistry` 云函数已部署。
2. 在 `enrichThemeBooks` 云端测试中传入整份 `higashino.params.json`。`autoContinue: true` 自动接力处理后续批次。
3. 处理完成后调用 `getThemeBooks`，参数为 `{"theme":"higashino","orderDirection":"asc"}`，核对返回 `movies` 数量为 105，以及书名、年份、作者、封面和评分。对于未匹配或误配条目，人工核实豆瓣 ID 后向对应条目补充 `doubanId` 并重跑。
4. 数据核对完成后，将 `higashino.registry.json` 作为一条文档写入 `theme_registry`（已有同 ID 文档时更新，不重复新增）。分类页刷新注册表后显示“东野圭吾作品集”，并自动接入列表、阅读标记、进度统计和海报。
5. 在小程序中检查分类页入口，列表应从 1985 年《放学后》到 2024 年《架空犯》，信息行显示年份与作者，并验证标记和海报。

入库时豆瓣标准书名可能覆盖 `title`，原主标题由采集函数存为 `sourceTitle`；用户提供的年份保留。短书名（如《毕业》《信》《挑战》）和多译名条目需重点检查匹配结果。

本目录提供入库与注册数据；本地文件校验不代表已执行云端入库或发布。
