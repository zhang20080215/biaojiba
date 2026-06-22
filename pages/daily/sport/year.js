const toast = require('../../../utils/dailyToast.js');
const {
  getNavMetrics,
  todayStr,
  flattenSports
} = require('./common.js');

Page({
  data: {
    toast: { show: false, text: '', icon: '' },
    statusBarHeight: 20,
    navBarHeight: 48,
    navOffset: 68,

    today: '',
    year: 2026,
    canGoNextYear: false,
    loading: true,

    total: 0,
    monthCards: [],
    review: {
      total: 0,
      totalDuration: 0,
      activeDays: 0,
      bestMonth: '-',
      favoriteType: '-'
    }
  },

  onLoad(options) {
    const nav = getNavMetrics();
    const today = todayStr();
    const year = Number((options && options.year) || today.slice(0, 4));
    this.setData({
      statusBarHeight: nav.statusBarHeight,
      navBarHeight: nav.navBarHeight,
      navOffset: nav.navOffset,
      today,
      year
    });
    wx.setNavigationBarColor({ frontColor: '#000000', backgroundColor: '#FAF6EB' });
    wx.setNavigationBarTitle({ title: '年度运动' });
    this.fetchYear();
  },

  onShow() {
    const today = todayStr();
    if (today !== this.data.today) this.setData({ today });
  },

  onBack() {
    if (getCurrentPages().length > 1) wx.navigateBack();
    else wx.redirectTo({ url: '/pages/daily/sport/index' });
  },

  onPrevYear() {
    this.setData({ year: this.data.year - 1 });
    this.fetchYear();
  },

  onNextYear() {
    if (!this.data.canGoNextYear) return;
    this.setData({ year: this.data.year + 1 });
    this.fetchYear();
  },

  fetchYear() {
    this.setData({ loading: true });
    wx.cloud.callFunction({
      name: 'syncDailyLog',
      data: { action: 'getYear', theme: 'sport', year: this.data.year },
      success: res => {
        const result = res && res.result;
        if (!result || !result.success) {
          toast.show(this, '加载失败');
          this.setData({ loading: false });
          return;
        }
        this.renderYear(result.days || []);
        this.setData({ loading: false });
      },
      fail: err => {
        console.error('sport year fail', err);
        toast.show(this, '网络异常');
        this.setData({ loading: false });
      }
    });
  },

  renderYear(days) {
    const sports = flattenSports(days);
    const monthGroups = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, count: 0, sports: [] }));
    sports.forEach(sport => {
      const idx = Number(sport.date.slice(5, 7)) - 1;
      if (idx >= 0) {
        monthGroups[idx].count += 1;
        monthGroups[idx].sports.push(sport);
      }
    });
    const monthCards = monthGroups.map(group => ({
      month: group.month,
      count: group.count,
      icon: this.pickMonthIcon(group.sports)
    }));
    const totalDuration = Math.round(sports.reduce((s, m) => s + (Number(m.duration) || 0), 0));
    const bestMonth = [...monthGroups].sort((a, b) => b.count - a.count)[0];
    const favoriteType = this.pickFavoriteType(sports);
    const thisYear = Number(this.data.today.slice(0, 4));
    this.setData({
      total: sports.length,
      monthCards,
      canGoNextYear: this.data.year < thisYear,
      review: {
        total: sports.length,
        totalDuration,
        activeDays: (days || []).filter(d => (d.entries || []).length > 0).length,
        bestMonth: bestMonth && bestMonth.count ? `${bestMonth.month}月 · ${bestMonth.count}次` : '-',
        favoriteType
      }
    });
  },

  // 代表性 emoji：取该月时长最长的一条
  pickMonthIcon(sports) {
    if (!sports || !sports.length) return '';
    const top = [...sports].sort((a, b) => {
      const d = (Number(b.duration) || 0) - (Number(a.duration) || 0);
      if (d !== 0) return d;
      return (a.ts || 0) - (b.ts || 0);
    })[0];
    return top && top.icon;
  },

  pickFavoriteType(sports) {
    const map = {};
    (sports || []).forEach(sport => {
      const type = (sport.type || '').trim();
      if (!type) return;
      map[type] = (map[type] || 0) + 1;
    });
    const sorted = Object.keys(map).sort((a, b) => map[b] - map[a]);
    return sorted.length ? `${sorted[0]} · ${map[sorted[0]]}次` : '-';
  }
});
