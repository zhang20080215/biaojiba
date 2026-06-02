# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

XiaoBiaoji (标记吧) is a WeChat Mini Program with several feature areas:
1. **Movie / book tracking** — Douban Top 250 (movies + books), IMDb Top 250, Oscar Best Pictures, 票房榜 (boxoffice), WeChat Reading Top 200, plus themes kept in source but pack-excluded for now (annual / chinese / chinese-awards). All share the same list+poster pattern, swap data source.
2. **Movie rating search** (`pages/movie-search`, 全平台电影评分查询) — search any movie by title, aggregate 豆瓣 + IMDb + 烂番茄 (Tomatometer critic + Popcornmeter audience) scores. Independent data path (own collections + cloud functions), separate from the Top-N tracking pattern.
3. **Child growth assessment** — 0~7岁发育评估 based on WS/T 423-2022 national standard, with precise percentile calculation and shareable report posters.
4. **Daily check-in** — Theme-driven daily tracker. Two live themes: **每日喝水** (`water`, shared `pages/daily/index` + `pages/daily/stats` page set) and **每日电影** (`movie`, its own richer page set under `pages/daily/movie`). See Daily Check-In Theme.
5. **Subscription push** — WeChat subscribe-message framework for TOP250 new-entry alerts and daily reminders. See Subscription & Push.

Built on WeChat Cloud (serverless cloud functions + cloud database).

## Architecture

**Frontend:** WeChat Mini Program (WXML/WXSS/JS) with Canvas 2D API for poster generation.

**Backend:** WeChat Cloud Functions (Node.js + `wx-server-sdk`) in `cloudfunctions/`. Each function is independently deployed with its own `package.json`.

**Entry point:** `pages/category/category` — tab-filtered card grid (`全部/电影/育儿`), routes to all themes.

### Movie / Book Theme Pattern
Each tracking theme (douban/imdb/oscar/doubanBooks/weread + the pack-excluded ones) follows:
- `pages/{theme}/list/` — list with tab filtering, batch marking, image prefetching
- `pages/{theme}/share/` — canvas poster wall generation
- `utils/{theme}PosterDrawer.js` — grid rendering (12 cols, 1242×1660 canvas, 8-poster batch loading); `weread` uses a text-poster variant
- Cloud function `fetch{Theme}{Movies|Books}` — data scraping/enrichment
- Marks split by collection: movies → `Marks`, books (douban/weread) → `BookMarks`; cloud function `batchUpdateBookMarks` mirrors `batchUpdateMarks`

**Data flow:** Pages → `utils/dataLoader.js` (24-hour client cache) → `getMoviesData` cloud function → Cloud DB collections (`movies`, `imdb_movies`, `oscar_movies`, `douban_books`, `weread_books`, `Marks`, `BookMarks`)

**Douban TOP250 auto-refresh:** `fetchMovies` (timer-triggered; tolerant of the new cloud runtime `Type=Timer` event wrapper) re-scrapes Douban TOP250 daily into `movies`. Guards against scraper failures: writes are rejected if fewer than `MIN_ACCEPT_COUNT` (240) items are scraped. Tracks a version doc + soft-delete rollback doc, detects `_id` drift (same title, different `_id`), and emits `push_events` + `rank_history` entries consumed by the push framework.

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
Theme-driven via config. The **`water`** theme follows the original "single page set, config-only" promise; the **`movie`** theme (每日观影记录) needed richer per-entry data so it has its own page set. Both share `syncDailyLog` + the `DailyLogs`/`DailySettings` collections.

**Shared `water`-style page set:**
- `pages/daily/index/` — main page (date nav, water bottle SVG with 4-stage face per progress, 3 quick presets, settings drawer)
- `pages/daily/stats/` — day/week/month with prev/next period nav (Mon-start week + Mon-start month calendar)

