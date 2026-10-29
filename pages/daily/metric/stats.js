// 数值型每日主题 · 统计（股票软件的看法：日 / 周 / 月 / 年）
// 一次拉全部记录（getAll，一天一条，量很小），本地聚合成每天 / 每周 / 每月一根（utils/daily/kline.js）；
// 最新一根在最右，左右拖动翻历史，点一下 / 长按拖动选中某一根，表头和汇总跟着它走。
// 图表上方：左边 日 / 周 / 月 / 年，右边设置 —— 画法 柱形 / 折线 / K线（四个周期都能用）、
// 周 / 月 / 年的柱形和折线看「日均」还是「总数」（只有步数有；K线固定画开高低收）、均线开关；都按主题记在本地。
// 年度原来是单独一页（全年热力格），2026-10-28 并进这里的「年」；图下的读图说明和月历也一并去掉了。
// 睡眠画的是入睡时间，取反后越早越往上（红 = 比上一根早）。
// 有进行中的截止日期累计目标时，周期后面多一个「目标」：累计进度图（components/daily/goal-chart，算法在 utils/daily/burnup.js），
// 这时右边的画法 / 均线和「日均 / 总数」一行都用不上，只隐藏、仍占位。
const toast = require('../../../utils/dailyToast.js');
const D = require('../../../utils/daily/date.js');
const M = require('../../../utils/daily/metric.js');
const T = require('../../../utils/daily/clock.js');
const K = require('../../../utils/daily/kline.js');
const V = require('../../../utils/daily/views.js');
const B = require('../../../utils/daily/burnup.js');
const C = require('./common.js');

