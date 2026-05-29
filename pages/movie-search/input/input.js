// 全平台电影评分查询：输入页
// 1. 顶部搜索框 → 调 searchMovieByTitle 拿候选
// 2. 候选卡片"查询评分"按钮 → 调 fetchMovieFullInfo → 成功跳 detail
// 3. 下方展示历史记录卡片(豆瓣/IMDB/烂番茄 三平台评分+人数) + 更新按钮

const toast = require('../../../utils/dailyToast.js');
const { cnDateStr, decorateMovie } = require('../../../utils/movieFormat.js');

// 首页特色位：阿嬷的情书（doubanId 37116446）海报作为 hero 背景
const FEATURED_DOUBAN_ID = '37116446';

// 沉浸式：用胶囊按钮位置反推 nav 高度
function getNavMetrics() {
  const fallback = { statusBarHeight: 20, navBarHeight: 44, navOffset: 64 };
  try {
    const systemInfo = wx.getSystemInfoSync ? wx.getSystemInfoSync() : {};
    const statusBarHeight = systemInfo.statusBarHeight || fallback.statusBarHeight;
    let navBarHeight = fallback.navBarHeight;
    if (wx.getMenuButtonBoundingClientRect) {
      const menu = wx.getMenuButtonBoundingClientRect();
      if (menu && menu.top && menu.height) {
        navBarHeight = (menu.top - statusBarHeight) * 2 + menu.height;
      }
    }
    return {
      statusBarHeight,
      navBarHeight,
      navOffset: statusBarHeight + navBarHeight
    };
  } catch (e) {
    return fallback;
  }
}

// decorateMovie / formatVotes / formatRtCount / cnDateStr 都改从共享 utils 引

