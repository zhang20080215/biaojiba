// 每日主题 · 统计页「目标」页签的累计进度图（canvas 2d）
// 横轴固定是累计目标的整个区间（开始日 → 截止日），一屏放下，不拖动翻页。
//   实际累计 —— 平滑曲线 + 浅色面积，画到今天，今天打一个点
//   理想进度 —— 灰色虚线，0 → 目标值的直线；曲线在它上面就是超前
//   预测     —— 从今天按目前日均往后延的虚线；能提前到就停在到达那天，末端写「预计 …」
//   目标值   —— 顶部一条细线，目标值贴在线的右下角（和 K 线图的每日目标同一个样子）
// 点一下 / 长按拖动出十字线，抛 select { index: k }（k = 第几天，-1 = 取消），页面换表头。
// burnup 是 utils/daily/burnup.js buildBurnup 的结果（经 setData 传进来，函数字段会丢，这里自己算理想值）。
const M = require('../../../utils/daily/metric.js');
const { monotoneControls } = require('../../../utils/daily/chart.js');

const PAD = { l: 6, r: 50, t: 24, b: 22 };
const LONG_PRESS_MS = 300;
const GRID = '#EFEEEA';
const MUTED = '#A7A498';

Component({
  properties: {
    burnup: { type: Object, value: null },
    accent: { type: String, value: '#526631' },
    targetText: { type: String, value: '' }
  },
  observers: {
    burnup() {
      this._sel = -1;
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
    _fmt(v) {
      const b = this.data.burnup;
      return b && b.mode === 'days' ? String(Math.round(v)) : M.formatShort(Math.round(v));
    },

    _md(date) {
      return date ? date.slice(5).replace('-', '/').replace(/^0/, '').replace('/0', '/') : '';
    },

    _geo() {
      const b = this.data.burnup;
      const W = this._w, H = this._h;
      const top = PAD.t, bottom = H - PAD.b;
      const plotW = W - PAD.l - PAD.r;
      const hi = Math.max(b.target, b.walked, b.projected || 0, 1) * 1.06;
      return {
        b, W, H, top, bottom, plotW,
        xOf: k => PAD.l + k / b.span * plotW,
        yOf: v => bottom - v / hi * (bottom - top),
        hi
      };
    },

    _draw() {
      const ctx = this._ctx;
      if (!ctx) return;
      ctx.clearRect(0, 0, this._w, this._h);
      const b = this.data.burnup;
      if (!b || !b.span) return;
      const g = this._geo();
      const { W, top, bottom, xOf, yOf, hi } = g;
      const accent = this.data.accent;
      const pts = b.points.map(p => ({ x: xOf(p.k), y: yOf(p.cum) }));
      const now = pts[pts.length - 1];

      // 网格按目标值的 0 / 一半 / 四分之一、四分之三画，刻度只写 0 和一半（目标值本身贴在目标线上）——
      // 按纵轴高度三等分会写出「36万 / 72万 / 108万」这种不成数的刻度
      ctx.font = '10px sans-serif';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      [0, 0.25, 0.5, 0.75].forEach(f => {
        const y = yOf(b.target * f);
        ctx.strokeStyle = GRID;
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(W - PAD.r, y); ctx.stroke();
        const half = b.target / 2;
        if (f === 0 || (f === 0.5 && (b.mode !== 'days' || Number.isInteger(half)))) {
          ctx.fillStyle = MUTED;
          ctx.fillText(f ? this._fmt(half) : '0', W - PAD.r + 6, y);
        }
      });

      // 目标值细线
      const ty = yOf(b.target);
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = accent;
      ctx.beginPath(); ctx.moveTo(PAD.l, ty); ctx.lineTo(W - PAD.r, ty); ctx.stroke();
      ctx.globalAlpha = 1;

      // 理想进度
      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = MUTED;
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(xOf(0), yOf(0)); ctx.lineTo(xOf(b.span), ty); ctx.stroke();
      ctx.restore();

      // 实际累计
      if (pts.length > 1) {
        const segs = monotoneControls(pts);
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        segs.forEach(s => ctx.bezierCurveTo(s.c1x, s.c1y, s.c2x, s.c2y, s.x, s.y));
        ctx.strokeStyle = accent;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.lineTo(now.x, bottom);
        ctx.lineTo(pts[0].x, bottom);
        ctx.closePath();
        ctx.globalAlpha = 0.12;
        ctx.fillStyle = accent;
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      // 预测
      let projLabel = null;
      if (b.status === 'active' && b.projEndK > b.elapsed && b.walked > 0) {
        const px = xOf(b.projEndK), py = yOf(b.projected);
        ctx.save();
        ctx.setLineDash([3, 4]);
        ctx.globalAlpha = 0.65;
        ctx.strokeStyle = accent;
        ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.moveTo(now.x, now.y); ctx.lineTo(px, py); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = accent;
        ctx.beginPath(); ctx.arc(px, py, 3, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        projLabel = { x: px, y: py, text: b.finishDate ? `预计 ${this._md(b.finishDate)} 达成` : `预计 ${this._fmt(b.projected)}` };
      }

      // 文字最后画，垫白底免得被线盖住；右对齐到 x，返回占的矩形
      ctx.font = '10px sans-serif';
      const boxOf = (text, x, y) => { const tw = ctx.measureText(text).width; return { l: x - tw - 3, r: x + 3, t: y, b: y + 14 }; };
      const chip = (text, box, color) => {
        ctx.fillStyle = 'rgba(255,255,255,0.92)';
        ctx.fillRect(box.l, box.t, box.r - box.l, 14);
        ctx.fillStyle = color;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(text, box.l + 3, box.t + 2);
      };
      const hit = (p, q) => p && q && p.l < q.r && q.l < p.r && p.t < q.b && q.t < p.b;
      const tBox = this.data.targetText ? boxOf(this.data.targetText, W - PAD.r - 5, ty + 2) : null;
      if (tBox) chip(this.data.targetText, tBox, accent);
      if (projLabel) {
        // 预测末端的说明：先试点的上方（到不了目标时）/ 下方，和目标值撞了就再往下挪
        const x = Math.min(projLabel.x, W - PAD.r - 5);
        const tries = (b.finishDate ? [6, 24, 42] : [-18, 6, 24]).map(d => boxOf(projLabel.text, x, projLabel.y + d));
        const nowBox = { l: now.x - 7, r: now.x + 7, t: now.y - 7, b: now.y + 7 };
        const box = tries.find(bx => !hit(bx, tBox) && !hit(bx, nowBox) && bx.t >= top - 4 && bx.b <= bottom) || tries[tries.length - 1];
        chip(projLabel.text, box, accent);
      }

      // 今天的点（白圈压在线上，画在文字之后，不被说明盖住）
      if (pts.length > 1) {
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath(); ctx.arc(now.x, now.y, 5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = accent;
        ctx.beginPath(); ctx.arc(now.x, now.y, 3.5, 0, Math.PI * 2); ctx.fill();
      }


      // 底部日期：开始、今天、截止
      ctx.font = '10px sans-serif';
      ctx.textBaseline = 'top';
      ctx.fillStyle = MUTED;
      ctx.textAlign = 'left';
      ctx.fillText(this._md(b.startDate), PAD.l, bottom + 6);
      ctx.textAlign = 'right';
      ctx.fillText(this._md(b.endDate), W - PAD.r, bottom + 6);
      if (b.elapsed > 0 && b.elapsed < b.span && now.x - PAD.l > 36 && W - PAD.r - now.x > 36) {
        ctx.textAlign = 'center';
        ctx.fillStyle = '#6F6F68';
        ctx.fillText('今天', now.x, bottom + 6);
      }

      // 十字线
      const sel = this._sel;
      if (sel > 0 && sel < pts.length) {
        const p = pts[sel];
        ctx.save();
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = '#6F6F68';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(p.x, top); ctx.lineTo(p.x, bottom); ctx.moveTo(PAD.l, p.y); ctx.lineTo(W - PAD.r, p.y); ctx.stroke();
        ctx.restore();
        ctx.fillStyle = '#2D2D2B';
        ctx.fillRect(W - PAD.r + 1, p.y - 8, PAD.r - 2, 16);
        ctx.fillStyle = '#FFFFFF';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(this._fmt(b.points[sel].cum), W - PAD.r + 4, p.y);
      }
    },

    // ───────── 手势：点一下 / 长按拖动出十字线（只能落在开始日到今天之间）─────────
    _indexAt(x) {
      const b = this.data.burnup;
      if (!b || b.elapsed < 1) return -1;
      const k = Math.round((x - PAD.l) / (this._w - PAD.l - PAD.r) * b.span);
      return Math.min(b.elapsed, Math.max(1, k));
    },
    _select(i) {
      this._sel = i;
      this._draw();
      this.triggerEvent('select', { index: i });
    },
    onTouchStart(e) {
      const t = e.touches[0];
      this._x0 = t.x;
      this._scrub = false;
      clearTimeout(this._lpTimer);
      this._lpTimer = setTimeout(() => { this._scrub = true; this._select(this._indexAt(this._x0)); }, LONG_PRESS_MS);
    },
    onTouchMove(e) {
      if (this._scrub) this._select(this._indexAt(e.touches[0].x));
    },
    onTouchEnd() {
      clearTimeout(this._lpTimer);
      if (this._scrub) return;
      const i = this._indexAt(this._x0);
      this._select(i === this._sel ? -1 : i);
    }
  }
});
