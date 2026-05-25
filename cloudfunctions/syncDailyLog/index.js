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
//   action: 'getToday' | 'addEntry' | 'removeEntry' | 'setGoal' | 'setPresets' | 'getRange'
//   theme:  'water' | 'milktea' | ...

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

// 主题默认值（与前端 utils/dailyThemes.js 保持一致；这里只放最小集合，用于无设置时兜底）
const THEME_DEFAULTS = {
    water:   { unit: 'ml',  daily_goal: 2000, presets: [200, 350, 500] },
    milktea: { unit: '杯', daily_goal: 1,    presets: [1] }
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
    } else {
        const next = mutate({ openid, theme, date, total_value: 0, entries: [], unit });
        const res = await db.collection('DailyLogs').add({
            data: { ...next, updated_at: now, created_at: now }
        });
        return { _id: res._id, ...next, updated_at: now };
    }
}

exports.main = async (event, context) => {
    const wxContext = cloud.getWXContext();
    const openid = wxContext.OPENID;
    const action = event.action;
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
            const entry = { ts: Date.now(), value: v, meta };
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

        if (action === 'setGoal') {
            const { daily_goal } = event;
            const v = Number(daily_goal);
            if (!Number.isFinite(v) || v < 0 || v > 100000) {
                return { success: false, error: 'daily_goal 越界' };
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

        return { success: false, error: '未知 action: ' + action };
    } catch (err) {
        console.error('syncDailyLog 失败:', err);
        return { success: false, error: err.message, stack: err.stack };
    }
};
