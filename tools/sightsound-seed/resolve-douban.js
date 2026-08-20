// tools/sightsound-seed/resolve-douban.js
// 给《视与听》名单逐条解析豆瓣条目 id，把 doubanId 写回 sightsound.json / sightsound.params.json，
// 并生成人工复核清单 sightsound.review.md。
//
//   node tools/sightsound-seed/resolve-douban.js               # 断点续跑（结果全缓存，重跑很快）
//   node tools/sightsound-seed/resolve-douban.js --only 128    # 只解析某个 rank（改错条目时用）
//   node tools/sightsound-seed/resolve-douban.js --report-only # 不发请求，只按已有缓存回写名单和复核清单
//
// ⚠️ 搜索接口对同一 IP 有额度：连续跑几十条之后会稳定返回 403 need_login（详情接口不受影响），
//   过几个小时才会放开。所以这个脚本是**跑不完就换个时间接着跑**的用法，不是一口气跑完的用法。
//   名单里没解析出 doubanId 的条目不影响灌库——`enrichThemeMovies` 会退回自己的豆瓣搜索路径
//   （云函数是从腾讯云 IP 发的请求，不吃本机这份额度）。
//
// 为什么本地先解析而不是丢给云函数搜：
//   enrichThemeMovies 的搜索路径靠「原名/别名精确命中 或 年份差 ≤1」判定，对这份名单风险偏高——
//   全是 1916~2021 的老片/冷门片，英文通用名跟豆瓣 original_title（常是法语/日语原名）对不上时
//   只剩年份一个信号，容易撞到同名翻拍/纪录片；名单里还有剧集/影像论文（如《双峰：回归》），
//   搜索路径的「非电影一律排除」质量闸门会直接把它们判成未匹配。
//   名单自带 doubanId 时 enrichThemeMovies 走「手动指定」分支：跳过搜索直接取详情，也不受该闸门限制。
//
// 接口（本机可直连；桌面站和 j/subject_suggest 对非豆瓣 IP 一律 302，只有 rexxar 这两个能用）：
//   搜索 https://m.douban.com/rexxar/api/v2/search/movie?q=...   （必须带 m.douban.com 的 Referer）
//   详情 https://m.douban.com/rexxar/api/v2/movie/{id}           （剧集条目会 302 到 /tv/{id}，自动跟随）
//
// 判定：候选逐个拉详情打分，原名/别名精确命中最重，其次年份吻合；分数不够的不写 doubanId，
// 留给云端搜索兜底，并在 review 清单里标出来等人工核对。

const https = require('https');
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const CACHE = path.join(DIR, '.cache', 'douban');
const ONLY = (() => { const i = process.argv.indexOf('--only'); return i > 0 ? parseInt(process.argv[i + 1], 10) : null; })();
const REPORT_ONLY = process.argv.includes('--report-only');
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.3 Mobile/15E148 Safari/604.1',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'Referer': 'https://m.douban.com/'
};
const MAX_CANDIDATES = 4;   // 每条最多拉几个候选详情
const DELAY = 1000;         // 请求间隔（带抖动），别把本机 IP 打进豆瓣限流
const MAX_TRIES = 5;        // 单个请求的重试次数（搜索接口会间歇性 403 need_login）
const ABORT_AFTER = 10;     // 连续多少条完全解析不到就中止：多半是被限流了，跑下去只是白刷

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function getJson(url, tries = MAX_TRIES) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: HEADERS }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(getJson(new URL(res.headers.location, url).href, tries));
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { body += d; });
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode + ' ' + body.slice(0, 120)));
        try { resolve(JSON.parse(body)); } catch (e) { reject(new Error('非 JSON 响应')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(20000, () => req.destroy(new Error('timeout')));
  }).catch(async (err) => {
    // 搜索接口会间歇性返回 403 need_login（同一 query 换个时间又能通），逐次拉长退避重试；
    // 重试用尽就抛给调用方记成未解析，失败结果不进缓存，下次跑还会重来
    if (tries > 1) { await sleep((MAX_TRIES - tries + 1) * 5000); return getJson(url, tries - 1); }
    throw err;
  });
}

async function cached(key, loader) {
  const file = path.join(CACHE, key.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 120) + '.json');
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  const data = await loader();
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data));
  await sleep(DELAY + Math.floor(Math.random() * 500)); // 加点抖动，别是整齐的固定节奏
  return data;
}

const search = (q) => cached('search_' + q, () =>
  getJson('https://m.douban.com/rexxar/api/v2/search/movie?q=' + encodeURIComponent(q) + '&start=0&count=8'));
const detail = (id) => cached('detail_' + id, () =>
  getJson('https://m.douban.com/rexxar/api/v2/movie/' + id));

