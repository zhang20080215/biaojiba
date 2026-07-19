/**
 * 每日运动 · 分享卡片绘制器（小红书 3:4，1080×1440）
 * 纯 ctx 绘制 + emoji，不加载任何网络图。
 *
 * 视觉（参考用户给定的清新打卡清单图，按本项目审美优化）：
 *   浅色渐变底 + 角落点阵/淡色圆装饰；标题「X月X日运动打卡」+ 蓝色下划线；
 *   下方为「编号徽章 + 柔彩 emoji 圆 + 名称 + 竖向点线分隔 + 数据(小图标+文字)」的扁平编号清单；
 *   时长/距离用蓝色图标，组次/重量用橙色图标；底部金句 + 标记吧署名。
 *
 * 用法：
 *   const drawer = new SportPosterDrawer(canvas, ctx, 1080, 1440);
 *   drawer.draw(dayData);
 *
 * dayData = {
 *   dateLabel: '6月17日',
 *   weekdayLabel: '周三',
 *   cheer: '坚持运动，遇见更好的自己',
 *   entries: [{ category, icon, typeName, duration, distance, distanceUnit, sets, reps, weight }]
 * }
 */

const sportIcons = require('./sportIcons.js');

// 文字色（各主题共用）
const TEXT = {
  ink:     '#222B45',   // 标题/名称（深藏蓝，略柔于纯黑）
  inkMid:  '#454E66',   // 数据文字
  inkSoft: '#838BA0',   // 次要文字
  white:   '#FFFFFF'
};

/**
 * 主题预设：4 套清新配色。
 *   primary —— 编号徽章/下划线/时长·距离图标/角落装饰主色
 *   accent  —— 组次·重量图标 + 点缀（与 primary 形成对比，便于区分数据类型）
 *   *Rgb    —— 供半透明装饰派生（角落淡圆/闪光/圆环）
 *   pastels —— emoji 圆的柔彩底（按行号轮换）
 */
const THEMES = {
  blue: {
    id: 'blue', name: '经典蓝', swatch: '#3D6BFF',
    primary: '#3D6BFF', primaryRgb: '61,107,255',
    accent:  '#FF913F', accentRgb:  '255,145,63',
    dot: '#D3DCF1', deco: '#DCE4F5', bgTop: '#FAFBFF', bgBot: '#E4E9F6',
    pastels: ['#E4ECFF', '#FFE8D6', '#FFF4D6', '#E2F4E8', '#EEE7FF', '#FFE4EC']
  },
  mint: {
    id: 'mint', name: '薄荷绿', swatch: '#16B98C',
    primary: '#16B98C', primaryRgb: '22,185,140',
    accent:  '#FF9F45', accentRgb:  '255,159,69',
    dot: '#CDEBE0', deco: '#D7EFE6', bgTop: '#F8FFFC', bgBot: '#DCF1EA',
    pastels: ['#D9F3EA', '#FFE8D6', '#FFF4D6', '#DCEFFE', '#E7F0E0', '#FFE4EC']
  },
  sakura: {
    id: 'sakura', name: '樱花粉', swatch: '#FF6E9C',
    primary: '#FF6E9C', primaryRgb: '255,110,156',
    accent:  '#7A6BFF', accentRgb:  '122,107,255',
    dot: '#F6D5E2', deco: '#F8DCE6', bgTop: '#FFFAFC', bgBot: '#F8E6EE',
    pastels: ['#FFE0EC', '#EDE7FF', '#FFF0D6', '#E2F4E8', '#FFE8E0', '#E4ECFF']
  },
  sunset: {
    id: 'sunset', name: '暖橙', swatch: '#FF7A3D',
    primary: '#FF7A3D', primaryRgb: '255,122,61',
    accent:  '#12B5A6', accentRgb:  '18,181,166',
    dot: '#F6DCC9', deco: '#F8E2D2', bgTop: '#FFFCFA', bgBot: '#F7E6DA',
    pastels: ['#FFE8D6', '#D9F1EE', '#FFF4D6', '#FFE0EC', '#FBEAD8', '#E2F4E8']
  }
};

const DEFAULT_THEME = 'blue';

function resolveTheme(id) {
  const t = THEMES[id] || THEMES[DEFAULT_THEME];
  return Object.assign({}, TEXT, t);
}

// 供前端渲染色卡用：[{ id, name, swatch }]
const THEME_LIST = Object.keys(THEMES).map(k => ({
  id: THEMES[k].id, name: THEMES[k].name, swatch: THEMES[k].swatch
}));

