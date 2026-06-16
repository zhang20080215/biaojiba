const toast = require('../../../utils/dailyToast.js');
const {
  WD_MON,
  getNavMetrics,
  todayStr,
  parseDate,
  dateStr,
  monthRange,
  addMonths,
  flattenBooks
} = require('./common.js');

const MAX_WEEK_BACK = 26;
const MAX_MONTH_BACK = 24;

Page({
  data: {
    toast: { show: false, text: '', icon: '' },
    statusBarHeight: 20,
    navBarHeight: 48,
    navOffset: 68,

    range: 'month',
    weekOffset: 0,
    monthOffset: 0,
    year: 2026,
    today: '',
    loading: true,

    headlineCap: '本月阅读',
    headline: { num: 0, sub: '累计 0 本' },
    periodLabel: '',
    canGoPrevPeriod: true,
    canGoNextPeriod: false,

    bars: [],
    weekHeader: WD_MON,
    kpi: []
  },

  onLoad() {
    const nav = getNavMetrics();
    const today = todayStr();
    this.setData({
      statusBarHeight: nav.statusBarHeight,
      navBarHeight: nav.navBarHeight,
      navOffset: nav.navOffset,
      today,
      year: Number(today.slice(0, 4))
    });
    wx.setNavigationBarColor({ frontColor: '#000000', backgroundColor: '#FAF6EB' });
    wx.setNavigationBarTitle({ title: '阅读统计' });
    this.fetchPeriod();
  },

  onShow() {
    const today = todayStr();
    if (today !== this.data.today) this.setData({ today });
    if (!this.data.loading) this.fetchPeriod();
  },

  onBack() {
    if (getCurrentPages().length > 1) wx.navigateBack();
    else wx.redirectTo({ url: '/pages/daily/read/index' });
  },

  onRangeTap(e) {
    const range = e.currentTarget.dataset.range;
    if (!range || range === this.data.range) return;
    const patch = { range };
    if (range === 'week') patch.weekOffset = 0;
    if (range === 'month') patch.monthOffset = 0;
    if (range === 'year') patch.year = Number(this.data.today.slice(0, 4));
    this.setData(patch);
    this.fetchPeriod();
  },

  onPrevPeriod() {
    const range = this.data.range;
    if (range === 'week') {
      const next = this.data.weekOffset - 1;
      if (next < -MAX_WEEK_BACK) return;
      this.setData({ weekOffset: next });
    } else if (range === 'month') {
      const next = this.data.monthOffset - 1;
      if (next < -MAX_MONTH_BACK) return;
      this.setData({ monthOffset: next });
    } else {
      this.setData({ year: this.data.year - 1 });
    }
    this.fetchPeriod();
  },

  onNextPeriod() {
    const range = this.data.range;
    if (range === 'week') {
      if (this.data.weekOffset >= 0) return;
      this.setData({ weekOffset: this.data.weekOffset + 1 });
    } else if (range === 'month') {
      if (this.data.monthOffset >= 0) return;
      this.setData({ monthOffset: this.data.monthOffset + 1 });
    } else {
      const thisYear = Number(this.data.today.slice(0, 4));
      if (this.data.year >= thisYear) return;
      this.setData({ year: this.data.year + 1 });
    }
    this.fetchPeriod();
  },

  fetchPeriod() {
    const range = this.data.range;
    this.setData({ loading: true });
    if (range === 'year') {
      wx.cloud.callFunction({
        name: 'syncDailyLog',
        data: { action: 'getYear', theme: 'read', year: this.data.year },
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
          console.error('movie stats getYear fail', err);
          toast.show(this, '网络异常');
          this.setData({ loading: false });
        }
      });
      return;
    }

    const period = range === 'week'
      ? this.weekRange(this.data.today, this.data.weekOffset)
      : this.monthRangeByOffset(this.data.today, this.data.monthOffset);
    wx.cloud.callFunction({
      name: 'syncDailyLog',
      data: { action: 'getRange', theme: 'read', from: period.from, to: period.to },
      success: res => {
        const result = res && res.result;
        if (!result || !result.success) {
          toast.show(this, '加载失败');
          this.setData({ loading: false });
          return;
        }
        if (range === 'week') this.renderWeek(result.days || [], period);
        else this.renderMonth(result.days || [], period);
        this.setData({ loading: false });
      },
      fail: err => {
        console.error('movie stats getRange fail', err);
        toast.show(this, '网络异常');
        this.setData({ loading: false });
      }
    });
  },

  renderWeek(days, period) {
    const stats = this.calcStats(days);
    const maxValue = Math.max(1, ...days.map(d => (d.entries || []).length));
    const bars = days.map(day => {
      const wd = WD_MON[(parseDate(day.date).getUTCDay() + 6) % 7];
      return this.barItem(wd, (day.entries || []).length, maxValue, flattenBooks([day])[0]);
    });
    const prefix = this.data.weekOffset === 0 ? '本周' : (this.data.weekOffset === -1 ? '上周' : `${-this.data.weekOffset}周前`);
    this.setData({
      headlineCap: `${prefix}阅读`,
      headline: { num: stats.total, sub: `平均评分 ${stats.avgRatingText} · 活跃 ${stats.activeDays} 天` },
      periodLabel: this.formatWeekLabel(period),
      canGoPrevPeriod: this.data.weekOffset > -MAX_WEEK_BACK,
      canGoNextPeriod: this.data.weekOffset < 0,
      bars,
      kpi: this.kpi(stats)
    });
  },

  renderMonth(days, period) {
    const stats = this.calcStats(days);
    const maxValue = Math.max(1, ...days.map(d => (d.entries || []).length));
    const bars = days.filter(d => (d.entries || []).length > 0)
      .map(day => this.barItem(String(Number(day.date.slice(8))), (day.entries || []).length, maxValue, this.topMovie(flattenBooks([day]))));
    const prefix = this.data.monthOffset === 0 ? '本月' : (this.data.monthOffset === -1 ? '上月' : `${-this.data.monthOffset}月前`);
    this.setData({
      headlineCap: `${prefix}阅读`,
      headline: { num: stats.total, sub: `平均评分 ${stats.avgRatingText} · 活跃 ${stats.activeDays} 天` },
      periodLabel: `${period.year}年${period.month}月`,
      canGoPrevPeriod: this.data.monthOffset > -MAX_MONTH_BACK,
      canGoNextPeriod: this.data.monthOffset < 0,
      bars,
      kpi: this.kpi(stats)
    });
  },

  renderYear(days) {
    const stats = this.calcStats(days);
    const monthBuckets = Array.from({ length: 12 }, (_, i) => ({ label: `${i + 1}月`, value: 0, movies: [] }));
    flattenBooks(days).forEach(movie => {
      const idx = Number(movie.date.slice(5, 7)) - 1;
      if (idx >= 0) {
        monthBuckets[idx].value += 1;
        monthBuckets[idx].movies.push(movie);
      }
    });
    const maxValue = Math.max(1, ...monthBuckets.map(m => m.value));
    const bars = monthBuckets.map(m => this.barItem(m.label, m.value, maxValue, this.topMovie(m.movies)));
    const thisYear = Number(this.data.today.slice(0, 4));
    this.setData({
      headlineCap: `${this.data.year}年阅读`,
      headline: { num: stats.total, sub: `平均评分 ${stats.avgRatingText} · 活跃 ${stats.activeDays} 天` },
      periodLabel: `${this.data.year}年`,
      canGoPrevPeriod: true,
      canGoNextPeriod: this.data.year < thisYear,
      bars,
      kpi: this.kpi(stats)
    });
  },

  calcStats(days) {
    const movies = flattenBooks(days);
    const ratings = movies.map(m => Number(m.rating)).filter(n => Number.isFinite(n) && n > 0);
    const total = movies.length;
    const activeDays = (days || []).filter(d => (d.entries || []).length > 0).length;
    const avgRating = ratings.length ? ratings.reduce((s, n) => s + n, 0) / ratings.length : 0;
    const spanDays = Math.max(1, (days || []).length || 1);
    return {
      total,
      activeDays,
      avgRatingText: ratings.length ? avgRating.toFixed(1) : '-',
      dailyAvg: (total / spanDays).toFixed(1)
    };
  },

  kpi(stats) {
    return [
      { label: '总本数', value: stats.total, unit: '本' },
      { label: '平均评分', value: stats.avgRatingText, unit: '星' },
      { label: '活跃天数', value: stats.activeDays, unit: '天' },
      { label: '日均本数', value: stats.dailyAvg, unit: '本' }
    ];
  },

  topMovie(movies) {
    if (!movies || !movies.length) return null;
    return [...movies].sort((a, b) => {
      const r = (Number(b.rating) || 0) - (Number(a.rating) || 0);
      if (r !== 0) return r;
      return (a.ts || 0) - (b.ts || 0);
    })[0];
  },

  barItem(label, value, maxValue, movie) {
    return {
      label,
      value,
      fillPctH: value ? Math.max(10, Math.round((value / maxValue) * 100)) : 0,
      coverThumb: movie && movie.posterThumb,
      title: movie && movie.title
    };
  },

  weekRange(today, offset) {
    const date = parseDate(today);
    const wd = (date.getUTCDay() + 6) % 7;
    const monday = new Date(date.getTime());
    monday.setUTCDate(monday.getUTCDate() - wd + offset * 7);
    const sunday = new Date(monday.getTime());
    sunday.setUTCDate(monday.getUTCDate() + 6);
    return { from: dateStr(monday), to: dateStr(sunday), fromDate: monday, toDate: sunday };
  },

  monthRangeByOffset(today, offset) {
    const p = today.split('-').map(Number);
    const next = addMonths(p[0], p[1], offset);
    return monthRange(next.year, next.month);
  },

  formatWeekLabel(period) {
    const f = period.fromDate;
    const t = period.toDate;
    const fm = f.getUTCMonth() + 1;
    const fd = f.getUTCDate();
    const tm = t.getUTCMonth() + 1;
    const td = t.getUTCDate();
    if (fm === tm) return `${fm}月${fd}日 - ${td}日`;
    return `${fm}月${fd}日 - ${tm}月${td}日`;
  }
});
