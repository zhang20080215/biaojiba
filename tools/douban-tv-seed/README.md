# 豆瓣9分剧集三主题 灌库说明（doubanTvCn / doubanTvForeign / doubanTvAnime）

走通用主题流水线（`enrichThemeMovies` → 共享集合 `generic_theme_movies` → `getThemeMovies` 读取 → 共用页面 `pages/genericList`），
同烂番茄/奥斯卡各榜单一致，**不新增页面、不新增云函数**。

| 主题 id | 前端标题 | 豆瓣筛选条件 | 收录 |
|---|---|---|---|
| `doubanTvCn` | 豆瓣9分华语剧集 | 类型=全部剧集，地区=华语，评分 9~10 | TOP250（评分 9.8 ~ 9.2，全量池子 563） |
| `doubanTvForeign` | 豆瓣9分国外剧集 | 类型=全部剧集，地区=国外，评分 9~10 | TOP250（评分 9.8 ~ 9.5，全量池子 2910） |
| `doubanTvAnime` | 豆瓣9分动画 | 类型=动画，地区不限，评分 9~10 | TOP250（评分 9.8 ~ 9.4，全量池子 1128） |

数据源：https://movie.douban.com/tv/ 的 `m.douban.com/rexxar/api/v2/tv/recommend` 接口，采集脚本 `collect-douban-tv.js`。

`*.params.json` 每条含：`rank`（按豆瓣评分降序，同分按评分人数降序）、`year`、`title` / `originalTitle`、`doubanId`。
片名/封面/评分/导演/国家灌库时由 `enrichThemeMovies` 从豆瓣详情接口取，名单只负责给出「哪一部」。

## 采集

```bash
node tools/douban-tv-seed/collect-douban-tv.js          # 默认各取 TOP250
node tools/douban-tv-seed/collect-douban-tv.js --limit 500
```

抓到的原始池子缓存在 `.cache/`（已 gitignore 之外，手动删掉即可重抓）。接口的三个坑，脚本里都绕过了：

- 真正生效的筛选参数是 **`tags`**（逗号分隔），`selected_categories` 传了会被服务端**忽略**；
- `score_range` **只接受整数**（`9,10`），传 `9.5,10` 直接 403；
- 单个 tags 组合**最多返回 500 条**（服务端硬上限），所以按「年份」tag 分片再合并才拿得到完整池子；
- 「类型 = 全部剧集」在接口上**没有对应 tag**（传 `全部剧集` 返回 0 条），等价做法是取该地区全量池子再减去 `地区,综艺` 的池子——脚本就是这么做的。

## 灌库

`enrichThemeMovies` 云端测试，分别粘 `doubanTvCn.params.json` / `doubanTvForeign.params.json` / `doubanTvAnime.params.json` 整份
（`idStrategy:'rank'`，已带 `autoContinue:true`，点一次自动接力跑完，250 条约 20 分钟）。

名单里带了 `doubanId`，`enrichThemeMovies` 会跳过豆瓣搜索直接取详情——剧集条目的详情接口是
`/rexxar/api/v2/movie/{id}` 302 到 `/rexxar/api/v2/tv/{id}`，axios 默认跟随重定向，能正常拿到数据；
搜索路径的「非电影一律排除」质量闸门只作用于搜索候选，不影响手动指定 `doubanId` 的这条路。

灌完 `getThemeMovies` 分别测 `{ "theme": "doubanTvCn" }` 等，`movies` 长度应为 250。

## 重灌注意

榜单按**豆瓣实时评分**排序，隔段时间重抓名次一定会漂。名单里 `originalTitle` 与 `title` 同值，
是刻意给 `enrichThemeMovies` 当「同一部剧」的身份键用的：重灌时同名同年的条目会走「仅调整序号」分支，
`_id` 不变，用户已有的标记不会错位。**不要**把 `originalTitle` 删掉或改成别的值。

## 封面图

`pages/category/category.js` 走动态封面（榜单 `rank=1` 的豆瓣封面自动叠色），无需手动补图。
