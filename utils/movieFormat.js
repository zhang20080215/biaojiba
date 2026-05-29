/**
 * 电影查询相关的视图模型格式化工具
 * 被 movie-search 三页（input / list / detail）共用
 *
 * 字段约定：
 *   formatVotes(n)           → "110万"   （评分人数千位简写）
 *   formatRtCount(str)       → "25万+"   （RT count 字符串如 "250,000+"）
 *   decorateMovie(movie)     → 视图模型（含 votes 简写、4 平台显示文本、director 文本、updatedDateCn）
 */

const CN_TZ_OFFSET_MS = 8 * 60 * 60 * 1000;

function cnDateStr(ts) {
  if (!ts) return '';
  const t = typeof ts === 'number' ? ts : new Date(ts).getTime();
  if (isNaN(t)) return '';
  return new Date(t + CN_TZ_OFFSET_MS).toISOString().slice(0, 10);
}

function formatVotes(n) {
  if (n === undefined || n === null || n === '') return '';
  const num = typeof n === 'number' ? n : parseInt(String(n).replace(/[^\d]/g, ''), 10);
  if (isNaN(num) || num <= 0) return '';
  if (num < 10000) return String(num);
  if (num < 100000) return (num / 10000).toFixed(1) + '万';
  if (num < 100000000) return Math.round(num / 10000) + '万';
  return (num / 100000000).toFixed(1) + '亿';
}

function formatRtCount(s) {
  if (!s) return '';
  const str = String(s).trim();
  const hasPlus = /\+\s*$/.test(str);
  const num = parseInt(str.replace(/[^\d]/g, ''), 10);
  if (isNaN(num)) return str;
  return formatVotes(num) + (hasPlus ? '+' : '');
}

// 千位分隔符：699743 → "699,743"
function addThousandSep(n) {
  if (n === null || n === undefined || n === '') return '';
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function decorateMovie(m) {
  const douban = m.douban || {};
  const imdb = m.imdb || {};
  const rt = m.rottenTomatoes || {};
  // 兼容新旧文档：新版 rt.critic.score，旧版只有 rt.score
  const rtCritic = (rt.critic && rt.critic.score) || rt.score || '';
  const rtAudience = (rt.audience && rt.audience.score) || '';
  const rtCriticCount = rt.critic && rt.critic.count;
  const rtAudienceCount = rt.audience && rt.audience.count;
  const directorText = Array.isArray(m.directors) && m.directors.length
    ? (m.directors.length > 1 ? `${m.directors[0]} 等` : m.directors[0])
    : '';
  return {
    ...m,
    douban,
    imdb,
    rottenTomatoes: rt,
    directorText,
    // 简写人数 / 评论数（list / 主页 hero 用，窄空间）
    doubanVotesLabel: douban.votes ? formatVotes(douban.votes) + '人评' : '',
    imdbVotesLabel: imdb.votes ? formatVotes(imdb.votes) + '人评' : '',
    rtCriticCountLabel: rtCriticCount ? formatRtCount(rtCriticCount) + '条' : '',
    rtAudienceCountLabel: rtAudienceCount ? formatRtCount(rtAudienceCount) + '人评' : '',
    // 原始数字带千位分隔（detail 页用，宽空间下展示精确数据）
    doubanVotesRaw: douban.votes ? addThousandSep(douban.votes) + ' 人评' : '',
    imdbVotesRaw: imdb.votes ? addThousandSep(imdb.votes) + ' 人评' : '',
    rtCriticCountRaw: rtCriticCount ? String(rtCriticCount).trim() + ' 条' : '',
    rtAudienceCountRaw: rtAudienceCount ? String(rtAudienceCount).trim() + ' 人评' : '',
    // 4 平台显示文本（评分数字字符串，缺数据返 '—'）
    rtCriticText: rtCritic || '—',
    rtAudienceText: rtAudience || '—',
    hasRtCritic: !!rtCritic,
    hasRtAudience: !!rtAudience,
    updatedDateCn: cnDateStr(m.updatedAt),
    // 兼容老调用方
    doubanVotesText: douban.votes ? `${douban.votes} 人` : '—',
    imdbVotesText: imdb.votes ? `${imdb.votes} 人` : '—'
  };
}

module.exports = {
  CN_TZ_OFFSET_MS,
  cnDateStr,
  formatVotes,
  formatRtCount,
  addThousandSep,
  decorateMovie
};
