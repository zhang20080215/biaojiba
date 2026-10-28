// 每日主题 · 截止日期累计目标卡片（「12月31日前走满 100 万步」/「12月31日前早睡满 30 天」）
// 三种状态：没有目标 → 引导设置；进行中 → 进度；达成 / 到期 → 结果 + 「再设一个」。
// mode：sum 累计数值 / days 累计达标天数（见 metric.goalProgress）
// 事件：create / edit / restart { status }（页面先归档再打开设置面板）
const M = require('../../../utils/daily/metric.js');
const D = require('../../../utils/daily/date.js');

Component({
  properties: {
    goal: { type: Object, value: null },       // { target, startDate, endDate }
    walked: { type: Number, value: 0 },
    today: { type: String, value: '' },
    mode: { type: String, value: 'sum' },
    unit: { type: String, value: '' },
    verb: { type: String, value: '完成' },
    example: { type: String, value: '' }
  },
  data: { view: null },
  observers: {
    'goal, walked, today, mode': function (goal, walked, today, mode) {
      if (!goal || !today) { this.setData({ view: null }); return; }
      const p = M.goalProgress(goal, walked, today, mode);
      const { unit, verb } = this.data;
      const days = mode === 'days';
      let tip = '';
      if (p.status === 'active') {
        if (!days) tip = `剩 ${p.daysLeft} 天，每天平均还需 ${M.formatNum(p.perDayNeeded)} ${unit}`;
        else if (p.feasible) tip = `剩 ${p.daysLeft} 天，还需${verb} ${p.remaining} 天`;
        else tip = `剩 ${p.daysLeft} 天，还差 ${p.remaining} 天，来不及了，可以调整目标`;
      }
      this.setData({
        view: {
          status: p.status,
          title: `${D.formatDateCN(goal.endDate)}前${verb}满 ${M.formatShort(p.target)}${unit}`,
          range: `${D.formatDateCN(goal.startDate)} - ${D.formatDateCN(goal.endDate)}`,
          pct: p.pct,
          walkedText: M.formatNum(p.walked),
          remainingText: M.formatNum(p.remaining),
          tip,
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
