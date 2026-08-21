#!/usr/bin/env node
/**
 * 主题灌库匹配审计
 *
 * enrichThemeMovies 的搜索路径可能匹配到**错误的豆瓣条目**——尤其是名单用中文名、
 * 片名又比较泛用的时候（arthouse 首轮就撞出《站台》→《死神来了》、《裸露》→《魔鬼黑狱》）。
 * 这类错配 checkDoubanTitles 查不出来：那个工具比的是「库内 title vs 该 doubanId 的
 * 豆瓣片名」，而错配时这两者本来就一致。
 *
 * 用法：
 *   1. 云开发控制台跑 getThemeMovies，参数 { "theme": "arthouse" }
 *   2. 把返回的 JSON 整份存成文件（整个对象或只要 movies 数组都行）
 *   3. node tools/audit-theme-match.js arthouse <dump.json> [--verify]
 *
 * 离线信号（不联网，任一命中即列出，按可疑度排序）：
 *   ① 片名相似度低    —— 匹配到了完全不同的片子（《站台》→《死神来了》）
 *   ② 库内片名是名单片名的**超集** —— 典型的纪录片/衍生作品
 *                        （《蓝丝绒》→《重访蓝丝绒》、《索多玛120天》→《…：前世与今生》）
 *   ③ 评分人数异常少  —— 作者电影再冷门通常也有几千人；几百人多半是撞到了冷门衍生条目
 *   ④ doubanId 重复   —— 两条名单撞到了同一个豆瓣条目，必有一条是错的
 *
 * ⚠ 名单用**英文片名**的主题（sightsound）①② 两个信号失效：库内 title 被豆瓣中文名
 * 覆盖后，中英文字符重叠恒为 0，264 条会全部误报。这类条目自动跳过 ①②。
 *
 * --verify：联网校验模式。按库内 doubanId 逐条拉豆瓣详情，比对**外文原名 + 年份**。
 * 原名是主判据（名单标题能对上 original_title / title / aka 任一即通过）；年份是辅助——
 * 「同年不同片」是最常见的错配形态，年份对它无效。结果带缓存，可分多轮补齐（详情接口
 * 连跑约 90 条就开始 HTTP 400，一轮跑不完 262 条）。
 */

const fs = require('fs');
const path = require('path');

const SEED_BY_THEME = {
  arthouse: 'tools/arthouse-seed/arthouse.json',
  sightsound: 'tools/sightsound-seed/sightsound.json',
};

// 源站原始字段（含导演/国家），用于交叉校验。名单本身刻意不带这两个字段
// （让豆瓣的中文版本胜出），但源站留了一份，正好拿来验匹配对不对。
const SOURCE_BY_THEME = {
  sightsound: 'tools/sightsound-seed/sightsound.source.json',
};

