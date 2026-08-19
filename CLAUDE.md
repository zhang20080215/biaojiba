# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

XiaoBiaoji (标记吧) is a WeChat Mini Program with several feature areas:
1. **Movie / book tracking** — Douban Top 250 (movies + books), IMDb Top 250, Oscar Best Pictures (`oscar`), Oscar Best Animated Feature (`oscarAnime`, 最佳动画长篇), Oscar Best Cinematography (`oscarCinematography`, 最佳摄影), 票房榜 (boxoffice), WeChat Reading Top 200, plus themes kept in source but pack-excluded for now (annual / chinese / chinese-awards). All share the same list+poster pattern, swap data source. Most movie ranking/award themes (17 as of this writing — `oscarCinematography`/`rtHorror`/`rtWar`/`rtAnimation`/`palmeDor`/`oscarScreenplay`/`letterboxd500`/`oscarForeign`/`rtAction`/`oscarDirector`/`oscarVFX`/`oscarActor`/`oscarActress`/`doubanTvCn`/`doubanTvForeign`/`doubanTvAnime`/`arthouse`) run on the generic `enrichThemeMovies`/`getThemeMovies` pipeline and share one page set, `pages/genericList`. Book award/ranking themes (starting with 茅盾文学奖, `maodun`) run on the equivalent book pipeline, `enrichThemeBooks`/`getThemeBooks` + shared page set `pages/genericBookList`. See Generic Theme Pipelines.
2. **Movie rating search** (`pages/movie-search`, 全平台电影评分查询) — search any movie by title, aggregate 豆瓣 + IMDb + 烂番茄 (Tomatometer critic + Popcornmeter audience) scores. Independent data path (own collections + cloud functions), separate from the Top-N tracking pattern.
3. **Child growth assessment** — 0~7岁发育评估 based on WS/T 423-2022 national standard, with precise percentile calculation and shareable report posters.
4. **Daily check-in** — Theme-driven daily tracker. Live themes: **每日喝水** (`water`, shared `pages/daily/index` + `pages/daily/stats` page set) plus three richer themes with their own page sets — **每日电影** (`movie`), **每日读书** (`read`), **每日运动** (`sport`). See Daily Check-In Theme.
5. **Subscription push** — WeChat subscribe-message framework for TOP250 new-entry alerts and daily reminders. See Subscription & Push.

Built on WeChat Cloud (serverless cloud functions + cloud database).

## Architecture

**Frontend:** WeChat Mini Program (WXML/WXSS/JS) with Canvas 2D API for poster generation.

**Backend:** WeChat Cloud Functions (Node.js + `wx-server-sdk`) in `cloudfunctions/`. Each function is independently deployed with its own `package.json`.

**Entry point:** `pages/category/category` — tab-filtered card grid (`全部/电影/剧集/奥斯卡/读书/旅行/育儿`), routes to all themes.

### Movie / Book Theme Pattern
Each tracking theme (douban/imdb/oscar/doubanBooks/weread + the pack-excluded ones) follows:
- `pages/{theme}/list/` — list with tab filtering, batch marking, image prefetching
- `pages/{theme}/share/` — canvas poster wall generation
- `utils/{theme}PosterDrawer.js` — grid rendering (12 cols, 1242×1660 canvas, 8-poster batch loading); `weread` uses a text-poster variant
- Cloud function `fetch{Theme}{Movies|Books}` — data scraping/enrichment
- Marks split by collection: movies → `Marks`, books (douban/weread) → `BookMarks`; cloud function `batchUpdateBookMarks` mirrors `batchUpdateMarks`

**Data flow:** Pages → `utils/dataLoader.js` (24-hour client cache) → `getMoviesData`/`getThemeMovies`/`getThemeBooks` cloud function (routed by theme id) → Cloud DB collections (`movies`, `imdb_movies`, `oscar_movies`, `oscar_anime_movies`, `generic_theme_movies`, `douban_books`, `weread_books`, `generic_theme_books`, `Marks`, `BookMarks`)

**Douban TOP250 auto-refresh:** `fetchMovies` (timer-triggered; tolerant of the new cloud runtime `Type=Timer` event wrapper) re-scrapes Douban TOP250 daily into `movies`. Guards against scraper failures: writes are rejected if fewer than `MIN_ACCEPT_COUNT` (240) items are scraped. Tracks a version doc + soft-delete rollback doc, detects `_id` drift (same title, different `_id`), and emits `push_events` + `rank_history` entries consumed by the push framework.

### Generic Theme Pipelines

**Fast-onboarding a new curated-list theme (no new cloud function, no new page directory):** for a one-off ranking/list theme (user hands over a list, or a source to extract one from — not an auto-refreshed daily scrape), use one of the two generic pipelines below instead of copying a new `fetch{Theme}{Movies|Books}` function or a new page directory. Movies and books each have their own parallel pipeline (backend collection + cloud functions + shared page set + config file); a new theme is just a config-table row + a category.js card.

