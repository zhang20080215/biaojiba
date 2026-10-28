// 每日主题 · 统计页 K 线图（canvas 2d）
// 股票软件的看法：最新一根在最右边；左右拖动翻看更早的；点一下或长按拖动出十字线，抛 select 让页面换表头。
// 蜡烛 / 折线两种画法；MA5、MA10 两条均线；每日目标虚线，目标值标在虚线右下角。
// 数值是「绘图值」（睡眠传的是 -bedOffset，越早越往上），format 决定轴上怎么写字。
const M = require('../../../utils/daily/metric.js');
const T = require('../../../utils/daily/clock.js');
const K = require('../../../utils/daily/kline.js');
const { monotoneControls } = require('../../../utils/daily/chart.js');

const UP = '#E25A4E';       // 涨：红（国内股票习惯）
const DOWN = '#3A9F6E';     // 跌：绿
const MA_COLORS = ['#E3A23B', '#6A8CDB'];
const MA_N = [5, 10];
const PAD = { l: 6, r: 50, t: 24, b: 22 };
const LONG_PRESS_MS = 300;

Component({
  properties: {
    candles: { type: Array, value: [] },
    period: { type: String, value: 'day' },     // day | week | month
    mode: { type: String, value: 'candle' },    // candle | line
    goal: { type: Number, value: 0 },
    showGoal: { type: Boolean, value: false },
    goalText: { type: String, value: '' },
    format: { type: String, value: 'count' },   // count | clock
    accent: { type: String, value: '#526631' },
    visible: { type: Number, value: 30 }        // 一屏放几根
  },
  observers: {
    'candles, period': function () {
      this._offset = 0;
      this._sel = -1;
      this._draw();
    },
    'mode, goal, showGoal, accent, visible': function () { this._draw(); }
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
      const ma = MA_N.map(n => K.movingAverage(v.c, n));
      const vis = v.c.slice(v.start, v.end);
      const line = this.data.mode === 'line';

      // 纵轴范围：可见的高低 + 均线 + 目标线
      let lo = Infinity, hi = -Infinity;
      vis.forEach((c, k) => {
        lo = Math.min(lo, line ? c.main : c.low);
        hi = Math.max(hi, line ? c.main : c.high);
        ma.forEach(arr => { const x = arr[v.start + k]; if (x != null) { lo = Math.min(lo, x); hi = Math.max(hi, x); } });
      });
      if (this.data.showGoal) { lo = Math.min(lo, this.data.goal); hi = Math.max(hi, this.data.goal); }
      if (hi === lo) { hi += 1; lo -= 1; }
      const padV = (hi - lo) * 0.08;
      hi += padV; lo -= padV;
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

      // 每日目标虚线（文字最后画，免得被蜡烛盖住）
      const gy = this.data.showGoal ? yOf(this.data.goal) : null;
      if (gy != null) {
        ctx.save();
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = this.data.accent;
        ctx.beginPath(); ctx.moveTo(PAD.l, gy); ctx.lineTo(W - PAD.r, gy); ctx.stroke();
        ctx.restore();
      }

      if (line) {
        // 折线：主值连成平滑曲线 + 浅色面积
        const pts = vis.map((c, k) => ({ x: v.xOf(v.start + k), y: yOf(c.main) }));
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
      } else {
        // 蜡烛：影线 = 高低，实体 = 开收
        const bw = Math.max(2, v.slot * 0.62);
        vis.forEach((c, k) => {
          const x = v.xOf(v.start + k);
          const color = c.close >= c.open ? UP : DOWN;
          ctx.strokeStyle = color;
          ctx.fillStyle = color;
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(x, yOf(c.high)); ctx.lineTo(x, yOf(c.low)); ctx.stroke();
          const y1 = yOf(Math.max(c.open, c.close)), y2 = yOf(Math.min(c.open, c.close));
          ctx.fillRect(x - bw / 2, y1, bw, Math.max(1, y2 - y1));
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

      // 目标值贴在虚线右下角，垫一块白底压在蜡烛上面；太靠底放不下就贴右上角
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
      MA_N.forEach((n, j) => {
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
        const c = v.c[this._sel];
        const x = v.xOf(this._sel), y = yOf(line ? c.main : c.close);
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
        ctx.fillText(this._fmt(line ? c.main : c.close), W - PAD.r + 4, y);
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
