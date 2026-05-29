// 入参: { doubanId: string, openid?: string, forceRefresh?: boolean }
// 流程：
//   1. 当日缓存命中 → 直接返回 searched_movies 数据
//   2. 否则爬豆瓣详情页（评分 + 评分人数 + IMDB ID + 海报 + 元数据）
//   3. 有 IMDB ID 且 OMDB_API_KEY 配置 → 调 OMDb API 拿 IMDB 评分 + 烂番茄 Tomatometer
//   4. 用英文片名搜 RT slug → 抓 RT 详情页 HTML → 提 critic (Tomatometer) + audience (Popcornmeter) 双分
//      失败时回退到 OMDb 的 Tomatometer 单分
//   5. upsert searched_movies + user_movie_queries
//   6. 返回完整文档
// 环境变量：OMDB_API_KEY（缺失时 imdb / rottenTomatoes.critic 返回 null）
//
// rottenTomatoes 字段结构（新）：
//   {
//     critic:   { score: '97%', state: 'certified-fresh' } | null,  // Tomatometer 影评人
//     audience: { score: '98%', state: 'upright' }        | null,  // Popcornmeter 观众
//     score:    '97%' | null,   // 旧版前端兼容字段，镜像 critic.score
//     fetchedAt: Date
//   }

const cloud = require('wx-server-sdk');
const axios = require('axios');
const cheerio = require('cheerio');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const moviesCollection = db.collection('searched_movies');
const queriesCollection = db.collection('user_movie_queries');

// 限流规则：同一自然日(中国时区 UTC+8) 内只允许查一次。00:00 重置。
// 设计目的：保护 OMDb 配额 (1000/日) + 防止豆瓣反爬升级。
const CN_TZ_OFFSET_MS = 8 * 60 * 60 * 1000;

function cnDateStr(ts) {
  const d = new Date(ts + CN_TZ_OFFSET_MS);
  return d.toISOString().slice(0, 10);
}

function msUntilNextCnDay(nowMs) {
  const cnNow = new Date(nowMs + CN_TZ_OFFSET_MS);
  const cnMsIntoDay =
    cnNow.getUTCHours() * 3600000 +
    cnNow.getUTCMinutes() * 60000 +
    cnNow.getUTCSeconds() * 1000 +
    cnNow.getUTCMilliseconds();
  return 24 * 3600000 - cnMsIntoDay;
}

// 豆瓣桌面端详情页反爬严，会 302 到 sec.douban.com 安全挑战页（需 JS 执行才能过）；
// 改走移动端 m.douban.com + iPhone UA，反爬明显宽松（fetchImdbMovies 已验证可用）
function buildDoubanHeaders() {
  return {
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.3 Mobile/15E148 Safari/604.1',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Referer': 'https://m.douban.com/'
  };
}

function buildRexxarUrl(doubanId) {
  return `https://m.douban.com/rexxar/api/v2/movie/${doubanId}`;
}

function buildMobileDetailUrl(doubanId) {
  return `https://m.douban.com/movie/subject/${doubanId}/`;
}

// frodo 路径在实测中始终返回 400 invalid_request_997（apikey 已被豆瓣废弃），
// 已弃用。保留函数签名为空实现，主流程靠 OMDb 按 original_title 反查搞定 IMDb ID。
async function fetchImdbIdFromFrodo(_doubanId) {
  return null;
}

// 从 m.douban.com 详情页 HTML 里提 IMDB ID，多种 pattern 都试一遍
function extractImdbIdFromHtml(html) {
  if (!html) return null;
  const patterns = [
    /IMDb:?\s*(tt\d+)/i,
    /imdb_id["']?\s*[:=]\s*["']?(tt\d+)/i,
    /imdb\.com\/title\/(tt\d+)/i,
    /["']?imdb["']?\s*:\s*["'](tt\d+)["']/i,
    /\btt(\d{7,})\b/  // 兜底：找任意 tt + 7~8 位数字
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m) {
      const id = m[1].startsWith('tt') ? m[1] : 'tt' + m[1];
      return id;
    }
  }
  return null;
}


async function downloadAndUploadPoster(imageUrl, movieDocId) {
  if (!imageUrl) return null;
  try {
    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 15000,
      headers: buildDoubanHeaders()
    });
    const fileName = `searched_movie_covers/${movieDocId}_${Date.now()}.jpg`;
    const uploadResult = await cloud.uploadFile({
      cloudPath: fileName,
      fileContent: response.data
    });
    return uploadResult && uploadResult.fileID ? uploadResult.fileID : null;
  } catch (e) {
    console.error('海报下载/上传失败:', e && e.message);
    return null;
  }
}

