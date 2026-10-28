// 数值型每日主题首页（?theme=steps | sleep）：今日卡 + 累计目标 + 月历热力图
// 步数（count，微信运动同步）：进页面先展示库里的数据，再在后台同步，有变化才重拉。
// 睡眠（bedtime，手动记录）：「我去睡了 / 我起床了」快捷记录 + 半屏表单补记、修改、删除。
// 两种度量的展示差别在 utils/daily/views.js，这里只按 measure 选今日卡的样式。
const toast = require('../../../utils/dailyToast.js');
const { trackDaily } = require('../../../utils/track.js');
const D = require('../../../utils/daily/date.js');
const M = require('../../../utils/daily/metric.js');
const T = require('../../../utils/daily/clock.js');
const V = require('../../../utils/daily/views.js');
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
    measure: 'count',
    manual: false,
    title: '',
    unit: '',
    vocab: {},
    goalConfig: {},
    today: '',
    loading: true,

    // 今日（count）
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

    // 今晚（bedtime）
    sleep: null,

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
    bedOptions: [],
    bedIndex: 0,

    // 睡眠记录面板
    showEntrySheet: false,
    entry: { date: '', bedTime: '', wakeTime: '', canDelete: false },

    // 月历
    year: 2026,
    month: 1,
    monthDays: [],
    monthLoading: false,
    canPrev: true,
    canNext: false,
    selected: '',
    selectedText: '',
    selectedHas: false
  },

  onLoad(options) {
    const theme = C.resolveTheme(options && options.theme);
    this.theme = theme;
    this.view = V.viewOf(theme);
    const today = C.todayOf(theme);
    const ts = C.themeState();
    this._palette = ts.palette;
    const [gMin, gMax] = theme.goalRange;
    const bedOptions = [];
    if (theme.measure === 'bedtime') {
      for (let v = gMin; v <= gMax; v += theme.goalStep) bedOptions.push({ value: v, label: T.offsetToClock(v) });
    }
    this.setData({
      themeClass: ts.themeClass,
      heat: ts.heat,
      themeId: theme.id,
      measure: theme.measure || 'count',
      manual: theme.source === 'manual',
      title: theme.title,
      unit: theme.unit,
      vocab: theme.vocab,
      goalConfig: theme.deadlineGoal || {},
      goalMin: gMin,
      goalMax: gMax,
      goalStep: theme.goalStep,
      bedOptions,
      dailyGoal: theme.defaultGoal,
      today,
      year: Number(today.slice(0, 4)),
      month: Number(today.slice(5, 7))
    });
    this._renderToday();
    Promise.all([this.loadOverview(), this.loadMonth()]).then(() => {
      this.setData({ loading: false });
      if (this.theme.source === 'werun') this.sync();
    });
  },

  onShow() {
    if (this.data.loading) return;
    // 从「我的」换了主题色回来要跟着变
    const ts = C.themeState();
    if (ts.themeClass !== this.data.themeClass) {
      this._palette = ts.palette;
      this.setData({ themeClass: ts.themeClass, heat: ts.heat });
    }
    // 挂着页面跨过零点（睡眠是跨过中午）
    const today = C.todayOf(this.theme);
    if (today !== this.data.today) {
      this.setData({ today });
      this.loadOverview();
      this.loadMonth();
    } else {
      this._renderToday();   // 睡眠的倒计时、按钮跟着当前时刻变
    }
    if (this.theme.source === 'werun') {
      if (!this._lastSync || Date.now() - this._lastSync > RESYNC_MS) this.sync();
      else this._refreshSyncText();
    }
  },

  onUnload() {
    this._destroyed = true;
  },

  onPullDownRefresh() {
    const done = () => wx.stopPullDownRefresh();
    if (this.theme.source === 'werun') this.sync(true).then(done);
    else Promise.all([this.loadOverview(), this.loadMonth()]).then(done);
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
      this._todayDoc = M.isMissing(r.today) ? null : r.today;
      this.setData({
        dailyGoal: s.daily_goal || this.theme.defaultGoal,
        deadlineGoal: s.deadlineGoal || null,
        goalWalked: r.goalWalked || 0
      });
      this._renderToday();
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
      this._monthDocs = M.toDocMap(res.days);
      this.setData({ monthDays: res.days || [], monthLoading: false });
      this._renderSelected();
    } catch (err) {
      console.warn('[metric] month fail', err);
      this.setData({ monthLoading: false });
    }
  },

  // 外部数据源同步（只有 source=werun 的主题会走到）。force：下拉刷新时即使没有变化也重拉
  async sync(force) {
    if (this._syncing) return;
    this._syncing = true;
    this.setData({ syncing: true });
    const res = await C.syncSource(this.theme);
    this._syncing = false;
    if (this._destroyed) return;
    if (res.ok) {
      this._lastSync = Date.now();
      this._trackOnce();
      this.setData({ syncing: false, syncFailed: false, authDenied: false });
      this._refreshSyncText();
      if (res.changed || force) await Promise.all([this.loadOverview(), this.loadMonth()]);
      return;
    }
    this.setData({ syncing: false, syncFailed: !res.denied, authDenied: !!res.denied, syncText: '' });
    if (!res.denied) toast.show(this, `同步${this.data.vocab.sourceName || ''}失败，下拉重试`);
    if (force) await Promise.all([this.loadOverview(), this.loadMonth()]);
  },

  _trackOnce() {
    if (this._tracked) return;
    this._tracked = true;
    trackDaily(this.data.themeId, this.route);
  },

  _refreshSyncText() {
    this.setData({ syncText: C.syncAgoText(this._lastSync, this.data.vocab.sourceName) });
  },

  // ========= 渲染 =========
  _renderToday() {
    const goal = this.data.dailyGoal;
    const doc = this._todayDoc || null;
    const dailyGoalText = this.view.goalText(goal, this.theme);
    if (this.data.measure === 'bedtime') {
      this.setData({ dailyGoalText, sleep: V.sleepCard(doc, goal, Date.now()) });
      return;
    }
    const value = doc ? Number(doc.total_value) || 0 : 0;
    const ratio = goal > 0 ? value / goal : 0;
    const pct = Math.round(ratio * 100);
    const p = this._palette;
    const eq = this.data.vocab.equivalent;
    this.setData({
      todayValue: value,
      todayMissing: !doc,
      todayText: M.formatNum(value),
      dailyGoalText,
      pct,
      ring: ringUri(Math.min(100, pct), { color: p.accent, track: p.tint }),
      cheer: this.theme.cheerFor ? this.theme.cheerFor(ratio, value, goal) : '',
      equivalent: eq && value > 0 ? `${eq.label} ${M.equivalentOf(value, eq)} ${eq.unit}` : ''
    });
  },

  _renderSelected() {
    const d = this.data.selected;
    if (!d) return this.setData({ selectedText: '', selectedHas: false });
    const doc = (this._monthDocs || {})[d];
    const text = doc ? this.view.dayText(doc, this.theme) : '无数据';
    this.setData({ selectedText: `${D.formatDateCN(d)} ${D.weekdayCN(d)} · ${text}`, selectedHas: !!doc });
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

  // ========= 授权（werun） =========
  onOpenSetting() {
    wx.openSetting({
      success: res => {
        if (res.authSetting && res.authSetting['scope.werun']) this.sync(true);
      }
    });
  },

  // ========= 每日目标 =========
  onOpenDailySheet() {
    const goal = this.data.dailyGoal;
    const idx = Math.max(0, this.data.bedOptions.findIndex(o => o.value === goal));
    this.setData({ showDailySheet: true, dailyDraft: goal, bedIndex: idx });
  },
  onCloseDailySheet() {
    this.setData({ showDailySheet: false });
  },
  onDailyDraft(e) {
    this.setData({ dailyDraft: e.detail.value });
  },
  onBedGoalPick(e) {
    const idx = Number((e.detail.value || [])[0]) || 0;   // picker-view 回传的是每列下标的数组
    this.setData({ bedIndex: idx, dailyDraft: this.data.bedOptions[idx].value });
  },
  async onSaveDailyGoal() {
    const v = this.data.dailyDraft;
    this.setData({ showDailySheet: false });
    if (v === this.data.dailyGoal) return;
    try {
      await C.callDaily({ action: 'setGoal', theme: this.data.themeId, daily_goal: v });
      this.setData({ dailyGoal: v });
      this._renderToday();
      // 按天数计的累计目标是按当前目标判达标的，目标一改要重算
      if (this.data.goalConfig.mode === 'days' && this.data.deadlineGoal) this.loadOverview();
      toast.show(this, '已保存', { icon: 'success' });
    } catch (err) {
      toast.show(this, '保存失败');
    }
  },
  noop() {},

  // ========= 睡眠记录（manual） =========
  async _saveSleep(date, bedTime, wakeTime) {
    const { value, meta } = T.sleepEntry(bedTime, wakeTime);
    await C.callDaily({ action: 'setDayValue', theme: this.data.themeId, date, value, meta });
    this._trackOnce();
    await Promise.all([this.loadOverview(), this.loadMonth()]);
  },
  async onSleepNow() {
    const night = T.nightOf();
    try {
      await this._saveSleep(night, T.nowClock(), '');
      toast.show(this, '晚安，明早记得点「我起床了」', { icon: 'success' });
    } catch (err) {
      toast.show(this, '记录失败');
    }
  },
  async onWakeNow() {
    const doc = this._todayDoc;
    if (!doc || !doc.meta) return;
    try {
      await this._saveSleep(doc.date, doc.meta.bedTime, T.nowClock());
      toast.show(this, '早安', { icon: 'success' });
    } catch (err) {
      toast.show(this, '记录失败');
    }
  },
  _openEntry(date, doc) {
    const meta = (doc && doc.meta) || {};
    this.setData({
      showEntrySheet: true,
      entry: { date, bedTime: meta.bedTime || '', wakeTime: meta.wakeTime || '', canDelete: !!doc }
    });
  },
  onOpenEntry() {
    this._openEntry(this.data.today, this._todayDoc);
  },
  onEditSelected() {
    const d = this.data.selected;
    if (d) this._openEntry(d, (this._monthDocs || {})[d]);
  },
  onEntryClose() {
    this.setData({ showEntrySheet: false });
  },
  async onEntrySubmit(e) {
    const { date, bedTime, wakeTime } = e.detail;
    wx.showLoading({ title: '保存中' });
    try {
      await this._saveSleep(date, bedTime, wakeTime);
      this.setData({ showEntrySheet: false });
      toast.show(this, '已保存', { icon: 'success' });
    } catch (err) {
      toast.show(this, (err && err.message) || '保存失败');
    } finally {
      wx.hideLoading();
    }
  },
  async onEntryRemove(e) {
    try {
      await C.callDaily({ action: 'clearDay', theme: this.data.themeId, date: e.detail.date });
      this.setData({ showEntrySheet: false });
      await Promise.all([this.loadOverview(), this.loadMonth()]);
      toast.show(this, '已删除', { icon: 'success' });
    } catch (err) {
      toast.show(this, '删除失败');
    }
  },

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
