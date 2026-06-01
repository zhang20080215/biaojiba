const toast = require('../../../utils/dailyToast.js');
const imageCache = require('../../../utils/imageCacheManager.js');
const { decorateMovie } = require('../../../utils/movieFormat.js');
const { getNavMetrics, todayStr } = require('./common.js');

const MOOD_OPTIONS = [
  { key: 'love', emoji: '😍', label: '超爱' },
  { key: 'happy', emoji: '😂', label: '欢乐' },
  { key: 'touched', emoji: '😢', label: '泪目' },
  { key: 'shocked', emoji: '😱', label: '震撼' },
  { key: 'healing', emoji: '🥰', label: '治愈' },
  { key: 'thinking', emoji: '🤔', label: '深思' },
  { key: 'bored', emoji: '😴', label: '无聊' },
  { key: 'letdown', emoji: '😞', label: '失望' }
];

function formatDateText(d) {
  const p = String(d || '').split('-').map(Number);
  if (p.length < 3 || p.some(isNaN)) return d || '';
  return `${p[0]}年${p[1]}月${p[2]}日`;
}

function buildMeta(year, director) {
  const parts = [];
  if (year) parts.push(String(year));
  if (director) parts.push('导演 ' + director);
  return parts.join('  ·  ');
}

// 4 平台固定展示：豆瓣 / IMDb / 新鲜度(RT 影评人) / 爆米花(RT 观众)，缺数据补 '—'
function buildRatingCells(mv) {
  const douban = mv.douban || {};
  const imdb = mv.imdb || {};
  return [
    { label: '豆瓣', value: douban.rating ? String(douban.rating) : '—', sub: mv.doubanVotesLabel || '' },
    { label: 'IMDb', value: imdb.rating ? String(imdb.rating) : '—', sub: mv.imdbVotesLabel || '' },
    { label: '新鲜度', value: mv.hasRtCritic ? mv.rtCriticText : '—', sub: '影评人' },
    { label: '爆米花', value: mv.hasRtAudience ? mv.rtAudienceText : '—', sub: '观众' }
  ];
}

