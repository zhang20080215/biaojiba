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

  // 选中：直接用搜索时已富化的候选，不再二次查询豆瓣
  onSelectMovie(e) {
    const doubanId = e.currentTarget.dataset.doubanId;
    const selected = this.data.candidates.find(item => String(item.doubanId) === String(doubanId));
    if (!selected) return;
    this.setData({ selected });
  },

  // 重新选择：退回候选列表，保留已有搜索结果
  onReselect() {
    this.setData({ selected: null });
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
      toast.show(this, '请先选择书籍');
      return;
    }
    const moodOpt = MOOD_OPTIONS.find(m => m.key === this.data.mood);
    const meta = {
      doubanId: selected.doubanId,
      title: selected.title || '',
      year: selected.year || '',
      cover: selected.posterUrl || selected.posterThumb || '',
      author: selected.author || '',
      publisher: selected.publisher || '',
      pubDate: selected.year || '',
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
