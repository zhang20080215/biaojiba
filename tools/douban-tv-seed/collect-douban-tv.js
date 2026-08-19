// tools/douban-tv-seed/collect-douban-tv.js
// 从豆瓣「选剧集」(https://movie.douban.com/tv/) 抓取评分区间 9~10 的剧集，生成三份
// enrichThemeMovies 的 params.json（华语剧集 / 国外剧集 / 动画，各取前 250）。
//
//   node tools/douban-tv-seed/collect-douban-tv.js            # 抓取 + 出 params
//   node tools/douban-tv-seed/collect-douban-tv.js --limit 200
//
// 排序：跟豆瓣页面默认的「综合排序」(sort=T) 完全一致，名单顺序 = 用户在页面上往下滚看到的顺序。
//   ⚠️ 不要改成 sort=S（高分优先）——那样取前 N 会把 9.0~9.3 这一段整体砍掉，
//   《爱，死亡和机器人》《鬼灭之刃》《葫芦兄弟》这些页面首屏就有的条目会全部丢失。
//
// 接口：m.douban.com/rexxar/api/v2/tv/recommend
//   · 真正生效的筛选参数是 tags（逗号分隔），selected_categories 传了会被服务端忽略；
//   · score_range 只接受整数（9,10），传小数直接 403；
//   · 单个 tags 组合最多返回 500 条（服务端硬上限）；名单只要前 250，主榜直接取前 500 即可，
//     但「排除综艺」用的对照池必须是全量，所以那部分按「年份」tag 分片再合并。
//   · 「类型 = 全部剧集」在接口上没有对应 tag（传 "全部剧集" 返回 0 条），等价做法是
//     取该地区主榜再减去 `地区,综艺` 的全量池子。

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

function pageUrl(tags, start, count, sort) {
  return 'https://m.douban.com/rexxar/api/v2/tv/recommend?refresh=0'
    + '&start=' + start + '&count=' + count
    + '&selected_categories=%7B%7D&uncollect=false&score_range=9,10'
    + '&tags=' + encodeURIComponent(tags) + '&sort=' + sort;
}

// 抓一个 tags 组合的全部条目（最多 500 条，服务端硬上限），按返回顺序合并进 sink
async function drain(tags, sink, sort) {
  for (let start = 0; start < 500; start += 50) {
    let json;
    try { json = await get(pageUrl(tags, start, 50, sort)); } catch (e) {
      console.error('  ! ' + tags + ' start=' + start + ' ' + e.message);
      break;
    }
    const items = json.items || [];
    items.forEach(it => { if (!sink.has(it.id)) sink.set(it.id, it); });
    if (items.length < 50) break;
    await sleep(500);
  }
}

function cachePath(name) {
  return path.join(CACHE_DIR, 'pool_' + name.replace(/[,\s]/g, '_') + '.json');
}

function readCache(name) {
  const f = cachePath(name);
  if (!fs.existsSync(f)) return null;
  const list = JSON.parse(fs.readFileSync(f, 'utf8'));
  console.log('[cache] ' + name + ' => ' + list.length);
  return list;
}

function writeCache(name, list) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(cachePath(name), JSON.stringify(list));
  console.log('[fetch] ' + name + ' => ' + list.length);
}

// 主榜：综合排序，保持豆瓣页面顺序，最多 500 条
async function collectRanked(baseTag) {
  const name = baseTag + '@T';
  const cached = readCache(name);
  if (cached) return cached;
  const sink = new Map();
  await drain(baseTag, sink, 'T');
  const list = [...sink.values()];
  writeCache(name, list);
  return list;
}

// 对照池（用于排除综艺）：必须全量，按年份 tag 分片绕开 500 上限
async function collectFullPool(baseTag) {
  const cached = readCache(baseTag);
  if (cached) return cached;
  const sink = new Map();
  await drain(baseTag, sink, 'S');
  for (let y = new Date().getFullYear() + 1; y >= 1930; y--) {
    await drain(baseTag + ',' + y, sink, 'S');
    await sleep(300);
  }
  const list = [...sink.values()];
  writeCache(baseTag, list);
  return list;
}

const clean = s => String(s || '').replace(/\s+/g, ' ').trim();

function emit(theme, ranked, excludePool) {
  const excluded = new Set((excludePool || []).map(x => x.id));
  // 保持豆瓣综合排序的原始顺序，只剔掉综艺和无评分条目
  const list = ranked.filter(x =>
    !excluded.has(x.id) && x.rating && typeof x.rating.value === 'number' && x.rating.value >= 9);

  const seen = new Map();
  const movieList = list.slice(0, LIMIT).map((x, i) => {
    const title = clean(x.title);
    const year = parseInt(x.year, 10);
    const key = title + '__' + year;
    if (seen.has(key)) console.warn('  ! 同名同年重复（会影响身份匹配）: ' + key);
    seen.set(key, x.id);
    // originalTitle 与 title 同值：剧集没有稳定的外文原名，这里只是给 enrichThemeMovies
    // 做「同一部剧」的身份键（榜单顺序会随豆瓣综合排序漂，靠身份键保住 _id 和用户标记）
    return { rank: i + 1, year, title, originalTitle: title, doubanId: String(x.id) };
  });

  if (movieList.length < LIMIT) {
    console.warn('  ! ' + theme + ' 只凑到 ' + movieList.length + ' 条（主榜 500 上限扣掉综艺后不够 ' + LIMIT + '）');
  }

  const params = { theme, idStrategy: 'rank', forceRefresh: false, startFrom: 0, autoContinue: true, movieList };
  fs.writeFileSync(path.join(OUT_DIR, theme + '.params.json'),
    JSON.stringify(params, null, 2).replace(/\n/g, '\r\n') + '\r\n');
  fs.writeFileSync(path.join(OUT_DIR, theme + '.json'),
    JSON.stringify(movieList, null, 2).replace(/\n/g, '\r\n') + '\r\n');

  const scores = movieList.map((m, i) => list[i].rating.value);
  console.log(theme + ' => ' + movieList.length + ' 条（可选池 ' + list.length
    + '，评分 ' + Math.max(...scores) + ' ~ ' + Math.min(...scores) + '）');
  console.log('   前 5：' + movieList.slice(0, 5).map(m => m.rank + '.' + m.title).join('  '));
}

(async () => {
  const cn = await collectRanked('华语');
  const cnVariety = await collectFullPool('华语,综艺');
  const foreign = await collectRanked('国外');
  const foreignVariety = await collectFullPool('国外,综艺');
  const anime = await collectRanked('动画');

  emit('doubanTvCn', cn, cnVariety);
  emit('doubanTvForeign', foreign, foreignVariety);
  emit('doubanTvAnime', anime, null); // 动画是「电视剧」下的类型 tag，本身不含综艺
})();
