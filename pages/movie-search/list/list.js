// 全平台电影评分查询：用户查询历史列表

Page({
  data: {
    movies: [],
    total: 0,
    loading: false,
    error: ''
  },

  onLoad() {
    this.loadQueries();
  },

  onShow() {
    // 从 detail 页返回时刷新（可能用户在 detail 页刷新过数据）
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
      // 给前端展示用，把缺失字段补成空对象避免 wxml 访问 undefined
      const movies = (result.movies || []).map(m => ({
        ...m,
        douban: m.douban || {},
        imdb: m.imdb || {},
        rottenTomatoes: m.rottenTomatoes || {}
      }));
      this.setData({
        loading: false,
        movies,
        total: movies.length
      });
    } catch (e) {
      console.error('getMyMovieQueries 异常', e);
      this.setData({ loading: false, error: '网络异常' });
    }
  },

  onTapMovie(e) {
    const doubanId = e.currentTarget.dataset.doubanId;
    if (!doubanId) return;
    wx.navigateTo({
      url: `/pages/movie-search/detail/detail?doubanId=${doubanId}`
    });
  },

  onGoToSearch() {
    wx.navigateTo({ url: '/pages/movie-search/input/input' });
  }
});
