// 本地跑 cloudfunctions/searchMovieByTitle，不用部署即可看候选列表。
//   用法：node tools/test-search-movie.js 行尸走肉            豆瓣主链 + 自动跑第二趟补季（模拟 add 页两趟调用）
//         node tools/test-search-movie.js 行尸走肉 --mtime    也带上时光网
//         node tools/test-search-movie.js 行尸走肉 --no-seasons  只看第一趟
// 依赖：借 fetchOscarMovies 的 node_modules（axios / cheerio 同版本），wx-server-sdk 打桩。
// 注意本机网络 ≠ 云函数出口：这里只验证解析/合并逻辑，连通性以部署后为准。另外这个终端若设了
// HTTP(S)_PROXY，axios 会走代理——想模拟云函数的直连，先 unset 掉再跑。
const path = require('path');
const Module = require('module');
const root = path.resolve(__dirname, '..');
const depRoot = path.join(root, 'cloudfunctions', 'fetchOscarMovies', 'node_modules');

const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request === 'wx-server-sdk') return path.join(__dirname, '__wx_server_sdk_stub.js');
  if (request === 'axios' || request === 'cheerio') return origResolve.call(this, path.join(depRoot, request), parent, ...rest);
  return origResolve.call(this, request, parent, ...rest);
};
require('fs').writeFileSync(path.join(__dirname, '__wx_server_sdk_stub.js'),
  'module.exports = { init() {}, DYNAMIC_CURRENT_ENV: "local" };');

const fn = require(path.join(root, 'cloudfunctions', 'searchMovieByTitle', 'index.js'));
const keyword = process.argv[2] || '行尸走肉';
const includeMtime = process.argv.indexOf('--mtime') >= 0;
const withSeasons = process.argv.indexOf('--no-seasons') < 0;

// 与 pages/daily/movie/add.js seasonHintsFrom 同一逻辑：从豆瓣候选抠 { cn, en }
const SEASON_TITLE_RE = /^(.+?)\s*第[一二三四五六七八九十零百\d]+季$/;
function seasonHintsFrom(candidates, kw) {
  const byEn = {}, hints = [];
  (candidates || []).forEach(c => {
    if (c.source && c.source !== 'douban') return;
    const m = SEASON_TITLE_RE.exec(String(c.title || '').trim());
    if (!m || !c.originalTitle || byEn[c.originalTitle]) return;
    byEn[c.originalTitle] = true;
    hints.push({ cn: m[1].trim(), en: c.originalTitle.trim() });
  });
  if (!hints.length && /[a-z]/i.test(kw)) hints.push({ cn: '', en: kw });
  return hints.slice(0, 2);
}
const print = list => list.forEach((c, i) => console.log(
  String(i + 1).padStart(2), (c.source || 'douban').padEnd(6), String(c.year || '').padEnd(4),
  c.title, c.totalEpisodes ? `(${c.totalEpisodes}集)` : '', c.originalTitle ? `  [原名 ${c.originalTitle}]` : '', c.posterUrl ? '' : '[无封面]'
));

(async () => {
  let t0 = Date.now();
  const res = await fn.main({ keyword, includeMtime }, {});
  console.log(`\n第一趟 ${keyword}  success=${res.success}  ${Date.now() - t0}ms`);
  print(res.candidates || []);
  if (withSeasons) {
    const hints = seasonHintsFrom(res.candidates || [], keyword);
    console.log(`\n第二趟 补季 hints=${JSON.stringify(hints)}`);
    if (hints.length) {
      t0 = Date.now();
      const r2 = await fn.main({ keyword, seasonsFor: hints }, {});
      console.log(`success=${r2.success}  ${Date.now() - t0}ms  ${(r2.candidates || []).length} 条（前端会再按片名与第一趟去重）`);
      print(r2.candidates || []);
    }
  }
  require('fs').unlinkSync(path.join(__dirname, '__wx_server_sdk_stub.js'));
})().catch(e => { console.error(e); process.exit(1); });