const PERIODS = {
  day: { label: '日', noun: '天', visible: 30 },
  week: { label: '周', noun: '周', visible: 20 },
  month: { label: '月', noun: '月', visible: 12 },
  year: { label: '年', noun: '年', visible: 6 }
};
const MODES = [{ key: 'bar', label: '柱形' }, { key: 'line', label: '折线' }, { key: 'candle', label: 'K线' }];
const AGGS = [{ key: 'avg', label: '日均' }, { key: 'sum', label: '总数' }];
// 日视图看最近多少天：图表一屏放这么多天，图下的汇总也统计这么多天（以前汇总的是选中那天所在的一周，看着怪）
const RANGES = [{ key: 30, label: '30天' }, { key: 180, label: '180天' }, { key: 365, label: '365天' }];
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
    ranges: RANGES,
    dayRange: 30,
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
    burnup: null,           // 「目标」页签的数据（没有进行中的目标时为 null，页签不出现）
    targetText: '',

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
    this._rangeKey = theme.id + 'DayRange';
    let mode = 'bar', showMA = true, agg = 'avg', dayRange = 30;
    try {
      let m = wx.getStorageSync(this._modeKey);
      if (m === 'box') m = 'candle';            // 10-28 那版叫「箱体」，存的还是 box
      if (MODES.some(x => x.key === m)) mode = m;
      if (wx.getStorageSync(this._maKey) === 'off') showMA = false;
      if (wx.getStorageSync(this._aggKey) === 'sum') agg = 'sum';
      const r = Number(wx.getStorageSync(this._rangeKey));
      if (RANGES.some(x => x.key === r)) dayRange = r;
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
      agg,
      dayRange
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
      const dg = r.settings && r.settings.deadlineGoal;
      const burnup = dg ? B.buildBurnup(dg, this._map, goal, today, (this.theme.deadlineGoal || {}).mode || 'sum', this.theme.measure) : null;
      this._burnup = burnup;
      const keys = Object.keys(PERIODS).concat(burnup ? ['goal'] : []);
      const unit = (this.theme.deadlineGoal || {}).unit || this.theme.unit;
      this.setData({
        periods: keys.map(k => ({ key: k, label: k === 'goal' ? '目标' : PERIODS[k].label })),
        // 函数字段过不了 setData，组件自己按 target / span 算理想值
        burnup: burnup ? Object.assign({}, burnup, { idealAt: null }) : null,
        targetText: burnup ? `目标 ${burnup.mode === 'days' ? burnup.target : M.formatShort(burnup.target)}${unit}` : '',
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
    if (p === 'goal') return this._renderGoal();
    this._candles = K.buildCandles(this._plot || {}, p);
    // 日视图一屏放「近 N 天」；记录还没这么多天时按实有的放（至少 30 格），免得几十根挤在最右边一小条
    const visible = p === 'day' ? Math.min(this.data.dayRange, Math.max(this._candles.length, 30)) : PERIODS[p].visible;
    this.setData({ candles: this._candles, visible });
    this._applyOptions();
  },

  // 设置项一变：图表取哪个数、目标线要不要、表头、图例都跟着变
  _applyOptions() {
    const { period, mode, agg, format } = this.data;
    if (period === 'goal') return;
    const showAgg = period !== 'day' && mode !== 'candle' && format === 'count';
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

  onRange(e) {
    const dayRange = Number(e.currentTarget.dataset.range);
    if (dayRange === this.data.dayRange) return;
    try { wx.setStorageSync(this._rangeKey, dayRange); } catch (err) { /* ignore */ }
    this._sel = -1;
    this.setData({ dayRange });
    this._build();
  },

  onToggleMA() {
    const showMA = !this.data.showMA;
    try { wx.setStorageSync(this._maKey, showMA ? 'on' : 'off'); } catch (err) { /* ignore */ }
    this.setData({ showMA });
  },

  // 「目标」页签：表头 / 汇总看整个目标，选中某一天就看那天为止的累计
  _renderGoal(k) {
    const b = this._burnup;
    if (!b) return;
    const v = B.goalView(b, this.theme, k);
    const pt = k > 0 ? b.points[k] : null;
    this.setData({
      showAgg: false,
      cap: v.cap,
      big: v.big,
      bigUnit: v.bigUnit,
      change: v.change,
      changeColor: v.tone === 'up' ? UP : v.tone === 'down' ? DOWN : '',
      ohlc: v.ohlc,
      note: '',
      sumTitle: v.sumTitle,
      kpi: v.kpi,
      selectedDay: pt ? pt.date : ''
    });
  },

  onGoalSelect(e) {
    this._renderGoal(e.detail.index);
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
      // 日视图和前一天比就写「较昨日」（睡眠是「较昨晚」）；中间断了几天没数据时写出比的是哪天，免得把三天前说成昨日
      const dayVs = prev.from === D.addDays(c.from, -1) ? (clock ? '较昨晚' : '较昨日') : `较 ${D.formatDateCN(prev.from)}`;
      const vs = period === 'day' ? dayVs : `较上一${PERIODS[period].noun}`;
      if (clock) change = Math.round(diff) === 0 ? `${vs} 持平` : `${vs} ${diff > 0 ? '早' : '晚'} ${T.formatDuration(Math.abs(Math.round(diff)))}`;
      else change = valOf(prev) ? `${vs} ${diff >= 0 ? '▲' : '▼'} ${Math.abs(diff / valOf(prev) * 100).toFixed(1)}%` : '';
      changeColor = diff > 0 ? UP : diff < 0 ? DOWN : '';
    }

    // 周 / 月 / 年表头下面一行：K线时是股票的「开 高 低 收」；
    // 柱形 / 折线时是最多、最少，再补上大字没显示的那个（看日均就补累计，看累计就补日均）
    let ohlc = [], note = '';
    if (period === 'day') {
      const doc = this._docs[c.from];
      if (clock) note = doc ? this.view.dayText(doc, this.theme) : '';
      else note = c.main >= goal ? `目标 ${M.formatNum(goal)} · 已达标` : `目标 ${M.formatNum(goal)} · 差 ${M.formatNum(goal - c.main)}`;
    } else if (this.data.mode === 'candle') {
      ohlc = [{ k: '开', v: this._fmt(c.open) }, { k: clock ? '早' : '高', v: this._fmt(c.high) }, { k: clock ? '晚' : '低', v: this._fmt(c.low) }, { k: '收', v: this._fmt(c.close) }];
    } else {
      ohlc = [{ k: clock ? '最早' : '最多', v: this._fmt(c.high) }, { k: clock ? '最晚' : '最少', v: this._fmt(c.low) }];
      if (!clock) ohlc.push(useSum ? { k: '日均', v: this._fmt(c.main) } : { k: '累计', v: M.formatShort(c.sum) });
    }

    // 汇总：日 看「近 N 天」（到今天，不随选中的那天变），周 / 月 / 年 看这一根本身
    const today = this.data.today;
    const range = period === 'day' ? { from: D.addDays(today, 1 - this.data.dayRange), to: today } : { from: c.from, to: c.to };
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
      sumTitle: (period === 'day' ? `近 ${this.data.dayRange} 天（${D.formatDateCN(range.from)} - ${D.formatDateCN(range.to)}）` : this._periodLabel(c)) + ' 汇总',
      kpi: sv.kpi,
      selectedDay: period === 'day' ? c.from : ''
    });
  },

  onGoShare() {
    const date = this.data.selectedDay || this.data.today;
    wx.navigateTo({ url: `/pages/daily/metric/share?theme=${this.data.themeId}&date=${date}` });
  }
});
