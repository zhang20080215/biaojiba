// 全平台电影评分查询：详情页
// 入参 query.doubanId → 调 fetchMovieFullInfo 拿三平台数据

Page({
  data: {
    doubanId: '',
    movie: null,
    cached: false,
    updatedAtDisplay: '',
    loading: false,
    error: ''
  },

  onLoad(query) {
    const doubanId = (query && query.doubanId) || '';
    if (!doubanId) {
      this.setData({ error: '缺少电影 ID' });
      return;
    }
    this.setData({ doubanId });
    this.fetchInfo(false);
  },

  async onRefresh() {
    await this.fetchInfo(true);
  },

  async fetchInfo(forceRefresh) {
    if (!this.data.doubanId) return;
    if (this.data.loading) return;

    this.setData({ loading: true, error: '' });

    try {
      const res = await wx.cloud.callFunction({
        name: 'fetchMovieFullInfo',
        data: {
          doubanId: this.data.doubanId,
          forceRefresh: !!forceRefresh
        }
      });
      const result = res && res.result;
      if (!result || !result.success || !result.movie) {
        this.setData({
          loading: false,
          error: (result && result.error) || '获取电影数据失败'
        });
        return;
      }

      const movie = result.movie;
      // 给前端展示用，把缺失字段补成空对象避免 wxml 访问 undefined
      const safeMovie = {
        ...movie,
        douban: movie.douban || {},
        imdb: movie.imdb || {},
        rottenTomatoes: movie.rottenTomatoes || {}
      };

      this.setData({
        loading: false,
        movie: safeMovie,
        cached: !!result.cached,
        updatedAtDisplay: this._formatTime(movie.updatedAt)
      });
    } catch (e) {
      console.error('fetchMovieFullInfo 异常', e);
      this.setData({ loading: false, error: '网络异常，请重试' });
    }
  },

  _formatTime(value) {
    if (!value) return '—';
    try {
      const d = new Date(value);
      if (isNaN(d.getTime())) return '—';
      const yyyy = d.getFullYear();
      const MM = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      const HH = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      return `${yyyy}-${MM}-${dd} ${HH}:${mm}`;
    } catch (e) {
      return '—';
    }
  }
});
