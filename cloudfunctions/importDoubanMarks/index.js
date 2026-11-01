// 云函数：importDoubanMarks —— 把用户在豆瓣公开的「看过 / 想看」一次性导成标记
//
// 定位是「一次性搬家」，不是持续同步：不记豆瓣 uid，想再导就重新粘贴链接，只补新增。
// 持续同步会让用户继续在豆瓣标、我们变成镜像，反而伤日活（docs/豆瓣导入-可行性验证.md）。
//
// 数据来源：m.douban.com/rexxar 的用户 interests 接口，匿名可读公开记录（2026-11-01 实测云端
// 580 部整份读完没被拦）。没有官方授权方式，所以必须用户自己发起、只读本人公开数据。
//
// 前端按页循环调（每次读 1 页 50 条），单次调用短、进度条好做，也不会撞超时：
//   { action: 'preview', uid }                       → { doneTotal, wishTotal }
//   { action: 'start', statuses: ['done','mark'] }   → { importId, cursors, counters }（当天有未完成的就续上）
//   { action: 'page', importId, uid, status, start } → 本页统计 + nextStart（null = 这个状态读完了）
//   { action: 'finish', importId }                   → 汇总
//   { action: 'undo', importId }                     → { removed, restored, kept, remaining }（remaining>0 再调）
// 运维（控制台跑）：{ action: 'stats' }  { action: 'resetCircuit' }
//
// 对片：movie_facts（_id = doubanId）的 movieIds 已经是这部片在各榜单的全部文档 id，
// 直接写到每一条，不再走 movie_alias 扩散。IMDb 榜单没有 doubanId，对不上（已知缺口）。
//
// 写进 Marks 的每条都带 source:'douban_import' + importId + importStatus，撤销靠它们；
// marked_at 用豆瓣的标记时间，时间轴保持真实，也不会把「最近热门」刷高。
// openid 一律从 wxContext 取。

const cloud = require('wx-server-sdk');
const https = require('https');
const { parseUid, doubanTimeToIso, cnDate, planPage, planUndo } = require('./logic');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const JOBS = 'douban_import_jobs';
const CIRCUIT_ID = '__circuit';
const PAGE_SIZE = 50;
// 同时在导的人数上限：保护云函数出口 IP，别让豆瓣把整个小程序的抓取一起封掉
const MAX_ACTIVE = 5;
const ACTIVE_WINDOW_MS = 2 * 60 * 1000;
// 豆瓣一旦拦截（要登录 / 403 / 跳转），全站暂停这么久，不重试轰炸
const CIRCUIT_MS = 30 * 60 * 1000;
// 分片与批量写，照搬 batchUpdateMarks 的取值与理由（_.in 分片 50、显式 limit 500、每批写 25）
const CHUNK = 50;
const QUERY_LIMIT = 500;
const WRITE_BATCH = 25;
const TIME_BUDGET_MS = 14000;
const STATUS_MAP = { done: 'watched', mark: 'wish' };

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.3 Mobile/15E148 Safari/604.1';

function fetchJson(url, referer) {
    return new Promise(resolve => {
        const req = https.get(url, {
            timeout: 10000,
            headers: { 'User-Agent': UA, 'Accept': 'application/json, text/plain, */*', 'Accept-Language': 'zh-CN,zh;q=0.9', 'Referer': referer }
        }, res => {
            let buf = '';
            res.setEncoding('utf8');
            res.on('data', c => { buf += c; });
            res.on('end', () => {
                let json = null;
                try { json = JSON.parse(buf); } catch (e) { /* 非 JSON 也当拦截 */ }
                resolve({ status: res.statusCode, json });
            });
        });
        req.on('timeout', () => req.destroy(new Error('timeout')));
        req.on('error', err => resolve({ status: 0, error: err.message, json: null }));
    });
}

/**
 * 读一页 interests。返回 { ok, total, entries, blocked, privateOrEmpty, error }
 * blocked = 豆瓣拦了（触发熔断）；网络超时这类偶发错误不熔断，前端重试即可。
 */