**Movies** (17 themes as of this writing — `oscarCinematography`/`rtHorror`/`rtWar`/`rtAnimation`/`palmeDor`/`oscarScreenplay`/`letterboxd500`/`oscarForeign`/`rtAction`/`oscarDirector`/`oscarVFX`/`oscarActor`/`oscarActress`/`doubanTvCn`/`doubanTvForeign`/`doubanTvAnime`/`arthouse`):
- `cloudfunctions/enrichThemeMovies` — takes `{ theme, movieList: [{rank, year, title, originalTitle, ...extra}], idStrategy: 'rank'|'title-year', forceRefresh, startFrom }`, does the same Douban-search-match + cover-download-upload + resumable-batch-upsert logic as `fetchOscarAnimeMovies`, and writes into the **shared** `generic_theme_movies` collection (`_id` prefixed `${theme}_...`, discriminated by a `theme` field). Douban cover + rating only — no IMDb/OMDb (that path is per-movie daily-rate-limited, unsuitable for bulk seeding). **Title normalization:** after matching a `doubanId` it fetches the Douban rexxar detail and overwrites `title` with the mainland-standard (simplified) name, archiving the list's raw title into `sourceTitle` — 港台/繁体 source lists land as 简体 automatically; re-running the same raw list won't clobber corrected titles (the light-patch path skips `title` when it equals `sourceTitle`). `cloudfunctions/checkDoubanTitles` (`{theme, apply}` mode) audits/fixes titles for already-seeded themes; `cloudfunctions/checkThemeRankGaps` diagnoses missing/duplicate `rank` values.
- `cloudfunctions/getThemeMovies` — read-side counterpart, query-by-`theme` against `generic_theme_movies`, response shape matches `getMoviesData` (`{success, movies, marks, listVersion}`). Deliberately a **separate** function so existing themes' `getMoviesData` path is untouched.
- `utils/dataLoader.js`'s `GENERIC_THEMES` Set + `cloudFnForTheme(theme)` route a theme id to `getThemeMovies` vs `getMoviesData`; register a new theme id there.
- Frontend: **one shared page set**, `pages/genericList/{list,share}`, driven by `?theme=xxx` + `utils/genericThemeConfig.js` (`THEME_CONFIG` table: title/slogan/brand colors/`showEdition`/`editionField`/`orderDirection`). Marks reuse the plain `Marks` collection (no `source` discriminator needed — `_id`s are theme-prefixed and globally unique). Poster drawing (poster wall + text capsule/list styles) is inlined in `share.js`, no per-theme `PosterDrawer` module.
- `pages/category/category.js`'s `_countThemeUsers` `themeConfigs` entries support an optional `theme` key (`{ id, collection: 'generic_theme_movies', theme: 'xxx' }`); `DYNAMIC_COVER_THEMES` (dynamic card cover = theme's `rank:1` item's cover) also needs an entry.
- Onboarding a new theme = one `THEME_CONFIG` row + one `GENERIC_THEMES` entry + one `themeConfigs`/`DYNAMIC_COVER_THEMES` row + one category.js card. No new pages, no new cloud function, no new `PosterDrawer`.

