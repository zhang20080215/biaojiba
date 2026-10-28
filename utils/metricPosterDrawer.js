/**
 * 数值型每日主题 · 分享海报绘制器（小红书 3:4，1080×1440）
 *
 * 两种版式：
 *   day   —— 单日：大进度环 + 当天数值 + 完成率 + 每日目标 + 鼓励语
 *   month —— 月度：月历热力图 + 累计 / 日均 / 达标天数
 * 纯 ctx 绘制，不加载任何图片。颜色来自 utils/daily/palette.js 的某一套全站主题色；
 * 画什么字由页面按度量算好再传进来（utils/daily/views.js 的 posterDay / posterMonth），这里只管版式，
 * 步数和睡眠共用；署名 / 空态 emoji 来自主题配置的 vocab。
 *
 * 用法：
 *   new MetricPosterDrawer(canvas, ctx).draw(data, palette, vocab)
 *   data.layout = 'day':   { title, cap, bigText, bigUnit, ratio(进度环 0~1+), statusText, subLine, cheer }
 *   data.layout = 'month': { title, subtitle, tiles:[{label,value,sub}]×3, cells(metric.buildMonthCells) }
 *   data.layout = 'empty': { title }   —— 没有数据时的占位图
 */
const P = require('./daily/palette.js');

const W = 1080;
const H = 1440;
const FONT = '"PingFang SC", "Helvetica Neue", sans-serif';
const WEEK = ['一', '二', '三', '四', '五', '六', '日'];

class MetricPosterDrawer {
  constructor(canvas, ctx) {
    this.canvas = canvas;
    this.ctx = ctx;
  }

  static get SIZE() { return { width: W, height: H }; }

  draw(data, palette, vocab) {
    const ctx = this.ctx;
    this.p = palette;
    this.v = vocab || {};
    ctx.clearRect(0, 0, W, H);
    this._background();
    if (data.layout === 'month') this._month(data);
    else if (data.layout === 'empty') this._empty(data);
    else this._day(data);
    this._footer();
  }

  // ───────── 公共 ─────────
  _background() {
    const { ctx, p } = this;
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, p.tint);
    g.addColorStop(1, '#FFFFFF');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // 右上角两枚淡色圆做点缀
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = p.soft;
    ctx.beginPath(); ctx.arc(W - 80, 120, 220, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = p.accent;
    ctx.beginPath(); ctx.arc(W - 260, 300, 70, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  }

  _footer() {
    const { ctx, p } = this;
    ctx.strokeStyle = P.mix(p.tint, p.accent, 0.25);
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(120, H - 120); ctx.lineTo(W - 120, H - 120); ctx.stroke();
    this._text(this.v.signature || '标记吧', W / 2, H - 66, 30, P.NEUTRAL.inkMuted, 'center');
  }

  _text(str, x, y, size, color, align, weight) {
    const ctx = this.ctx;
    ctx.font = `${weight || 'normal'} ${size}px ${FONT}`;
    ctx.fillStyle = color;
    ctx.textAlign = align || 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(str), x, y);
  }

  // 超宽就缩字号，返回实际字号
  _fitText(str, x, y, size, maxW, color, weight) {
    const ctx = this.ctx;
    let s = size;
    ctx.font = `${weight || 'normal'} ${s}px ${FONT}`;
    while (s > 24 && ctx.measureText(String(str)).width > maxW) {
      s -= 4;
      ctx.font = `${weight || 'normal'} ${s}px ${FONT}`;
    }
    this._text(str, x, y, s, color, 'center', weight);
    return s;
  }

