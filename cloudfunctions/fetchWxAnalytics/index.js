// 小程序官方统计数据只读拉取（控制台跑，前端不调）
//
// 数据来自微信「数据分析」接口（datacube），走云调用 cloud.openapi.analysis.*，不需要 access_token / AppSecret。
// 口径和小程序后台「统计」页一致：只到昨天，按北京日期。
//
// 入参：
//   {}                                   —— 默认最近 30 天（截止昨天），全部板块
//   { days: 14 }                         —— 窗口天数，1~60
//   { endDate: '20261030' }              —— 截止日（含），默认昨天
//   { parts: ['trend', 'pages'] }        —— 只拉部分板块，可选：
//        trend        每日访问趋势 + 每日概况（累计用户、分享）
//        retain       每日新增/活跃的次日留存
//        weekly       最近 4 个自然周的访问趋势 + 周留存（0~4 周后）
//        monthly      最近 3 个自然月的访问趋势 + 月留存
//        pages        页面访问（窗口内按页面汇总）
//        distribution 访问来源 / 停留时长 / 访问深度分布（窗口内汇总）
//        portrait     用户画像（最近 30 天：地区、性别、年龄、平台、机型）
//   { wedata: [{ chart_id: '1000102006', target_id: 'T001', time_unit: 0 }] }
//        —— 另拉 We分析 图表（自定义事件等）。要先在 We分析 里给图表开「API 拉取」，
//           并在本函数环境变量里配 WX_APPSECRET（不配就跳过、不报错）。日粒度跨度上限 7 天。
//
// 出参只有聚合数字，不含任何 openid。单个接口失败只记进 errors，不影响其他板块。

const cloud = require('wx-server-sdk');
const https = require('https');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const CN_TZ_OFFSET_MS = 8 * 60 * 60 * 1000;
const CONCURRENCY = 3;
const DEFAULT_APPID = 'wx52ad9bb6303e6af1';
const ALL_PARTS = ['trend', 'retain', 'weekly', 'monthly', 'pages', 'distribution', 'portrait'];

// getVisitDistribution 的 access_source_session_cnt 用的是「来源」编号，不是场景值
const SOURCE_NAMES = {
    1: '小程序历史列表', 2: '搜索', 3: '会话', 4: '扫一扫二维码', 5: '公众号主页', 6: '聊天顶部',
    7: '系统桌面', 8: '小程序主页', 9: '附近的小程序', 10: '其他', 11: '模板消息', 13: '公众号菜单',
    14: 'APP分享', 15: '支付完成页', 16: '长按识别二维码', 17: '相册选取二维码', 18: '公众号文章',
    19: '钱包', 20: '卡包', 21: '小程序内卡券', 22: '其他小程序', 23: '其他小程序返回',
    24: '卡券适用门店列表', 25: '搜索框快捷入口', 26: '小程序客服消息', 27: '公众号下发',
    28: '系统会话菜单', 29: '任务栏-最近使用', 30: '长按小程序菜单圆点', 31: '连wifi成功页',
    32: '城市服务', 33: '微信广告', 34: '其他移动应用', 35: '发现入口-我的小程序',
    36: '任务栏-我的小程序', 37: '微信圈子', 38: '手机充值', 39: 'H5', 40: '插件', 41: '大家在用',
    42: '发现页', 43: '浮窗', 44: '附近的人', 45: '看一看', 46: '朋友圈', 47: '企业微信', 48: '视频',
    49: '收藏', 50: '微信红包', 51: '微信游戏中心', 52: '摇一摇', 53: '公众号导购消息', 54: '识物',
    55: '小程序订单', 56: '小程序直播', 57: '群工具'
};
const STAYTIME_NAMES = { 1: '0-2s', 2: '3-5s', 3: '6-10s', 4: '11-20s', 5: '20-30s', 6: '30-50s', 7: '50-100s', 8: '>100s' };
const DEPTH_NAMES = { 1: '1页', 2: '2页', 3: '3页', 4: '4页', 5: '5页', 6: '6-10页', 7: '>10页' };