**Douban TV themes** (`doubanTvCn`/`doubanTvForeign`/`doubanTvAnime` — 豆瓣高分华语剧集 / 9分国外剧集 / 9分动画; category tab 剧集): same movie pipeline, but the seed lists are scraped from Douban's own 选剧集 explore API rather than an editorial page — see `tools/douban-tv-seed/` (collector script + README). Two seed conventions are load-bearing and both were gotten wrong on the first cut. **Type filter is 电视剧, not 全部剧集** — 全部剧集 also pulls in animation and documentaries, which put 《葫芦兄弟》/《舌尖上的中国》 into the 华语 list; 电视剧 excludes 综艺/纪录片/动画 outright, so the three themes stay orthogonal and no 综艺 subtraction is needed. **Order is Douban's default 综合排序 (`sort=T`)**, the order a user sees scrolling the page — *not* `sort=S` (高分优先): within 9~10 almost everything at 9.6+ is a per-season entry of a long-running anime/US series, so taking the top N by rating drops the whole 9.0~9.3 band and loses first-screen entries like 《爱，死亡和机器人》/《鬼灭之刃》. Tag strings are `电视剧,华语` / `电视剧,国外` / `动画`, each cut at 250. 华语 runs a `score_range` of 8~10 rather than 9~10 — that filter yields only 168 titles at 9+, too few for 250 — so its front-end title is 「豆瓣高分华语剧集」, deliberately not 「9分」 (about 185 of its 250 sit below 9.0); change the threshold back and the title in `genericThemeConfig.js` + `category.js` has to change with it. Three API gotchas are documented there: only `tags` filters (`selected_categories` is silently ignored server-side), `score_range` rejects decimals, and any single `tags` combo caps at 500 items (partition on year tags if a list ever needs more). Seed rows carry `doubanId`, so `enrichThemeMovies` skips its Douban search entirely and pulls the detail directly — TV detail lives at `/rexxar/api/v2/tv/{id}`, which `/movie/{id}` 302s to and axios follows, and the search path's "non-movie subtype" quality gate doesn't apply to the manual-`doubanId` branch. `originalTitle` is deliberately set equal to `title`: these lists are ranked by *live* Douban rating, so ranks drift on every re-seed, and the title+year identity key is what keeps `_id` (and therefore users' marks) stable across re-runs.

**Arthouse theme** (`arthouse` — 世界文艺电影250): the one theme whose list is **authored rather than scraped** — no source site, no given ranking — so two things work differently. (1) `rank` is computed from a **Bayesian-weighted Douban rating** (the IMDb Top250 formula) instead of taken from a source: `enrichThemeMovies` now also stores `ratingCount`, and `tools/arthouse-seed/rerank.js` turns a `getThemeMovies` dump into a second params file that rewrites only `rank`. The vote threshold `m` is the **25th percentile, not the median** — at the median half the list collapses onto the mean and loses all ordering (a 9.5-rated and an 8.2-rated obscurity end up thousandths apart). (2) That second pass is cheap only because `originalTitle` is set equal to `title`, which lets the "same film, new rank" branch match on title+year and skip the Douban fetch entirely; change `originalTitle` and every re-rank becomes a full re-seed. Selection rule is authorial voice over genre (Kubrick sci-fi and Bong thrillers are in), capped at 5 films per director so coverage wins over auteur stacking. Because `originalTitle` is a Chinese title rather than the foreign original, the search path loses its English-title fallback —泛用 titles (《镜子》《爱》《诗》《记忆》) are the ones to check in `matchWarnings` after seeding. See `tools/arthouse-seed/README.md`.

**Books** (`maodun` — 茅盾文学奖 — as of this writing; parallel structure, independently extensible):
- `cloudfunctions/enrichThemeBooks` — takes `{ theme, bookList: [{rank, edition, year, title, author, ...extra}], idStrategy, forceRefresh, startFrom }`, writes into the **shared** `generic_theme_books` collection (`_id` prefixed `${theme}_...`). Matching strategy differs from the movie pipeline: books have no original-title/aka concept and print-edition years vary too widely to use as a signal, so matching is by **normalized-title exact equality** (with author-overlap as a secondary, non-blocking confidence check) instead of title+year — search candidates come from Douban's `cat=1001` (books) search page + `subject_suggest` fallback (same approach as `cloudfunctions/searchBookByTitle`), verified via the Douban rexxar book detail endpoint (same approach as `cloudfunctions/fetchBookFullInfo`). Same `sourceTitle` archival / resumable-batch / `skipValidation` conventions as the movie pipeline.
- `cloudfunctions/getThemeBooks` — read-side counterpart, query-by-`theme` against `generic_theme_books` + marks from `BookMarks` (not `Marks`). Response field is still named `movies` (not `books`) — matches `getMoviesData`'s existing convention for `douban_books`/`weread`, so `utils/dataLoader.js`'s `loadMoviesData()` wrapper stays theme-agnostic.
- `utils/dataLoader.js`'s `GENERIC_BOOK_THEMES` Set (checked before `GENERIC_THEMES`) routes a book theme id to `getThemeBooks`.
- Frontend: **one shared page set**, `pages/genericBookList/{list,share}`, driven by `?theme=xxx` + `utils/genericBookThemeConfig.js` (same shape as the movie config, plus a `source` field). Marks reuse the shared `BookMarks` collection (`status: 'read'|'wish'|'unread'`, `unread` deletes the record) — each generic book theme gets its own `source` value for bookkeeping (not required for correctness, since `bookId`s are already theme-prefixed and globally unique); `cloudfunctions/batchUpdateBookMarks`'s `source` param passes through arbitrary values (not just `'douban'`/`'weread'`).
- `pages/category/category.js`'s `_countThemeUsers` `themeConfigs` row needs `marksCollection: 'BookMarks'`, `idField: 'bookId'`, and `source` in addition to `collection`/`theme`; `DYNAMIC_COVER_THEMES` needs `collection: 'generic_theme_books'` (the field defaults to `generic_theme_movies` when omitted).
- `douban_books`/`weread` (the two pre-existing book themes) are **not** on this pipeline — they keep their own dedicated `fetchDoubanBooks`/`fetchWereadBooks` cloud functions and `pages/doubanBooks/`/`pages/weread/` page sets (direct full-list scrapes, not search-matched seeding, and predate the generic pipeline). Only new book themes added going forward use `enrichThemeBooks`/`pages/genericBookList`.

### Boxoffice Theme (`pages/boxoffice`, 全球电影票房榜)
TOP100 by worldwide lifetime gross, **hardcoded** in `cloudfunctions/fetchBoxofficeMovies`'s `BOXOFFICE_DATA` — no scraper, no timer (`config.json`'s `triggers` is empty). Two actions: `seed` (upsert the array into `boxoffice_movies`, covers untouched) and `covers` (Douban cover → cloud storage, 50s self-guard + `startFrom` resume, `onlyRanks` for single-row fixes).
- **The live DB can run ahead of the hardcoded array.** As of 2026-08 it did — DB already held the current 100 while the source array was still a 2026-03 snapshot. Since `seed` deletes every doc whose `originalTitle` is not in the array, running it with a stale array silently reverts the live list, drops newly-charted films, and orphans those users' `Marks`. **Diff DB against the array before running `seed`** (client-side queries cap at 20 docs per page, so page through).
- **`originalTitle` + `year` is the identity key** `seed` matches on. Refreshing numbers means editing `boxOffice` only — leave title/year/country/director byte-identical, or the record is re-created under a new `_id` and its marks orphan. `rank` is recomputed from `boxOffice` on every seed, so never hand-maintain it.
- Source is Box Office Mojo `chart/top_lifetime_gross/?area=XWW` (200 rows; rank/title/gross/year parse straight out of the HTML, and the host is reachable from a dev machine). Its title spellings differ from the array's on some entries (`Star Wars: Episode VII - …` vs `Star Wars: The Force Awakens`, `Jurassic World: Dominion` vs `Jurassic World Dominion`) — alias-map them when diffing, never "fix" the stored spelling.
- New rows should carry a hand-verified `doubanId`, so `covers` takes the rexxar detail directly instead of the 4-pass Douban search, which misfires on generic titles (《奥德赛》/《迈克尔》). Douban 302s non-cloud IPs, so when preparing a list locally the 中文名 + id have to come from web search.
- **Data-only updates need no app release** — the list page reads `boxoffice_movies` at runtime (`getMoviesData`, theme `boxoffice`); `utils/dataLoader.js`'s 24h client cache is the only lag. Releases are only for `pages/boxoffice/` or `utils/boxofficePosterDrawer.js` changes.

