// 数值型每日主题 · 统计（周 / 月 / 年，可前后翻）
// 柱子颜色与月历同一套热力分档；无数据的日子不画柱、不进日均分母。
// 显示哪个数、KPI 是哪几项由度量决定（utils/daily/views.js）：步数柱高 = 步数，睡眠柱高 = 时长、颜色 = 入睡早晚。
const toast = require('../../../utils/dailyToast.js');
const D = require('../../../utils/daily/date.js');
const M = require('../../../utils/daily/metric.js');
const V = require('../../../utils/daily/views.js');
const C = require('./common.js');

const MAX_BACK = { week: 52, month: 36, year: 10 };

Page({
  data: {
    toast: { show: false, text: '', icon: '' },
    themeClass: '',
    heat: [],
    themeId: 'steps',
    title: '',
    unit: '',
    today: '',
    range: 'week',
    offset: 0,
    canPrev: true,
    canNext: false,
    loading: true,

    periodLabel: '',
    headlineCap: '',
    headline: '0',
    headlineUnit: '',
    headlineSub: '',
    chartNote: '',
    bars: [],
    goalLine: 0,
    showGoalLine: false,
    kpi: [],
    empty: false
  },

  onLoad(options) {
    const theme = C.resolveTheme(options && options.theme);
    this.theme = theme;
    this.view = V.viewOf(theme);
    const ts = C.themeState();
    this.setData({
      themeClass: ts.themeClass,
      heat: ts.heat,
      themeId: theme.id,
      title: theme.title + '统计',
      unit: theme.unit,
      today: C.todayOf(theme)
    });
    this.fetch();
  },

  onUnload() {
    this._destroyed = true;
  },

  onRange(e) {
    const range = e.currentTarget.dataset.range;
    if (range === this.data.range) return;
    this.setData({ range, offset: 0 });
    this.fetch();
  },
  onPrev() {
    if (!this.data.canPrev) return;
    this.setData({ offset: this.data.offset - 1 });
    this.fetch();
  },
  onNext() {
    if (!this.data.canNext) return;
    this.setData({ offset: this.data.offset + 1 });
    this.fetch();
  },

  _period() {
    const { range, offset, today } = this.data;
    if (range === 'week') {
      const w = D.weekRange(today, offset);
      return Object.assign(w, { label: D.formatWeekLabel(w.from, w.to), cap: offset === 0 ? '本周' : offset === -1 ? '上周' : '' });
    }
    if (range === 'month') {
      const n = D.addMonths(Number(today.slice(0, 4)), Number(today.slice(5, 7)), offset);
      const r = D.monthRange(n.year, n.month);
      return Object.assign(r, { label: D.formatMonthLabel(n.year, n.month), cap: offset === 0 ? '本月' : offset === -1 ? '上月' : '' });
    }
    const y = Number(today.slice(0, 4)) + offset;
    return { year: y, from: `${y}-01-01`, to: `${y}-12-31`, label: `${y}年`, cap: offset === 0 ? '今年' : '' };
  },

  async fetch() {
    const p = this._period();
    const { range, offset, themeId } = this.data;
    this.setData({
      loading: true,
      periodLabel: p.label,
      canPrev: offset > -MAX_BACK[range],
      canNext: offset < 0
    });
    const seq = (this._seq || 0) + 1;
    this._seq = seq;
    try {
      const r = range === 'year'
        ? await C.callDaily({ action: 'getYear', theme: themeId, year: p.year })
        : await C.callDaily({ action: 'getRange', theme: themeId, from: p.from, to: p.to });
      if (this._destroyed || seq !== this._seq) return;
      const goal = (r.settings && r.settings.daily_goal) || this.theme.defaultGoal;
      this._render(p, r.days, goal);
    } catch (err) {
      if (seq !== this._seq) return;
      console.warn('[metric stats] fetch fail', err);
      toast.show(this, '加载失败');
    }
    this.setData({ loading: false });
  },

  _render(p, days, goal) {
    const { range, today, heat } = this.data;
    const measure = this.theme.measure;
    const view = this.view;
    const map = M.toDayMap(days, measure);
    const allDocs = M.toDocMap(days);
    const docsIn = (from, to) => {
      const out = {};
      Object.keys(allDocs).forEach(d => { if (d >= from && d <= to && d <= today && d in map) out[d] = allDocs[d]; });
      return out;
    };
    const s = M.summarize(map, p.from, p.to, goal, today, measure);

    let items;
    if (range === 'year') {
      // 年：12 根柱 = 每月平均（只算有数据的日子），颜色按当月平均的度量值分档
      items = [];
      for (let m = 1; m <= 12; m++) {
        const r = D.monthRange(p.year, m);
        const ms = M.summarize(map, r.from, r.to, goal, today, measure);
        const docs = Object.values(docsIn(r.from, r.to));
        const avgBar = docs.length ? Math.round(docs.reduce((a, doc) => a + view.barValueOf(doc), 0) / docs.length) : 0;
        items.push({ key: 'm' + m, label: m % 3 === 1 ? m + '月' : '', value: avgBar, judged: ms.avg, has: ms.dataDays > 0, future: r.from > today });
      }
    } else {
      items = [];
      for (let d = p.from, i = 0; d <= p.to; d = D.addDays(d, 1), i++) {
        const day = Number(d.slice(8));
        const label = range === 'week' ? D.WD_MON[i] : (day === 1 || day % 7 === 1 ? String(day) : '');
        const has = d in map && d <= today;
        items.push({ key: d, label, value: has ? view.barValueOf(allDocs[d]) : 0, judged: map[d], has, future: d > today });
      }
    }
    // 数量型的柱子要和目标线同一把尺；睡眠的柱子是时长，至少按 8 小时撑满
    const floor = view.showGoalLine ? goal : 480;
    const max = Math.max(floor, ...items.map(it => it.value)) || 1;
    const bars = items.map(it => {
      const level = M.heatLevel(it.judged, goal, it.has, measure);
      return {
        key: it.key,
        label: it.label,
        missing: !it.has,
        future: !!it.future,
        h: it.has ? Math.max(2, Math.round(it.value / max * 100)) : 0,
        color: level >= 0 ? heat[level] : ''
      };
    });

    const sv = view.stats(s, docsIn(p.from, p.to), this.theme, goal, p.cap);
    this.setData({
      empty: s.dataDays === 0,
      headlineCap: sv.headlineCap,
      headline: sv.headline,
      headlineUnit: sv.headlineUnit,
      headlineSub: sv.headlineSub,
      chartNote: view.chartNote,
      bars,
      goalLine: Math.round(goal / max * 100),
      showGoalLine: view.showGoalLine && s.dataDays > 0,
      kpi: sv.kpi
    });
  }
});
