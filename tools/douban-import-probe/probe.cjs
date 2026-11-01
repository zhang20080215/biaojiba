#!/usr/bin/env node
// 本机跑同一份探测代码（cloudfunctions/probeDoubanImport），结果写 out/（已 gitignore）
//
//   node tools/douban-import-probe/probe.cjs <豆瓣 uid 或主页链接> [maxPages] [done|mark]
//
// 直连，不走 HTTPS_PROXY：要看的是本机出口 IP 在豆瓣那边的待遇。

const fs = require('fs');
const path = require('path');
const { probe } = require('../../cloudfunctions/probeDoubanImport/index.js');

function parseUid(s) {
    const m = /people\/([^/?#\s]+)/.exec(s || '');
    return m ? m[1] : String(s || '').trim();
}

(async () => {
    const [arg, maxPages, status] = process.argv.slice(2);
    const uid = parseUid(arg);
    if (!uid) { console.error('用法：probe.cjs <豆瓣 uid 或主页链接> [maxPages] [done|mark]'); process.exit(2); }
    const res = await probe({ uid, maxPages: maxPages || 30, status: status || 'done' });
    const dir = path.join(__dirname, 'out');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'local-' + new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + '.json');
    fs.writeFileSync(file, JSON.stringify(res, null, 1));
    res.results.forEach(r => {
        console.log('== ' + r.source + '  total=' + r.total + '  读到=' + r.read + '  被拦页=' + (r.blockedAt == null ? '无' : r.blockedAt));
        r.pages.forEach(p => console.log('   start=' + p[0] + ' http=' + p[1] + ' ' + p[2] + 'ms 条数=' + p[3] + (p[4] ? ' ' + p[4] : '')));
    });
    console.log('已写入 ' + file);
})();