const norm = (s) => String(s || '').toLowerCase().replace(/[\s·・\-–—.,:;'’"“”!！?？()（）\[\]&]/g, '');
// 冠词（the / le / la …）在豆瓣原名和英文通用名之间常有出入，宽松比对时一并抹掉
const normLoose = (s) => norm(s).replace(/^(the|an|a|les|le|la|il|el|der|die|das|l)/, '');

function scoreDetail(d, row) {
  if (!d || !d.id) return null;
  const dYear = parseInt(d.year, 10);
  const titles = [d.original_title, ...(d.aka || [])].filter(Boolean);
  const exact = titles.some((t) => norm(t) === norm(row.title));
  const loose = titles.some((t) => normLoose(t) === normLoose(row.title));
  const yearDiff = isFinite(dYear) ? Math.abs(dYear - row.year) : 99;

  let score = 0;
  if (exact) score += 100;
  else if (loose) score += 80;
  if (yearDiff === 0) score += 45;
  else if (yearDiff <= 1) score += 30;
  else if (yearDiff <= 2) score += 5;
  else score -= 50;
  if (d.rating && d.rating.value) score += 10;
  if ((d.pic && (d.pic.large || d.pic.normal)) || d.cover_url) score += 5;
  // 剧集/综艺条目：名单里确实有（《双峰：回归》），不一票否决，但同分时让位给电影条目
  if (d.subtype && d.subtype !== 'movie') score -= 25;

  return {
    score, exact, loose, yearDiff,
    id: String(d.id), title: d.title, year: dYear || null,
    originalTitle: d.original_title || '',
    directors: (d.directors || []).map((x) => x.name).filter(Boolean).join('、'),
    countries: (d.countries || []).filter(Boolean).join('、'),
    subtype: d.subtype || '',
    rating: (d.rating && d.rating.value) || 0,
    ratingCount: (d.rating && d.rating.count) || 0
  };
}

async function resolveRow(row) {
  const queries = [...new Set([
    row.title + ' ' + row.year,
    row.title,
    // 带长副标题的片名（如 Sunrise: A Song of Two Humans）整串常搜不到，截主标题再试一次
    /[:,]/.test(row.title) ? row.title.split(/[:,]/)[0].trim() + ' ' + row.year : null
  ].filter(Boolean))];

  const tried = new Set();
  let best = null;
  for (const q of queries) {
    let res;
    try { res = await search(q); } catch (e) { console.warn('  ! 搜索失败 [' + q + ']: ' + e.message); continue; }
    const items = (res.items || []).map((i) => i.target).filter((t) => t && t.id);
    for (const t of items.slice(0, MAX_CANDIDATES)) {
      if (tried.has(String(t.id))) continue;
      tried.add(String(t.id));
      let d;
      try { d = await detail(t.id); } catch (e) { console.warn('  ! 详情失败 [' + t.id + ']: ' + e.message); continue; }
      const s = scoreDetail(d, row);
      if (s && (!best || s.score > best.score)) best = s;
      if (best && best.exact && best.yearDiff <= 1) return best; // 原名+年份都对上，不用再看别的候选
    }
    if (best && best.score >= 125) return best;
  }
  return best;
}

(async () => {
  const seed = JSON.parse(fs.readFileSync(path.join(DIR, 'sightsound.json'), 'utf8'));
  const rows = ONLY ? seed.filter((m) => m.rank === ONLY) : seed;
  if (!rows.length) throw new Error('名单里没有 rank=' + ONLY + ' 的条目');
  const resultFile = path.join(DIR, '.cache', 'resolved.json');
  const resolved = fs.existsSync(resultFile) ? JSON.parse(fs.readFileSync(resultFile, 'utf8')) : {};
  // 人工裁定的 rank → doubanId（manual-ids.json，进版本库）。自动判定过不了但人眼一看就对的条目
  // 写在这里，优先级最高：缓存会被重跑覆盖、名单会被回写覆盖，只有这份不会。
  const manualFile = path.join(DIR, 'manual-ids.json');
  const manual = fs.existsSync(manualFile) ? JSON.parse(fs.readFileSync(manualFile, 'utf8')) : {};

  let missStreak = 0;
  for (const row of REPORT_ONLY ? [] : rows) {
    // 断点续跑：已经拿到候选的跳过。只记成 miss 的**不跳过**——那多半是当时被 403 限流，
    // 不是真的搜不到，跳过就等于把限流的锅永久烙进名单
    if (!ONLY && resolved[row.rank] && resolved[row.rank].id) continue;
    process.stdout.write('#' + row.rank + ' ' + row.title + ' (' + row.year + ') … ');
    const best = await resolveRow(row);
    // 判定门槛：原名/别名命中且年份不离谱，或年份完全一致的高分候选
    const ok = !!best && (((best.exact || best.loose) && best.yearDiff <= 2) || best.score >= 140);
    resolved[row.rank] = best ? { ...best, accepted: ok } : { accepted: false, miss: true };
    fs.mkdirSync(path.dirname(resultFile), { recursive: true });
    fs.writeFileSync(resultFile, JSON.stringify(resolved, null, 1));
    console.log(best
      ? (ok ? '✓ ' : '? ') + best.id + ' ' + best.title + ' (' + best.year + ') ' + best.score + '分'
      : '× 没有候选');

    missStreak = best ? 0 : missStreak + 1;
    if (missStreak >= ABORT_AFTER) {
      console.warn('\n⚠ 连续 ' + missStreak + ' 条一个候选都没拿到，基本可以确定是被豆瓣限流了。'
        + '\n  先停下来（已解析的都在 .cache/resolved.json 里），过一阵子重跑这条命令即可接着解析。');
      break;
    }
  }

  // ── 回写名单 + 生成复核清单 ──
  const withIds = seed.map((m) => {
    const r = resolved[m.rank];
    const out = { rank: m.rank, year: m.year, title: m.title, originalTitle: m.originalTitle, officialRank: m.officialRank };
    const manualId = manual[m.rank] && String(manual[m.rank].doubanId || manual[m.rank]);
    if (manualId) out.doubanId = manualId;
    else if (r && r.accepted && r.id) out.doubanId = r.id;
    return out;
  });
  const writeJson = (file, data) =>
    fs.writeFileSync(path.join(DIR, file), JSON.stringify(data, null, 2).replace(/\n/g, '\r\n') + '\r\n');
  writeJson('sightsound.json', withIds);
  writeJson('sightsound.params.json',
    { theme: 'sightsound', idStrategy: 'rank', forceRefresh: false, startFrom: 0, autoContinue: true, movieList: withIds });

  const src = JSON.parse(fs.readFileSync(path.join(DIR, 'sightsound.source.json'), 'utf8'));
  const srcByKey = {};
  src.forEach((s) => { srcByKey[s.title + '__' + s.year] = s; });

  const lines = ['# 《视与听》名单 → 豆瓣条目 复核清单', '',
    '三种状态：',
    '',
    '- `✓` 自动判定通过，名单里已带上 `doubanId`；',
    '- `?` 找到候选但判定没过（原名/年份对不上），名单里**不带** `doubanId`，需人工核对；',
    '- `–` 还没解析（多半是跑的时候被豆瓣限流了），换个时间重跑脚本即可接着解析。',
    '',
    '`?` / `–` 的条目不影响灌库：`enrichThemeMovies` 会退回自己的豆瓣搜索路径。',
    '人工核对后可用 `node tools/sightsound-seed/resolve-douban.js --only <rank>` 重解析，',
    '或直接在 `sightsound.json` / `sightsound.params.json` 里手填 `doubanId`。', '',
    '| | # | 名单片名（年份） | 源站导演 | 豆瓣条目 | 豆瓣年份 | 类型 | 分 |',
    '|---|---|---|---|---|---|---|---|'];
  let okCount = 0, todoCount = 0;
  withIds.forEach((m) => {
    const r = resolved[m.rank] || {};
    const s = srcByKey[m.title + '__' + m.year] || {};
    const isManual = !!manual[m.rank];
    const state = isManual ? '✓人工' : (r.accepted ? '✓' : (r.id ? '?' : '–'));
    if (m.doubanId) okCount++;
    if (state === '–') todoCount++;
    const shownId = m.doubanId || r.id;
    const shownTitle = (isManual && manual[m.rank].note) || r.title || '';
    lines.push('| ' + state + ' | ' + m.rank + ' | ' + m.title + '（' + m.year + '） | '
      + (s.director || '') + ' | '
      + (shownId ? '[' + shownTitle + '](https://movie.douban.com/subject/' + shownId + '/)' : '—')
      + ' | ' + (r.year || '') + ' | ' + (r.subtype || '') + ' | ' + (r.score != null ? r.score : '') + ' |');
  });
  fs.writeFileSync(path.join(DIR, 'sightsound.review.md'), lines.join('\r\n') + '\r\n');

  console.log('\n名单已回写：' + okCount + '/' + withIds.length + ' 条带上 doubanId，'
    + (withIds.length - okCount - todoCount) + ' 条待人工核对，'
    + todoCount + ' 条还没解析（换个时间重跑本脚本，见 sightsound.review.md）');
})().catch((e) => { console.error('失败:', e.message); process.exit(1); });
