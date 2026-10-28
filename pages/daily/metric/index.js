// 数值型每日主题首页（?theme=steps | sleep），学每日喝水：一屏一个焦点。
// 日期 ‹ › 翻天 → 主角插画（鞋子 / 月亮，随进度变表情）→ 超大数字 → 一行说明 → 细进度条 → 一行累计目标 → 底部三张卡。
// 月历、柱状图都在「统计」页；每日目标、累计目标在「设置」半屏面板。显示字段由 utils/daily/home.js 算。
// 步数（werun）：先展示库里的数据，再后台同步微信运动，有变化才重拉。睡眠（manual）：底部三张卡就是记录操作。
const toast = require('../../../utils/dailyToast.js');
const { trackDaily } = require('../../../utils/track.js');
const D = require('../../../utils/daily/date.js');
const M = require('../../../utils/daily/metric.js');
const T = require('../../../utils/daily/clock.js');
const V = require('../../../utils/daily/views.js');
const H = require('../../../utils/daily/home.js');
const { shoeSvg, moonSvg } = require('../../../utils/daily/mascots.js');
const { iconUri } = require('../../../utils/daily/icons.js');
const C = require('./common.js');

const RESYNC_MS = 5 * 60 * 1000;
const WINDOW_DAYS = 60;      // 一次拉多少天（getRange 上限 100）
const MAX_DAY_BACK = 400;

