const toast = require('../../../utils/dailyToast.js');
const imageCache = require('../../../utils/imageCacheManager.js');
const { addThousandSep } = require('../../../utils/bookFormat.js');
const { getNavMetrics, todayStr } = require('./common.js');

const MOOD_OPTIONS = [
  { key: 'love', emoji: '😍', label: '超爱' },
  { key: 'happy', emoji: '😂', label: '欢乐' },
  { key: 'touched', emoji: '😢', label: '泪目' },
  { key: 'shocked', emoji: '😱', label: '震撼' },
  { key: 'healing', emoji: '🥰', label: '治愈' },
  { key: 'thinking', emoji: '🤔', label: '深思' },
  { key: 'bored', emoji: '😴', label: '催眠' },
  { key: 'letdown', emoji: '😞', label: '失望' },
  { key: 'inspired', emoji: '💡', label: '启发' },
  { key: 'immersed', emoji: '📖', label: '沉浸' },
  { key: 'romantic', emoji: '💞', label: '心动' },
  { key: 'nostalgic', emoji: '🕰️', label: '怀旧' },
  { key: 'hooked', emoji: '😮', label: '上头' },
  { key: 'heavy', emoji: '🥀', label: '致郁' }
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

// 拖拽评分：星条内落点 → 评分（间距感知，对齐视觉星，精确 0.5）。星条 5×56 + 4×16 = 344rpx，每星+间距 72rpx。
function starValueFromX(clientX, rect) {
  let frac = (clientX - rect.left) / rect.width;
  if (frac < 0) frac = 0;
  if (frac > 1) frac = 1;
  const xRpx = frac * 344;
  let i = Math.floor(xRpx / 72);
  if (i > 4) i = 4;
  const within = xRpx - i * 72;
  const v = i + (within < 28 ? 0.5 : 1);
  return v < 0.5 ? 0.5 : (v > 5 ? 5 : v);
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

// 候选视图模型：搜索时已富化（评分/人数/作者/出版社/年份），这里只补展示字段
function decorateCandidate(item) {
  return {
    ...item,
    posterThumb: imageCache.getThumbnailUrl(item.posterUrl, 'list'),
    ratingText: item.rating ? Number(item.rating).toFixed(1) : '',
    votesText: item.ratingCount ? `${addThousandSep(item.ratingCount)}人评价` : '',
    // 出版社 · 年份 合并一行；缺出版社时只显示年份
    pubText: [item.publisher, item.year].filter(Boolean).join(' · ')
  };
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

    date: '',
    dateText: '',
    totalPages: 0,        // 0 = 未知（详情没给页数）
    currentPage: '',      // 输入框原文，空串 = 未填
    progressText: '',     // 「当前页/总页数」都有时才显示的百分比
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
    wx.setNavigationBarTitle({ title: '添加图书' });
  },

  onBack() {
    if (getCurrentPages().length > 1) wx.navigateBack();
    else wx.redirectTo({ url: '/pages/daily/read/index' });
  },

  onKeywordInput(e) {
    this.setData({ keyword: e.detail.value });
  },

  onClearKeyword() {
    this.setData({ keyword: '', candidates: [], searched: false, error: '', selected: null });
  },

  async onSearch() {
    const keyword = (this.data.keyword || '').trim();
    if (!keyword) {
      toast.show(this, '请输入书名');
      return;
    }
    if (this.data.searching) return;
    this.setData({ searching: true, searched: false, error: '', candidates: [], selected: null });
    try {
      const res = await wx.cloud.callFunction({
        name: 'searchBookByTitle',
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
      console.error('daily read search fail', e);
      this.setData({ searching: false, searched: true, error: '网络异常，请稍后重试' });
    }
  },

  // 选中：先用搜索结果即时渲染，再拉一次详情补齐出版社/总页数（搜索结果页 HTML 没有页数）。
  // 只在选中时查一次，不对每个候选查——否则一次搜索就是 N 次回源。
  onSelectMovie(e) {
    const doubanId = e.currentTarget.dataset.doubanId;
    const selected = this.data.candidates.find(item => String(item.doubanId) === String(doubanId));
    if (!selected) return;
    this.setData({
      selected: Object.assign({}, selected, {
        publisherText: selected.publisher || '',
        pagesText: '加载中…'
      }),
      totalPages: 0,
      currentPage: '',
      progressText: ''
    });
    this._fetchBookDetail(doubanId);
  },

  // 详情补齐。用 seq 作令牌：加载途中用户改选/退回时，丢弃过期响应。
  _fetchBookDetail(doubanId) {
    const seq = (this._detailSeq || 0) + 1;
    this._detailSeq = seq;
    wx.cloud.callFunction({
      name: 'fetchBookFullInfo',
      // skipUserQuery：这里只借用它的详情能力，不该污染「电影/图书评分查询」的个人历史
      data: { doubanId, skipUserQuery: true },
      success: res => {
        if (seq !== this._detailSeq || !this.data.selected) return;
        const result = res && res.result;
        const book = result && result.success && result.book;
        if (!book) { this._applyDetailFallback(); return; }
        const totalPages = Number(book.pages) || 0;
        const patch = {
          totalPages,
          'selected.publisherText': book.publisher || this.data.selected.publisher || '',
          'selected.pagesText': totalPages ? `${totalPages} 页` : '未知'
        };
        // 云存储封面（fetchBookFullInfo 已转存）：微信可缓存、不 418，比豆瓣直链稳。
        // 只认 cloud:// 地址，落库时优先用它（豆瓣直链仅兜底）。
        if (typeof book.cover === 'string' && book.cover.indexOf('cloud://') === 0) {
          patch['selected.cloudCover'] = book.cover;
        }
        this.setData(patch);
        this._syncProgress();
      },
      fail: err => {
        if (seq !== this._detailSeq || !this.data.selected) return;
        console.error('daily read detail fail', err);
        this._applyDetailFallback();
      }
    });
  },

  // 详情拿不到：出版社退回搜索结果的值，总页数标未知（此时进度只记当前页，无分母）
  _applyDetailFallback() {
    this.setData({
      totalPages: 0,
      'selected.publisherText': (this.data.selected && this.data.selected.publisher) || '',
      'selected.pagesText': '未知'
    });
    this._syncProgress();
  },

  // 重新选择：退回候选列表，保留已有搜索结果
  onReselect() {
    this._detailSeq = (this._detailSeq || 0) + 1;   // 作废在途的详情请求
    this.setData({ selected: null, totalPages: 0, currentPage: '', progressText: '' });
  },

  // 豆瓣封面有防盗链（小程序直连返回 418），加载失败退回占位图
  onCandCoverError(e) {
    const i = e.currentTarget.dataset.index;
    if (i === undefined || i === null) return;
    this.setData({ [`candidates[${i}].posterThumb`]: '/images/default-movie.jpg' });
  },
  onSelCoverError() {
    this.setData({ 'selected.posterThumb': '/images/default-movie.jpg' });
  },

  onDateChange(e) {
    const date = e.detail.value;
    this.setData({ date, dateText: formatDateText(date) });
  },

  // 五角星评分：半星点按——每颗星左半热区=X.5、右半=X.0（data-value 已算好），一点即准
  onStarTap(e) {
    let v = Number(e.currentTarget.dataset.value) || 0.5;
    if (v < 0.5) v = 0.5;
    if (v > 5) v = 5;
    if (v === this.data.rating) return;
    this.setData({ rating: v, ratingLabel: `${v.toFixed(1)} 星`, stars: buildStars(v) });
  },

  // 拖拽评分：touchstart 只测量星条位置，touchmove 按落点实时改分（点按仍走 onStarTap，互不冲突）
  onStarTouchStart() {
    wx.createSelectorQuery().in(this).select('.star-row').boundingClientRect(rect => {
      if (rect && rect.width) this._starRect = rect;
    }).exec();
  },
  onStarTouchMove(e) {
    const rect = this._starRect;
    if (!rect || !rect.width) return;
    const t = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]);
    if (!t) return;
    const v = starValueFromX(t.clientX, rect);
    if (v === this.data.rating) return;
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

  // 当前页数：只留数字；已知总页数时上限即总页数（输超了直接夹到总页数）
  onCurrentPageInput(e) {
    const digits = String(e.detail.value || '').replace(/\D/g, '').replace(/^0+(?=\d)/, '');
    let currentPage = digits;
    const total = Number(this.data.totalPages) || 0;
    if (total && digits && Number(digits) > total) currentPage = String(total);
    this.setData({ currentPage });
    this._syncProgress();
    return currentPage;   // 返回值回写 input，越界时输入框即时纠正
  },

  // 进度读数：仅在「当前页 + 总页数」都有时给百分比
  _syncProgress() {
    const total = Number(this.data.totalPages) || 0;
    const cur = Number(this.data.currentPage) || 0;
    if (!total || !cur) {
      if (this.data.progressText) this.setData({ progressText: '' });
      return;
    }
    const pct = Math.min(100, Math.round(cur / total * 100));
    this.setData({ progressText: `${pct}%` });
  },

  onNoteInput(e) {
    const note = e.detail.value || '';
    this.setData({ note, noteCount: note.length });
  },

  onSubmit() {
    if (this.data.submitting) return;
    const selected = this.data.selected;
    if (!selected) {
      toast.show(this, '请先选择书籍');
      return;
    }
    const moodOpt = MOOD_OPTIONS.find(m => m.key === this.data.mood);
    const totalPages = Number(this.data.totalPages) || 0;
    const currentPage = Number(this.data.currentPage) || 0;
    const meta = {
      doubanId: selected.doubanId,
      title: selected.title || '',
      year: selected.year || '',
      // 封面优先用云存储地址（稳、可缓存、不 418）；详情未回或转存失败时兜底豆瓣直链
      cover: selected.cloudCover || selected.posterUrl || selected.posterThumb || '',
      author: selected.author || '',
      // 出版社优先用详情返回的（搜索页解析出的那个可能串位）
      publisher: selected.publisherText || selected.publisher || '',
      pubDate: selected.year || '',
      totalPages,      // 0 = 未知
      currentPage,     // 0 = 未填
      rating: Number(this.data.rating) || 0,
      mood: this.data.mood || '',
      moodEmoji: moodOpt ? moodOpt.emoji : '',
      moodLabel: moodOpt ? moodOpt.label : '',
      // 评分快照（书只有豆瓣），供书单列表展示
      platform: {
        douban: selected.rating ? String(selected.rating) : ''
      },
      note: (this.data.note || '').trim()
    };
    this.setData({ submitting: true });
    wx.cloud.callFunction({
      name: 'syncDailyLog',
      data: { action: 'addEntry', theme: 'read', date: this.data.date, value: 1, meta },
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
        console.error('daily read add fail', err);
        toast.show(this, '网络异常');
      },
      complete: () => {
        this.setData({ submitting: false });
      }
    });
  }
});
