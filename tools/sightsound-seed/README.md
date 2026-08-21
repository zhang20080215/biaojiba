# 视与听影史TOP250 灌库说明（sightsound）

走通用主题流水线（`enrichThemeMovies` → 共享集合 `generic_theme_movies` → `getThemeMovies` 读取 → 共用页面 `pages/genericList`），**不新增页面、不新增云函数**。

| 项 | 值 |
|---|---|
| 主题 id | `sightsound` |
| 前端标题 | 视与听影史TOP250 |
| 分类 | 电影（category `movie`） |
| 配色 | `#6E2639` / `#A05066` |
| 条数 | **263**（官方名次 1~250，含并列；1916—2021。原为 264，《铁西区》豆瓣封禁无法收录） |

## 名单从哪来

英国电影协会（BFI）杂志《视与听》(Sight and Sound) 的「影史最伟大电影」影评人票选榜，
**十年一评**，现行为 2022 年版（1639 位影评人/策展人/学者投票，《让娜·迪尔曼》登顶）。

数据源：<https://www.bfi.org.uk/sight-and-sound/greatest-films-all-time>

⚠️ 页面 DOM 是分片懒加载的，直接解析 HTML 只能拿到一部分条目。完整名单在内联脚本
`var initialPageState = {…}` 的 `componentState.results` 里，字段齐全（`rank` / `tied` /
`name` / `year` / `credits.director` / `productionCountries`），采集脚本靠花括号配平把这段
JSON 抠出来解析，不爬 DOM。

## 「TOP250」实际是 264 部

官方名次**到 250 为止，但含大量并列**——并列第 243 名有 22 部、并列第 225 名有 18 部，
条目总数因此是 264。本项目的 `rank` 必须是 1..N 连续唯一（`enrichThemeMovies` 用 rank 生成
`_id`，列表页直接把 rank 当序号显示），所以：

- `rank` 是**拍平后的 1..264 顺序号**，官方名次原样留在 `officialRank` 字段里（入库但前端当前不展示）；
- 并列组内按**年份升序 + 片名**排定。这不是审美选择，是为了**可复现**：BFI 页面组内是 CMS 顺序，
  重抓一次就可能变，而 rank 一漂 `_id` 就跟着漂，用户的标记会错位。

分类页文案写的是「含并列共 264 部」，别改成 250——名单里真有 264 条，写 250 会被用户数出来。

## 目录里都有什么

| 文件 | 说明 |
|---|---|
| `collect-sightsound.js` | 抓 BFI 页面 → 生成下面三份 json |
| `sightsound.json` | 名单本体（`movieList` 数组），`tools/validate-seed.js` 自检的就是它 |
| `sightsound.params.json` | 直接粘进 `enrichThemeMovies` 的整份参数 |
| `sightsound.source.json` | 源站原始字段留档（导演/国家/是否并列），核对匹配结果时用 |
| `resolve-douban.js` | 逐条解析豆瓣条目 id，回填 `doubanId` + 生成复核清单 |
| `sightsound.review.md` | 名单 → 豆瓣条目的对照表，`?` / `–` 行还没定下来 |
| `manual-ids.json` | 人工裁定的 `rank → doubanId`，优先级最高（缓存和名单都会被重跑覆盖，只有它不会） |
| `.cache/` | 页面 HTML、豆瓣搜索/详情、解析结果的缓存（已 gitignore，删掉即重跑） |

## 完整流程

```bash
node tools/sightsound-seed/collect-sightsound.js   # 抓名单（--refresh 忽略页面缓存重抓）
node tools/sightsound-seed/resolve-douban.js       # 解析 doubanId（断点续跑，被限流就换个时间再跑）
node tools/validate-seed.js sightsound             # 本地自检
```

**`doubanId` 解析是选做的，没跑完也能灌库**：当前名单里 24/264 条带 `doubanId`（豆瓣搜索接口
对同一 IP 有额度，跑几十条就会稳定 403，见下），其余条目 `enrichThemeMovies` 会用自己的搜索路径补上。
想补齐就过几小时重跑一次 `resolve-douban.js`，它会接着没解析的往下跑。

然后在云开发控制台跑 `enrichThemeMovies` 云端测试，粘 `sightsound.params.json` 整份
（`idStrategy:'rank'`，已带 `autoContinue:true`，点一次自动接力跑完）。

灌完用 `getThemeMovies` 测 `{ "theme": "sightsound" }`，`movies` 长度应为 **264**。

> 控制台偶发 `scf/Invoke` 报 `ret=-3 / system error`，但函数其实**已经被触发并执行**（`autoContinue`
> 也会继续接力）。遇到时**不要立刻重试**，先用 `getThemeMovies` 查实际条数，否则会起两条链同时写同一批文档。

## 为什么名单自带 `doubanId`

