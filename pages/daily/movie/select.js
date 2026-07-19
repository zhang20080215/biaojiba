const toast = require('../../../utils/dailyToast.js');
const { getNavMetrics, formatDateCN, flattenMovies } = require('./common.js');

const WEEK_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function weekdayOf(dateStr) {
  const p = String(dateStr || '').split('-').map(Number);
  if (p.length < 3 || p.some(isNaN)) return '';
  return WEEK_CN[new Date(p[0], p[1] - 1, p[2]).getDay()];
}

function keyOf(m) {
  return `${m.date}-${m.ts}`;
}

Page({
  data: {
    toast: { show: false, text: '', icon: '' },
    statusBarHeight: 20,
    navBarHeight: 48,
    navOffset: 68,
    navRightInset: 96,

    loading: true,
    groups: [],          // [{ date, dateLabel, weekLabel, movies:[{key, ...}] }]
    total: 0,            // 总记录数
    selectedCount: 0,
    allSelected: false
  },

  // 所有已展平的电影（含 selected 标记），date 降序 / 同日 ts 降序
  _all: [],
  // 选中态：{ key: true }
  _selected: {},

  onLoad() {
    const nav = getNavMetrics();
    this.setData({
      statusBarHeight: nav.statusBarHeight,
      navBarHeight: nav.navBarHeight,
      navOffset: nav.navOffset,
      navRightInset: nav.navRightInset
    });
    this.fetchAll();
  },

  onBack() {
    if (getCurrentPages().length > 1) wx.navigateBack();
    else wx.redirectTo({ url: '/pages/daily/movie/index' });
  },

  fetchAll() {
    wx.cloud.callFunction({
      name: 'syncDailyLog',
      data: { action: 'getAll', theme: 'movie' },
      success: res => {
        const result = res && res.result;
        if (!result || !result.success) {
          toast.show(this, '加载失败');
          this.setData({ loading: false });
          return;
        }
        const list = flattenMovies(result.days || []);
        // 展示序：日期倒序，同日按 ts 倒序（最近看的在最前）
        list.sort((a, b) => {
          if (a.date !== b.date) return a.date < b.date ? 1 : -1;
          return (b.ts || 0) - (a.ts || 0);
        });
        this._all = list;
        // 默认全选（分享意图通常是把最近这批一起晒出来；可再手动取消）
        this._selected = {};
        list.forEach(m => { this._selected[keyOf(m)] = true; });
        this._render();
        this.setData({ loading: false });
      },
      fail: err => {
        console.error('movie select getAll fail', err);
        toast.show(this, '加载失败');
        this.setData({ loading: false });
      }
    });
  },

  // 依据 _all + _selected 重建分组视图 + 计数
  _render() {
    const groupsMap = {};
    const order = [];
    this._all.forEach(m => {
      const k = m.date;
      if (!groupsMap[k]) {
        groupsMap[k] = { date: k, dateLabel: formatDateCN(k), weekLabel: weekdayOf(k), movies: [] };
        order.push(k);
      }
      groupsMap[k].movies.push({
        key: keyOf(m),
        date: m.date,
        ts: m.ts,
        title: m.title,
        year: m.year,
        posterThumb: m.posterThumb,
        ratingText: m.ratingText,
        rating: m.rating,
        moodEmoji: m.moodEmoji,
        moodLabel: m.moodLabel,
        selected: !!this._selected[keyOf(m)]
      });
    });
    const groups = order.map(k => groupsMap[k]);
    const total = this._all.length;
    const selectedCount = this._all.reduce((n, m) => n + (this._selected[keyOf(m)] ? 1 : 0), 0);
    this.setData({
      groups,
      total,
      selectedCount,
      allSelected: total > 0 && selectedCount === total
    });
  },

  onToggle(e) {
    const key = e.currentTarget.dataset.key;
    if (!key) return;
    if (this._selected[key]) delete this._selected[key];
    else this._selected[key] = true;
    this._render();
  },

  onToggleAll() {
    if (this.data.allSelected) {
      this._selected = {};
    } else {
      this._selected = {};
      this._all.forEach(m => { this._selected[keyOf(m)] = true; });
    }
    this._render();
  },

  onGenerate() {
    const picked = this._all.filter(m => this._selected[keyOf(m)]);
    if (!picked.length) {
      toast.show(this, '请至少选择 1 部电影');
      return;
    }
    // 海报里按日期升序（时间线从早到晚），同日按 ts 升序
    const ordered = picked.slice().sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return (a.ts || 0) - (b.ts || 0);
    });
    const app = getApp();
    if (app && app.globalData) app.globalData.moviePosterSelection = ordered;
    wx.navigateTo({ url: '/pages/daily/movie/share' });
  }
});