**`movie` theme — `pages/daily/movie/`** (its own set; does NOT reuse `pages/daily/index`):
- `index.js` (month calendar) + `add.js` (logs a watched movie with rich `meta`) + `year.js` + `stats.js`
- `common.js` — movie-theme-local helpers: nav metrics, CN-timezone date math, `normalizeMovieEntry` / `flattenMovies`, `getMovieThemeView`
- Entries carry a rich `meta`: `{ doubanId, title, year, poster, director, rating, mood, platform: {douban, imdb, rtCritic, rtAudience}, note }`. `daily_goal` is reused as "每月目标部数". `addEntry` writes a platform-rating snapshot into `meta.platform`.

**Shared utilities / endpoint:**
- `utils/dailyThemes.js` — **single source of truth**: `THEMES` registry (`water`, `movie`), `DESIGN_TOKENS`, `ACCENT_HEX`, `cheerFor*` text generators. `getTheme(id)` falls back to `water`.
- `utils/dailyBottle.js` — (water only) `buildBottleSvg(pct, capColor)` 4-stage face (sleepy/calm/happy/satisfied); `buildCupSvg(fillPct)`; `PRESET_FILL_LEVELS = [0.25, 0.55, 0.9]`
- `utils/dailyToast.js` — top-positioned custom toast (`wx.showToast` can't be repositioned); `toast.show(this, '已保存', { icon: 'success' })`
- Cloud function `syncDailyLog` — single endpoint, `theme` param dispatches; collections `DailyLogs` (`openid+theme+date` unique) and `DailySettings` (`openid+theme` unique). Actions: `getToday | addEntry | removeEntry | setGoal | setPresets | getRange | getYear`. `addEntry` accepts arbitrary `date` (backfill) and uses an **atomic append** path with unique-index-conflict retry to avoid concurrent lost-updates.

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
- `syncDailyLog` — single endpoint for daily check-in (see Daily Check-In Theme above)
- `fetchMovies` — timer-triggered Douban TOP250 daily auto-refresh into `movies` (drift detection, soft-delete rollback, `MIN_ACCEPT_COUNT` guard, emits `push_events`/`rank_history`)
- `fetchImdbMovies` / `fetchOscarMovies` / `fetchDoubanBooks` / `fetchWereadBooks` / `fetchBoxofficeMovies` / `fetchAnnualMovies` / `fetchChineseMovies` / `fetchAwardMovies` — data scraping/enrichment per theme
- **Movie search:** `searchMovieByTitle` (Douban suggest) / `fetchMovieFullInfo` (豆瓣+OMDb+RT enrichment, daily rate-limited) / `getMyMovieQueries` / `deleteMovieQuery`
- **Push:** `subscribeMessage` (record authorization + quota) / `pushSubscribeMessages` (timer dispatch by topic)
- `analyzeMarks` / `analyzeRetention` / `inspectData` — analytics & ops; `migrateCovers` / `migrateData` / `importMovies` — one-shot data migration; `initAdConfig` — seed ad-unit config; `getOpenid` — auth helper

> Note: there is no `fetchDoubanMovies` — Douban movie scraping lives in **`fetchMovies`** (the timer-refresh function).

## Development

This project uses **WeChat Developer Tools** (微信开发者工具) for building, previewing, and deploying. There are no npm scripts at the project root.

**Cloud function deployment:** Right-click function folder in WeChat Developer Tools → upload and deploy. Install dependencies per-function: `cd cloudfunctions/<function-name> && npm install`.

**Data scraping:** `douban_spyder/` contains Python scripts for fetching Douban Top 250 data; one-shot scripts at root (`parseGrowthData.js`, `view_excel.py`, `test_imdb.js`) and the `data-raw/` folder are dev-time only.

### Pack Excludes (`project.config.json` → `packOptions.ignore`)
Several themes/files live in source but are **excluded from the production bundle**. When working on them, remember they won't appear in the mini program until removed from the ignore list:
- Pages: `pages/chinese`, `pages/annual`, `pages/chinese-awards`, `pages/growth/share`
- Utils (only consumed by excluded pages): `utils/doubanPosterDrawer.js`, `utils/imdbPosterDrawer.js`, `utils/annualLoader.js`, `utils/annualPosterDrawer.js`, `utils/chineseLoader.js`, `utils/chinesePosterDrawer.js`, `utils/fitnessTypes.js`
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