// 并发调 rexxar JSON 接口（拿结构化主数据）+ 移动端详情页 HTML（仅用来正则提 IMDB ID）
// rexxar JSON 不返 imdb_id；HTML 接口反爬比桌面端 movie.douban.com 宽松（实测 200）
async function scrapeDoubanDetail(doubanId) {
  const headers = buildDoubanHeaders();

  const [rexxarRes, htmlRes, frodoImdbId] = await Promise.all([
    axios.get(buildRexxarUrl(doubanId), {
      headers,
      timeout: 15000,
      responseType: 'json'
    }),
    axios.get(buildMobileDetailUrl(doubanId), {
      headers,
      timeout: 15000,
      responseType: 'text',
      validateStatus: () => true
    }).catch(e => {
      console.warn('mobile_detail 抓取失败（不影响主流程）:', e && e.message);
      return { data: '' };
    }),
    fetchImdbIdFromFrodo(doubanId)
  ]);

  const j = (rexxarRes && rexxarRes.data) || {};
  const html = typeof (htmlRes && htmlRes.data) === 'string' ? htmlRes.data : '';

  // IMDB ID 提取优先级：frodo API > HTML 正则（m.douban HTML 实际不渲染 IMDb 字段，仅作兜底）
  let imdbId = frodoImdbId || extractImdbIdFromHtml(html);
  if (!imdbId) {
    console.log(`[scrapeDoubanDetail] IMDB ID 在 frodo / HTML 都未提取到（doubanId=${j.id || ''})，可能这部豆瓣未关联 IMDB`);
  } else {
    console.log(`[scrapeDoubanDetail] IMDB ID 命中: ${imdbId} (来源: ${frodoImdbId ? 'frodo' : 'html'})`);
  }

  // 从 rexxar 提其余结构化字段
  const title = j.title || '';
  const year = j.year || '';
  const posterUrl = j.cover_url || (j.pic && (j.pic.large || j.pic.normal)) || '';
  const genres = Array.isArray(j.genres) ? j.genres : [];
  const countries = Array.isArray(j.countries) ? j.countries : [];
  const languages = Array.isArray(j.languages) ? j.languages : [];
  const durations = Array.isArray(j.durations) ? j.durations : [];
  const directors = Array.isArray(j.directors)
    ? j.directors.map(d => d && d.name).filter(Boolean)
    : [];
  const rating = j.rating && j.rating.value != null ? Number(j.rating.value) : null;
  const votes = j.rating && j.rating.count != null ? Number(j.rating.count) : null;
  const intro = j.intro || '';

  const aka = Array.isArray(j.aka) ? j.aka : [];
  const originalTitle = j.original_title || '';

  return {
    title,
    originalTitle,
    year,
    posterUrl,
    directors,
    genres,
    countries,
    languages,
    durations,
    intro,
    aka,
    imdbId,
    douban: {
      rating: !isNaN(rating) ? rating : null,
      votes: !isNaN(votes) ? votes : null
    }
  };
}

// 从 detail 里挑一个英文标题用来 OMDb 反查：original_title 优先，否则 aka 里找不含中文字符的
function pickEnglishTitle(detail) {
  if (detail.originalTitle && !/[一-龥]/.test(detail.originalTitle)) {
    return detail.originalTitle;
  }
  if (Array.isArray(detail.aka)) {
    for (const a of detail.aka) {
      if (a && !/[一-龥]/.test(a)) return a;
    }
  }
  return null;
}

