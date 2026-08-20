// tools/sightsound-seed/collect-sightsound.js
// 从英国电影协会 BFI《视与听》(Sight and Sound)「影史最伟大电影」影评人票选榜抓取名单，
// 生成 enrichThemeMovies 的 params.json。
//
//   node tools/sightsound-seed/collect-sightsound.js           # 抓取（页面缓存到 .cache/）
//   node tools/sightsound-seed/collect-sightsound.js --refresh # 忽略缓存重抓
//
// 数据源：https://www.bfi.org.uk/sight-and-sound/greatest-films-all-time
//   榜单十年一评（现行为 2022 年版，1639 位影评人/策展人/学者投票）。
//
// ⚠️ 页面 DOM 是分片懒加载的，直接解析 HTML 只能拿到一部分条目；
//   完整名单在内联脚本 `var initialPageState = {...}` 里（componentState.results），
//   字段齐全（rank / tied / name / year / credits.director / productionCountries），
//   所以这里靠花括号配平把这段 JSON 抠出来解析，不用 cheerio 爬 DOM。
//
// ⚠️ 「TOP250」实际是 264 部：官方名次含大量并列（如并列第 243 名有 22 部），
//   名次到 250 为止但条目数超出。本项目的 rank 必须是 1..N 连续唯一（enrichThemeMovies
//   用 rank 生成 _id、列表页直接把 rank 当序号显示），所以这里把并列拍平成 1..264 顺序号，
//   官方名次原样留在 officialRank 字段里备查。并列组内按「年份升序 + 片名」排定，
//   纯粹是为了可复现——BFI 页面组内顺序是 CMS 顺序，重抓一次就可能变，
//   而 rank 一旦漂移就会连累 _id 和用户标记。
//
// 片名保持英文原名（title === originalTitle，同 letterboxd500 的做法）：
//   enrichThemeMovies 匹配到豆瓣条目后会用大陆标准简体片名覆盖 title、原名留档到 sourceTitle。
//   导演/国家也刻意不写进名单——BFI 给的是英文人名/国名，写进去列表页就会是一行英文；
//   留空则由 enrichThemeMovies 从豆瓣详情自动补中文导演和国家。

const https = require('https');
const fs = require('fs');
const path = require('path');

const OUT_DIR = __dirname;
const CACHE_FILE = path.join(__dirname, '.cache', 'bfi-greatest-films.html');
const SOURCE_URL = 'https://www.bfi.org.uk/sight-and-sound/greatest-films-all-time';
const THEME = 'sightsound';
const REFRESH = process.argv.includes('--refresh');

// 源站脏片名订正（key 是 cleanTitle 归一化之后的原文：实体已解码、连续空白已压成单空格）
const TITLE_FIX = {
  'CHUNGKING EXPRESS': 'Chungking Express',         // 源站这一条是全大写
  'Sunrise A Song of Two Humans': 'Sunrise: A Song of Two Humans' // 源站丢了冒号，只留下双空格
};

function fetchHtml(url, tries = 3) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-GB,en;q=0.9'
      }
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(fetchHtml(new URL(res.headers.location, url).href, tries));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', d => body += d);
      res.on('end', () => resolve(body));
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('timeout')));
  }).catch(async err => {
    if (tries > 1) { await new Promise(r => setTimeout(r, 3000)); return fetchHtml(url, tries - 1); }
    throw err;
  });
}

async function loadHtml() {
  if (!REFRESH && fs.existsSync(CACHE_FILE)) {
    console.log('[cache] ' + path.relative(process.cwd(), CACHE_FILE));
    return fs.readFileSync(CACHE_FILE, 'utf8');
  }
  const html = await fetchHtml(SOURCE_URL);
  fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
  fs.writeFileSync(CACHE_FILE, html);
  console.log('[fetch] ' + SOURCE_URL + ' => ' + html.length + ' 字节');
  return html;
}

