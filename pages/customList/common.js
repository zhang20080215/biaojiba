// 自建影单 / 书单三个页面（index 入口 / edit 管理 / add 添加）共用的小工具。
// 清单本身由云函数 customList 存取（集合 custom_lists），展示与标记复用通用榜单页：
//   影单 → pages/genericList/list/list?theme=customMovie&listId=xxx
//   书单 → pages/genericBookList/list/list?theme=customBook&listId=xxx
const catalog = require('../../utils/themeCatalog.js');

const MAX_ITEMS = 200;

const TYPE_META = {
  movie: {
    noun: '影单', unit: '部', item: '电影', verb: '片名',
    theme: 'customMovie',
    listPage: '/pages/genericList/list/list',
    brand: '#526631', soft: '#EEF2E5',
    searchFn: 'searchMovieByTitle',
  },
  book: {
    noun: '书单', unit: '本', item: '图书', verb: '书名',
    theme: 'customBook',
    listPage: '/pages/genericBookList/list/list',
    brand: '#8A5A3C', soft: '#F5ECE4',
    searchFn: 'searchBookByTitle',
  },
};

async function callList(action, data) {
  const res = await wx.cloud.callFunction({ name: 'customList', data: { action, ...(data || {}) } });
  const result = res && res.result;
  if (!result || !result.success) {
    const err = new Error((result && result.error) || '网络异常，请重试');
    err.code = result && result.code;
    throw err;
  }
  return result;
}

function listUrl(list) {
  const meta = TYPE_META[list.type];
  return `${meta.listPage}?theme=${meta.theme}&listId=${list._id}&title=${encodeURIComponent(list.title || '')}`;
}

// 编辑过清单后，通知已打开的列表页 onShow 时重拉
function markDirty(listId) {
  const app = getApp();
  if (app && app.globalData) app.globalData.customListDirty = listId;
}

// 「从榜单添加」可选的来源：分类目录里走通用影单/书单页的榜单 + 豆瓣电影 TOP250
const MOVIE_PAGE_RE = /^\/pages\/genericList\/list\/list\?theme=(\w+)/;
const BOOK_PAGE_RE = /^\/pages\/genericBookList\/list\/list\?theme=(\w+)/;

function rankingSources(type) {
  const out = [];
  catalog.forEach(row => {
    const url = row.url || '';
    if (row.hidden) return;
    if (type === 'movie') {
      if (url.indexOf('/pages/douban/list/list') === 0) out.unshift({ theme: 'douban', title: row.title, orderDirection: 'asc' });
      const m = url.match(MOVIE_PAGE_RE);
      if (m) out.push({ theme: m[1], title: row.title });
    } else {
      const m = url.match(BOOK_PAGE_RE);
      if (m) out.push({ theme: m[1], title: row.title });
    }
  });
  return out;
}

// 榜单条目 → 清单条目快照（字段白名单在云函数里再过一遍）
function snapshotFromRanking(m, theme, type, markSource) {
  const base = {
    _id: String(m._id),
    title: m.title || m.name || '',
    year: m.year || '',
    cover: m.cover || m.coverUrl || m.originalCover || m.bangumiCover || '',
    doubanId: m.doubanId || '',
    ratingCount: m.ratingCount || 0,
    from: theme,
  };
  if (type === 'book') {
    return { ...base, author: m.author || '', publisher: m.publisher || '', rating: m.rating, markSource };
  }
  // IMDb 榜的 rating 是 IMDb 分，清单统一标「豆瓣」，不带过来
  return { ...base, rating: theme === 'imdb' ? 0 : m.rating, director: m.director || '', country: m.country || '' };
}

function snapshotFromSearch(c, type) {
  const base = {
    title: c.title || '',
    year: c.year || '',
    cover: c.posterUrl || c.cover || '',
    doubanId: String(c.doubanId || ''),
    rating: c.rating || 0,
    ratingCount: c.ratingCount || 0,
    from: 'search',
  };
  return type === 'book'
    ? { ...base, author: c.author || '', publisher: c.publisher || '' }
    : { ...base, director: c.director || '' };
}

module.exports = { MAX_ITEMS, TYPE_META, callList, listUrl, markDirty, rankingSources, snapshotFromRanking, snapshotFromSearch };
