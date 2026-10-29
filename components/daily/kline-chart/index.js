// 每日主题 · 统计页图表（canvas 2d）
// 股票软件的看法：最新一根在最右边；左右拖动翻看更早的；点一下或长按拖动出十字线，抛 select 让页面换表头；
// 双指捏合横向缩放（一屏 5 ~ 400 根，两指中间那根保持在原处），换周期 / 换 visible 时回到默认根数。
// 三种画法，日 / 周 / 月 / 年都能用：
//   bar    柱形 —— 从 0 长起（步数），达到每日目标深色、没到浅色
//   line   折线 —— 平滑曲线 + 浅色面积
//   candle K线 —— 股票蜡烛：实体从开到收，影线到这一段的最高 / 最低；收比开高红色、低绿色、持平灰色。
//                 周 / 月 / 年：开 = 第一个有数据的日子，收 = 最后一个；日：开 = 上一天，收 = 当天（没有影线）
//   （2026-10-28 试过画成「十」字的箱体，2026-10-29 用户觉得没意思，回到蜡烛）
// value = 'main'（每根的平均 / 当天的值）或 'sum'（这一段的总数），柱形和折线按它取值；K线固定画开高低收。
// MA5、MA10 两条均线可开关（跟着 value 算）；每日目标虚线，目标值标在虚线右下角。
// 数值是「绘图值」（睡眠传的是 -bedOffset，越早越往上），format 决定轴上怎么写字。
// 绘制本身在 utils/daily/klineDraw.js（统计报表海报也用它），这里只管画布、视窗状态和手势；snapshot() 给海报取当前视窗。
const KD = require('../../../utils/daily/klineDraw.js');

const PAD = KD.PAD;
const LONG_PRESS_MS = 300;
const MIN_VISIBLE = 5;
const MAX_VISIBLE = 400;                         // 再多一根就不到 1px 了