// ── 日期（YYYYMMDD，北京时间） ──
function ymd(ms) {
    const d = new Date(ms + CN_TZ_OFFSET_MS);
    const p = n => (n < 10 ? '0' : '') + n;
    return '' + d.getUTCFullYear() + p(d.getUTCMonth() + 1) + p(d.getUTCDate());
}
function parseYmd(s) {
    return Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8)) - CN_TZ_OFFSET_MS;
}
function addDays(s, n) {
    return ymd(parseYmd(s) + n * 86400000);
}
function dateRange(end, days) {
    const out = [];
    for (let i = days - 1; i >= 0; i--) out.push(addDays(end, -i));
    return out;
}
// 截止 end 的最近 n 个完整自然周（周一~周日）
function lastWeeks(end, n) {
    const dow = (new Date(parseYmd(end) + CN_TZ_OFFSET_MS).getUTCDay() + 6) % 7; // 周一 = 0
    let sunday = dow === 6 ? end : addDays(end, -(dow + 1));
    const out = [];
    for (let i = 0; i < n; i++) {
        out.unshift({ begin: addDays(sunday, -6), end: sunday });
        sunday = addDays(sunday, -7);
    }
    return out;
}
// 截止 end 的最近 n 个完整自然月
function lastMonths(end, n) {
    const nextDay = addDays(end, 1);
    let y = +end.slice(0, 4);
    let m = +end.slice(4, 6);
    if (nextDay.slice(6, 8) !== '01') m -= 1; // end 不是月末 → 本月不完整
    const out = [];
    for (let i = 0; i < n; i++) {
        if (m < 1) { m += 12; y -= 1; }
        const first = '' + y + (m < 10 ? '0' : '') + m + '01';
        const last = addDays(m === 12 ? (y + 1) + '0101' : '' + y + (m + 1 < 10 ? '0' : '') + (m + 1) + '01', -1);
        out.unshift({ begin: first, end: last });
        m -= 1;
    }
    return out;
}

// ── 调用工具 ──
async function pool(items, worker) {
    const out = new Array(items.length);
    let next = 0;
    async function run() {
        while (next < items.length) {
            const i = next++;
            out[i] = await worker(items[i], i);
        }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, run));
    return out;
}

// 61504 = 微信侧限流「system busy」，并发一高就会冒，退避重试即可
const RETRY_CODES = [61504, -1, 45009];
const sleep = ms => new Promise(r => setTimeout(r, ms));

function makeCaller(errors) {
    return async function call(api, params) {
        for (let attempt = 0; ; attempt++) {
            try {
                return await cloud.openapi.analysis[api](params);
            } catch (err) {
                if (attempt < 4 && RETRY_CODES.indexOf(err.errCode) >= 0 && err.errCode !== 45009) {
                    await sleep(600 * (attempt + 1) + Math.random() * 400);
                    continue;
                }
                errors.push({ api, params, code: err.errCode, msg: String(err.errMsg || err.message).slice(0, 160) });
                return null;
            }
        }
    };
}

function first(res) {
    return res && Array.isArray(res.list) && res.list.length ? res.list[0] : null;
}
function round(n, d) {
    const k = Math.pow(10, d || 0);
    return Math.round(n * k) / k;
}
function retainOf(list, key) {
    const hit = (list || []).find(x => x.key === key);
    return hit ? hit.value : null;
}

// ── 各板块 ──
async function fetchTrend(call, dates) {
    const rows = await pool(dates, async d => {
        const [trend, summary] = await Promise.all([
            call('getDailyVisitTrend', { beginDate: d, endDate: d }),
            call('getDailySummary', { beginDate: d, endDate: d })
        ]);
        const t = first(trend) || {};
        const s = first(summary) || {};
        return [d, t.visitUv || 0, t.visitUvNew || 0, t.visitPv || 0, t.sessionCnt || 0,
            round(t.stayTimeUv || 0, 1), round(t.stayTimeSession || 0, 1), round(t.visitDepth || 0, 2),
            s.visitTotal || 0, s.shareUv || 0, s.sharePv || 0];
    });
    return {
        header: ['date', 'uv', 'uvNew', 'pv', 'sessions', 'stayPerUvSec', 'stayPerSessionSec', 'depth', 'totalUsers', 'shareUv', 'sharePv'],
        rows
    };
}

async function fetchRetain(call, dates) {
    const rows = await pool(dates, async d => {
        const r = await call('getDailyRetain', { beginDate: d, endDate: d });
        if (!r) return [d, null, null, null, null];
        return [d, retainOf(r.visitUvNew, 0), retainOf(r.visitUvNew, 1), retainOf(r.visitUv, 0), retainOf(r.visitUv, 1)];
    });
    return { header: ['date', 'new', 'newDay1', 'active', 'activeDay1'], rows };
}

