// 每日主题 · 睡眠记录面板（半屏）：选「哪一晚」+ 入睡时刻 + 起床时刻（可空）
// 只做校验并抛事件，写库由页面做。事件：submit { date, bedTime, wakeTime } / remove { date } / close
const T = require('../../../utils/daily/clock.js');
const D = require('../../../utils/daily/date.js');

Component({
  properties: {
    show: { type: Boolean, value: false },
    date: { type: String, value: '' },        // 那一晚的日期
    bedTime: { type: String, value: '' },
    wakeTime: { type: String, value: '' },
    maxDate: { type: String, value: '' },     // 最晚只能记到「今晚」
    canDelete: { type: Boolean, value: false }
  },
  data: { d: '', bed: '', wake: '', dateLabel: '', durationText: '' },
  observers: {
    show(v) {
      if (!v) return;
      this._apply({ d: this.data.date || this.data.maxDate, bed: this.data.bedTime || '23:00', wake: this.data.wakeTime || '' });
    }
  },
  methods: {
    _apply(patch) {
      const next = Object.assign({ d: this.data.d, bed: this.data.bed, wake: this.data.wake }, patch);
      const dur = next.wake ? T.durationOf(next.bed, next.wake) : 0;
      this.setData({
        d: next.d,
        bed: next.bed,
        wake: next.wake,
        dateLabel: `${D.formatDateCN(next.d)} ${D.weekdayCN(next.d)} 晚上`,
        durationText: next.wake ? `睡了 ${T.formatDuration(dur)}` : '还没起床可以先空着'
      });
    },
    noop() {},
    onClose() { this.triggerEvent('close'); },
    onDate(e) { this._apply({ d: e.detail.value }); },
    onBed(e) { this._apply({ bed: e.detail.value }); },
    onWake(e) { this._apply({ wake: e.detail.value }); },
    onClearWake() { this._apply({ wake: '' }); },
    onSubmit() {
      const { d, bed, wake } = this.data;
      this.triggerEvent('submit', { date: d, bedTime: bed, wakeTime: wake });
    },
    onRemove() {
      wx.showModal({
        title: '删除这一晚的记录？',
        confirmText: '删除',
        success: r => { if (r.confirm) this.triggerEvent('remove', { date: this.data.d }); }
      });
    }
  }
});