// 源站英文国名 → 豆瓣中文国名。只列名单里出现过的。
const COUNTRY_CN = {
  'USA': '美国', 'United Kingdom': '英国', 'France': '法国', 'Italy': '意大利',
  'Japan': '日本', 'Germany': '德国', 'Federal Republic of Germany': '西德',
  'German Democratic Republic': '东德', 'Soviet Union': '苏联', 'USSR': '苏联',
  'Spain': '西班牙', 'Sweden': '瑞典', 'Denmark': '丹麦', 'Belgium': '比利时',
  'Netherlands': '荷兰', 'Poland': '波兰', 'Czechoslovakia': '捷克斯洛伐克',
  'Hungary': '匈牙利', 'Austria': '奥地利', 'Switzerland': '瑞士', 'Brazil': '巴西',
  'Argentina': '阿根廷', 'Mexico': '墨西哥', 'Cuba': '古巴', 'Chile': '智利',
  'India': '印度', 'Iran': '伊朗', 'China': '中国大陆', 'Hong Kong': '中国香港',
  'Taiwan': '中国台湾', 'Republic of Korea': '韩国', 'South Korea': '韩国',
  'Thailand': '泰国', 'Senegal': '塞内加尔', 'Angola': '安哥拉',
  'Mauritania': '毛里塔尼亚', 'Algeria': '阿尔及利亚', 'Canada': '加拿大',
  'Australia': '澳大利亚', 'New Zealand': '新西兰', 'Portugal': '葡萄牙',
  'Greece': '希腊', 'Turkey': '土耳其', 'Norway': '挪威', 'Finland': '芬兰',
  'Ireland': '爱尔兰', 'Israel': '以色列', 'Palestine': '巴勒斯坦', 'Egypt': '埃及',
  'Burkina Faso': '布基纳法索', 'Mali': '马里', 'Russia': '俄罗斯',
  'Russian Federation': '俄罗斯', 'Ukraine': '乌克兰', 'Georgia': '格鲁吉亚',
  'Armenia': '亚美尼亚', 'Cambodia': '柬埔寨', 'Philippines': '菲律宾',
  'Lebanon': '黎巴嫩', 'Dominican Republic': '多米尼加', 'Monaco': '摩纳哥',
  'Yugoslavia': '南斯拉夫', 'Romania': '罗马尼亚', 'Bulgaria': '保加利亚',
  'Congo': '刚果', 'Tunisia': '突尼斯', 'Morocco': '摩洛哥', 'Bolivia': '玻利维亚',
  'Colombia': '哥伦比亚', 'Peru': '秘鲁', 'Venezuela': '委内瑞拉',
  'South Africa': '南非', 'Iceland': '冰岛', 'Luxembourg': '卢森堡',
};

const LOW_COUNT = 2000;      // 评分人数低于此值 → 可疑
const LOW_RATING = 7.0;      // 评分低于此值 → 可疑（精选片单里不该有）
const SIM_THRESHOLD = 0.34;  // 片名字符重叠率低于此值 → 可疑

function charSet(s) {
  return new Set(String(s || '').replace(/[\s，,：:·・—\-—()（）]/g, '').split(''));
}

/** 中文片名用字符重叠率（Jaccard）判相似，比编辑距离更抗语序/用词差异 */
function similarity(a, b) {
  const A = charSet(a), B = charSet(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const c of A) if (B.has(c)) inter++;
  return inter / new Set([...A, ...B]).size;
}

/** 名单片名是否是拉丁字母（英文原名）—— 是的话跟豆瓣中文名没有可比性 */
function isLatinTitle(s) {
  const str = String(s || '');
  if (!str) return false;
  return !/[一-龥぀-ヿ]/.test(str);
}

/** b 是否包含 a 的全部字符且明显更长 —— 「原片名 + 修饰」的衍生条目特征 */
function isSuperset(a, b) {
  const A = charSet(a), B = charSet(b);
  if (!A.size || B.size <= A.size) return false;
  for (const c of A) if (!B.has(c)) return false;
  const la = String(a || '').length, lb = String(b || '').length;
  return lb >= la + 2;
}

function loadJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function main() {
  const [theme, dumpPath] = process.argv.slice(2);
  if (!theme || !dumpPath) {
    console.error('用法: node tools/audit-theme-match.js <theme> <getThemeMovies返回的.json>');
    process.exit(1);
  }
  const seedRel = SEED_BY_THEME[theme];
  if (!seedRel) {
    console.error('未知 theme: ' + theme + '（可选: ' + Object.keys(SEED_BY_THEME).join(', ') + '）');
    process.exit(1);
  }

  const seedRaw = loadJson(path.join(process.cwd(), seedRel));
  const seed = seedRaw.movieList || seedRaw;
  const dumpRaw = loadJson(path.resolve(dumpPath));
  const docs = Array.isArray(dumpRaw) ? dumpRaw : (dumpRaw.movies || []);

  console.log(`\n名单 ${seed.length} 条 / 库内 ${docs.length} 条\n`);

  // 库内文档按「名单身份键」索引：originalTitle 灌库后不会被豆瓣覆盖，是稳定的身份
  const byIdentity = new Map();
  docs.forEach(d => byIdentity.set(`${d.originalTitle}__${d.year}`, d));

  const suspects = [];
  const missing = [];

  seed.forEach(s => {
    const doc = byIdentity.get(`${s.originalTitle}__${s.year}`);
    if (!doc) { missing.push(s); return; }

    const reasons = [];
    const cnt = Number(doc.ratingCount) || 0;
    const rating = Number(doc.rating) || 0;
    // 名单是英文原名时，跟豆瓣中文片名没有可比性，跳过片名类信号
    const titleComparable = !isLatinTitle(s.originalTitle);
    const sim = titleComparable ? similarity(s.originalTitle, doc.title) : 1;
    const superset = titleComparable && isSuperset(s.originalTitle, doc.title);

    if (superset) {
      reasons.push(`库内片名是名单片名的超集（多半是纪录片/衍生条目）`);
    } else if (titleComparable && sim < SIM_THRESHOLD) {
      reasons.push(`片名相似度仅 ${(sim * 100).toFixed(0)}%`);
    }
    if (cnt && cnt < LOW_COUNT) reasons.push(`评分人数仅 ${cnt}`);
    if (rating && rating < LOW_RATING) reasons.push(`评分仅 ${rating}`);

    if (reasons.length) {
      // 可疑度：超集/低相似度权重最高，其次是人数少
      const score = (superset ? 100 : 0)
        + (titleComparable && sim < SIM_THRESHOLD ? 100 - sim * 100 : 0)
        + (cnt && cnt < LOW_COUNT ? (LOW_COUNT - cnt) / 40 : 0)
        + (rating && rating < LOW_RATING ? (LOW_RATING - rating) * 10 : 0);
      suspects.push({ s, doc, reasons, score });
    }
  });

  // ⑤ 国家交叉校验 —— 离线信号里最有效的一个。
  // 源站给了导演和国家，库里存的是豆瓣的；国家对不上基本就是匹配到了别的片。
  // sightsound 实测：262 条里命中 8 条，其中 4 条是真错配（导演也对不上）、
  // 4 条是合拍片国家标注差异的误报（导演一致）。所以输出里带上两边的导演，
  // 由人一眼判定——导演不同 = 确认错配，导演相同 = 合拍片标注差异，放过。
  const sourceRel = SOURCE_BY_THEME[theme];
  const countryBad = [];
  if (sourceRel) {
    let source = [];
    try { source = loadJson(path.join(process.cwd(), sourceRel)); } catch (e) { /* 没有源站文件就跳过 */ }
    const srcByKey = new Map();
    source.forEach(s => srcByKey.set(s.title + '__' + s.year, s));
    docs.forEach(d => {
      const s = srcByKey.get(d.originalTitle + '__' + d.year);
      if (!s || !s.country || !d.country) return;
      const bfiCn = s.country.split(',').map(x => COUNTRY_CN[x.trim()]).filter(Boolean);
      if (!bfiCn.length) return;
      if (!bfiCn.includes(d.country)) countryBad.push({ d, s, bfiCn });
    });
  }

  // doubanId 撞车：两条名单匹配到了同一个豆瓣条目，必有一条是错的
  const byDoubanId = new Map();
  docs.forEach(d => {
    if (!d.doubanId) return;
    if (!byDoubanId.has(d.doubanId)) byDoubanId.set(d.doubanId, []);
    byDoubanId.get(d.doubanId).push(d);
  });
  const collisions = [...byDoubanId.entries()].filter(([, arr]) => arr.length > 1);

  suspects.sort((a, b) => b.score - a.score);

  if (suspects.length) {
    console.log(`⚠ ${suspects.length} 条可疑匹配（按可疑度排序）\n`);
    console.log(`  提示：这是人工复核清单，不是判决。豆瓣的正规译名跟名单用词不同属正常`);
    console.log(`  （《职业：记者》→《过客》、《轻蔑》→《蔑视》都是对的），真冷门片人数少也正常。\n`);
    suspects.forEach(({ s, doc, reasons }) => {
      console.log(`  名单#${s.rank} / 库内rank ${doc.rank}  《${s.originalTitle}》(${s.year}) ${s.director || ''}`);
      console.log(`    → 库内《${doc.title}》 doubanId=${doc.doubanId} ${doc.rating}分/${doc.ratingCount}人`);
      console.log(`    ✗ ${reasons.join('；')}`);
      console.log(`    豆瓣页 https://movie.douban.com/subject/${doc.doubanId}/\n`);
    });
  } else {
    console.log('✅ 没有发现可疑匹配');
  }

  if (missing.length) {
    console.log(`\n⚠ ${missing.length} 条名单里有、库里没有：`);
    missing.forEach(m => console.log(`  #${m.rank} 《${m.originalTitle}》(${m.year}) ${m.director || ''}`));
  }

  // 库里有、名单里没有 —— 换名单后残留的孤儿文档
  const seedKeys = new Set(seed.map(s => `${s.originalTitle}__${s.year}`));
  const orphans = docs.filter(d => !seedKeys.has(`${d.originalTitle}__${d.year}`));
  if (orphans.length) {
    console.log(`\n⚠ ${orphans.length} 条库里有、名单里没有（孤儿文档，换名单后残留）：`);
    orphans.forEach(o => console.log(`  ${o._id} 《${o.title}》(${o.year}) rank=${o.rank}`));
  }

  if (collisions.length) {
    console.log(`\n⚠ ${collisions.length} 组 doubanId 撞车（同一个豆瓣条目被多条名单匹配，必有一条是错的）：`);
    collisions.forEach(([id, arr]) => {
      console.log(`  doubanId=${id}  https://movie.douban.com/subject/${id}/`);
      arr.forEach(d => console.log(`    rank ${d.rank} 《${d.originalTitle}》(${d.year}) → 库内《${d.title}》`));
    });
  }

  if (countryBad.length) {
    console.log(`\n⚠ ${countryBad.length} 条国家与源站对不上（**看导演判定**：导演不同 = 确认错配；导演相同 = 合拍片标注差异，放过）：\n`);
    countryBad.forEach(({ d, s, bfiCn }) => {
      console.log(`  rank ${String(d.rank).padStart(3)} 《${d.originalTitle}》(${d.year})`);
      console.log(`        库内《${d.title}》 ${d.country} / ${d.director}  id=${d.doubanId}`);
      console.log(`        源站  ${s.country} → ${bfiCn.join('、')}  导演 ${s.director}`);
      console.log(`        https://movie.douban.com/subject/${d.doubanId}/\n`);
    });
  }

  console.log(`\n———— 可疑 ${suspects.length} / 缺失 ${missing.length} / 孤儿 ${orphans.length} / id撞车 ${collisions.length} / 国家不符 ${countryBad.length} ————\n`);

  if (process.argv.includes('--verify')) {
    return verifyAgainstDouban(seed, docs, theme);
  }
}