async function fetchInterests(uid, status, start) {
    const url = 'https://m.douban.com/rexxar/api/v2/user/' + encodeURIComponent(uid) +
        '/interests?type=movie&status=' + status + '&start=' + start + '&count=' + PAGE_SIZE + '&for_mobile=1';
    const r = await fetchJson(url, 'https://m.douban.com/people/' + encodeURIComponent(uid) + '/');
    if (r.status === 0) return { ok: false, error: 'NETWORK' };
    if (r.status === 404) return { ok: false, error: 'USER_NOT_FOUND' };
    const j = r.json;
    if (r.status !== 200 || !j || j.code) {
        const msg = j ? (j.msg || j.localized_message || '') : '';
        // 用户不存在 / 记录不公开 不是被拦，不熔断
        if (/not_found|不存在/.test(msg)) return { ok: false, error: 'USER_NOT_FOUND' };
        return { ok: false, blocked: true, error: 'BLOCKED', detail: r.status + ' ' + msg };
    }
    const fallback = new Date().toISOString();
    const entries = (j.interests || []).map(it => {
        const s = it && it.subject;
        if (!s || !s.id) return null;
        return { doubanId: String(s.id), status: STATUS_MAP[status], markedAt: doubanTimeToIso(it.create_time, fallback) };
    }).filter(Boolean);
    return { ok: true, total: typeof j.total === 'number' ? j.total : 0, entries, pageLen: (j.interests || []).length };
}

function isMissingCollection(err) {
    const msg = String((err && (err.errMsg || err.message)) || '');
    return (err && err.errCode === -502005) || /not exist|DATABASE_COLLECTION_NOT_EXIST/i.test(msg);
}

async function getDoc(coll, id) {
    try {
        const res = await db.collection(coll).doc(id).get();
        return res && res.data;
    } catch (e) {
        return null;
    }
}

async function circuitOpen() {
    const c = await getDoc(JOBS, CIRCUIT_ID);
    return c && c.until > Date.now() ? c : null;
}

async function tripCircuit(detail) {
    try {
        await db.collection(JOBS).doc(CIRCUIT_ID).set({ data: { until: Date.now() + CIRCUIT_MS, detail: String(detail || '').slice(0, 120), at: new Date() } });
    } catch (e) {
        console.error('[importDoubanMarks] 熔断写入失败', e);
    }
    console.error('[importDoubanMarks] 豆瓣拦截，暂停导入 30 分钟:', detail);
}

async function runInBatches(tasks, startedAt) {
    let ok = 0;
    let ran = 0;
    for (let i = 0; i < tasks.length; i += WRITE_BATCH) {
        if (Date.now() - startedAt > TIME_BUDGET_MS) break;
        const res = await Promise.all(tasks.slice(i, i + WRITE_BATCH).map(fn => fn()));
        res.forEach(v => { ok += v; });
        ran += Math.min(WRITE_BATCH, tasks.length - i);
    }
    return { ok, ran };
}

async function loadFacts(doubanIds) {
    const map = {};
    for (let i = 0; i < doubanIds.length; i += CHUNK) {
        const res = await db.collection('movie_facts')
            .where({ _id: _.in(doubanIds.slice(i, i + CHUNK)) })
            .field({ _id: true, movieIds: true, memberOf: true })
            .limit(CHUNK)
            .get();
        (res.data || []).forEach(f => { map[f._id] = f; });
    }
    return map;
}

async function loadExisting(openid, movieIds) {
    const map = {};
    for (let i = 0; i < movieIds.length; i += CHUNK) {
        const res = await db.collection('Marks')
            .where({ openid, movieId: _.in(movieIds.slice(i, i + CHUNK)) })
            .field({ _id: true, movieId: true, status: true, marked_at: true })
            .limit(QUERY_LIMIT)
            .get();
        (res.data || []).forEach(m => {
            const prev = map[m.movieId];
            // 和 dataLoader.processMarks 一致：同一部有重复记录时以最新那条为准
            if (!prev || new Date(m.marked_at) > new Date(prev.marked_at)) map[m.movieId] = m;
        });
    }
    return map;
}

async function ownedJob(importId, openid) {
    if (!importId || importId === CIRCUIT_ID) return null;
    const job = await getDoc(JOBS, importId);
    return job && job.openid === openid ? job : null;
}

function emptyCounters() {
    return { read: 0, matched: 0, unmatched: 0, added: 0, upgraded: 0, skipped: 0, top250: 0, rows: 0 };
}

// ── actions ──

async function preview(event) {
    const uid = parseUid(event.uid);
    if (!uid) return { success: false, code: 'BAD_UID', error: '没认出豆瓣主页链接或 ID' };
    if (await circuitOpen()) return { success: false, code: 'PAUSED', error: '豆瓣暂时访问受限，请过半小时再试' };
    const done = await fetchInterests(uid, 'done', 0);
    if (!done.ok) {
        if (done.blocked) await tripCircuit(done.detail);
        return { success: false, code: done.error, error: done.error === 'USER_NOT_FOUND' ? '找不到这个豆瓣用户' : '读取豆瓣失败，请稍后再试' };
    }
    const wish = await fetchInterests(uid, 'mark', 0);
    return { success: true, uid, doneTotal: done.total, wishTotal: wish.ok ? wish.total : 0 };
}

