// 每日主题 · 月历热力图（周一开头）
// 格子颜色 = palette.heat[level]；无数据画虚线框，未来的日子只留日期。翻月由页面处理（prev / next 事件）。
const M = require('../../../utils/daily/metric.js');
const D = require('../../../utils/daily/date.js');

Component({
  properties: {
    year: { type: Number, value: 2026 },
    month: { type: Number, value: 1 },
    days: { type: Array, value: [] },     // getRange 的 days
    goal: { type: Number, value: 0 },
    measure: { type: String, value: 'count' },   // metric.MEASURES 的键
    today: { type: String, value: '' },
    heat: { type: Array, value: [] },     // palette.heat
    selected: { type: String, value: '' },
    showNav: { type: Boolean, value: true },     // 统计页自己有区间导航时关掉
    canPrev: { type: Boolean, value: true },
    canNext: { type: Boolean, value: false },
    loading: { type: Boolean, value: false }
  },
  data: { cells: [], label: '', weekHeader: D.WD_MON },
  observers: {
    'year, month, days, goal, today, heat, measure': function () { this._build(); }
  },
  methods: {
    _build() {
      const { year, month, days, goal, today, heat, measure } = this.data;
      if (!today || !heat.length) return;
      const cells = M.buildMonthCells(year, month, M.toDayMap(days, measure), goal, today, measure).map(c => {
        if (c.empty || c.level < 0) return c;
        return Object.assign({}, c, { bg: heat[c.level], light: c.level >= 3 });
      });
      this.setData({ cells, label: D.formatMonthLabel(year, month) });
    },
    onPrev() { if (this.data.canPrev) this.triggerEvent('prev'); },
    onNext() { if (this.data.canNext) this.triggerEvent('next'); },
    onTap(e) {
      const { date, future } = e.currentTarget.dataset;
      if (!date || future) return;
      this.triggerEvent('select', { date });
    }
  }
});
