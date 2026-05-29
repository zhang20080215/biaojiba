// 全平台电影评分查询：用户查询历史列表
// 与 input 页历史区共用同一套卡片样式 + "更新"按钮交互

const toast = require('../../../utils/dailyToast.js');
const { cnDateStr, decorateMovie } = require('../../../utils/movieFormat.js');

Page({
  data: {
    movies: [],
    total: 0,
    loading: false,
    error: '',
    queryingDoubanId: '',
    todayCnStr: cnDateStr(Date.now()),
    toast: { show: false, text: '', icon: '' },
    swipedDoubanId: ''
  },

  onLoad() {
    this.loadQueries();
  },

  onShow() {
    this.setData({ todayCnStr: cnDateStr(Date.now()) });
    if (this.data.movies.length > 0) {
      this.loadQueries();
    }
  },

  async onPullDownRefresh() {
    await this.loadQueries();
    wx.stopPullDownRefresh();
  },

  async loadQueries() {
    if (this.data.loading) return;
    this.setData({ loading: true, error: '' });

    try {
      const res = await wx.cloud.callFunction({
        name: 'getMyMovieQueries',
        data: {}
      });
      const result = res && res.result;
      if (!result || !result.success) {
        this.setData({
          loading: false,
          error: (result && result.error) || '加载失败'
        });
        return;
      }
      const movies = (result.movies || []).map(decorateMovie);
      this.setData({
        loading: false,
        movies,
        total: movies.length,
        todayCnStr: cnDateStr(Date.now())
      });
    } catch (e) {
      console.error('getMyMovieQueries 异常', e);
      this.setData({ loading: false, error: '网络异常' });
    }
  },

  onCardTouchStart(e) {
    const touch = e.touches[0];
    this._touchStart = {
      x: touch.clientX,
      y: touch.clientY,
      doubanId: e.currentTarget.dataset.doubanId
    };
  },

  onCardTouchEnd(e) {
    if (!this._touchStart) return;
    const touch = e.changedTouches[0];
    const dx = touch.clientX - this._touchStart.x;
    const dy = touch.clientY - this._touchStart.y;
    const doubanId = this._touchStart.doubanId;
    this._touchStart = null;
    if (Math.abs(dx) > Math.abs(dy) * 1.5 && Math.abs(dx) > 50) {
      if (dx < 0) this.setData({ swipedDoubanId: doubanId });
      else if (this.data.swipedDoubanId === doubanId) this.setData({ swipedDoubanId: '' });
    }
  },

  onTapMovie(e) {
    if (this.data.swipedDoubanId) {
      this.setData({ swipedDoubanId: '' });
      return;
    }
    const doubanId = e.currentTarget.dataset.doubanId;
    if (!doubanId) return;
    wx.navigateTo({
      url: `/pages/movie-search/detail/detail?doubanId=${doubanId}`
    });
  },

  onSwipeUpdate(e) {
    const doubanId = e.currentTarget.dataset.doubanId;
    const updatedAt = e.currentTarget.dataset.updatedAt;
    this.setData({ swipedDoubanId: '' });
    if (!doubanId) return;
    if (this.data.queryingDoubanId) {
      toast.show(this, '正在查询中，请稍后');
      return;
    }
    if (updatedAt && cnDateStr(updatedAt) === cnDateStr(Date.now())) {
      toast.show(this, '24 小时内评分变化有限，每天仅可更新一次', { duration: 2600 });
      return;
    }
    this._fetchScore(doubanId);
  },

  onSwipeDelete(e) {
    const doubanId = e.currentTarget.dataset.doubanId;
    const title = e.currentTarget.dataset.title || '该记录';
    this.setData({ swipedDoubanId: '' });
    if (!doubanId) return;
    wx.showModal({
      title: '删除记录',
      content: `确定从最近查询中移除「${title}」吗？`,
      confirmText: '删除',
      confirmColor: '#D63838',
      success: (r) => {
        if (r.confirm) this._deleteQuery(doubanId);
      }
    });
  },

  async _deleteQuery(doubanId) {
    try {
      const res = await wx.cloud.callFunction({
        name: 'deleteMovieQuery',
        data: { doubanId }
      });
      const result = res && res.result;
      if (result && result.success) {
        const movies = this.data.movies.filter(m => String(m.doubanId) !== String(doubanId));
        this.setData({ movies, total: movies.length });
        toast.show(this, '已删除', { icon: 'success' });
      } else {
        toast.show(this, '删除失败，请稍后重试');
      }
    } catch (e) {
      console.error('deleteMovieQuery 异常', e);
      toast.show(this, '网络异常，请稍后重试');
    }
  },

  // 老 onTapUpdate 已被左滑改造替代（onSwipeUpdate），保留空函数防止任何旧绑定报错
  onTapUpdate() {},

  async _fetchScore(doubanId) {
    this.setData({ queryingDoubanId: doubanId });
    wx.showLoading({ title: '抓取多平台数据中…', mask: true });

    try {
      const res = await wx.cloud.callFunction({
        name: 'fetchMovieFullInfo',
        data: { doubanId, forceRefresh: true }
      });
      const result = res && res.result;
      wx.hideLoading();
      this.setData({ queryingDoubanId: '' });

      if (!result || !result.success) {
        toast.show(this, '查询失败，请稍后重试');
        return;
      }
      // 服务端当日限流（forceRefresh 时）
      if (result.refreshLimited) {
        toast.show(this, '24 小时内评分变化有限，每天仅可更新一次', { duration: 2600 });
        this.loadQueries();
        return;
      }
      this.loadQueries();
      toast.show(this, '已更新', { icon: 'success' });
    } catch (e) {
      console.error('fetchMovieFullInfo 异常', e);
      wx.hideLoading();
      this.setData({ queryingDoubanId: '' });
      toast.show(this, '网络异常，请稍后重试');
    }
  },

  onGoToSearch() {
    wx.navigateTo({ url: '/pages/movie-search/input/input' });
  }
});
