# 豆瓣高分悬疑 / 灾难电影

来源：https://movie.douban.com/explore，movie/recommend接口。

筛选：悬疑/灾难类型、评分8～10、综合排序sort=T。未额外排除动画、短片等来源条目。wishFrom留空。

悬疑已采集250条，主题doubanMystery250。灾难首次采集仅21条，存入doubanDisaster250.insufficient.review.json供核对；未生成灾难榜注册和灌库文件，等待确认收录数量或调整筛选条件。不以重复条目或其他类型补足。

## 悬疑榜执行步骤

1. 已部署通用来源兜底版enrichThemeMovies时，无需再次部署。
2. 向theme_registry导入doubanMystery250.registry.import.json（完整字段的单行UTF-8无BOM JSON）。
3. 使用doubanMystery250.params.json完整内容调用enrichThemeMovies。已含autoContinue=true，会分批续跑；中断时以返回nextStartFrom填写startFrom，保留其余参数。
4. 调用getThemeMovies检查：

```json
{"theme":"doubanMystery250","audit":true,"summaryOnly":true}
```

期望total=250，missingDoubanId、missingRating、missingCover、externalCover均为0。

外链封面未转存时调用enrichThemeMovies：

```json
{"theme":"doubanMystery250","backfillCovers":true,"autoContinue":true,"startFrom":0}
```

本地文件准备完成不代表线上已注册/灌库。支持theme_registry动态榜单的现有小程序无需发版。
