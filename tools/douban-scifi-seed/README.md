# 豆瓣科幻电影排行榜TOP250

数据来源：https://movie.douban.com/explore

口径：类型「科幻」、评分区间 8～10、页面综合排序（sort=T）。按接口顺序去重后取前250部，未另行排除动画、短片或特辑。这里的TOP250是该筛选结果的前250部，并非豆瓣官方独立榜单。wishFrom 为空。

已检查250条豆瓣ID唯一、rank连续1～250，全部有评分和豆瓣封面地址。源封面地址齐全不代表云存储上传已完成，仍需灌库后审计。

## 执行步骤

1. 微信开发者工具上传并部署 `cloudfunctions/enrichThemeMovies`，选择云端安装依赖。该版本在豆瓣详情无法读取时使用同ID的分类接口评分与封面快照。
2. 云数据库 `theme_registry` 导入 `doubanScifi250.registry.import.json`。这是完整字段的单行JSON、UTF-8无BOM文件。导入后查看该文档，确认title/theme/category等字段均存在。
3. 云函数 `enrichThemeMovies` 云端测试参数使用 `doubanScifi250.params.json` 全部内容。autoContinue=true会分批续跑；若续跑中断，将返回的nextStartFrom填为startFrom，保留其余参数再执行。
4. 等待灌库完成，调用 `getThemeMovies`：

```json
{"theme":"doubanScifi250","audit":true,"summaryOnly":true}
```

期望total=250，missingDoubanId=0，missingRating=0，missingCover=0，externalCover=0。若externalCover>0，调用 `enrichThemeMovies`：

```json
{"theme":"doubanScifi250","backfillCovers":true,"autoContinue":true,"startFrom":0}
```

重复审计确认封面已转存。若出现failed，保留返回信息定位下载失败条目。

已有支持theme_registry动态榜单的小程序版本无需再发版；此次仍需部署修改后的云函数，并完成榜单注册及灌库。本地文件准备完成不代表已写入线上数据库。

## 文件

- doubanScifi250.json：250条原始名单和来源信息。
- doubanScifi250.params.json：灌库参数。
- doubanScifi250.registry.json：便于阅读的完整注册配置。
- doubanScifi250.registry.import.json：数据库导入文件。
- collect.js：重新采集脚本。重新采集会覆盖名单，导入前应核对。
