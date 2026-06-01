const toast = require('../../../utils/dailyToast.js');
const {
  getNavMetrics,
  todayStr,
  flattenMovies
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
    tab: 'wall',
    loading: true,

    movies: [],
    monthCards: [],
    review: {
      total: 0,
      avgRating: '-',
      activeDays: 0,
      topMovie: null,
      bestMonth: '-',
      favoriteDirector: '-'
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
    wx.setNavigationBarTitle({ title: '年度片单' });
    this.fetchYear();
  },

  onShow() {
    const today = todayStr();
    if (today !== this.data.today) this.setData({ today });
  },

  onBack() {
    if (getCurrentPages().length > 1) wx.navigateBack();
    else wx.redirectTo({ url: '/pages/daily/movie/index' });
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

  onTabTap(e) {
    const tab = e.currentTarget.dataset.tab;
    if (tab && tab !== this.data.tab) this.setData({ tab });
  },

  fetchYear() {
    this.setData({ loading: true });
    wx.cloud.callFunction({
      name: 'syncDailyLog',
      data: { action: 'getYear', theme: 'movie', year: this.data.year },
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
        console.error('movie year fail', err);
        toast.show(this, '网络异常');
        this.setData({ loading: false });
      }
    });
  },

  renderYear(days) {
    const movies = flattenMovies(days).map(movie => ({
      ...movie,
      rotate: this.posterRotate(movie)
    }));
    const monthGroups = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, count: 0, movies: [] }));
    movies.forEach(movie => {
      const idx = Number(movie.date.slice(5, 7)) - 1;
      if (idx >= 0) {
        monthGroups[idx].count += 1;
        monthGroups[idx].movies.push(movie);
      }
    });
    const monthCards = monthGroups.map(group => {
      const cover = this.pickMonthCover(group.movies);
      return {
        month: group.month,
        count: group.count,
        cover: cover && cover.posterThumb
      };
    });
    const ratings = movies.map(m => Number(m.rating)).filter(n => Number.isFinite(n) && n > 0);
    const avgRating = ratings.length ? (ratings.reduce((s, n) => s + n, 0) / ratings.length).toFixed(1) : '-';
    const topMovie = this.pickTopMovie(movies);
    const bestMonth = [...monthGroups].sort((a, b) => b.count - a.count)[0];
    const favoriteDirector = this.pickFavoriteDirector(movies);
    const thisYear = Number(this.data.today.slice(0, 4));
    this.setData({
      movies,
      monthCards,
      canGoNextYear: this.data.year < thisYear,
      review: {
        total: movies.length,
        avgRating,
        activeDays: (days || []).filter(d => (d.entries || []).length > 0).length,
        topMovie,
        bestMonth: bestMonth && bestMonth.count ? `${bestMonth.month}月 · ${bestMonth.count}部` : '-',
        favoriteDirector
      }
    });
  },

  posterRotate(movie) {
    const seed = Number(movie.doubanId) || Number(movie.ts) || 0;
    return `${(seed % 11) - 5}deg`;
  },

  pickMonthCover(movies) {
    if (!movies || !movies.length) return null;
    return [...movies].sort((a, b) => {
      const r = (Number(b.rating) || 0) - (Number(a.rating) || 0);
      if (r !== 0) return r;
      return (a.ts || 0) - (b.ts || 0);
    })[0];
  },

  pickTopMovie(movies) {
    const rated = (movies || []).filter(m => Number(m.rating) > 0);
    if (!rated.length) return null;
    return this.pickMonthCover(rated);
  },

  pickFavoriteDirector(movies) {
    const map = {};
    (movies || []).forEach(movie => {
      const director = (movie.director || '').split('/')[0].trim();
      if (!director) return;
      map[director] = (map[director] || 0) + 1;
    });
    const sorted = Object.keys(map).sort((a, b) => map[b] - map[a]);
    return sorted.length ? `${sorted[0]} · ${map[sorted[0]]}部` : '-';
  }
});
