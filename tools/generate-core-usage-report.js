#!/usr/bin/env node
// Usage: node tools/generate-core-usage-report.js <result.json> [output.md]

const fs = require('fs');
const path = require('path');

const input = process.argv[2];
const output = process.argv[3] || path.join('docs', 'core-usage-analysis-2026-07-10.md');
if (!input) throw new Error('请传入 analyzeCoreUsage 返回的 JSON 文件路径');
const raw = JSON.parse(fs.readFileSync(input, 'utf8'));
let data = raw.result || raw;

// Sharded production runs can be saved as either a JSON array or
// { "shards": [...] }. Merge their compact rows before normalizing.
const shardList = Array.isArray(data) ? data : data.shards;
if (Array.isArray(shardList)) {
  const shards = shardList.map(x => x.result || x);
  const failed = shards.find(x => x.ok !== 1);
  if (failed) throw new Error(failed.error || '存在失败的统计分片');
  const firstMeta = shards.find(x => Array.isArray(x.m));
  data = {
    ok: 1,
    m: firstMeta && firstMeta.m,
    f: shards.flatMap(x => x.f || []),
    d: shards.flatMap(x => x.d || []),
    c: shards.flatMap(x => x.c || []),
    ms: shards.reduce((sum, x) => sum + (x.ms || 0), 0)
  };
}

const FEATURE_META = {
  douban_movies: ['豆瓣电影 TOP250', 'mark_theme'],
  imdb_movies: ['IMDB电影 TOP250', 'mark_theme'],
  oscar_movies: ['历届奥斯卡最佳影片', 'mark_theme'],
  oscar_anime_movies: ['历届奥斯卡最佳动画长篇', 'mark_theme'],
  boxoffice_movies: ['全球电影票房榜', 'mark_theme'],
  oscar_cinematography_movies: ['历届奥斯卡最佳摄影奖', 'mark_theme'],
  rt_horror_movies: ['史上最佳恐怖电影', 'mark_theme'],
  rt_war_movies: ['史上最佳战争电影', 'mark_theme'],
  rt_animation_movies: ['史上最佳动画电影', 'mark_theme'],
  palme_dor_movies: ['历届金棕榈奖', 'mark_theme'],
  oscar_screenplay_movies: ['历届奥斯卡最佳原创剧本', 'mark_theme'],
  oscar_foreign_movies: ['历届奥斯卡最佳外语片', 'mark_theme'],
  rt_action_movies: ['史上最佳动作电影', 'mark_theme'],
  letterboxd500_movies: ['Letterboxd Top 500', 'mark_theme'],
  douban_books: ['豆瓣读书 TOP250', 'mark_theme'],
  weread_books: ['微信读书 TOP200 总榜', 'mark_theme'],
  movie_search_all_platforms: ['全平台电影评分查询', 'query_feature'],
  child_growth: ['儿童生长发育评估', 'assessment_feature']
};
const DAILY_META = {
  daily_water: '每日喝水', daily_movie: '每日电影',
  daily_read: '每日读书', daily_sport: '每日运动'
};

if (data.ok === 1 && Array.isArray(data.f) && Array.isArray(data.d)) {
  const [snapshotAt, days, cutoffDate] = data.m;
  data = {
    success: true,
    meta: {
      snapshotAt, days, cutoffDate,
      overlapNote: '同一内容可属于多个主题，主题数据不得跨主题求和。',
      queryLimitation: 'user_movie_queries 为用户×电影 upsert，actions 表示保存的不同电影查询记录，不是真实点击次数。'
    },
    features: data.f.map(([id, totalUsers, totalActions, avgActionsPerUser, recentUsers, recentActions]) => ({
      id, title: FEATURE_META[id][0], type: FEATURE_META[id][1],
      totalUsers, totalActions, avgActionsPerUser, recentUsers, recentActions
    })),
    dailyThemes: data.d.map(([id, totalUsers, totalDays, recentUsers, recentDays, repeatRate, avgActiveDaysPerUser, dayDistribution, recentDayDistribution, retention, streaks, weekly, goal, recordDateDays, recordDateDistribution]) => ({
      id, title: DAILY_META[id], type: 'daily_theme', totalUsers, totalDays,
      recentUsers, recentDays, repeatRate, avgActiveDaysPerUser,
      dayDistribution: dayDistribution || [],
      recentDayDistribution: recentDayDistribution || [],
      retention: retention || null,
      streaks: streaks || null,
      weekly: weekly || [],
      goal: goal || null,
      recordDateDays: recordDateDays || 0,
      recordDateDistribution: recordDateDistribution || []
    }))
  };
}
if (!data.success) throw new Error(data.error || '统计结果失败');