// 把内联的 `var initialPageState = {...};` 抠出来：从第一个 { 开始按花括号配平找结尾
function extractState(html) {
  const marker = 'var initialPageState = ';
  const i = html.indexOf(marker);
  if (i < 0) throw new Error('没找到 initialPageState —— 源站页面结构可能改了');
  const start = i + marker.length;
  let depth = 0;
  for (let k = start; k < html.length; k++) {
    const c = html[k];
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return JSON.parse(html.slice(start, k + 1));
  }
  throw new Error('initialPageState 花括号没配平');
}

const ENTITIES = { amp: '&', quot: '"', apos: "'", lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', nbsp: ' ', '#39': "'" };
function cleanTitle(raw) {
  let s = String(raw || '')
    .replace(/&([a-zA-Z#0-9]+);/g, (m, e) => (ENTITIES[e] != null ? ENTITIES[e] : m))
    .replace(/\s+/g, ' ')
    .trim();
  return TITLE_FIX[s] || s;
}

(async () => {
  const state = extractState(await loadHtml());
  const cs = state.componentState || {};
  const results = cs.results || [];
  if (!results.length) throw new Error('componentState.results 是空的');

  const rows = results.map(r => ({
    officialRank: r.rank,
    tied: !!r.tied,
    year: parseInt((r.film && r.film.year) || '', 10),
    title: cleanTitle(r.film && r.film.name),
    director: ((r.film && r.film.credits && r.film.credits.director) || '').trim(),
    country: ((r.film && r.film.productionCountries) || '').trim()
  }));

  const bad = rows.filter(x => !x.title || !x.year);
  if (bad.length) throw new Error('有 ' + bad.length + ' 条缺片名或年份：' + JSON.stringify(bad.slice(0, 3)));

  // 并列拍平：官方名次升序，组内按年份 + 片名排定（可复现，重抓不漂）
  rows.sort((a, b) => (a.officialRank - b.officialRank) || (a.year - b.year) || a.title.localeCompare(b.title));

  const seen = new Map();
  const movieList = rows.map((x, i) => {
    const key = x.title + '__' + x.year;
    if (seen.has(key)) console.warn('  ! 同名同年重复（会影响身份匹配）: ' + key);
    seen.set(key, true);
    // originalTitle 与 title 同值：BFI 给的就是英文通用名，灌库时豆瓣按「英文名 + 年份」匹配，
    // 之后 title 会被订正成简体中文，originalTitle 则作为身份键长期不变，不要改
    return { rank: i + 1, year: x.year, title: x.title, originalTitle: x.title, officialRank: x.officialRank };
  });

  const params = { theme: THEME, idStrategy: 'rank', forceRefresh: false, startFrom: 0, autoContinue: true, movieList };
  const writeJson = (file, data) =>
    fs.writeFileSync(path.join(OUT_DIR, file), JSON.stringify(data, null, 2).replace(/\n/g, '\r\n') + '\r\n');
  writeJson(THEME + '.json', movieList);
  writeJson(THEME + '.params.json', params);
  // 源站原始字段（导演/国家/是否并列）留一份备查：名单本身刻意不带这些字段，
  // 但核对匹配结果、写榜单文案时要用
  writeJson(THEME + '.source.json', rows);

  const tiedCount = rows.filter(x => x.tied).length;
  const years = movieList.map(m => m.year);
  console.log(THEME + ' => ' + movieList.length + ' 部（官方名次 1~'
    + Math.max(...rows.map(x => x.officialRank)) + '，其中并列条目 ' + tiedCount + ' 部）'
    + '，年份 ' + Math.min(...years) + ' ~ ' + Math.max(...years));
  console.log('   前 5：' + movieList.slice(0, 5).map(m => m.rank + '.' + m.title + '(' + m.year + ')').join('  '));
  console.log('   末 3：' + movieList.slice(-3).map(m => m.rank + '.' + m.title + '(' + m.year + ')').join('  '));
})().catch(e => { console.error('失败:', e.message); process.exit(1); });
