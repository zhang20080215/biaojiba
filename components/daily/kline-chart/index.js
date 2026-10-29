// 每日主题 · 统计页图表（canvas 2d）
// 股票软件的看法：最新一根在最右边；左右拖动翻看更早的；点一下或长按拖动出十字线，抛 select 让页面换表头。
// 三种画法，日 / 周 / 月 / 年都能用：
//   bar    柱形 —— 从 0 长起（步数），达到每日目标深色、没到浅色
//   line   折线 —— 平滑曲线 + 浅色面积
//   candle K线 —— 股票蜡烛：实体从开到收，影线到这一段的最高 / 最低；收比开高红色、低绿色、持平灰色。
//                 周 / 月 / 年：开 = 第一个有数据的日子，收 = 最后一个；日：开 = 上一天，收 = 当天（没有影线）
//   （2026-10-28 试过画成「十」字的箱体，2026-10-29 用户觉得没意思，回到蜡烛）
// value = 'main'（每根的平均 / 当天的值）或 'sum'（这一段的总数），柱形和折线按它取值；K线固定画开高低收。
// MA5、MA10 两条均线可开关（跟着 value 算）；每日目标虚线，目标值标在虚线右下角。
// 数值是「绘图值」（睡眠传的是 -bedOffset，越早越往上），format 决定轴上怎么写字。
const M = require('../../../utils/daily/metric.js');
const T = require('../../../utils/daily/clock.js');
const K = require('../../../utils/daily/kline.js');
const { monotoneControls } = require('../../../utils/daily/chart.js');

