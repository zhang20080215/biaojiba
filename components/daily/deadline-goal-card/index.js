// 每日主题 · 截止日期累计目标卡片（「12月31日前走满 100 万步」）
// 三种状态：没有目标 → 引导设置；进行中 → 进度；达成 / 到期 → 结果 + 「再设一个」。
// 事件：create / edit / restart { status }（页面先归档再打开设置面板）
const M = require('../../../utils/daily/metric.js');
const D = require('../../../utils/daily/date.js');

Component({
  properties: {
    goal: { type: Object, value: null },       // { target, startDate, endDate }
    walked: { type: Number, value: 0 },
    today: { type: String, value: '' },
    unit: { type: String, value: '' },
    verb: { type: String, value: '完成' }
  },
  data: { view: null },
  observers: {
    'goal, walked, today': function (goal, walked, today) {
      if (!goal || !today) { this.setData({ view: null }); return; }
      const p = M.goalProgress(goal, walked, today);
      this.setData({
        view: {
          status: p.status,
          title: `${D.formatDateCN(goal.endDate)}前${this.data.verb}满 ${M.formatShort(p.target)}${this.data.unit}`,
          range: `${D.formatDateCN(goal.startDate)} - ${D.formatDateCN(goal.endDate)}`,
          pct: p.pct,
          walkedText: M.formatNum(p.walked),
          remainingText: M.formatNum(p.remaining),
          daysLeft: p.daysLeft,
          perDayText: M.formatNum(p.perDayNeeded),
          usedDays: D.daysBetween(goal.startDate, today < goal.endDate ? today : goal.endDate) + 1
        }
      });
    }
  },
  methods: {
    onCreate() { this.triggerEvent('create'); },
    onEdit() { this.triggerEvent('edit'); },
    onRestart() { this.triggerEvent('restart', { status: this.data.view && this.data.view.status }); }
  }
});
