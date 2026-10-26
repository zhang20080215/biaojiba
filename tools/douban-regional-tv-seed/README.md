# 豆瓣高分韩剧 / 日剧 TOP250

来源：https://movie.douban.com/tv/ 的 tv/recommend 接口。

按用户要求：类型「全部剧集」、地区「韩国 / 日本」、评分8～10、综合排序(sort=T)，分别取前250条。全部剧集不额外排除动画、纪录片及综艺；日本名单含《鬼灭之刃》等动画。这是筛选结果前250条，并非豆瓣官方独立TOP250榜单。wishFrom留空。

主题ID分别为 doubanTvKorea250、doubanTvJapan250。注册配置type=movie用于共享影视数据管线，category=tv用于显示在剧集分类，标签为「剧集」。

## 上线步骤

1. 上传部署最新 enrichThemeMovies 云函数，选择云端安装依赖。已支持两个主题的豆瓣分类接口评分/封面快照兜底。
2. 向 theme_registry 分别导入 doubanTvKorea250.registry.import.json、doubanTvJapan250.registry.import.json。这两个文件均为完整字段、UTF-8无BOM的单行JSON。
3. 分别用 doubanTvKorea250.params.json、doubanTvJapan250.params.json 的完整内容调用 enrichThemeMovies。参数含autoContinue=true、idStrategy=title-year；等续跑完成。若中断，以返回nextStartFrom填写startFrom，保留其他参数续跑。
4. 调用 getThemeMovies 审计两个主题：

```json
{"theme":"doubanTvKorea250","audit":true,"summaryOnly":true}
```

```json
{"theme":"doubanTvJapan250","audit":true,"summaryOnly":true}
```

每个主题total应为250，missingDoubanId、missingRating、missingCover、externalCover均为0。源地址齐全不能证明云存储图片可显示，完成后需打开榜单核对封面。

若externalCover>0，调用 enrichThemeMovies（日本榜替换theme）：

```json
{"theme":"doubanTvKorea250","backfillCovers":true,"autoContinue":true,"startFrom":0}
```

现有小程序支持theme_registry动态榜单时无需发版；仍需云函数部署、榜单注册、灌库。本地准备完成不等于线上已写入。

## 重新采集与校验

```sh
node tools/douban-regional-tv-seed/collect.js
node tools/validate-seed.js doubanTvKorea250
node tools/validate-seed.js doubanTvJapan250
```

重新采集会覆盖本地名单；已上线后应先核对名单变化，避免旧条目残留。采集脚本不足250条时会报错，不会写入不足250的新名单。