const n = value => Number(value || 0).toLocaleString('zh-CN');
const featureRows = data.features.map(row =>
  `| ${row.title} | ${row.type === 'mark_theme' ? '标记' : row.type === 'query_feature' ? '查询' : '评估'} | ${n(row.totalUsers)} | ${n(row.totalActions)} | ${row.avgActionsPerUser == null ? '—' : row.avgActionsPerUser} | ${n(row.recentUsers)} | ${n(row.recentActions)} |`
).join('\n');
const dailyRows = data.dailyThemes.map(row =>
  `| ${row.title} | ${n(row.totalUsers)} | ${n(row.totalDays)} | ${n(row.recentUsers)} | ${n(row.recentDays)} | ${row.repeatRate}% | ${row.avgActiveDaysPerUser} |`
).join('\n');

const markThemes = data.features.filter(x => x.type === 'mark_theme');
const byRecent = [...markThemes].sort((a, b) => b.recentUsers - a.recentUsers || b.totalUsers - a.totalUsers);
const byTotal = [...markThemes].sort((a, b) => b.totalUsers - a.totalUsers);
const dailyByRecent = [...data.dailyThemes].sort((a, b) => b.recentUsers - a.recentUsers);
const dailyByRepeat = [...data.dailyThemes].sort((a, b) => b.repeatRate - a.repeatRate);
const zeroRecent = markThemes.filter(x => x.recentUsers === 0).map(x => x.title);

const findings = [
  `1. **当前采用规模最大的标记主题**：${byTotal.slice(0, 3).map(x => `${x.title}（${n(x.totalUsers)} 人）`).join('、')}。`,
  `2. **近 ${data.meta.days} 天仍有真实使用的标记主题**：${byRecent.slice(0, 3).map(x => `${x.title}（${n(x.recentUsers)} 人）`).join('、')}。`,
  `3. **每日主题中近期使用最高**：${dailyByRecent[0].title}（${n(dailyByRecent[0].recentUsers)} 人）；复用率最高：${dailyByRepeat[0].title}（${dailyByRepeat[0].repeatRate}%）。`,
  zeroRecent.length ? `4. **近期零使用主题**：${zeroRecent.join('、')}，应优先检查入口可见性，再决定是否继续投入。` : `4. 所有标记主题近 ${data.meta.days} 天均有使用，迭代应优先看相对排名而非简单下线。`
];

const strong = byRecent[0];
const weak = [...markThemes].sort((a, b) => a.recentUsers - b.recentUsers || a.totalUsers - b.totalUsers)[0];
const habit = dailyByRecent[0];
const recommendations = [
  `1. **优先深化 ${strong.title}**：它的近期标记用户领先，优先优化标记、回看和分享链路。`,
  `2. **暂停扩充 ${weak.title}**：先验证首页曝光和内容可见性；若曝光正常仍低使用，则降低入口权重。`,
  `3. **每日主题先做 ${habit.title} 的持续使用**：围绕连续记录、历史回看和提醒提升复用，暂不新增第 5 个每日主题。`
];

const md = `# 全主题核心使用数据分析\n\n> 数据快照：${data.meta.snapshotAt}\n> 近期窗口：${data.meta.cutoffDate} 至快照时间（${data.meta.days} 天）\n\n## 全部功能核心指标\n\n| 功能/主题 | 类型 | 累计人数 | 累计行为数 | 人均标记 | 近 ${data.meta.days} 天人数 | 近 ${data.meta.days} 天行为数 |\n|---|---:|---:|---:|---:|---:|---:|\n${featureRows}\n\n## 4 个每日主题\n\n| 主题 | 累计人数 | 累计记录天数 | 近 ${data.meta.days} 天人数 | 近 ${data.meta.days} 记录天数 | 复用率 | 人均活跃天数 |\n|---|---:|---:|---:|---:|---:|---:|\n${dailyRows}\n\n## 核心发现\n\n${findings.join('\n\n')}\n\n## 迭代建议\n\n${recommendations.join('\n\n')}\n\n## 口径说明\n\n- ${data.meta.overlapNote}\n- ${data.meta.queryLimitation}\n- 复用率 = 累计记录至少 2 个不同日期的用户 ÷ 累计记录用户。\n- 首页展示的人为 +100 人数未纳入，本报告仅使用数据库真实值。\n`;

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, md, 'utf8');
console.log(`Report written: ${output}`);
