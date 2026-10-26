// 云函数：customList —— 用户自建影单 / 书单（单一入口，action 分发，同 syncDailyLog 的写法）
//
// 集合 custom_lists，一份清单一个文档（_id 由数据库生成，不含 openid，分享链接里带 listId 不泄露身份）：
//   { openid, type: 'movie'|'book', title, items: [Item], count, rev, createdAt, updatedAt }
//   Item = { _id, title, year, cover, rating, ratingCount, director|author, country, doubanId, from, markSource, addedAt }
//   items 数组顺序即展示顺序（新加的排在后面），读出时按下标补 rank。
//
// 条目 _id 是标记能否「跨榜单互通」的关键：
//   - 从已有榜单加入：沿用该榜单条目原 _id —— Marks/BookMarks 里已有的标记直接显示，
//     在自建清单里标记也就是标记了那个榜单条目（movie_alias 还会继续扩散到其它榜单）。
//   - 搜索加入的电影：先查 movie_facts（_id=doubanId，buildMovieFacts 产出）里有没有这部片，
//     有就借用它在某个榜单里的 _id；没有才用 `cm_<doubanId>`。书没有这类索引，一律 `cb_<doubanId>`。
//
// 配额：每人每种类型 QUOTA 份（默认各 1 份），每份上限 MAX_ITEMS 条。
// 写入一律「读-改-写 + rev 乐观锁」：where({_id, rev}) 命中 0 条说明被并发改过，重读重试。
//
// action（openid 一律取 wxContext，不接受前端传参）：
//   mine                          —— 我的清单概要（两种类型），供入口页
//   create   { type, title }
//   rename   { listId, title }
//   addItems { listId, items }    —— 去重 + 截到剩余容量；返回 added / skipped / overflow
//   removeItems { listId, ids }
//   moveItem { listId, id, to: 'top'|'up'|'down' }
//   remove   { listId }           —— 删除整份清单（不动标记记录）
//   get（缺省）{ listId, openid, marksOnly } —— 列表页读路径，形状对齐 getThemeMovies
//                                  （{ success, movies, marks, listVersion }）+ list 元信息；任何人可读（分享）
const cloud = require('wx-server-sdk');
const axios = require('axios');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

const COLLECTION = 'custom_lists';
const QUOTA = { movie: 1, book: 1 };
const MAX_ITEMS = 200;
const TITLE_MAX = 20;
const MAX_LIMIT = 100;
const COVER_DIR = 'custom_list_covers';
const TYPES = ['movie', 'book'];
const DEFAULT_TITLE = { movie: '我的影单', book: '我的书单' };

const clip = (v, n) => String(v == null ? '' : v).trim().slice(0, n);
const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);

async function readAll(query) {
    const countRes = await query.count();
    const total = countRes.total;
    if (total === 0) return [];
    const tasks = [];
    for (let i = 0; i < Math.ceil(total / MAX_LIMIT); i++) {
        tasks.push(query.skip(i * MAX_LIMIT).limit(MAX_LIMIT).get());
    }
    const results = await Promise.all(tasks);
    return results.reduce((acc, r) => acc.concat(r.data), []);
}

async function ensureCollection() {
    try { await db.createCollection(COLLECTION); } catch (e) { /* 已存在 */ }
}

async function getDoc(listId) {
    if (!listId) return null;
    try {
        const res = await db.collection(COLLECTION).doc(String(listId)).get();
        return res && res.data;
    } catch (e) {
        return null;
    }
}

async function getOwnDoc(listId, openid) {
    const doc = await getDoc(listId);
    if (!doc) throw codeErr('NOT_FOUND', '清单不存在');
    if (doc.openid !== openid) throw codeErr('FORBIDDEN', '只能修改自己的清单');
    return doc;
}

function codeErr(code, message) {
    const e = new Error(message);
    e.code = code;
    return e;
}

// 乐观锁写：mutate(doc) 返回要 set 的字段（或抛错）；冲突时重读重试
async function mutateList(listId, openid, mutate) {
    for (let attempt = 0; attempt < 4; attempt++) {
        const doc = await getOwnDoc(listId, openid);
        const rev = doc.rev || 0;
        const patch = await mutate(doc);
        if (!patch) return { doc, changed: false };
        const res = await db.collection(COLLECTION)
            .where({ _id: doc._id, rev })
            .update({ data: { ...patch, rev: rev + 1, updatedAt: new Date() } });
        if (res.stats && res.stats.updated === 1) return { doc: { ...doc, ...patch, rev: rev + 1 }, changed: true };
    }
    throw codeErr('CONFLICT', '操作太频繁，请稍后再试');
}

