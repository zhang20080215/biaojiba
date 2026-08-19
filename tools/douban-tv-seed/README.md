# 豆瓣9分剧集三主题 灌库说明（doubanTvCn / doubanTvForeign / doubanTvAnime）

走通用主题流水线（`enrichThemeMovies` → 共享集合 `generic_theme_movies` → `getThemeMovies` 读取 → 共用页面 `pages/genericList`），
同烂番茄/奥斯卡各榜单一致，**不新增页面、不新增云函数**。

| 主题 id | 前端标题 | 豆瓣筛选（页面下拉） | 接口 tags | 收录 |
|---|---|---|---|---|
| `doubanTvCn` | 豆瓣9分华语剧集 | 类型=电视剧，地区=华语，评分 9~10 | `电视剧,华语` | 168 条（该口径全量）|
| `doubanTvForeign` | 豆瓣9分国外剧集 | 类型=电视剧，地区=国外，评分 9~10 | `电视剧,国外` | 综合排序前 250（池 500 上限）|
| `doubanTvAnime` | 豆瓣9分动画 | 类型=动画，地区不限，评分 9~10 | `动画` | 综合排序前 250（池 500 上限）|

数据源：https://movie.douban.com/tv/ 的 `m.douban.com/rexxar/api/v2/tv/recommend` 接口，采集脚本 `collect-douban-tv.js`。

`*.params.json` 每条含：`rank`（**豆瓣综合排序位次**）、`year`、`title` / `originalTitle`、`doubanId`。
片名/封面/评分/导演/国家灌库时由 `enrichThemeMovies` 从豆瓣详情接口取，名单只负责给出「哪一部」。

## 两个口径必须钉死

### 1. 类型选「电视剧」，不是「全部剧集」

「全部剧集」把**动画和纪录片**也算进来，华语榜里会混进《葫芦兄弟》《舌尖上的中国》这类条目。
「电视剧」天然排除综艺/纪录片/动画，三个主题正好正交，也不需要再单独减综艺池。

```
华语 前 5：漫长的季节 / 沉默的真相 / 后宫·甄嬛传 / 琅琊榜 / 想见你
国外 前 5：请回答1988 / 非自然死亡 / 神探夏洛克 第一季 / 致命女人 第一季 / 权力的游戏 第一季
动画 前 5：爱，死亡和机器人 第一季 / 猫和老鼠 / 鬼灭之刃 / 灌篮高手 / 哆啦A梦
```

### 2. 排序用「综合排序」`sort=T`（页面默认）

名单顺序 = 用户在 movie.douban.com/tv/ 上往下滚看到的顺序。

⚠️ **不要改成 `sort=S`（高分优先）**。9 分区间里评分 9.6+ 的绝大多数是长寿动画/美剧的分季条目，
按评分取前 250 会把 9.0~9.3 这一段整体砍掉——《爱，死亡和机器人》《鬼灭之刃》《葫芦兄弟》
《英雄联盟：双城之战》这些页面首屏就有的条目会全部丢失，跟用户在豆瓣上看到的完全对不上。

## 采集

```bash
node tools/douban-tv-seed/collect-douban-tv.js          # 上限 250，不足则全收
node tools/douban-tv-seed/collect-douban-tv.js --limit 200
```

抓到的原始池子缓存在 `.cache/`（已 gitignore，删掉即重抓）。接口的几个坑，脚本里都绕过了：

- 真正生效的筛选参数是 **`tags`**（逗号分隔），`selected_categories` 传了会被服务端**忽略**；
- `score_range` **只接受整数**（`9,10`），传 `9.5,10` 直接 403；
- 单个 tags 组合**最多返回 500 条**（服务端硬上限）。华语电视剧 9 分以上总共才 168 条没碰到上限，
  国外电视剧/动画都是 500，取前 250 够用；真要超过 500 条得按「年份」tag 分片再合并。

## 灌库

`enrichThemeMovies` 云端测试，分别粘 `doubanTvCn.params.json` / `doubanTvForeign.params.json` / `doubanTvAnime.params.json` 整份
（`idStrategy:'rank'`，已带 `autoContinue:true`，点一次自动接力跑完，250 条约 20 分钟）。

名单里带了 `doubanId`，`enrichThemeMovies` 会跳过豆瓣搜索直接取详情——剧集条目的详情接口是
`/rexxar/api/v2/movie/{id}` 302 到 `/rexxar/api/v2/tv/{id}`，axios 默认跟随重定向，能正常拿到数据；
搜索路径的「非电影一律排除」质量闸门只作用于搜索候选，不影响手动指定 `doubanId` 的这条路。

灌完 `getThemeMovies` 分别测 `{ "theme": "doubanTvCn" }` 等，`movies` 长度应为 168 / 250 / 250。

> 控制台偶发 `scf/Invoke` 报 `ret=-3 / system error`，但函数其实**已经被触发并执行**（`autoContinue` 也会继续接力）。
> 遇到时**不要立刻重试**，先用 `getThemeMovies` 查实际条数，否则会起两条链同时写同一批文档。

## 换名单重灌要先清库

`enrichThemeMovies` 只做 upsert，**没有删除逻辑**。名单内容变了（换排序口径、换类型口径）直接重灌，
旧名单里有、新名单里没有的条目会残留成孤儿文档，`getThemeMovies` 会把它们一起返回，条数超出且 rank 错乱。
换名单前先在云开发控制台「数据库 → 高级操作」清掉该主题：

```js
db.collection('generic_theme_movies').where({ theme: 'doubanTvCn' }).remove()
```

（云存储里 `doubanTvCn_covers/` 下的旧封面不会被连带删除，量小可忽略，也可以在存储页手动清。）

## 重灌注意

榜单按**豆瓣综合排序**，隔段时间重抓名次会漂。名单里 `originalTitle` 与 `title` 同值，
是刻意给 `enrichThemeMovies` 当「同一部剧」的身份键用的：重灌时同名同年的条目会走「仅调整序号」分支，
`_id` 不变，用户已有的标记不会错位。**不要**把 `originalTitle` 删掉或改成别的值。

## 封面图

`pages/category/category.js` 走动态封面（榜单 `rank=1` 的豆瓣封面自动叠色），无需手动补图。