function periodRows(trendRes, retainRes, p) {
    const t = first(trendRes) || {};
    const r = retainRes || {};
    return {
        begin: p.begin, end: p.end,
        uv: t.visitUv || 0, uvNew: t.visitUvNew || 0, pv: t.visitPv || 0, sessions: t.sessionCnt || 0,
        stayPerUvSec: round(t.stayTimeUv || 0, 1), depth: round(t.visitDepth || 0, 2),
        newRetain: (r.visitUvNew || []).map(x => x.value),   // 下标 = 0、1、2… 个周期后
        activeRetain: (r.visitUv || []).map(x => x.value)
    };
}

async function fetchPeriods(call, periods, trendApi, retainApi) {
    return pool(periods, async p => {
        const q = { beginDate: p.begin, endDate: p.end };
        const [t, r] = await Promise.all([call(trendApi, q), call(retainApi, q)]);
        return periodRows(t, r, p);
    });
}

async function fetchPages(call, dates) {
    const byPath = {};
    const lists = await pool(dates, d => call('getVisitPage', { beginDate: d, endDate: d }));
    let daysWithData = 0;
    lists.forEach(res => {
        if (!res || !Array.isArray(res.list)) return;
        daysWithData++;
        res.list.forEach(x => {
            const k = x.pagePath;
            const a = byPath[k] || (byPath[k] = { pv: 0, uvSum: 0, staySec: 0, entry: 0, exit: 0, sharePv: 0, shareUvSum: 0 });
            a.pv += x.pageVisitPv || 0;
            a.uvSum += x.pageVisitUv || 0;
            a.staySec += (x.pageStaytimePv || 0) * (x.pageVisitPv || 0);
            a.entry += x.entrypagePv || 0;
            a.exit += x.exitpagePv || 0;
            a.sharePv += x.pageSharePv || 0;
            a.shareUvSum += x.pageShareUv || 0;
        });
    });
    const rows = Object.keys(byPath).map(k => {
        const a = byPath[k];
        return [k, a.pv, a.uvSum, a.pv ? round(a.staySec / a.pv, 1) : 0, a.entry, a.exit,
            a.pv ? round(a.exit / a.pv, 3) : 0, a.sharePv, a.shareUvSum];
    }).sort((x, y) => y[1] - x[1]);
    return {
        note: 'uvSum/shareUvSum 是每日 UV 相加，不是窗口内去重人数；exitRate = 退出次数 / 访问次数',
        daysWithData,
        header: ['page', 'pv', 'uvSum', 'staySecPerPv', 'entryPv', 'exitPv', 'exitRate', 'sharePv', 'shareUvSum'],
        rows: rows.slice(0, 80)
    };
}

async function fetchDistribution(call, dates) {
    const acc = {};
    const lists = await pool(dates, d => call('getVisitDistribution', { beginDate: d, endDate: d }));
    lists.forEach(res => {
        if (!res || !Array.isArray(res.list)) return;
        res.list.forEach(block => {
            const m = acc[block.index] || (acc[block.index] = {});
            (block.itemList || []).forEach(it => { m[it.key] = (m[it.key] || 0) + (it.value || 0); });
        });
    });
    function named(index, names) {
        const m = acc[index] || {};
        const total = Object.keys(m).reduce((s, k) => s + m[k], 0);
        return Object.keys(m).map(k => [names[k] || ('#' + k), m[k], total ? round(m[k] / total, 4) : 0])
            .sort((a, b) => b[1] - a[1]);
    }
    return {
        header: ['name', 'value', 'share'],
        sourceSessions: named('access_source_session_cnt', SOURCE_NAMES),
        sourceVisitUv: named('access_source_visit_uv', SOURCE_NAMES),
        staytime: named('access_staytime_info', STAYTIME_NAMES),
        depth: named('access_depth_info', DEPTH_NAMES)
    };
}

