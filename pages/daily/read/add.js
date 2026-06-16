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
  { key: 'letdown', emoji: '😞', label: '失望' }
];

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
