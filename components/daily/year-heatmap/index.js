// 每日主题 · 年度热力图：12 行（月）× 当月天数，颜色规则与月历一致
const M = require('../../../utils/daily/metric.js');

Component({
  properties: {
    year: { type: Number, value: 2026 },
    days: { type: Array, value: [] },     // getYear 的 days（只有有文档的日子）
    goal: { type: Number, value: 0 },
    today: { type: String, value: '' },
    heat: { type: Array, value: [] }
  },
  data: { rows: [] },
  observers: {
    'year, days, goal, today, heat': function () {
      const { year, days, goal, today, heat } = this.data;
      if (!today || !heat.length) return;
      const rows = M.buildYearRows(year, M.toDayMap(days), goal, today).map(r => ({
        month: r.month,
        label: r.label,
        cells: r.cells.map(c => ({ key: c.key, cls: c.level === -1 ? 'is-missing' : (c.level === -2 ? 'is-future' : ''), bg: c.level >= 0 ? heat[c.level] : '' }))
      }));
      this.setData({ rows });
    }
  }
});