function tidyNum(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '';
  return String(Math.round(v * 100) / 100);
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

class SportPosterDrawer {
  constructor(canvas, ctx, width, height) {
    this.canvas = canvas;
    this.ctx = ctx;
    this.w = width;
    this.h = height;
  }

  // illus: 可选，已加载好的运动插画 Image（canvas.createImage 得到）；放右下角
  // themeId: 主题色 id（'blue' | 'mint' | 'sakura' | 'sunset'），缺省走 blue
  draw(dayData, illus, themeId) {
    this.C = resolveTheme(themeId);
    const ctx = this.ctx;
    const w = this.w;
    const h = this.h;
    const data = dayData || {};
    const entries = (data.entries || []).slice(0, 10);
    const hasIllus = !!(illus && illus.width && illus.height);

    this._drawBackground();

    const PAD = 84;

    // ---- 标题 ----
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    const title = `${data.dateLabel || ''}运动打卡`;
    const titleY = 228;
    ctx.font = '700 58px sans-serif';
    ctx.fillStyle = this.C.ink;
    ctx.fillText(title, PAD, titleY);

    // 标题旁的闪光点缀
    const titleEnd = PAD + ctx.measureText(title).width;
    this._sparkle(titleEnd + 40, titleY - 44, 20, this._rgba(this.C.accentRgb, 0.85));
    this._sparkle(titleEnd + 80, titleY - 6, 11, this._rgba(this.C.primaryRgb, 0.6));

    // 下划线 + 末端圆点
    const ulY = titleY + 28;
    this._roundRectPath(PAD, ulY, 150, 8, 4);
    ctx.fillStyle = this.C.primary;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(PAD + 150 + 22, ulY + 4, 6, 0, Math.PI * 2);
    ctx.fillStyle = this._rgba(this.C.primaryRgb, 0.4);
    ctx.fill();

    // ---- 清单 ----
    const cardX = 52;
    const cardW = w - cardX * 2;
    const areaTop = 322;
    // 有插画时给右下角留出空间，清单整体上收
    const areaBottom = hasIllus ? h - 400 : h - 132;
    const N = entries.length || 1;
    const gap = 18;
    // 行高压低（更秀气），且顶部对齐 —— 列表自然上收，底部留白增大
    const rowH = clamp((areaBottom - areaTop - (N - 1) * gap) / N, 78, 100);
    let y = areaTop;

    entries.forEach((e, i) => {
      this._drawRow(cardX, y, cardW, rowH, i + 1, e);
      if (i < entries.length - 1) this._rowDivider(cardX + 26, cardX + cardW - 26, y + rowH + gap / 2);
      y += rowH + gap;
    });

    // ---- 右下角插画 ----
    if (hasIllus) this._drawIllus(illus);

    // ---- 底部：标签式水印（左下角） ----
    this._drawWatermarkTag(84, h - 64, '小程序：标记吧，免费制作同款图');

    ctx.textAlign = 'left';
  }

  // 左对齐标签式水印（小圆点 + 文字的浅色 chip）
  _drawWatermarkTag(x, cy, text) {
    const ctx = this.ctx;
    const padX = 22;
    const tagH = 46;
    const dotR = 5;
    const lead = dotR * 2 + 12; // 圆点占位 + 间距
    ctx.font = '500 24px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const tw = ctx.measureText(text).width;
    const tagW = padX + lead + tw + padX;

    // chip 底 + 浅描边
    this._roundRectPath(x, cy - tagH / 2, tagW, tagH, tagH / 2);
    ctx.fillStyle = 'rgba(255,255,255,0.72)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(120,132,168,0.22)';
    ctx.stroke();

    // 前置小圆点（主题色）
    ctx.beginPath();
    ctx.arc(x + padX + dotR, cy, dotR, 0, Math.PI * 2);
    ctx.fillStyle = this.C.primary;
    ctx.fill();

    // 文字
    ctx.fillStyle = this.C.inkSoft;
    ctx.fillText(text, x + padX + lead, cy + 1);
  }

  // 右下角等比放置插画（contain 进目标框，再贴右下角）
  _drawIllus(img) {
    const ctx = this.ctx;
    const boxW = 380, boxH = 348, mR = 34, mB = 22;
    const scale = Math.min(boxW / img.width, boxH / img.height);
    const dw = img.width * scale;
    const dh = img.height * scale;
    const dx = this.w - mR - dw;
    const dy = this.h - mB - dh;
    ctx.drawImage(img, dx, dy, dw, dh);
  }

  // ============ 背景 ============

  _drawBackground() {
    const ctx = this.ctx;
    const w = this.w;
    const h = this.h;

    const g = ctx.createLinearGradient(0, 0, w * 0.5, h);
    g.addColorStop(0, this.C.bgTop);
    g.addColorStop(1, this.C.bgBot);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    // 淡色大圆（右上 / 右下）
    ctx.fillStyle = this._rgba(this.C.primaryRgb, 0.04);
    ctx.beginPath();
    ctx.arc(w - 40, 60, 250, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = this._rgba(this.C.primaryRgb, 0.035);
    ctx.beginPath();
    ctx.arc(w + 40, h - 120, 220, 0, Math.PI * 2);
    ctx.fill();

    // 角落点阵（轻盈）
    this._dotGrid(96, 100, 6, 3, 26, 4, this.C.deco);
    this._dotGrid(70, h - 230, 5, 3, 26, 4, this.C.deco);

    // 角落小点缀（闪光 / 描边圈 / 加号）
    this._ring(w - 150, 156, 30, 5, this._rgba(this.C.primaryRgb, 0.16));
    this._sparkle(w - 92, 250, 17, this._rgba(this.C.accentRgb, 0.5));
    this._sparkle(w - 218, 308, 10, this._rgba(this.C.primaryRgb, 0.32));
    this._plus(132, h - 300, 13, 4, this._rgba(this.C.accentRgb, 0.34));
    this._ring(60, h - 150, 16, 4, this._rgba(this.C.primaryRgb, 0.16));
  }

  _dotGrid(x, y, cols, rows, step, r, color) {
    const ctx = this.ctx;
    ctx.fillStyle = color;
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        ctx.beginPath();
        ctx.arc(x + i * step, y + j * step, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // 四角闪光 ✦（填充）
  _sparkle(cx, cy, r, color) {
    const ctx = this.ctx;
    const inner = r * 0.34;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const rad = i % 2 === 0 ? r : inner;
      const a = -Math.PI / 2 + i * Math.PI / 4;
      const px = cx + Math.cos(a) * rad;
      const py = cy + Math.sin(a) * rad;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }

  // 描边圆环
  _ring(cx, cy, r, lw, color) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.lineWidth = lw;
    ctx.strokeStyle = color;
    ctx.stroke();
  }

  // 加号
  _plus(cx, cy, r, lw, color) {
    const ctx = this.ctx;
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - r, cy); ctx.lineTo(cx + r, cy);
    ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy + r);
    ctx.stroke();
  }

  // ============ 单行 ============

  _drawRow(x, y, w, rowH, num, e) {
    const ctx = this.ctx;
    const cy = y + rowH / 2;
    const f = clamp(rowH / 116, 0.76, 1); // 行内元素随行高缩放（基准下调，行矮但内容不过小）

    // 编号徽章（蓝色圆角方块）
    const bS = 58 * f;
    const bx = x + 30 * f;
    this._roundRectPath(bx, cy - bS / 2, bS, bS, 17 * f);
    ctx.fillStyle = this.C.primary;
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = this.C.white;
    ctx.font = `600 ${29 * f}px sans-serif`;
    ctx.fillText(String(num), bx + bS / 2, cy + 1);

    // 柔彩 emoji 圆
    const dia = 82 * f;
    const ccx = bx + bS + 22 * f + dia / 2;
    ctx.beginPath();
    ctx.arc(ccx, cy, dia / 2, 0, Math.PI * 2);
    ctx.fillStyle = this.C.pastels[(num - 1) % this.C.pastels.length];
    ctx.fill();
    // 自定义线性图标（替代 emoji）
    const iconSize = dia * 0.56;
    sportIcons.drawIcon(ctx, sportIcons.keyForType(e.typeName), ccx - iconSize / 2, cy - iconSize / 2, iconSize, this.C.ink, 2);

    // 名称
    const nameX = ccx + dia / 2 + 24 * f;
    const sepX = x + 408;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = `600 ${33 * f}px sans-serif`;
    ctx.fillStyle = this.C.ink;
    ctx.fillText(this._truncate(e.typeName || '运动', sepX - nameX - 18), nameX, cy + 1);

    // 竖向点线分隔
    this._dottedV(sepX, cy - 26 * f, cy + 26 * f, this.C.dot);

    // 数据列（最多两项，固定列位对齐；两列间距收紧）
    const items = this._entryItems(e);
    const colX = [x + 438, x + 624];
    items.slice(0, 2).forEach((it, idx) => {
      this._drawDataItem(colX[idx], cy, it, f);
    });
  }

  _drawDataItem(x, cy, item, f) {
    const ctx = this.ctx;
    const isz = 29 * f;
    this._dataIcon(item.icon, x + isz / 2, cy, isz, item.color);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = `500 ${27 * f}px sans-serif`;
    ctx.fillStyle = this.C.inkMid;
    ctx.fillText(item.text, x + isz + 12 * f, cy + 1);
  }

  // 单条记录 → 数据项数组 [{icon, color, text}]
  _entryItems(e) {
    const cat = e.category;
    const items = [];
    if (cat === 'cardio') {
      if (Number(e.duration) > 0) items.push({ icon: 'clock', color: this.C.primary, text: `${tidyNum(e.duration)}分钟` });
      if (Number(e.distance) > 0) items.push({ icon: 'pin', color: this.C.primary, text: `${tidyNum(e.distance)}${(e.distanceUnit || 'km').toUpperCase()}` });
    } else if (cat === 'flexibility') {
      if (Number(e.duration) > 0) items.push({ icon: 'clock', color: this.C.primary, text: `${tidyNum(e.duration)}分钟` });
    } else {
      if (Number(e.sets) > 0 && Number(e.reps) > 0) {
        items.push({ icon: 'dumbbell', color: this.C.accent, text: `${tidyNum(e.sets)}组 × ${tidyNum(e.reps)}次` });
        if (Number(e.weight) > 0) items.push({ icon: 'weight', color: this.C.accent, text: `${tidyNum(e.weight)}KG` });
      } else if (Number(e.duration) > 0) {
        items.push({ icon: 'clock', color: this.C.primary, text: `${tidyNum(e.duration)}分钟` });
      }
    }
    return items;
  }

  // ============ 小数据图标（24-grid 描边） ============

  _dataIcon(type, cx, cy, s, color) {
    const ctx = this.ctx;
    const ox = cx - s / 2, oy = cy - s / 2;
    const u = s / 24;
    const X = v => ox + v * u;
    const Y = v => oy + v * u;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = Math.max(1.8, s * 0.082);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (type === 'clock') {
      ctx.beginPath();
      ctx.arc(X(12), Y(12), 8.6 * u, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(X(12), Y(12)); ctx.lineTo(X(12), Y(7));
      ctx.moveTo(X(12), Y(12)); ctx.lineTo(X(16), Y(13.4));
      ctx.stroke();
    } else if (type === 'pin') {
      ctx.beginPath();
      ctx.moveTo(X(12), Y(21.5));
      ctx.lineTo(X(6.4), Y(12));
      ctx.arc(X(12), Y(9), 6.4 * u, Math.PI * 0.82, Math.PI * 0.18, false);
      ctx.closePath();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(X(12), Y(9), 2.4 * u, 0, Math.PI * 2);
      ctx.stroke();
    } else if (type === 'dumbbell') {
      const L = (a, b, c, d) => { ctx.beginPath(); ctx.moveTo(X(a), Y(b)); ctx.lineTo(X(c), Y(d)); ctx.stroke(); };
      L(4, 9, 4, 15);
      L(7.5, 6.5, 7.5, 17.5);
      L(16.5, 6.5, 16.5, 17.5);
      L(20, 9, 20, 15);
      L(7.5, 12, 16.5, 12);
    } else if (type === 'weight') {
      // 把手
      ctx.beginPath();
      ctx.arc(X(12), Y(9.5), 4 * u, Math.PI * 1.16, Math.PI * 1.84, false);
      ctx.stroke();
      // 配重身
      this._roundRectPath(X(6.4), Y(9.5), 11.2 * u, 10.5 * u, 3 * u);
      ctx.stroke();
    }
  }

  // ============ 工具 ============

  // 'r,g,b' + alpha → 'rgba(r,g,b,a)'
  _rgba(rgb, a) {
    return `rgba(${rgb},${a})`;
  }

  // 行间浅色分隔线（去白卡后用来分行）
  _rowDivider(x0, x1, yy) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(x0, yy);
    ctx.lineTo(x1, yy);
    ctx.strokeStyle = 'rgba(120,132,168,0.20)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  _dottedV(x, y0, y1, color) {
    const ctx = this.ctx;
    ctx.fillStyle = color;
    const step = 11;
    for (let yy = y0; yy <= y1; yy += step) {
      ctx.beginPath();
      ctx.arc(x, yy, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  _truncate(text, maxWidth) {
    const ctx = this.ctx;
    let str = String(text == null ? '' : text);
    if (ctx.measureText(str).width <= maxWidth) return str;
    while (str.length > 0 && ctx.measureText(str + '…').width > maxWidth) {
      str = str.slice(0, -1);
    }
    return str + '…';
  }

  _roundRectPath(x, y, w, h, r) {
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
}

SportPosterDrawer.THEMES = THEME_LIST;
SportPosterDrawer.DEFAULT_THEME = DEFAULT_THEME;

module.exports = SportPosterDrawer;
