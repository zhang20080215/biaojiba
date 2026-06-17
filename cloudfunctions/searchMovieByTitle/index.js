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
  if (!keyword) {
    return { success: false, error: 'EMPTY_KEYWORD' };
  }

  try {
    let candidates = [];
    try {
      candidates = await searchViaSearchPage(keyword);
    } catch (e) {
      console.warn('/search 抓取异常，走回退:', e && e.message);
    }
    if (!candidates.length) {
      candidates = await suggestFallback(keyword);
    }

    // 按 doubanId 去重，保序
    const seen = new Set();
    candidates = candidates.filter(c => {
      if (!c.doubanId || seen.has(c.doubanId)) return false;
      seen.add(c.doubanId);
      return true;
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
