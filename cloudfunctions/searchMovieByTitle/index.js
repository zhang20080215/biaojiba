// 入参: { keyword: string }
// 主用豆瓣搜索结果页 www.douban.com/search?cat=1002（cat=1002=电影）：
//   - 模糊匹配（"盗梦" 能出 "盗梦空间"）
//   - 服务端直出 HTML，一次请求即含 评分 / 评价人数 / 年份 / 封面
//   - 比 suggest 联想接口字段更全（suggest 只回标题/年份/封面，无评分）
// HTML 被封/为空时回退 movie.douban.com/j/subject_suggest（前缀匹配，原有逻辑）。
// 豆瓣登录墙挡掉的条目匿名搜不到：成人内容正片走时光网兜底（includeMtime）；分季剧集缺季
// （《行尸走肉》1~7 季）走 TVmaze 补季（seasonsFor），见下方两段。
//
// 返回字段保持向后兼容（评分查询 pages/movie-search 也消费此函数）：
//   { doubanId, title, year, posterUrl, subtype, director, url } —— 名称不变
//   新增 { rating, ratingCount } —— 旧消费方会自动忽略
// 关键：doubanId 必须是真实豆瓣电影 subject id（fetchMovieFullInfo 依赖它抓详情），
//       从 onclick 的 sid / href 的 subject/{id} / subject_id 解出。

const cloud = require('wx-server-sdk');
const axios = require('axios');
const cheerio = require('cheerio');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

// ── 时间预算 ──────────────────────────────────────────────
// ⚠️ 下面这些预算的前提是**线上函数超时真的是 config.json 里那个 25s**。
//    2026-09-06 实测过一次反例：源码写 25，线上跑的是 3s（创建时的默认值，
//    「上传并部署」只传了代码没改函数配置）。日志长这样：
//        Result: Invoking task timed out after 3 seconds / Duration: 3000ms
//    豆瓣搜索页正常返回就要 1~3s，再加 700ms 冷启动，等于每次调用都在 3s 线上掷硬币，
//    快了就成功、慢了就被平台杀掉，客户端只看到「网络异常」。
//    ⇒ 改这里的数字之前，先去云开发控制台确认线上超时是多少，config.json 不作数。
// 单次抓取的超时不能按「网络最慢能有多慢」来给，要按「串起来不能超过函数上限」倒推。
// 原来是搜索页 12s 串 suggest 10s = 22s，几乎贴着 25s 上限，本身也不安全；
// 但真正把线上打挂的是上面那个 3s。两件事都得治，光调这里没用。
// 现在两段加起来 12s，再用 TOTAL_BUDGET 兜一道底：宁可少几条候选，也必须把结果返回去。
const SEARCH_TIMEOUT = 7000;
const SUGGEST_TIMEOUT = 5000;
const MTIME_TIMEOUT = 6000;
const TVMAZE_TIMEOUT = 6000;  // 单次 TVmaze 请求（国内直连实测 1~3s）
const TVMAZE_BUDGET = 10000;  // 补季整条链（搜剧 → 拉季）到点就交已有的
const TOTAL_BUDGET = 15000;   // 远低于函数 25s 上限，留足冷启动 + 解析时间

// 到点就拿 fallback 交差，绝不让上游把整个函数拖到被平台杀掉。
// 注意：超时后原 promise 还在跑，但它的结果已经没人要了——云函数会等事件循环空了才结束，
// axios 那边最多再挂 SEARCH_TIMEOUT 就自己断，仍在函数上限内。
function withDeadline(promise, ms, fallback, label) {
  let timer = null;
  return Promise.race([
    promise.then(v => { clearTimeout(timer); return v; }),
    new Promise(resolve => {
      timer = setTimeout(() => {
        console.warn('[searchMovieByTitle] ' + label + ' 超预算 ' + ms + 'ms，先返回已有结果');
        resolve(fallback);
      }, ms);
    })
  ]);
}

const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const SUGGEST_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/91.0';

function extractIdFromResult($el) {
  // 优先 onclick 里的 sid: 1234
  const onclick = $el.find('a[onclick]').attr('onclick') || '';
  const m1 = onclick.match(/sid:\s*(\d+)/);
  if (m1) return m1[1];
  // 兜底：link2 href 把真实地址 url-encode 了（subject%2F123 / subject_id=123），解码后取
  const href = $el.find('a').attr('href') || '';
  let dec = href;
  try { dec = decodeURIComponent(href); } catch (e) { /* keep */ }
  const m2 = dec.match(/subject\/(\d+)/);
  if (m2) return m2[1];
  const m3 = dec.match(/subject_id[=:](\d+)/);
  return m3 ? m3[1] : '';
}

