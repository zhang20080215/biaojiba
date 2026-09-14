# IMDb TOP250 名单刷新流程

## 为什么是「本地取名单 + 云函数灌库」

imdb.com 对**云函数出口 IP 和开发机都做了反爬**：

| 通路 | 结果 |
|---|---|
| 开发机 axios 直连 `www.imdb.com/chart/top/` | `202` + 空 body（反爬挑战页） |
| `api.graphql.imdb.com` POST | `403` |
| `m.imdb.com` | TLS 握手直接断开 |
| **带 JS 引擎的浏览器打开同一个 URL** | **正常，`__NEXT_DATA__` 完整** |

所以原来 `fetchImdbMovies` 里「云函数自己抓 imdb.com」那条路早就废了，
每天 3 点的 `dailyFetchMovies` 定时器一直在空转，榜单停更在 2026-03 前后。
现在改成：**名单本地取 → 生成 `imdbTop250.js` → 随函数部署**，
云函数只做它能做的事（下封面转云存储、查豆瓣中文译名、写库、软删掉榜）。
定时器已从 `config.json` 移除（名单是随代码走的快照，定时跑没有意义）。

## 刷新名单（大约每季度一次）

1. **取数据**：用带 JS 引擎的浏览器打开 `https://www.imdb.com/chart/top/`，
   在页面里执行：

   ```js
   (() => {
     const d = JSON.parse(document.getElementById('__NEXT_DATA__').textContent);
     const e = d.props.pageProps.pageData.chartTitles.edges;
     const P = 'https://m.media-amazon.com/images/M/', S = '._V1_.jpg';
     return e.map((x, i) => [
       i + 1, x.node.id, x.node.titleText.text, x.node.releaseYear.year,
       x.node.ratingsSummary.aggregateRating, x.node.ratingsSummary.voteCount,
       x.node.primaryImage.url.slice(P.length, -S.length)
     ].join('|')).join('\n');
   })()
   ```

   > 封面 URL 全部形如 `<前缀>MV5Bxxxx@._V1_.jpg`，所以只存中间那段 key，
   > 前后缀在 `imdbTop250.js` 里拼回去。取之前先确认没有例外（判断 `startsWith(P) && endsWith(S)`）。

2. **落盘**：存成 `imdb-top250.<日期>.psv`（本目录），
   然后改 `imdbTop250.js` 里的数组和 `SNAPSHOT_DATE`。
   `rank` 必须是连续的 1..250。

3. **预演**：部署后先跑 dryRun，看差异对不对，**不写库**：

   ```json
   {
     "dryRun": true
   }
   ```

   返回里重点看 `newEntries`（新进榜）/ `dropOuts`（掉榜）/ `needTranslate`（还没有中文名的）。
   掉榜数量异常大（比如几十部）说明名单取错了，别往下走。

4. **灌库**：

   ```json
   {
     "autoContinue": true
   }
   ```

   封面下载慢，单次容器跑不完会自动接力（`startFrom` 续跑，同 `fetchScenic5A`）。
   跑完看返回的 `untranslated` —— 那些是豆瓣没搜到中文名、暂时留英文原名的，
   通常是刚上映的新片，可以过阵子重跑或在控制台手改。

## 注意

- **`_id` 就是 IMDb ID**，重新灌库不会动用户的 `Marks`。别改这个约定。
- 名单里的 `title` 是**原名**（英文或原产地语言），中文名由云函数查豆瓣补，
  写库时英文原名存进 `originalTitle`。已经是中文的记录不会被英文覆盖。
- 掉榜影片是**软删除**（`isTop250: false` + `exitTop250Time`），
  `getMoviesData` 按 `isTop250 != false` 过滤，用户在旧榜单上的标记因此不会丢。
- **部署后核一遍控制台里的线上超时值**。`config.json` 写的是 600，
  但按 `searchMovieByTitle` 那次的教训，「上传并部署」不一定更新函数配置，
  线上可能还停在默认 3 秒 —— 这个函数要下 250 张封面，3 秒必挂。
- `forceRefresh: true` 会把已经转存好的封面重下一遍，旧文件会变成云存储里的孤儿。
  只有 IMDb 换了封面图才需要，平时别加。
