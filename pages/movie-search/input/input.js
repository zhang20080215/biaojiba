// 全平台电影评分查询：输入页
// 用户输入电影名 → 调 searchMovieByTitle 拿豆瓣候选 → 点候选跳 detail 页

Page({
  data: {
    keyword: '',
    loading: false,
    candidates: [],
    searched: false,
    error: ''
  },

  onKeywordInput(e) {
    this.setData({ keyword: e.detail.value });
  },

  async onSearch() {
    const keyword = (this.data.keyword || '').trim();
    if (!keyword) {
      wx.showToast({ title: '请输入电影名', icon: 'none' });
      return;
    }
    if (this.data.loading) return;

    this.setData({ loading: true, error: '', candidates: [], searched: false });

    try {
      const res = await wx.cloud.callFunction({
        name: 'searchMovieByTitle',
        data: { keyword }
      });
      const result = res && res.result;
      if (!result || !result.success) {
        this.setData({
          loading: false,
          error: (result && result.error) || '搜索失败，请稍后重试',
          searched: true
        });
        return;
      }
      this.setData({
        loading: false,
        candidates: result.candidates || [],
        searched: true,
        error: ''
      });
    } catch (e) {
      console.error('searchMovieByTitle 异常', e);
      this.setData({
        loading: false,
        error: '网络异常，请稍后重试',
        searched: true
      });
    }
  },

  onTapCandidate(e) {
    const doubanId = e.currentTarget.dataset.doubanId;
    if (!doubanId) return;
    wx.navigateTo({
      url: `/pages/movie-search/detail/detail?doubanId=${doubanId}`
    });
  },

  onGoToList() {
    wx.navigateTo({ url: '/pages/movie-search/list/list' });
  }
});
