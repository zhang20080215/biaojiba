// 临时云函数：验证「导入用户豆瓣标记」能不能走通（只读、不写库，验完删掉）
//
// 豆瓣没有面向第三方的开放 API，只能读用户**公开**的观影记录。这里从云函数出口 IP
// 匿名翻两个候选来源，记下每页的状态码、条数、耗时和第几页被拦：
//   rexxar  m.douban.com/rexxar/api/v2/user/{uid}/interests（移动端接口，JSON）
//   collect movie.douban.com/people/{uid}/collect（桌面「看过」页，HTML，备选）
// 本机 IP 和云函数出口 IP 待遇不同（桌面站会跳转非豆瓣 IP），所以同一份代码本地也跑一遍：
//   node tools/douban-import-probe/probe.cjs <uid>
//
// 入参：{ uid, sources?: ['rexxar','collect'], status?: 'done'|'mark', maxPages?: 10, gapMs?: 1500 }
// 出参：每个来源每页一行 [start, httpStatus, ms, 条数, 备注]，加上读到的豆瓣条目 id（用于对片试算）。
// 不返回、不保存任何用户昵称或评语。

const https = require('https');

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.3 Mobile/15E148 Safari/604.1';
const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const sleep = ms => new Promise(r => setTimeout(r, ms));

// 不跟随跳转：跳转本身就是「被拦」的信号，要原样记下来
function fetchRaw(url, headers) {
    return new Promise(resolve => {
        const t0 = Date.now();
        const req = https.get(url, { headers, timeout: 12000 }, res => {
            let buf = '';
            res.setEncoding('utf8');
            res.on('data', c => { buf += c; });
            res.on('end', () => resolve({ status: res.statusCode, location: res.headers.location || '', body: buf, ms: Date.now() - t0 }));
        });
        req.on('timeout', () => req.destroy(new Error('timeout')));
        req.on('error', err => resolve({ status: 0, error: err.message, body: '', ms: Date.now() - t0 }));
    });
}

const PAGE = { rexxar: 50, collect: 15 };

async function pageRexxar(uid, status, start) {
    const url = 'https://m.douban.com/rexxar/api/v2/user/' + encodeURIComponent(uid) +
        '/interests?type=movie&status=' + status + '&start=' + start + '&count=' + PAGE.rexxar + '&for_mobile=1';
    const r = await fetchRaw(url, {
        'User-Agent': UA,
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'Referer': 'https://m.douban.com/people/' + encodeURIComponent(uid) + '/'
    });
    const out = { status: r.status, ms: r.ms, ids: [], total: null, note: r.error || '' };
    if (r.status >= 300 && r.status < 400) { out.note = 'redirect ' + r.location.slice(0, 80); return out; }
    let j = null;
    try { j = JSON.parse(r.body); } catch (e) { out.note = out.note || ('非 JSON ' + r.body.slice(0, 60).replace(/\s+/g, ' ')); return out; }
    if (j.code || j.msg) out.note = (j.code || '') + ' ' + (j.msg || j.localized_message || '');
    out.total = typeof j.total === 'number' ? j.total : null;
    (j.interests || []).forEach(it => {
        const s = it && it.subject;
        if (s && s.id) out.ids.push({ id: String(s.id), type: s.type || s.subtype || '', year: s.year || '' });
    });
    return out;
}

async function pageCollect(uid, status, start) {
    const kind = status === 'mark' ? 'wish' : 'collect';
    const url = 'https://movie.douban.com/people/' + encodeURIComponent(uid) + '/' + kind +
        '?start=' + start + '&sort=time&rating=all&filter=all&mode=grid';
    const r = await fetchRaw(url, {
        'User-Agent': DESKTOP_UA,
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'zh-CN,zh;q=0.9'
    });
    const out = { status: r.status, ms: r.ms, ids: [], total: null, note: r.error || '' };
    if (r.status >= 300 && r.status < 400) { out.note = 'redirect ' + r.location.slice(0, 80); return out; }
    const seen = {};
    const re = /movie\.douban\.com\/subject\/(\d+)\//g;
    let m;
    while ((m = re.exec(r.body))) {
        if (!seen[m[1]]) { seen[m[1]] = 1; out.ids.push({ id: m[1] }); }
    }
    const num = /subject-num">\s*[\d-]+\s*\/\s*(\d+)/.exec(r.body);
    if (num) out.total = parseInt(num[1], 10);
    if (!out.ids.length && !out.note) {
        const title = /<title>([\s\S]*?)<\/title>/.exec(r.body);
        out.note = '无条目 ' + (title ? title[1].trim().slice(0, 40) : r.body.slice(0, 60).replace(/\s+/g, ' '));
    }
    return out;
}

async function probeSource(source, uid, status, maxPages, gapMs) {
    const fn = source === 'rexxar' ? pageRexxar : pageCollect;
    const pages = [];
    const ids = [];
    let total = null;
    let blockedAt = null;
    for (let p = 0; p < maxPages; p++) {
        const start = p * PAGE[source];
        const r = await fn(uid, status, start);
        pages.push([start, r.status, r.ms, r.ids.length, r.note]);
        if (r.total != null) total = r.total;
        r.ids.forEach(x => ids.push(x));
        if (r.status !== 200 || (!r.ids.length && r.note)) { blockedAt = p; break; }
        if (!r.ids.length || (total != null && start + PAGE[source] >= total)) break;
        await sleep(gapMs);
    }
    return { source, total, read: ids.length, blockedAt, pages, ids };
}

async function probe(event) {
    const uid = String((event && event.uid) || '').trim();
    if (!uid) return { ok: 0, error: '缺 uid' };
    const sources = Array.isArray(event.sources) && event.sources.length ? event.sources : ['rexxar', 'collect'];
    const status = event.status === 'mark' ? 'mark' : 'done';
    const maxPages = Math.max(1, Math.min(30, parseInt(event.maxPages, 10) || 10));
    const gapMs = Math.max(500, parseInt(event.gapMs, 10) || 1500);
    const t0 = Date.now();
    const results = [];
    for (const s of sources) results.push(await probeSource(s, uid, status, maxPages, gapMs));
    return { ok: 1, uid, status, maxPages, gapMs, ms: Date.now() - t0, results };
}

exports.main = async event => probe(event || {});
exports.probe = probe;
