// 数值型每日主题 · 统计（股票软件的看法：日 / 周 / 月）
// 一次拉全部记录（getAll，一天一条，量很小），本地聚合成蜡烛；最新一根在最右，左右拖动翻历史，
// 点一下 / 长按拖动选中某一根，表头、汇总、月历都跟着它走。
// 日 = 短柱（达标深色）；周 / 月 = 箱体（含义见 utils/daily/kline.js，图下有图例说明）；都能切折线、开关均线，按主题记在本地。
// 睡眠画的是入睡时间，取反后越早越往上（红 = 比上一根早）。
const toast = require('../../../utils/dailyToast.js');
const D = require('../../../utils/daily/date.js');
const M = require('../../../utils/daily/metric.js');
const T = require('../../../utils/daily/clock.js');
const K = require('../../../utils/daily/kline.js');
const V = require('../../../utils/daily/views.js');
const C = require('./common.js');

const PERIODS = { day: { label: '日', noun: '天', visible: 30 }, week: { label: '周', noun: '周', visible: 20 }, month: { label: '月', noun: '月', visible: 12 } };
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
    showMA: true,
    legend: null,
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
    this._maKey = theme.id + 'ShowMA';
    let mode = 'candle', showMA = true;
    try {
      if (wx.getStorageSync(this._modeKey) === 'line') mode = 'line';
      if (wx.getStorageSync(this._maKey) === 'off') showMA = false;
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
      showMA
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
    this._renderLegend();
  },

  // 图下的读图说明：日看柱子、周 / 月看箱体、折线看曲线，均线开着再补一句
  _renderLegend() {
    const { period, mode, showMA, format } = this.data;
    const clock = format === 'clock';
    const noun = PERIODS[period].noun;
    let legend;
    if (mode === 'line') {
      legend = { kind: 'text', text: period === 'day' ? `曲线 = 每天的${clock ? '入睡时间，越高越早' : '步数'}` : `曲线 = 每${noun}的${clock ? '平均入睡，越高越早' : '日均步数'}` };
    } else if (period === 'day') {
      legend = { kind: 'text', text: clock ? '柱子越高睡得越早；深色 = 早睡达标，浅色 = 没达标' : '柱高 = 当天步数；深色 = 达标，浅色 = 没达标' };
    } else {
      legend = {
        kind: 'box',
        rows: [
          { k: '竖线上端', v: clock ? `这${noun}入睡最早的一晚` : `这${noun}走得最多的一天` },
          { k: '竖线下端', v: clock ? `这${noun}入睡最晚的一晚` : `这${noun}走得最少的一天` },
          { k: '方块', v: clock ? '从第一晚连到最后一晚' : '从第一天连到最后一天' },
          { k: '红 / 绿', v: clock ? '最后一晚比第一晚睡得早 / 晚' : '最后一天比第一天走得多 / 少' }
        ]
      };
    }
    legend.ma = showMA ? `均线：MA5 / MA10 = 最近 5 / 10 ${noun}的平均` : '';
    this.setData({ legend });
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
    this._renderLegend();
  },

  onToggleMA() {
    const showMA = !this.data.showMA;
    try { wx.setStorageSync(this._maKey, showMA ? 'on' : 'off'); } catch (err) { /* ignore */ }
    this.setData({ showMA });
    this._renderLegend();
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
      // 不用「开收高低」这类股票术语，直接说是哪一天
      ohlc = [
        { k: clock ? '最早' : '最多', v: this._fmt(c.high) }, { k: clock ? '最晚' : '最少', v: this._fmt(c.low) },
        { k: '首日', v: this._fmt(c.open) }, { k: '末日', v: this._fmt(c.close) }
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