// 从文本提取年份（首个 19xx/20xx）
function pickYear(text) {
  const m = String(text || '').match(/\b(?:19|20)\d{2}\b/);
  return m ? m[0] : '';
}

// 解析 /search?cat=1002 结果页 HTML
function parseSearchHtml(html) {
  const $ = cheerio.load(html);
  const out = [];
  $('.result').each((i, el) => {
    const $el = $(el);
    const id = extractIdFromResult($el);
    if (!id) return;
    const a = $el.find('.title h3 a, h3 a').first();
    const title = (a.text() || $el.find('a[title]').attr('title') || '').trim();
    if (!title) return;
    const cover = $el.find('.pic img').attr('src') || '';
    const rating = parseFloat($el.find('.rating_nums').first().text().trim());
    const cm = $el.text().match(/([\d,]+)\s*人评价/);
    const ratingCount = cm ? Number(cm[1].replace(/,/g, '')) : null;
    const castText = ($el.find('.subject-cast').first().text() || '').trim();
    // 「原名:The Walking Dead / 导演 / 主演 / 2021」→ 英文原名。补季链靠它去 TVmaze 找同一部剧
    const om = castText.match(/原名[:：]\s*([^/]+)/);
    out.push({
      doubanId: id,
      title,
      originalTitle: om ? om[1].trim() : '',
      year: pickYear(castText) || pickYear($el.text()),
      posterUrl: cover,
      // 搜索页 cast 行导演位置不稳定，保持空；选中后由 fetchMovieFullInfo 补全
      subtype: '',
      director: '',
      rating: !isNaN(rating) && rating > 0 ? rating : null,
      ratingCount: ratingCount != null && !isNaN(ratingCount) ? ratingCount : null,
      url: `https://movie.douban.com/subject/${id}/`
    });
  });
  return out;
}

async function searchViaSearchPage(keyword) {
  const url = `https://www.douban.com/search?cat=1002&q=${encodeURIComponent(keyword)}`;
  const res = await axios.get(url, {
    headers: {
      'User-Agent': DESKTOP_UA,
      'Referer': 'https://www.douban.com/',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9'
    },
    timeout: SEARCH_TIMEOUT,
    responseType: 'text',
    transformResponse: x => x,
    validateStatus: () => true
  });
  const html = typeof res.data === 'string' ? res.data : '';
  if (res.status >= 400 || !html) {
    console.warn(`/search?cat=1002 status=${res.status} len=${html.length}`);
    return [];
  }
  return parseSearchHtml(html);
}

function pickDirectorFromSubTitle(subTitle) {
  if (!subTitle) return '';
  const parts = String(subTitle).split('/').map(s => s.trim()).filter(Boolean);
  if (parts.length < 4) return '';
  const candidate = parts[3];
  if (/^\d{4}$/.test(candidate)) return '';
  return candidate;
}

// ── TVmaze 补季 ─────────────────────────────────────────────────────────
// 场景：豆瓣对一批分季剧集只对已登录用户开放（《行尸走肉》第 1~7 季……），匿名搜索页 / suggest /
//   rexxar 三条路都只回 8~11 季 + 一堆衍生剧；时光网剧集不分季、主剧也缺。
// 为什么是 TVmaze 而不是 TMDB：api.themoviedb.org 在国内直连被 DNS 污染（解析到 31.13.82.169、
//   TCP 握手不通），云函数出口同样直连，走不了。TVmaze 免 key、国内直连 1~3s、每季独立海报 + 集数。
// TVmaze 只认英文，所以不拿用户的中文关键词去搜——前端从豆瓣已回的候选里抠出
//   { cn: '行尸走肉', en: 'The Walking Dead' }（标题去掉「第X季」+ 搜索页 原名: 字段）作 seasonsFor 传进来，
//   这里按 en 去 TVmaze 找剧（剧名归一化后必须相等，否则宁可不补），拉全部季，
//   再用 cn 拼回豆瓣写法的标题「行尸走肉 第一季」（中文数字），与豆瓣已有的季按片名去重后只剩缺的。
// 候选不带评分（TVmaze 分制与豆瓣不同、也不在全平台评分四格里）；无 doubanId → 前端走外部源分支
//   （跳过 fetchMovieFullInfo），封面 static.tvmaze.com 由 syncDailyLog.mirrorCover 转存 cloud://。
const TVMAZE_API = 'https://api.tvmaze.com';
const TVMAZE_MAX_SHOWS = 2;   // 一次最多补几部剧（每部两次请求：搜剧 + 拉季）
const TVMAZE_MAX = 30;        // 最多补几条季

