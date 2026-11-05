const markTimeline = require('../../../utils/markTimeline');
const toast = require('../../../utils/dailyToast.js');
const imageCache = require('../../../utils/imageCacheManager.js');
const { addThousandSep } = require('../../../utils/bookFormat.js');
const { getNavMetrics, todayStr, suggestReadDays, isWaitingUpdate } = require('./common.js');
const { trackDaily } = require('../../../utils/track.js');

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

// 搜索来源：豆瓣读书 / 晋江文学城。晋江书的 doubanId 存成 'jj_<novelid>'（见 jjwxcBook 云函数），
// 进度单位是「章」、没有评分，热度显示收藏数。
const SOURCE_KEY = 'readSearchSource';
const SOURCES = {
  douban: { placeholder: '输入书名', unit: '页' },
  jjwxc: { placeholder: '输入晋江书名', unit: '章' }
};

function isJjwxc(item) {
  return !!item && (item.source === 'jjwxc' || String(item.doubanId || '').indexOf('jj_') === 0);
}

// 12345678 → 1235万；1200 → 1200（晋江收藏数 / 字数的展示口径）
function formatCount(n) {
  const v = Number(n) || 0;
  if (v < 10000) return v > 0 ? String(v) : '';
  const w = v / 10000;
  return (w >= 100 ? String(Math.round(w)) : String(Math.round(w * 10) / 10)) + '万';
}

function countText(n, unit) {
  return n ? `${n} ${unit || '页'}` : '未知';
}

