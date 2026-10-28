// 数值型每日主题 · 统计（股票软件的看法：日 / 周 / 月 / 年）
// 一次拉全部记录（getAll，一天一条，量很小），本地聚合成每天 / 每周 / 每月一根（utils/daily/kline.js）；
// 最新一根在最右，左右拖动翻历史，点一下 / 长按拖动选中某一根，表头和汇总跟着它走。
// 图表上方：左边 日 / 周 / 月 / 年，右边设置 —— 画法 柱形 / 折线 / 箱体（四个周期都能用）、
// 周 / 月 / 年的柱形和折线看「日均」还是「总数」（只有步数有；箱体固定看平均和高低）、均线开关；都按主题记在本地。
// 年度原来是单独一页（全年热力格），2026-10-28 并进这里的「年」；图下的读图说明和月历也一并去掉了。
// 睡眠画的是入睡时间，取反后越早越往上（红 = 比上一根早）。
const toast = require('../../../utils/dailyToast.js');
const D = require('../../../utils/daily/date.js');
const M = require('../../../utils/daily/metric.js');
const T = require('../../../utils/daily/clock.js');
const K = require('../../../utils/daily/kline.js');
const V = require('../../../utils/daily/views.js');
const C = require('./common.js');

const PERIODS = {
  day: { label: '日', noun: '天', visible: 30 },
  week: { label: '周', noun: '周', visible: 20 },
  month: { label: '月', noun: '月', visible: 12 },
  year: { label: '年', noun: '年', visible: 6 }
};
const MODES = [{ key: 'bar', label: '柱形' }, { key: 'line', label: '折线' }, { key: 'box', label: '箱体' }];
const AGGS = [{ key: 'avg', label: '日均' }, { key: 'sum', label: '总数' }];
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
    modes: MODES,
    aggs: AGGS,
    mode: 'bar',
    agg: 'avg',
    showAgg: false,         // 周 / 月 / 年 + 柱形或折线 + 步数 才出现
    chartValue: 'main',     // 传给图表：main（平均）| sum（总数）
    showMA: true,
    candles: [],
    visible: 30,
    goal: 0,
    goalPlot: 0,
    goalText: '',
    showGoal: true,
    format: 'count',

    // 表头（选中的那一根，没选就是最新一根）
    cap: '',
    big: '—',
    bigUnit: '',
    change: '',
    changeColor: '',
    ohlc: [],
    note: '',

    // 汇总
    sumTitle: '',
    kpi: [],
    selectedDay: ''
  },

  onLoad(options) {
    const theme = C.resolveTheme(options && options.theme);
    this.theme = theme;
    this.view = V.viewOf(theme);
    const ts = C.themeState();
    this._modeKey = theme.id + 'ChartType';
    this._maKey = theme.id + 'ShowMA';
    this._aggKey = theme.id + 'ChartAgg';
    let mode = 'bar', showMA = true, agg = 'avg';
    try {
      const m = wx.getStorageSync(this._modeKey);
      if (MODES.some(x => x.key === m)) mode = m;
      if (wx.getStorageSync(this._maKey) === 'off') showMA = false;
      if (wx.getStorageSync(this._aggKey) === 'sum') agg = 'sum';
    } catch (e) { /* ignore */ }
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
      mode,
      showMA,
      agg
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
    this._applyOptions();
  },

  // 设置项一变：图表取哪个数、目标线要不要、表头、图例都跟着变
  _applyOptions() {
    const { period, mode, agg, format } = this.data;
    const showAgg = period !== 'day' && mode !== 'box' && format === 'count';
    const useSum = showAgg && agg === 'sum';
    this.setData({
      showAgg,
      chartValue: useSum ? 'sum' : 'main',
      // 看总数时每日目标线没有可比性，不画
      showGoal: !useSum
    });
    this._renderFor(this._sel != null && this._sel >= 0 ? this._sel : this._candles.length - 1);
  },

  onPeriod(e) {
    const period = e.currentTarget.dataset.key;
    if (period === this.data.period) return;
    this._sel = -1;
    this.setData({ period });
    this._build();
  },

  onMode(e) {
    const mode = e.currentTarget.dataset.mode;
    if (mode === this.data.mode) return;
    try { wx.setStorageSync(this._modeKey, mode); } catch (err) { /* ignore */ }
    this.setData({ mode });
    this._applyOptions();
  },

  onAgg(e) {
    const agg = e.currentTarget.dataset.agg;
    if (agg === this.data.agg) return;
    try { wx.setStorageSync(this._aggKey, agg); } catch (err) { /* ignore */ }
    this.setData({ agg });
    this._applyOptions();
  },

  onToggleMA() {
    const showMA = !this.data.showMA;
    try { wx.setStorageSync(this._maKey, showMA ? 'on' : 'off'); } catch (err) { /* ignore */ }
    this.setData({ showMA });
  },

  onSelect(e) {
    const i = e.detail.index;
    this._sel = i;
    this._renderFor(i >= 0 ? i : this._candles.length - 1);
  },

  // ───────── 表头 / 汇总 / 月历 跟着第 i 根走 ─────────
  _periodLabel(c) {
    if (!c) return '';
    if (this.data.period === 'day') return `${D.formatDateCN(c.from)} ${D.weekdayCN(c.from)}`;
    if (this.data.period === 'week') return `${D.formatDateCN(c.from)} - ${D.formatDateCN(c.to)}`;
    if (this.data.period === 'year') return `${c.key}年`;
    return D.formatMonthLabel(Number(c.key.slice(0, 4)), Number(c.key.slice(5, 7)));
  },

  _fmt(v) {
    return this.data.format === 'clock' ? T.offsetToClock(-v) : M.formatNum(Math.round(v));
  },

  _renderFor(i) {
    const c = this._candles[i];
    if (!c) return this.setData({ cap: '', big: '—', change: '', ohlc: [], kpi: [] });
    const { period, format, goal, chartValue } = this.data;
    const clock = format === 'clock';
    const useSum = chartValue === 'sum';
    const valOf = x => (useSum ? x.sum : x.main);
    const prev = this._candles[i - 1];

    // 涨跌：步数按百分比，睡眠按早 / 晚了几分钟；红 = 好（多走了 / 睡早了）
    let change = '', changeColor = '';
    if (prev) {
      const diff = valOf(c) - valOf(prev);
      const vs = period === 'day' ? `较 ${D.formatDateCN(prev.from)}` : `较上一${PERIODS[period].noun}`;
      if (clock) change = Math.round(diff) === 0 ? `${vs} 持平` : `${vs} ${diff > 0 ? '早' : '晚'} ${T.formatDuration(Math.abs(Math.round(diff)))}`;
      else change = valOf(prev) ? `${vs} ${diff >= 0 ? '▲' : '▼'} ${Math.abs(diff / valOf(prev) * 100).toFixed(1)}%` : '';
      changeColor = diff > 0 ? UP : diff < 0 ? DOWN : '';
    }

    // 周 / 月表头下面一行：最多、最少，再补上大字没显示的那个（看日均就补累计，看累计就补日均）
    let ohlc = [], note = '';
    if (period === 'day') {
      const doc = this._docs[c.from];
      if (clock) note = doc ? this.view.dayText(doc, this.theme) : '';
      else note = c.main >= goal ? `目标 ${M.formatNum(goal)} · 已达标` : `目标 ${M.formatNum(goal)} · 差 ${M.formatNum(goal - c.main)}`;
    } else {
      ohlc = [{ k: clock ? '最早' : '最多', v: this._fmt(c.high) }, { k: clock ? '最晚' : '最少', v: this._fmt(c.low) }];
      if (!clock) ohlc.push(useSum ? { k: '日均', v: this._fmt(c.main) } : { k: '累计', v: M.formatShort(c.sum) });
    }

    // 汇总：日 看所在的那一周，周 / 月 / 年 看这一根本身
    const range = period === 'day' ? D.weekRange(c.from, 0) : { from: c.from, to: c.to };
    const s = M.summarize(this._map, range.from, range.to, goal, this.data.today, this.theme.measure);
    const docs = {};
    Object.keys(this._docs).forEach(d => { if (d >= range.from && d <= range.to && d in this._map) docs[d] = this._docs[d]; });
    const sv = this.view.stats(s, docs, this.theme, goal, '');

    this.setData({
      cap: this._periodLabel(c) + (period === 'day' ? '' : clock ? ' · 平均入睡' : useSum ? ' · 累计' : ' · 日均'),
      big: this._fmt(valOf(c)),
      bigUnit: clock ? (period === 'day' ? '入睡' : '') : this.theme.unit,
      change,
      changeColor,
      ohlc,
      note,
      sumTitle: (period === 'day' ? `${D.formatDateCN(range.from)} - ${D.formatDateCN(range.to)}` : this._periodLabel(c)) + ' 汇总',
      kpi: sv.kpi,
      selectedDay: period === 'day' ? c.from : ''
    });
  },

  onGoShare() {
    const date = this.data.selectedDay || this.data.today;
    wx.navigateTo({ url: `/pages/daily/metric/share?theme=${this.data.themeId}&date=${date}` });
  }
});