async function start(event, openid) {
    const statuses = (Array.isArray(event.statuses) ? event.statuses : ['done']).filter(s => STATUS_MAP[s]);
    if (!statuses.length) return { success: false, code: 'BAD_ARGS', error: '至少选一项' };
    if (await circuitOpen()) return { success: false, code: 'PAUSED', error: '豆瓣暂时访问受限，请过半小时再试' };
    const today = cnDate(Date.now());

    let todays = [];
    try {
        const res = await db.collection(JOBS).where({ openid, date: today }).limit(20).get();
        todays = res.data || [];
    } catch (err) {
        if (!isMissingCollection(err)) throw err;
        try { await db.createCollection(JOBS); } catch (e) { /* 并发时可能已建 */ }
    }
    const running = todays.find(j => j.status === 'running');
    if (running) return { success: true, resumed: true, importId: running._id, statuses: running.statuses, cursors: running.cursors, counters: running.counters };
    if (todays.some(j => j.status === 'done')) return { success: false, code: 'DAILY_LIMIT', error: '今天已经导入过了，明天再来补新标记吧' };

    const since = new Date(Date.now() - ACTIVE_WINDOW_MS);
    const active = await db.collection(JOBS).where({ status: 'running', updatedAt: _.gt(since) }).count();
    if (active.total >= MAX_ACTIVE) return { success: false, code: 'BUSY', error: '现在导入的人有点多，过几分钟再试' };

    const cursors = {};
    statuses.forEach(s => { cursors[s] = 0; });
    const now = new Date();
    const doc = { openid, date: today, status: 'running', statuses, cursors, counters: emptyCounters(), createdAt: now, updatedAt: now };
    const added = await db.collection(JOBS).add({ data: doc });
    return { success: true, resumed: false, importId: added._id, statuses, cursors, counters: doc.counters };
}

async function page(event, openid) {
    const startedAt = Date.now();
    const uid = parseUid(event.uid);
    const status = STATUS_MAP[event.status] ? event.status : '';
    const startAt = Math.max(0, parseInt(event.start, 10) || 0);
    if (!uid || !status) return { success: false, code: 'BAD_ARGS', error: '参数不完整' };
    const job = await ownedJob(event.importId, openid);
    if (!job || job.status !== 'running') return { success: false, code: 'NO_JOB', error: '这次导入已结束，请重新开始' };
    if (await circuitOpen()) return { success: false, code: 'PAUSED', error: '豆瓣暂时访问受限，请过半小时再试' };

    const r = await fetchInterests(uid, status, startAt);
    if (!r.ok) {
        if (r.blocked) {
            await tripCircuit(r.detail);
            await db.collection(JOBS).doc(job._id).update({ data: { status: 'blocked', updatedAt: new Date() } });
            return { success: false, code: 'PAUSED', error: '豆瓣暂时访问受限，已导入的部分保留，请过半小时再试' };
        }
        return { success: false, code: r.error, error: '读取豆瓣失败，请重试' };
    }

    const doubanIds = r.entries.map(e => e.doubanId);
    const facts = doubanIds.length ? await loadFacts(doubanIds) : {};
    const movieIds = [];
    Object.keys(facts).forEach(k => (facts[k].movieIds || []).forEach(id => movieIds.push(id)));
    const existing = movieIds.length ? await loadExisting(openid, movieIds) : {};
    const plan = planPage(r.entries, facts, existing, job._id);

    const tasks = plan.adds.map(row => () => db.collection('Marks').add({ data: Object.assign({ openid }, row) })
        .then(() => 1).catch(err => { console.error('新增失败', row.movieId, err && err.errMsg); return 0; }))
        .concat(plan.upgrades.map(u => () => db.collection('Marks').doc(u._id).update({ data: u.data })
            .then(() => 1).catch(err => { console.error('升级失败', u.movieId, err && err.errMsg); return 0; })));
    const w = await runInBatches(tasks, startedAt);
    const failed = tasks.length - w.ok;

    // 这一页没写完就不推进游标：前端重试同一页，已写的会因「已有标记」被跳过，不会重复
    const pageDone = failed === 0;
    // 按总数判断读没读完、固定步长翻页：豆瓣会跳过已下架的条目，一页常常只回 49 条，
    // 拿「不满 50 条」当读完会在第一页就停下
    const nextStart = r.pageLen === 0 || startAt + PAGE_SIZE >= r.total ? null : startAt + PAGE_SIZE;
    if (pageDone) {
        const inc = {};
        inc['counters.read'] = _.inc(r.entries.length);
        Object.keys(plan.films).forEach(k => { inc['counters.' + k] = _.inc(plan.films[k]); });
        inc['counters.rows'] = _.inc(w.ok);
        inc['cursors.' + status] = nextStart == null ? -1 : nextStart;   // -1 = 这个状态读完了
        inc.updatedAt = new Date();
        await db.collection(JOBS).doc(job._id).update({ data: inc });
    }
    return {
        success: pageDone, code: pageDone ? '' : 'PARTIAL', error: pageDone ? '' : '有部分标记没写成功，正在重试',
        status, start: startAt, total: r.total, read: r.entries.length,
        nextStart: pageDone ? nextStart : startAt,
        films: plan.films, rows: w.ok, ms: Date.now() - startedAt
    };
}

