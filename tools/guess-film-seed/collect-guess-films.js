// tools/guess-film-seed/collect-guess-films.js
// 给「每日电影填词」扩片源：从豆瓣「选电影」(https://movie.douban.com/explore) 抓大众电影，
// 生成 cloudfunctions/buildMovieFacts/guessExtraFilms.json（随 buildMovieFacts 一起部署）。
//
//   node tools/guess-film-seed/collect-guess-films.js              # 抓取（有缓存的组合直接读缓存）
//   node tools/guess-film-seed/collect-guess-films.js --min 30000  # 改评分人数下限（默认 20000）
//
// 为什么要扩：填字的片名池子只从现有榜单收（豆瓣250 / 奥斯卡 / 通用主题），
// 偏影史经典和获奖片，纯汉字 2~7 字 + 评分人数 ≥5 万之后只剩 626 部 ——
// 同一批片反复出现、冷门片扎堆，都是这个根子。大众熟悉的商业片和华语片反而不在里面。
//
// 收录口径（入库前每条都要过）：
//   · type === 'movie'，类型里不含 纪录片 / 短片 —— 入口叫「电影填词」，剧集、纪录片一律不收；
//   · 片名纯汉字 2~7 字（带数字/冒号/英文的填不进格子，收了也用不上）；
//   · 评分人数 ≥ MIN_VOTES。出题时的门槛另由 getGuessPuzzle 的 minVotes 决定（默认 5 万），
//     这里放低到 2 万，是为了以后放宽门槛时不用再抓一遍。
//
// 接口：m.douban.com/rexxar/api/v2/movie/recommend（2026-10-30 实测可用，结构同剧集版 tv/recommend）
//   · tags 逗号分隔，地区和年代可以组合（「美国,2010年代」）；
//   · count 可以给 100，但单页偶尔少于 100（实测 83），不能拿「不满一页」当结束信号；
//   · 单个 tags 组合最多返回 500 条（服务端硬上限）。热门组合（美国 × 2010年代）第 500 条
//     评分人数还有 6 万多，所以撞到上限时再按「类型」切一刀（地区,年代,类型），合并后按 id 去重；
//   · 排序用综合排序 sort=T：和评分人数正相关，抓到一页里一条够门槛的都没有就停。

const https = require('https');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT_FILE = path.join(ROOT, 'cloudfunctions', 'buildMovieFacts', 'guessExtraFilms.json');
// 缓存放在项目目录**外面**：脚本每一两秒写一个缓存文件，放在项目里会让开在旁边的
// 微信开发者工具不停地重新编译（packOptions.ignore 只管上传，不管文件监听）
const CACHE_DIR = path.join(require('os').tmpdir(), 'xiaobiaoji-guess-film-seed');
const MIN_VOTES = (() => {
  const i = process.argv.indexOf('--min');
  return i > 0 ? parseInt(process.argv[i + 1], 10) : 20000;
})();
const PAGE = 100;
const CAP = 500;

const REGIONS = [
  '中国大陆', '中国香港', '中国台湾', '美国', '英国', '法国', '德国', '意大利', '西班牙',
  '日本', '韩国', '印度', '泰国', '俄罗斯', '加拿大', '澳大利亚', '爱尔兰', '瑞典',
  '丹麦', '伊朗', '墨西哥', '巴西', '阿根廷', '新西兰', '比利时', '波兰'
];
const DECADES = ['2020年代', '2010年代', '2000年代', '90年代', '80年代', '70年代', '60年代', '更早'];
// 撞到 500 上限时按类型再切
const GENRES = [
  '剧情', '喜剧', '动作', '爱情', '科幻', '动画', '悬疑', '惊悚', '恐怖', '犯罪', '同性',
  '音乐', '歌舞', '传记', '历史', '战争', '西部', '奇幻', '冒险', '灾难', '武侠', '情色'
];
const EXCLUDED_GENRES = ['纪录片', '短片'];

const HEADERS = {
  'Referer': 'https://movie.douban.com/explore',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*'
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

function get(url, tries = 4) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: HEADERS }, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode));
        try { resolve(JSON.parse(body)); } catch (e) { reject(new Error('bad json')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(20000, () => req.destroy(new Error('timeout')));
  }).catch(async err => {
    // 403 多半是限流，退避久一点
    if (tries > 1) { await sleep(err.message === 'HTTP 403' ? 30000 : 3000); return get(url, tries - 1); }
    throw err;
  });
}

