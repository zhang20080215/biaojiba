// cloudfunctions/analyzeRetention/index.js
// 只读统计：基于 Marks + BookMarks 集合输出留存/活跃聚合指标
// 不导出任何 openid 原文，仅返回桶级别聚合
//
// 调用方式（云开发控制台 → 云函数 → analyzeRetention → 测试 → 触发）：
//   { }                  // 默认统计全量数据，附 90 天窗口
//   { days: 30 }         // 自定义窗口

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const $ = db.command.aggregate;

const BATCH = 500;            // 调小批次，降低单次聚合时长
const MAX_RETRY = 3;          // 网络/超时错误重试
const RETRY_DELAY_MS = 1500;

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function withRetry(label, fn) {
    let lastErr;
    for (let i = 0; i < MAX_RETRY; i++) {
        try {
            return await fn();
        } catch (err) {
            lastErr = err;
            console.warn(`[${label}] 第 ${i + 1} 次失败：${err.message}`);
            if (i < MAX_RETRY - 1) await sleep(RETRY_DELAY_MS * (i + 1));
        }
    }
    throw new Error(`${label} 重试 ${MAX_RETRY} 次仍失败：${lastErr && lastErr.message}`);
}

async function pagedAggregate(label, buildChain) {
    let all = [];
    let skip = 0;
    while (true) {
        const res = await withRetry(`${label}@skip=${skip}`, () => buildChain(skip, BATCH).end());
        all = all.concat(res.list);
        if (res.list.length < BATCH) break;
        skip += BATCH;
    }
    return all;
}

function pct(sortedArr, p) {
    if (!sortedArr.length) return null;
    const idx = Math.min(sortedArr.length - 1, Math.floor(sortedArr.length * p));
    return sortedArr[idx];
}

