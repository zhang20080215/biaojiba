# 世界文艺电影250 灌库说明（arthouse）

走通用主题流水线（`enrichThemeMovies` → 共享集合 `generic_theme_movies` → `getThemeMovies` 读取 → 共用页面 `pages/genericList`），**不新增页面、不新增云函数**。

| 项 | 值 |
|---|---|
| 主题 id | `arthouse` |
| 前端标题 | 世界文艺电影250 |
| 分类 | 电影（category `movie`） |
| 配色 | `#2E3A59` / `#5E6E96` |
| 条数 | 250（148 位导演、35 个国家与地区、1925—2022） |

## 名单从哪来

**不是从某个网站抓的，是编的** —— 这一点与本仓库其他所有主题都不同（烂番茄、奥斯卡、Letterboxd、豆瓣剧集都有源站给定的名单和排名）。

收录口径：**以作者性为准，类型外壳不排除**。库布里克的科幻、黑泽明的时代剧、奉俊昊的惊悚都算数；纯商业类型片、纪录片、动画、剧集不收。单一导演上限 5 部——这条是硬约束，为的是把名额让给覆盖面，否则光伯格曼和塔可夫斯基就能吃掉十几个位置。

`arthouse.json` 每条含：`rank`、`year`、`title`、`originalTitle`、`director`、`country`。

**`originalTitle` 与 `title` 同值，是刻意的，别改**。剧集主题那边同样处理。它在这里承担的是「同一部片」的身份键：本主题的 rank 由豆瓣评分算出来、会随评分漂移，重排时 `enrichThemeMovies` 靠 `originalTitle + year` 认出是同一部片，走「仅调整序号」分支，`_id` 不变、用户标记不错位。改掉它，重排就会变成大规模重灌。

## 排名怎么定的

名单本身没有天然排名，rank 用**豆瓣评分的贝叶斯加权**算出来：

```
WR = v/(v+m) × R + m/(v+m) × C
```

- `R` 该片豆瓣评分、`v` 该片评分人数
- `C` 全部条目的平均分
- `m` 票数门槛，默认取全部条目评分人数的 **25% 分位**

这 250 部的评分人数跨了四个数量级（《霸王别姬》两百多万人，《旺妲的房间》几百人），直接按 `R` 排会让「只有铁杆影迷去打分」的冷门片盖过公认经典。加权把小样本往均值拉。

⚠ **`m` 不要取中位数**：那会让一半条目重度回归均值、彼此区分度消失（实测 9.5 分和 8.2 分的冷门片加权后只差千分之几）。25% 分位只压住真正的小样本。想调松/调紧用 `--m`。

## 灌库：三步

### 第一步：部署改过的 enrichThemeMovies

`fetchDoubanDetail` 新增了 `ratingCount`（豆瓣评分人数），贝叶斯加权要用。**必须重新部署**，否则第三步算不出来。这是加字段，对其他主题无影响。

### 第二步：按年份序灌一遍

`enrichThemeMovies` 云端测试，粘 `arthouse.params.json` 整份（已带 `autoContinue:true`，点一次自动接力跑完，250 条约 20 分钟）。

此时 rank 是**临时的年份序**（rank 1 = 1925《战舰波将金号》），不是最终排名。

灌完 `getThemeMovies` 测 `{ "theme": "arthouse" }`，`movies` 长度应为 250，且每条都带 `rating` 和 `ratingCount`。

### 第三步：算出真实 rank 再灌一遍

```bash
node tools/arthouse-seed/rerank.js tools/arthouse-seed/_fetched.json
```

`_fetched.json` 就是第二步 `getThemeMovies` 返回的整份 JSON（存成文件即可，脚本兼容整份返回 / `result` 那层 / 直接是 `movies` 数组三种粘法）。

脚本会打印票数分位、加权后的前 10 和后 5，确认合理后把生成的 `arthouse.rerank.params.json` 整份粘进 `enrichThemeMovies`。

**这一轮是秒级的**：不重新爬豆瓣、不重下封面，只改 rank。

日后豆瓣评分漂了，重跑第三步就能刷新排名，用户标记不受影响。

## 已知问题

**三条中文译名未经核实**（做名单时本地 IP 触发了豆瓣风控，搜索接口不可用）：

| 原名 | 名单里用的 | 可能的另一译法 |
|---|---|---|
| *Le Temps retrouvé* (1999) | 追忆似水年华 | 重现的时光 |
| *Abschied von gestern* (1966) | 昨日女孩 | 告别昨天 |
| *Salvatore Giuliano* (1962) | 龙头之死 | — |

片子本身没选错。灌库时 `enrichThemeMovies` 会用豆瓣标准简体片名覆盖 `title`、把名单原标题存进 `sourceTitle`，所以**这三条大概率会自动订正**；如果搜不到（`unmatchedMovies` 里会报），人工去豆瓣查到 `doubanId` 填进名单单条重跑即可。

**匹配风险**：`originalTitle` 是中文名而非外文原名，`enrichThemeMovies` 的搜索兜底策略（英文名+年份）失效，全靠「中文名 + 年份」匹配。对中文豆瓣来说这通常更准，但泛用片名（《镜子》《爱》《诗》《记忆》《回归》《豹》《蚀》）容易撞车。灌完务必看返回里的 `matchWarnings` 和 `unmatchedMovies`，逐条核对封面对不对。

## 封面图

`pages/category/category.js` 走动态封面（榜单 `rank=1` 的豆瓣封面自动叠色），无需手动补图。注意第三步重排后 rank 1 会换片，卡片封面会跟着变。