### Scenic 5A Theme (`pages/scenic`, 全国5A旅游景区)
First **travel** theme — not a Douban-matched movie/book list, so it has its own dedicated pipeline (not the generic movie/book one), but reuses the `Marks` collection, `batchUpdateMarks`, `dataLoader.processMarks`, `canvasHelper`, and `rewardedSaveGate`.
- **Data source:** Baidu Baike starmap `collectinfo` paginated API (国家AAAAA级旅游景区 词条聚合, lemmaId 3575094), 359 spots. Fields extracted: `lemmaTitle`→name, `desc`("所处位置：浙江")→province, `lemmaDesc`("浙江省舟山市的…")→city (parsed, ~354/359 hit; province fallback), `coverPic`→cover.
- `cloudfunctions/fetchScenic5A` — scrapes 8 pages, parses name/province/city, mirrors covers to cloud storage under `scenic5a_covers/` (forces `f_jpg` to avoid iOS webp blank), upserts `scenic_5a` (`_id=scenic5a_<lemmaId>`, `rank`/`name`/`shortName`/`province`/`city`/`location`/`cover`/`originalCover`). Resumable via `startFrom`/`autoContinue` (same pattern as `enrichThemeMovies`); accepts optional `spotList` seed if server-side scraping is ever blocked.
- **简称 `shortName`:** source names are verbose (city prefix + 旅游风景区/景区/风景名胜区… suffix). `utils/scenicShortName.js` (`scenicShortName(name)`) extracts a concise 简称 via rule algorithm (drop parenthetical → drop 行政区 prefix → take first segment before `－·、/` → iteratively strip common suffixes) + a ~50-entry `OVERRIDES` table for names the algorithm mangles. The **same logic is inlined** into `fetchScenic5A` (writes `shortName` on seed) and the list computes `m.shortName || scenicShortName(m.name)` as a fallback, so the list shows 简称 even before a re-seed persists the field. List title = 简称; full `name` retained on the record.
- `cloudfunctions/getScenicSpots` — read-side, `scenic_5a` by `rank` + `Marks`, response shaped like `getThemeMovies` (`{success, movies, marks, listVersion:null}`).
- `utils/dataLoader.js` `GENERIC_SCENIC_THEMES` Set routes theme `scenic5a` → `getScenicSpots`; frontend reuses `loadMoviesData`+`processMarks`.
- **Marking:** 去过/想去 — stored in `Marks` as `watched`/`wish` (same as movies, relabeled in UI). scenic `_id`s are theme-prefixed so they coexist in `Marks` with movie marks.
- Frontend: `pages/scenic/list` (tabs 全部/去过/想去/未去 + **省份筛选条** + 批量标记, 山水青绿配色) and `pages/scenic/share` (海报预览页, canvas-as-preview, footer 署名 "标记吧 · 全国5A旅游景区", no QR/link). **海报预览页框架/配色完全对齐豆瓣电影海报页**（`pages/genericList/share`）：中性米白页底 `#FFFCF5`、顶部圆形返回钮+「海报预览」、`.bg-panel` 面板承载**版式切换**(足迹地图/景区清单，`style-chip`)与**配色选择**(`theme-chip`+渐变色点)、底部固定 `save-btn-container`(rewardedSaveGate)。预览近满内容宽(`previewW=screenW*(1-48/750)`)以减少留白。**配色 `BG_THEMES` = 电影 TOP250 的 3 套背景渐变**(粉蓝 `#FDECEC→#D2F1FE`/暖金 `#FEEFBF→#F8F3E7`/青雾 `#E1E6D1→#EAF0F9`，本地记住 `scenicShareTheme`)；文字/元素颜色固定用 `PALETTE`(标题 `#2D2D2B`、去过 `#6F8244` 加粗、未去 `#A7A498`、点 `#9AAB65`/`#D2CEC3`、白色半透明胶囊)，切换只换背景渐变。紧凑头部(标题+3 白胶囊统计)、紧凑页脚(发丝线+图例+署名一行)。两种版式纯 canvas、零网络图片：①**足迹地图** `drawTiles`——31 省瓦片点阵(瓦片=白色半透明)；②**景区清单** `drawListPoster`——**紧凑分区式**：每省另起一行、行首白色半透明圆角省名胶囊，其后流排该省全部 5A 简称(**每省去过排最前**、去过=橄榄绿加粗、未去=灰)，双列+行中线基线+字号自适应(24→16 取首个放下，359 条实测落在 20px)。
- Category integration: new `travel` category + 旅行 filter tab; dynamic card cover = `scenic_5a` rank=1 spot's cover.

