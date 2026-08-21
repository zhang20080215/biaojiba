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
 * --verify：联网校验模式。按库内 doubanId 逐条拉豆瓣详情，比对**年份**——错配片的年份
 * 几乎总是对不上，而库里的 year 是从名单写进去的、永远等于名单年份，离线比不出来。
 * 详情接口不吃搜索额度，但 264 条要跑约 11 分钟（每条间隔 2.5s 避免触发风控）。
 */

const fs = require('fs');
const path = require('path');

const SEED_BY_THEME = {
  arthouse: 'tools/arthouse-seed/arthouse.json',
  sightsound: 'tools/sightsound-seed/sightsound.json',
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

  console.log(`\n———— 可疑 ${suspects.length} / 缺失 ${missing.length} / 孤儿 ${orphans.length} / id撞车 ${collisions.length} ————\n`);

  if (process.argv.includes('--verify')) {
    return verifyAgainstDouban(seed, docs);
  }
}

/**
 * 联网校验：按库内 doubanId 拉豆瓣详情，比对年份。
 * 库里的 year 是从名单写进去的（永远等于名单年份），离线比不出错配；
 * 豆瓣那边的年份才是判据——错配片的年份几乎总是对不上。
 */
function verifyAgainstDouban(seed, docs) {
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

  const targets = docs.filter(d => d.doubanId);
  console.log(`联网校验 ${targets.length} 条（每条间隔 2.5s，约 ${Math.ceil(targets.length * 2.5 / 60)} 分钟）…\n`);

  const bad = [];
  const failed = [];
  return targets.reduce((chain, d, i) => chain.then(async () => {
    const r = await detail(d.doubanId);
    if (r.err) { failed.push({ d, err: r.err }); }
    else {
      const dy = Number(r.j.year);
      if (dy && Number(d.year) && Math.abs(dy - Number(d.year)) > 1) {
        bad.push({ d, doubanYear: dy, doubanTitle: r.j.title });
        console.log(`  ✗ rank ${d.rank} 《${d.originalTitle}》名单 ${d.year} vs 豆瓣 ${dy}《${r.j.title}》 id=${d.doubanId}`);
      }
    }
    if ((i + 1) % 25 === 0) console.log(`  …已校验 ${i + 1}/${targets.length}`);
    await new Promise(s => setTimeout(s, 2500));
  }), Promise.resolve()).then(() => {
    console.log(`\n———— 年份对不上 ${bad.length} / 请求失败 ${failed.length} / 已校验 ${targets.length} ————`);
    if (failed.length) {
      console.log('请求失败的（403 need_permission = 条目级封禁，换片；其余多为临时问题，可重跑）：');
      failed.slice(0, 20).forEach(f => console.log(`  rank ${f.d.rank} 《${f.d.originalTitle}》 id=${f.d.doubanId} ${f.err}`));
    }
    console.log('');
  });
}

main();
