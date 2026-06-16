/**
 * 读书查询相关的视图模型格式化工具
 * 被「每日读书」添加页复用（豆瓣单平台 + 作者/出版社等书籍信息）
 *
 * 字段约定：
 *   formatVotes(n)       → "11万"   （评分人数千位简写）
 *   decorateBook(book)   → 视图模型（含 votes 简写、豆瓣评分文本、作者/出版社文本、updatedDateCn）
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

// 千位分隔符：699743 → "699,743"
function addThousandSep(n) {
  if (n === null || n === undefined || n === '') return '';
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// 作者数组/字符串 → 单行展示文本（多位作者取首位 + 等）
function authorText(book) {
  if (Array.isArray(book.authors) && book.authors.length) {
    return book.authors.length > 1 ? `${book.authors[0]} 等` : book.authors[0];
  }
  return book.author || '';
}

function decorateBook(b) {
  const douban = b.douban || {};
  const author = authorText(b);
  return {
    ...b,
    douban,
    authorText: author,
    // 简写人数（窄空间用）
    doubanVotesLabel: douban.votes ? formatVotes(douban.votes) + '人评' : '',
    // 原始数字带千位分隔（宽空间用）
    doubanVotesRaw: douban.votes ? addThousandSep(douban.votes) + ' 人评' : '',
    // 豆瓣评分显示文本（缺数据返 '—'）
    doubanText: douban.rating ? String(douban.rating) : '—',
    hasDouban: !!douban.rating,
    // 出版信息单行文本
    publishText: [b.publisher, b.pubDate].filter(Boolean).join(' · '),
    updatedDateCn: cnDateStr(b.updatedAt),
    doubanVotesText: douban.votes ? `${douban.votes} 人` : '—'
  };
}

module.exports = {
  CN_TZ_OFFSET_MS,
  cnDateStr,
  formatVotes,
  addThousandSep,
  decorateBook
};