### Museum Theme (`pages/museum`, 中国国家一级博物馆)
Second **travel**-category theme; a near-verbatim clone of the Scenic 5A pipeline (own dedicated cloud fns + collection + page set), reusing `Marks`/`batchUpdateMarks`/`dataLoader.processMarks`/`canvasHelper`/`rewardedSaveGate`. 327 museums as of this writing.
- **Data source:** same Baidu Baike **starmap `collectinfo`** API as scenic, but the museum 词条 (lemmaId 1372604) is **grouped into 31 province sub-collects** — unlike scenic's single flat relId. The province container node returns anti-scrape junk without a client token, but **each province's `collectinfo` reads fine server-side (no token)**, so the 31 province `encodeRelId`s (persistent collect ids, harvested once via the baike front-end token API) are **hardcoded** in `fetchMuseums`'s `PROVINCE_RELS` table. Fields per item: `lemmaTitle`→name, `desc`("批次：第一批")→**批次 batch**, `lemmaDesc`→city (parsed), `coverPic`→cover, `lemmaId`→`_id`.
- `cloudfunctions/fetchMuseums` — loops the 31 province relIds (`collectinfo`, paginated), parses name/batch/city/cover, mirrors covers to `museum_covers/` (forces `f_jpg`), upserts `museum_grade1` (`_id=museum_<lemmaId>`, `theme:'museum'`, `rank`/`name`/`shortName`/`province`(short)/`provinceFull`/`city`/`location`/`batch`/`cover`/`originalCover`/`summary`). Resumable via `startFrom`/`autoContinue` (flat index; same pattern as `fetchScenic5A`); accepts optional `museumList` seed. `MIN_ACCEPT=300`.
- **City parsing:** `parseCity` tries `lemmaDesc` (省+市 prefix) then falls back to the **museum name** (`^X市/县/自治州`), ~75% non-municipal hit; 直辖市 show province only; misses fall back to province display. **简称 `shortName`:** museum names are already concise, so `utils/museumShortName.js` only strips a trailing parenthetical (并列馆名/别称) + a tiny OVERRIDES table (故宫/兵马俑/…); inlined into `fetchMuseums` too.
- `cloudfunctions/getMuseums` — read-side, `museum_grade1` by `rank` + `Marks`, response shaped like `getScenicSpots` (`{success, movies, marks, listVersion:null}`).
- `utils/dataLoader.js` `GENERIC_MUSEUM_THEMES` Set routes theme `museum` → `getMuseums`; frontend reuses `loadMoviesData`+`processMarks`.
- **Marking:** 参观过/想去 — stored in `Marks` as `watched`/`wish` (relabeled in UI), theme-prefixed `_id`s coexist with other marks.
- Frontend: `pages/museum/list` (tabs 全部/参观过/想去/未去 + 省份筛选条 + 批量标记, 青铜金褐 `#8C6239`/`#B98E56` 配色, list badge = 批次) and `pages/museum/share` (海报预览页 — **structurally identical to scenic share**, canvas 1242×1660, 版式 足迹地图/博物馆清单, same `BG_THEMES`/`PALETTE`, storage key `museumShareTheme`, canvas id `#museumCard`, signature "搜索标记吧小程序 · 制作同款图", no QR/link).
- Category integration: `travel` category, tag 旅行; dynamic card cover = `museum_grade1` rank=1 museum's cover (placeholder 🏛️ / `.museum` tint `#8C6239`).

### Movie Rating Search (`pages/movie-search`)
Standalone feature, **not** part of the Top-N tracking pattern. Three pages: `input/` (search box + history cards), `list/`, `detail/`.
- `cloudfunctions/searchMovieByTitle` — calls Douban `j/subject_suggest`, filters `type=movie`, returns lightweight candidates (director parsed from `sub_title` 4th segment, often empty)
- `cloudfunctions/fetchMovieFullInfo` — the heavy enrichment endpoint: same-CN-day cache → scrape Douban mobile detail (`m.douban.com` + iPhone UA, desktop is too aggressively anti-scraped) for rating/votes/IMDb ID/poster → OMDb API (needs `OMDB_API_KEY` env var) for IMDb score + RT Tomatometer → scrape Rotten Tomatoes HTML for **dual** critic (Tomatometer) + audience (Popcornmeter) scores, falling back to OMDb's single Tomatometer. **Rate-limited to one query per movie per CN calendar day** (protects the 1000/day OMDb quota); `forceRefresh` is itself 24h-throttled. Upserts `searched_movies` (cross-user shared master) + `user_movie_queries` (per-user history)
- `cloudfunctions/getMyMovieQueries` / `deleteMovieQuery` — per-user history list / single-entry removal (only touches `user_movie_queries`, never the shared `searched_movies`)
- `utils/movieFormat.js` — `decorateMovie()`, `cnDateStr()`, vote/RT-count formatting (thousands separators)
- `rottenTomatoes` field shape: `{ critic: {score,state}|null, audience: {score,state}|null, score: <mirrors critic.score, legacy>|null, fetchedAt }`

### Child Growth Theme
- `pages/growth/input/` — gender toggle, year+month picker, weight/height/headCirc inputs
- `pages/growth/result/` — percentile bars, nutrition summary, inline poster generation (no separate share page)
- `utils/growthData.js` — all 12 SD tables from Appendix B of WS/T 423-2022 (B.1–B.12), keyed by month (0–81) or cm (45–130)
- `utils/growthCalculator.js` — Z-score interpolation between SD values, standard normal CDF (Abramowitz & Stegun 26.2.17), `evaluate()` returns percentiles + nutrition assessment
- `utils/growthPosterDrawer.js` — 1242×1660 canvas poster, gender-themed colors (blue for male, pink for female)

**Data flow:** input page → `app.globalData.growthInput` → result page calls `evaluate()` locally (no cloud)

### Daily Check-In Theme
Theme-driven via config. The **`water`** theme follows the original "single page set, config-only" promise; the **`movie`** / **`read`** / **`sport`** themes need richer per-entry data so each has its own page set. All share `syncDailyLog` + the `DailyLogs`/`DailySettings` collections.

