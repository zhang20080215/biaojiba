// 入参: { keyword: string }
// 主用豆瓣搜索结果页 www.douban.com/search?cat=1001（cat=1001=书籍）：
//   - 模糊匹配（"射雕" 能出 "射雕英雄传"）
//   - 服务端直出 HTML，一次请求即含 评分 / 评价人数(精确) / 作者 / 出版社 / 年份 / 封面
//   - 无需逐本二次抓详情，性能最佳
// HTML 被封/为空时回退 book.douban.com/j/subject_suggest（仅书名/年份，前缀匹配）。
// 注：/j/search?cat=1001（XHR JSON）对云端 IP 返回 403，不可用；这里用的是 /search 页面 HTML。
// 返回: { success, candidates: [{doubanId, title, year, posterUrl, author, publisher, rating, ratingCount, url}] }

const cloud = require('wx-server-sdk');
const axios = require('axios');
const cheerio = require('cheerio');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

function cleanAuthor(a) {
  return String(a || '').replace(/\s*(著|编著|主编|编|译)\s*$/, '').trim();
}

// cast 行 "金庸 / 生活·读书·新知三联书店 / 1999 / 39.00元" → {author, publisher, year}
const PRICE_RE = /(元|¥|\$|USD|HKD|GBP|EUR|CNY)\s*$|^\d+\.\d{1,2}$/;
function parseCast(text) {
  let parts = String(text || '').split('/').map(s => s.trim()).filter(Boolean);
  const out = { author: '', publisher: '', year: '' };
  if (!parts.length) return out;
  if (PRICE_RE.test(parts[parts.length - 1])) parts.pop();
  if (parts.length) {
    const last = parts[parts.length - 1];
    if (/^\d{4}(-\d{1,2})?$/.test(last)) { out.year = last.slice(0, 4); parts.pop(); }
    else { const ym = last.match(/(\d{4})/); if (ym) out.year = ym[1]; }
  }
  if (parts.length) {
    if (!/^\d{4}/.test(parts[0])) out.author = cleanAuthor(parts[0]);
    if (parts.length >= 2) out.publisher = parts[parts.length - 1];
  }
  return out;
}

function extractIdFromResult($el) {
  // 优先 onclick 里的 sid: 1044547
  const onclick = $el.find('a[onclick]').attr('onclick') || '';
  const m1 = onclick.match(/sid:\s*(\d+)/);
  if (m1) return m1[1];
  // 兜底：link2 href 把真实地址 url-encode 了（subject%2F123），解码后取
  const href = $el.find('a').attr('href') || '';
  let dec = href;
  try { dec = decodeURIComponent(href); } catch (e) { /* keep */ }
  const m2 = dec.match(/subject\/(\d+)/);
  return m2 ? m2[1] : '';
}

// 解析 /search?cat=1001 结果页 HTML
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
    const cast = parseCast($el.find('.subject-cast').first().text());
    out.push({
      doubanId: id,
      title,
      year: cast.year || '',
      posterUrl: cover,
      author: cast.author || '',
      publisher: cast.publisher || '',
      rating: !isNaN(rating) && rating > 0 ? rating : null,
      ratingCount: ratingCount != null && !isNaN(ratingCount) ? ratingCount : null,
      url: `https://book.douban.com/subject/${id}/`
    });
  });
  return out;
}

async function searchViaSearchPage(keyword) {
  const url = `https://www.douban.com/search?cat=1001&q=${encodeURIComponent(keyword)}`;
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
    console.warn(`/search?cat=1001 status=${res.status} len=${html.length}`);
    return [];
  }
  return parseSearchHtml(html);
}

// 回退：图书 suggest（前缀匹配，仅书名/年份/封面）
async function suggestFallback(keyword) {
  try {
    const res = await axios.get(`https://book.douban.com/j/subject_suggest?q=${encodeURIComponent(keyword)}`, {
      headers: { 'User-Agent': DESKTOP_UA, 'Referer': 'https://book.douban.com/' },
      timeout: 10000, responseType: 'json', validateStatus: () => true
    });
    const raw = Array.isArray(res.data) ? res.data : [];
    return raw
      .filter(it => it && it.id && (!it.type || it.type === 'b' || it.type === 'book'))
      .map(it => ({
        doubanId: String(it.id),
        title: it.title || '',
        year: it.year || '',
        posterUrl: it.pic || it.img || '',
        author: cleanAuthor(it.author_name),
        publisher: '',
        rating: null,
        ratingCount: null,
        url: it.url || `https://book.douban.com/subject/${it.id}/`
      }));
  } catch (e) {
    console.warn('suggest 回退失败:', e && e.message);
    return [];
  }
}

exports.main = async (event, context) => {
  const keyword = (event && event.keyword || '').trim();
  if (!keyword) return { success: false, error: 'EMPTY_KEYWORD' };

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
    console.error('searchBookByTitle 失败:', err && err.message);
    return { success: false, error: err && err.message, code: err && err.code, keyword };
  }
};
