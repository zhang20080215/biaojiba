#!/usr/bin/env node
// 本地拉取小程序数据（不用部署、不用去控制台复制结果）
//
// 凭据：tools/wx-analytics/secret.json  { "appid": "wx...", "secret": "..." }（已 gitignore）
//       或环境变量 WX_APPID / WX_APPSECRET。本机公网 IP 须在小程序后台
//       「开发管理 → 开发设置 → IP 白名单」里，否则取 token 报 40164。
//
// 用法：
//   node tools/wx-analytics/pull.cjs                    官方统计（同 fetchWxAnalytics，默认 30 天）
//   node tools/wx-analytics/pull.cjs stats '{"days":14}'
//   node tools/wx-analytics/pull.cjs invoke analyzeGuess '{}'      调任意已部署云函数
//   node tools/wx-analytics/pull.cjs wedata charts.json           We分析图表（[{chart_id,target_id,time_unit}]）
//   node tools/wx-analytics/pull.cjs db "db.collection('x').where({}).limit(10).get()"
//
// 结果写到 tools/wx-analytics/out/<命令>-<时间>.json（已 gitignore），终端只打印摘要。
// access_token 只在内存里用，不落盘、不打印。

const fs = require('fs');
const path = require('path');
const https = require('https');
const Module = require('module');

const ENV = 'cloud1-3gn3wryx716919c6';
const DIR = __dirname;
const OUT = path.join(DIR, 'out');

function loadCreds() {
    let file = {};
    const p = path.join(DIR, 'secret.json');
    if (fs.existsSync(p)) file = JSON.parse(fs.readFileSync(p, 'utf8'));
    const appid = process.env.WX_APPID || file.appid;
    const secret = process.env.WX_APPSECRET || file.secret;
    if (!appid || !secret) {
        console.error('缺凭据：请建 ' + p + '，内容 {"appid":"wx...","secret":"..."}');
        process.exit(2);
    }
    return { appid, secret };
}

// 直连，不走 HTTPS_PROXY（IP 白名单认的是本机出口 IP）
function post(url, body) {
    return new Promise((resolve, reject) => {
        const data = typeof body === 'string' ? body : JSON.stringify(body);
        const req = https.request(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
            timeout: 60000
        }, res => {
            let buf = '';
            res.on('data', c => { buf += c; });
            res.on('end', () => {
                try { resolve(JSON.parse(buf)); } catch (e) { reject(new Error('非 JSON 返回: ' + buf.slice(0, 200))); }
            });
        });
        req.on('error', reject);
        req.on('timeout', () => req.destroy(new Error('请求超时')));
        req.end(data);
    });
}

let tokenCache = null;
async function token() {
    if (tokenCache) return tokenCache;
    const { appid, secret } = loadCreds();
    const r = await post('https://api.weixin.qq.com/cgi-bin/stable_token', { grant_type: 'client_credential', appid, secret });
    if (!r.access_token) {
        const hint = r.errcode === 40164 ? '（本机 IP 不在白名单：' + (String(r.errmsg).match(/\d+\.\d+\.\d+\.\d+/) || [''])[0] + '）' : '';
        throw new Error('取 access_token 失败 ' + r.errcode + ' ' + r.errmsg + hint);
    }
    tokenCache = r.access_token;
    return tokenCache;
}

const snake = s => s.replace(/[A-Z]/g, c => '_' + c.toLowerCase());
const camel = s => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
function mapKeys(v, fn) {
    if (Array.isArray(v)) return v.map(x => mapKeys(x, fn));
    if (v && typeof v === 'object') {
        const o = {};
        Object.keys(v).forEach(k => { o[fn(k)] = mapKeys(v[k], fn); });
        return o;
    }
    return v;
}

// cloud.openapi.analysis.* 名 → datacube HTTP 接口名
const DATACUBE = {
    getDailySummary: 'getweanalysisappiddailysummarytrend',
    getDailyVisitTrend: 'getweanalysisappiddailyvisittrend',
    getWeeklyVisitTrend: 'getweanalysisappidweeklyvisittrend',
    getMonthlyVisitTrend: 'getweanalysisappidmonthlyvisittrend',
    getDailyRetain: 'getweanalysisappiddailyretaininfo',
    getWeeklyRetain: 'getweanalysisappidweeklyretaininfo',
    getMonthlyRetain: 'getweanalysisappidmonthlyretaininfo',
    getVisitPage: 'getweanalysisappidvisitpage',
    getVisitDistribution: 'getweanalysisappidvisitdistribution',
    getUserPortrait: 'getweanalysisappiduserportrait'
};

