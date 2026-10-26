# 阿加莎·克里斯蒂作品集（agatha）

## 数据

按用户粘贴的表格收录 101 条，保留原顺序、中文书名、年份和评价，其中 97 条有评分，4 条评分为空。不同译名、版本和合集均按原表保留。

原指定来源：https://www.douban.com/personage/27255773/creations?sortby=collection&type=writer&role=&format=text

原网页需要登录，本次使用用户粘贴的表格，没有声称遍历全部网页。表格未提供封面或豆瓣 ID，因此 101 条为待核验名单，封面筛选尚未完成。所有标题含中文；年份按表格保留，不视为作品首版年，主题默认不显示年份。

## 文件

- `agatha.source.tsv`：原始三列表格，保留空评分。
- `agatha.params.json`：enrichThemeBooks 完整参数，连续编号 1–101。原表评分存为 sourceRating，入库时由豆瓣补齐当前 rating；空评分不写入，不用 0 替代。未编造 doubanId。
- `agatha.registry.json`：theme_registry 注册文档，当前 enabled 为 false，完成封面和匹配核验后改为 true。

## 入库

1. 云开发控制台「云函数 → enrichThemeBooks → 云端测试」，粘贴完整 agatha.params.json 并运行。autoContinue 已开启，自动分批搜索并入库。
2. 完成后调用 getThemeBooks，参数为 {"theme":"agatha","orderDirection":"asc"}。101 为输入条数，不保证全部匹配成功。
3. 核对日志与返回书目，去除无真实封面（含占位图）、无中文译名的条目。临时网络失败先重试，不直接认定无封面。删去名单项时，也需清理本主题库内对应记录；重跑不会自动删除旧记录。
4. 核对同名版本、不同译名、合集是否误配同一豆瓣 ID。必要时为对应条目补充人工核验的 doubanId 后重跑，尤其注意末尾四条双书合集不能误配成单本。
5. 完成核验后，将注册文档 enabled 改为 true，通过数据库顶部「导入」将 agatha.registry.json 导入 theme_registry；已有 _id 为 agatha 的记录时更新原记录。不要把云函数参数文件直接导入书籍集合。
6. 刷新小程序分类页，检查入口、列表、阅读标记和海报。

原表没有作者列，参数统一使用主题作者“阿加莎·克里斯蒂”作为搜索提示。对于作者不吻合告警，应核实实际作者，尤其是续写、改编或合集条目。

本次仅生成本地文件，尚未执行云端入库或发布。
