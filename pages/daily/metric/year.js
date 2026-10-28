// 数值型每日主题 · 年度视图：全年热力格 + 年度汇总（文案按度量取自 utils/daily/views.js）
const toast = require('../../../utils/dailyToast.js');
const M = require('../../../utils/daily/metric.js');
const V = require('../../../utils/daily/views.js');
const C = require('./common.js');

const MIN_YEAR = 2015;

Page({
  data: {
    toast: { show: false, text: '', icon: '' },
    themeClass: '',
    heat: [],
    themeId: 'steps',
    measure: 'count',
    title: '',
    today: '',
    year: 2026,
    canPrev: true,
    canNext: false,
    loading: true,
    days: [],
    goal: 0,
    kpi: [],
    heroCap: '',
    heroNum: '0',
    heroUnit: '',
    heroSub: ''
  },

  onLoad(options) {
    const theme = C.resolveTheme(options && options.theme);
    this.theme = theme;
    this.view = V.viewOf(theme);
    const ts = C.themeState();
    const today = C.todayOf(theme);
    const thisYear = Number(today.slice(0, 4));
    const year = Math.min(thisYear, Math.max(MIN_YEAR, Number(options && options.year) || thisYear));
    this.setData({
      themeClass: ts.themeClass,
      heat: ts.heat,
      themeId: theme.id,
      measure: theme.measure || 'count',
      title: theme.title + '年度',
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
      const measure = this.theme.measure;
      const map = M.toDayMap(r.days, measure);
      const s = M.summarize(map, `${year}-01-01`, `${year}-12-31`, goal, today, measure);
      const docs = M.toDocMap(r.days);
      Object.keys(docs).forEach(d => { if (!(d in map) || d > today) delete docs[d]; });
      const yv = this.view.year(s, docs, this.theme);
      this.setData({
        days: r.days || [],
        goal,
        heroCap: yv.heroCap,
        heroNum: yv.heroNum,
        heroUnit: yv.heroUnit,
        heroSub: yv.heroSub,
        kpi: yv.kpi
      });
    } catch (err) {
      if (seq !== this._seq) return;
      console.warn('[metric year] fetch fail', err);
      toast.show(this, '加载失败');
    }
    this.setData({ loading: false });
  }
});