// 豆瓣图床有防盗链，小程序 <image> / 海报 canvas 都加载不了直链：搜索加入的封面转存云存储。
// 失败原样返回，不阻塞加入。榜单加入的封面本来就是榜单页能显示的值，不转存。
async function mirrorCover(url, doubanId, type) {
    if (!url || typeof url !== 'string' || !/^https?:\/\/[^/]*\bdoubanio\.com/i.test(url)) return url;
    try {
        // webp 在 iOS <image> 空白：豆瓣同路径换 .jpg 即可拿到 jpg
        const resp = await axios.get(url.replace(/\.webp(\?.*)?$/i, '.jpg'), {
            responseType: 'arraybuffer',
            timeout: 8000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.3 Mobile/15E148 Safari/604.1',
                'Referer': type === 'book' ? 'https://book.douban.com/' : 'https://movie.douban.com/'
            }
        });
        const up = await cloud.uploadFile({
            cloudPath: `${COVER_DIR}/${type}_${doubanId || Date.now()}.jpg`,
            fileContent: Buffer.from(resp.data)
        });
        return (up && up.fileID) || url;
    } catch (e) {
        console.warn('[customList] 封面转存失败，保留原值:', e && e.message);
        return url;
    }
}

function sanitizeItem(raw, type) {
    const doubanId = clip(raw.doubanId, 20).replace(/\D/g, '');
    const item = {
        _id: clip(raw._id || raw.id, 120),
        title: clip(raw.title, 80),
        year: clip(raw.year, 10),
        cover: clip(raw.cover, 400),
        rating: num(raw.rating) > 0 && num(raw.rating) <= 10 ? num(raw.rating) : 0,
        ratingCount: Math.max(0, Math.floor(num(raw.ratingCount))),
        doubanId,
        from: clip(raw.from, 40) || 'search',
        addedAt: Date.now()
    };
    if (type === 'book') {
        item.author = clip(raw.author, 60);
        item.publisher = clip(raw.publisher, 60);
        // 书的标记按 source 区分来源（豆瓣读书老页面只认 source=douban），沿用原榜单的 source
        item.markSource = clip(raw.markSource, 40) || 'custom';
    } else {
        item.director = clip(raw.director, 60);
        item.country = clip(raw.country, 40);
    }
    return item;
}