**Shared `water`-style page set:**
- `pages/daily/index/` — main page (date nav, water bottle SVG with 4-stage face per progress, 3 quick presets, settings drawer)
- `pages/daily/stats/` — day/week/month with prev/next period nav (Mon-start week + Mon-start month calendar)

**`movie` theme — `pages/daily/movie/`** (its own set; does NOT reuse `pages/daily/index`):
- `index.js` (month calendar) + `add.js` (logs a watched movie with rich `meta`) + `year.js` + `stats.js`
- `common.js` — movie-theme-local helpers: nav metrics, CN-timezone date math, `normalizeMovieEntry` / `flattenMovies`, `getMovieThemeView`
- Entries carry a rich `meta`: `{ doubanId, title, year, poster, director, rating, mood, platform: {douban, imdb, rtCritic, rtAudience}, note }`. `daily_goal` is reused as "每月目标部数". `addEntry` writes a platform-rating snapshot into `meta.platform`.

**`read` theme — `pages/daily/read/`** (same shape as `movie`, douban-book search driven): `index/add/stats/year` + `common.js` (`normalizeBookEntry`/`flattenBooks`). `meta` carries book fields + 5-star rating + mood; `daily_goal` reused as "每月目标本数".

**`sport` theme — `pages/daily/sport/`** (每日运动, its own set, **清新浅色蓝/橙 UI**): `index.js` (month calendar, calendar/timeline views — **no poster wall**, cells show 动作图标)。**所有运动图标走自定义线性图标 `utils/sportIcons.js`（非 emoji）**：每个图标用 24 网格折线/圆几何描述，`svgUri/uriForType(name)` 出 SVG data-URI 给 WXML 用 `background-image` 渲染、`drawIcon(ctx,...)` 在海报 canvas 上描线；`keyForType(动作名)` 按器械/动作归类映射（同类共用一图标，TYPE_ICON 加行即可扩展）。`add.js` + `stats.js` + `year.js` + `common.js` (`normalizeSportEntry`/`flattenSports`/`getSportThemeView`, `buildSummary`). Unlike movie/read, `add` is **manual entry, not search** — it consumes `utils/fitnessTypes.js`：大类 有氧/力量/拉伸·柔韧，每个大类带 `groups`（`{part, types}`），**力量按身体部位分组**(胸/背/腿/肩/手臂/臀/核心，40+ 项)，`getFieldConfig(type)` 决定动态字段。**No rating/mood** — only objective data. `meta`: `{ category, type, icon, duration, distance, distanceUnit, sets, reps, weight }`. Counting is by 次: each entry `value=1`, `daily_goal` reused as "每月目标训练次数". **`add` 支持「一次添加多组动作」**(pendingList)，也支持**编辑态**(`?date=&ts=` 进入，回填后走 `updateEntry`，编辑态隐藏多组/锁定日期)。**`index` 选中日列表支持：拖拽手柄 `☰` 上下排序(`reorderEntries` 持久化、`entries` 数组序即展示序)、左滑露出「编辑 / 删除」**。(`stats.js`/`year.js` 仍是旧米白、无 UI 入口。)
  - **`share.js` — 分享运动卡片(小红书发图)**: from `index` selected-day「分享卡片」button → `share?date=`. Fetches that day via `getRange`, draws a **1080×1440 (3:4)** card with `utils/sportPosterDrawer.js` (self-contained, **纯 ctx 线条绘制 + `utils/sportIcons.js` 线性图标，no network image / no CanvasHelper**; 清新浅色信息图风格 —— 浅色渐变底+角落点阵/淡圆装饰、标题+蓝色下划线、扁平**编号清单**：编号徽章+柔彩圆内线性图标+名称+竖向点线分隔+数据小图标，时长/距离用主色、组次/重量用点缀色). **主题色可选**：`sportPosterDrawer.js` 内置 `THEMES` 4 套预设（经典蓝/薄荷绿/樱花粉/暖橙），`draw(dayData, illus, themeId)` 第三参选主题，装饰/图标色全部由 `primary`+`accent`(+`primaryRgb/accentRgb` 派生半透明) 推导；`SportPosterDrawer.THEMES`(色卡列表)/`.DEFAULT_THEME` 暴露给前端。share 页底部色卡条选色、**本地记住**(`wx.storage` key `sportShareTheme`)，切换即 `generatePoster` 重绘。**canvas 是原生组件无法用 opacity 隐藏**，所以直接把 canvas 当屏幕预览图（backing 1080×1440、CSS 缩放显示），不再用 `<image>` 预览；导出 temp file 仅供「保存到相册」。出图时机：`onReady` 置 `_ready` + 数据就绪后 `maybeGenerate` 一次，`onUnload` 置 `_destroyed` 守卫异步 setData。Save 由 `utils/rewardedSaveGate.js`（slot `save_image_rewarded`）把关。底部文字署名「标记吧 · 每日运动」(no QR/小程序码/外链, per promo-compliance)。详见 [[reference-canvas-native-component-hiding]]。