function trimDim(list, top) {
    return (list || []).map(x => [x.name || ('#' + x.id), x.value || 0])
        .sort((a, b) => b[1] - a[1]).slice(0, top || 20);
}
function trimPortrait(block) {
    if (!block) return null;
    return {
        province: trimDim(block.province, 15), city: trimDim(block.city, 15),
        genders: trimDim(block.genders), platforms: trimDim(block.platforms),
        devices: trimDim(block.devices, 12), ages: trimDim(block.ages)
    };
}
async function fetchPortrait(call, end) {
    const res = await call('getUserPortrait', { beginDate: addDays(end, -29), endDate: end });
    if (!res) return null;
    return { refDate: res.refDate, active: trimPortrait(res.visitUv), new: trimPortrait(res.visitUvNew) };
}

// ── We分析（需要 access_token） ──
function postJson(url, body) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify(body);
        const req = https.request(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
            timeout: 10000
        }, res => {
            let buf = '';
            res.on('data', c => { buf += c; });
            res.on('end', () => { try { resolve(JSON.parse(buf)); } catch (e) { reject(new Error('bad json: ' + buf.slice(0, 120))); } });
        });
        req.on('error', reject);
        req.on('timeout', () => req.destroy(new Error('timeout')));
        req.end(data);
    });
}

async function fetchWedata(charts, end) {
    const secret = process.env.WX_APPSECRET;
    if (!secret) return { skipped: '未配置环境变量 WX_APPSECRET' };
    const appid = process.env.WX_APPID || DEFAULT_APPID;
    const tok = await postJson('https://api.weixin.qq.com/cgi-bin/stable_token', { grant_type: 'client_credential', appid, secret });
    if (!tok.access_token) return { error: 'stable_token 失败', errcode: tok.errcode, errmsg: tok.errmsg };
    const url = 'https://api.weixin.qq.com/wedata/wedata_get_data?access_token=' + tok.access_token;
    const out = [];
    for (const c of charts) {
        const body = {
            chart_id: String(c.chart_id),
            begin_date: c.begin_date || addDays(end, -6),
            end_date: c.end_date || end,
            time_unit: c.time_unit == null ? 0 : c.time_unit
        };
        if (c.target_id) body.target_id = c.target_id;
        try {
            const r = await postJson(url, body);
            out.push(r.errcode ? { req: body, errcode: r.errcode, errmsg: r.errmsg }
                : { req: body, chart_name: r.chart_name, chart_result: r.chart_result });
        } catch (err) {
            out.push({ req: body, error: err.message });
        }
    }
    return out;
}

exports.main = async (event = {}) => {
    const startedAt = Date.now();
    const days = Math.max(1, Math.min(60, parseInt(event.days, 10) || 30));
    const end = /^\d{8}$/.test(event.endDate || '') ? event.endDate : ymd(Date.now() - 86400000);
    const parts = Array.isArray(event.parts) && event.parts.length ? event.parts : ALL_PARTS;
    const want = p => parts.indexOf(p) >= 0;
    const dates = dateRange(end, days);
    const errors = [];
    const call = makeCaller(errors);

    const out = { ok: 1, window: { begin: dates[0], end, days } };
    const jobs = [];
    if (want('trend')) jobs.push(fetchTrend(call, dates).then(v => { out.trend = v; }));
    if (want('retain')) jobs.push(fetchRetain(call, dates).then(v => { out.retain = v; }));
    if (want('weekly')) jobs.push(fetchPeriods(call, lastWeeks(end, 4), 'getWeeklyVisitTrend', 'getWeeklyRetain').then(v => { out.weekly = v; }));
    if (want('monthly')) jobs.push(fetchPeriods(call, lastMonths(end, 3), 'getMonthlyVisitTrend', 'getMonthlyRetain').then(v => { out.monthly = v; }));
    if (want('pages')) jobs.push(fetchPages(call, dates).then(v => { out.pages = v; }));
    if (want('distribution')) jobs.push(fetchDistribution(call, dates).then(v => { out.distribution = v; }));
    if (want('portrait')) jobs.push(fetchPortrait(call, end).then(v => { out.portrait = v; }));
    await Promise.all(jobs);

    if (Array.isArray(event.wedata) && event.wedata.length) {
        try { out.wedata = await fetchWedata(event.wedata, end); } catch (err) { out.wedata = { error: err.message }; }
    }

    // 同一个错误只留前几条，避免 30 天 × 同一个权限错误把结果刷屏
    out.errorCount = errors.length;
    out.errors = errors.slice(0, 8);
    out.ms = Date.now() - startedAt;
    return out;
};

exports._test = { ymd, addDays, dateRange, lastWeeks, lastMonths };