const CN_DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
// 1 → 一，10 → 十，11 → 十一，21 → 二十一（豆瓣分季标题的写法）
function cnNumber(n) {
  n = Number(n) || 0;
  if (n < 10) return CN_DIGITS[n];
  if (n < 20) return '十' + (n % 10 ? CN_DIGITS[n % 10] : '');
  if (n < 100) return CN_DIGITS[Math.floor(n / 10)] + '十' + (n % 10 ? CN_DIGITS[n % 10] : '');
  return String(n);
}

function tvmazeGet(path) {
  return axios.get(`${TVMAZE_API}${path}`, {
    headers: { 'User-Agent': DESKTOP_UA, 'Accept': 'application/json' },
    timeout: TVMAZE_TIMEOUT,
    responseType: 'json',
    validateStatus: () => true
  }).then(res => {
    if (res.status >= 400) { console.warn(`[tvmaze] ${path} status=${res.status}`); return null; }
    return res.data;
  });
}

// hints: [{ cn, en }]；en 为空则拿 cn 当搜索词（用户直接输了英文名时前端会这么传）
async function seasonsViaTvmaze(hints) {
  const list = (hints || []).filter(h => h && (h.en || h.cn)).slice(0, TVMAZE_MAX_SHOWS);
  const out = [];
  await Promise.all(list.map(async h => {
    const q = String(h.en || h.cn).trim();
    const found = await tvmazeGet(`/search/shows?q=${encodeURIComponent(q)}`).catch(() => null);
    const rows = Array.isArray(found) ? found : [];
    // 剧名必须归一化后相等：TVmaze 搜「The Walking Dead」第二三名是 Fear the Walking Dead / Origins，按分数取会补错剧
    const want = normalizeForMatch(q);
    const hit = rows.map(r => r.show).find(s => s && normalizeForMatch(s.name) === want);
    if (!hit) { console.warn('[tvmaze] 无同名剧:', q); return; }
    const seasons = await tvmazeGet(`/shows/${hit.id}/seasons`).catch(() => null);
    const cn = String(h.cn || hit.name).trim();
    // 候选列表用 medium（210×295，~20 KB，国内直连 1s 内）；original_untouched 是 2~3 MB、手机上 20s 都拉不完，
    // 只放进 posterLarge 供落库时服务端镜像成 cloud://（分享海报要大图）
    const pick = (img, k) => (img && img[k]) || '';
    const showPoster = pick(hit.image, 'medium') || pick(hit.image, 'original');
    const showPosterLarge = pick(hit.image, 'original') || showPoster;
    (Array.isArray(seasons) ? seasons : []).forEach(se => {
      const n = Number(se.number) || 0;
      if (n <= 0) return;
      out.push({
        source: 'tvmaze', tvmazeId: String(hit.id), tvmazeSeason: n, doubanId: '',
        title: `${cn} 第${cnNumber(n)}季`,
        titleEn: `${hit.name} Season ${n}`,
        year: pickYear(se.premiereDate) || pickYear(hit.premiered),
        posterUrl: pick(se.image, 'medium') || pick(se.image, 'original') || showPoster,
        posterLarge: pick(se.image, 'original') || pick(se.image, 'medium') || showPosterLarge,
        subtype: 'tv', director: '',
        totalEpisodes: Number(se.episodeOrder) || 0,   // 给「看到第几集」进度条一个分母
        rating: null, ratingCount: null,
        url: `https://www.tvmaze.com/seasons/${se.id}`
      });
    });
  }));
  return out.slice(0, TVMAZE_MAX);
}

// ── 时光网（Mtime）替补搜索 ─────────────────────────────────────────────
// 场景：豆瓣对含成人内容的影片正片，仅对已登录用户开放搜索，匿名爬虫搜不到
//   （如《蓝丝绒》《巴黎野玫瑰》）。时光网无此登录墙，用它兜底把正片补进候选。
// 接口：front-gateway.mtime.com 的 unionSearch2，免登录直出结构化 JSON。
//   type=1 = 影视；data.movies 为结果数组（部分地区/IP 会返回 null，容错为空即可）。
// 注意：时光网候选无 doubanId，无法走 fetchMovieFullInfo 抓全平台评分——
//   前端据 source==='mtime' 跳过评分抓取、仅按时光网自带字段展示/记录。
const MTIME_SEARCH_API = 'https://front-gateway.mtime.com/mtime-search/search/unionSearch2';
const MTIME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

