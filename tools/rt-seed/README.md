# Rotten Tomatoes 片单灌库说明（rtHorror / rtWar / rtAnimation）

三个新主题都走**通用主题流水线**（`enrichThemeMovies` → 共享集合 `generic_theme_movies` → `getThemeMovies` 读取）。
本目录三份 JSON 是从烂番茄榜单抓取解析的 `movieList`（含 `rank / title / originalTitle / year / rtScore`），已连续编号（第 1 名在前）。

| 主题 id | 片单文件 | 数量 | 来源 |
|---|---|---|---|
| `rtHorror` | `rtHorror.json` | 200 | https://editorial.rottentomatoes.com/guide/best-horror-movies-of-all-time/ |
| `rtWar` | `rtWar.json` | 150 | https://editorial.rottentomatoes.com/guide/best-war-movies-of-all-time/ |
| `rtAnimation` | `rtAnimation.json` | 138 | https://editorial.rottentomatoes.com/guide/essential-animated-movies/ （含第 2 页） |

> 说明：战争榜源站标题即「150 Best War Movies」，只有 150 部；动画榜源站自身编号跳过 #45、#98，实际 138 部。均按源站真实数量收录。

## 灌库步骤（在微信开发者工具里操作）

1. 先确保 `cloudfunctions/enrichThemeMovies` 已 **上传并部署**（依赖装好：`cd cloudfunctions/enrichThemeMovies && npm install`）。
2. 在「云开发控制台 → 云函数 → enrichThemeMovies → 云端测试」里，传入下面的参数对象。
   `movieList` 的值直接把对应 `*.json` 文件的**整个数组**粘进去。

恐怖（先跑这个验证链路）：

```json
{
  "theme": "rtHorror",
  "idStrategy": "rank",
  "forceRefresh": false,
  "startFrom": 0,
  "movieList": [ 把 tools/rt-seed/rtHorror.json 的整个数组粘到这里 ]
}
```

战争：

```json
{
  "theme": "rtWar",
  "idStrategy": "rank",
  "forceRefresh": false,
  "startFrom": 0,
  "movieList": [ 把 tools/rt-seed/rtWar.json 的整个数组粘到这里 ]
}
```

动画：

```json
{
  "theme": "rtAnimation",
  "idStrategy": "rank",
  "forceRefresh": false,
  "startFrom": 0,
  "movieList": [ 把 tools/rt-seed/rtAnimation.json 的整个数组粘到这里 ]
}
```

## 分批续跑

`enrichThemeMovies` 每次跑一批（会在接近云函数超时前主动停下），返回结果里带
`hint` 和 `nextStartFrom`。若没跑完，**用同一份 movieList**、把 `startFrom` 改成返回的
`nextStartFrom` 再点一次，直到 `hint` 显示「全部处理完成」。重复跑不会覆盖已订正的中文片名。

## 灌完后校验

- `getThemeMovies` 云端测试：`{ "theme": "rtHorror" }`，应返回 `success:true` 且 `movies` 长度=200。
- 三个主题片名会被自动订正为豆瓣简体中文名（原始英文名存到 `sourceTitle`）。
  个别没匹配到豆瓣的，控制台日志会打印「豆瓣未匹配到」，可事后用 `checkDoubanTitles` 或手动补。

## 待补充：封面图

`pages/category/category.js` 里三张卡片引用了封面：
`/images/cover-rt-horror.jpg`、`/images/cover-rt-war.jpg`、`/images/cover-rt-animation.jpg`（尚未创建）。
补图后放到 `images/` 即可（注意 iOS 真机不渲染 webp，用 jpg/png）。
