// 数值型每日主题 · 统计（股票软件的看法：日K / 周K / 月K）
// 一次拉全部记录（getAll，一天一条，量很小），本地聚合成蜡烛；最新一根在最右，左右拖动翻历史，
// 点一下 / 长按拖动选中某一根，表头、汇总、月历都跟着它走。蜡烛和折线可切换，选择按主题记在本地。
// K 线的含义见 utils/daily/kline.js；睡眠画的是入睡时间，取反后越早越往上（红 = 比上一根早）。
const toast = require('../../../utils/dailyToast.js');
const D = require('../../../utils/daily/date.js');
const M = require('../../../utils/daily/metric.js');
const T = require('../../../utils/daily/clock.js');
const K = require('../../../utils/daily/kline.js');
const V = require('../../../utils/daily/views.js');
const C = require('./common.js');

const PERIODS = { day: { label: '日K', visible: 30 }, week: { label: '周K', visible: 20 }, month: { label: '月K', visible: 12 } };
const UP = '#E25A4E';
const DOWN = '#3A9F6E';

Page({
  data: {
    toast: { show: false, text: '', icon: '' },
    themeClass: '',
    heat: [],
    accent: '#526631',
    themeId: 'steps',
    title: '',
    measure: 'count',
    today: '',
    loading: true,
    empty: false,

    period: 'day',
    periods: Object.keys(PERIODS).map(k => ({ key: k, label: PERIODS[k].label })),
    mode: 'candle',
    candles: [],
    visible: 30,
    goal: 0,
    goalPlot: 0,
    goalText: '',
    format: 'count',

    // 表头（选中的那一根，没选就是最新一根）
    cap: '',
    big: '—',
    bigUnit: '',
    change: '',
    changeColor: '',
    ohlc: [],
    note: '',

    // 汇总 + 月历
    sumTitle: '',
    kpi: [],
    calYear: 2026,
    calMonth: 1,
    monthDays: [],
    selectedDay: '',
    selectedText: ''
  },

  onLoad(options) {
    const theme = C.resolveTheme(options && options.theme);
    this.theme = theme;
    this.view = V.viewOf(theme);
    const ts = C.themeState();
    this._modeKey = theme.id + 'ChartType';
    let mode = 'candle';
    try { if (wx.getStorageSync(this._modeKey) === 'line') mode = 'line'; } catch (e) { /* ignore */ }
    const clock = theme.measure === 'bedtime';
    this.setData({
      themeClass: ts.themeClass,
      heat: ts.heat,
      accent: ts.palette.accent,
      themeId: theme.id,
      title: theme.title + '统计',
      measure: theme.measure || 'count',
      format: clock ? 'clock' : 'count',
      today: C.todayOf(theme),
      mode
    });
    this.fetch();
  },

  onUnload() {
    this._destroyed = true;
  },

  async fetch() {
    try {
      const r = await C.callDaily({ action: 'getAll', theme: this.data.themeId });
      if (this._destroyed) return;
      const goal = (r.settings && r.settings.daily_goal) || this.theme.defaultGoal;
      const clock = this.data.format === 'clock';
      const today = this.data.today;
      const days = (r.days || []).filter(d => d.date <= today);
      this._docs = M.toDocMap(days);
      this._map = M.toDayMap(days, this.theme.measure);
      // 绘图值：睡眠取反，越早越大
      this._plot = {};
      Object.keys(this._map).forEach(d => { this._plot[d] = clock ? -this._map[d] : this._map[d]; });
      this._allDays = days;
      this.setData({
        goal,
        goalPlot: clock ? -goal : goal,
        goalText: '目标 ' + (clock ? T.offsetToClock(goal) : M.formatShort(goal)),
        empty: !Object.keys(this._map).length,
        loading: false
      });
      this._build();
    } catch (err) {
      console.warn('[metric stats] fetch fail', err);
      this.setData({ loading: false });
      toast.show(this, '加载失败');
    }
  },

  _build() {
    const p = this.data.period;
    this._candles = K.buildCandles(this._plot || {}, p);
    this.setData({ candles: this._candles, visible: PERIODS[p].visible });
    this._renderFor(this._candles.length - 1);
  },

  onPeriod(e) {
    const period = e.currentTarget.dataset.key;
    if (period === this.data.period) return;
    this.setData({ period });
    this._build();
  },

  onMode(e) {
    const mode = e.currentTarget.dataset.mode;
    if (mode === this.data.mode) return;
    try { wx.setStorageSync(this._modeKey, mode); } catch (err) { /* ignore */ }
    this.setData({ mode });
  },

  onSelect(e) {
    const i = e.detail.index;
    this._renderFor(i >= 0 ? i : this._candles.length - 1);
  },

  // ───────── 表头 / 汇总 / 月历 跟着第 i 根走 ─────────
  _periodLabel(c) {
    if (!c) return '';
    if (this.data.period === 'day') return `${D.formatDateCN(c.from)} ${D.weekdayCN(c.from)}`;
    if (this.data.period === 'week') return `${D.formatDateCN(c.from)} - ${D.formatDateCN(c.to)}`;
    return D.formatMonthLabel(Number(c.key.slice(0, 4)), Number(c.key.slice(5, 7)));
  },

  _fmt(v) {
    return this.data.format === 'clock' ? T.offsetToClock(-v) : M.formatNum(Math.round(v));
  },

  _renderFor(i) {
    const c = this._candles[i];
    if (!c) return this.setData({ cap: '', big: '—', change: '', ohlc: [], kpi: [], monthDays: [] });
    const { period, format, goal } = this.data;
    const clock = format === 'clock';
    const prev = this._candles[i - 1];

    // 涨跌：步数按百分比，睡眠按早 / 晚了几分钟；红 = 好（多走了 / 睡早了）
    let change = '', changeColor = '';
    if (prev) {
      const diff = c.main - prev.main;
      const vs = period === 'day' ? `较 ${D.formatDateCN(prev.from)}` : period === 'week' ? '较上一周' : '较上一月';
      if (clock) change = Math.round(diff) === 0 ? `${vs} 持平` : `${vs} ${diff > 0 ? '早' : '晚'} ${T.formatDuration(Math.abs(Math.round(diff)))}`;
      else change = `${vs} ${diff >= 0 ? '▲' : '▼'} ${Math.abs(K.changePct(this._candles, i)).toFixed(1)}%`;
      changeColor = diff > 0 ? UP : diff < 0 ? DOWN : '';
    }

    let ohlc = [], note = '';
    if (period === 'day') {
      const doc = this._docs[c.from];
      if (clock) note = doc ? this.view.dayText(doc, this.theme) : '';
      else note = c.main >= goal ? `目标 ${M.formatNum(goal)} · 已达标` : `目标 ${M.formatNum(goal)} · 差 ${M.formatNum(goal - c.main)}`;
    } else {
      ohlc = [
        { k: '开', v: this._fmt(c.open) }, { k: '收', v: this._fmt(c.close) },
        { k: '高', v: this._fmt(c.high) }, { k: '低', v: this._fmt(c.low) }
      ];
      note = `${c.count} 天有记录`;
    }

    // 汇总：日K 看所在的那一周，周K / 月K 看这一根本身
    const range = period === 'day' ? D.weekRange(c.from, 0) : { from: c.from, to: c.to };
    const s = M.summarize(this._map, range.from, range.to, goal, this.data.today, this.theme.measure);
    const docs = {};
    Object.keys(this._docs).forEach(d => { if (d >= range.from && d <= range.to && d in this._map) docs[d] = this._docs[d]; });
    const sv = this.view.stats(s, docs, this.theme, goal, '');

    // 月历：这一根最后一天所在的月
    const y = Number(c.to.slice(0, 4)), m = Number(c.to.slice(5, 7));
    const mr = D.monthRange(y, m);
    const monthDays = (this._allDays || []).filter(d => d.date >= mr.from && d.date <= mr.to);

    this.setData({
      cap: this._periodLabel(c) + (period === 'day' ? '' : (clock ? ' · 平均入睡' : ' · 日均')),
      big: this._fmt(c.main),
      bigUnit: clock ? (period === 'day' ? '入睡' : '') : this.theme.unit,
      change,
      changeColor,
      ohlc,
      note,
      sumTitle: (period === 'day' ? `${D.formatDateCN(range.from)} - ${D.formatDateCN(range.to)}` : this._periodLabel(c)) + ' 汇总',
      kpi: sv.kpi,
      calYear: y,
      calMonth: m,
      monthDays,
      selectedDay: period === 'day' ? c.from : '',
      selectedText: ''
    });
  },

  onSelectDay(e) {
    const d = e.detail.date;
    const doc = (this._docs || {})[d];
    this.setData({ selectedDay: d, selectedText: `${D.formatDateCN(d)} ${D.weekdayCN(d)} · ${doc ? this.view.dayText(doc, this.theme) : '无数据'}` });
  },

  onGoYear() {
    wx.navigateTo({ url: `/pages/daily/metric/year?theme=${this.data.themeId}&year=${this.data.calYear}` });
  },
  onGoShare() {
    const date = this.data.selectedDay || this.data.today;
    wx.navigateTo({ url: `/pages/daily/metric/share?theme=${this.data.themeId}&date=${date}` });
  }
});
