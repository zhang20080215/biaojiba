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
//   另有运维动作 'stats'（各主题参与人数）/ 'fixBookPages'（修正某用户某本书的总页数），都不需要 openid，从云函数控制台跑
//   theme:  'water' | 'milktea' | ...

const cloud = require('wx-server-sdk');
const axios = require('axios');
// sharp（libvips 原生）**有意不装**（package.json 里没有）：它只用来把外部源的超大封面压到 900 宽，
// 而 2026-09 决定 TVmaze 季海报直接存 medium 小图（210×295）——代价只是「单季分享海报」满幅时发糊，
// 换来 syncDailyLog 这个打卡热路径不背原生依赖、部署不必选「云端安装依赖」。
// 想升级清晰度：package.json 加 `"sharp": "^0.33"`、部署选云端安装依赖，下面的代码会自动改走原图 + 压缩。
let sharp = null;
try { sharp = require('sharp'); } catch (e) { /* 有意不装，静默 */ }
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
        } else if (/^https?:\/\/[^/]*\btvmaze\.com/i.test(url)) {
            // TVmaze 季海报（豆瓣登录墙挡掉的分季剧集走 TVmaze 补季）：static.tvmaze.com 无防盗链，直接下载后镜像。
            // 前端传的是 original_untouched（实测有 4050×6000 / 5.3 MB 的）。TVmaze 只有 medium / original 两档，
            // 没装 sharp 压不了原图，就直接取 medium_portrait（210×295、~20 KB）——日历格/网格海报够用，
            // 只有单季分享海报满幅时会糊（有意接受，见文件头 sharp 注）。装了 sharp 才拉原图，交给 shrinkCover 压。
            const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
            const small = url.replace('/original_untouched/', '/medium_portrait/');
            const target = sharp ? url : small;
            try {
                const resp = await axios.get(target, { responseType: 'arraybuffer', timeout: sharp ? 25000 : 12000, headers: { 'User-Agent': ua } });
                buffer = Buffer.from(resp.data);
            } catch (e) {
                if (target === small) throw e;
                console.warn('tvmaze 原图拉取失败，退到 medium：', e && e.message);
                const resp = await axios.get(small, { responseType: 'arraybuffer', timeout: 12000, headers: { 'User-Agent': ua } });
                buffer = Buffer.from(resp.data);
            }
        } else if (/^https?:\/\/[^/]*\bmtime\.cn/i.test(url)) {
            // 时光网封面（豆瓣搜不到的正片走时光网兜底）：带 Referer 下载后同样镜像到云存储，
            // 否则停留在 http 直链 → canvas 分享绘制器只认 cloud://，会画不出海报背景。
            const resp = await axios.get(url, {
                responseType: 'arraybuffer',
                timeout: 12000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.3 Mobile/15E148 Safari/604.1',
                    'Referer': 'https://film.mtime.com/'
                }
            });
            buffer = Buffer.from(resp.data);
        } else {
            return url; // 其它普通 URL：交给前端原样渲染
        }

        if (!buffer) return url;
        buffer = await shrinkCover(buffer, url);
        const cloudPath = `${MIRROR_DIR}/${openid || 'anon'}_${Date.now()}_${Math.floor(Math.random() * 1e4)}.jpg`;
        const up = await cloud.uploadFile({ cloudPath, fileContent: buffer });
        return (up && up.fileID) ? up.fileID : url;
    } catch (e) {
        console.warn('mirrorCover 失败，保留原值：', e && e.message);
        return url;
    }
}