async function searchViaMtime(keyword) {
  const url = `${MTIME_SEARCH_API}?keyword=${encodeURIComponent(keyword)}&type=1&pageIndex=1&pageSize=20`;
  const res = await axios.get(url, {
    headers: {
      'User-Agent': MTIME_UA,
      'Referer': 'https://film.mtime.com/',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'zh-CN,zh;q=0.9'
    },
    timeout: MTIME_TIMEOUT,
    responseType: 'json',
    validateStatus: () => true
  });
  const data = res && res.data && res.data.data;
  const movies = (data && Array.isArray(data.movies)) ? data.movies : [];
  return movies
    .filter(m => m && m.movieId && m.name && (m.movieContentType === '电影' || m.movieContentType === '电视剧'))
    .map(m => {
      const director = Array.isArray(m.directors) && m.directors.length ? m.directors[0] : '';
      // 时光网封面均为 jpg（iOS 可正常渲染），直接用原图直链
      const poster = m.img || '';
      const year = m.year || m.rYear || '';
      return {
        source: 'mtime',
        mtimeId: String(m.movieId),
        doubanId: '',
        title: m.name,
        titleEn: m.nameEn || '',
        year: year ? String(year) : '',
        posterUrl: poster,
        subtype: m.movieContentType === '电视剧' ? 'tv' : '',
        director,
        movieType: m.movieType || '',
        rating: null,
        ratingCount: null,
        url: m.href ? (m.href.indexOf('http') === 0 ? m.href : `https://movie.mtime.com/${m.movieId}/`) : `https://movie.mtime.com/${m.movieId}/`
      };
    });
}

// 时光网最多补几条。它是兜底，不是第二份搜索结果——豆瓣正常时一条都不该冒出来。
const MTIME_MAX = 5;

// 时光网候选的相关性闸门。
// 时光网搜索是**拆字匹配**的：搜「蓝丝绒」它按「蓝」和「丝绒」各自去撞，
// 于是《蓝莓之夜》《碧海蓝天》《蓝精灵》《魂断蓝桥》《丝绒爪》全回来；
// 搜「盗梦空间」则把所有带「空间」的片倒出来。这些条目还都没有评分，
// 混在豆瓣结果后面看着像一堆坏数据。
// 规则：片名必须整体包含关键词，或关键词整体包含片名（后者管「搜得比片名长」的情况）。
// 对照实测：「蓝丝绒」只留《蓝丝绒》；「盗梦空间」时光网一条都不留（豆瓣那 5 条本来就够）。
function mtimeRelevant(keyword, title) {
  const k = normalizeForMatch(keyword);
  const t = normalizeForMatch(title);
  if (!k || !t) return false;
  if (t.indexOf(k) >= 0) return true;          // 片名整体包含关键词
  // 反向（关键词比片名长）只容忍差一个字，多半是用户带了序号：「教父2」→《教父》。
  // 放宽一点就会把单字片名放进来 ——《蓝》能命中「蓝丝绒」、《空间》能命中「盗梦空间」。
  return k.indexOf(t) >= 0 && t.length >= 2 && t.length >= k.length - 1;
}

