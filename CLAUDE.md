# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

XiaoBiaoji (标记吧) is a WeChat Mini Program for tracking and sharing movie watch lists across three themes: Douban Top 250, IMDb Top 250, and Oscar Best Pictures. Built on WeChat Cloud (serverless cloud functions + cloud database).

## Architecture

**Frontend:** WeChat Mini Program (WXML/WXSS/JS) with Canvas API for poster wall generation.

**Backend:** WeChat Cloud Functions (Node.js + `wx-server-sdk`) in `cloudfunctions/`. Each function is independently deployed with its own `package.json`.

**Data flow:** Pages → `utils/dataLoader.js` (24-hour client cache) → `getMoviesData` cloud function → Cloud Database collections (`movies`, `imdb_movies`, `oscar_movies`, `Marks`).

**Theme pattern:** Each theme (douban/imdb/oscar) follows the same structure:
- `pages/{theme}/list/` — movie list with tab filtering (all/watched/wish/unwatched), batch marking, image prefetching
- `pages/{theme}/share/` — canvas-based poster wall generation
- `utils/{theme}PosterDrawer.js` — grid rendering (12 cols, 1242×1660 canvas, 8-poster batch loading)
- Cloud function `fetch{Theme}Movies` — data scraping/enrichment

**Key utilities:**
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

**Cloud function deployment:** Each cloud function in `cloudfunctions/` must be deployed individually via WeChat Developer Tools (right-click → upload and deploy). Install dependencies per-function: `cd cloudfunctions/<function-name> && npm install`.

**Data scraping tools:** `douban_spyder/` contains Python scripts for fetching Douban Top 250 data (`fetch_douban_top250.py`) and uploading to cloud storage (`upload_to_cloud.py`).

## Key Patterns

- **Mark statuses** are `'watched'` or `'wish'`. Marks are stored in the `Marks` collection keyed by `(movieId, openid)`.
- **Batch operations** use the `batchUpdateMarks` cloud function to atomically upsert multiple marks.
- **Image optimization:** List views use thumbnail URLs (transformed by `imageCacheManager.getThumbnailUrl()`), poster walls use full-size originals.
- **Cloud DB batch reads** use `MAX_LIMIT=100` with looped queries to bypass the 20-record default limit.
- **getMoviesData** supports a `marksOnly` flag for lightweight mark refresh when movies are already cached client-side.
