const toast = require('../../../utils/dailyToast.js');
const {
  WD_MON,
  getWindowInfoCompat,
  getNavMetrics,
  todayStr,
  monthRange,
  addMonths,
  dayOfWeekMon,
  formatMonthLabel,
  formatDateCN,
  normalizeMovieEntry,
  flattenMovies,
  dedupeMovies,
  getMovieThemeView,
  progressRingUri
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
    periodMode: 'month', // 'month' | 'year'

    // 年视图
    yearLabel: '',
    canGoNextYear: false,
    yearCalendar: [],   // 12 张月卡（1-12 月恒在）
    yearWall: [],
    yearWallCls: 'y5',  // 年度电影墙密集档（y5/y6/y7/y8/y9）
    yearTimeline: [],
    yearStats: { total: 0, activeDays: 0, avgRating: '—', topMood: '—', topMovie: null }, // 年度电影墙底部统计

    weekHeader: WD_MON,
    calendarCells: [],
    timeline: [],
    wallMovies: [],
    wallAreaH: 260, // 电影墙区域高度(rpx)，按当月海报实际堆叠高度自适应
    wallCls: 'w5', // 每行张数档位 w5..w9：数量越多每行越多、封面越小（铺满不裁、不滚动）
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
    this.winW = getWindowInfoCompat().windowWidth || 375;
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
    if (this.data.loading) return;
    // 从添加页返回等场景数据可能已变：刷新当前期间，并让对侧缓存作废（切过去时重取）
    if (this.data.periodMode === 'year') {
      this._lastDays = null;
      this.fetchYear();
    } else {
      this._lastYearDays = null;
      this.fetchMonth();
    }
  },

  async onPullDownRefresh() {
    if (this.data.periodMode === 'year') {
      this._lastDays = null;
      await this.fetchYear();
    } else {
      this._lastYearDays = null;
      await this.fetchMonth();
    }
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
    // 电影墙高度已由 buildWall 按内容自适应算好（renderMonth 时写入），切视图直接展示即可
    this.setData({ viewMode: view, swipedKey: '' });
  },

  onOpenAdd() {
    if (this.data.selectedMovies.length >= 8) {
      toast.show(this, '每天最多记录 8 部');
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

  // ── 月/年 切换 ──
  onPeriodTap(e) {
    const period = e.currentTarget.dataset.period;
    if (!period || period === this.data.periodMode) return;
    const patch = { periodMode: period, swipedKey: '' };
    if (period === 'year') patch.yearLabel = `${this.data.year}年`;
    this.setData(patch);
    if (period === 'year') {
      if (this._lastYearDays) this.renderYear(this._lastYearDays);
      else this.fetchYear();
    } else {
      if (this._lastDays) this.renderMonth(this._lastDays);
      else this.fetchMonth();
    }
  },

  onPrevPeriod() {
    if (this.data.periodMode === 'year') this.onPrevYear();
    else this.onPrevMonth();
  },

  onNextPeriod() {
    if (this.data.periodMode === 'year') this.onNextYear();
    else this.onNextMonth();
  },

  onPrevYear() {
    this.setData({ year: this.data.year - 1 });
    this.fetchYear();
  },

  onNextYear() {
    if (!this.data.canGoNextYear) return;
    this.setData({ year: this.data.year + 1 });
    this.fetchYear();
  },

  // 点年度日历的月卡 → 切回该月的月历
  onYearMonthTap(e) {
    const month = Number(e.currentTarget.dataset.month);
    if (!month) return;
    const selectedDate = this._defaultSelected(this.data.year, month);
    this.setData({
      periodMode: 'month',
      viewMode: 'calendar',
      month,
      monthLabel: formatMonthLabel(this.data.year, month),
      selectedDate,
      selectedDateText: formatDateCN(selectedDate),
      swipedKey: ''
    });
    this.fetchMonth();
  },

  fetchYear() {
    this.setData({ loading: true });
    return new Promise(resolve => {
      wx.cloud.callFunction({
        name: 'syncDailyLog',
        data: { action: 'getYear', theme: 'movie', year: this.data.year },
        success: res => {
          const result = res && res.result;
          if (!result || !result.success) {
            toast.show(this, '加载失败');
            this.setData({ loading: false });
            resolve();
            return;
          }
          this._lastYearDays = result.days || [];
          this.renderYear(this._lastYearDays);
          this.setData({ loading: false });
          resolve();
        },
        fail: err => {
          console.error('movie getYear fail', err);
          toast.show(this, '网络异常');
          this.setData({ loading: false });
          resolve();
        }
      });
    });
  },

  renderYear(days) {
    const wall = this.buildYearWall(days);
    this.setData({
      yearLabel: `${this.data.year}年`,
      canGoNextYear: this.data.year < Number(this.data.today.slice(0, 4)),
      yearCalendar: this.buildYearCalendar(days),
      yearWall: wall.items,
      yearWallCls: wall.cls,
      yearTimeline: this.buildYearTimeline(days),
      yearStats: this.buildMonthStats(days) // 复用月统计逻辑，按全年数据算
    });
  },

  // 年度日历：12 张月卡，每月取前 9 张封面（ts 升序）排九宫格
  // 部数与封面均按电影去重（同片当月多次记录只算/只展示一次），与电影墙/统计口径一致
  buildYearCalendar(days) {
    const byMonth = Array.from({ length: 12 }, () => []);
    (days || []).forEach(d => {
      const mIdx = Number(String(d.date).slice(5, 7)) - 1;
      if (mIdx < 0 || mIdx > 11) return;
      (d.entries || []).forEach(en => { byMonth[mIdx].push(normalizeMovieEntry(en, d.date)); });
    });
    return byMonth.map((list, i) => {
      const uniq = dedupeMovies(list).sort((a, b) => (a.ts || 0) - (b.ts || 0));
      const covers = uniq.slice(0, 9).map(m => m.posterThumb || '/images/default-movie.jpg');
      return { month: i + 1, count: uniq.length, covers, hasMovies: uniq.length > 0 };
    });
  },

  // 年度电影墙：按 ts 升序 + CSS wrap-reverse → 最早的先落满最底排、往上堆，最近看的浮在最顶（与月墙一致）；数量越多单张越小
  buildYearWall(days) {
    // 同一部电影只展示一次（取最近一次观看），与月墙一致
    const base = dedupeMovies(flattenMovies(days)).sort((a, b) => (a.ts || 0) - (b.ts || 0));
    const n = base.length;
    const perRow = n <= 15 ? 5 : n <= 30 ? 6 : n <= 60 ? 7 : n <= 100 ? 8 : 9;
    const items = base.map((m, i) => ({
      ...m,
      key: `${m.date}-${m.ts}`,
      rotate: this.posterRotate(m),
      fallFrom: 260,
      delay: Math.min(i * 0.03, 1.5)
    }));
    return { items, cls: 'y' + perRow };
  },

  // 年度时间轴：复用月时间轴分组逻辑，跨全年；倒序（最近的天/条在最上）
  buildYearTimeline(days) {
    const groups = this.buildTimeline(days);
    return groups.slice().reverse().map(g => ({ ...g, items: g.items.slice().reverse() }));
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
    const wall = this.buildWall(days);
    this.setData({
      canGoNextMonth: `${this.data.year}-${String(this.data.month).padStart(2, '0')}` < this.data.today.slice(0, 7),
      calendarCells: this.buildCalendar(days),
      selectedMovies: this.buildSelected(days),
      timeline: this.buildTimeline(days),
      wallAreaH: wall.areaH,
      wallMovies: wall.items,
      wallCls: wall.wallCls,
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
            return {
              ...m,
              key: `${m.date}-${m.ts}`,
              // 剧集进度环：有集数分母才画（text:false 只画环不写数字）
              progressRing: m.epProgressPct > 0 ? progressRingUri(m.epProgressPct, { text: false }) : ''
            };
          })
          .sort((a, b) => (a.ts || 0) - (b.ts || 0));
        return { date: d.date, dateLabel: labels.dateLabel, weekday: labels.weekday, count: items.length, items };
      });
    out.sort((a, b) => (a.date < b.date ? -1 : 1));
    return out;
  },

  // 当月观影统计（电影墙视图下方展示）——「共看部数/评分/心情」按电影去重（同片只算一次）
  buildMonthStats(days) {
    const movies = dedupeMovies(flattenMovies(days));
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

  // 每档每行张数对应的海报高度(rpx)。宽度在 CSS .poster-wall.w5..w9 里定义（内容宽 686rpx、列间距 14rpx）
  WALL_POSTER_H: { 5: 152, 6: 140, 7: 120, 8: 102, 9: 88 },

  // 电影墙：当月全部电影，按时间排序，海报在区域底部由下往上堆（满排沉底，剩下的浮在顶上，靠 wrap-reverse 实现）
  // 区域高度按实际堆叠高度自适应（少不留白、多不裁切）：数量越多每行越多、封面越小（w5→w9），铺满不滚动
  // 返回 { items, areaH, wallCls }；fallFrom/delay 用于仿重力错峰飘落动画
  buildWall(days) {
    // 同一部电影只展示一次（取最近一次观看），再按时间排序堆叠
    const base = dedupeMovies(flattenMovies(days)).sort((a, b) => (a.ts || 0) - (b.ts || 0));
    const n = base.length;
    // 分档：与年度墙一致的阈值，数量越多每行越多
    const perRow = n <= 15 ? 5 : n <= 30 ? 6 : n <= 60 ? 7 : n <= 100 ? 8 : 9;
    const POSTER_H = this.WALL_POSTER_H[perRow];
    const ROW_GAP = 18;                // 行间距
    const ROW_H = POSTER_H + ROW_GAP;
    const TOP_PAD = 24;                // 海报块顶部呼吸留白
    const MIN_AREA = 260;              // 空/稀疏月的最小高度（保证空状态文案有空间）

    const totalRows = Math.ceil(n / perRow) || 1;
    const blockH = totalRows * POSTER_H + (totalRows - 1) * ROW_GAP;
    const areaH = Math.max(MIN_AREA, blockH + TOP_PAD);
    const topOfBlock = areaH - blockH;       // 底对齐：>= TOP_PAD，正常不再为负（不裁切）

    const items = base.map((m, i) => {
      const fillRow = Math.floor(i / perRow);
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
    return { items, areaH, wallCls: 'w' + perRow };
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
      // 日历格只展示最近添加的 4 部（按 ts 降序，最新在前）——每日上限 8 部，格子仍最多 4 张
      const recent = movies.slice().sort((a, b) => (b.ts || 0) - (a.ts || 0));
      const covers = recent.slice(0, 4).map(m => m.posterThumb || '/images/default-movie.jpg');
      // 多部电影只取最新一部（ts 最大）的心情 emoji
      const latestMood = recent.find(m => m.moodEmoji);
      // 剧集进度环：取最新一部的观看进度（有集数分母才算得出百分比），右下角展示
      const latestEpPct = recent.length ? (recent[0].epProgressPct || 0) : 0;
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
        moodEmoji: latestMood ? latestMood.moodEmoji : '',
        progressRing: latestEpPct > 0 ? progressRingUri(latestEpPct, { text: false }) : ''
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

  // 条目「分享」：只把这一部放进 selection → 分享页按单部渲染成单张海报
  onShareMovie(e) {
    const key = e.currentTarget.dataset.key;
    if (this.data.swipedKey) this.setData({ swipedKey: '' });
    const movie = (this.data.selectedMovies || []).find(m => m.key === key);
    if (!movie) { toast.show(this, '记录不存在'); return; }
    const app = getApp();
    if (app && app.globalData) app.globalData.moviePosterSelection = [movie];
    wx.navigateTo({ url: '/pages/daily/movie/share' });
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

  // 弹窗内半星点按评分（左半=X.5、右半=X.0）
  onEditStarTap(e) {
    let v = Number(e.currentTarget.dataset.value) || 0.5;
    if (v < 0.5) v = 0.5;
    if (v > 5) v = 5;
    if (v === this.data.editRating) return;
    this.setData({ editRating: v, editRatingLabel: `${v.toFixed(1)} 星`, editStars: buildStars(v) });
  },

  // 弹窗内拖拽评分：touchstart 测量，touchmove 实时改分（点按仍走 onEditStarTap）
  onEditStarTouchStart() {
    wx.createSelectorQuery().in(this).select('.edit-star-row').boundingClientRect(rect => {
      if (rect && rect.width) this._editStarRect = rect;
    }).exec();
  },
  onEditStarTouchMove(e) {
    const rect = this._editStarRect;
    if (!rect || !rect.width) return;
    const t = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]);
    if (!t) return;
    const v = starValueFromX(t.clientX, rect);
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
            this._lastYearDays = null; // 年缓存作废，切「年」时重取
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
        this._lastYearDays = null; // 年缓存作废，切「年」时重取
        this.fetchMonth();
      },
      fail: err => {
        console.error('movie removeEntry fail', err);
        toast.show(this, '网络异常');
      }
    });
  }
});
