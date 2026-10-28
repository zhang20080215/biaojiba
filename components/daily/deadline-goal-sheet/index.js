// 每日主题 · 截止日期累计目标的设置面板（半屏）
// 打开时用 goal 回填（编辑），没有则给默认值（新建）；保存只做校验并抛 submit，写库由页面做。
// 事件：submit { target, startDate, endDate } / close / abandon
const M = require('../../../utils/daily/metric.js');
const D = require('../../../utils/daily/date.js');

function defaultEnd(today) {
  const yearEnd = today.slice(0, 4) + '-12-31';
  // 年底不足 30 天就往后给 90 天，免得默认目标只剩几天
  return D.daysBetween(today, yearEnd) >= 30 ? yearEnd : D.addDays(today, 89);
}

Component({
  properties: {
    show: { type: Boolean, value: false },
    goal: { type: Object, value: null },
    config: { type: Object, value: {} },    // dailyThemes 里的 deadlineGoal
    today: { type: String, value: '' },
    unit: { type: String, value: '' },
    verb: { type: String, value: '完成' }
  },
  data: {
    editing: false,
    presets: [],
    target: 0,
    targetInput: '',
    targetText: '',
    startDate: '',
    endDate: '',
    startMin: '',
    endMin: '',
    endMax: '',
    summary: '',
    error: ''
  },
  observers: {
    show(v) { if (v) this._init(); }
  },
  methods: {
    _init() {
      const { goal, config, today } = this.data;
      const cfg = config || {};
      const editing = !!goal;
      const target = editing ? goal.target : (cfg.presets && cfg.presets[cfg.presets.length - 1]) || 0;
      const startDate = editing ? goal.startDate : today;
      const endDate = editing ? goal.endDate : defaultEnd(today);
      this.setData({
        editing,
        presets: (cfg.presets || []).map(v => ({ value: v, text: M.formatShort(v) })),
        startMin: D.addDays(today, -(cfg.backfillDays || 0)),
        targetInput: '',
        error: ''
      });
      this._apply({ target, startDate, endDate });
    },

    // 统一刷新：日期上下限联动 + 一句话摘要
    _apply(patch) {
      const next = Object.assign({ target: this.data.target, startDate: this.data.startDate, endDate: this.data.endDate }, patch);
      const { today, config, unit, verb } = this.data;
      const maxDays = (config && config.maxDays) || 366;
      const endMin = next.startDate > today ? next.startDate : today;
      const endMax = D.addDays(next.startDate, maxDays - 1);
      if (next.endDate < endMin) next.endDate = endMin;
      if (next.endDate > endMax) next.endDate = endMax;
      const days = D.daysBetween(next.startDate, next.endDate) + 1;
      this.setData({
        target: next.target,
        targetText: next.target ? M.formatNum(next.target) : '',
        startDate: next.startDate,
        endDate: next.endDate,
        endMin,
        endMax,
        summary: next.target
          ? `${days} 天${verb}满 ${M.formatShort(next.target)}${unit}，平均每天约 ${M.formatNum(Math.ceil(next.target / days))} ${unit}`
          : '',
        error: ''
      });
    },

    noop() {},
    onClose() { this.triggerEvent('close'); },

    onPreset(e) {
      this.setData({ targetInput: '' });
      this._apply({ target: Number(e.currentTarget.dataset.value) });
    },

    onInput(e) {
      const raw = String(e.detail.value || '').replace(/\D/g, '');
      this.setData({ targetInput: raw });
      this._apply({ target: raw ? Number(raw) : 0 });
    },

    onStart(e) { this._apply({ startDate: e.detail.value }); },
    onEnd(e) { this._apply({ endDate: e.detail.value }); },

    onSubmit() {
      const { target, startDate, endDate, config, unit } = this.data;
      const cfg = config || {};
      if (!target) return this.setData({ error: '先选一个目标' });
      if (cfg.min && target < cfg.min) return this.setData({ error: `目标至少 ${M.formatNum(cfg.min)} ${unit}` });
      if (cfg.max && target > cfg.max) return this.setData({ error: `目标最多 ${M.formatShort(cfg.max)} ${unit}` });
      this.triggerEvent('submit', { target, startDate, endDate });
    },

    onAbandon() {
      wx.showModal({
        title: '放弃这个目标？',
        content: '目标会被归档，已记录的数据不受影响',
        confirmText: '放弃',
        success: r => { if (r.confirm) this.triggerEvent('abandon'); }
      });
    }
  }
});
