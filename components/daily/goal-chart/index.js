// 每日主题 · 统计页「目标」页签的累计进度图（canvas 2d）
// 横轴默认是累计目标的整个区间（开始日 → 截止日），一屏放下；双指捏合可以横向放大（最少看 7 天），
// 放大后单指左右拖动平移，换目标时回到全程。
//   实际累计 —— 平滑曲线 + 浅色面积，画到今天，今天打一个点
//   理想进度 —— 灰色虚线，0 → 目标值的直线；曲线在它上面就是超前
//   预测     —— 从今天按目前日均往后延的虚线；能提前到就停在到达那天，末端写「预计 …」
//   目标值   —— 顶部一条细线，目标值贴在线的右下角（和 K 线图的每日目标同一个样子）
// 点一下 / 长按拖动出十字线，抛 select { index: k }（k = 第几天，-1 = 取消），页面换表头。
// burnup 是 utils/daily/burnup.js buildBurnup 的结果（经 setData 传进来，函数字段会丢，这里自己算理想值）。
// 绘制本身在 utils/daily/goalDraw.js（统计报表海报也用它），这里只管画布、窗口状态和手势；snapshot() 给海报取当前窗口。
const GD = require('../../../utils/daily/goalDraw.js');

const PAD = GD.PAD;
const LONG_PRESS_MS = 300;
const MIN_DAYS = GD.MIN_DAYS;

Component({
  properties: {
    burnup: { type: Object, value: null },
    accent: { type: String, value: '#526631' },
    targetText: { type: String, value: '' }
  },
  observers: {
    burnup() {
      this._sel = -1;
      this._k0 = null;                           // 回到全程
      this._draw();
    },
    accent() { this._draw(); }
  },
  lifetimes: {
    ready() {
      this.createSelectorQuery().select('#gc').fields({ node: true, size: true }).exec(res => {
        const r = res && res[0];
        if (!r || !r.node) return;
        const dpr = (wx.getWindowInfo ? wx.getWindowInfo().pixelRatio : 2) || 2;
        r.node.width = r.width * dpr;
        r.node.height = r.height * dpr;
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
    // 当前看的横轴窗口 [k0, k1]；没缩放过就是整个区间（夹紧的结果写回状态）
    _win() {
      const w = GD.win(this.data.burnup, this._k0, this._kw);
      if (this._k0 != null) { this._k0 = w.k0; this._kw = w.w; }
      return w;
    },

    _opts() {
      return { burnup: this.data.burnup, accent: this.data.accent, targetText: this.data.targetText };
    },

    // 页面上现在看到的样子（统计报表海报照着画）
    snapshot() {
      return { opts: this._opts(), k0: this._k0, kw: this._kw, sel: this._sel == null ? -1 : this._sel, w: this._w, h: this._h };
    },

    _draw() {
      const ctx = this._ctx;
      if (!ctx) return;
      ctx.clearRect(0, 0, this._w, this._h);
      GD.draw(ctx, this._w, this._h, this._opts(), { k0: this._k0, kw: this._kw, sel: this._sel });
    },

    // ───────── 手势：点一下 / 长按拖动出十字线（只能落在开始日到今天之间）；双指捏合缩放；放大后单指拖动平移 ─────────
    _plotW() {
      return this._w - PAD.l - PAD.r;
    },
    _indexAt(x) {
      const b = this.data.burnup;
      if (!b || b.elapsed < 1) return -1;
      const win = this._win();
      const k = Math.round(win.k0 + (x - PAD.l) / this._plotW() * win.w);
      return Math.min(b.elapsed, Math.max(1, k));
    },
    _select(i) {
      this._sel = i;
      this._draw();
      this.triggerEvent('select', { index: i });
    },
    _startPinch(t) {
      clearTimeout(this._lpTimer);
      this._scrub = false;
      this._moved = true;                        // 捏完松手不算轻点
      const win = this._win();
      const cx = (t[0].x + t[1].x) / 2;
      this._pinch = {
        d0: Math.max(1, Math.hypot(t[0].x - t[1].x, t[0].y - t[1].y)),
        w0: win.w,
        cx,
        anchor: win.k0 + (cx - PAD.l) / this._plotW() * win.w   // 两指中点对着第几天
      };
    },
    _doPinch(t) {
      const b = this.data.burnup;
      if (!b || !b.span) return;
      const P = this._pinch;
      const d = Math.max(1, Math.hypot(t[0].x - t[1].x, t[0].y - t[1].y));
      const w = Math.min(b.span, Math.max(Math.min(MIN_DAYS, b.span), P.w0 * P.d0 / d));
      this._kw = w;
      this._k0 = P.anchor - (P.cx - PAD.l) / this._plotW() * w;  // _win() 负责夹回区间内
      this._draw();
    },
    onTouchStart(e) {
      if (!this.data.burnup) return;
      if (e.touches.length >= 2) { this._startPinch(e.touches); return; }
      const t = e.touches[0];
      this._x0 = t.x;
      this._k00 = this._win().k0;
      this._moved = false;
      this._scrub = false;
      this._pinch = null;
      clearTimeout(this._lpTimer);
      this._lpTimer = setTimeout(() => { this._scrub = true; this._select(this._indexAt(this._x0)); }, LONG_PRESS_MS);
    },
    onTouchMove(e) {
      if (!this.data.burnup) return;
      if (e.touches.length >= 2) {
        if (!this._pinch) this._startPinch(e.touches);
        this._doPinch(e.touches);
        return;
      }
      if (this._pinch) return;                   // 捏合时先抬起一根手指：剩下那根不拖动
      const x = e.touches[0].x;
      if (this._scrub) { this._select(this._indexAt(x)); return; }
      const dx = x - this._x0;
      if (Math.abs(dx) < 4) return;
      this._moved = true;
      clearTimeout(this._lpTimer);
      const win = this._win();
      if (win.w >= this.data.burnup.span) return; // 没放大就没得平移
      this._k0 = this._k00 - dx / this._plotW() * win.w;
      this._draw();
    },
    onTouchEnd(e) {
      clearTimeout(this._lpTimer);
      if (this._pinch) {
        if (!e || !e.touches || !e.touches.length) this._pinch = null;
        return;
      }
      if (this._scrub || this._moved) return;
      const i = this._indexAt(this._x0);
      this._select(i === this._sel ? -1 : i);
    }
  }
});
