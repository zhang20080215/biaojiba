# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

XiaoBiaoji (标记吧) is a WeChat Mini Program with two major feature areas:
1. **Movie tracking** — Douban Top 250, IMDb Top 250, Oscar Best Pictures: mark watched/wish, generate shareable poster walls
2. **Child growth assessment** — 0~7岁发育评估 based on WS/T 423-2022 national standard, with precise percentile calculation and shareable report posters

Built on WeChat Cloud (serverless cloud functions + cloud database).

## Architecture

**Frontend:** WeChat Mini Program (WXML/WXSS/JS) with Canvas 2D API for poster generation.

**Backend:** WeChat Cloud Functions (Node.js + `wx-server-sdk`) in `cloudfunctions/`. Each function is independently deployed with its own `package.json`.

**Entry point:** `pages/category/category` — tab-filtered card grid (`全部/电影/育儿`), routes to all themes.

### Movie Theme Pattern
Each movie theme (douban/imdb/oscar) follows:
- `pages/{theme}/list/` — movie list with tab filtering, batch marking, image prefetching
- `pages/{theme}/share/` — canvas poster wall generation
- `utils/{theme}PosterDrawer.js` — grid rendering (12 cols, 1242×1660 canvas, 8-poster batch loading)
- Cloud function `fetch{Theme}Movies` — data scraping/enrichment

**Data flow:** Pages → `utils/dataLoader.js` (24-hour client cache) → `getMoviesData` cloud function → Cloud DB collections (`movies`, `imdb_movies`, `oscar_movies`, `Marks`)

### Child Growth Theme
- `pages/growth/input/` — gender toggle, year+month picker, weight/height/headCirc inputs
- `pages/growth/result/` — percentile bars, nutrition summary, inline poster generation (no separate share page)
- `utils/growthData.js` — all 12 SD tables from Appendix B of WS/T 423-2022 (B.1–B.12), keyed by month (0–81) or cm (45–130)
- `utils/growthCalculator.js` — Z-score interpolation between SD values, standard normal CDF (Abramowitz & Stegun 26.2.17), `evaluate()` returns percentiles + nutrition assessment
- `utils/growthPosterDrawer.js` — 1242×1660 canvas poster, gender-themed colors (blue for male, pink for female)

**Data flow:** input page → `app.globalData.growthInput` → result page calls `evaluate()` locally (no cloud)

### Key Shared Utilities
- `utils/dataLoader.js` — cache-first data loading, mark processing, cache invalidation
- `utils/imageCacheManager.js` — URL thumbnail transforms (Douban/IMDb/cloud), session-level image cache, prefetch-to-local
- `utils/canvasHelper.js` — image loading with retry (3 attempts), avatar drawing, gradient borders

## Cloud Environment

- Cloud env ID: `cloud1-3gn3wryx716919c6`
- AppID: `wx52ad9bb6303e6af1`
- Cloud functions root: `cloudfunctions/`
- Min library version: 3.0.0

## Development

This project uses **WeChat Developer Tools** (微信开发者工具) for building, previewing, and deploying. There are no npm scripts at the project root.

**Cloud function deployment:** Right-click function folder in WeChat Developer Tools → upload and deploy. Install dependencies per-function: `cd cloudfunctions/<function-name> && npm install`.

**Data scraping:** `douban_spyder/` contains Python scripts for fetching Douban Top 250 data.

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
