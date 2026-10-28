// 数值型每日主题 · 统计（周 / 月 / 年，可前后翻）
// 柱子颜色与月历同一套热力分档；无数据的日子不画柱、不进日均分母。
const toast = require('../../../utils/dailyToast.js');
const D = require('../../../utils/daily/date.js');
const M = require('../../../utils/daily/metric.js');
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
    headlineSub: '',
    bars: [],
    goalLine: 0,
    showGoalLine: false,
    kpi: [],
    empty: false
  },

  onLoad(options) {
    const theme = C.resolveTheme(options && options.theme);
    this.theme = theme;
    const ts = C.themeState();
    this.setData({
      themeClass: ts.themeClass,
      heat: ts.heat,
      themeId: theme.id,
      title: theme.title + '统计',
      unit: theme.unit,
      today: D.todayStr()
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
      this._render(p, M.toDayMap(r.days), goal);
    } catch (err) {
      if (seq !== this._seq) return;
      console.warn('[metric stats] fetch fail', err);
      toast.show(this, '加载失败');
    }
    this.setData({ loading: false });
  },

  _render(p, map, goal) {
    const { range, today, unit, heat } = this.data;
    const s = M.summarize(map, p.from, p.to, goal, today);
    const eq = this.theme.vocab.equivalent;

    let items;
    if (range === 'year') {
      // 年：12 根柱 = 每月日均（只算有数据的日子）
      items = [];
      for (let m = 1; m <= 12; m++) {
        const r = D.monthRange(p.year, m);
        const ms = M.summarize(map, r.from, r.to, goal, today);
        items.push({ key: 'm' + m, label: m % 3 === 1 ? m + '月' : '', value: ms.avg, has: ms.dataDays > 0, future: r.from > today });
      }
    } else {
      items = [];
      for (let d = p.from, i = 0; d <= p.to; d = D.addDays(d, 1), i++) {
        const day = Number(d.slice(8));
        const label = range === 'week' ? D.WD_MON[i] : (day === 1 || day % 7 === 1 ? String(day) : '');
        items.push({ key: d, label, value: map[d] || 0, has: d in map && d <= today, future: d > today });
      }
    }
    const max = Math.max(goal, ...items.map(it => it.value)) || 1;
    const bars = items.map(it => {
      const level = M.heatLevel(it.value, goal, it.has);
      return {
        key: it.key,
        label: it.label,
        missing: !it.has,
        future: !!it.future,
        h: it.has ? Math.max(2, Math.round(it.value / max * 100)) : 0,
        color: level >= 0 ? heat[level] : ''
      };
    });

    const best = s.best ? `${M.formatShort(s.best.value)}` : '—';
    this.setData({
      empty: s.dataDays === 0,
      headlineCap: (p.cap || '') + this.theme.vocab.avgLabel,
      headline: M.formatNum(s.avg),
      headlineSub: `累计 ${M.formatNum(s.total)} ${unit} · 有数据 ${s.dataDays} 天`,
      bars,
      goalLine: Math.round(goal / max * 100),
      showGoalLine: s.dataDays > 0,
      kpi: [
        { label: '达标天数', value: s.achieved, unit: `/ ${s.dataDays} 天`, sub: `每日目标 ${M.formatNum(goal)} ${unit}` },
        { label: this.theme.vocab.bestLabel, value: best, unit, sub: s.best ? D.formatDateCN(s.best.date) : '' },
        { label: '最长连续达标', value: s.longestStreak, unit: '天', sub: '' },
        { label: this.theme.vocab.totalLabel, value: M.formatShort(s.total), unit, sub: eq ? `${eq.label} ${M.equivalentOf(s.total, eq)} ${eq.unit}` : '' }
      ]
    });
  }
});