Page({
  data: {
    keyword: '',
    searching: false,           // 搜索框正在搜索候选
    candidates: [],
    searched: false,
    error: '',
    // 查询评分：候选卡和历史卡共用一个"正在查询"互斥锁
    queryingDoubanId: '',
    // 历史
    historyLoading: false,
    historyError: '',
    movies: [],
    todayCnStr: cnDateStr(Date.now()),
    toast: { show: false, text: '', icon: '' },
    // 指标说明 bottom sheet
    showMetricsExplain: false,
    // 左滑卡片展开的 doubanId（每次只有一张卡能展开操作）
    swipedDoubanId: '',
    // 沉浸式 nav 度量
    statusBarHeight: 20,
    navBarHeight: 44,
    navOffset: 64,
    // hero 特色电影（阿嬷的情书）
    featured: null,
    featuredLoading: true
  },

  onLoad() {
    const navMetrics = getNavMetrics();
    this.setData({
      statusBarHeight: navMetrics.statusBarHeight,
      navBarHeight: navMetrics.navBarHeight,
      navOffset: navMetrics.navOffset
    });
    this.loadFeatured();
    this.loadHistory();
  },

  onShow() {
    // 从 detail 页回来时刷新历史（可能在 detail 触发了一次刷新）
    this.setData({ todayCnStr: cnDateStr(Date.now()) });
    if (this.data.movies.length > 0) {
      this.loadHistory();
    }
  },

  async onPullDownRefresh() {
    await this.loadHistory();
    wx.stopPullDownRefresh();
  },

  // ===== 候选搜索 =====
  onKeywordInput(e) {
    this.setData({ keyword: e.detail.value });
  },

  onClearKeyword() {
    this.setData({ keyword: '', candidates: [], searched: false, error: '' });
  },

  async onSearch() {
    const keyword = (this.data.keyword || '').trim();
    if (!keyword) {
      toast.show(this, '请输入电影名');
      return;
    }
    if (this.data.searching) return;

    this.setData({ searching: true, error: '', candidates: [], searched: false });

    try {
      const res = await wx.cloud.callFunction({
        name: 'searchMovieByTitle',
        data: { keyword }
      });
      const result = res && res.result;
      if (!result || !result.success) {
        this.setData({
          searching: false,
          error: (result && result.error) || '搜索失败，请稍后重试',
          searched: true
        });
        return;
      }
      this.setData({
        searching: false,
        candidates: result.candidates || [],
        searched: true,
        error: ''
      });
    } catch (e) {
      console.error('searchMovieByTitle 异常', e);
      this.setData({
        searching: false,
        error: '网络异常，请稍后重试',
        searched: true
      });
    }
  },

  // ===== 首页特色电影（阿嬷的情书） =====
  // skipUserQuery=true → 后端不会把这次"系统调用"算进用户历史
  async loadFeatured() {
    try {
      const res = await wx.cloud.callFunction({
        name: 'fetchMovieFullInfo',
        data: { doubanId: FEATURED_DOUBAN_ID, skipUserQuery: true }
      });
      const result = res && res.result;
      if (result && result.success && result.movie) {
        this.setData({
          featured: decorateMovie(result.movie),
          featuredLoading: false
        });
      } else {
        this.setData({ featuredLoading: false });
      }
    } catch (e) {
      console.warn('loadFeatured 异常', e && e.message);
      this.setData({ featuredLoading: false });
    }
  },

  // ===== 历史加载 =====
  async loadHistory() {
    if (this.data.historyLoading) return;
    this.setData({ historyLoading: true, historyError: '' });
    try {
      const res = await wx.cloud.callFunction({
        name: 'getMyMovieQueries',
        data: {}
      });
      const result = res && res.result;
      if (!result || !result.success) {
        this.setData({
          historyLoading: false,
          historyError: (result && result.error) || '加载历史失败'
        });
        return;
      }
      // 首页 hero 加载阿嬷的情书时已带 skipUserQuery=true，不会写入历史；
      // 用户主动搜索的阿嬷的情书仍然正常显示（不再前端过滤）
      const movies = (result.movies || []).map(decorateMovie);
      this.setData({
        historyLoading: false,
        movies,
        todayCnStr: cnDateStr(Date.now())
      });
    } catch (e) {
      console.error('getMyMovieQueries 异常', e);
      this.setData({ historyLoading: false, historyError: '网络异常' });
    }
  },

  // ===== 查询评分（候选卡） =====
  onTapFetchScore(e) {
    const doubanId = e.currentTarget.dataset.doubanId;
    if (!doubanId) return;
    this._fetchScore(doubanId, false, { navigateOnSuccess: true });
  },

  // ===== 卡片左滑手势：touchstart / touchend 判断方向 =====
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

    // 主要为水平方向且位移 > 50px，才认作 swipe
    if (Math.abs(dx) > Math.abs(dy) * 1.5 && Math.abs(dx) > 50) {
      if (dx < 0) {
        // 左滑：展开操作（一次只展开一张）
        this.setData({ swipedDoubanId: doubanId });
      } else {
        // 右滑：收起当前展开的卡
        if (this.data.swipedDoubanId === doubanId) {
          this.setData({ swipedDoubanId: '' });
        }
      }
    }
    // 否则视为点击，由 bindtap 自然处理
  },

  // ===== 点历史卡片：若有展开的卡先收起，否则跳详情 =====
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

  // ===== 左滑后点"更新" =====
  onSwipeUpdate(e) {
    const doubanId = e.currentTarget.dataset.doubanId;
    const updatedAt = e.currentTarget.dataset.updatedAt;
    this.setData({ swipedDoubanId: '' });

    if (!doubanId) return;
    if (this.data.queryingDoubanId) {
      toast.show(this, '正在查询中，请稍后');
      return;
    }
    // 24h 客户端预判限流：与后端同步行为，减一次往返
    if (updatedAt && cnDateStr(updatedAt) === cnDateStr(Date.now())) {
      toast.show(this, '24 小时内评分变化有限，每天仅可更新一次', { duration: 2600 });
      return;
    }
    this._fetchScore(doubanId, true, { navigateOnSuccess: false });
  },

  // ===== 左滑后点"删除" =====
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
        // 本地即时移除（不必等 loadHistory 回来），体感更快
        const movies = this.data.movies.filter(m => String(m.doubanId) !== String(doubanId));
        this.setData({ movies });
        toast.show(this, '已删除', { icon: 'success' });
      } else {
        toast.show(this, '删除失败，请稍后重试');
      }
    } catch (e) {
      console.error('deleteMovieQuery 异常', e);
      toast.show(this, '网络异常，请稍后重试');
    }
  },

  // ===== 统一查询入口 =====
  async _fetchScore(doubanId, forceRefresh, { navigateOnSuccess }) {
    if (this.data.queryingDoubanId) {
      toast.show(this, '正在查询中，请稍后');
      return;
    }
    this.setData({ queryingDoubanId: doubanId });
    wx.showLoading({ title: '抓取多平台数据中…', mask: true });

    try {
      const res = await wx.cloud.callFunction({
        name: 'fetchMovieFullInfo',
        data: { doubanId, forceRefresh: !!forceRefresh }
      });
      const result = res && res.result;
      wx.hideLoading();
      this.setData({ queryingDoubanId: '' });

      if (!result || !result.success) {
        toast.show(this, '查询失败，请稍后重试');
        return;
      }

      // 服务端当日限流（forceRefresh=true 时返 refreshLimited=true）
      if (forceRefresh && result.refreshLimited) {
        toast.show(this, '24 小时内评分变化有限，每天仅可更新一次', { duration: 2600 });
        this.loadHistory();
        return;
      }

      if (navigateOnSuccess) {
        // 跳转成功后立即清空搜索状态（用户返回时回到初始态：搜索框空、候选列表清）
        wx.navigateTo({
          url: `/pages/movie-search/detail/detail?doubanId=${doubanId}`,
          success: () => {
            this.setData({
              keyword: '',
              candidates: [],
              searched: false,
              error: ''
            });
          }
        });
      } else {
        this.loadHistory();
        toast.show(this, '已更新', { icon: 'success' });
      }
    } catch (e) {
      console.error('fetchMovieFullInfo 异常', e);
      wx.hideLoading();
      this.setData({ queryingDoubanId: '' });
      toast.show(this, '网络异常，请稍后重试');
    }
  },

  onGoToList() {
    wx.navigateTo({ url: '/pages/movie-search/list/list' });
  },

  // ===== 指标说明 bottom sheet =====
  onShowMetricsExplain() {
    this.setData({ showMetricsExplain: true });
  },
  onHideMetricsExplain() {
    this.setData({ showMetricsExplain: false });
  },

  // 点击 hero 跳阿嬷的情书详情
  onTapFeatured() {
    if (!this.data.featured) return;
    wx.navigateTo({
      url: `/pages/movie-search/detail/detail?doubanId=${FEATURED_DOUBAN_ID}`
    });
  }
});