**Shared utilities / endpoint:**
- `utils/dailyThemes.js` — **single source of truth**: `THEMES` registry (`water`, `movie`, `read`, `sport`), `DESIGN_TOKENS`, `ACCENT_HEX`, `cheerFor*` text generators. `getTheme(id)` falls back to `water`.
- `utils/dailyBottle.js` — (water only) `buildBottleSvg(pct, capColor)` 4-stage face (sleepy/calm/happy/satisfied); `buildCupSvg(fillPct)`; `PRESET_FILL_LEVELS = [0.25, 0.55, 0.9]`
- `utils/dailyToast.js` — top-positioned custom toast (`wx.showToast` can't be repositioned); `toast.show(this, '已保存', { icon: 'success' })`
- Cloud function `syncDailyLog` — single endpoint, `theme` param dispatches; collections `DailyLogs` (`openid+theme+date` unique) and `DailySettings` (`openid+theme` unique). Actions: `getToday | addEntry | removeEntry | updateEntry | reorderEntries | setGoal | setPresets | getRange | getYear`. `addEntry` accepts arbitrary `date` (backfill) and uses an **atomic append** path with unique-index-conflict retry to avoid concurrent lost-updates. `updateEntry`(改 `meta`/`value`，按 `ts` 定位) 和 `reorderEntries`(`order` = `ts` 数组，重排 `entries`) 走读-改-写。**`entries` 数组顺序即展示顺序**（前端不再按 `ts` 排序），所以拖拽排序靠 `reorderEntries` 持久化。

> 海报分享功能已下线，待后续重写。

**Adding a new simple (water-style) daily theme** (e.g. milktea):
1. Add a key to `THEMES` in `utils/dailyThemes.js` per the `ThemeConfig` jsdoc.
2. Add a card in `pages/category/category.js` themes array, URL `/pages/daily/index/index?theme=<id>`.
3. Optionally add a fallback row in `THEME_DEFAULTS` of `cloudfunctions/syncDailyLog/index.js`.
No new pages, no new cloud functions, no new collections. (A richer theme like `movie` instead gets its own page set under `pages/daily/<theme>/`.)

### Subscription & Push
WeChat subscribe-message framework — adding a new push topic is a config-row edit, no new cloud function or timer needed.
- `utils/subscribeConfig.js` — front-end template-ID registry (`TEMPLATES`); empty ID disables the subscribe button with a "功能即将开放" toast.
- `cloudfunctions/subscribeMessage` — records a user's authorization, incrementing per-`(openid, topic)` push quota.
- `cloudfunctions/pushSubscribeMessages` — timer-triggered (~09:30 Beijing); scans unpushed `push_events`, dispatches by `topic` via the `TOPIC_CONFIG` render table. Hard-guarded to only send 09:00–22:00 Beijing time. Template IDs come from per-topic **env vars** (e.g. `TOP250_NEW_ENTRY_TPL_ID`), so swapping a template doesn't reset quota. Add a topic = add a row in `TOPIC_CONFIG` + its env var.

### Key Shared Utilities
- `utils/dataLoader.js` — cache-first data loading, mark processing, cache invalidation
- `utils/imageCacheManager.js` — URL thumbnail transforms (Douban/IMDb/cloud), session-level image cache, prefetch-to-local
- `utils/canvasHelper.js` — image loading with retry (3 attempts), avatar drawing, gradient borders
- `utils/adConfig.js` + `utils/adManager.js` — ad-unit lookup keyed by slot name (e.g. `share_banner`, `save_image_rewarded`); slot-level error isolation
- `utils/rewardedAdManager.js` + `utils/rewardedSaveGate.js` — rewarded-video gate before saving posters; if no ad unit configured for a slot, gate auto-passes
- `utils/grayBucket.js` — gray-release bucketing (per-openid hash → bucket), used to roll out features incrementally

## Cloud Environment

- Cloud env ID: `cloud1-3gn3wryx716919c6`
- AppID: `wx52ad9bb6303e6af1`
- Cloud functions root: `cloudfunctions/`
- Min library version: 3.0.0

### Cloud Functions Roster
- `getMoviesData` — read-side aggregator across movie/book collections; supports `marksOnly` flag for lightweight mark refresh
- `batchUpdateMarks` / `batchUpdateBookMarks` — atomic upsert of multiple `(itemId, openid)` marks
- **Generic theme pipelines** (see Generic Theme Pipelines above): `enrichThemeMovies`/`getThemeMovies`/`checkDoubanTitles`/`checkThemeRankGaps` (movies, `generic_theme_movies`) and `enrichThemeBooks`/`getThemeBooks` (books, `generic_theme_books`)
- **Scenic (travel) theme** (see Scenic 5A Theme below): `fetchScenic5A` (scrape Baidu Baike starmap → `scenic_5a`) / `getScenicSpots` (read-side)
- **Museum (travel) theme** (see Museum Theme below): `fetchMuseums` (scrape Baidu Baike starmap, 31 province sub-collects → `museum_grade1`) / `getMuseums` (read-side)
- `syncDailyLog` — single endpoint for daily check-in (see Daily Check-In Theme above)
- `fetchMovies` — timer-triggered Douban TOP250 daily auto-refresh into `movies` (drift detection, soft-delete rollback, `MIN_ACCEPT_COUNT` guard, emits `push_events`/`rank_history`)
- `fetchImdbMovies` / `fetchOscarMovies` / `fetchOscarAnimeMovies` / `fetchDoubanBooks` / `fetchWereadBooks` / `fetchBoxofficeMovies` / `fetchAnnualMovies` / `fetchChineseMovies` / `fetchAwardMovies` — data scraping/enrichment per theme. `fetchBoxofficeMovies` is hardcoded-list + manual `seed`/`covers`, not a scrape (see Boxoffice Theme above). `fetchOscarAnimeMovies` mirrors `fetchOscarMovies` (rank=届数, year=film release year, built-in 中文名+英文原名, douban only for cover/rating) → `oscar_anime_movies`; 最佳动画长篇 starts at 第74届(2001).
- **Movie search:** `searchMovieByTitle` (Douban suggest) / `fetchMovieFullInfo` (豆瓣+OMDb+RT enrichment, daily rate-limited) / `getMyMovieQueries` / `deleteMovieQuery`
- **Push:** `subscribeMessage` (record authorization + quota) / `pushSubscribeMessages` (timer dispatch by topic)
- `submitThemeRequest` — category-page 片单/书单需求收集: validates + rate-limits (5/user/day, CN calendar day) and writes `{openid, type: movie|book|other, content, status: 'pending'}` into `theme_requests` (auto-creates the collection); requests reviewed manually in console
- `analyzeMarks` / `analyzeRetention` / `inspectData` — analytics & ops; `migrateCovers` / `migrateData` / `importMovies` — one-shot data migration; `initAdConfig` — seed ad-unit config; `getOpenid` — auth helper

> Note: there is no `fetchDoubanMovies` — Douban movie scraping lives in **`fetchMovies`** (the timer-refresh function).

## Development

This project uses **WeChat Developer Tools** (微信开发者工具) for building, previewing, and deploying. There are no npm scripts at the project root.

**Cloud function deployment:** Right-click function folder in WeChat Developer Tools → upload and deploy. Install dependencies per-function: `cd cloudfunctions/<function-name> && npm install`.

**Data scraping:** `douban_spyder/` contains Python scripts for fetching Douban Top 250 data; one-shot scripts at root (`parseGrowthData.js`, `view_excel.py`, `test_imdb.js`) and the `data-raw/` folder are dev-time only.

### Pack Excludes (`project.config.json` → `packOptions.ignore`)
Several themes/files live in source but are **excluded from the production bundle**. When working on them, remember they won't appear in the mini program until removed from the ignore list:
- Pages: `pages/chinese`, `pages/annual`, `pages/chinese-awards`, `pages/growth/share`
- Utils (only consumed by excluded pages): `utils/doubanPosterDrawer.js`, `utils/imdbPosterDrawer.js`, `utils/annualLoader.js`, `utils/annualPosterDrawer.js`, `utils/chineseLoader.js`, `utils/chinesePosterDrawer.js`
- Folders: `data-raw/`, `tools/`, `.claude/`, `.obsidian/`, `doc/`, `docs/`, `douban_spyder/`
- Root scratch / docs: `小程序首页码.png`, `Water Tracker _standalone_ (1).html`, `coupon_creation.html`, `view_excel.py`, `test_imdb.js`, `CLAUDE.md`

## Key Patterns

- **Mark statuses:** `'watched'` or `'wish'`, stored in `Marks` collection keyed by `(movieId, openid)`
- **Batch operations:** `batchUpdateMarks` cloud function atomically upserts multiple marks
- **Image optimization:** List views use thumbnail URLs via `imageCacheManager.getThumbnailUrl()`; poster walls use full-size originals
- **Cloud DB batch reads:** `MAX_LIMIT=100` with looped queries to bypass the 20-record default limit
- **getMoviesData:** supports `marksOnly` flag for lightweight mark refresh
- **Canvas posters:** Always use Canvas 2D (`type="2d"`), obtain node via `wx.createSelectorQuery().select('#id').fields({node:true})`, set `canvas.width/height` before drawing, use `wx.canvasToTempFilePath({canvas})` to export
- **Gender theming (growth):** Result page applies `.theme-female` class on container; poster drawer accepts gender from `input.gender` and uses blue/pink theme objects accordingly
- **Percentile display:** Show as `XX%` with label "超过XX%的同龄儿童" — do not use "P" prefix or "百分位" phrasing
- **Nutrition evaluation levels:** 7 levels per indicator using Z-score thresholds: ±3SD (重度), ±2SD (偏), ±1SD (略偏), within ±1SD (正常). Yellow `.mild` class for 略偏, red `.warning` for 偏/重度
- **Daily theme — week/month math:** Mon-start everywhere. `dayOfWeekMon = (getUTCDay() + 6) % 7`. Stats and share haven't unified — stats fetches per-period on demand (week=Mon~Sun, month=1st~last), share uses a 30-day rolling window for day/week and a separate on-demand natural-month fetch (`_ensureMonthData()`) for the month poster's calendar layout
- **Daily theme — top toast:** never use `wx.showToast` in `pages/daily/*` — it can't be repositioned. Use `require('../../../utils/dailyToast.js').show(this, '...', { icon: 'success' })`; pages must include the `<view class="top-toast ...">` node and `data.toast` field
- **Ad strategy preference (per `MEMORY.md`):** category page rejects interstitial ads; favor improving existing slots over adding new ones

## Growth Assessment — Evaluation Ranges

| 百分位区间 | 体重 | 身高 | 体型(BMI) |
|---|---|---|---|
| < 0.1% | 重度偏轻 | 重度偏矮 | 重度消瘦 |
| 0.1–2.3% | 偏轻 | 偏矮 | 消瘦 |
| 2.3–15.9% | 略偏轻 | 略偏矮 | 偏瘦 |
| 15.9–84.1% | 正常 | 正常 | 正常 |
| 84.1–97.7% | 略偏重 | 略偏高 | 超重 |
| 97.7–99.9% | 偏重 | 偏高 | 肥胖 |
| > 99.9% | 明显偏重 | 明显偏高 | 重度肥胖 |
