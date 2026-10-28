// 数值型每日主题首页（?theme=steps）：今日 + 累计目标 + 月历热力图
// 进页面先展示库里的数据，再在后台同步外部数据源（微信运动），有变化才重拉。
const toast = require('../../../utils/dailyToast.js');
const { trackDaily } = require('../../../utils/track.js');
const D = require('../../../utils/daily/date.js');
const M = require('../../../utils/daily/metric.js');
const { ringUri } = require('../../../utils/daily/ring.js');
const C = require('./common.js');

const RESYNC_MS = 5 * 60 * 1000;
const MAX_MONTH_BACK = 36;

Page({
  data: {
    toast: { show: false, text: '', icon: '' },
    themeClass: '',
    heat: [],

    themeId: 'steps',
    title: '',
    unit: '',
    vocab: {},
    goalConfig: {},
    today: '',
    loading: true,

    // 今日
    todayValue: 0,
    todayText: '0',
    todayMissing: true,
    dailyGoal: 0,
    dailyGoalText: '',
    pct: 0,
    ring: '',
    cheer: '',
    equivalent: '',
    syncText: '',
    syncing: false,
    syncFailed: false,
    authDenied: false,

    // 累计目标
    deadlineGoal: null,
    goalWalked: 0,
    showGoalSheet: false,
    sheetGoal: null,

    // 每日目标面板
    showDailySheet: false,
    dailyDraft: 0,
    goalMin: 1000,
    goalMax: 30000,
    goalStep: 500,

    // 月历
    year: 2026,
    month: 1,
    monthDays: [],
    monthLoading: false,
    canPrev: true,
    canNext: false,
    selected: '',
    selectedText: ''
  },

  onLoad(options) {
    const theme = C.resolveTheme(options && options.theme);
    this.theme = theme;
    const today = D.todayStr();
    const ts = C.themeState();
    this._palette = ts.palette;
    this.setData({
      themeClass: ts.themeClass,
      heat: ts.heat,
      themeId: theme.id,
      title: theme.title,
      unit: theme.unit,
      vocab: theme.vocab,
      goalConfig: theme.deadlineGoal || {},
      goalMin: theme.goalRange[0],
      goalMax: theme.goalRange[1],
      goalStep: theme.goalStep,
      dailyGoal: theme.defaultGoal,
      today,
      year: Number(today.slice(0, 4)),
      month: Number(today.slice(5, 7))
    });
    this._renderToday(0, true);
    Promise.all([this.loadOverview(), this.loadMonth()]).then(() => {
      this.setData({ loading: false });
      this.sync();
    });
  },

  onShow() {
    if (this.data.loading) return;
    // 从「我的」换了主题色回来要跟着变
    const ts = C.themeState();
    if (ts.themeClass !== this.data.themeClass) {
      this._palette = ts.palette;
      this.setData({ themeClass: ts.themeClass, heat: ts.heat });
      this._renderToday(this.data.todayValue, this.data.todayMissing);
    }
    // 挂着页面跨过零点
    const today = D.todayStr();
    if (today !== this.data.today) {
      this.setData({ today });
      this.loadOverview();
      this.loadMonth();
    }
    if (!this._lastSync || Date.now() - this._lastSync > RESYNC_MS) this.sync();
    else this._refreshSyncText();
  },

  onUnload() {
    this._destroyed = true;
  },

  onPullDownRefresh() {
    this.sync(true).then(() => wx.stopPullDownRefresh());
  },

  onShareAppMessage() {
    return { title: `我在标记吧记录${this.data.title}`, path: `/pages/daily/metric/index?theme=${this.data.themeId}` };
  },

  // ========= 数据 =========
  async loadOverview() {
    try {
      const r = await C.callDaily({ action: 'getMetricOverview', theme: this.data.themeId, date: this.data.today });
      if (this._destroyed) return;
      const s = r.settings || {};
      const goal = s.daily_goal || this.theme.defaultGoal;
      this.setData({
        dailyGoal: goal,
        deadlineGoal: s.deadlineGoal || null,
        goalWalked: r.goalWalked || 0
      });
      const day = r.today || {};
      this._renderToday(Number(day.total_value) || 0, M.isMissing(day));
    } catch (err) {
      console.warn('[metric] overview fail', err);
      toast.show(this, '加载失败，下拉重试');
    }
  },

  async loadMonth() {
    const { year, month, themeId } = this.data;
    const r = D.monthRange(year, month);
    this.setData({ monthLoading: true });
    try {
      const res = await C.callDaily({ action: 'getRange', theme: themeId, from: r.from, to: r.to });
      if (this._destroyed || year !== this.data.year || month !== this.data.month) return;
      this._monthMap = M.toDayMap(res.days);
      this.setData({ monthDays: res.days || [], monthLoading: false });
      this._renderSelected();
    } catch (err) {
      console.warn('[metric] month fail', err);
      this.setData({ monthLoading: false });
    }
  },

  // force：下拉刷新时即使同步没有变化也重拉一次
  async sync(force) {
    if (this._syncing) return;
    this._syncing = true;
    this.setData({ syncing: true });
    const res = await C.syncSource(this.theme);
    this._syncing = false;
    if (this._destroyed) return;
    if (res.ok) {
      this._lastSync = Date.now();
      if (!this._tracked) { this._tracked = true; trackDaily(this.data.themeId, this.route); }
      this.setData({ syncing: false, syncFailed: false, authDenied: false });
      this._refreshSyncText();
      if (res.changed || force) await Promise.all([this.loadOverview(), this.loadMonth()]);
      return;
    }
    this.setData({ syncing: false, syncFailed: !res.denied, authDenied: !!res.denied, syncText: '' });
    if (!res.denied) toast.show(this, `同步${this.data.vocab.sourceName || ''}失败，下拉重试`);
    if (force) await Promise.all([this.loadOverview(), this.loadMonth()]);
  },

  _refreshSyncText() {
    this.setData({ syncText: C.syncAgoText(this._lastSync, this.data.vocab.sourceName) });
  },

  // ========= 渲染 =========
  _renderToday(value, missing) {
    const goal = this.data.dailyGoal;
    const ratio = goal > 0 ? value / goal : 0;
    const pct = Math.round(ratio * 100);
    const p = this._palette;
    const eq = this.data.vocab.equivalent;
    this.setData({
      todayValue: value,
      todayMissing: missing,
      todayText: M.formatNum(value),
      dailyGoalText: M.formatNum(goal),
      pct,
      ring: ringUri(Math.min(100, pct), { color: p.accent, track: p.tint }),
      cheer: this.theme.cheerFor ? this.theme.cheerFor(ratio, value, goal) : '',
      equivalent: eq && value > 0 ? `${eq.label} ${M.equivalentOf(value, eq)} ${eq.unit}` : ''
    });
  },

  _renderSelected() {
    const d = this.data.selected;
    if (!d) return this.setData({ selectedText: '' });
    const map = this._monthMap || {};
    const text = d in map ? `${M.formatNum(map[d])} ${this.data.unit}` : '无数据';
    this.setData({ selectedText: `${D.formatDateCN(d)} ${D.weekdayCN(d)} · ${text}` });
  },

  // ========= 月历 =========
  _shiftMonth(delta) {
    const n = D.addMonths(this.data.year, this.data.month, delta);
    const cur = this.data.today.slice(0, 7);
    const key = `${n.year}-${String(n.month).padStart(2, '0')}`;
    if (key > cur) return;
    const t = Number(this.data.today.slice(0, 4)) * 12 + Number(this.data.today.slice(5, 7));
    const back = t - (n.year * 12 + n.month);
    this.setData({
      year: n.year,
      month: n.month,
      canPrev: back < MAX_MONTH_BACK,
      canNext: key < cur,
      selected: '',
      selectedText: '',
      monthDays: []
    });
    this.loadMonth();
  },
  onPrevMonth() { this._shiftMonth(-1); },
  onNextMonth() { this._shiftMonth(1); },
  onSelectDay(e) {
    const date = e.detail.date;
    this.setData({ selected: this.data.selected === date ? '' : date });
    this._renderSelected();
  },

  // ========= 授权 =========
  onOpenSetting() {
    wx.openSetting({
      success: res => {
        if (res.authSetting && res.authSetting['scope.werun']) this.sync(true);
      }
    });
  },

  // ========= 每日目标 =========
  onOpenDailySheet() {
    this.setData({ showDailySheet: true, dailyDraft: this.data.dailyGoal });
  },
  onCloseDailySheet() {
    this.setData({ showDailySheet: false });
  },
  onDailyDraft(e) {
    this.setData({ dailyDraft: e.detail.value });
  },
  async onSaveDailyGoal() {
    const v = this.data.dailyDraft;
    this.setData({ showDailySheet: false });
    if (v === this.data.dailyGoal) return;
    try {
      await C.callDaily({ action: 'setGoal', theme: this.data.themeId, daily_goal: v });
      this.setData({ dailyGoal: v });
      this._renderToday(this.data.todayValue, this.data.todayMissing);
      toast.show(this, '已保存', { icon: 'success' });
    } catch (err) {
      toast.show(this, '保存失败');
    }
  },
  noop() {},

  // ========= 累计目标 =========
  onGoalCreate() {
    this.setData({ showGoalSheet: true, sheetGoal: null });
  },
  onGoalEdit() {
    this.setData({ showGoalSheet: true, sheetGoal: this.data.deadlineGoal });
  },
  async onGoalRestart(e) {
    try {
      await C.callDaily({ action: 'endDeadlineGoal', theme: this.data.themeId, status: e.detail.status });
      this.setData({ deadlineGoal: null, goalWalked: 0, showGoalSheet: true, sheetGoal: null });
    } catch (err) {
      toast.show(this, '操作失败');
    }
  },
  onGoalSheetClose() {
    this.setData({ showGoalSheet: false });
  },
  async onGoalSubmit(e) {
    const { target, startDate, endDate } = e.detail;
    wx.showLoading({ title: '保存中' });
    try {
      await C.callDaily({ action: 'setDeadlineGoal', theme: this.data.themeId, target, startDate, endDate });
      this.setData({ showGoalSheet: false });
      await this.loadOverview();
      toast.show(this, '目标已保存', { icon: 'success' });
    } catch (err) {
      toast.show(this, (err && err.message) || '保存失败');
    } finally {
      wx.hideLoading();
    }
  },
  async onGoalAbandon() {
    try {
      await C.callDaily({ action: 'endDeadlineGoal', theme: this.data.themeId, status: 'cancelled' });
      this.setData({ showGoalSheet: false, deadlineGoal: null, goalWalked: 0 });
    } catch (err) {
      toast.show(this, '操作失败');
    }
  },

  // ========= 入口 =========
  onGoStats() {
    wx.navigateTo({ url: `/pages/daily/metric/stats?theme=${this.data.themeId}` });
  },
  onGoYear() {
    wx.navigateTo({ url: `/pages/daily/metric/year?theme=${this.data.themeId}&year=${this.data.year}` });
  },
  onGoShare() {
    const date = this.data.selected || this.data.today;
    wx.navigateTo({ url: `/pages/daily/metric/share?theme=${this.data.themeId}&date=${date}` });
  }
});