function pageUrl(tags, start) {
  return 'https://m.douban.com/rexxar/api/v2/movie/recommend?refresh=0'
    + '&start=' + start + '&count=' + PAGE
    + '&selected_categories=%7B%7D&uncollect=false&score_range=0,10'
    + '&tags=' + encodeURIComponent(tags) + '&sort=T';
}

const votesOf = it => (it && it.rating && typeof it.rating.count === 'number') ? it.rating.count : 0;

/**
 * 抓一个 tags 组合。返回 { items, capped }：capped = 撞到 500 上限、而且最后一页还有够门槛的片，
 * 说明这个组合里还有没抓到的，要再切。
 * 成功抓完的组合落缓存；中途失败的不落，下次重跑会接着抓。
 */
async function collect(tags) {
  const cacheFile = path.join(CACHE_DIR, tags.replace(/[,\s]/g, '_') + '.json');
  if (fs.existsSync(cacheFile)) return JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  const sink = new Map();
  let total = 0, lastPageHit = false;
  for (let start = 0; start < CAP; start += PAGE) {
    const json = await get(pageUrl(tags, start));
    const items = json.items || [];
    total = json.total || 0;
    items.forEach(it => { if (!sink.has(it.id)) sink.set(it.id, it); });
    lastPageHit = items.some(it => votesOf(it) >= MIN_VOTES);
    await sleep(900);
    if (!items.length || !lastPageHit || start + PAGE >= total) break;
  }
  const result = {
    items: [...sink.values()].map(it => ({
      id: String(it.id), title: it.title, year: it.year, type: it.type,
      votes: votesOf(it), subtitle: it.card_subtitle || ''
    })),
    capped: total >= CAP && lastPageHit
  };
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(cacheFile, JSON.stringify(result));
  return result;
}

/** card_subtitle 形如「2019 / 美国 / 剧情 犯罪 / 导演 / 主演」，第三段是类型 */
function genresOf(subtitle) {
  const seg = String(subtitle || '').split(' / ');
  return (seg[2] || '').split(/\s+/).filter(Boolean);
}

function keep(x) {
  return x.type === 'movie'
    && /^[一-龥]{2,7}$/.test(x.title || '')
    && x.votes >= MIN_VOTES
    && !genresOf(x.subtitle).some(g => EXCLUDED_GENRES.includes(g));
}

(async () => {
  const films = new Map();
  let combos = 0, splits = 0, failed = 0;
  const add = list => list.forEach(x => {
    if (!keep(x)) return;
    const old = films.get(x.id);
    if (!old || x.votes > old.votes) films.set(x.id, x);
  });
  for (const region of REGIONS) {
    for (const decade of DECADES) {
      const tags = region + ',' + decade;
      let r;
      try { r = await collect(tags); combos++; } catch (e) {
        failed++;
        console.error('  ! ' + tags + ' ' + e.message);
        continue;
      }
      add(r.items);
      if (r.capped) {
        splits++;
        for (const genre of GENRES) {
          try { add((await collect(tags + ',' + genre)).items); } catch (e) {
            failed++;
            console.error('  ! ' + tags + ',' + genre + ' ' + e.message);
          }
        }
      }
      console.log(tags + ' => 累计 ' + films.size + (r.capped ? '（撞上限，已按类型切）' : ''));
    }
  }

  const list = [...films.values()].sort((a, b) => b.votes - a.votes).map(x => ({
    doubanId: x.id, title: x.title, year: parseInt(x.year, 10) || null, ratingCount: x.votes
  }));
  fs.writeFileSync(OUT_FILE, JSON.stringify(list, null, 1) + '\n');

  const tier = v => (v >= 500000 ? '50万+' : v >= 100000 ? '10~50万' : v >= 50000 ? '5~10万' : '2~5万');
  const byTier = {}, byLen = {};
  list.forEach(x => {
    byTier[tier(x.ratingCount)] = (byTier[tier(x.ratingCount)] || 0) + 1;
    byLen[x.title.length + '字'] = (byLen[x.title.length + '字'] || 0) + 1;
  });
  console.log('\n组合 ' + combos + ' 个（按类型切 ' + splits + ' 次，失败 ' + failed + ' 次，失败的重跑会接着抓）');
  console.log('收录 ' + list.length + ' 部 → ' + path.relative(ROOT, OUT_FILE));
  console.log('评分人数：' + JSON.stringify(byTier));
  console.log('片名字数：' + JSON.stringify(byLen));
  console.log('前 10：' + list.slice(0, 10).map(x => x.title).join(' / '));
})();
