// tools/douban-tv-seed/collect-douban-tv.js
// 从豆瓣「选剧集」(https://movie.douban.com/tv/) 抓取评分区间 9~10 的剧集，生成三份
// enrichThemeMovies 的 params.json（华语剧集 / 国外剧集 / 动画，各按豆瓣评分降序取 TOP250）。
//
//   node tools/douban-tv-seed/collect-douban-tv.js            # 抓取 + 出 params
//   node tools/douban-tv-seed/collect-douban-tv.js --limit 500
//
// 接口：m.douban.com/rexxar/api/v2/tv/recommend
//   · 真正生效的筛选参数是 tags（逗号分隔），selected_categories 传了会被服务端忽略；
//   · score_range 只接受整数（9,10），传小数直接 403；
//   · 单个 tags 组合最多返回 500 条（服务端硬上限），所以按「年份」tag 分片再合并，
//     才能拿到 9 分以上的完整池子（华语 791 / 国外 3473 / 动画 1129 量级）。
//   · 「类型 = 全部剧集」在接口上没有对应 tag（传 "全部剧集" 返回 0 条），等价做法是
//     取该地区全量池子再减去 `地区,综艺` 的池子。

const https = require('https');
const fs = require('fs');
const path = require('path');

const OUT_DIR = __dirname;
const CACHE_DIR = path.join(__dirname, '.cache');
const LIMIT = (() => {
  const i = process.argv.indexOf('--limit');
  return i > 0 ? parseInt(process.argv[i + 1], 10) : 250;
})();

const HEADERS = {
  'Referer': 'https://movie.douban.com/tv/',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*'
};

function get(url, tries = 3) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: HEADERS }, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch (e) { reject(new Error('HTTP ' + res.statusCode)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(20000, () => req.destroy(new Error('timeout')));
  }).catch(async err => {
    if (tries > 1) { await new Promise(r => setTimeout(r, 3000)); return get(url, tries - 1); }
    throw err;
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

function pageUrl(tags, start, count) {
  return 'https://m.douban.com/rexxar/api/v2/tv/recommend?refresh=0'
    + '&start=' + start + '&count=' + count
    + '&selected_categories=%7B%7D&uncollect=false&score_range=9,10'
    + '&tags=' + encodeURIComponent(tags) + '&sort=S';
}

// 抓一个 tags 组合的全部条目（最多 500 条，服务端硬上限），合并进 sink
async function drain(tags, sink) {
  for (let start = 0; start < 500; start += 50) {
    let json;
    try { json = await get(pageUrl(tags, start, 50)); } catch (e) {
      console.error('  ! ' + tags + ' start=' + start + ' ' + e.message);
      break;
    }
    const items = json.items || [];
    items.forEach(it => { if (!sink.has(it.id)) sink.set(it.id, it); });
    if (items.length < 50) break;
    await sleep(500);
  }
}

// 先按评分序拿前 500，再逐年补齐被 500 上限截断的部分
async function collectPool(baseTag) {
  const cacheFile = path.join(CACHE_DIR, 'pool_' + baseTag.replace(/[,\s]/g, '_') + '.json');
  if (fs.existsSync(cacheFile)) {
    const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    console.log('[cache] ' + baseTag + ' => ' + cached.length);
    return cached;
  }
  const sink = new Map();
  await drain(baseTag, sink);
  for (let y = new Date().getFullYear() + 1; y >= 1930; y--) {
    await drain(baseTag + ',' + y, sink);
    await sleep(300);
  }
  const list = [...sink.values()];
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(cacheFile, JSON.stringify(list));
  console.log('[fetch] ' + baseTag + ' => ' + list.length);
  return list;
}

const clean = s => String(s || '').replace(/\s+/g, ' ').trim();

function emit(theme, pool, excludePool) {
  const excluded = new Set((excludePool || []).map(x => x.id));
  const list = pool
    .filter(x => !excluded.has(x.id) && x.rating && typeof x.rating.value === 'number' && x.rating.value >= 9)
    .sort((a, b) => (b.rating.value - a.rating.value)
      || (b.rating.count - a.rating.count)
      || (a.id < b.id ? -1 : 1));

  const seen = new Map();
  const movieList = list.slice(0, LIMIT).map((x, i) => {
    const title = clean(x.title);
    const year = parseInt(x.year, 10);
    const key = title + '__' + year;
    if (seen.has(key)) console.warn('  ! 同名同年重复（会影响身份匹配）: ' + key);
    seen.set(key, x.id);
    // originalTitle 与 title 同值：剧集没有稳定的外文原名，这里只是给 enrichThemeMovies
    // 做「同一部剧」的身份键（榜单按评分排序，重灌时名次会漂，靠身份键保住 _id 和用户标记）
    return { rank: i + 1, year, title, originalTitle: title, doubanId: String(x.id) };
  });

  const params = { theme, idStrategy: 'rank', forceRefresh: false, startFrom: 0, autoContinue: true, movieList };
  const file = path.join(OUT_DIR, theme + '.params.json');
  fs.writeFileSync(file, JSON.stringify(params, null, 2).replace(/\n/g, '\r\n') + '\r\n');
  const first = list[0], last = list[Math.min(LIMIT, list.length) - 1];
  console.log(theme + ' => ' + movieList.length + ' 条（池子 ' + list.length
    + '，评分 ' + first.rating.value + ' ~ ' + last.rating.value + '） -> ' + path.basename(file));
}

(async () => {
  const cn = await collectPool('华语');
  const cnVariety = await collectPool('华语,综艺');
  const foreign = await collectPool('国外');
  const foreignVariety = await collectPool('国外,综艺');
  const anime = await collectPool('动画');

  emit('doubanTvCn', cn, cnVariety);
  emit('doubanTvForeign', foreign, foreignVariety);
  emit('doubanTvAnime', anime, null); // 动画是「电视剧」下的类型 tag，本身不含综艺
})();