// 调 OMDb API，支持两种查询模式：
//   按 IMDB ID 精确查（imdbId 传入）
//   按片名 + 年份反查（title 传入，year 选填）
// 返回 { imdb, rottenTomatoes, imdbId, reason }
//   imdbId 在按 title 查时来自 OMDb 返回，用于补全豆瓣未提供的 IMDB 关联
async function fetchOmdb({ imdbId, title, year }) {
  const apiKey = process.env.OMDB_API_KEY;
  if (!apiKey) return { imdb: null, rottenTomatoes: null, imdbId: null, reason: 'no_api_key' };

  let url;
  if (imdbId) {
    url = `https://www.omdbapi.com/?i=${encodeURIComponent(imdbId)}&apikey=${encodeURIComponent(apiKey)}`;
  } else if (title) {
    const yearPart = year ? `&y=${encodeURIComponent(year)}` : '';
    url = `https://www.omdbapi.com/?t=${encodeURIComponent(title)}${yearPart}&apikey=${encodeURIComponent(apiKey)}`;
  } else {
    return { imdb: null, rottenTomatoes: null, imdbId: null, reason: 'no_query' };
  }

  try {
    const res = await axios.get(url, { timeout: 10000, responseType: 'json' });
    const data = res.data || {};
    if (data.Response === 'False') {
      return { imdb: null, rottenTomatoes: null, imdbId: null, reason: 'omdb_not_found' };
    }

    const imdbRating = parseFloat(data.imdbRating);
    const imdbVotes = parseInt(String(data.imdbVotes || '').replace(/,/g, ''), 10);
    const imdb = !isNaN(imdbRating) ? {
      rating: imdbRating,
      votes: !isNaN(imdbVotes) ? imdbVotes : null
    } : null;

    const rt = (data.Ratings || []).find(r => r && r.Source === 'Rotten Tomatoes');
    const rottenTomatoes = rt ? { score: rt.Value } : null;

    return {
      imdb,
      rottenTomatoes,
      imdbId: data.imdbID || imdbId || null,  // OMDb 返回的是 imdbID（大小写敏感）
      reason: 'ok'
    };
  } catch (e) {
    console.error('OMDb 调用失败:', e && e.message);
    return { imdb: null, rottenTomatoes: null, imdbId: null, reason: 'omdb_error' };
  }
}

// ========== 烂番茄抓取 ==========
// OMDb 只返 Tomatometer（影评人），不返 Popcornmeter（观众）。
// 自行抓 rottentomatoes.com 详情页：先用 napi/search 找 slug，再抓 /m/<slug> HTML 提双分。
//
// 失败一律静默返回 null，主流程会回退到 OMDb 的 Tomatometer 单分，保证整条链路降级可用。
const RT_DESKTOP_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9'
};

function extractFirstMatch(text, patterns) {
  if (!text) return null;
  for (const p of patterns) {
    const m = text.match(p);
    if (m && m[1]) return m[1];
  }
  return null;
}