exports.main = async (event) => {
    const t0 = Date.now();
    const timings = {};
    const step = async (name, fn) => {
        const t = Date.now();
        const res = await fn();
        timings[name] = Date.now() - t;
        console.log(`[${name}] ${timings[name]}ms`);
        return res;
    };
    try {
        const NOW = new Date();
        const windowDays = event.days || 90;
        const action = event.action || 'all';   // 'all' | 'days' | 'users' | 'themes'
        const D_window = new Date(NOW.getTime() - windowDays * 86400000).toISOString();
        const D7 = new Date(NOW.getTime() - 7 * 86400000).toISOString();
        const D30 = new Date(NOW.getTime() - 30 * 86400000).toISOString();

        // ===== 0. 先看下两个集合的数据量，方便诊断 =====
        const movieCount = await step('count_marks', () =>
            withRetry('count_marks', () => db.collection('Marks').count()));
        const bookCount = await step('count_bookmarks', () =>
            withRetry('count_bookmarks', () => db.collection('BookMarks').count()));
        console.log(`Marks=${movieCount.total}, BookMarks=${bookCount.total}`);

        // 如果只想看体量，提前返回
        if (action === 'count') {
            return {
                success: true,
                action: 'count',
                marks_count: movieCount.total,
                bookmarks_count: bookCount.total,
                timings,
                total_ms: Date.now() - t0
            };
        }

        // ===== 1. marks_by_day（窗口内每日标记数，电影/书籍分开）=====
        const movieDays = action === 'users' || action === 'themes' ? [] : await step('movie_days', () =>
            pagedAggregate('movie_days', (skip, limit) =>
                db.collection('Marks').aggregate()
                    .match({ marked_at: _.gte(D_window) })
                    .project({ day: $.substr(['$marked_at', 0, 10]) })
                    .group({ _id: '$day', count: $.sum(1) })
                    .sort({ _id: 1 })
                    .skip(skip).limit(limit)
            )
        );
        const bookDays = action === 'users' || action === 'themes' ? [] : await step('book_days', () =>
            pagedAggregate('book_days', (skip, limit) =>
                db.collection('BookMarks').aggregate()
                    .match({ marked_at: _.gte(D_window) })
                    .project({ day: $.substr(['$marked_at', 0, 10]) })
                    .group({ _id: '$day', count: $.sum(1) })
                    .sort({ _id: 1 })
                    .skip(skip).limit(limit)
            )
        );
        const dayMap = {};
        movieDays.forEach(r => {
            dayMap[r._id] = dayMap[r._id] || { day: r._id, movies: 0, books: 0 };
            dayMap[r._id].movies = r.count;
        });
        bookDays.forEach(r => {
            dayMap[r._id] = dayMap[r._id] || { day: r._id, movies: 0, books: 0 };
            dayMap[r._id].books = r.count;
        });
        const marks_by_day = Object.values(dayMap)
            .map(r => ({ ...r, total: r.movies + r.books }))
            .sort((a, b) => a.day.localeCompare(b.day));

        // 如果只想要每日数据，提前返回
        if (action === 'days') {
            const dayMap0 = {};
            movieDays.forEach(r => {
                dayMap0[r._id] = dayMap0[r._id] || { day: r._id, movies: 0, books: 0 };
                dayMap0[r._id].movies = r.count;
            });
            bookDays.forEach(r => {
                dayMap0[r._id] = dayMap0[r._id] || { day: r._id, movies: 0, books: 0 };
                dayMap0[r._id].books = r.count;
            });
            return {
                success: true,
                action: 'days',
                marks_by_day: Object.values(dayMap0)
                    .map(r => ({ ...r, total: r.movies + r.books }))
                    .sort((a, b) => a.day.localeCompare(b.day)),
                marks_count: movieCount.total,
                bookmarks_count: bookCount.total,
                timings,
                total_ms: Date.now() - t0
            };
        }

        // ===== 2/3. 用户级聚合（全量，含首末标记时间 + 计数）=====
        const movieUsers = action === 'days' ? [] : await step('movie_users', () =>
            pagedAggregate('movie_users', (skip, limit) =>
                db.collection('Marks').aggregate()
                    .group({
                        _id: '$openid',
                        firstMark: $.min('$marked_at'),
                        lastMark: $.max('$marked_at'),
                        count: $.sum(1)
                    })
                    .skip(skip).limit(limit)
            )
        );
        const bookUsers = action === 'days' ? [] : await step('book_users', () =>
            pagedAggregate('book_users', (skip, limit) =>
                db.collection('BookMarks').aggregate()
                    .group({
                        _id: '$openid',
                        firstMark: $.min('$marked_at'),
                        lastMark: $.max('$marked_at'),
                        count: $.sum(1)
                    })
                    .skip(skip).limit(limit)
            )
        );

        const userMap = {};
        movieUsers.forEach(u => {
            userMap[u._id] = {
                firstMark: u.firstMark || null,
                lastMark: u.lastMark || null,
                movieCount: u.count,
                bookCount: 0
            };
        });
        bookUsers.forEach(u => {
            if (userMap[u._id]) {
                userMap[u._id].bookCount = u.count;
                if (u.firstMark && (!userMap[u._id].firstMark || u.firstMark < userMap[u._id].firstMark))
                    userMap[u._id].firstMark = u.firstMark;
                if (u.lastMark && (!userMap[u._id].lastMark || u.lastMark > userMap[u._id].lastMark))
                    userMap[u._id].lastMark = u.lastMark;
            } else {
                userMap[u._id] = {
                    firstMark: u.firstMark || null,
                    lastMark: u.lastMark || null,
                    movieCount: 0,
                    bookCount: u.count
                };
            }
        });

        const users = Object.values(userMap).map(u => {
            const total = u.movieCount + u.bookCount;
            let span = 1;
            if (u.firstMark && u.lastMark) {
                const ms = new Date(u.lastMark).getTime() - new Date(u.firstMark).getTime();
                span = Math.max(1, Math.ceil(ms / 86400000) + 1);
            }
            return { ...u, totalCount: total, activeSpanDays: span };
        });

        // 活跃跨度分布
        const spanBuckets = [
            { label: '1日（一次性）', min: 1, max: 1 },
            { label: '2-7日', min: 2, max: 7 },
            { label: '8-30日', min: 8, max: 30 },
            { label: '31-89日', min: 31, max: 89 },
            { label: '90日+（长期回访）', min: 90, max: Infinity }
        ].map(b => ({ ...b, count: 0 }));
        users.forEach(u => {
            for (const b of spanBuckets) {
                if (u.activeSpanDays >= b.min && u.activeSpanDays <= b.max) { b.count++; break; }
            }
        });
        const totalUsers = users.length;
        const user_active_span = spanBuckets.map(b => ({
            range: b.label,
            users: b.count,
            percent: totalUsers ? (b.count / totalUsers * 100).toFixed(1) + '%' : '0%'
        }));

        // 平均相邻标记间隔（基于活跃跨度/标记数 - 1）
        const multi = users.filter(u => u.totalCount >= 2 && u.firstMark && u.lastMark);
        const intervals = multi.map(u =>
            (new Date(u.lastMark).getTime() - new Date(u.firstMark).getTime()) / 86400000 / (u.totalCount - 1)
        ).sort((a, b) => a - b);
        const mark_interval_days = {
            users_with_multi_marks: multi.length,
            median: pct(intervals, 0.5)?.toFixed(2) ?? null,
            p25: pct(intervals, 0.25)?.toFixed(2) ?? null,
            p75: pct(intervals, 0.75)?.toFixed(2) ?? null,
            p90: pct(intervals, 0.9)?.toFixed(2) ?? null
        };

        // ===== 4. theme_distribution（书籍按 source 分；电影合计）=====
        const bookBySource = await step('book_by_source', () =>
            withRetry('book_by_source', () =>
                db.collection('BookMarks').aggregate()
                    .group({ _id: '$source', count: $.sum(1) })
                    .end()
            )
        );
        const movieTotal = users.reduce((s, u) => s + u.movieCount, 0);
        const bookTotal = users.reduce((s, u) => s + u.bookCount, 0);
        const theme_distribution = {
            total_marks: movieTotal + bookTotal,
            movies: {
                total: movieTotal,
                percent: (movieTotal + bookTotal) ? (movieTotal / (movieTotal + bookTotal) * 100).toFixed(1) + '%' : '0%',
                note: '电影 Marks 集合无主题字段，需后续联表 movies/imdb_movies/oscar_movies 拆分'
            },
            books: {
                total: bookTotal,
                percent: (movieTotal + bookTotal) ? (bookTotal / (movieTotal + bookTotal) * 100).toFixed(1) + '%' : '0%',
                by_source: bookBySource.list.map(r => ({
                    source: r._id || '(空)',
                    count: r.count,
                    percent: bookTotal ? (r.count / bookTotal * 100).toFixed(1) + '%' : '0%'
                }))
            }
        };

        // ===== 5. user_bucket_retention（按标记总数分桶 → 各桶近 7/30 日活跃率）=====
        const countBuckets = [
            { label: '1-5（轻度）', min: 1, max: 5 },
            { label: '6-20（中度）', min: 6, max: 20 },
            { label: '21-50（深度）', min: 21, max: 50 },
            { label: '51-100（重度）', min: 51, max: 100 },
            { label: '100+（核心）', min: 101, max: Infinity }
        ].map(b => ({ ...b, total: 0, active7d: 0, active30d: 0 }));
        users.forEach(u => {
            for (const b of countBuckets) {
                if (u.totalCount >= b.min && u.totalCount <= b.max) {
                    b.total++;
                    if (u.lastMark && u.lastMark >= D7) b.active7d++;
                    if (u.lastMark && u.lastMark >= D30) b.active30d++;
                    break;
                }
            }
        });
        const user_bucket_retention = countBuckets.map(b => ({
            bucket: b.label,
            users: b.total,
            pct_of_all: totalUsers ? (b.total / totalUsers * 100).toFixed(1) + '%' : '0%',
            active7d: b.active7d,
            active7d_pct: b.total ? (b.active7d / b.total * 100).toFixed(1) + '%' : '0%',
            active30d: b.active30d,
            active30d_pct: b.total ? (b.active30d / b.total * 100).toFixed(1) + '%' : '0%'
        }));

        // ===== Summary =====
        const summary = {
            snapshot_at: NOW.toISOString(),
            window_days: windowDays,
            window_from: D_window,
            total_users: totalUsers,
            total_marks: movieTotal + bookTotal,
            avg_marks_per_user: totalUsers ? ((movieTotal + bookTotal) / totalUsers).toFixed(1) : '0',
            active_users_7d: users.filter(u => u.lastMark && u.lastMark >= D7).length,
            active_users_30d: users.filter(u => u.lastMark && u.lastMark >= D30).length,
            new_users_in_window: users.filter(u => u.firstMark && u.firstMark >= D_window).length
        };

        return {
            success: true,
            summary,
            marks_by_day,
            user_active_span,
            mark_interval_days,
            theme_distribution,
            user_bucket_retention,
            timings,
            total_ms: Date.now() - t0
        };
    } catch (err) {
        console.error('analyzeRetention 失败:', err);
        return {
            success: false,
            error: err.message,
            stack: err.stack,
            timings,
            total_ms: Date.now() - t0
        };
    }
};
