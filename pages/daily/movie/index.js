const toast = require('../../../utils/dailyToast.js');
const {
  WD_MON,
  getNavMetrics,
  todayStr,
  monthRange,
  addMonths,
  dayOfWeekMon,
  formatMonthLabel,
  formatDateCN,
  normalizeMovieEntry,
  flattenMovies,
  getMovieThemeView
} = require('./common.js');

// 心情选项（与添加页保持一致），编辑弹窗复用
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

// rating(0~5, 步进0.5) → 5 颗星状态：'full' | 'half' | 'empty'
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

// 时间轴日期标签
const WEEK_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
function tlLabels(date) {
  const parts = String(date).split('-').map(Number);
  const y = parts[0], m = parts[1] || 1, d = parts[2] || 1;
  const wd = new Date(y, m - 1, d).getDay();
  return { dateLabel: `${m}月${d}日`, weekday: WEEK_CN[wd] };
}

Page({
  data: {
    toast: { show: false, text: '', icon: '' },
    statusBarHeight: 20,
    navBarHeight: 48,
    navOffset: 68,

    today: '',
    year: 2026,
    month: 1,
    monthLabel: '',
    canGoNextMonth: false,

    loading: true,

    viewMode: 'calendar', // 'calendar' | 'wall' | 'timeline'

    weekHeader: WD_MON,
    calendarCells: [],
    timeline: [],
    wallMovies: [],
    wallAreaH: 644, // 电影墙区域高度(rpx)，按当月日历周数估算，与日历等高
    wallDense: false, // 当月电影 > 15 部时改为每行 6 张
    monthStats: { total: 0, activeDays: 0, avgRating: '—', topMood: '—', topMovie: null }, // 电影墙视图下方的当月观影统计

    selectedDate: '',
    selectedDateText: '',
    selectedMovies: [],
    swipedKey: '',

    // 轻编辑弹窗（只改 评分 / 心情 / 短评）
    editModal: false,
    editDate: '',
    editTs: 0,
    editTitle: '',
    editRating: 0,
    editRatingLabel: '未评分',
    editStars: buildStars(0),
    editMoods: MOOD_OPTIONS,
    editMood: '',
    editNote: '',
    editNoteCount: 0,
    editSaving: false
  },

  onLoad(options) {
    const nav = getNavMetrics();
    this.winW = (wx.getSystemInfoSync && wx.getSystemInfoSync().windowWidth) || 375;
    const today = todayStr();
    const parts = today.split('-').map(Number);
    const targetDate = options && options.date ? options.date : today;
    const targetParts = targetDate.split('-').map(Number);
    const year = targetParts[0] || parts[0];
    const month = targetParts[1] || parts[1];
    const themeView = getMovieThemeView();
    this.theme = themeView.theme;
    this.setData({
      statusBarHeight: nav.statusBarHeight,
      navBarHeight: nav.navBarHeight,
      navOffset: nav.navOffset,
      today,
      year,
      month,
      monthLabel: formatMonthLabel(year, month),
      selectedDate: targetDate,
      selectedDateText: formatDateCN(targetDate)
    });
    wx.setNavigationBarTitle({ title: '每日电影' });
    this.fetchMonth();
  },

  onShow() {
    const today = todayStr();
    if (today !== this.data.today) this.setData({ today });
    if (!this.data.loading) this.fetchMonth();
  },

  async onPullDownRefresh() {
    await this.fetchMonth();
    wx.stopPullDownRefresh();
  },

  onShareAppMessage() {
    return {
      title: '每日电影，记录我的观影片单',
      path: '/pages/daily/movie/index'
    };
  },

  onBack() {
    if (getCurrentPages().length > 1) {
      wx.navigateBack();
    } else {
      wx.reLaunch({ url: '/pages/category/category' });
    }
  },

  onViewTap(e) {
    const view = e.currentTarget.dataset.view;
    if (!view || view === this.data.viewMode) return;
    if (view !== 'wall') {
      this.setData({ viewMode: view, swipedKey: '' });
      return;
    }
    // 切到电影墙前，量一下当前日历的真实高度，让电影墙与之等高（最稳的等高方式）
    wx.createSelectorQuery().in(this).select('#calBlock').boundingClientRect(rect => {
      const data = { viewMode: 'wall', swipedKey: '' };
      if (rect && rect.height) {
        const hRpx = Math.round(rect.height * 750 / (this.winW || 375));
        const wallMovies = this.buildWall(this._lastDays || [], hRpx);
        data.wallAreaH = hRpx;
        data.wallMovies = wallMovies;
        data.wallDense = wallMovies.length > 15;
      }
      this.setData(data);
    }).exec();
  },

  onOpenAdd() {
    if (this.data.selectedMovies.length >= 4) {
      toast.show(this, '每天最多记录 4 部');
      return;
    }
    const date = this.data.selectedDate || this.data.today;
    wx.navigateTo({ url: `/pages/daily/movie/add?date=${date}` });
  },

  // 默认选中：当前月则选今天，否则选当月 1 号
  _defaultSelected(year, month) {
    const prefix = `${year}-${String(month).padStart(2, '0')}`;
    if (prefix === this.data.today.slice(0, 7)) return this.data.today;
    return `${prefix}-01`;
  },

  onPrevMonth() {
    const next = addMonths(this.data.year, this.data.month, -1);
    this._goMonth(next.year, next.month);
  },

  onNextMonth() {
    if (!this.data.canGoNextMonth) return;
    const next = addMonths(this.data.year, this.data.month, 1);
    this._goMonth(next.year, next.month);
  },

  _goMonth(year, month) {
    const selectedDate = this._defaultSelected(year, month);
    this.setData({
      year,
      month,
      monthLabel: formatMonthLabel(year, month),
      selectedDate,
      selectedDateText: formatDateCN(selectedDate),
      swipedKey: ''
    });
    this.fetchMonth();
  },

  onSelectDay(e) {
    const date = e.currentTarget.dataset.date;
    if (!date || date === this.data.selectedDate) return;
    this.setData({
      selectedDate: date,
      selectedDateText: formatDateCN(date),
      swipedKey: ''
    });
    this.renderMonth(this._lastDays || []);
  },

  fetchMonth() {
    const range = monthRange(this.data.year, this.data.month);
    this.setData({ loading: true });
    return new Promise(resolve => {
      wx.cloud.callFunction({
        name: 'syncDailyLog',
        data: { action: 'getRange', theme: 'movie', from: range.from, to: range.to },
        success: res => {
          const result = res && res.result;
          if (!result || !result.success) {
            toast.show(this, '加载失败');
            this.setData({ loading: false });
            resolve();
            return;
          }
          this._lastDays = result.days || [];
          this.renderMonth(this._lastDays);
          this.setData({ loading: false });
          resolve();
        },
        fail: err => {
          console.error('movie getRange fail', err);
          toast.show(this, '网络异常');
          this.setData({ loading: false });
          resolve();
        }
      });
    });
  },

  renderMonth(days) {
    const areaH = this.calcWallAreaH();
    const wallMovies = this.buildWall(days, areaH);
    this.setData({
      canGoNextMonth: `${this.data.year}-${String(this.data.month).padStart(2, '0')}` < this.data.today.slice(0, 7),
      calendarCells: this.buildCalendar(days),
      selectedMovies: this.buildSelected(days),
      timeline: this.buildTimeline(days),
      wallAreaH: areaH,
      wallMovies,
      wallDense: wallMovies.length > 15,
      monthStats: this.buildMonthStats(days)
    });
  },

  // 当月时间轴：按日期升序，每天一组，组内按时间排序
  buildTimeline(days) {
    const out = (days || [])
      .filter(d => (d.entries || []).length > 0)
      .map(d => {
        const labels = tlLabels(d.date);
        const items = (d.entries || [])
          .map(en => {
            const m = normalizeMovieEntry(en, d.date);
            return { ...m, key: `${m.date}-${m.ts}` };
          })
          .sort((a, b) => (a.ts || 0) - (b.ts || 0));
        return { date: d.date, dateLabel: labels.dateLabel, weekday: labels.weekday, count: items.length, items };
      });
    out.sort((a, b) => (a.date < b.date ? -1 : 1));
    return out;
  },

  // 当月观影统计（电影墙视图下方展示）
  buildMonthStats(days) {
    const movies = flattenMovies(days);
    const total = movies.length;
    const activeDays = (days || []).filter(d => (d.entries || []).length > 0).length;
    const rated = movies.map(m => Number(m.rating)).filter(n => Number.isFinite(n) && n > 0);
    // 10 分制：5 星制评分 ×2
    const avgRating = rated.length ? (rated.reduce((s, n) => s + n, 0) / rated.length * 2).toFixed(1) : '—';
    let topMovie = null;
    movies.forEach(m => {
      if (Number(m.rating) > 0 && (!topMovie || Number(m.rating) > Number(topMovie.rating))) topMovie = m;
    });
    const moodMap = {};
    movies.forEach(m => { if (m.moodEmoji) moodMap[m.moodEmoji] = (moodMap[m.moodEmoji] || 0) + 1; });
    const topMood = Object.keys(moodMap).sort((a, b) => moodMap[b] - moodMap[a])[0] || '—';
    return {
      total,
      activeDays,
      avgRating,
      topMood,
      topMovie: topMovie ? { title: topMovie.title, posterThumb: topMovie.posterThumb, rating: Number(topMovie.rating) || 0, score: (Number(topMovie.rating) * 2) + '分' } : null
    };
  },

  // 估算电影墙区域高度（= 日历区域高度，rpx）：周历头(~26) + 网格上边距(14) + 网格高
  calcWallAreaH() {
    const range = monthRange(this.data.year, this.data.month);
    const calRows = Math.ceil((dayOfWeekMon(range.fromDate) + range.lastDay) / 7);
    const CELL_W = (750 - 64 - 48) / 7;      // 内容宽 686rpx，7 列，列间距 8rpx
    const CELL_H = CELL_W * 1.22;            // 日历格宽高比 1 / 1.22
    return Math.round(40 + calRows * CELL_H + (calRows - 1) * 12);
  },

  // 电影墙：当月全部电影，按时间排序，海报在区域底部由下往上堆（满排沉底，剩下的浮在顶上，靠 wrap-reverse 实现）
  // fallFrom：每张海报到自己落点上方约 160rpx 起落（落点越靠下下落越远 → 仿重力一路掉到最底）
  // delay：按顺序错开，越靠底越先落（瀑布式由下往上堆）
  buildWall(days, areaH) {
    const base = flattenMovies(days).sort((a, b) => (a.ts || 0) - (b.ts || 0));
    // 超过 15 部 → 密集模式：每行 6 张、海报更小（与 .poster-wall.dense 的 CSS 尺寸一致）
    const dense = base.length > 15;
    const PER_ROW = dense ? 6 : 5;     // 内容区约 686rpx：5×108 或 6×100（含 14rpx 列间距）
    const POSTER_H = dense ? 140 : 152;
    const ROW_GAP = 18;                // 行间距
    const ROW_H = POSTER_H + ROW_GAP;

    const totalRows = Math.ceil(base.length / PER_ROW) || 1;
    const blockH = totalRows * POSTER_H + (totalRows - 1) * ROW_GAP;
    const topOfBlock = areaH - blockH;       // 底对齐：海报块顶到区域顶的距离（可能为负 = 溢出，由 overflow 裁剪）

    return base.map((m, i) => {
      const fillRow = Math.floor(i / PER_ROW);
      const visualRow = totalRows - 1 - fillRow;   // wrap-reverse：填充第 0 行落在视觉最底
      const restingTop = topOfBlock + visualRow * ROW_H;
      return {
        ...m,
        key: `${m.date}-${m.ts}`,
        rotate: this.posterRotate(m),
        fallFrom: Math.round(Math.max(restingTop + 160, 200)),
        delay: Math.min(i * 0.04, 1.2)
      };
    });
  },

  posterRotate(movie) {
    const seed = Number(movie.doubanId) || Number(movie.ts) || 0;
    return `${(seed % 11) - 5}deg`;
  },

  buildCalendar(days) {
    const range = monthRange(this.data.year, this.data.month);
    const map = {};
    (days || []).forEach(day => { map[day.date] = day; });
    const cells = [];
    const firstWd = dayOfWeekMon(range.fromDate);
    for (let i = 0; i < firstWd; i++) cells.push({ empty: true });
    for (let day = 1; day <= range.lastDay; day++) {
      const date = `${range.year}-${String(range.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const item = map[date] || { date, entries: [] };
      const movies = (item.entries || []).map(entry => normalizeMovieEntry(entry, date));
      const covers = movies.slice(0, 4).map(m => m.posterThumb || '/images/default-movie.jpg');
      // 多部电影只取最新一部（ts 最大）的心情 emoji
      const latestMood = movies
        .slice()
        .sort((a, b) => (b.ts || 0) - (a.ts || 0))
        .find(m => m.moodEmoji);
      cells.push({
        empty: false,
        day,
        date,
        count: movies.length,
        covers,
        gridClass: covers.length ? `g${covers.length}` : '',
        isToday: date === this.data.today,
        isSelected: date === this.data.selectedDate,
        hasMovies: movies.length > 0,
        moodEmoji: latestMood ? latestMood.moodEmoji : ''
      });
    }
    return cells;
  },

  buildSelected(days) {
    const date = this.data.selectedDate;
    const day = (days || []).find(d => d.date === date);
    const movies = ((day && day.entries) || [])
      .map(entry => {
        const movie = normalizeMovieEntry(entry, date);
        return { ...movie, key: `${movie.date}-${movie.ts}` };
      })
      .sort((a, b) => (a.ts || 0) - (b.ts || 0));
    return movies;
  },

  onCardTouchStart(e) {
    const touch = e.touches[0];
    this._touchStart = {
      x: touch.clientX,
      y: touch.clientY,
      key: e.currentTarget.dataset.key
    };
  },

  onCardTouchEnd(e) {
    if (!this._touchStart) return;
    const touch = e.changedTouches[0];
    const dx = touch.clientX - this._touchStart.x;
    const dy = touch.clientY - this._touchStart.y;
    const key = this._touchStart.key;
    this._touchStart = null;
    if (Math.abs(dx) > Math.abs(dy) * 1.5 && Math.abs(dx) > 50) {
      // 左滑露出删除，右滑收回
      if (dx < 0) this.setData({ swipedKey: key });
      else if (this.data.swipedKey === key) this.setData({ swipedKey: '' });
    }
  },

  onTapMovieCard() {
    if (this.data.swipedKey) this.setData({ swipedKey: '' });
  },

  onLongPressMovie(e) {
    const { date, ts, title } = e.currentTarget.dataset;
    this.confirmDelete(date, Number(ts), title);
  },

  onSwipeDelete(e) {
    const { date, ts, title } = e.currentTarget.dataset;
    this.setData({ swipedKey: '' });
    this.confirmDelete(date, Number(ts), title);
  },

  // ── 轻编辑：左滑「编辑」打开弹窗，只改 评分 / 心情 / 短评 ──
  onSwipeEdit(e) {
    const { date, ts, title } = e.currentTarget.dataset;
    const tsNum = Number(ts);
    const day = (this._lastDays || []).find(d => d.date === date);
    const raw = day && (day.entries || []).find(en => en.ts === tsNum);
    if (!raw) { toast.show(this, '记录不存在'); return; }
    this._editRawMeta = { ...(raw.meta || {}) };
    const rating = Number(this._editRawMeta.rating) || 0;
    const mood = this._editRawMeta.mood || '';
    const note = this._editRawMeta.note || '';
    this.setData({
      swipedKey: '',
      editModal: true,
      editDate: date,
      editTs: tsNum,
      editTitle: title || this._editRawMeta.title || '',
      editRating: rating,
      editRatingLabel: rating > 0 ? `${rating.toFixed(1)} 星` : '未评分',
      editStars: buildStars(rating),
      editMood: mood,
      editNote: note,
      editNoteCount: note.length
    });
  },

  onCloseEdit() {
    if (this.data.editSaving) return;
    this.setData({ editModal: false });
  },

  // 弹窗内五角星拖拽评分
  onEditStarTouchStart(e) {
    this._measureEditStarRow().then(() => this._applyEditStarTouch(e));
  },
  onEditStarTouchMove(e) {
    this._applyEditStarTouch(e);
  },
  _measureEditStarRow() {
    return new Promise(resolve => {
      wx.createSelectorQuery().in(this).select('.edit-star-row').boundingClientRect(rect => {
        if (rect && rect.width) this._editStarRect = rect;
        resolve();
      }).exec();
    });
  },
  _applyEditStarTouch(e) {
    const rect = this._editStarRect;
    if (!rect || !rect.width) return;
    const t = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]);
    if (!t) return;
    let ratio = (t.clientX - rect.left) / rect.width;
    if (ratio < 0) ratio = 0;
    if (ratio > 1) ratio = 1;
    let v = Math.ceil(ratio * 10) / 2;
    if (v < 0.5) v = 0.5;
    if (v > 5) v = 5;
    if (v === this.data.editRating) return;
    this.setData({ editRating: v, editRatingLabel: `${v.toFixed(1)} 星`, editStars: buildStars(v) });
  },

  onEditMoodTap(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({ editMood: this.data.editMood === key ? '' : key });
  },

  onEditNoteInput(e) {
    const note = e.detail.value || '';
    this.setData({ editNote: note, editNoteCount: note.length });
  },

  onEditSave() {
    if (this.data.editSaving) return;
    const date = this.data.editDate;
    const oldTs = this.data.editTs;
    if (!date || !oldTs) return;
    const moodOpt = MOOD_OPTIONS.find(m => m.key === this.data.editMood);
    const meta = { ...(this._editRawMeta || {}) };
    meta.rating = Number(this.data.editRating) || 0;
    meta.mood = this.data.editMood || '';
    meta.moodEmoji = moodOpt ? moodOpt.emoji : '';
    meta.moodLabel = moodOpt ? moodOpt.label : '';
    meta.note = (this.data.editNote || '').trim();
    this.setData({ editSaving: true });
    // 先加新（云端 addEntry 无每日上限），成功后删旧；删失败仅留重复可手动删，避免丢数据
    wx.cloud.callFunction({
      name: 'syncDailyLog',
      data: { action: 'addEntry', theme: 'movie', date, value: 1, meta },
      success: addRes => {
        const ok = addRes && addRes.result && addRes.result.success;
        if (!ok) {
          toast.show(this, '保存失败');
          this.setData({ editSaving: false });
          return;
        }
        wx.cloud.callFunction({
          name: 'syncDailyLog',
          data: { action: 'removeEntry', theme: 'movie', date, ts: oldTs },
          complete: () => {
            this.setData({ editSaving: false, editModal: false });
            toast.show(this, '已保存', { icon: 'success' });
            this.fetchMonth();
          }
        });
      },
      fail: err => {
        console.error('movie edit save fail', err);
        toast.show(this, '网络异常');
        this.setData({ editSaving: false });
      }
    });
  },

  confirmDelete(date, ts, title) {
    if (!date || !ts) return;
    wx.showModal({
      title: '删除记录',
      content: `确定删除「${title || '这部电影'}」吗？`,
      confirmText: '删除',
      confirmColor: '#D63838',
      success: res => {
        if (res.confirm) this.removeEntry(date, ts);
      }
    });
  },

  removeEntry(date, ts) {
    wx.cloud.callFunction({
      name: 'syncDailyLog',
      data: { action: 'removeEntry', theme: 'movie', date, ts },
      success: res => {
        const result = res && res.result;
        if (!result || !result.success) {
          toast.show(this, '删除失败');
          return;
        }
        toast.show(this, '已删除', { icon: 'success' });
        this.fetchMonth();
      },
      fail: err => {
        console.error('movie removeEntry fail', err);
        toast.show(this, '网络异常');
      }
    });
  }
});
