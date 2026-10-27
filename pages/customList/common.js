// 自建影单 / 书单三个页面（index 入口 / edit 管理 / add 添加）共用的小工具。
// 清单本身由云函数 customList 存取（集合 custom_lists），展示与标记复用通用榜单页：
//   影单 → pages/genericList/list/list?theme=customMovie&listId=xxx
//   书单 → pages/genericBookList/list/list?theme=customBook&listId=xxx
const catalog = require('../../utils/themeCatalog.js');

const MAX_ITEMS = 200;
// 名称 / 说明语长度上限，与云函数 customList 的 TITLE_MAX / DESC_MAX 一致
const TITLE_MAX = 20;
const DESC_MAX = 40;

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

// 入口卡：影单、书单各一张，没有就给「创建」。「我的」入口页和分类页「自定义」分区共用
function buildCards(lists, quota) {
  return ['movie', 'book'].map(type => {
    const meta = TYPE_META[type];
    const mine = (lists || []).filter(l => l.type === type);
    return {
      type,
      noun: meta.noun,
      unit: meta.unit,
      item: meta.item,
      brand: meta.brand,
      soft: meta.soft,
      list: mine[0] || null,
      canCreate: mine.length < ((quota && quota[type]) || 1),
    };
  });
}

// 创建 / 修改「名称 + 说明语」都走表单页 info（showModal 只能放一个输入框）
function promptCreate(type) {
  if (!TYPE_META[type]) return;
  wx.navigateTo({ url: `/pages/customList/info/info?type=${type}` });
}

function infoUrl(list) {
  const q = v => encodeURIComponent(v || '');
  return `/pages/customList/info/info?listId=${list._id}&type=${list.type}&title=${q(list.title)}&description=${q(list.description)}`;
}

// 编辑过清单后，通知已打开的列表页 onShow 时重拉（按 listId 各记一份，影单书单互不覆盖；
// 列表页那头的读取见 dataLoader.consumeCustomListDirty）
function markDirty(listId) {
  const app = getApp();
  if (!app || !app.globalData || !listId) return;
  app.globalData.customListDirty = { ...(app.globalData.customListDirty || {}), [listId]: true };
}

// 条目副信息行：年份 · 第一位导演/作者 · 豆瓣分
function subLine(item, type) {
  const parts = [];
  if (item.year) parts.push(String(item.year).slice(0, 4));
  const who = type === 'book' ? item.author : item.director;
  if (who) parts.push(String(who).split(/[、/]/)[0].trim());
  const rating = Number(item.rating);
  if (rating > 0 && rating <= 10) parts.push(`豆瓣 ${item.rating}`);
  return parts.join(' · ');
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
    // 豆瓣读书 TOP250 的条目没有 doubanId 字段，_id 本身就是豆瓣 subject id
    doubanId: m.doubanId || (theme === 'douban_books' ? String(m._id) : ''),
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

module.exports = { MAX_ITEMS, TITLE_MAX, DESC_MAX, TYPE_META, callList, listUrl, buildCards, promptCreate, infoUrl, markDirty, subLine, rankingSources, snapshotFromRanking, snapshotFromSearch };
