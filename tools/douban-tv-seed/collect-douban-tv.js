// tools/douban-tv-seed/collect-douban-tv.js
// 从豆瓣「选剧集」(https://movie.douban.com/tv/) 抓取评分区间 9~10 的剧集，生成三份
// enrichThemeMovies 的 params.json。
//
//   node tools/douban-tv-seed/collect-douban-tv.js            # 上限 250，不足则全收
//   node tools/douban-tv-seed/collect-douban-tv.js --limit 200
//
// 筛选口径（与页面上的下拉一一对应）：
//   doubanTvCn      类型=电视剧，地区=华语   → tags=电视剧,华语
//   doubanTvForeign 类型=电视剧，地区=国外   → tags=电视剧,国外
//   doubanTvAnime   类型=动画，地区不限      → tags=动画
//
//   ⚠️ 类型必须用「电视剧」而不是「全部剧集」：「全部剧集」把动画和纪录片也算进来，
//   华语榜里会混进《葫芦兄弟》《舌尖上的中国》这类条目。「电视剧」天然排除综艺/纪录片/动画，
//   三个主题正好正交，也不需要再单独减综艺池。
//
// 排序：跟豆瓣页面默认的「综合排序」(sort=T) 完全一致，名单顺序 = 用户在页面上往下滚看到的顺序。
//   ⚠️ 不要改成 sort=S（高分优先）——那样取前 N 会把 9.0~9.3 这一段整体砍掉，
//   《爱，死亡和机器人》《鬼灭之刃》《葫芦兄弟》这些页面首屏就有的条目会全部丢失。
//
// 接口：m.douban.com/rexxar/api/v2/tv/recommend
//   · 真正生效的筛选参数是 tags（逗号分隔），selected_categories 传了会被服务端忽略；
//   · score_range 只接受整数（9,10），传小数直接 403；
//   · 单个 tags 组合最多返回 500 条（服务端硬上限）。华语电视剧 9 分以上总共才 168 条，
//     没碰到上限；国外电视剧/动画都是 500，取前 250 够用。

const https = require('https');
const fs = require('fs');
const path = require('path');

const OUT_DIR = __dirname;
const CACHE_DIR = path.join(__dirname, '.cache');
const LIMIT = (() => {
  const i = process.argv.indexOf('--limit');
  return i > 0 ? parseInt(process.argv[i + 1], 10) : 250;
})();

const THEMES = [
  { theme: 'doubanTvCn', tags: '电视剧,华语', label: '华语剧集' },
  { theme: 'doubanTvForeign', tags: '电视剧,国外', label: '国外剧集' },
  { theme: 'doubanTvAnime', tags: '动画', label: '动画' }
];

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
    + '&tags=' + encodeURIComponent(tags) + '&sort=T';
}

// 按综合排序抓取，保持豆瓣页面顺序；最多 500 条（服务端硬上限）
async function collect(tags) {
  const cacheFile = path.join(CACHE_DIR, 'pool_' + tags.replace(/[,\s]/g, '_') + '@T.json');
  if (fs.existsSync(cacheFile)) {
    const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    console.log('[cache] ' + tags + ' => ' + cached.length);
    return cached;
  }
  const sink = new Map();
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
  const list = [...sink.values()];
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(cacheFile, JSON.stringify(list));
  console.log('[fetch] ' + tags + ' => ' + list.length);
  return list;
}

const clean = s => String(s || '').replace(/\s+/g, ' ').trim();

function emit(theme, label, ranked) {
  // 保持豆瓣综合排序的原始顺序，只挡掉异常（无评分）条目
  const list = ranked.filter(x => x.rating && typeof x.rating.value === 'number' && x.rating.value >= 9);

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

  const params = { theme, idStrategy: 'rank', forceRefresh: false, startFrom: 0, autoContinue: true, movieList };
  fs.writeFileSync(path.join(OUT_DIR, theme + '.params.json'),
    JSON.stringify(params, null, 2).replace(/\n/g, '\r\n') + '\r\n');
  fs.writeFileSync(path.join(OUT_DIR, theme + '.json'),
    JSON.stringify(movieList, null, 2).replace(/\n/g, '\r\n') + '\r\n');

  const scores = list.slice(0, movieList.length).map(x => x.rating.value);
  const note = movieList.length < LIMIT ? '（该口径 9 分以上全量就这么多，已全收）' : '';
  console.log(theme + ' [' + label + '] => ' + movieList.length + ' 条'
    + '，评分 ' + Math.max(...scores) + ' ~ ' + Math.min(...scores) + note);
  console.log('   前 5：' + movieList.slice(0, 5).map(m => m.rank + '.' + m.title).join('  '));
}

(async () => {
  for (const t of THEMES) {
    const ranked = await collect(t.tags);
    emit(t.theme, t.label, ranked);
  }
})();
