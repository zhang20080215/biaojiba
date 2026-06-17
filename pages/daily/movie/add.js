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
  { key: 'letdown', emoji: '😞', label: '失望' },
  { key: 'thrilled', emoji: '🔥', label: '热血' },
  { key: 'scared', emoji: '😨', label: '惊悚' },
  { key: 'romantic', emoji: '💞', label: '心动' },
  { key: 'nostalgic', emoji: '🕰️', label: '怀旧' },
  { key: 'cool', emoji: '😎', label: '过瘾' },
  { key: 'confused', emoji: '🤯', label: '烧脑' }
];
// 网格只展示前若干个，最后一格为「更多」，其余进弹窗
const VISIBLE_MOOD_COUNT = 7;

// rating(0~5, 步进0.5) → 5 颗星状态数组：'full' | 'half' | 'empty'
function buildStars(rating) {
  const r = Number(rating) || 0;
  const arr = [];
  for (let i = 1; i <= 5; i++) {
    if (r >= i) arr.push('full');
    else if (r >= i - 0.5) arr.push('half');
    else arr.push('empty');
  }
  return arr;
}

// 可见心情：始终包含当前选中项（选中项在隐藏区时顶到末位，避免选了却看不到）
function computeVisibleMoods(all, selectedKey) {
  if (!selectedKey) return all.slice(0, VISIBLE_MOOD_COUNT);
  const idx = all.findIndex(m => m.key === selectedKey);
  if (idx < 0 || idx < VISIBLE_MOOD_COUNT) return all.slice(0, VISIBLE_MOOD_COUNT);
  return all.slice(0, VISIBLE_MOOD_COUNT - 1).concat([all[idx]]);
}

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

// 千位分隔符：699743 → "699,743"
function addThousandSep(n) {
  if (n === null || n === undefined || n === '') return '';
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// 候选视图模型：搜索页已带豆瓣评分/人数时直接展示，无则留空
function decorateCandidate(item) {
  return {
    ...item,
    posterThumb: imageCache.getThumbnailUrl(item.posterUrl, 'list'),
    ratingText: item.rating ? Number(item.rating).toFixed(1) : '',
    votesText: item.ratingCount ? `${addThousandSep(item.ratingCount)}人评价` : ''
  };
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
    stars: buildStars(0),
    moods: MOOD_OPTIONS,
    visibleMoods: computeVisibleMoods(MOOD_OPTIONS, ''),
    moodModal: false,
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
      const candidates = (result.candidates || []).map(decorateCandidate);
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

  // 五角星评分：支持点按 + 拖拽，按手指横向落点算分（0.5 步进，最少半颗）
  onStarTouchStart(e) {
    this._measureStarRow().then(() => this._applyStarTouch(e));
  },
  onStarTouchMove(e) {
    this._applyStarTouch(e);
  },
  _measureStarRow() {
    return new Promise(resolve => {
      wx.createSelectorQuery().in(this).select('.star-row').boundingClientRect(rect => {
        if (rect && rect.width) this._starRect = rect;
        resolve();
      }).exec();
    });
  },
  _applyStarTouch(e) {
    const rect = this._starRect;
    if (!rect || !rect.width) return;
    const t = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]);
    if (!t) return;
    let ratio = (t.clientX - rect.left) / rect.width;
    if (ratio < 0) ratio = 0;
    if (ratio > 1) ratio = 1;
    let v = Math.ceil(ratio * 10) / 2; // 10 个半颗档位
    if (v < 0.5) v = 0.5;
    if (v > 5) v = 5;
    if (v === this.data.rating) return; // 拖拽中避免重复 setData
    this.setData({ rating: v, ratingLabel: `${v.toFixed(1)} 星`, stars: buildStars(v) });
  },

  onMoodTap(e) {
    const key = e.currentTarget.dataset.key;
    // 再次点击当前心情可取消
    const mood = this.data.mood === key ? '' : key;
    this.setData({ mood, visibleMoods: computeVisibleMoods(MOOD_OPTIONS, mood) });
  },

  onOpenMoodModal() {
    this.setData({ moodModal: true });
  },
  onCloseMoodModal() {
    this.setData({ moodModal: false });
  },
  onPickMood(e) {
    const key = e.currentTarget.dataset.key;
    const mood = this.data.mood === key ? '' : key;
    this.setData({ mood, moodModal: false, visibleMoods: computeVisibleMoods(MOOD_OPTIONS, mood) });
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
      poster: full.poster || full.originalPoster || selected.posterUrl || '',
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
