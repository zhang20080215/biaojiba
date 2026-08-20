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
 *   3. node tools/audit-theme-match.js arthouse <dump.json>
 *
 * 三个信号（任一命中即列出，按可疑度排序）：
 *   ① 片名相似度低    —— 匹配到了完全不同的片子（《站台》→《死神来了》）
 *   ② 库内片名是名单片名的**超集** —— 典型的纪录片/衍生作品
 *                        （《蓝丝绒》→《重访蓝丝绒》、《索多玛120天》→《…：前世与今生》）
 *   ③ 评分人数异常少  —— 作者电影再冷门通常也有几千人；几百人多半是撞到了冷门衍生条目
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
    const sim = similarity(s.originalTitle, doc.title);
    const cnt = Number(doc.ratingCount) || 0;
    const rating = Number(doc.rating) || 0;

    if (isSuperset(s.originalTitle, doc.title)) {
      reasons.push(`库内片名是名单片名的超集（多半是纪录片/衍生条目）`);
    } else if (sim < SIM_THRESHOLD) {
      reasons.push(`片名相似度仅 ${(sim * 100).toFixed(0)}%`);
    }
    if (cnt && cnt < LOW_COUNT) reasons.push(`评分人数仅 ${cnt}`);
    if (rating && rating < LOW_RATING) reasons.push(`评分仅 ${rating}`);

    if (reasons.length) {
      // 可疑度：超集/低相似度权重最高，其次是人数少
      const score = (isSuperset(s.originalTitle, doc.title) ? 100 : 0)
        + (sim < SIM_THRESHOLD ? 100 - sim * 100 : 0)
        + (cnt && cnt < LOW_COUNT ? (LOW_COUNT - cnt) / 40 : 0)
        + (rating && rating < LOW_RATING ? (LOW_RATING - rating) * 10 : 0);
      suspects.push({ s, doc, reasons, score });
    }
  });

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

  console.log(`\n———— 可疑 ${suspects.length} / 缺失 ${missing.length} / 孤儿 ${orphans.length} ————\n`);
}

main();