Page({
  data: {
    toast: { show: false, text: '', icon: '' },
    statusBarHeight: 20,
    navBarHeight: 48,
    navOffset: 68,

    keyword: '',
    searching: false,
    searched: false,
    error: '',
    candidates: [],
    selected: null,

    // 选中后展示
    posterSrc: '',
    movieMeta: '',
    ratingsLoading: false,
    ratingsError: '',
    ratingCells: [],
    movieFull: null,

    date: '',
    dateText: '',
    rating: 0,
    ratingLabel: '未评分',
    moods: MOOD_OPTIONS,
    mood: '',
    note: '',
    noteCount: 0,
    submitting: false
  },

  onLoad(options) {
    const nav = getNavMetrics();
    const date = (options && options.date) || todayStr();
    this.setData({
      statusBarHeight: nav.statusBarHeight,
      navBarHeight: nav.navBarHeight,
      navOffset: nav.navOffset,
      date,
      dateText: formatDateText(date)
    });
    wx.setNavigationBarColor({ frontColor: '#000000', backgroundColor: '#FAF6EB' });
    wx.setNavigationBarTitle({ title: '添加电影' });
  },

  onBack() {
    if (getCurrentPages().length > 1) wx.navigateBack();
    else wx.redirectTo({ url: '/pages/daily/movie/index' });
  },

  onKeywordInput(e) {
    this.setData({ keyword: e.detail.value });
  },

  _resetSelection() {
    this.setData({
      selected: null,
      posterSrc: '',
      movieMeta: '',
      ratingsLoading: false,
      ratingsError: '',
      ratingCells: [],
      movieFull: null
    });
  },

  onClearKeyword() {
    this.setData({ keyword: '', candidates: [], searched: false, error: '' });
    this._resetSelection();
  },

  async onSearch() {
    const keyword = (this.data.keyword || '').trim();
    if (!keyword) {
      toast.show(this, '请输入电影名');
      return;
    }
    if (this.data.searching) return;
    this.setData({ searching: true, searched: false, error: '', candidates: [] });
    this._resetSelection();
    try {
      const res = await wx.cloud.callFunction({
        name: 'searchMovieByTitle',
        data: { keyword }
      });
      const result = res && res.result;
      if (!result || !result.success) {
        this.setData({
          searching: false,
          searched: true,
          error: (result && result.error) || '搜索失败，请稍后重试'
        });
        return;
      }
      const candidates = (result.candidates || []).map(item => ({
        ...item,
        posterThumb: imageCache.getThumbnailUrl(item.posterUrl, 'list')
      }));
      this.setData({ searching: false, searched: true, candidates, error: '' });
    } catch (e) {
      console.error('daily movie search fail', e);
      this.setData({ searching: false, searched: true, error: '网络异常，请稍后重试' });
    }
  },

  onSelectMovie(e) {
    const doubanId = e.currentTarget.dataset.doubanId;
    const selected = this.data.candidates.find(item => String(item.doubanId) === String(doubanId));
    if (!selected) return;
    this.setData({
      selected,
      posterSrc: selected.posterThumb || '/images/default-movie.jpg',
      movieMeta: buildMeta(selected.year, selected.director),
      ratingsLoading: true,
      ratingsError: '',
      ratingCells: [],
      movieFull: null
    });
    this._fetchFullRatings(selected.doubanId);
  },

  // 拉取全平台评分（豆瓣/IMDb/新鲜度/爆米花），首次约 10s，命中缓存秒回
  async _fetchFullRatings(doubanId) {
    try {
      const res = await wx.cloud.callFunction({
        name: 'fetchMovieFullInfo',
        data: { doubanId, skipUserQuery: true }
      });
      // 用户可能已重新选择/清空，丢弃过期结果
      if (!this.data.selected || String(this.data.selected.doubanId) !== String(doubanId)) return;

      const result = res && res.result;
      if (!result || !result.success || !result.movie) {
        this.setData({ ratingsLoading: false, ratingsError: '评分获取失败，可直接记录' });
        return;
      }
      const mv = decorateMovie(result.movie);
      this.setData({
        ratingsLoading: false,
        ratingsError: '',
        ratingCells: buildRatingCells(mv),
        movieFull: mv,
        posterSrc: mv.poster || this.data.posterSrc,
        movieMeta: buildMeta(mv.year || this.data.selected.year, mv.directorText || this.data.selected.director)
      });
    } catch (e) {
      console.error('daily movie full info fail', e);
      if (!this.data.selected || String(this.data.selected.doubanId) !== String(doubanId)) return;
      this.setData({ ratingsLoading: false, ratingsError: '评分获取失败，可直接记录' });
    }
  },

  // 重新选择：退回候选列表，保留已有搜索结果
  onReselect() {
    this._resetSelection();
  },

  onDateChange(e) {
    const date = e.detail.value;
    this.setData({ date, dateText: formatDateText(date) });
  },

  // 拖拽进度条评分（0~5，步进 0.5）
  _applyRating(v) {
    const n = Math.round((Number(v) || 0) * 2) / 2;
    this.setData({ rating: n, ratingLabel: n > 0 ? `${n.toFixed(1)} 星` : '未评分' });
  },
  onRatingChanging(e) {
    this._applyRating(e.detail.value);
  },
  onRatingChange(e) {
    this._applyRating(e.detail.value);
  },

  onMoodTap(e) {
    const key = e.currentTarget.dataset.key;
    // 再次点击当前心情可取消
    this.setData({ mood: this.data.mood === key ? '' : key });
  },

  onNoteInput(e) {
    const note = e.detail.value || '';
    this.setData({ note, noteCount: note.length });
  },

  onSubmit() {
    if (this.data.submitting) return;
    const selected = this.data.selected;
    if (!selected) {
      toast.show(this, '请先选择电影');
      return;
    }
    const full = this.data.movieFull || {};
    const moodOpt = MOOD_OPTIONS.find(m => m.key === this.data.mood);
    const meta = {
      doubanId: selected.doubanId,
      title: selected.title || '',
      year: full.year || selected.year || '',
      poster: full.originalPoster || full.poster || selected.posterUrl || '',
      director: full.directorText || selected.director || '',
      rating: Number(this.data.rating) || 0,
      mood: this.data.mood || '',
      moodEmoji: moodOpt ? moodOpt.emoji : '',
      moodLabel: moodOpt ? moodOpt.label : '',
      // 全平台评分快照，供片单列表展示
      platform: {
        douban: full.douban && full.douban.rating ? String(full.douban.rating) : '',
        imdb: full.imdb && full.imdb.rating ? String(full.imdb.rating) : '',
        rtCritic: full.hasRtCritic ? full.rtCriticText : '',
        rtAudience: full.hasRtAudience ? full.rtAudienceText : ''
      },
      note: (this.data.note || '').trim()
    };
    this.setData({ submitting: true });
    wx.cloud.callFunction({
      name: 'syncDailyLog',
      data: { action: 'addEntry', theme: 'movie', date: this.data.date, value: 1, meta },
      success: res => {
        const result = res && res.result;
        if (!result || !result.success) {
          toast.show(this, '记录失败');
          return;
        }
        toast.show(this, '已记录', { icon: 'success' });
        setTimeout(() => {
          wx.navigateBack();
        }, 450);
      },
      fail: err => {
        console.error('daily movie add fail', err);
        toast.show(this, '网络异常');
      },
      complete: () => {
        this.setData({ submitting: false });
      }
    });
  }
});