const MA_COLORS = ['#E3A23B', '#6A8CDB'];
const UP = '#E25A4E';
const DOWN = '#3A9F6E';
const FLAT = '#A7A498';
const MA_N = [5, 10];
const PAD = { l: 6, r: 50, t: 24, b: 22 };
const LONG_PRESS_MS = 300;

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
    visible: { type: Number, value: 30 },       // 一屏放几根
    showMA: { type: Boolean, value: true }
  },
  observers: {
    'candles, period': function () {
      this._offset = 0;
      this._sel = -1;
      this._draw();
    },
    'mode, value, goal, showGoal, accent, visible, showMA': function () { this._draw(); }
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
    // ───────── 坐标 ─────────
    _view() {
      const c = this.data.candles || [];
      const n = c.length;
      const V = Math.max(1, this.data.visible);
      const maxOffset = Math.max(0, n - V);
      this._offset = Math.min(Math.max(0, this._offset || 0), maxOffset);
      const end = n - this._offset;
      const start = Math.max(0, end - V);
      const plotW = this._w - PAD.l - PAD.r;
      const slot = plotW / V;
      const lead = V - (end - start);            // 不满一屏时整体靠右
      const xOf = i => PAD.l + (i - start + lead) * slot + slot / 2;
      return { c, n, V, start, end, slot, xOf, plotW, maxOffset };
    },

    // 每根要画的那个数：K线看收；柱形 / 折线看 value
    _val(c) {
      if (this.data.mode === 'candle') return c.close;
      return this.data.value === 'sum' ? c.sum : c.main;
    },

    _fmt(v) {
      return this.data.format === 'clock' ? T.offsetToClock(-v) : M.formatShort(Math.round(v));
    },

    // 纵轴刻度：步数取整到百（8,113 → 8,100），读起来像刻度而不是某一天的数
    _axisFmt(v) {
      return this.data.format === 'clock' ? T.offsetToClock(-v) : M.formatShort(Math.round(v / 100) * 100);
    },

    _dateLabel(c) {
      if (!c) return '';
      if (this.data.period === 'year') return c.key;
      if (this.data.period === 'month') return c.key.replace('-', '/');
      return c.from.slice(5).replace('-', '/');
    },

    // ───────── 绘制 ─────────
    _draw() {
      const ctx = this._ctx;
      if (!ctx) return;
      const W = this._w, H = this._h;
      ctx.clearRect(0, 0, W, H);
      const v = this._view();
      if (!v.n) return;
      const mode = this.data.mode;
      const vals = v.c.map(c => this._val(c));
      const showMA = this.data.showMA;
      // 均线：K线按收盘价算（股票软件的口径），柱形 / 折线按画出来的那个数
      const ma = showMA ? MA_N.map(n => K.movingAverage(vals.map(x => ({ main: x })), n)) : [];
      const vis = v.c.slice(v.start, v.end);
      const goal = this.data.goal;

      // 纵轴范围：可见的值（K线含开高低收：日K 的开是上一天，可能在高低之外）+ 均线 + 目标线
      let lo = Infinity, hi = -Infinity;
      vis.forEach((c, k) => {
        const i = v.start + k;
        lo = Math.min(lo, mode === 'candle' ? Math.min(c.low, c.open) : vals[i]);
        hi = Math.max(hi, mode === 'candle' ? Math.max(c.high, c.open) : vals[i]);
        ma.forEach(arr => { const x = arr[i]; if (x != null) { lo = Math.min(lo, x); hi = Math.max(hi, x); } });
      });
      if (this.data.showGoal) { lo = Math.min(lo, goal); hi = Math.max(hi, goal); }
      if (hi === lo) { hi += 1; lo -= 1; }
      const padV = (hi - lo) * 0.08;
      hi += padV; lo -= padV;
      // 步数的柱子从 0 长起，柱高才和数值成正比
      if (mode === 'bar' && this.data.format === 'count') lo = 0;
      const top = PAD.t, bottom = H - PAD.b, plotH = bottom - top;
      const yOf = val => top + (hi - val) / (hi - lo) * plotH;

      // 网格 + 右侧刻度
      ctx.font = '10px sans-serif';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      for (let g = 0; g <= 3; g++) {
        const y = top + plotH * g / 3;
        ctx.strokeStyle = '#EFEEEA';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(W - PAD.r, y); ctx.stroke();
        ctx.fillStyle = '#A7A498';
        ctx.fillText(this._axisFmt(hi - (hi - lo) * g / 3), W - PAD.r + 6, y);
      }

      // 每日目标虚线（文字最后画，免得被图形盖住）
      const gy = this.data.showGoal ? yOf(goal) : null;
      if (gy != null) {
        ctx.save();
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = this.data.accent;
        ctx.beginPath(); ctx.moveTo(PAD.l, gy); ctx.lineTo(W - PAD.r, gy); ctx.stroke();
        ctx.restore();
      }
      // 达标深色、没达标浅一档；没有目标线（看总数）时一律深色
      const strong = val => !this.data.showGoal || val >= goal;

      if (mode === 'line') {
        const pts = vis.map((c, k) => ({ x: v.xOf(v.start + k), y: yOf(vals[v.start + k]) }));
        const segs = monotoneControls(pts);
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        segs.forEach(s => ctx.bezierCurveTo(s.c1x, s.c1y, s.c2x, s.c2y, s.x, s.y));
        ctx.strokeStyle = this.data.accent;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.lineTo(pts[pts.length - 1].x, bottom);
        ctx.lineTo(pts[0].x, bottom);
        ctx.closePath();
        ctx.globalAlpha = 0.12;
        ctx.fillStyle = this.data.accent;
        ctx.fill();
        ctx.globalAlpha = 1;
      } else if (mode === 'bar') {
        const bw = Math.max(2, Math.min(14, v.slot * 0.5));
        vis.forEach((c, k) => {
          const val = vals[v.start + k];
          const x = v.xOf(v.start + k), y = yOf(val);
          ctx.globalAlpha = strong(val) ? 1 : 0.35;
          ctx.fillStyle = this.data.accent;
          ctx.fillRect(x - bw / 2, y, bw, Math.max(1, bottom - y));
        });
        ctx.globalAlpha = 1;
      } else {
        // K线：影线 = 最高到最低，实体 = 开到收；实心红涨绿跌，持平画一道灰横线
        const bw = Math.max(3, Math.min(12, v.slot * 0.62));
        vis.forEach((c, k) => {
          const x = Math.round(v.xOf(v.start + k)) + 0.5;
          const color = c.close > c.open ? UP : c.close < c.open ? DOWN : FLAT;
          const top2 = Math.max(c.high, c.open, c.close), bot2 = Math.min(c.low, c.open, c.close);
          ctx.strokeStyle = color;
          ctx.fillStyle = color;
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(x, yOf(top2)); ctx.lineTo(x, yOf(bot2)); ctx.stroke();
          const yo = yOf(c.open), yc = yOf(c.close);
          const y = Math.min(yo, yc), h = Math.max(1, Math.abs(yo - yc));
          ctx.fillRect(x - bw / 2, y, bw, h);
        });
      }

      // 均线
      ma.forEach((arr, j) => {
        ctx.strokeStyle = MA_COLORS[j];
        ctx.lineWidth = 1;
        ctx.beginPath();
        let started = false;
        for (let i = v.start; i < v.end; i++) {
          if (arr[i] == null) continue;
          const x = v.xOf(i), y = yOf(arr[i]);
          if (started) ctx.lineTo(x, y); else { ctx.moveTo(x, y); started = true; }
        }
        ctx.stroke();
      });

      // 目标值贴在虚线右下角，垫一块白底压在图形上面；太靠底放不下就贴右上角
      if (gy != null && this.data.goalText) {
        ctx.font = '10px sans-serif';
        const tw = ctx.measureText(this.data.goalText).width;
        const below = gy + 16 <= bottom;
        const by = below ? gy + 2 : gy - 16;
        ctx.fillStyle = 'rgba(255,255,255,0.92)';
        ctx.fillRect(W - PAD.r - tw - 8, by, tw + 6, 14);
        ctx.fillStyle = this.data.accent;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'top';
        ctx.fillText(this.data.goalText, W - PAD.r - 5, by + 2);
      }

      // 左上角均线读数（十字线所在那根，否则最新一根）
      const at = this._sel >= 0 ? this._sel : v.end - 1;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      let lx = PAD.l;
      (showMA ? MA_N : []).forEach((n, j) => {
        const val = ma[j][at];
        const txt = `MA${n} ${val == null ? '--' : this._fmt(val)}`;
        ctx.fillStyle = MA_COLORS[j];
        ctx.fillText(txt, lx, 10);
        lx += ctx.measureText(txt).width + 12;
      });

      // 底部日期：首、中、尾
      ctx.fillStyle = '#A7A498';
      ctx.textBaseline = 'top';
      const idx = [v.start, Math.floor((v.start + v.end - 1) / 2), v.end - 1];
      ['left', 'center', 'right'].forEach((align, j) => {
        if (j === 1 && v.end - v.start < 5) return;
        ctx.textAlign = align;
        const x = j === 0 ? PAD.l : j === 2 ? W - PAD.r : v.xOf(idx[1]);
        ctx.fillText(this._dateLabel(v.c[idx[j]]), x, bottom + 6);
      });

      // 十字线
      if (this._sel >= v.start && this._sel < v.end) {
        const val = vals[this._sel];
        const x = v.xOf(this._sel), y = yOf(val);
        ctx.save();
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = '#6F6F68';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.moveTo(PAD.l, y); ctx.lineTo(W - PAD.r, y); ctx.stroke();
        ctx.restore();
        ctx.fillStyle = '#2D2D2B';
        ctx.fillRect(W - PAD.r + 1, y - 8, PAD.r - 2, 16);
        ctx.fillStyle = '#FFFFFF';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(this._fmt(val), W - PAD.r + 4, y);
      }
    },

    // ───────── 手势：拖动翻历史；点一下 / 长按拖动出十字线 ─────────
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
      const t = e.touches[0];
      this._x0 = t.x;
      this._off0 = this._offset || 0;
      this._moved = false;
      this._scrub = false;
      clearTimeout(this._lpTimer);
      this._lpTimer = setTimeout(() => { this._scrub = true; this._select(this._indexAt(this._x0)); }, LONG_PRESS_MS);
    },
    onTouchMove(e) {
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
    onTouchEnd() {
      clearTimeout(this._lpTimer);
      if (this._moved || this._scrub) return;
      // 轻点：选中那一根；再点同一根取消
      const i = this._indexAt(this._x0);
      this._select(i === this._sel ? -1 : i);
    }
  }
});
