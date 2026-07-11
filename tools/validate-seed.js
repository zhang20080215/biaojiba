#!/usr/bin/env node
/*
 * 榜单 seed 自检：灌库前本地跑一遍，把数据问题一次揪出来，避免反复跑 enrichThemeMovies 才发现。
 * 用法：node tools/validate-seed.js            （检查全部）
 *       node tools/validate-seed.js palmeDor   （只查某个，模糊匹配文件名）
 * 退出码：有 ERROR 时非 0，方便接 CI / pre-commit。
 */
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

// 需要自检的 seed（*.json 是 movieList 数组本体）
const FILES = [
  { file: 'tools/rt-seed/rtHorror.json', theme: 'rtHorror' },
  { file: 'tools/rt-seed/rtWar.json', theme: 'rtWar' },
  { file: 'tools/rt-seed/rtAnimation.json', theme: 'rtAnimation' },
  { file: 'tools/palme-seed/palmeDor.json', theme: 'palmeDor', edition: (y) => y - 1947, needDirector: true, needCountry: true },
  { file: 'tools/oscar-screenplay-seed/oscarScreenplay.json', theme: 'oscarScreenplay', needEdition: true },
  { file: 'tools/oscar-foreign-seed/oscarForeign.json', theme: 'oscarForeign', edition: (y) => y - 1927, needDirector: true, needCountry: true },
  { file: 'tools/rt-action-seed/rtAction.json', theme: 'rtAction' },
  { file: 'tools/letterboxd500-seed/letterboxd500.json', theme: 'letterboxd500' },
];

// 港台译名 → 大陆标准（命中即 WARN）
const TW_TERMS = {
  '义大利': '意大利', '纽西兰': '新西兰', '南韩': '韩国', '北韩': '朝鲜',
  '俄国': '俄罗斯', '寮国': '老挝', '衣索比亚': '埃塞俄比亚', '赛普勒斯': '塞浦路斯',
  '沙乌地': '沙特', '狮子山': '塞拉利昂', '几内亚比索': '几内亚比绍',
};
// 文本脏值：残留标签/实体/括注/书名号/方括号/竖线/多空格
const DIRTY = /[<>]|&[a-zA-Z#0-9]+;|（[^）]*(语|語)[:：]|[《》\[\]|]|\s{2,}/;
const CUR_YEAR = new Date().getFullYear();

function check(cfg) {
  const abs = path.join(ROOT, cfg.file);
  if (!fs.existsSync(abs)) return { file: cfg.file, errors: ['文件不存在'], warns: [] };
  let list;
  try { list = JSON.parse(fs.readFileSync(abs, 'utf8')); }
  catch (e) { return { file: cfg.file, errors: ['JSON 解析失败: ' + e.message], warns: [] }; }
  if (!Array.isArray(list)) return { file: cfg.file, errors: ['顶层不是数组'], warns: [] };

  const errors = [], warns = [];
  const ranks = new Set(), titleYear = new Set();
  const tag = (m) => `#${m.rank} ${m.year} ${m.title}`;

  list.forEach((m) => {
    // 必填
    if (typeof m.rank !== 'number') errors.push(`${tag(m)}: rank 非数字`);
    if (typeof m.year !== 'number') errors.push(`${tag(m)}: year 非数字`);
    else if (m.year < 1910 || m.year > CUR_YEAR + 1) errors.push(`${tag(m)}: year 越界 (${m.year})`);
    if (!m.title || !String(m.title).trim()) errors.push(`${tag(m)}: title 为空`);
    if (!m.originalTitle || !String(m.originalTitle).trim()) warns.push(`${tag(m)}: originalTitle 为空（豆瓣按英文名搜的兜底会失效）`);

    // rank 唯一
    if (ranks.has(m.rank)) errors.push(`${tag(m)}: rank 重复`);
    ranks.add(m.rank);
    // 同片重复
    const ty = `${m.year}|${m.title}`;
    if (titleYear.has(ty)) warns.push(`${tag(m)}: (年份+片名) 重复`);
    titleYear.add(ty);

    // 届数
    if (cfg.edition && typeof m.edition === 'number' && m.edition !== cfg.edition(m.year)) {
      warns.push(`${tag(m)}: edition=${m.edition} 与 year 推算(${cfg.edition(m.year)})不符`);
    }
    if (cfg.needEdition && typeof m.edition !== 'number') warns.push(`${tag(m)}: 缺 edition`);

    // 脏文本
    ['title', 'originalTitle', 'director', 'country'].forEach((k) => {
      const v = m[k];
      if (v && DIRTY.test(String(v))) warns.push(`${tag(m)}: ${k} 含可疑字符 → "${v}"`);
    });
    // 导演括注（如「（与…共享）」）
    if (m.director && /[（(]/.test(m.director)) warns.push(`${tag(m)}: director 含括注 → "${m.director}"`);
    // 港台译名
    ['director', 'country', 'title'].forEach((k) => {
      const v = String(m[k] || '');
      Object.keys(TW_TERMS).forEach((tw) => { if (v.includes(tw)) warns.push(`${tag(m)}: ${k} 港台译名「${tw}」→ 建议「${TW_TERMS[tw]}」`); });
    });
    // 需要导演/国家的主题
    if (cfg.needDirector && !m.director) warns.push(`${tag(m)}: 缺 director`);
    if (cfg.needCountry && !m.country) warns.push(`${tag(m)}: 缺 country`);
  });

  // rank 连续 1..N
  const n = list.length;
  const missing = [];
  for (let r = 1; r <= n; r++) if (!ranks.has(r)) missing.push(r);
  if (missing.length) errors.push(`rank 非连续 1..${n}，缺: ${missing.slice(0, 20).join(',')}${missing.length > 20 ? '…' : ''}`);

  return { file: cfg.file, count: n, errors, warns };
}

const filter = process.argv[2];
const targets = filter ? FILES.filter((f) => f.file.includes(filter) || f.theme.includes(filter)) : FILES;
if (!targets.length) { console.error('没有匹配的 seed:', filter); process.exit(2); }

let totalErr = 0, totalWarn = 0;
for (const cfg of targets) {
  const r = check(cfg);
  const head = `\n=== ${r.file}${r.count != null ? `  (${r.count} 部)` : ''} ===`;
  console.log(head);
  if (!r.errors.length && !r.warns.length) { console.log('  ✅ 通过，无问题'); continue; }
  r.errors.forEach((e) => console.log('  ❌ ' + e));
  r.warns.forEach((w) => console.log('  ⚠️  ' + w));
  totalErr += r.errors.length; totalWarn += r.warns.length;
}
console.log(`\n———— 合计: ${totalErr} 个 ERROR, ${totalWarn} 个 WARN ————`);
process.exit(totalErr ? 1 : 0);