Component({
  properties: {
    candles: { type: Array, value: [] },
    period: { type: String, value: 'day' },     // day | week | month | year
    mode: { type: String, value: 'bar' },       // bar | line | candle
    value: { type: String, value: 'main' },     // main | sum（柱形 / 折线取哪个数）
    goal: { type: Number, value: 0 },
    showGoal: { type: Boolean, value: false },
    goalText: { type: String, value: '' },
    format: { type: String, value: 'count' },   // count | clock
    accent: { type: String, value: '#526631' },
    visible: { type: Number, value: 30 },       // 一屏默认放几根（捏合缩放后以 this._vis 为准）
    showMA: { type: Boolean, value: true }
  },
  observers: {
    'candles, period': function () {
      this._offset = 0;
      this._sel = -1;
      this._vis = 0;
      this._draw();
    },
    visible() {
      this._vis = 0;
      this._draw();
    },
    'mode, value, goal, showGoal, accent, showMA': function () { this._draw(); }
  },
  lifetimes: {
    ready() {
      this.createSelectorQuery().select('#kc').fields({ node: true, size: true }).exec(res => {
        const r = res && res[0];
        if (!r || !r.node) return;
        const dpr = (wx.getWindowInfo ? wx.getWindowInfo().pixelRatio : 2) || 2;
        r.node.width = r.width * dpr;
        r.node.height = r.height * dpr;
        this._canvas = r.node;
        this._ctx = r.node.getContext('2d');
        this._ctx.scale(dpr, dpr);
        this._w = r.width;
        this._h = r.height;
        this._draw();
      });
    },
    detached() { clearTimeout(this._lpTimer); }
  },
  methods: {
    // ───────── 坐标 / 绘制（见 utils/daily/klineDraw.js）─────────
    _view() {
      const v = KD.view(this.data.candles, this._vis || this.data.visible, this._offset, this._w);
      this._offset = v.offset;
      return v;
    },

    _opts() {
      const d = this.data;
      return { candles: d.candles, period: d.period, mode: d.mode, value: d.value, goal: d.goal, showGoal: d.showGoal, goalText: d.goalText, format: d.format, accent: d.accent, showMA: d.showMA };
    },

    // 页面上现在看到的样子（统计报表海报照着画）
    snapshot() {
      const v = this._view();
      return { opts: this._opts(), V: v.V, offset: v.offset, sel: this._sel == null ? -1 : this._sel, w: this._w, h: this._h };
    },

    _draw() {
      const ctx = this._ctx;
      if (!ctx) return;
      ctx.clearRect(0, 0, this._w, this._h);
      const v = KD.draw(ctx, this._w, this._h, this._opts(), { V: this._vis || this.data.visible, offset: this._offset, sel: this._sel });
      this._offset = v.offset;
    },

    // ───────── 手势：拖动翻历史；点一下 / 长按拖动出十字线；双指捏合缩放 ─────────
    _startPinch(t) {
      clearTimeout(this._lpTimer);
      this._scrub = false;
      this._moved = true;                        // 捏完松手不算轻点
      const v = this._view();
      const cx = (t[0].x + t[1].x) / 2;
      // 两指中点落在第几根（可以是小数；不满一屏时左边空着的那几格也算进去）
      const anchor = v.start - (v.V - (v.end - v.start)) + (cx - PAD.l) / v.slot - 0.5;
      this._pinch = { d0: Math.max(1, Math.hypot(t[0].x - t[1].x, t[0].y - t[1].y)), V0: v.V, cx, anchor };
    },
    _doPinch(t) {
      const P = this._pinch;
      const n = (this.data.candles || []).length;
      const d = Math.max(1, Math.hypot(t[0].x - t[1].x, t[0].y - t[1].y));
      // 两指张开 = 放大 = 一屏放更少根；最多放到「全部」或默认根数里大的那个
      const maxV = Math.max(this.data.visible, Math.min(n, MAX_VISIBLE));
      const V = Math.min(maxV, Math.max(MIN_VISIBLE, Math.round(P.V0 * P.d0 / d)));
      if (V === (this._vis || this.data.visible) && this._pinchApplied) return;
      this._pinchApplied = true;
      // 让 anchor 那根留在两指中点下：反推最左一格是第几根，再换成离最右的偏移
      const slot = (this._w - PAD.l - PAD.r) / V;
      const left = P.anchor - ((P.cx - PAD.l) / slot - 0.5);
      this._vis = V;
      this._offset = Math.min(Math.max(0, n - V), Math.max(0, Math.round(n - (left + V))));
      this._draw();
    },
    _indexAt(x) {
      const v = this._view();
      const k = Math.floor((x - PAD.l) / v.slot) - (v.V - (v.end - v.start));
      return Math.min(v.end - 1, Math.max(v.start, v.start + k));
    },
    _select(i) {
      this._sel = i;
      this._draw();
      this.triggerEvent('select', { index: i });
    },
    onTouchStart(e) {
      if (e.touches.length >= 2) { this._startPinch(e.touches); return; }
      const t = e.touches[0];
      this._x0 = t.x;
      this._off0 = this._offset || 0;
      this._moved = false;
      this._scrub = false;
      this._pinch = null;
      this._pinchApplied = false;
      clearTimeout(this._lpTimer);
      this._lpTimer = setTimeout(() => { this._scrub = true; this._select(this._indexAt(this._x0)); }, LONG_PRESS_MS);
    },
    onTouchMove(e) {
      if (e.touches.length >= 2) {
        if (!this._pinch) this._startPinch(e.touches);
        this._doPinch(e.touches);
        return;
      }
      if (this._pinch) return;                   // 捏合时先抬起一根手指：剩下那根不拖动，等全抬起
      const t = e.touches[0];
      const dx = t.x - this._x0;
      if (this._scrub) { this._select(this._indexAt(t.x)); return; }
      if (Math.abs(dx) < 4) return;
      this._moved = true;
      clearTimeout(this._lpTimer);
      const v = this._view();
      const next = Math.min(v.maxOffset, Math.max(0, this._off0 + Math.round(dx / v.slot)));
      if (next !== this._offset) {
        this._offset = next;
        if (this._sel >= 0) { this._sel = -1; this.triggerEvent('select', { index: -1 }); }
        this._draw();
      }
    },
    onTouchEnd(e) {
      clearTimeout(this._lpTimer);
      if (this._pinch) {
        if (!e || !e.touches || !e.touches.length) this._pinch = null;
        return;
      }
      if (this._moved || this._scrub) return;
      // 轻点：选中那一根；再点同一根取消
      const i = this._indexAt(this._x0);
      this._select(i === this._sel ? -1 : i);
    }
  }
});
