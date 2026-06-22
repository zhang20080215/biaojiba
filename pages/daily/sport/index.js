const toast = require('../../../utils/dailyToast.js');
const sportIcons = require('../../../utils/sportIcons.js');
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
  normalizeSportEntry
} = require('./common.js');

// 时间轴日期标签
const WEEK_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
function tlLabels(date) {
  const parts = String(date).split('-').map(Number);
  const y = parts[0], m = parts[1] || 1, d = parts[2] || 1;
  const wd = new Date(y, m - 1, d).getDay();
  return { dateLabel: `${m}月${d}日`, weekday: WEEK_CN[wd] };
}

// 当天最多记录多少条运动
const MAX_PER_DAY = 10;

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

    viewMode: 'calendar', // 'calendar' | 'timeline'

    weekHeader: WD_MON,
    calendarCells: [],
    timeline: [],

    selectedDate: '',
    selectedDateText: '',
    selectedSports: [],
    swipedKey: '',
    dragTs: '',
    dragActive: false
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
    wx.setNavigationBarTitle({ title: '每日运动' });
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
      title: '每日运动，记录我的训练打卡',
      path: '/pages/daily/sport/index'
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
    this.setData({ viewMode: view, swipedKey: '' });
  },

  onOpenAdd() {
    if (this.data.selectedSports.length >= MAX_PER_DAY) {
      toast.show(this, `每天最多记录 ${MAX_PER_DAY} 条`);
      return;
    }
    const date = this.data.selectedDate || this.data.today;
    wx.navigateTo({ url: `/pages/daily/sport/add?date=${date}` });
  },

  onShareCard() {
    if (!this.data.selectedSports.length) return;
    const date = this.data.selectedDate || this.data.today;
    wx.navigateTo({ url: `/pages/daily/sport/share?date=${date}` });
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
        data: { action: 'getRange', theme: 'sport', from: range.from, to: range.to },
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
          console.error('sport getRange fail', err);
          toast.show(this, '网络异常');
          this.setData({ loading: false });
          resolve();
        }
      });
    });
  },

  renderMonth(days) {
    this.setData({
      canGoNextMonth: `${this.data.year}-${String(this.data.month).padStart(2, '0')}` < this.data.today.slice(0, 7),
      calendarCells: this.buildCalendar(days),
      selectedSports: this.buildSelected(days),
      timeline: this.buildTimeline(days)
    });
  },

  // 当月时间轴：按日期升序，每天一组，组内按时间排序
  buildTimeline(days) {
    const out = (days || [])
      .filter(d => (d.entries || []).length > 0)
      .map(d => {
        const labels = tlLabels(d.date);
        // 按存储数组顺序展示（与日历选中列表一致，尊重拖拽排序）
        const items = (d.entries || [])
          .map(en => {
            const s = normalizeSportEntry(en, d.date);
            return { ...s, key: `${s.date}-${s.ts}`, iconUri: sportIcons.uriForType(s.typeName) };
          });
        return { date: d.date, dateLabel: labels.dateLabel, weekday: labels.weekday, count: items.length, items };
      });
    out.sort((a, b) => (a.date < b.date ? -1 : 1));
    return out;
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
      const sports = (item.entries || []).map(entry => normalizeSportEntry(entry, date));
      // 代表图标：取列表第一条（与展示/拖拽顺序一致）
      const rep = sports[0];
      cells.push({
        empty: false,
        day,
        date,
        count: sports.length,
        iconUri: rep ? sportIcons.uriForType(rep.typeName) : '',
        isToday: date === this.data.today,
        isSelected: date === this.data.selectedDate,
        hasSports: sports.length > 0
      });
    }
    return cells;
  },

  buildSelected(days) {
    const date = this.data.selectedDate;
    const day = (days || []).find(d => d.date === date);
    // 按存储数组顺序展示（尊重用户拖拽排序，不再按 ts 排序）
    const sports = ((day && day.entries) || [])
      .map(entry => {
        const s = normalizeSportEntry(entry, date);
        return { ...s, key: `${s.date}-${s.ts}`, style: '', iconUri: sportIcons.uriForType(s.typeName) };
      });
    return sports;
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

  onTapSportCard() {
    if (this.data.swipedKey) this.setData({ swipedKey: '' });
  },

  onLongPressSport(e) {
    const { date, ts, title } = e.currentTarget.dataset;
    this.confirmDelete(date, Number(ts), title);
  },

  onSwipeDelete(e) {
    const { date, ts, title } = e.currentTarget.dataset;
    this.setData({ swipedKey: '' });
    this.confirmDelete(date, Number(ts), title);
  },

  // 左滑「编辑」→ 进入 add 页编辑态
  onSwipeEdit(e) {
    const { date, ts } = e.currentTarget.dataset;
    this.setData({ swipedKey: '' });
    if (!date || !ts) return;
    wx.navigateTo({ url: `/pages/daily/sport/add?date=${date}&ts=${ts}` });
  },

  // ─── 拖拽手柄排序（被拖项跟手 + 其余项让位动画 + 落位平滑提交）───────────
  onDragStart(e) {
    const ts = Number(e.currentTarget.dataset.ts);
    const origIndex = Number(e.currentTarget.dataset.index);
    this._drag = { ts, origIndex, startY: e.touches[0].clientY, curTarget: origIndex };
    this._dragStep = 150 * (this.winW / 750); // 估算兜底，避免首帧无值
    this.setData({ dragTs: ts, dragActive: true, swipedKey: '' });
    // 精确量一次行步长（卡片高度 + 间距）
    wx.createSelectorQuery().in(this).select('.sport-card').boundingClientRect(r => {
      if (r && r.height) this._dragStep = r.height + 18 * (this.winW / 750);
    }).exec();
  },

  onDragMove(e) {
    const drag = this._drag;
    if (!drag) return;
    const step = this._dragStep || 1;
    const n = this.data.selectedSports.length;
    const d = drag.origIndex;
    const raw = e.touches[0].clientY - drag.startY;
    const delta = Math.max(-d * step, Math.min((n - 1 - d) * step, raw));
    const target = Math.max(0, Math.min(n - 1, d + Math.round(delta / step)));

    const patch = {};
    // 被拖项：跟手位移、放大、置顶、无过渡
    patch['selectedSports[' + d + '].style'] =
      `transform: translateY(${delta}px) scale(1.03); transition: none; position: relative; z-index: 5;`;
    // 仅在目标槽变化时，更新其余项的让位位移（带过渡，呈现“让位”动画）
    if (target !== drag.curTarget) {
      drag.curTarget = target;
      for (let i = 0; i < n; i++) {
        if (i === d) continue;
        let shift = 0;
        if (target > d && i > d && i <= target) shift = -step;
        else if (target < d && i < d && i >= target) shift = step;
        patch['selectedSports[' + i + '].style'] =
          `transform: translateY(${shift}px); transition: transform .18s ease;`;
      }
    }
    this.setData(patch);
  },

  onDragEnd() {
    const drag = this._drag;
    this._drag = null;
    if (!drag) { this.setData({ dragTs: '', dragActive: false }); return; }
    const step = this._dragStep || 1;
    const d = drag.origIndex;
    const t = drag.curTarget != null ? drag.curTarget : d;

    // 被拖项平滑滑到目标槽（带过渡）
    const slidePatch = {};
    slidePatch['selectedSports[' + d + '].style'] =
      `transform: translateY(${(t - d) * step}px) scale(1); transition: transform .16s ease; z-index: 5;`;
    this.setData(slidePatch);

    setTimeout(() => {
      // 落位：重排数组 + 用 transition:none 瞬时清掉 transform（与动画终态一致，无跳变）
      const arr = this.data.selectedSports.slice();
      if (t !== d) {
        const [item] = arr.splice(d, 1);
        arr.splice(t, 0, item);
      }
      const committed = arr.map(s => ({ ...s, style: 'transition: none;' }));
      this.setData({ selectedSports: committed, dragTs: '', dragActive: false });
      // 下一拍恢复空 style（让左滑等动画的过渡重新可用）
      setTimeout(() => {
        const cleared = this.data.selectedSports.map(s => ({ ...s, style: '' }));
        this.setData({ selectedSports: cleared });
      }, 40);
      if (t !== d) this.persistOrder(this.data.selectedDate, committed.map(s => s.ts));
    }, 170);
  },

  persistOrder(date, order) {
    wx.cloud.callFunction({
      name: 'syncDailyLog',
      data: { action: 'reorderEntries', theme: 'sport', date, order },
      success: res => {
        const result = res && res.result;
        if (!result || !result.success) {
          // 多半是云函数 syncDailyLog 未重新部署（不认识 reorderEntries），看这里的 error 确认
          console.error('sport reorder 未保存:', result && result.error, result);
          toast.show(this, '排序未保存');
          this.fetchMonth();
          return;
        }
        this._syncLocalOrder(date, order);
        // 同步刷新时间轴 + 日历（代表图标随新顺序变化）
        this.setData({
          timeline: this.buildTimeline(this._lastDays || []),
          calendarCells: this.buildCalendar(this._lastDays || [])
        });
      },
      fail: err => {
        console.error('sport reorder fail', err);
        toast.show(this, '网络异常');
        this.fetchMonth();
      }
    });
  },

  // 把本地缓存 _lastDays 里该日的 entries 也按新顺序排好，避免切日再回来顺序回退
  _syncLocalOrder(date, order) {
    const days = this._lastDays || [];
    const day = days.find(d => d.date === date);
    if (!day || !day.entries) return;
    const byTs = {};
    day.entries.forEach(en => { byTs[en.ts] = en; });
    const ordered = [];
    order.forEach(ts => { if (byTs[ts]) { ordered.push(byTs[ts]); delete byTs[ts]; } });
    Object.keys(byTs).forEach(k => ordered.push(byTs[k]));
    day.entries = ordered;
  },

  confirmDelete(date, ts, title) {
    if (!date || !ts) return;
    wx.showModal({
      title: '删除记录',
      content: `确定删除「${title || '这条运动'}」吗？`,
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
      data: { action: 'removeEntry', theme: 'sport', date, ts },
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
        console.error('sport removeEntry fail', err);
        toast.show(this, '网络异常');
      }
    });
  }
});
