// 数值型每日主题 · 年度视图：全年热力格 + 年度汇总
const toast = require('../../../utils/dailyToast.js');
const D = require('../../../utils/daily/date.js');
const M = require('../../../utils/daily/metric.js');
const C = require('./common.js');

const MIN_YEAR = 2015;

Page({
  data: {
    toast: { show: false, text: '', icon: '' },
    themeClass: '',
    heat: [],
    themeId: 'steps',
    title: '',
    unit: '',
    today: '',
    year: 2026,
    canPrev: true,
    canNext: false,
    loading: true,
    days: [],
    goal: 0,
    kpi: [],
    totalText: '0',
    eqText: ''
  },

  onLoad(options) {
    const theme = C.resolveTheme(options && options.theme);
    this.theme = theme;
    const ts = C.themeState();
    const today = D.todayStr();
    const thisYear = Number(today.slice(0, 4));
    const year = Math.min(thisYear, Math.max(MIN_YEAR, Number(options && options.year) || thisYear));
    this.setData({
      themeClass: ts.themeClass,
      heat: ts.heat,
      themeId: theme.id,
      title: theme.title + '年度',
      unit: theme.unit,
      today,
      year,
      goal: theme.defaultGoal
    });
    this.fetch();
  },

  onUnload() {
    this._destroyed = true;
  },

  onPrev() {
    if (!this.data.canPrev) return;
    this.setData({ year: this.data.year - 1 });
    this.fetch();
  },
  onNext() {
    if (!this.data.canNext) return;
    this.setData({ year: this.data.year + 1 });
    this.fetch();
  },

  async fetch() {
    const { year, themeId, today } = this.data;
    this.setData({ loading: true, canPrev: year > MIN_YEAR, canNext: year < Number(today.slice(0, 4)) });
    const seq = (this._seq || 0) + 1;
    this._seq = seq;
    try {
      const r = await C.callDaily({ action: 'getYear', theme: themeId, year });
      if (this._destroyed || seq !== this._seq) return;
      const goal = (r.settings && r.settings.daily_goal) || this.theme.defaultGoal;
      const s = M.summarize(M.toDayMap(r.days), `${year}-01-01`, `${year}-12-31`, goal, today);
      const eq = this.theme.vocab.equivalent;
      this.setData({
        days: r.days || [],
        goal,
        totalText: M.formatNum(s.total),
        eqText: eq && s.total ? `${eq.label} ${M.equivalentOf(s.total, eq)} ${eq.unit}` : '',
        kpi: [
          { label: this.theme.vocab.avgLabel, value: M.formatNum(s.avg), unit: this.data.unit },
          { label: '达标天数', value: s.achieved, unit: `/ ${s.dataDays} 天` },
          { label: '最长连续达标', value: s.longestStreak, unit: '天' },
          { label: this.theme.vocab.bestLabel, value: s.best ? M.formatShort(s.best.value) : '—', unit: s.best ? `${this.data.unit} · ${D.formatDateCN(s.best.date)}` : '' }
        ]
      });
    } catch (err) {
      if (seq !== this._seq) return;
      console.warn('[metric year] fetch fail', err);
      toast.show(this, '加载失败');
    }
    this.setData({ loading: false });
  }
});