// 超大封面落库前压一档。豆瓣 l_ratio_poster 约 600×900 / 100~300 KB，前端各处（日历格、书墙、海报 canvas）
// 都是按这个量级设计的；TVmaze 的 original_untouched 实测有 4050×6000 / 5.3 MB 的，而 MIRROR_DIR 带 `_covers/`、
// 前端列表对它不叠 imageMogr2 缩略（见 utils/imageCacheManager.js），每个日历格都会原样拉整张，
// 分享海报页也是整张进 canvas——所以在这里统一收口：
//   · 超过 SHRINK_OVER 的才处理，等比缩到宽 ≤ SHRINK_WIDTH 的 JPEG（sharp 对 4050×6000 约 650 ms；
//     试过 jimp 纯 JS 要 19s、位图近 100 MB，函数上会 OOM，所以不用它）；
//   · sharp 不可用（当前默认，有意不装）或失败：TVmaze 链接退到 medium_portrait（210×295、20 KB）重新下载——
//     宁要一张糊的小图，也不能把 5 MB 落库。正常路径下 mirrorCover 的 tvmaze 分支已经直接取了 medium，
//     这里是双保险；其它来源没这么大的，原样返回。
const SHRINK_OVER = 500 * 1024;
const SHRINK_WIDTH = 900;
async function shrinkCover(buffer, url) {
    if (!buffer || buffer.length <= SHRINK_OVER) return buffer;
    if (sharp) {
        try {
            const out = await sharp(buffer).resize({ width: SHRINK_WIDTH, withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
            console.log(`shrinkCover ${(buffer.length / 1024) | 0}KB → ${(out.length / 1024) | 0}KB`);
            return out.length < buffer.length ? out : buffer;
        } catch (e) {
            console.warn('shrinkCover sharp 失败：', e && e.message);
        }
    }
    const small = String(url || '').replace('/original_untouched/', '/medium_portrait/');
    if (small && small !== url) {
        try {
            const resp = await axios.get(small, { responseType: 'arraybuffer', timeout: 12000 });
            console.warn(`shrinkCover 退到 medium：${(buffer.length / 1024) | 0}KB → ${(resp.data.length / 1024) | 0}KB`);
            return Buffer.from(resp.data);
        } catch (e) {
            console.warn('shrinkCover medium 兜底失败，保留原图：', e && e.message);
        }
    }
    return buffer;
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

// 从 searched_books 取该书已转存的 cloud 封面（book_search_${doubanId}.cover，fetchBookFullInfo 写入）。
// read 迁移的云→云镜像源，命中则不打豆瓣；未命中返回空。与 cloudPosterFromSearched 对称。
async function cloudCoverFromSearchedBook(doubanId) {
    if (!doubanId) return '';
    try {
        const r = await db.collection('searched_books').doc('book_search_' + String(doubanId)).get();
        const c = r && r.data && r.data.cover;
        return (typeof c === 'string' && /^cloud:\/\//i.test(c)) ? c : '';
    } catch (e) { return ''; }
}

// ── 运维迁移（生产安全版）：把历史 DailyLogs 里的直链封面补镜像成 cloud://。 ──
//   背景：早期（mirrorCover 加入前）或当时镜像失败的记录，meta.poster/cover 仍是豆瓣直链，
//   canvas 分享海报无法 downloadFile 加载（域名白名单）。幂等：已是白名单 cloud 封面直接跳过。
//   入参：{ action:'migrateCovers', theme?='movie', apply?=false, startAfter?='', maxDocs?, maxTransfers? }
//     · theme='movie' 扫 meta.poster（云源 searched_movies）；theme='read' 扫 meta.cover（云源 searched_books）。
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
                // 镜像源：优先已转存的云封面（云→云，不打豆瓣）—— movie 走 searched_movies.poster，
                // read 走 searched_books.cover；均未命中才用直链（打豆瓣，限流）
                let source = meta[field];
                if (field === 'poster') {
                    const c = await cloudPosterFromSearched(meta.doubanId);
                    if (c) source = c;
                } else if (field === 'cover') {
                    const c = await cloudCoverFromSearchedBook(meta.doubanId);
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

// ── 运维统计：各每日主题有多少人在用 ──
// DailyLogs 是「一人一主题一天一条」，所以：
//   players  = 独立 openid —— 打过卡的人（只打开页面不记录不写库，所以是真在用的人）
//   dayLogs  = 文档数 = 人×天 —— 累计打卡天数
//   entries  = 明细条数 —— 看了多少部电影 / 读了多少本书 / 练了多少次（喝水则是喝水次数）
//   active30 = 近 30 天有过打卡的独立 openid —— 总量看存量，这个看还剩多少人在动
// entries 那一路单独兜底：老数据里 entries 可能缺字段，$.size 会炸，炸了就只是少这一列。
async function dailyStats(event) {
    const $ = db.command.aggregate;
    const one = event && event.theme;
    const match = one ? { theme: one } : { theme: _.exists(true) };
    const toMap = list => {
        const o = {};
        (list || []).forEach(r => { o[r._id] = r; });
        return o;
    };

    const playersRes = await db.collection('DailyLogs').aggregate()
        .match(match)
        .group({ _id: { theme: '$theme', openid: '$openid' } })
        .group({ _id: '$_id.theme', total: $.sum(1) })
        .end();

    // 近 30 天（含今天）活跃：date 是 'YYYY-MM-DD' 字符串，按字典序比大小即可
    const since = new Date(Date.now() + 8 * 3600 * 1000 - 29 * 86400000).toISOString().slice(0, 10);
    let activeMap = {};
    try {
        const activeRes = await db.collection('DailyLogs').aggregate()
            .match(Object.assign({ date: _.gte(since) }, match))
            .group({ _id: { theme: '$theme', openid: '$openid' } })
            .group({ _id: '$_id.theme', total: $.sum(1) })
            .end();
        activeMap = toMap(activeRes.list);
    } catch (e) {
        console.warn('[syncDailyLog] 活跃统计失败:', e && (e.errMsg || e.message));
    }

    let daysMap = {};
    try {
        const daysRes = await db.collection('DailyLogs').aggregate()
            .match(match)
            .group({
                _id: '$theme',
                total: $.sum(1),
                entries: $.sum($.size($.ifNull(['$entries', []])))
            })
            .end();
        daysMap = toMap(daysRes.list);
    } catch (e) {
        console.warn('[syncDailyLog] 打卡天数统计失败:', e && (e.errMsg || e.message));
    }

    const stats = {};
    (playersRes.list || []).forEach(r => {
        const theme = r._id;
        const players = r.total || 0;
        const d = daysMap[theme] || {};
        const dayLogs = d.total || 0;
        stats[theme] = {
            players,
            active30: (activeMap[theme] || {}).total || 0,
            dayLogs,
            entries: d.entries || 0,
            // 人均打卡天数：留一位小数，用来横向比各主题黏性
            daysPerPlayer: players ? Math.round(dayLogs / players * 10) / 10 : 0
        };
    });
    return { success: true, since30: since, stats };
}

// 运维修正：某个用户某本书的「总页数」（用户反馈豆瓣抓错页数，如《加西亚·马尔克斯传》豆瓣 480、实际 557）。
//   { action:'fixBookPages', openid, doubanId?, title?, totalPages, apply?:true }
//   { action:'fixBookPages', allUsers:true, doubanId, totalPages, apply?:true }   // 跨用户：查「还有谁在读这本」+ 一次修完
// 范围锁死在 openid + theme:'read' + 这一本书（doubanId 优先，没有就按 meta.title 全等），只改命中条目的
// meta.totalPages，同用户其它书、其它字段一律不碰。默认干跑只报会改哪些（顺便把 doubanId 报出来，
// 第二次就能按 id 跑）；apply:true 才写。allUsers 模式必须给 doubanId（按 title 跨用户扫会串版本），
// 干跑返回 byOpenid 汇总，先看清楚是谁、几条，再决定要不要 apply。进度百分比不落库、前端按 currentPage/totalPages 现算，
// 改了分母即等于重算。命中 doubanId 时同时把 searched_books 缓存的 pages 改掉并打上 pagesOverride，
// 否则用户下次「继续阅读」/重选这本书，add 页从详情拿到的仍是旧页数。
// 注意：add 页把超过总页数的当前页夹到总页数，所以 currentPage == 旧分母 的条目可能是被夹过的，
// 脚本无法反推真实页数，报告里标 clampedSuspect 让用户自己在轻编辑里改。
async function fixBookPages(event) {
    const openid = String(event.openid || '').trim();
    const doubanId = String(event.doubanId || '').trim();
    const title = String(event.title || '').trim();
    const totalPages = Number(event.totalPages) || 0;
    const apply = event.apply === true;
    const allUsers = event.allUsers === true;
    if (allUsers && !doubanId) return { success: false, error: 'allUsers 模式必须给 doubanId' };
    if (!allUsers && !openid) return { success: false, error: 'openid 必填（或 allUsers:true）' };
    if (!doubanId && !title) return { success: false, error: 'doubanId / title 至少给一个' };
    if (!(totalPages > 0)) return { success: false, error: 'totalPages 必须是正整数' };

    const hit = m => m && typeof m === 'object' && (
        doubanId ? String(m.doubanId || '') === doubanId : String(m.title || '').trim() === title
    );

    const coll = db.collection('DailyLogs');
    const PAGE = 100;
    const docs = [];
    // 跨用户模式按数组子文档点路径直接命中含这本书的打卡日，不必扫全部 read 文档
    const where = allUsers ? { theme: 'read', 'entries.meta.doubanId': doubanId } : { openid, theme: 'read' };
    for (let skip = 0; ; skip += PAGE) {
        const r = await coll.where(where).orderBy('date', 'asc').skip(skip).limit(PAGE).get();
        docs.push(...(r.data || []));
        if ((r.data || []).length < PAGE) break;
    }

    const matched = [];        // 报告用
    const ids = new Set();     // 命中条目里出现过的 doubanId（按 title 跑时用来定位缓存文档）
    let changedDocs = 0, changedEntries = 0;
    for (const doc of docs) {
        const entries = doc.entries || [];
        const targets = entries.filter(e => hit(e.meta));
        if (!targets.length) continue;
        targets.forEach(e => {
            const m = e.meta;
            const before = Number(m.totalPages) || 0;
            if (m.doubanId) ids.add(String(m.doubanId));
            matched.push({
                openid: doc.openid, date: doc.date, ts: e.ts, title: m.title || '', doubanId: m.doubanId || '',
                before, after: totalPages, currentPage: Number(m.currentPage) || 0,
                clampedSuspect: before > 0 && Number(m.currentPage) === before
            });
        });
        if (!apply) continue;
        // 写回：重读该文档→只改命中条目的 totalPages→整体写回 entries（保持数组顺序即展示顺序）
        const fresh = await coll.doc(doc._id).get();
        const fe = (fresh.data && fresh.data.entries) || [];
        let touched = 0;
        fe.forEach(e => {
            if (!hit(e.meta) || Number(e.meta.totalPages) === totalPages) return;
            e.meta.totalPages = totalPages;
            touched++;
        });
        if (touched) {
            await coll.doc(doc._id).update({ data: { entries: fe, updated_at: db.serverDate() } });
            changedDocs++;
            changedEntries += touched;
        }
    }

    // 缓存同步：只有唯一确定的 doubanId 才动 searched_books（按 title 命中多个 id 时不猜，报出来让人选）
    const cacheId = doubanId || (ids.size === 1 ? [...ids][0] : '');
    const cache = { doubanId: cacheId, updated: false };
    if (cacheId) {
        const bookDocId = `book_search_${cacheId}`;
        try {
            const r = await db.collection('searched_books').doc(bookDocId).get();
            cache.before = r.data ? r.data.pages : undefined;
            if (apply && r.data) {
                await db.collection('searched_books').doc(bookDocId).update({
                    data: { pages: totalPages, pagesOverride: totalPages, pagesOverrideAt: db.serverDate() }
                });
                cache.updated = true;
            }
        } catch (e) {
            cache.error = e && (e.errMsg || e.message);   // 文档不存在 → 没缓存过，不用管
        }
    }

    // 按用户汇总：几条记录、最近一条日期与页数，一眼看出「谁在读、读到哪」
    const byOpenid = {};
    matched.forEach(x => {
        const b = byOpenid[x.openid] || (byOpenid[x.openid] = { entries: 0, firstDate: x.date, lastDate: x.date, lastPage: 0 });
        b.entries++;
        if (x.date < b.firstDate) b.firstDate = x.date;
        if (x.date >= b.lastDate) { b.lastDate = x.date; b.lastPage = x.currentPage; }
    });

    return {
        success: true, apply, allUsers, openid: allUsers ? null : openid, doubanId: doubanId || null, title: title || null, totalPages,
        scannedDocs: docs.length, matchedEntries: matched.length, changedDocs, changedEntries,
        users: Object.keys(byOpenid).length, byOpenid, doubanIdsSeen: [...ids], cache, matched
    };
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

    // 运维统计：各主题参与人数。跟 migrateCovers 一样不需要 openid，从云函数控制台跑。
    // { action: 'stats' } 全部主题；{ action: 'stats', theme: 'read' } 只看一个
    if (action === 'stats') {
        try {
            return await dailyStats(event);
        } catch (err) {
            console.error('dailyStats error', err);
            return { success: false, error: err && (err.errMsg || err.message) };
        }
    }

    // 运维修正：某用户某本书的总页数，openid 走入参（从云函数控制台跑），默认干跑
    if (action === 'fixBookPages') {
        try {
            return await fixBookPages(event);
        } catch (err) {
            console.error('fixBookPages error', err);
            return { success: false, error: err && (err.errMsg || err.message) };
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
