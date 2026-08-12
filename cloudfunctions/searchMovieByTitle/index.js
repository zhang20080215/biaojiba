// 入参: { keyword: string }
// 主用豆瓣搜索结果页 www.douban.com/search?cat=1002（cat=1002=电影）：
//   - 模糊匹配（"盗梦" 能出 "盗梦空间"）
//   - 服务端直出 HTML，一次请求即含 评分 / 评价人数 / 年份 / 封面
//   - 比 suggest 联想接口字段更全（suggest 只回标题/年份/封面，无评分）
// HTML 被封/为空时回退 movie.douban.com/j/subject_suggest（前缀匹配，原有逻辑）。
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
    out.push({
      doubanId: id,
      title,
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
    timeout: 12000,
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
    timeout: 10000,
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

// 归一化「片名+年份」用于跨源去重：去空白/标点、小写；年份直接比字符串
function dedupeKeyOf(title, year) {
  const t = String(title || '')
    .replace(/[\s　]+/g, '')
    .replace(/[·・:：\-—_（）()【】\[\]"'"'!！?？、,，.。/]/g, '')
    .toLowerCase();
  return `${t}@${String(year || '')}`;
}

// 回退：电影 suggest（前缀匹配，仅标题/年份/封面，无评分）
async function suggestFallback(keyword) {
  try {
    const res = await axios.get(`https://movie.douban.com/j/subject_suggest?q=${encodeURIComponent(keyword)}`, {
      headers: { 'User-Agent': SUGGEST_UA, 'Referer': 'https://movie.douban.com/' },
      timeout: 10000, responseType: 'json', validateStatus: () => true
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

    const [doubanRaw, mtimeRaw] = await Promise.all([doubanPromise, mtimePromise]);

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

    // 时光网候选：豆瓣已有（同片名+年份）的跳过，其余追加到末尾（无评分）
    mtimeRaw.forEach(m => {
      const k = dedupeKeyOf(m.title, m.year);
      if (seenKey.has(k)) return;
      seenKey.add(k);
      candidates.push({ ...m, key: `mt${m.mtimeId}` });
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
