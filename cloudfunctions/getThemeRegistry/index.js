// cloudfunctions/getThemeRegistry/index.js
// 通用主题「注册表」读取函数 —— 让新增一个书单/影单主题不用发版：
// 往 theme_registry 集合插一条文档（+ 用 enrichThemeMovies/enrichThemeBooks 灌库）即可，
// 前端分类页拉这个函数动态生成卡片，genericList/genericBookList 页面靠 ?theme= 复用现有页面。
//
// 现有 21 个老主题仍是前端硬编码（永久兜底），本表只承载「往后新增」的通用主题，互不干扰。
//
// theme_registry 文档结构（一条 = 一个新主题）：
//   {
//     theme:        'rtThriller',            // 主题 id，全局唯一，= 页面 ?theme= 的值
//     type:         'movie' | 'book',        // 决定跳 genericList 还是 genericBookList、集合、marks 表
//     enabled:      true,                    // false 则不下发（可做灰度/预置）
//     order:        100,                     // 分类页网格里的排序（升序，越小越靠前）
//     // —— 分类页卡片 ——
//     cardId:       'rt_thriller_movies',    // 卡片 id（前端 data.themes 里的 id，需与老卡片不冲突）
//     title:        '史上最佳惊悚电影',
//     description:  '……',
//     tag:          '电影',                  // 封面左上角标签
//     category:     'movie',                 // 筛选 tab：'movie' | 'oscar' | 'reading'
//     newBadge:     true,                    // 是否显示 NEW 角标
//     wishFrom:     '',                      // 「来自用户 X 的许愿」，空则不显示
//     placeholderEmoji: '🔪',               // 封面图加载前/失败时的占位 emoji
//     // —— 列表/海报页展示配置（镜像 utils/genericThemeConfig.js 的字段）——
//     slogan:       '……',
//     brandPrimary: '#8E2A2A',
//     brandSoft:    '#B5514C',
//     shadowRgb:    '142, 42, 42',
//     showEdition:  false,
//     editionField: 'edition',               // 'edition' | 'rank'
//     showYear:     false,                   // 书单按年份评奖时用
//     orderDirection: 'asc',                 // 'asc' | 'desc'
//     source:       'rtThriller'             // 书单专用：写入 BookMarks 的 source 值
//   }
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const MAX_LIMIT = 100;

exports.main = async (event, context) => {
  try {
    // 集合可能尚未创建（第一个新主题上线前）：优雅返回空，前端走硬编码兜底
    let query = db.collection('theme_registry').where({ enabled: db.command.neq(false) });

    let total = 0;
    try {
      const countRes = await query.count();
      total = countRes.total;
    } catch (e) {
      // 集合不存在等场景
      return { success: true, themes: [] };
    }
    if (total === 0) return { success: true, themes: [] };

    const batchTimes = Math.ceil(total / MAX_LIMIT);
    const tasks = [];
    for (let i = 0; i < batchTimes; i++) {
      tasks.push(query.orderBy('order', 'asc').skip(i * MAX_LIMIT).limit(MAX_LIMIT).get());
    }
    const results = await Promise.all(tasks);
    let themes = [];
    results.forEach(r => { themes = themes.concat(r.data); });

    // 只回传前端需要的字段，且做基本兜底；order 升序稳定排序
    themes = themes
      .filter(t => t && t.theme && t.cardId)
      .sort((a, b) => (a.order || 0) - (b.order || 0));

    return { success: true, themes };
  } catch (err) {
    console.error('getThemeRegistry 失败', err);
    return { success: false, error: (err && err.message) || 'unknown', themes: [] };
  }
};
