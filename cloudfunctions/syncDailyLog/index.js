// cloudfunctions/syncDailyLog/index.js
// 每日打卡主题（喝水/奶茶/...）统一读写接口
//
// 集合（所有每日主题共用）：
//   DailyLogs     { _id, openid, theme, date(YYYY-MM-DD), total_value, unit, entries:[{ts, value, meta}], updated_at }
//   DailySettings { _id, openid, theme, daily_goal, presets:[number], updated_at }
//
// 索引建议（云控制台手动建）：
//   DailyLogs:     openid + theme + date 复合索引（唯一）
//   DailySettings: openid + theme 复合索引（唯一）
//
// 入参约定（所有 action 都必填 theme）：
//   action: 'getToday' | 'addEntry' | 'removeEntry' | 'updateEntry' | 'reorderEntries' | 'setGoal' | 'setPresets' | 'getRange' | 'getYear' | 'getAll'
//   theme:  'water' | 'milktea' | ...

const cloud = require('wx-server-sdk');
const axios = require('axios');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

// 封面入库前镜像到云存储，解决「每日电影/读书」封面在 <image> 白屏的问题。
//
// 为什么镜像、为什么文件夹叫 daily_boxoffice_covers：
//   1. 豆瓣图床有防盗链（无 Referer 返回 418），小程序 <image> 无法直接加载豆瓣 URL。
//   2. 线上（已发布）前端 utils/imageCacheManager.js 的 getThumbnailUrl 对 cloud:// 封面，
//      只有路径含 imdb_covers / oscar_covers / boxoffice_covers 时才原样返回；否则会拼上
//      `?imageMogr2/...` query，而 <image> 无法解析「cloud:// 带 query」→ 仍然白屏。
//   ⇒ 为了不发版（小程序审核耗时）就修好，这里把镜像文件夹命名为 daily_boxoffice_covers，
//      其路径含线上白名单子串 "boxoffice_covers"，线上前端便会原样渲染该 fileID。
//      ⚠️ 此命名纯为匹配线上白名单、规避发版，并非票房主题封面。正式发版前端后可回归 daily_covers。
const MIRROR_DIR = 'daily_boxoffice_covers';
// 线上前端 getThumbnailUrl 已认得的 cloud:// 白名单 token：命中则无需重新镜像。
const SAFE_CLOUD_TOKENS = ['imdb_covers', 'oscar_covers', 'boxoffice_covers'];

// 把任意一段封面值规整成「线上 <image> 可直接渲染」的 cloud:// fileID。
//   - 豆瓣 http(s) URL → 带 Referer 下载后上传到 MIRROR_DIR
//   - cloud:// 但路径不含白名单 token（如 searched_movie_covers）→ 云端取回后重传到 MIRROR_DIR
//   - cloud:// 且已含白名单 token / 空值 / 其它 → 原样返回
//   失败一律原样返回，不阻塞写入。
async function mirrorCover(url, openid) {
    if (!url || typeof url !== 'string') return url;
    try {
        let buffer = null;

        if (/^cloud:\/\//i.test(url)) {
            if (SAFE_CLOUD_TOKENS.some(t => url.includes(t))) return url; // 线上已能渲染
            const dl = await cloud.downloadFile({ fileID: url });
            buffer = dl && dl.fileContent;
        } else if (/^https?:\/\/[^/]*\bdoubanio\.com/i.test(url)) {
            const resp = await axios.get(url, {
                responseType: 'arraybuffer',
                timeout: 12000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.3 Mobile/15E148 Safari/604.1',
                    'Referer': 'https://book.douban.com/'
                }
            });
            buffer = Buffer.from(resp.data);
        } else {
            return url; // 非豆瓣的普通 URL：交给前端原样渲染
        }

        if (!buffer) return url;
        const cloudPath = `${MIRROR_DIR}/${openid || 'anon'}_${Date.now()}_${Math.floor(Math.random() * 1e4)}.jpg`;
        const up = await cloud.uploadFile({ cloudPath, fileContent: buffer });
        return (up && up.fileID) ? up.fileID : url;
    } catch (e) {
        console.warn('mirrorCover 失败，保留原值：', e && e.message);
        return url;
    }
}