  // 达标小勾：用线画，不依赖字体里有没有 ✓
  _check(cx, cy) {
    const ctx = this.ctx;
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - 9, cy);
    ctx.lineTo(cx - 3, cy + 6);
    ctx.lineTo(cx + 9, cy - 7);
    ctx.stroke();
    ctx.lineCap = 'butt';
  }

  _roundRect(x, y, w, h, r) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  }

  // ───────── 空态（这一天 / 这个月没有数据，保存按钮同时禁用） ─────────
  _empty(d) {
    this._text(d.title, 120, 190, 40, P.NEUTRAL.inkSoft, 'left');
    this._text(this.v.emoji || '', W / 2, H / 2 - 80, 120, P.NEUTRAL.ink, 'center');
    this._text(this.v.emptyText || '暂无数据', W / 2, H / 2 + 60, 40, P.NEUTRAL.inkMuted, 'center');
  }

  // ───────── 单日 ─────────
  _day(d) {
    const { ctx, p } = this;
    const ink = P.NEUTRAL.ink;
    this._text(d.title, 120, 190, 40, P.NEUTRAL.inkSoft, 'left');
    this._text(d.cap || '', 120, 262, 64, ink, 'left', 'bold');

    const cx = W / 2, cy = 690, R = 290, LW = 46;
    const ratio = Number(d.ratio) || 0;
    ctx.lineCap = 'round';
    ctx.lineWidth = LW;
    ctx.strokeStyle = P.mix(p.tint, p.accent, 0.15);
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
    if (ratio > 0) {
      ctx.strokeStyle = p.accent;
      ctx.beginPath();
      // 满圈单独画：起止角相同的 2π 弧在部分实现里会被当成空弧
      if (ratio >= 1) ctx.arc(cx, cy, R, 0, Math.PI * 2);
      else ctx.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ratio);
      ctx.stroke();
    }
    ctx.lineCap = 'butt';

    this._fitText(d.bigText, cx, cy - 20, 150, 2 * (R - LW) - 40, ink, 'bold');
    this._text(d.bigUnit || '', cx, cy + 90, 40, P.NEUTRAL.inkSoft, 'center');
    this._fitText(d.statusText || '', cx, cy + 160, 40, 2 * (R - LW) - 60, p.accent, 'bold');

    let y = cy + R + 130;
    this._fitText(d.subLine || '', cx, y, 36, W - 160, P.NEUTRAL.inkSoft);
    if (d.cheer) {
      y += 100;
      this._fitText(d.cheer, cx, y, 46, W - 200, ink, 'bold');
    }
  }

  // ───────── 月度 ─────────
  _month(d) {
    const { ctx, p } = this;
    const ink = P.NEUTRAL.ink;
    this._text(d.title, 120, 170, 64, ink, 'left', 'bold');
    this._text(d.subtitle || '', 120, 244, 36, P.NEUTRAL.inkSoft, 'left');

    // 三格统计
    const tiles = d.tiles || [];
    const tw = 260, th = 170, gap = 30, tx = (W - tw * 3 - gap * 2) / 2, ty = 310;
    tiles.forEach((t, i) => {
      const x = tx + i * (tw + gap);
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      this._roundRect(x, ty, tw, th, 28); ctx.fill();
      this._text(t.label, x + tw / 2, ty + 40, 26, P.NEUTRAL.inkMuted, 'center');
      this._fitText(t.value, x + tw / 2, ty + 92, 52, tw - 30, ink, 'bold');
      if (t.sub) this._fitText(t.sub, x + tw / 2, ty + 140, 24, tw - 24, P.NEUTRAL.inkSoft);
    });

    // 月历
    const gx = 100, gw = W - 200, col = gw / 7, cell = col - 14, top = 560;
    WEEK.forEach((w, i) => this._text(w, gx + col * i + col / 2, top, 26, P.NEUTRAL.inkMuted, 'center'));
    const cells = d.cells || [];
    const rows = Math.ceil(cells.length / 7);
    const rowH = Math.min(col, (H - 170 - (top + 40)) / rows);
    cells.forEach((c, i) => {
      if (c.empty) return;
      const x = gx + (i % 7) * col + (col - cell) / 2;
      const y = top + 40 + Math.floor(i / 7) * rowH + (rowH - cell) / 2;
      const size = Math.min(cell, rowH - 14);
      if (c.level >= 0) {
        ctx.fillStyle = p.heat[c.level];
        this._roundRect(x, y, cell, size, 18); ctx.fill();
      } else if (c.level === -1) {
        ctx.setLineDash && ctx.setLineDash([8, 8]);
        ctx.strokeStyle = P.NEUTRAL.inkMuted;
        ctx.lineWidth = 2;
        this._roundRect(x + 1, y + 1, cell - 2, size - 2, 18); ctx.stroke();
        ctx.setLineDash && ctx.setLineDash([]);
      }
      const light = c.level >= 3;
      this._text(c.day, x + cell / 2, y + size / 2, 30, light ? '#FFFFFF' : (c.level < 0 ? P.NEUTRAL.inkMuted : ink), 'center', light ? 'bold' : 'normal');
      if (c.achieved) this._check(x + cell - 24, y + 22);
    });
  }
}

module.exports = MetricPosterDrawer;