// 匹配/去重共用的归一化：去空白与常见标点、小写
function normalizeForMatch(text) {
  return String(text || '')
    .replace(/[\s　]+/g, '')
    .replace(/[·・:：\-—_（）()【】\[\]"'"'!！?？、,，.。/]/g, '')
    .toLowerCase();
}

// 归一化「片名+年份」用于跨源去重：去空白/标点、小写；年份直接比字符串
function dedupeKeyOf(title, year) {
  return `${normalizeForMatch(title)}@${String(year || '')}`;
}

// 回退：电影 suggest（前缀匹配，仅标题/年份/封面，无评分）
async function suggestFallback(keyword) {
  try {
    const res = await axios.get(`https://movie.douban.com/j/subject_suggest?q=${encodeURIComponent(keyword)}`, {
      headers: { 'User-Agent': SUGGEST_UA, 'Referer': 'https://movie.douban.com/' },
      timeout: SUGGEST_TIMEOUT, responseType: 'json', validateStatus: () => true
    });
    const raw = Array.isArray(res.data) ? res.data : [];
    return raw
      .filter(item => item && item.type === 'movie' && item.id)
      .map(item => ({
        doubanId: String(item.id),
        title: item.title || '',
        year: item.year || '',
        posterUrl: item.img || '',
        subtype: item.sub_title || '',
        director: pickDirectorFromSubTitle(item.sub_title),
        rating: null,
        ratingCount: null,
        url: item.url || `https://movie.douban.com/subject/${item.id}/`
      }));
  } catch (e) {
    console.warn('suggest 回退失败:', e && e.message);
    return [];
  }
}

exports.main = async (event, context) => {
  const keyword = (event && event.keyword || '').trim();
  // includeMtime：仅每日电影（pages/daily/movie/add）传，用时光网兜底补正片；
  // pages/movie-search（全平台评分查询）不传 → 行为完全不变、纯豆瓣。
  const includeMtime = !!(event && event.includeMtime);
  // seasonsFor：补季模式（每日电影第二趟调用）。只跑 TVmaze，不碰豆瓣/时光网，见 seasonsViaTvmaze 注
  const seasonsFor = (event && Array.isArray(event.seasonsFor)) ? event.seasonsFor : null;
  if (seasonsFor) {
    try {
      const raw = await withDeadline(
        seasonsViaTvmaze(seasonsFor).catch(e => { console.warn('TVmaze 补季失败:', e && e.message); return []; }),
        TVMAZE_BUDGET, [], 'TVmaze 补季');
      const seenTitle = new Set();
      const candidates = [];
      raw.forEach(c => {
        const t = normalizeForMatch(c.title);
        if (!t || seenTitle.has(t)) return;
        seenTitle.add(t);
        candidates.push({ ...c, key: `tv${c.tvmazeId}s${c.tvmazeSeason}` });
      });
      return { success: true, candidates, keyword };
    } catch (err) {
      console.error('searchMovieByTitle 补季失败:', err && err.message);
      return { success: false, error: err && err.message, keyword };
    }
  }
  if (!keyword) {
    return { success: false, error: 'EMPTY_KEYWORD' };
  }

  try {
    // 豆瓣主链（/search 结果页 → suggest 回退）与时光网并行，互不阻塞
    const doubanPromise = (async () => {
      let list = [];
      try {
        list = await searchViaSearchPage(keyword);
      } catch (e) {
        console.warn('/search 抓取异常，走回退:', e && e.message);
      }
      if (!list.length) {
        list = await suggestFallback(keyword);
      }
      return list;
    })();
    const mtimePromise = includeMtime
      ? searchViaMtime(keyword).catch(e => { console.warn('时光网搜索失败:', e && e.message); return []; })
      : Promise.resolve([]);

    // 整体再兜一道：到点就用已有的交差，保证函数一定能返回而不是被平台杀掉
    const [doubanRaw, mtimeRaw] = await withDeadline(
      Promise.all([doubanPromise, mtimePromise]),
      TOTAL_BUDGET,
      [[], []],
      '整体'
    );

    // 豆瓣候选：按 doubanId 去重、保序，打上 source/key
    const seenId = new Set();
    const seenKey = new Set();
    const candidates = [];
    doubanRaw.forEach(c => {
      if (!c.doubanId || seenId.has(c.doubanId)) return;
      seenId.add(c.doubanId);
      seenKey.add(dedupeKeyOf(c.title, c.year));
      candidates.push({ ...c, source: 'douban', key: `db${c.doubanId}` });
    });

    // 时光网候选：先过相关性闸门，再跳过豆瓣已有的，最多补 MTIME_MAX 条（都无评分）。
    // 这里的去重比豆瓣侧松一档 —— **只比片名不比年份**：同名不同年多半是两边元数据差一年
    // （豆瓣《重访蓝丝绒》2016 / 时光网 2015 就是同一部），按 片名+年份 比会放它重复进来。
    const seenTitle = new Set();
    candidates.forEach(c => seenTitle.add(normalizeForMatch(c.title)));
    let mtimeAdded = 0;
    mtimeRaw.forEach(m => {
      if (mtimeAdded >= MTIME_MAX) return;
      if (!mtimeRelevant(keyword, m.title)) return;
      const t = normalizeForMatch(m.title);
      if (seenTitle.has(t)) return;
      seenTitle.add(t);
      candidates.push({ ...m, key: `mt${m.mtimeId}` });
      mtimeAdded++;
    });

    return { success: true, candidates, keyword };
  } catch (err) {
    console.error('searchMovieByTitle 失败:', err && err.message);
    return {
      success: false,
      error: err && err.message,
      code: err && err.code,
      keyword
    };
  }
};