// 把云函数 fetchWxAnalytics 原样跑在本地：只替换 wx-server-sdk 的 openapi 为 HTTP 调用
function loadStatsFunction() {
    const shim = {
        init() {},
        DYNAMIC_CURRENT_ENV: ENV,
        openapi: {
            analysis: new Proxy({}, {
                get: (_, api) => async params => {
                    const ep = DATACUBE[api];
                    if (!ep) throw { errCode: -1, errMsg: '未映射的接口 ' + String(api) };
                    const r = await post('https://api.weixin.qq.com/datacube/' + ep + '?access_token=' + await token(), mapKeys(params, snake));
                    if (r.errcode) throw { errCode: r.errcode, errMsg: r.errmsg };
                    return mapKeys(r, camel);
                }
            })
        }
    };
    const orig = Module._load;
    Module._load = function (req, ...rest) {
        return req === 'wx-server-sdk' ? shim : orig.call(this, req, ...rest);
    };
    try {
        return require(path.join(DIR, '..', '..', 'cloudfunctions', 'fetchWxAnalytics', 'index.js'));
    } finally {
        Module._load = orig;
    }
}

async function invoke(name, event) {
    const url = 'https://api.weixin.qq.com/tcb/invokecloudfunction?access_token=' + await token() + '&env=' + ENV + '&name=' + encodeURIComponent(name);
    const r = await post(url, event || {});
    if (r.errcode) throw new Error('invoke ' + name + ' 失败 ' + r.errcode + ' ' + r.errmsg);
    try { return JSON.parse(r.resp_data); } catch (e) { return r.resp_data; }
}

async function dbQuery(query) {
    const r = await post('https://api.weixin.qq.com/tcb/databasequery?access_token=' + await token(), { env: ENV, query });
    if (r.errcode) throw new Error('databasequery 失败 ' + r.errcode + ' ' + r.errmsg);
    return { pager: r.pager, data: (r.data || []).map(s => { try { return JSON.parse(s); } catch (e) { return s; } }) };
}

async function wedata(charts) {
    const url = 'https://api.weixin.qq.com/wedata/wedata_get_data?access_token=' + await token();
    const out = [];
    for (const c of charts) {
        const r = await post(url, c);
        out.push(r.errcode ? { req: c, errcode: r.errcode, errmsg: r.errmsg } : { req: c, chart_name: r.chart_name, chart_result: r.chart_result });
    }
    return out;
}

function save(tag, data) {
    fs.mkdirSync(OUT, { recursive: true });
    const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 13);
    const file = path.join(OUT, tag + '-' + stamp + '.json');
    fs.writeFileSync(file, JSON.stringify(data, null, 1));
    console.log('已写入 ' + file + '（' + Math.round(fs.statSync(file).size / 1024) + ' KB）');
    return file;
}

function parseArg(s, fallback) {
    if (s == null) return fallback;
    if (fs.existsSync(s)) return JSON.parse(fs.readFileSync(s, 'utf8'));
    return JSON.parse(s);
}

async function main() {
    const [cmd = 'stats', a, b] = process.argv.slice(2);
    if (cmd === 'stats') {
        const res = await loadStatsFunction().main(parseArg(a, {}));
        save('stats', res);
        console.log('窗口 ' + res.window.begin + '~' + res.window.end + '，接口错误 ' + res.errorCount + ' 个，用时 ' + res.ms + 'ms');
        res.errors.forEach(e => console.log('  ✗ ' + e.api + ' ' + e.code + ' ' + e.msg));
    } else if (cmd === 'invoke') {
        if (!a) throw new Error('用法：invoke <云函数名> [事件 JSON]');
        save('invoke-' + a, await invoke(a, parseArg(b, {})));
    } else if (cmd === 'wedata') {
        save('wedata', await wedata(parseArg(a, [])));
    } else if (cmd === 'db') {
        save('db', await dbQuery(a));
    } else {
        throw new Error('未知命令 ' + cmd);
    }
}

main().catch(err => { console.error(err.message || err); process.exit(1); });