// 实测 2026-05：RT 把 napi/search/* 全下线（统一 404）。
// 改走公开搜索页 HTML：/search?search=<title>
// 关键点：RT 的搜索结果页本身就把分数和 slug 嵌在 <search-page-media-row> 自定义元素属性里，
// 一次请求就能拿全。失败时再回退到 /m/<slug> 详情页抓。
async function searchRottenTomatoesViaSearchPage(title, year) {
  if (!title) return null;
  const yearStr = year ? String(year) : '';
  const url = `https://www.rottentomatoes.com/search?search=${encodeURIComponent(title)}`;

  try {
    const res = await axios.get(url, {
      timeout: 15000,
      headers: { ...RT_DESKTOP_HEADERS, 'Accept': 'text/html' },
      responseType: 'text',
      transformResponse: x => x,
      validateStatus: () => true
    });
    const status = res.status;
    const html = typeof res.data === 'string' ? res.data : '';
    console.log(`[RT] search-page status=${status} htmlLen=${html.length}`);
    if (status >= 400 || !html) {
      console.log(`[RT] search-page 失败响应前 400 字:`, html.slice(0, 400));
      return null;
    }

    // RT 不同模板用的 row 元素名不同，多 pattern 兜底
    const rowPatterns = [
      /<search-page-media-row[\s\S]*?<\/search-page-media-row>/gi,
      /<search-page-row[\s\S]*?<\/search-page-row>/gi
    ];
    let rowMatches = [];
    for (const p of rowPatterns) {
      const m = html.match(p);
      if (m && m.length > 0) { rowMatches = m; break; }
    }
    console.log(`[RT] search-page 抽到 ${rowMatches.length} 个 row`);

    if (rowMatches.length === 0) {
      // 没匹配到 row，打印含 'search-page' 的关键段，方便诊断真实 DOM 结构
      const idx = html.indexOf('search-page');
      const slice = idx > 0 ? html.slice(idx, idx + 800) : html.slice(0, 800);
      console.log(`[RT] search-page 未匹配 row 标签，HTML 关键段:`, slice);
      return null;
    }

    // 真实 search row 结构 (2026-05 实测)：
    //   <search-page-media-row
    //      release-year="1972"
    //      tomatometer-score="97"
    //      tomatometer-sentiment="POSITIVE"           // POSITIVE / NEGATIVE / NONE
    //      tomatometer-is-certified="true">
    //      ...
    //      <a href="https://www.rottentomatoes.com/m/the_godfather" slot="title">...</a>
    //   </search-page-media-row>
    // ⚠️ search 页只有 Tomatometer，没有 audience score —— audience 必须抓详情页才能拿
    function parseRow(rowHtml) {
      const get = (attr) => {
        // 用 \s 边界避免 release-year 被 tomatometer-is-certified 中的 year 等子串误匹配
        const m = rowHtml.match(new RegExp(`\\s${attr}=["']([^"']*)["']`, 'i'));
        return m ? m[1] : null;
      };
      // slug 兼容绝对路径 https://www.rottentomatoes.com/m/<slug> 与相对路径 /m/<slug>
      let slug = null;
      const linkMatch = rowHtml.match(/href=["'][^"']*\/m\/([^"'\/?#]+)/i);
      if (linkMatch) slug = linkMatch[1];
      // 显示名兜底，找 data-qa="info-name" 的 a 标签 textContent
      const titleMatch = rowHtml.match(/data-qa=["']info-name["'][^>]*>([\s\S]*?)</i);
      const showTitle = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : '';
      return {
        slug,
        title: showTitle,
        year: get('release-year'),
        tomato: get('tomatometer-score'),
        tomatoSentiment: get('tomatometer-sentiment'),  // POSITIVE / NEGATIVE / NONE
        tomatoIsCertified: get('tomatometer-is-certified') === 'true'
      };
    }

    const rows = rowMatches.map(parseRow).filter(r => r.slug);
    console.log(`[RT] search-page 有效 row=${rows.length}:`,
      JSON.stringify(rows.slice(0, 5)).slice(0, 500));

    if (rows.length === 0) return null;

    // 优先按年份精确匹配，避免 Titanic 1953 / Titanic 1997 这种重名
    let pick = null;
    if (yearStr) pick = rows.find(r => r.year === yearStr) || null;
    if (!pick) pick = rows[0];

    console.log(`[RT] search-page 选中: slug=${pick.slug} year=${pick.year} tomato=${pick.tomato} sentiment=${pick.tomatoSentiment} certified=${pick.tomatoIsCertified}`);

    // 由 sentiment + isCertified 反推 critic state（详情页那边没显式 state 属性）
    let criticState = null;
    if (pick.tomato) {
      if (pick.tomatoSentiment === 'POSITIVE') {
        criticState = pick.tomatoIsCertified ? 'certified-fresh' : 'fresh';
      } else if (pick.tomatoSentiment === 'NEGATIVE') {
        criticState = 'rotten';
      }
    }

    return {
      slug: pick.slug,
      critic: pick.tomato ? { score: pick.tomato + '%', state: criticState } : null,
      audience: null  // search 页面不提供，留给详情页抓
    };
  } catch (e) {
    console.warn('[RT] search-page 异常:', e && e.message);
    return null;
  }
}

// 从 <rt-text slot="<slotName>">...XX%...</rt-text> 标签里提百分数
// shadow DOM 内容会插在 light DOM 里，标签里通常混着 <style> / <span>，所以先抓整段 inner，
// 再从 inner 里找 N% 数字
function extractScoreInRtText(html, slotName) {
  const tagRe = new RegExp(`<rt-text[^>]*slot=["']${slotName}["'][^>]*>([\\s\\S]*?)<\\/rt-text>`, 'i');
  const m = html.match(tagRe);
  if (!m) return null;
  const inner = m[1];
  const scoreMatch = inner.match(/(\d{1,3})\s*%/);
  return scoreMatch ? scoreMatch[1] : null;
}

// 从 <rt-link slot="<slotName>">...123,456+ Ratings...</rt-link> 标签里提评分人数
function extractCountInRtLink(html, slotName) {
  const tagRe = new RegExp(`<rt-link[^>]*slot=["']${slotName}["'][^>]*>([\\s\\S]*?)<\\/rt-link>`, 'i');
  const m = html.match(tagRe);
  if (!m) return null;
  const inner = m[1];
  // 匹配 "250,000+ Ratings" 或 "155 Reviews"
  const countMatch = inner.match(/([\d,]+\+?)\s*(?:Ratings?|Reviews?)/i);
  return countMatch ? countMatch[1] : null;
}

// 抓 RT 详情页 HTML 提双分。
// 实测 2026-05 真实模板（用户从 m/the_godfather 反推）：
//   <rt-text slot="critics-score">XX%</rt-text>     ← Tomatometer
//   <rt-text slot="audience-score">XX%</rt-text>    ← Popcornmeter
//   <rt-link slot="critics-reviews">N Reviews</rt-link>
//   <rt-link slot="audience-reviews">N+ Ratings</rt-link>
// 同时保留旧模板（score-board 属性式）兜底
async function fetchRottenTomatoesDetail(slug) {
  if (!slug) return null;
  const url = `https://www.rottentomatoes.com/m/${slug}`;
  try {
    const res = await axios.get(url, {
      timeout: 15000,
      headers: { ...RT_DESKTOP_HEADERS, 'Accept': 'text/html' },
      responseType: 'text',
      transformResponse: x => x,
      validateStatus: () => true
    });
    const html = typeof res.data === 'string' ? res.data : '';
    const status = res.status;
    console.log(`[RT] detail status=${status} htmlLen=${html.length} slug=${slug}`);
    if (status >= 400 || !html) {
      console.log(`[RT] detail 失败响应前 400 字:`, html.slice(0, 400));
      return null;
    }

    // 新模板：rt-text slot="critics-score" / slot="audience-score"
    let criticScore = extractScoreInRtText(html, 'critics-score');
    let audienceScore = extractScoreInRtText(html, 'audience-score');

    // 旧模板属性兜底（万一某些片仍走 score-board）
    if (!criticScore) {
      criticScore = extractFirstMatch(html, [
        /tomatometerscore=["'](\d{1,3})["']/i,
        /slot=["']criticsScore["'][^>]*>\s*(\d{1,3})\s*%/i  // 驼峰命名兜底
      ]);
    }
    if (!audienceScore) {
      audienceScore = extractFirstMatch(html, [
        /audiencescore=["'](\d{1,3})["']/i,
        /slot=["']audienceScore["'][^>]*>\s*(\d{1,3})\s*%/i
      ]);
    }

    // 评分人数 (新模板)
    const criticCount = extractCountInRtLink(html, 'critics-reviews');
    const audienceCount = extractCountInRtLink(html, 'audience-reviews');

    // state（fresh/rotten/certified-fresh/upright/spilled），rt-text 可能用 state 属性，没有就 null
    const criticState = extractFirstMatch(html, [
      /<rt-text[^>]*slot=["']critics-score["'][^>]*state=["']([\w-]+)["']/i,
      /tomatometerstate=["']([\w-]+)["']/i
    ]);
    const audienceState = extractFirstMatch(html, [
      /<rt-text[^>]*slot=["']audience-score["'][^>]*state=["']([\w-]+)["']/i,
      /audiencestate=["']([\w-]+)["']/i
    ]);

    console.log(`[RT] detail 解析: critic=${criticScore}% (${criticCount} reviews) audience=${audienceScore}% (${audienceCount} ratings)`);

    if (!criticScore && !audienceScore) {
      console.log(`[RT] detail 未提取到任何分数 slug=${slug}, HTML 含 'rt-text' 数量:`, (html.match(/<rt-text/gi) || []).length);
      // 打印第一个含 'score' 的 rt-text 标签上下文，方便诊断真实模板
      const idx = html.search(/<rt-text[^>]*(score|Score)/);
      if (idx > 0) {
        console.log(`[RT] detail rt-text score 节点片段:`, html.slice(idx, idx + 400));
      }
      return null;
    }

    return {
      critic: criticScore ? {
        score: criticScore + '%',
        state: criticState || null,
        count: criticCount || null
      } : null,
      audience: audienceScore ? {
        score: audienceScore + '%',
        state: audienceState || null,
        count: audienceCount || null
      } : null
    };
  } catch (e) {
    console.warn('[RT] detail 抓取失败:', e && e.message);
    return null;
  }
}

// 统一入口（2026-05 实测后的真实链路）：
//   1. 抓 /search?search= 页面 → 拿 slug + Tomatometer 分数（search 页只有 critic，没有 audience）
//   2. 用 slug 抓 /m/<slug> 详情页 → 拿完整双分（critic + audience）
//   3. 详情页挂了 → 至少返回 search 页的 critic 单分，比直接 fallback 到 OMDb 更准
async function fetchRottenTomatoesByTitle(title, year) {
  if (!title) return null;
  const fromSearch = await searchRottenTomatoesViaSearchPage(title, year);
  if (!fromSearch || !fromSearch.slug) {
    console.log(`[RT] search-page 未拿到 slug (title='${title}' year='${year || ''}')`);
    return null;
  }

  // 详情页拿完整双分
  const fromDetail = await fetchRottenTomatoesDetail(fromSearch.slug);

  if (fromDetail && (fromDetail.critic || fromDetail.audience)) {
    // 详情页成功：用详情页的 critic（有 score + count），但 state 要从 search 页那边补
    //   ——详情页 DOM 上没有显式 state 属性，state 信息只能从 search 页
    //     tomatometer-sentiment + tomatometer-is-certified 反推
    const mergedCritic = fromDetail.critic
      ? {
          ...fromDetail.critic,
          state: fromDetail.critic.state || (fromSearch.critic && fromSearch.critic.state) || null
        }
      : fromSearch.critic;
    return {
      critic: mergedCritic,
      audience: fromDetail.audience  // audience 只能从详情页拿，state 无来源
    };
  }

  // 详情页挂了，至少有 search 的 critic 兜底
  if (fromSearch.critic) {
    console.log(`[RT] 详情页失败，仅返 search 页 critic (slug=${fromSearch.slug})`);
    return { critic: fromSearch.critic, audience: null };
  }

  return null;
}

async function upsertUserQuery(openid, doubanId, movieRefId) {
  try {
    const exist = await queriesCollection.where({ openid, doubanId }).limit(1).get();
    if (exist.data && exist.data.length > 0) {
      // 已存在：仅更新 movieRefId 以防关联失效，queriedAt 保持首次查询时间
      // （这样"最近查询"按 queriedAt desc 排序时等价于按创建时间排序，刷新评分不会让卡片置顶）
      await queriesCollection.doc(exist.data[0]._id).update({
        data: { movieRefId }
      });
    } else {
      // 首次查询：queriedAt 即创建时间
      await queriesCollection.add({
        data: {
          openid,
          doubanId,
          movieRefId,
          queriedAt: db.serverDate()
        }
      });
    }
  } catch (e) {
    console.error('upsertUserQuery 失败:', e && e.message);
  }
}

exports.main = async (event, context) => {
  const doubanId = String((event && event.doubanId) || '').trim();
  const forceRefresh = !!(event && event.forceRefresh);
  const debug = !!(event && event.debug);
  // 优先用 event 显式传入的 openid（云端测试可指定空），否则从微信上下文取
  const wxCtx = cloud.getWXContext() || {};
  const openid = event && event.openid !== undefined ? event.openid : wxCtx.OPENID;
  // bypassCache：调试旁路，**仅在 openid 为空时生效**（即只能在云端测试场景用，
  // 小程序前端永远带 openid，不可能绕过当日限流）
  const bypassCache = !!(event && event.bypassCache) && !openid;
  // skipUserQuery：前端首页"特色电影"展示位用，避免每个用户进首页都被算一次"查询过阿嬷的情书"
  // 仍然走数据抓取/缓存逻辑，只是不写入 user_movie_queries
  const skipUserQuery = !!(event && event.skipUserQuery);

  if (!doubanId) {
    return { success: false, error: 'EMPTY_DOUBAN_ID' };
  }

  const movieDocId = `movie_search_${doubanId}`;
  console.log(`[fetchMovieFullInfo] doubanId=${doubanId} forceRefresh=${forceRefresh} bypassCache=${bypassCache} hasOpenid=${!!openid}`);

  try {
    // 1. 缓存检查（两条规则）：
    //    forceRefresh=false（普通查看/点卡片进详情）→ 只要 doc 存在就用，永久不过期
    //    forceRefresh=true（用户主动点"更新"）→ 当日已抓过返 refreshLimited，否则重抓
    //    bypassCache=true → 调试旁路
    let existing = null;
    try {
      const r = await moviesCollection.doc(movieDocId).get();
      existing = r && r.data;
    } catch (e) { /* 文档不存在 */ }

    const nowMs = Date.now();
    if (!bypassCache && existing) {
      const updatedMs = existing.updatedAt ? new Date(existing.updatedAt).getTime() : 0;
      const sameDay = updatedMs && cnDateStr(updatedMs) === cnDateStr(nowMs);

      if (!forceRefresh) {
        // 普通查看：有 doc 就直接返，无视时间
        if (openid && !skipUserQuery) await upsertUserQuery(openid, doubanId, movieDocId);
        return {
          success: true,
          movie: existing,
          cached: true,
          refreshLimited: false,
          nextRefreshAvailableInMs: 0
        };
      }
      if (forceRefresh && sameDay) {
        // 用户点"更新"但今天已抓过 → 拦下
        if (openid && !skipUserQuery) await upsertUserQuery(openid, doubanId, movieDocId);
        return {
          success: true,
          movie: existing,
          cached: true,
          refreshLimited: true,
          nextRefreshAvailableInMs: msUntilNextCnDay(nowMs)
        };
      }
    }
    if (bypassCache) {
      console.log('[fetchMovieFullInfo] bypassCache=true，跳过缓存检查直接重抓');
    }

    // 2. 爬豆瓣
    const detail = await scrapeDoubanDetail(doubanId);

    // 3. OMDb：豆瓣有 IMDb ID 则精确查；没有就挑英文标题（original_title 或 aka 中的英文项）反查
    let omdb;
    if (detail.imdbId) {
      omdb = await fetchOmdb({ imdbId: detail.imdbId });
    } else {
      const enTitle = pickEnglishTitle(detail);
      if (enTitle) {
        console.log(`[OMDb] 豆瓣未提供 IMDb ID，用 title='${enTitle}' year='${detail.year}' 反查`);
        omdb = await fetchOmdb({ title: enTitle, year: detail.year });
        if (omdb.imdbId) {
          console.log(`[OMDb] 反查命中 imdbId=${omdb.imdbId}`);
        } else {
          console.log(`[OMDb] 反查失败，reason=${omdb.reason}`);
        }
      } else {
        console.log(`[OMDb] 没有可用的英文标题（originalTitle 为空且 aka 全是中文），跳过反查`);
        omdb = { imdb: null, rottenTomatoes: null, imdbId: null, reason: 'no_en_title' };
      }
    }
    const finalImdbId = detail.imdbId || omdb.imdbId || null;

    // 4. 烂番茄双分抓取（critic + audience）
    //    用英文片名搜 RT slug → 抓详情页 HTML 提双分
    //    失败时回退到 OMDb 单分（Tomatometer 只有 critic）
    //
    //    rtDebugSlug：调试旁路，跳过 search 直接用指定 slug 抓详情页（仅云端测试用）
    const rtDebugSlug = event && typeof event.rtDebugSlug === 'string' && event.rtDebugSlug;
    const rtTitle = pickEnglishTitle(detail);
    let rtFull = null;
    if (rtDebugSlug) {
      console.log(`[RT] 调试模式：用指定 slug='${rtDebugSlug}' 直接抓详情`);
      rtFull = await fetchRottenTomatoesDetail(rtDebugSlug);
    } else if (rtTitle) {
      rtFull = await fetchRottenTomatoesByTitle(rtTitle, detail.year);
    } else {
      console.log('[RT] 跳过：无可用英文片名');
    }

    // 5. 海报上传（每次都新上传，简单稳；后续可优化为复用旧 cloudPoster）
    const cloudPoster = await downloadAndUploadPoster(detail.posterUrl, movieDocId);

    const now = new Date();

    // 合并 RT 数据：rtFull 优先（双分），fallback 到 omdb.rottenTomatoes（critic 单分）
    // 保留旧字段 score 作 critic.score 的镜像，向后兼容
    let rottenTomatoes = null;
    if (rtFull && (rtFull.critic || rtFull.audience)) {
      rottenTomatoes = {
        critic: rtFull.critic,
        audience: rtFull.audience,
        score: (rtFull.critic && rtFull.critic.score) || null,
        source: 'rt_detail',
        fetchedAt: now
      };
    } else if (omdb.rottenTomatoes && omdb.rottenTomatoes.score) {
      rottenTomatoes = {
        critic: { score: omdb.rottenTomatoes.score, state: null },
        audience: null,
        score: omdb.rottenTomatoes.score,
        source: 'omdb',
        fetchedAt: now
      };
    }

    const movieData = {
      _id: movieDocId,
      doubanId,
      imdbId: finalImdbId,
      title: detail.title,
      year: detail.year,
      directors: detail.directors,
      genres: detail.genres,
      countries: detail.countries,
      languages: detail.languages,
      durations: detail.durations,
      intro: detail.intro,
      aka: detail.aka,
      poster: cloudPoster || detail.posterUrl,
      originalPoster: detail.posterUrl,
      douban: {
        rating: detail.douban.rating,
        votes: detail.douban.votes,
        fetchedAt: now
      },
      imdb: omdb.imdb ? { ...omdb.imdb, fetchedAt: now } : null,
      rottenTomatoes,
      omdbReason: omdb.reason,
      updatedAt: now,
      createTime: db.serverDate()
    };

    // 5. upsert searched_movies（用 set，避免 update 在文档不存在时静默成功的坑）
    // 注意：doc(id).set() 的 data 不能含 _id 字段，否则报 -501007 "不能更新_id的值"
    const { _id: _omit, ...dataToSet } = movieData;
    await moviesCollection.doc(movieDocId).set({ data: dataToSet });

    // 6. upsert user_movie_queries（首页特色位调用时 skipUserQuery=true，跳过此步）
    if (openid && !skipUserQuery) {
      await upsertUserQuery(openid, doubanId, movieDocId);
    }

    return { success: true, movie: movieData, cached: false };
  } catch (err) {
    console.error('fetchMovieFullInfo 失败:', err && err.message);
    return { success: false, error: err && err.message, doubanId };
  }
};