`enrichThemeMovies` 的搜索路径靠「原名/别名精确命中 **或** 年份差 ≤1」判定，对这份名单风险偏高：

- 全是 1916~2021 的老片/冷门片，BFI 给的是**英文通用名**，跟豆瓣 `original_title`（常是法语/日语/俄语原名）
  对不上时就只剩年份一个信号，容易撞到同名翻拍或同名纪录片；
- 名单里有剧集和影像论文（《双峰：回归》《电影史》），搜索路径的「非电影一律排除」质量闸门
  会直接把它们判成未匹配。

所以先在本地用 `resolve-douban.js` 把 id 解析出来写进名单：名单带 `doubanId` 时 `enrichThemeMovies`
走「手动指定」分支，**跳过搜索直接取详情**，也不受该闸门限制，顺带把云端耗时压掉一大截。

解析用的两个接口（本机可直连；桌面站和 `j/subject_suggest` 对非豆瓣 IP 一律 302，只有 rexxar 能用）：

```
搜索 https://m.douban.com/rexxar/api/v2/search/movie?q=…   必须带 m.douban.com 的 Referer
详情 https://m.douban.com/rexxar/api/v2/movie/{id}          剧集条目会 302 到 /tv/{id}，自动跟随
```

⚠️ **搜索接口对同一 IP 有额度**：连续跑几十条之后会稳定返回 403 `need_login`（详情接口不受影响，
换 UA / 加 `bid` cookie 都没用），要等几个小时才放开。所以这个脚本是「跑不完就换个时间接着跑」的用法，
不是一口气跑完的用法——脚本已经退避重试 + 全量缓存 + 连续 10 条拿不到候选就主动停下，
**只记成 miss 的条目下次重跑会再试**（不然限流的锅就永久烙进名单了）。
云函数不吃这份额度（请求是从腾讯云 IP 发的），所以没解析出来的条目照样能灌。

解析结果全在 `sightsound.review.md`，三种状态：

| | 含义 |
|---|---|
| `✓` | 自动判定通过（原名/别名命中且年份吻合，或年份完全一致的高分候选），名单里已带 `doubanId` |
| `✓人工` | `manual-ids.json` 里人工裁定的 |
| `?` | 找到候选但判定没过，名单里**不带** `doubanId` |
| `–` | 还没解析（多半是当时被限流），重跑脚本即可 |

`?` 的条目人眼核对一下往往是对的（比如《五至七时的克莱奥》：法语原名 `Cléo de 5 à 7` 跟名单的英文名
`Cléo from 5 to 7` 对不上，只剩年份一个信号，分不够）。确认无误后写进 `manual-ids.json`：

```json
{
  "14": { "doubanId": "1294565", "note": "五至七时的克莱奥" }
}
```

**别直接改 `sightsound.json`**——那份是脚本回写的产物，下次跑就没了；`manual-ids.json` 才是留得住的。
只想按现有缓存重新回写名单和清单（不发任何请求）用：

```bash
node tools/sightsound-seed/resolve-douban.js --report-only
node tools/sightsound-seed/resolve-douban.js --only 128   # 重解析单条
```

## 片名/导演/国家都交给豆瓣

名单里的 `title` 保持**英文原名**，灌库时 `enrichThemeMovies` 会用豆瓣详情的大陆标准简体片名覆盖
`title`、把英文名留档到 `sourceTitle`（同 letterboxd500 的做法）。

导演和国家**刻意不写进名单**：BFI 给的是英文人名/国名，写进去列表页就会显示一行英文；留空则由
`enrichThemeMovies` 从豆瓣详情自动补中文。源站的英文导演/国家在 `sightsound.source.json` 里留着，
复核清单里也带上了，用来核对匹配对不对。

## `originalTitle` 是身份键，别改

`originalTitle` 与名单初始 `title` 同值（都是英文原名），承担的是「同一部片」的身份键：
重抓/重排时 `enrichThemeMovies` 靠 `originalTitle + year` 认出是同一部片，走「仅调整序号」分支，
`_id` 不变、用户标记不错位。灌库后库里的 `title` 会变成中文，`originalTitle` 不会——**不要**
把它删掉或改成中文片名。

## 换版重灌要先清库

`enrichThemeMovies` 只做 upsert，**没有删除逻辑**。下一届（2032 年版）名单出来后直接重灌的话，
旧名单里有、新名单里没有的条目会残留成孤儿文档，`getThemeMovies` 会把它们一起返回，条数超出且 rank 错乱。
换名单前先在云开发控制台「数据库 → 高级操作」清掉该主题：

```js
db.collection('generic_theme_movies').where({ theme: 'sightsound' }).remove()
```

（云存储里 `sightsound_covers/` 下的旧封面不会被连带删除，量小可忽略，也可以在存储页手动清。）

## 封面图

`pages/category/category.js` 走动态封面（榜单 `rank=1` 的豆瓣封面自动叠色），无需手动补图。
