/**
 * 每日读书 · 阅读记录分享海报绘制器
 *
 * 与每日电影共用 moviePosterDrawer 的全部版式 —— 单本封面海报（小红书 3:4 / 原始封面比例）、
 * 整体（2~3 本纵向 / 4+ 网格 / >12 本封面墙）、按月份 / 按评分长图、单月日历 —— 只换词表：
 * 部→本、观影→阅读、观影日→阅读日、占位 🎬→📖、单本封面海报的品牌 tint 走每日读书的橄榄绿
 * （category 卡片 brand `#A4B074 → #727E47`）。
 *
 * 绘制器不认识 author / progress 字段：分享页把「作者 xxx」映射成 byline、阅读进度（已读 N/M 页 · 已读 N 天）
 * 映射成 tags，单本封面海报上它们分别落在署名行和玻璃胶囊里。
 *
 * 用法与 MoviePosterDrawer 完全一致（computeSize / computeLayoutSize / summarize / THEMES / DEFAULT_THEME 随原型链继承）：
 *   new BookPosterDrawer(canvas, ctx, width, height).draw(data, coverNodes, themeId, layout);
 */
const MoviePosterDrawer = require('./moviePosterDrawer.js');

const BookPosterDrawer = MoviePosterDrawer.withVocab({
  unit: '本',
  verb: '阅读',
  dayLabel: '阅读日',
  untitled: '未命名书籍',
  emoji: '📖',
  emptyText: '这段时间还没有读书记录',
  tint: ['rgba(164,176,116,0.30)', 'rgba(114,126,71,0.30)'],
  heroSign: { dot: 'rgba(214,224,176,0.72)', text: 'rgba(247,250,240,0.62)' }
});

module.exports = BookPosterDrawer;