/** 外文原名归一化：去掉标点/冠词/变音符，只留可比对的骨架 */
function normLatin(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // é → e
    .toLowerCase()
    .replace(/^(the|a|an|le|la|les|il|el|der|die|das)\s+/, '')
    .replace(/[^a-z0-9]/g, '');
}

/**
 * 联网校验：按库内 doubanId 拉豆瓣详情，比对**外文原名**与年份。
 *
 * 原名是主判据：BFI 名单给的就是英文原名，豆瓣详情的 original_title 存的也是外文原名，
 * 两者可直接比对。年份只是辅助——「同年不同片」是最常见的错配形态（《Pink Flamingos》
 * 撞到同年的西班牙片、《Twenty Years Later》撞到同年的国产片），年份判据对它完全无效。
 *
 * 结果缓存在 .cache/verify-<theme>.json：豆瓣详情接口连跑约 90 条就开始返回 HTTP 400，
 * 262 条一轮跑不完，缓存让重跑能接着上次的继续，只补没验证过的。
 */
function verifyAgainstDouban(seed, docs, theme) {
  const https = require('https');
  const detail = id => new Promise(resolve => {
    const req = https.get({
      hostname: 'm.douban.com',
      path: '/rexxar/api/v2/movie/' + id,
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15',
        'Referer': 'https://m.douban.com/movie/subject/' + id + '/',
      },
    }, r => {
      let d = '';
      r.on('data', c => { d += c; });
      r.on('end', () => {
        if (r.statusCode !== 200) return resolve({ err: 'HTTP' + r.statusCode });
        try { resolve({ j: JSON.parse(d) }); } catch (e) { resolve({ err: 'parse' }); }
      });
    });
    req.on('error', e => resolve({ err: e.code }));
    req.setTimeout(15000, () => { req.destroy(); resolve({ err: 'timeout' }); });
  });

  const cacheFile = path.join(process.cwd(), 'tools', 'sightsound-seed', '.cache', `verify-${theme}.json`);
  let cache = {};
  try { cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); } catch (e) { /* 首次跑 */ }
  const saveCache = () => {
    try {
      fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
      fs.writeFileSync(cacheFile, JSON.stringify(cache, null, 2));
    } catch (e) { console.warn('缓存写入失败:', e.message); }
  };

  const all = docs.filter(d => d.doubanId);
  const todo = all.filter(d => !cache[d.doubanId]);
  console.log(`联网校验：${all.length} 条，已缓存 ${all.length - todo.length}，本轮需拉取 ${todo.length} 条`
    + `（间隔 2.5s，约 ${Math.ceil(todo.length * 2.5 / 60)} 分钟）\n`);

  let failed = 0;
  let done = 0;
  return todo.reduce((chain, d) => chain.then(async () => {
    const r = await detail(d.doubanId);
    if (r.err) { failed++; }
    else {
      // aka 一并存下：豆瓣对非英语片的 original_title 是法语/日语原名（《四百击》= Les Quatre
      // cents coups），跟 BFI 给的英文通用名必然对不上；英文名通常躺在 aka 里
      cache[d.doubanId] = {
        title: r.j.title || '',
        originalTitle: r.j.original_title || '',
        aka: Array.isArray(r.j.aka) ? r.j.aka : [],
        year: Number(r.j.year) || null,
      };
      done++;
      if (done % 20 === 0) saveCache();
    }
    if ((done + failed) % 25 === 0) console.log(`  …已处理 ${done + failed}/${todo.length}（成功 ${done} / 失败 ${failed}）`);
    await new Promise(s => setTimeout(s, 2500));
  }), Promise.resolve()).then(() => {
    saveCache();

    const bad = [];
    let unchecked = 0;
    all.forEach(d => {
      const c = cache[d.doubanId];
      if (!c) { unchecked++; return; }
      const reasons = [];
      // 主判据：外文原名 + 别名。名单标题只要能对上其中任何一个就算过。
      // 豆瓣对华语片的 original_title 是中文，归一化后为空，这类自动跳过原名比对。
      const seedT = normLatin(d.originalTitle);
      const candidates = [c.originalTitle, c.title, ...(c.aka || [])].map(normLatin).filter(Boolean);
      const hit = !seedT || !candidates.length || candidates.some(x =>
        x === seedT || x.includes(seedT) || seedT.includes(x));
      if (!hit) {
        reasons.push(`原名对不上：名单「${d.originalTitle}」vs 豆瓣「${c.originalTitle}」`
          + (c.aka && c.aka.length ? `（别名 ${c.aka.slice(0, 3).join(' / ')}）` : '（无别名）'));
      }
      if (c.year && Number(d.year) && Math.abs(c.year - Number(d.year)) > 1) {
        reasons.push(`年份 ${d.year} vs 豆瓣 ${c.year}`);
      }
      if (reasons.length) bad.push({ d, c, reasons });
    });

    if (bad.length) {
      console.log(`\n⚠ ${bad.length} 条对不上：\n`);
      bad.forEach(({ d, c, reasons }) => {
        console.log(`  rank ${d.rank} 《${d.originalTitle}》(${d.year}) → 库内《${d.title}》 id=${d.doubanId}`);
        reasons.forEach(r => console.log(`    ✗ ${r}`));
        console.log(`    豆瓣页 https://movie.douban.com/subject/${d.doubanId}/\n`);
      });
    }
    console.log(`———— 对不上 ${bad.length} / 已校验 ${all.length - unchecked} / 尚未校验 ${unchecked}（本轮失败 ${failed}，隔一阵重跑本命令即可接着补）————\n`);
  });
}

main();
