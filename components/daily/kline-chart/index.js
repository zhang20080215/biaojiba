// 每日主题 · 统计页图表（canvas 2d）
// 股票软件的看法：最新一根在最右边；左右拖动翻看更早的；点一下或长按拖动出十字线，抛 select 让页面换表头。
// 三种画法，日 / 周 / 月都能用：
//   bar  柱形 —— 从 0 长起（步数），达到每日目标深色、没到浅色
//   line 折线 —— 平滑曲线 + 浅色面积
//   box  箱体 —— 画成一个「十」：竖线从最少的一天到最多的一天，横线是平均（不画方块的上下沿）；
//               日视图一天只有一个数，竖线画成和横线一样长，是个小「十」，中心就是当天的值
// value = 'main'（每根的平均 / 当天的值）或 'sum'（这一段的总数），柱形和折线按它取值；箱体固定看平均和高低。
// MA5、MA10 两条均线可开关（跟着 value 算）；每日目标虚线，目标值标在虚线右下角。
// 数值是「绘图值」（睡眠传的是 -bedOffset，越早越往上），format 决定轴上怎么写字。
const M = require('../../../utils/daily/metric.js');
const T = require('../../../utils/daily/clock.js');
const K = require('../../../utils/daily/kline.js');
const { monotoneControls } = require('../../../utils/daily/chart.js');

const MA_COLORS = ['#E3A23B', '#6A8CDB'];
const MA_N = [5, 10];
const PAD = { l: 6, r: 50, t: 24, b: 22 };
const LONG_PRESS_MS = 300;

Component({
  properties: {
    candles: { type: Array, value: [] },
    period: { type: String, value: 'day' },     // day | week | month
    mode: { type: String, value: 'bar' },       // bar | line | box
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

    // 每根要画的那个数：箱体看平均；柱形 / 折线看 value
    _val(c) {
      return this.data.mode !== 'box' && this.data.value === 'sum' ? c.sum : c.main;
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
      const ma = showMA ? MA_N.map(n => K.movingAverage(vals.map(x => ({ main: x })), n)) : [];
      const vis = v.c.slice(v.start, v.end);
      const goal = this.data.goal;

      // 纵轴范围：可见的值（箱体含高低）+ 均线 + 目标线
      let lo = Infinity, hi = -Infinity;
      vis.forEach((c, k) => {
        const i = v.start + k;
        lo = Math.min(lo, mode === 'box' ? c.low : vals[i]);
        hi = Math.max(hi, mode === 'box' ? c.high : vals[i]);
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
        // 箱体：「十」字 —— 竖线 = 最少到最多的一天，横线 = 平均
        const tw = Math.max(6, Math.min(16, v.slot * 0.6));
        vis.forEach(c => {
          const i = v.c.indexOf(c);
          const x = v.xOf(i), y = yOf(c.main);
          ctx.globalAlpha = strong(c.main) ? 1 : 0.4;
          ctx.strokeStyle = this.data.accent;
          ctx.lineCap = 'round';
          ctx.lineWidth = 1.5;
          // 一天只有一个数（高 = 低）时竖线和横线一样长，画成一个小「十」，不然只剩一道横杠
          const y1 = c.high === c.low ? y - tw / 2 : yOf(c.high);
          const y2 = c.high === c.low ? y + tw / 2 : yOf(c.low);
          ctx.beginPath(); ctx.moveTo(x, y1); ctx.lineTo(x, y2); ctx.stroke();
          ctx.lineWidth = 3;
          ctx.beginPath(); ctx.moveTo(x - tw / 2, y); ctx.lineTo(x + tw / 2, y); ctx.stroke();
        });
        ctx.globalAlpha = 1;
        ctx.lineCap = 'butt';
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
