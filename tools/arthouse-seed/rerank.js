// tools/arthouse-seed/rerank.js
// 灌库拿到豆瓣评分 + 评分人数之后，用贝叶斯加权评分重算 rank，生成第二轮灌库参数。
//
//   1. 云开发控制台跑 getThemeMovies：{ "theme": "arthouse" }
//   2. 把返回的整份 JSON 存成文件，例如 tools/arthouse-seed/_fetched.json
//   3. node tools/arthouse-seed/rerank.js tools/arthouse-seed/_fetched.json
//   4. 把生成的 arthouse.rerank.params.json 整份粘进 enrichThemeMovies
//
// 第 4 步不会重新爬豆瓣、不会重下封面：enrichThemeMovies 里有「身份对得上但 rank 变了」的
// 分支，靠 originalTitle + year 认出是同一部片，只改序号——所以这一轮是秒级的。
// 也正因如此，名单里的 originalTitle 绝不能改（本主题刻意让它等于 title）。
//
// 加权公式（同 IMDb Top250）：
//   WR = v/(v+m) × R + m/(v+m) × C
//     R = 该片豆瓣评分，v = 该片评分人数
//     C = 全部条目的平均分
//     m = 票数门槛，默认取全部条目评分人数的 25% 分位（可用 --m 覆盖）
// 作用是把小样本往均值拉：这 250 部的评分人数跨了四个数量级，只按 R 排会让几百人评的
// 冷门艺术片盖过百万人评的公认经典。
//
// m 别取中位数——那会让一半条目重度回归均值、彼此区分度消失（9.5 分和 8.2 分的冷门片
// 加权后只差千分之几）。25% 分位只压住真正的小样本，大多数条目仍由自身评分决定名次。
// 想调松/调紧：node ... rerank.js <file> --m 5000

const fs = require('fs');
const path = require('path');

const inFile = process.argv[2];
if (!inFile) {
  console.error('用法: node tools/arthouse-seed/rerank.js <getThemeMovies 返回的 json 文件>');
  process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(inFile, 'utf8'));
// 兼容三种粘法：整份云函数返回 / result 那层 / 直接是 movies 数组
const movies = Array.isArray(raw) ? raw
  : (raw.movies || (raw.result && raw.result.movies) || null);
if (!Array.isArray(movies) || !movies.length) {
  console.error('没解析出 movies 数组，检查一下输入文件');
  process.exit(1);
}

const num = v => (typeof v === 'number' && isFinite(v) ? v : 0);
const rated = movies.filter(m => num(m.rating) > 0);
if (!rated.length) {
  console.error('所有条目 rating 都是 0，八成是还没灌完');
  process.exit(1);
}

const missingCount = movies.filter(m => !num(m.ratingCount)).length;
if (missingCount) {
  console.warn('⚠ ' + missingCount + ' 条没有 ratingCount —— enrichThemeMovies 可能还是旧版本，'
    + '确认 fetchDoubanDetail 已经存 ratingCount 并重新部署过');
}

const C = rated.reduce((s, m) => s + num(m.rating), 0) / rated.length;
const counts = movies.map(m => num(m.ratingCount)).filter(v => v > 0).sort((a, b) => a - b);
const mArgIdx = process.argv.indexOf('--m');
const mOverride = mArgIdx > 0 ? parseInt(process.argv[mArgIdx + 1], 10) : NaN;
const m0 = isFinite(mOverride) ? mOverride
  : (counts.length ? counts[Math.floor(counts.length * 0.25)] : 0);

const scored = movies.map(x => {
  const R = num(x.rating), v = num(x.ratingCount);
  const WR = (v + m0) > 0 ? (v / (v + m0)) * R + (m0 / (v + m0)) * C : C;
  return { x, R, v, WR };
});
// 加权分相同的按评分人数兜底，再不行按年份，保证顺序稳定可复现
scored.sort((a, b) => (b.WR - a.WR) || (b.v - a.v) || (num(a.x.year) - num(b.x.year)));

const movieList = scored.map((s, i) => {
  const x = s.x;
  const row = {
    rank: i + 1,
    year: num(x.year),
    // 库里的 title 可能已被豆瓣标准片名覆盖，原始名单标题留档在 sourceTitle；
    // 这里回传原始标题，enrichThemeMovies 会识别出「等于 sourceTitle」而跳过 title 字段，
    // 不会把订正过的片名改回去
    title: x.sourceTitle || x.title,
    originalTitle: x.originalTitle
  };
  if (x.director) row.director = x.director;
  if (x.country) row.country = x.country;
  return row;
});

const outFile = path.join(__dirname, 'arthouse.rerank.params.json');
fs.writeFileSync(outFile, JSON.stringify({
  theme: 'arthouse', idStrategy: 'rank', forceRefresh: false, startFrom: 0, autoContinue: true, movieList
}, null, 2).replace(/\n/g, '\r\n') + '\r\n');

const pct = q => counts.length ? counts[Math.min(counts.length - 1, Math.floor(counts.length * q))] : 0;
console.log('条目 ' + movies.length + ' | 平均分 C=' + C.toFixed(3) + ' | 票数门槛 m=' + m0
  + (isFinite(mOverride) ? ' (手动指定)' : ' (25% 分位)'));
console.log('评分人数分位: 25%=' + pct(0.25) + '  50%=' + pct(0.5) + '  75%=' + pct(0.75)
  + '  最少=' + (counts[0] || 0) + '  最多=' + (counts[counts.length - 1] || 0));
console.log('前 10：');
scored.slice(0, 10).forEach((s, i) =>
  console.log('  ' + String(i + 1).padStart(3) + '. ' + s.x.title
    + '  ' + s.R.toFixed(1) + '分 / ' + s.v + '人  → 加权 ' + s.WR.toFixed(3)));
console.log('后 5：');
scored.slice(-5).forEach((s, i) =>
  console.log('  ' + (scored.length - 4 + i) + '. ' + s.x.title
    + '  ' + s.R.toFixed(1) + '分 / ' + s.v + '人  → 加权 ' + s.WR.toFixed(3)));
console.log('\n已写出 ' + path.basename(outFile) + '，整份粘进 enrichThemeMovies 即可');