Page({
  data: {
    toast: { show: false, text: '', icon: '' },
    themeClass: '',
    statusBarHeight: 20,
    navBarHeight: 48,
    navOffset: 68,

    themeId: 'steps',
    measure: 'count',
    manual: false,
    title: '',
    unit: '',
    vocab: {},
    goalConfig: {},
    today: '',
    loading: true,

    // 当前看的那一天
    viewDate: '',
    isToday: true,
    canPrev: true,
    canNext: false,
    dateTitle: '',
    dateSub: '',
    mascot: '',
    bigText: '—',
    bigUnit: '',
    subText: '',
    extraText: '',
    pct: 0,
    showBar: false,
    cards: [],
    goalLine: { text: '', status: 'none' },

    syncText: '',
    syncing: false,
    authDenied: false,

    dailyGoal: 0,
    deadlineGoal: null,
    goalWalked: 0,

    // 设置面板
    showSettings: false,
    dailyDraft: 0,
    dailyDraftText: '',
    goalMin: 1000,
    goalMax: 30000,
    goalStep: 500,
    bedOptions: [],
    bedIndex: 0,
    heatTop: '',

    showGoalSheet: false,
    sheetGoal: null,
    showEntrySheet: false,
    entry: { date: '', bedTime: '', wakeTime: '', canDelete: false }
  },

  onLoad(options) {
    const theme = C.resolveTheme(options && options.theme);
    this.theme = theme;
    this.view = V.viewOf(theme);
    this._docs = {};
    const today = C.todayOf(theme);
    const ts = C.themeState();
    this._palette = ts.palette;
    const nav = D.getNavMetrics();
    const [gMin, gMax] = theme.goalRange;
    const bedOptions = [];
    if (theme.measure === 'bedtime') {
      for (let v = gMin; v <= gMax; v += theme.goalStep) bedOptions.push({ value: v, label: T.offsetToClock(v) });
    }
    this.setData({
      themeClass: ts.themeClass,
      heatTop: ts.heat[4],
      statusBarHeight: nav.statusBarHeight,
      navBarHeight: nav.navBarHeight,
      navOffset: nav.navOffset,
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
      viewDate: today
    });
    wx.setNavigationBarTitle({ title: theme.title });
    this._render();
    this.reload().then(() => {
      this.setData({ loading: false });
      if (this.theme.source === 'werun') this.sync();
    });
  },

  onShow() {
    if (this.data.loading) return;
    const ts = C.themeState();
    if (ts.themeClass !== this.data.themeClass) {
      this._palette = ts.palette;
      this.setData({ themeClass: ts.themeClass, heatTop: ts.heat[4] });
    }
    // 挂着页面跨过零点（睡眠是跨过中午）：回到新的「今天」
    const today = C.todayOf(this.theme);
    if (today !== this.data.today) {
      this.setData({ today, viewDate: today });
      this.reload();
    } else {
      this._render();     // 睡眠的倒计时、按钮跟着当前时刻变
    }
    if (this.theme.source === 'werun') {
      if (!this._lastSync || Date.now() - this._lastSync > RESYNC_MS) this.sync();
      else this._render();
    }
  },

  onUnload() {
    this._destroyed = true;
  },

  onPullDownRefresh() {
    const done = () => wx.stopPullDownRefresh();
    if (this.theme.source === 'werun') this.sync(true).then(done);
    else this.reload().then(done);
  },

  onShareAppMessage() {
    return { title: `我在标记吧记录${this.data.title}`, path: `/pages/daily/metric/index?theme=${this.data.themeId}` };
  },

  // ========= 数据 =========
  // 设置 + 累计目标进度 + 最近 WINDOW_DAYS 天
  async reload() {
    const { themeId, today } = this.data;
    const from = D.addDays(today, -(WINDOW_DAYS - 1));
    try {
      const [ov, range] = await Promise.all([
        C.callDaily({ action: 'getMetricOverview', theme: themeId, date: today }),
        C.callDaily({ action: 'getRange', theme: themeId, from, to: today })
      ]);
      if (this._destroyed) return;
      const s = ov.settings || {};
      this._docs = Object.assign({}, this._docs, M.toDocMap(range.days));
      // 区间里被删掉的日子（clearDay）要从缓存里去掉
      (range.days || []).forEach(d => { if (M.isMissing(d)) delete this._docs[d.date]; });
      this._from = this._from && this._from < from ? this._from : from;
      this.setData({ dailyGoal: s.daily_goal || this.theme.defaultGoal, deadlineGoal: s.deadlineGoal || null, goalWalked: ov.goalWalked || 0 });
      this._render();
    } catch (err) {
      console.warn('[metric] reload fail', err);
      toast.show(this, '加载失败，下拉重试');
    }
  },

  // 往前翻到窗口外：再往前拉一段
  async _ensureLoaded(date) {
    if (this._from && D.addDays(date, -7) >= this._from) return;
    const to = D.addDays(this._from || this.data.today, -1);
    const from = D.addDays(to, -(WINDOW_DAYS - 1));
    try {
      const r = await C.callDaily({ action: 'getRange', theme: this.data.themeId, from, to });
      if (this._destroyed) return;
      Object.assign(this._docs, M.toDocMap(r.days));
      this._from = from;
    } catch (err) {
      toast.show(this, '加载失败');
    }
  },

  // 外部数据源同步（只有 source=werun 的主题会走到）。force：下拉刷新时即使没有变化也重拉
  async sync(force) {
    if (this._syncing) return;
    this._syncing = true;
    this.setData({ syncing: true });
    this._render();
    const res = await C.syncSource(this.theme);
    this._syncing = false;
    if (this._destroyed) return;
    if (res.ok) {
      this._lastSync = Date.now();
      this._trackOnce();
      this.setData({ syncing: false, authDenied: false });
      if (res.changed || force) await this.reload();
      else this._render();
      return;
    }
    this.setData({ syncing: false, authDenied: !!res.denied });
    if (!res.denied) toast.show(this, `同步${this.data.vocab.sourceName || ''}失败，下拉重试`);
    if (force) await this.reload();
    else this._render();
  },

  _trackOnce() {
    if (this._tracked) return;
    this._tracked = true;
    trackDaily(this.data.themeId, this.route);
  },

  // ========= 渲染 =========
  _render() {
    const { viewDate, today, dailyGoal, measure, vocab } = this.data;
    const p = this._palette;
    const night = measure === 'bedtime';
    const h = night
      ? H.sleepHome(this._docs, viewDate, today, dailyGoal, Date.now())
      : H.stepsHome(this._docs, viewDate, today, dailyGoal, this.theme, this._from || today);
    let dateSub = `${D.formatDateCN(viewDate)} ${D.weekdayCN(viewDate)}`;
    if (this.theme.source === 'werun' && viewDate === today) {
      if (this.data.syncing) dateSub += ` · 正在同步${vocab.sourceName}`;
      else if (this._lastSync) dateSub += ' · ' + C.syncAgoText(this._lastSync, '');
    }
    this.setData({
      isToday: viewDate === today,
      canPrev: D.daysBetween(viewDate, today) < MAX_DAY_BACK,
      canNext: viewDate < today,
      dateTitle: H.dateTitle(viewDate, today, measure),
      dateSub,
      mascot: night ? moonSvg(h.mood, p) : shoeSvg(h.missing ? 0 : h.ratio, p),
      bigText: h.bigText,
      bigUnit: h.bigUnit,
      subText: h.subText,
      extraText: h.extraText,
      pct: h.pct,
      showBar: !night && !h.missing,
      cards: h.cards.map(c => Object.assign({}, c, { iconSrc: iconUri(c.icon, c.disabled ? '#B4B2A9' : p.accent) })),
      goalLine: H.goalLine(this.data.deadlineGoal, this.data.goalWalked, today, this.data.goalConfig)
    });
  },

  // ========= 翻天 =========
  async onPrevDay() {
    if (!this.data.canPrev) return;
    const d = D.addDays(this.data.viewDate, -1);
    await this._ensureLoaded(d);
    this.setData({ viewDate: d });
    this._render();
  },
  onNextDay() {
    if (!this.data.canNext) return;
    this.setData({ viewDate: D.addDays(this.data.viewDate, 1) });
    this._render();
  },
  onBackToToday() {
    this.setData({ viewDate: this.data.today });
    this._render();
  },

  // ========= 导航 =========
  onBack() {
    if (getCurrentPages().length > 1) wx.navigateBack();
    else wx.reLaunch({ url: '/pages/category/category' });
  },
  onOpenStats() {
    wx.navigateTo({ url: `/pages/daily/metric/stats?theme=${this.data.themeId}` });
  },

  // ========= 授权（werun） =========
  onOpenSetting() {
    wx.openSetting({
      success: res => {
        if (res.authSetting && res.authSetting['scope.werun']) this.sync(true);
      }
    });
  },

  // ========= 设置面板：每日目标 + 累计目标 =========
  onOpenSettings() {
    const goal = this.data.dailyGoal;
    const idx = Math.max(0, this.data.bedOptions.findIndex(o => o.value === goal));
    this.setData({ showSettings: true, dailyDraft: goal, dailyDraftText: M.formatNum(goal), bedIndex: idx });
  },
  onCloseSettings() {
    this.setData({ showSettings: false });
  },
  onDailyDraft(e) {
    const v = e.detail.value;
    this.setData({ dailyDraft: v, dailyDraftText: M.formatNum(v) });
  },
  onBedGoalPick(e) {
    const idx = Number((e.detail.value || [])[0]) || 0;   // picker-view 回传的是每列下标的数组
    this.setData({ bedIndex: idx, dailyDraft: this.data.bedOptions[idx].value });
  },
  async onSaveSettings() {
    const v = this.data.dailyDraft;
    this.setData({ showSettings: false });
    if (v === this.data.dailyGoal) return;
    try {
      await C.callDaily({ action: 'setGoal', theme: this.data.themeId, daily_goal: v });
      this.setData({ dailyGoal: v });
      // 按天数计的累计目标按当前目标判达标，目标一改要重算
      if (this.data.goalConfig.mode === 'days' && this.data.deadlineGoal) await this.reload();
      else this._render();
      toast.show(this, '已保存', { icon: 'success' });
    } catch (err) {
      toast.show(this, '保存失败');
    }
  },
  noop() {},

  onGoalLineTap() {
    if (this.data.goalLine.status === 'none') this.setData({ showGoalSheet: true, sheetGoal: null });
    else this.onOpenSettings();
  },

  // ========= 底部卡片 =========
  onCardTap(e) {
    const key = e.currentTarget.dataset.key;
    const card = this.data.cards.find(c => c.key === key);
    if (!card) return;
    if (key === 'sleep') return card.disabled ? toast.show(this, this.data.isToday ? '晚上 6 点后、还没记录时可用' : '只能记录今晚') : this.onSleepNow();
    if (key === 'wake') return card.disabled ? toast.show(this, '记了入睡时间后，早上可用') : this.onWakeNow();
    if (key === 'edit') return this._openEntry(this.data.viewDate);
  },

  // ========= 睡眠记录（manual） =========
  async _saveSleep(date, bedTime, wakeTime) {
    const { value, meta } = T.sleepEntry(bedTime, wakeTime);
    await C.callDaily({ action: 'setDayValue', theme: this.data.themeId, date, value, meta });
    this._trackOnce();
    await this.reload();
  },
  async onSleepNow() {
    try {
      await this._saveSleep(this.data.today, T.nowClock(), '');
      toast.show(this, '晚安，明早记得点「我起床了」', { icon: 'success' });
    } catch (err) {
      toast.show(this, '记录失败');
    }
  },
  async onWakeNow() {
    const doc = this._docs[this.data.today];
    if (!doc || !doc.meta) return;
    try {
      await this._saveSleep(doc.date, doc.meta.bedTime, T.nowClock());
      toast.show(this, '早安', { icon: 'success' });
    } catch (err) {
      toast.show(this, '记录失败');
    }
  },
  _openEntry(date) {
    const doc = this._docs[date];
    const meta = (doc && doc.meta) || {};
    this.setData({
      showEntrySheet: true,
      entry: { date, bedTime: meta.bedTime || '', wakeTime: meta.wakeTime || '', canDelete: !!doc }
    });
  },
  onEntryClose() {
    this.setData({ showEntrySheet: false });
  },
  async onEntrySubmit(e) {
    const { date, bedTime, wakeTime } = e.detail;
    wx.showLoading({ title: '保存中' });
    try {
      await this._saveSleep(date, bedTime, wakeTime);
      this.setData({ showEntrySheet: false, viewDate: date });
      this._render();
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
      delete this._docs[e.detail.date];
      this.setData({ showEntrySheet: false });
      await this.reload();
      toast.show(this, '已删除', { icon: 'success' });
    } catch (err) {
      toast.show(this, '删除失败');
    }
  },

  // ========= 累计目标 =========
  onGoalCreate() {
    this.setData({ showSettings: false, showGoalSheet: true, sheetGoal: null });
  },
  onGoalEdit() {
    this.setData({ showSettings: false, showGoalSheet: true, sheetGoal: this.data.deadlineGoal });
  },
  async onGoalRestart(e) {
    try {
      await C.callDaily({ action: 'endDeadlineGoal', theme: this.data.themeId, status: e.detail.status });
      this.setData({ deadlineGoal: null, goalWalked: 0, showSettings: false, showGoalSheet: true, sheetGoal: null });
      this._render();
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
      await this.reload();
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
      this._render();
    } catch (err) {
      toast.show(this, '操作失败');
    }
  }
});