// 镜像 meta 里的封面/海报字段（read 用 cover，movie 用 poster）
async function mirrorMetaCovers(meta, openid) {
    if (!meta || typeof meta !== 'object') return meta;
    if (meta.cover) meta.cover = await mirrorCover(meta.cover, openid);
    if (meta.poster) meta.poster = await mirrorCover(meta.poster, openid);
    return meta;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// 封面值是否「需要迁移」：非空、且不是已被线上 <image> 白名单认可的 cloud 封面。
function needsMirror(v) {
    if (!v || typeof v !== 'string') return false;
    if (/^cloud:\/\//i.test(v)) return !SAFE_CLOUD_TOKENS.some(t => v.includes(t));
    return true; // http(s) 直链
}

// 从 searched_movies 取该电影已转存的 cloud 封面（movie_search_${doubanId}.poster）。
// 命中则作为镜像源（云→云拷贝，不打豆瓣）；未命中返回空。
async function cloudPosterFromSearched(doubanId) {
    if (!doubanId) return '';
    try {
        const r = await db.collection('searched_movies').doc('movie_search_' + String(doubanId)).get();
        const p = r && r.data && r.data.poster;
        return (typeof p === 'string' && /^cloud:\/\//i.test(p)) ? p : '';
    } catch (e) { return ''; }
}

// ── 运维迁移（生产安全版）：把历史 DailyLogs 里的直链封面补镜像成 cloud://。 ──
//   背景：早期（mirrorCover 加入前）或当时镜像失败的记录，meta.poster/cover 仍是豆瓣直链，
//   canvas 分享海报无法 downloadFile 加载（域名白名单）。幂等：已是白名单 cloud 封面直接跳过。
//   入参：{ action:'migrateCovers', theme?='movie', apply?=false, startAfter?='', maxDocs?, maxTransfers? }
//     · apply:false（默认）干跑：只扫描统计脏数据、不下载不写库，用于评估规模；maxDocs 默认 500。
//     · apply:true 执行：每次最多处理 maxDocs 文档 / maxTransfers 次转存后停下，返回 nextStartAfter；
//       反复用 nextStartAfter 续跑至 done=true（分批，避免 60s 超时）。maxDocs 默认 50、maxTransfers 默认 40。
//   生产安全要点：
//     · 按 _id 游标分批可续跑，不用 skip（大偏移慢/易漏）。
//     · 优先复用 searched_movies 的 cloud 封面（云→云），仅未命中才打豆瓣、且每次 sleep 300ms 限流，避免风控。
//     · 慢转存先做，随后「重读该文档→按 ts 回填→写回」，竞态窗口与 upsertDay 同级，不整体覆盖旧 entries。
async function migrateCovers(event) {
    const theme = event.theme || 'movie';
    const apply = event.apply === true;       // 执行需显式 apply:true，默认干跑
    const startAfter = event.startAfter || '';
    // 云 DB 单次 get 服务端上限 1000：超过会被静默截断，导致 done=docs.length<maxDocs 永远为真、游标卡在 1000。
    const maxDocs = Math.min(Number(event.maxDocs) || (apply ? 50 : 500), 1000);
    const maxTransfers = Number(event.maxTransfers) || 20;
    // 挂钟时间预算：默认 15s 就收手返回游标，避免被云函数超时（可能仅 20s）强杀
    const timeBudgetMs = Number(event.timeBudgetMs) || 15000;
    const t0 = Date.now();
    const capReached = () => apply && (transfers >= maxTransfers || Date.now() - t0 > timeBudgetMs);
    const coll = db.collection('DailyLogs');

    const where = startAfter ? { theme, _id: _.gt(startAfter) } : { theme };
    const res = await coll.where(where).orderBy('_id', 'asc').limit(maxDocs).get();
    const docs = res.data || [];

    let scannedDocs = 0, dirtyEntries = 0, mirrored = 0, changedDocs = 0, transfers = 0, doubanHits = 0;
    let cursor = startAfter, stoppedForCap = false;
    const samples = [];

    for (const doc of docs) {
        if (capReached()) { stoppedForCap = true; break; }
        scannedDocs++;
        const patches = []; // { ts, field, newVal }
        for (const e of (doc.entries || [])) {
            const meta = e && e.meta;
            if (!meta || typeof meta !== 'object') continue;
            for (const field of ['poster', 'cover']) {
                if (!needsMirror(meta[field])) continue;
                dirtyEntries++;
                if (samples.length < 20) samples.push({ id: doc._id, title: meta.title || '', field, before: String(meta[field]).slice(0, 48) });
                if (!apply) continue;
                if (capReached()) { stoppedForCap = true; break; }
                // 镜像源：优先 searched_movies 云封面（云→云，不打豆瓣）；否则用直链（打豆瓣，限流）
                let source = meta[field];
                if (field === 'poster') {
                    const c = await cloudPosterFromSearched(meta.doubanId);
                    if (c) source = c;
                }
                if (/doubanio\.com/i.test(String(source))) {
                    // 兜底直链多为 s_/m_ratio_poster 小图，升级成 l_ratio_poster 大图再下（海报墙放大不糊）
                    source = String(source).replace(/\/[sm]_ratio_poster\//, '/l_ratio_poster/');
                    doubanHits++;
                    await sleep(300);
                }
                const after = await mirrorCover(source, doc.openid);
                transfers++;
                if (after && !needsMirror(after)) patches.push({ ts: e.ts, field, newVal: after });
            }
            if (stoppedForCap) break;
        }
        // 写回：重读该文档→按 ts 回填→写（慢转存已在上面完成，此处窗口极小）
        if (apply && patches.length) {
            try {
                const fresh = await coll.doc(doc._id).get();
                const fe = (fresh.data && fresh.data.entries) || [];
                let touched = false;
                for (const p of patches) {
                    const t = fe.find(x => x.ts === p.ts);
                    if (t && t.meta && needsMirror(t.meta[p.field])) { t.meta[p.field] = p.newVal; touched = true; mirrored++; }
                }
                if (touched) { await coll.doc(doc._id).update({ data: { entries: fe } }); changedDocs++; }
            } catch (err) {
                console.warn('migrateCovers 写回失败', doc._id, err && err.message);
            }
        }
        if (stoppedForCap) break;   // 因上限中断：不推进游标，下次续跑重扫本文档（幂等）
        cursor = doc._id;           // 本文档处理完毕
    }

    const done = !stoppedForCap && docs.length < maxDocs;
    return { success: true, theme, apply, done, nextStartAfter: done ? '' : cursor, scannedDocs, dirtyEntries, mirrored, changedDocs, transfers, doubanHits, samples };
}

// 主题默认值（与前端 utils/dailyThemes.js 保持一致；这里只放最小集合，用于无设置时兜底）
const THEME_DEFAULTS = {
    water:   { unit: 'ml',  daily_goal: 2000, presets: [200, 350, 500] },
    milktea: { unit: '杯', daily_goal: 1,    presets: [1] },
    // movie 里 daily_goal 复用为"每月目标部数"，用于月度进度。
    movie:   { unit: '部', daily_goal: 10,   presets: [1] },
    // read 里 daily_goal 复用为"每月目标本数"，用于月度进度。
    read:    { unit: '本', daily_goal: 5,    presets: [1] },
    // sport 里 daily_goal 复用为"每月目标训练次数"，用于月度进度。
    sport:   { unit: '次', daily_goal: 20,   presets: [1] }
};

function todayStr() {
    // 北京时间 YYYY-MM-DD
    const d = new Date(Date.now() + 8 * 3600 * 1000);
    return d.toISOString().slice(0, 10);
}

function defaultsOf(theme) {
    return THEME_DEFAULTS[theme] || THEME_DEFAULTS.water;
}

async function getSettings(openid, theme) {
    const res = await db.collection('DailySettings').where({ openid, theme }).limit(1).get();
    const def = defaultsOf(theme);
    if (res.data.length) {
        const s = res.data[0];
        return {
            theme,
            daily_goal: s.daily_goal != null ? s.daily_goal : def.daily_goal,
            presets: s.presets && s.presets.length ? s.presets : def.presets,
            unit: def.unit
        };
    }
    return { theme, daily_goal: def.daily_goal, presets: def.presets, unit: def.unit };
}

async function getDay(openid, theme, date) {
    const res = await db.collection('DailyLogs').where({ openid, theme, date }).limit(1).get();
    if (res.data.length) return res.data[0];
    return null;
}

async function getYearDays(openid, theme, year) {
    const from = `${year}-01-01`;
    const to = `${year}-12-31`;
    const query = db.collection('DailyLogs')
        .where({ openid, theme, date: _.gte(from).and(_.lte(to)) })
        .orderBy('date', 'asc');
    const countRes = await query.count();
    const total = countRes.total || 0;
    if (!total) return [];

    const batchTimes = Math.ceil(total / 100);
    const tasks = [];
    for (let i = 0; i < batchTimes; i++) {
        tasks.push(query.skip(i * 100).limit(100).get());
    }
    const results = await Promise.all(tasks);
    let days = [];
    results.forEach(r => { days = days.concat(r.data || []); });
    return days;
}

// 拉取某用户某主题的「全部」打卡日（不限日期），MAX_LIMIT=100 分页循环。个人日记量级很小，一次拉完即可。
async function getAllDays(openid, theme) {
    const query = db.collection('DailyLogs')
        .where({ openid, theme })
        .orderBy('date', 'asc');
    const countRes = await query.count();
    const total = countRes.total || 0;
    if (!total) return [];

    const batchTimes = Math.ceil(total / 100);
    const tasks = [];
    for (let i = 0; i < batchTimes; i++) {
        tasks.push(query.skip(i * 100).limit(100).get());
    }
    const results = await Promise.all(tasks);
    let days = [];
    results.forEach(r => { days = days.concat(r.data || []); });
    return days;
}

// ─── 写入：原子追加（addEntry 专用，规避并发 lost-update） ───────────────
// 1) 先尝试用 push + inc 原子更新已有文档；
// 2) 若 stats.updated === 0（无此日记录），则 add() 新建；
// 3) 若 add() 因唯一索引冲突失败（并发新建），回到 push + inc 路径补救。
async function atomicAddEntry(openid, theme, date, entry) {
    const now = new Date().toISOString();
    const unit = defaultsOf(theme).unit;

    const tryUpdate = () => db.collection('DailyLogs').where({ openid, theme, date }).update({
        data: {
            entries: _.push([entry]),
            total_value: _.inc(entry.value),
            updated_at: now
        }
    });

    const upd = await tryUpdate();
    if (upd.stats && upd.stats.updated > 0) {
        return await getDay(openid, theme, date);
    }

    // 没有命中已有文档：尝试新建
    try {
        await db.collection('DailyLogs').add({
            data: {
                openid, theme, date, unit,
                entries: [entry],
                total_value: entry.value,
                updated_at: now,
                created_at: now
            }
        });
    } catch (err) {
        // 唯一索引冲突（openid+theme+date）→ 并发新建，回到 update 路径
        console.warn('atomicAddEntry add 冲突，回退 update：', err.message);
        await tryUpdate();
    }
    return await getDay(openid, theme, date);
}

// 读-改-写：仅用于 removeEntry（连点不可能，竞态可忽略）
async function upsertDay(openid, theme, date, mutate) {
    const existing = await getDay(openid, theme, date);
    const now = new Date().toISOString();
    const unit = defaultsOf(theme).unit;

    if (existing) {
        const next = mutate({ ...existing, entries: existing.entries || [] });
        await db.collection('DailyLogs').doc(existing._id).update({
            data: {
                total_value: next.total_value,
                entries: next.entries,
                updated_at: now
            }
        });
        return { ...existing, ...next, updated_at: now };
    }
    // 不存在记录：编辑 / 删除 / 重排一个不存在的日期视为 no-op，
    // 返回空壳但**不写库**，避免产生 entries:[] 的垃圾空文档（addEntry 走 atomicAddEntry，不经此路径）
    return { openid, theme, date, total_value: 0, entries: [], unit, updated_at: now };
}

exports.main = async (event, context) => {
    const wxContext = cloud.getWXContext();
    const openid = wxContext.OPENID;
    const action = event.action;

    // 一次性运维迁移：扫全量补齐云存储封面，无需 openid（从云函数控制台执行）
    if (action === 'migrateCovers') {
        try {
            return await migrateCovers(event);
        } catch (err) {
            console.error('migrateCovers error', err);
            return { success: false, error: err && err.message };
        }
    }

    // 缺 openid 直接拒绝：理论上小程序调用必给，留作开发态/服务端测试调用兜底
    if (!openid) return { success: false, error: 'NO_OPENID' };
    const theme = event.theme || 'water';

    try {
        if (action === 'getToday') {
            const date = event.date || todayStr();
            const [settings, today] = await Promise.all([
                getSettings(openid, theme),
                getDay(openid, theme, date)
            ]);
            return {
                success: true,
                theme,
                date,
                today: today || { theme, date, total_value: 0, entries: [], unit: settings.unit },
                settings
            };
        }

        if (action === 'addEntry') {
            const { date = todayStr(), value, meta = null } = event;
            const v = Number(value);
            if (!v || v <= 0) return { success: false, error: 'value 必须 > 0' };
            // 豆瓣封面镜像到云存储，规避 <image> 防盗链 418
            const safeMeta = await mirrorMetaCovers(meta, openid);
            const entry = { ts: Date.now(), value: v, meta: safeMeta };
            const updated = await atomicAddEntry(openid, theme, date, entry);
            return { success: true, theme, date, day: updated };
        }

        if (action === 'removeEntry') {
            const { date, ts } = event;
            if (!date || !ts) return { success: false, error: 'date / ts 必填' };
            const updated = await upsertDay(openid, theme, date, day => {
                const entries = (day.entries || []).filter(e => e.ts !== ts);
                const total_value = entries.reduce((s, e) => s + (Number(e.value) || 0), 0);
                return { ...day, entries, total_value };
            });
            return { success: true, theme, date, day: updated };
        }

        if (action === 'updateEntry') {
            const { date, ts, value, meta = null } = event;
            if (!date || !ts) return { success: false, error: 'date / ts 必填' };
            const safeMeta = await mirrorMetaCovers(meta, openid);
            const updated = await upsertDay(openid, theme, date, day => {
                const entries = (day.entries || []).map(e => {
                    if (e.ts !== ts) return e;
                    const nv = (value != null && Number(value) > 0) ? Number(value) : e.value;
                    return { ...e, value: nv, meta: safeMeta != null ? safeMeta : e.meta };
                });
                const total_value = entries.reduce((s, e) => s + (Number(e.value) || 0), 0);
                return { ...day, entries, total_value };
            });
            return { success: true, theme, date, day: updated };
        }

        if (action === 'reorderEntries') {
            const { date, order } = event;
            if (!date || !Array.isArray(order)) return { success: false, error: 'date / order 必填' };
            const updated = await upsertDay(openid, theme, date, day => {
                const entries = day.entries || [];
                const byTs = {};
                entries.forEach(e => { byTs[e.ts] = e; });
                const seen = {};
                const ordered = [];
                order.forEach(ts => { if (byTs[ts] && !seen[ts]) { ordered.push(byTs[ts]); seen[ts] = true; } });
                // order 里没覆盖到的（异常）按原序补在后面，避免丢条目
                entries.forEach(e => { if (!seen[e.ts]) ordered.push(e); });
                return { ...day, entries: ordered };
            });
            return { success: true, theme, date, day: updated };
        }

        if (action === 'setGoal') {
            const { daily_goal } = event;
            const v = Number(daily_goal);
            // daily_goal 必须 > 0：前端 progress = total/goal、达标率分母都依赖它
            if (!Number.isFinite(v) || v <= 0 || v > 100000) {
                return { success: false, error: 'daily_goal 必须在 (0, 100000] 区间' };
            }
            const now = new Date().toISOString();
            const existing = await db.collection('DailySettings').where({ openid, theme }).limit(1).get();
            if (existing.data.length) {
                await db.collection('DailySettings').doc(existing.data[0]._id).update({
                    data: { daily_goal: v, updated_at: now }
                });
            } else {
                const def = defaultsOf(theme);
                await db.collection('DailySettings').add({
                    data: { openid, theme, daily_goal: v, presets: def.presets, updated_at: now, created_at: now }
                });
            }
            return { success: true, theme, daily_goal: v };
        }

        if (action === 'setPresets') {
            const { presets } = event;
            if (!Array.isArray(presets) || presets.length === 0 || presets.length > 6) {
                return { success: false, error: 'presets 需为 1~6 个数字' };
            }
            const cleaned = presets.map(Number).filter(n => Number.isFinite(n) && n > 0);
            if (!cleaned.length) return { success: false, error: 'presets 数据无效' };
            const now = new Date().toISOString();
            const existing = await db.collection('DailySettings').where({ openid, theme }).limit(1).get();
            if (existing.data.length) {
                await db.collection('DailySettings').doc(existing.data[0]._id).update({
                    data: { presets: cleaned, updated_at: now }
                });
            } else {
                const def = defaultsOf(theme);
                await db.collection('DailySettings').add({
                    data: { openid, theme, daily_goal: def.daily_goal, presets: cleaned, updated_at: now, created_at: now }
                });
            }
            return { success: true, theme, presets: cleaned };
        }

        if (action === 'getRange') {
            const { from, to } = event;
            if (!from || !to) return { success: false, error: 'from / to 必填' };
            // 跨度保护：limit(100) 会静默截断，提前拒绝避免数据残缺
            const spanDays = Math.round(
                (new Date(to + 'T00:00:00Z') - new Date(from + 'T00:00:00Z')) / 86400000
            ) + 1;
            if (!(spanDays >= 1 && spanDays <= 100)) {
                return { success: false, error: `getRange 跨度需在 1~100 天，当前=${spanDays}` };
            }
            const res = await db.collection('DailyLogs')
                .where({ openid, theme, date: _.gte(from).and(_.lte(to)) })
                .orderBy('date', 'asc')
                .limit(100)
                .get();
            const settings = await getSettings(openid, theme);
            const map = {};
            res.data.forEach(d => { map[d.date] = d; });
            const days = [];
            const start = new Date(from + 'T00:00:00Z');
            const end = new Date(to + 'T00:00:00Z');
            for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
                const k = d.toISOString().slice(0, 10);
                days.push(map[k] || { theme, date: k, total_value: 0, entries: [] });
            }
            return { success: true, theme, from, to, days, settings };
        }

        if (action === 'getYear') {
            const y = Number(event.year);
            if (!Number.isInteger(y) || y < 1970 || y > 3000) {
                return { success: false, error: 'year 参数无效' };
            }
            const [days, settings] = await Promise.all([
                getYearDays(openid, theme, y),
                getSettings(openid, theme)
            ]);
            return { success: true, theme, year: y, days, settings };
        }

        // 全部记录（跨年）—— 用于「海报分享」时间轴多选页拉取该用户某主题的所有打卡日。
        // 只返回有记录的日子（不 gap-fill），MAX_LIMIT=100 分页循环，按 date 升序。响应结构与 getYear 对齐。
        if (action === 'getAll') {
            const [days, settings] = await Promise.all([
                getAllDays(openid, theme),
                getSettings(openid, theme)
            ]);
            return { success: true, theme, days, settings };
        }

        return { success: false, error: '未知 action: ' + action };
    } catch (err) {
        console.error('syncDailyLog 失败:', err);
        return { success: false, error: err.message, stack: err.stack };
    }
};