// 搜索加入的条目补 _id / 封面
async function resolveSearchItem(item, type) {
    if (type === 'movie') {
        if (item.doubanId) {
            try {
                const res = await db.collection('movie_facts').doc(item.doubanId).get();
                const facts = res && res.data;
                if (facts && Array.isArray(facts.movieIds) && facts.movieIds.length) item._id = String(facts.movieIds[0]);
                if (facts && facts.cover && /^cloud:\/\//.test(facts.cover)) item.cover = facts.cover;
            } catch (e) { /* 片库里没有这部：正常 */ }
        }
        if (!item._id) item._id = `cm_${item.doubanId}`;
    } else if (!item._id) {
        item._id = `cb_${item.doubanId}`;
    }
    item.cover = await mirrorCover(item.cover, item.doubanId, type);
    return item;
}

function summarize(doc) {
    const items = doc.items || [];
    return {
        _id: doc._id,
        type: doc.type,
        title: doc.title,
        count: items.length,
        max: MAX_ITEMS,
        covers: items.slice(0, 4).map(i => i.cover).filter(Boolean),
        updatedAt: doc.updatedAt
    };
}

const actions = {
    async mine({ openid }) {
        const docs = await readAll(db.collection(COLLECTION).where({ openid }));
        const lists = docs
            .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
            .map(summarize);
        return { success: true, lists, quota: QUOTA, maxItems: MAX_ITEMS };
    },

    async create({ openid, event }) {
        const type = event.type;
        if (!TYPES.includes(type)) return { success: false, error: '未知清单类型' };
        await ensureCollection();
        const count = (await db.collection(COLLECTION).where({ openid, type }).count()).total;
        if (count >= QUOTA[type]) {
            return { success: false, code: 'QUOTA', error: `每人只能创建 ${QUOTA[type]} 份${type === 'book' ? '书单' : '影单'}` };
        }
        const title = clip(event.title, TITLE_MAX) || DEFAULT_TITLE[type];
        const now = new Date();
        const res = await db.collection(COLLECTION).add({
            data: { openid, type, title, items: [], count: 0, rev: 0, createdAt: now, updatedAt: now }
        });
        return { success: true, listId: res._id, list: { _id: res._id, type, title, count: 0, max: MAX_ITEMS, covers: [] } };
    },

    async rename({ openid, event }) {
        const title = clip(event.title, TITLE_MAX);
        if (!title) return { success: false, error: '标题不能为空' };
        await mutateList(event.listId, openid, doc => (doc.title === title ? null : { title }));
        return { success: true, title };
    },

    async addItems({ openid, event }) {
        const incoming = Array.isArray(event.items) ? event.items.slice(0, MAX_ITEMS) : [];
        if (!incoming.length) return { success: false, error: '没有要加入的条目' };
        const doc0 = await getOwnDoc(event.listId, openid);
        const type = doc0.type;
        let prepared = incoming.map(raw => sanitizeItem(raw || {}, type)).filter(i => i.title && (i._id || i.doubanId));
        // 只为「放得下且不重复」的搜索条目做慢操作（查片库 / 转存封面）
        const seenIds = new Set((doc0.items || []).map(i => i._id));
        const seenDouban = new Set((doc0.items || []).map(i => i.doubanId).filter(Boolean));
        const room = MAX_ITEMS - (doc0.items || []).length;
        const fresh = [];
        prepared.forEach(i => {
            if ((i._id && seenIds.has(i._id)) || (i.doubanId && seenDouban.has(i.doubanId))) return;
            if (i._id) seenIds.add(i._id);
            if (i.doubanId) seenDouban.add(i.doubanId);
            fresh.push(i);
        });
        const accepted = fresh.slice(0, Math.max(0, room));
        await Promise.all(accepted.map(i => (i.from === 'search' ? resolveSearchItem(i, type) : i)));

        let added = 0;
        const out = await mutateList(event.listId, openid, doc => {
            const items = (doc.items || []).slice();
            const ids = new Set(items.map(i => i._id));
            const dids = new Set(items.map(i => i.doubanId).filter(Boolean));
            added = 0;
            accepted.forEach(i => {
                if (items.length >= MAX_ITEMS) return;
                if (ids.has(i._id) || (i.doubanId && dids.has(i.doubanId))) return;
                items.push(i);
                ids.add(i._id);
                if (i.doubanId) dids.add(i.doubanId);
                added++;
            });
            if (!added) return null;
            return { items, count: items.length };
        });
        const finalCount = (out.doc.items || []).length;
        return {
            success: true,
            added: out.changed ? added : 0,
            skipped: prepared.length - fresh.length,
            overflow: Math.max(0, fresh.length - accepted.length),
            count: finalCount,
            max: MAX_ITEMS,
            addedIds: accepted.map(i => i._id)
        };
    },

    async removeItems({ openid, event }) {
        const ids = new Set((Array.isArray(event.ids) ? event.ids : []).map(String));
        if (!ids.size) return { success: false, error: '没有要移除的条目' };
        const out = await mutateList(event.listId, openid, doc => {
            const items = (doc.items || []).filter(i => !ids.has(String(i._id)));
            return items.length === (doc.items || []).length ? null : { items, count: items.length };
        });
        return { success: true, count: (out.doc.items || []).length };
    },

    async moveItem({ openid, event }) {
        const id = String(event.id || '');
        await mutateList(event.listId, openid, doc => {
            const items = (doc.items || []).slice();
            const idx = items.findIndex(i => String(i._id) === id);
            if (idx < 0) return null;
            const to = event.to === 'top' ? 0 : event.to === 'up' ? idx - 1 : idx + 1;
            if (to < 0 || to >= items.length || to === idx) return null;
            const [it] = items.splice(idx, 1);
            items.splice(to, 0, it);
            return { items };
        });
        return { success: true };
    },

    async remove({ openid, event }) {
        const doc = await getOwnDoc(event.listId, openid);
        await db.collection(COLLECTION).doc(doc._id).remove();
        return { success: true };
    },

    async get({ openid: callerOpenid, event }) {
        const doc = await getDoc(event.listId);
        if (!doc) return { success: false, code: 'NOT_FOUND', error: '清单不存在或已删除', movies: [], marks: [] };
        const marksCollection = doc.type === 'book' ? 'BookMarks' : 'Marks';
        // 标记只读调用者自己的（列表页传的 openid 必须等于真实身份，防止读别人的标记）
        const openid = event.openid && event.openid === callerOpenid ? callerOpenid : '';
        const marks = openid ? await readAll(db.collection(marksCollection).where({ openid })) : [];
        const listVersion = `${doc._id}:${doc.rev || 0}`;
        if (event.marksOnly) return { success: true, movies: [], marks, listVersion };
        const movies = (doc.items || []).map((it, i) => ({ ...it, rank: i + 1 }));
        return {
            success: true,
            movies,
            marks,
            listVersion,
            list: { _id: doc._id, type: doc.type, title: doc.title, count: movies.length, max: MAX_ITEMS, isOwner: doc.openid === callerOpenid }
        };
    }
};

exports.main = async (event = {}) => {
    const { OPENID } = cloud.getWXContext();
    const action = event.action || 'get';
    const fn = actions[action];
    if (!fn) return { success: false, error: `未知 action: ${action}` };
    if (action !== 'get' && !OPENID) return { success: false, error: '未获取到用户身份' };
    try {
        return await fn({ openid: OPENID, event });
    } catch (err) {
        console.error(`[customList] ${action} 失败:`, err);
        return { success: false, code: err.code || 'ERROR', error: err.message, movies: [], marks: [] };
    }
};