// 候选视图模型：搜索时已富化（评分/人数/作者/出版社/年份），这里只补展示字段
function decorateCandidate(item) {
  if (isJjwxc(item)) {
    // 晋江：搜索页只有 书名/作者/进度；收藏数、字数、章节数选中后由详情补齐。类型标签只入库不展示。
    return {
      ...item,
      source: 'jjwxc',
      unit: '章',
      posterThumb: '',
      scoreLabel: '',
      ratingText: '',
      votesText: '',
      pubText: item.serialText || ''
    };
  }
  return {
    ...item,
    scoreLabel: '豆瓣',
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

    source: 'douban',     // 搜索来源：douban | jjwxc
    placeholder: SOURCES.douban.placeholder,
    keyword: '',
    searching: false,
    searched: false,
    error: '',
    candidates: [],
    // 继续阅读：未读完的书（已知总页数且已读 < 总页数），点击带入表单预填上次页数
    continueList: [],
    selected: null,

    date: '',
    dateText: '',
    totalPages: 0,        // 0 = 未知（详情没给页数）
    currentPage: '',      // 输入框原文，空串 = 未填
    progressText: '',     // 「当前页/总页数」都有时才显示的百分比
    readDays: '',         // 已读天数，选中书后按历史自动给，用户可改
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
    try {
      const saved = wx.getStorageSync(SOURCE_KEY);
      if (SOURCES[saved] && saved !== this.data.source) {
        this.setData({ source: saved, placeholder: SOURCES[saved].placeholder });
      }
    } catch (e) { /* 读不到就用默认豆瓣 */ }
    this._loadContinueReading();
  },

  // 豆瓣 / 晋江 切换：旧来源的候选和已选都作废；框里有关键词就直接按新来源重搜
  onSwitchSource(e) {
    const source = e.currentTarget.dataset.source;
    if (!SOURCES[source] || source === this.data.source) return;    this._detailSeq = (this._detailSeq || 0) + 1;   // 作废在途的详情请求
    this._searchSeq = (this._searchSeq || 0) + 1;   // 作废在飞的搜索
    this._readDaysTouched = false;
    try { wx.setStorageSync(SOURCE_KEY, source); } catch (err) { /* 记不住不影响使用 */ }
    this.setData({
      source,
      placeholder: SOURCES[source].placeholder,
      searching: false,
      candidates: [],
      searched: false,
      error: '',
      selected: null,
      totalPages: 0,
      currentPage: '',
      progressText: '',
      readDays: ''
    }, () => {
      if ((this.data.keyword || '').trim()) this.onSearch();
    });
  },

  // 拉取该用户所有读书记录，派生「未读完的书」列表（静默失败，不影响添加）。
  // 全量记录同时留给 _applySuggestedReadDays 算「这本书已读几天」——两处共用这一次请求
  _loadContinueReading() {
    wx.cloud.callFunction({
      name: 'syncDailyLog',
      data: { action: 'getAll', theme: 'read' },
      success: res => {
        const days = (res && res.result && res.result.days) || [];
        this._allDays = days;
        this.setData({ continueList: this._deriveContinue(days) });
        // 用户可能在历史回来之前就选好了书，这里补算一次
        this._applySuggestedReadDays();
      },
      // 拉不到历史就按「第 1 天」给，别让这一格空着
      fail: () => {
        this._allDays = this._allDays || [];
        this._applySuggestedReadDays();
      }
    });
  },

  // 已读天数建议值：同一天重复记不加天数，换一天才 +1（详见 common.js suggestReadDays）。
  // 历史还没回来时先不填，等 getAll 成功再补；用户手改过就不再覆盖
  _applySuggestedReadDays() {
    if (this._readDaysTouched) return;
    const selected = this.data.selected;
    if (!selected || !this._allDays) return;
    const n = suggestReadDays(this._allDays, selected.doubanId, this.data.date);
    this.setData({ readDays: String(n) });
  },

  // 按 doubanId 归并全部记录：仅已知总页数的书，取最大已读页；未读完(1 <= 已读 < 总页数)才进列表，
  // 最近读的在前，展示用最新一条 meta。例外：连载中的晋江书读到最新章也留着（isWaitingUpdate），标「等更新」
  _deriveContinue(days) {
    const now = Date.now();
    const byId = {};
    (days || []).forEach(d => {
      (d.entries || []).forEach(en => {
        const m = en.meta || {};
        const id = m.doubanId;
        const total = Number(m.totalPages) || 0;
        if (!id || total <= 0) return;
        const cur = Number(m.currentPage) || 0;
        const rec = byId[id] || { maxPage: 0, total: 0, latestTs: 0, meta: m };
        if (cur > rec.maxPage) rec.maxPage = cur;
        if (total > rec.total) rec.total = total;
        if ((en.ts || 0) >= rec.latestTs) { rec.latestTs = en.ts || 0; rec.meta = m; }
        byId[id] = rec;
      });
    });
    return Object.keys(byId)
      .map(id => byId[id])
      .map(r => ({ ...r, waiting: isWaitingUpdate(r.meta, r.maxPage, r.total, r.latestTs, now) }))
      .filter(r => (r.maxPage >= 1 && r.maxPage < r.total) || r.waiting)
      .sort((a, b) => b.latestTs - a.latestTs)
      .map(r => {
        const m = r.meta;
        const cover = m.cover || m.poster || m.posterUrl || '';
        return {
          doubanId: m.doubanId,
          title: m.title || '未命名书籍',
          year: m.year || '',
          author: m.author || '',
          publisher: m.publisher || '',
          doubanRating: (m.platform && m.platform.douban) || '',
          source: isJjwxc(m) ? 'jjwxc' : 'douban',
          unit: m.progressUnit || '页',
          wordCount: Number(m.wordCount) || 0,
          finished: !!m.finished,
          novelType: m.novelType || '',
          cover,
          posterThumb: imageCache.getThumbnailUrl(cover, 'list'),
          lastPage: r.maxPage,
          totalPages: r.total,
          waiting: r.waiting
        };
      });
  },

  // 点击「继续阅读」：把该书带入添加表单（跳过搜索），预填上次读到的页数
  onContinueRead(e) {
    const doubanId = e.currentTarget.dataset.doubanId;
    const item = this.data.continueList.find(x => String(x.doubanId) === String(doubanId));
    if (!item) return;
    const isCloud = p => typeof p === 'string' && p.indexOf('cloud://') === 0;
    const score = item.doubanRating ? Number(item.doubanRating) : 0;
    const jj = item.source === 'jjwxc';
    const selected = {
      doubanId: item.doubanId,
      source: item.source,
      unit: item.unit,
      isJj: jj,
      wordCount: item.wordCount,
      wordText: jj && item.wordCount ? `${formatCount(item.wordCount)}字` : '',
      finished: item.finished,
      serialText: jj ? (item.finished ? '完结' : '连载') : '',
      novelType: item.novelType,
      title: item.title,
      year: item.year,
      author: item.author,
      publisher: item.publisher,
      publisherText: item.publisher || '',
      pagesText: countText(item.totalPages, item.unit),
      scoreLabel: '豆瓣',
      posterUrl: item.cover,
      posterThumb: item.posterThumb,
      cloudCover: isCloud(item.cover) ? item.cover : '',
      rating: item.doubanRating || '',
      ratingText: score ? score.toFixed(1) : '',
      votesText: ''
    };
    this.setData({
      candidates: [],
      searched: false,
      error: '',
      selected,
      totalPages: item.totalPages,
      currentPage: String(item.lastPage || ''),
      progressText: '',
      readDays: ''
    });
    this._readDaysTouched = false;
    this._applySuggestedReadDays();
    this._syncProgress();
    this._fetchBookDetail(item.doubanId);
  },

  onBack() {
    if (getCurrentPages().length > 1) wx.navigateBack();
    else wx.redirectTo({ url: '/pages/daily/read/index' });
  },

  onKeywordInput(e) {
    this.setData({ keyword: e.detail.value });
  },

  onClearKeyword() {
    this._searchSeq = (this._searchSeq || 0) + 1;   // 作废在飞的搜索
    this.setData({ keyword: '', searching: false, candidates: [], searched: false, error: '', selected: null });
  },

  async onSearch() {
    const keyword = (this.data.keyword || '').trim();
    if (!keyword) {
      toast.show(this, '请输入书名');
      return;
    }
    const source = this.data.source;
    const key = `${source}|${keyword}`;
    if (this.data.searching && this._searchKey === key) return;   // 同一搜索在飞，忽略连点
    // 令牌：切来源 / 清空 / 再搜时，在飞的旧请求回来后丢弃，不覆盖当前界面
    const seq = (this._searchSeq || 0) + 1;
    this._searchSeq = seq;
    this._searchKey = key;
    this.setData({ searching: true, searched: false, error: '', candidates: [], selected: null });
    try {
      const res = await wx.cloud.callFunction(source === 'jjwxc'
        ? { name: 'jjwxcBook', data: { action: 'search', keyword } }
        : { name: 'searchBookByTitle', data: { keyword } });
      if (seq !== this._searchSeq) return;
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
      if (seq !== this._searchSeq) return;
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
    const jj = isJjwxc(selected);
    this.setData({
      selected: Object.assign({}, selected, {
        isJj: jj,
        source: jj ? 'jjwxc' : 'douban',
        unit: jj ? '章' : '页',
        publisherText: selected.publisher || '',
        pagesText: '加载中…'
      }),
      totalPages: 0,
      currentPage: '',
      progressText: '',
      readDays: ''
    });
    this._readDaysTouched = false;
    this._applySuggestedReadDays();
    this._fetchBookDetail(doubanId);
  },

  // 详情补齐。用 seq 作令牌：加载途中用户改选/退回时，丢弃过期响应。
  _fetchBookDetail(doubanId) {
    const seq = (this._detailSeq || 0) + 1;
    this._detailSeq = seq;
    const jj = !!(this.data.selected && this.data.selected.isJj);
    wx.cloud.callFunction({
      name: jj ? 'jjwxcBook' : 'fetchBookFullInfo',
      // skipUserQuery：这里只借用它的详情能力，不该污染「电影/图书评分查询」的个人历史
      data: jj
        ? { action: 'detail', novelid: String(doubanId).replace(/^jj_/, '') }
        : { doubanId, skipUserQuery: true },
      success: res => {
        if (seq !== this._detailSeq || !this.data.selected) return;
        const result = res && res.result;
        const book = result && result.success && result.book;
        if (!book) { this._applyDetailFallback(); return; }
        // 「继续阅读」带入时已预置总页数；若这次详情无页数则沿用预置值，不下调为未知。
        // 晋江没有页数：总数 = 章节数（连载书会涨，重拉详情时以最新章节数为准）
        const unit = jj ? '章' : '页';
        const totalPages = (Number(jj ? book.chapterCount : book.pages) || 0) || (Number(this.data.totalPages) || 0);
        const patch = {
          totalPages,
          'selected.publisherText': book.publisher || this.data.selected.publisher || '',
          'selected.pagesText': countText(totalPages, unit)
        };
        if (jj) {
          patch['selected.wordCount'] = Number(book.wordCount) || 0;
          patch['selected.wordText'] = book.wordCount ? `${formatCount(book.wordCount)}字` : '';
          patch['selected.finished'] = !!book.finished;
          patch['selected.serialText'] = book.finished ? '完结' : '连载';
          patch['selected.novelType'] = book.novelType || this.data.selected.novelType || '';
          // 晋江没有评分：评分位显示收藏数
          patch['selected.scoreLabel'] = '收藏';
          patch['selected.ratingText'] = formatCount(book.collectedCount);
        }
        // 云存储封面（云函数已转存）：微信可缓存、不 418，比豆瓣 / 晋江直链稳。
        // 只认 cloud:// 地址，落库时优先用它（直链仅兜底）。
        if (typeof book.cover === 'string' && book.cover.indexOf('cloud://') === 0) {
          patch['selected.cloudCover'] = book.cover;
          // 晋江搜索结果没有封面图，选中后才有：顺带换掉占位图
          if (jj) patch['selected.posterThumb'] = book.cover;
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
    // 保留已预置的总页数（「继续阅读」带入场景）；普通搜索选中时它本就是 0 → 显示未知
    const totalPages = Number(this.data.totalPages) || 0;
    this.setData({
      totalPages,
      'selected.publisherText': (this.data.selected && this.data.selected.publisher) || '',
      'selected.pagesText': countText(totalPages, this.data.selected && this.data.selected.unit)
    });
    this._syncProgress();
  },

  // 重新选择：退回候选列表，保留已有搜索结果
  onReselect() {
    this._detailSeq = (this._detailSeq || 0) + 1;   // 作废在途的详情请求
    this._readDaysTouched = false;
    this.setData({ selected: null, totalPages: 0, currentPage: '', progressText: '', readDays: '' });
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
    // 「同一天不加天数」的判定依赖日期，改完日期要重算一次建议值
    this.setData({ date, dateText: formatDateText(date) }, () => this._applySuggestedReadDays());
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

  // 已读天数：只留数字，1~9999；手改过之后不再被自动建议值覆盖
  onReadDaysInput(e) {
    const digits = String(e.detail.value || '').replace(/\D/g, '').replace(/^0+(?=\d)/, '');
    const readDays = digits.slice(0, 4);
    this._readDaysTouched = true;
    this.setData({ readDays });
    return readDays;   // 返回值回写 input，去掉非法字符时输入框即时纠正
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
      readDays: Number(this.data.readDays) || 0,   // 这本书累计读了几天，0 = 未填
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
    // 晋江书：来源标记 + 进度单位「章」；简介不进用户记录（已存在云端 searched_books 里）
    if (selected.isJj) {
      Object.assign(meta, {
        source: 'jjwxc',
        progressUnit: '章',
        wordCount: Number(selected.wordCount) || 0,
        finished: !!selected.finished,
        novelType: selected.novelType || ''
      });
    }
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
        trackDaily('read', this.route);
        markTimeline.record(this, 'daily:read', 'checkin', [meta]); // 埋点：打卡成功
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