async function finish(event, openid) {
    const job = await ownedJob(event.importId, openid);
    if (!job) return { success: false, code: 'NO_JOB', error: '找不到这次导入' };
    if (job.status === 'running') {
        await db.collection(JOBS).doc(job._id).update({ data: { status: 'done', finishedAt: new Date(), updatedAt: new Date() } });
    }
    return { success: true, importId: job._id, counters: job.counters };
}

async function undo(event, openid) {
    const startedAt = Date.now();
    const job = await ownedJob(event.importId, openid);
    if (!job) return { success: false, code: 'NO_JOB', error: '找不到这次导入' };
    const res = await db.collection('Marks').where({ openid, importId: job._id }).limit(200).get();
    const docs = res.data || [];
    const plan = planUndo(docs);
    const clearFields = { source: _.remove(), importId: _.remove(), importStatus: _.remove(), prevStatus: _.remove(), prevMarkedAt: _.remove() };
    const tasks = plan.removes.map(id => () => db.collection('Marks').doc(id).remove().then(() => 1).catch(() => 0))
        .concat(plan.restores.map(r => () => db.collection('Marks').doc(r._id).update({ data: Object.assign({}, r.data, clearFields) }).then(() => 1).catch(() => 0)));
    // 被用户改过的记录保留，但摘掉 importId，否则每次撤销都会再查到它们、remaining 永远不归零
    const keptIds = docs.filter(d => d.status !== d.importStatus).map(d => d._id);
    keptIds.forEach(id => tasks.push(() => db.collection('Marks').doc(id).update({ data: { importId: _.remove(), importStatus: _.remove() } }).then(() => 1).catch(() => 0)));
    const w = await runInBatches(tasks, startedAt);
    const remaining = docs.length === 200 || w.ran < tasks.length;
    if (!remaining) await db.collection(JOBS).doc(job._id).update({ data: { status: 'undone', undoneAt: new Date(), updatedAt: new Date() } });
    return { success: true, removed: plan.removes.length, restored: plan.restores.length, kept: plan.kept, remaining };
}

async function stats() {
    const $ = db.command.aggregate;
    const res = await db.collection(JOBS).aggregate()
        .match({ _id: _.neq(CIRCUIT_ID) })
        .group({ _id: '$status', jobs: $.sum(1), read: $.sum('$counters.read'), matched: $.sum('$counters.matched'), top250: $.sum('$counters.top250'), rows: $.sum('$counters.rows') })
        .end();
    return { success: true, byStatus: res.list, circuit: await getDoc(JOBS, CIRCUIT_ID) };
}

exports.main = async (event = {}) => {
    const { OPENID } = cloud.getWXContext();
    const action = event.action || '';
    try {
        if (action === 'stats') return await stats();
        if (action === 'resetCircuit') { await db.collection(JOBS).doc(CIRCUIT_ID).remove().catch(() => {}); return { success: true }; }
        if (action === 'preview') return await preview(event);
        if (!OPENID) return { success: false, code: 'NO_OPENID', error: '请在小程序内使用' };
        if (action === 'start') return await start(event, OPENID);
        if (action === 'page') return await page(event, OPENID);
        if (action === 'finish') return await finish(event, OPENID);
        if (action === 'undo') return await undo(event, OPENID);
        return { success: false, code: 'BAD_ACTION', error: '未知操作' };
    } catch (err) {
        console.error('[importDoubanMarks]', action, err);
        return { success: false, code: 'ERROR', error: '出错了，请稍后再试' };
    }
};
