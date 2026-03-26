/**
 * 儿童生长评估海报绘制器
 * Canvas尺寸: 1242 x 1660 (小红书推荐比例 3:4)
 * 风格: 明亮现代，渐变色彩，圆角卡片，适合社交分享
 */
class GrowthPosterDrawer {
  constructor(canvas, ctx, width, height) {
    this.canvas = canvas;
    this.ctx = ctx;
    this.w = width;
    this.h = height;
  }

  draw(input, results, ageText) {
    const ctx = this.ctx;
    const w = this.w;
    const h = this.h;

    // 收集指标
    const indicators = [];
    const keys = ['weightForAge', 'heightForAge', 'bmiForAge', 'headCircForAge'];
    for (const key of keys) {
      if (results[key]) indicators.push(results[key]);
    }
    const indCount = indicators.length;

    // 动态计算尺寸：4个指标时紧凑，3个时宽松
    const headerH = indCount > 3 ? 290 : 340;
    const nutritionH = indCount > 3 ? 180 : 200;
    const cardGap = indCount > 3 ? 14 : 20;
    const sectionGap = indCount > 3 ? 18 : 24;
    // 指标卡片高度自适应剩余空间
    const usedH = 50 + headerH + 30 + nutritionH + sectionGap + 100; // header + nutrition + footer
    const availH = h - usedH - sectionGap;
    const indCardH = Math.min(260, Math.floor((availH - (indCount - 1) * cardGap) / indCount));

    const pad = 60;
    const cardPad = 40;
    const cardW = w - pad * 2;
    let y = 50;

    // 性别主题色
    const isMale = input.gender === 'male';
    const theme = isMale ? {
      bg1: '#f0f4ff', bg2: '#f5f0ff', bg3: '#fff5f5', bg4: '#f0fdf4',
      deco1: '#667eea', deco2: '#5b7bd5',
      grad1: '#667eea', grad2: '#5b7bd5', grad3: '#8b9cf7',
      footerC1: 'rgba(102,126,234,0)', footerC2: 'rgba(102,126,234,0.3)', footerC3: 'rgba(91,123,213,0)'
    } : {
      bg1: '#fef0f5', bg2: '#fff0f8', bg3: '#fff5fb', bg4: '#fef5f0',
      deco1: '#f093fb', deco2: '#d6409f',
      grad1: '#f093fb', grad2: '#d6409f', grad3: '#f5b0d0',
      footerC1: 'rgba(240,147,251,0)', footerC2: 'rgba(214,64,159,0.3)', footerC3: 'rgba(240,147,251,0)'
    };

    // ========== 背景 ==========
    const bgGrad = ctx.createLinearGradient(0, 0, 0, h);
    bgGrad.addColorStop(0, theme.bg1);
    bgGrad.addColorStop(0.3, theme.bg2);
    bgGrad.addColorStop(0.7, theme.bg3);
    bgGrad.addColorStop(1, theme.bg4);
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, w, h);

    // 装饰圆形
    ctx.globalAlpha = 0.06;
    ctx.fillStyle = theme.deco1;
    ctx.beginPath();
    ctx.arc(-60, -60, 300, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = theme.deco2;
    ctx.beginPath();
    ctx.arc(w + 40, h - 200, 280, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // ========== 顶部标题卡片 ==========
    const headerGrad = ctx.createLinearGradient(pad, y, pad + cardW, y + headerH);
    headerGrad.addColorStop(0, theme.grad1);
    headerGrad.addColorStop(0.5, theme.grad2);
    headerGrad.addColorStop(1, theme.grad3);
    ctx.fillStyle = headerGrad;
    this.roundRect(pad, y, cardW, headerH, 32);
    ctx.fill();

    // 装饰光晕
    ctx.globalAlpha = 0.1;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(pad + cardW - 100, y + 80, 160, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // 标题
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 48px sans-serif';
    ctx.fillText('儿童生长发育评估', w / 2, y + 65);

    ctx.font = '26px sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillText('依据 WS/T 423-2022 国家标准', w / 2, y + 105);

    // 分割线
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad + 80, y + 130);
    ctx.lineTo(pad + cardW - 80, y + 130);
    ctx.stroke();

    // 性别图标
    ctx.fillStyle = isMale ? 'rgba(52,152,219,0.35)' : 'rgba(255,105,180,0.35)';
    ctx.beginPath();
    ctx.arc(w / 2 - 200, y + 195, 38, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 40px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(isMale ? '♂' : '♀', w / 2 - 200, y + 210);

    // 儿童信息
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 36px sans-serif';
    ctx.fillText((isMale ? '男宝宝' : '女宝宝') + ' · ' + ageText, w / 2 - 146, y + 196);

    ctx.font = '26px sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    let metricsText = '体重 ' + input.weight + 'kg    ' + (input.ageMonths < 24 ? '身长' : '身高') + ' ' + input.height + 'cm';
    if (input.headCirc) metricsText += '    头围 ' + input.headCirc + 'cm';
    ctx.fillText(metricsText, w / 2 - 146, y + 236);

    y += headerH + 30;

    // ========== 发育状况综合评价 ==========
    const nutrition = results.nutrition;
    this._drawCard(pad, y, cardW, nutritionH, 28);

    ctx.textAlign = 'left';
    ctx.font = 'bold 30px sans-serif';
    ctx.fillStyle = '#1a1a2e';
    ctx.fillText('发育状况综合评价', pad + cardPad, y + 42);

    const statuses = [
      { label: '体重', value: nutrition.weightStatus },
      { label: '身高', value: nutrition.heightStatus },
      { label: '体型', value: nutrition.bodyStatus }
    ];
    const itemW = (cardW - cardPad * 2 - 24) / 3;
    const itemY = y + 62;
    const itemH = nutritionH - 80;
    statuses.forEach((s, i) => {
      const ix = pad + cardPad + i * (itemW + 12);
      const isNormal = s.value === '正常';
      const isMild = s.value.indexOf('略') >= 0 || s.value === '偏瘦' || s.value === '超重';
      let bgColor, borderColor, textColor;
      if (isNormal) {
        bgColor = '#ecfdf5'; borderColor = '#a7f3d0'; textColor = '#059669';
      } else if (isMild) {
        bgColor = '#fffbeb'; borderColor = '#fde68a'; textColor = '#d97706';
      } else {
        bgColor = '#fef2f2'; borderColor = '#fecaca'; textColor = '#dc2626';
      }
      ctx.fillStyle = bgColor;
      this.roundRect(ix, itemY, itemW, itemH, 16);
      ctx.fill();
      ctx.strokeStyle = borderColor;
      ctx.lineWidth = 2;
      this.roundRect(ix, itemY, itemW, itemH, 16);
      ctx.stroke();

      ctx.textAlign = 'center';
      ctx.font = '22px sans-serif';
      ctx.fillStyle = '#6b7280';
      ctx.fillText(s.label, ix + itemW / 2, itemY + itemH * 0.36);
      ctx.font = 'bold 30px sans-serif';
      ctx.fillStyle = textColor;
      ctx.fillText(s.value, ix + itemW / 2, itemY + itemH * 0.76);
    });

    y += nutritionH + sectionGap;

    // ========== 指标卡片 ==========
    indicators.forEach((ind) => {
      this._drawCard(pad, y, cardW, indCardH, 28);

      const cx = pad + cardPad;
      const cw = cardW - cardPad * 2;

      // 指标名
      ctx.textAlign = 'left';
      ctx.font = 'bold 32px sans-serif';
      ctx.fillStyle = '#1a1a2e';
      ctx.fillText(ind.name, cx, y + 40);

      // 等级胶囊
      ctx.font = 'bold 24px sans-serif';
      const levelW = ctx.measureText(ind.level).width + 36;
      const levelX = pad + cardW - cardPad - levelW;
      const pillGrad = ctx.createLinearGradient(levelX, y + 18, levelX + levelW, y + 50);
      if (ind.color === '#27ae60') {
        pillGrad.addColorStop(0, '#34d399'); pillGrad.addColorStop(1, '#059669');
      } else if (ind.color === '#f39c12') {
        pillGrad.addColorStop(0, '#fbbf24'); pillGrad.addColorStop(1, '#d97706');
      } else {
        pillGrad.addColorStop(0, '#f87171'); pillGrad.addColorStop(1, '#dc2626');
      }
      ctx.fillStyle = pillGrad;
      this.roundRect(levelX, y + 18, levelW, 34, 17);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.fillText(ind.level, levelX + levelW / 2, y + 42);

      // 百分位大数字
      ctx.textAlign = 'left';
      ctx.font = 'bold 56px sans-serif';
      ctx.fillStyle = '#1a1a2e';
      ctx.fillText(ind.percentile + '%', cx, y + 102);
      const pctW = ctx.measureText(ind.percentile + '%').width;
      ctx.font = '24px sans-serif';
      ctx.fillStyle = '#9ca3af';
      ctx.fillText('超过' + ind.percentile + '%的同龄儿童', cx + pctW + 14, y + 96);

      // 百分位条
      const barX = cx;
      const barY = y + 122;
      const barW = cw;
      const barH = 20;

      ctx.fillStyle = '#e5e7eb';
      this.roundRect(barX, barY, barW, barH, barH / 2);
      ctx.fill();

      ctx.save();
      this.roundRect(barX, barY, barW, barH, barH / 2);
      ctx.clip();
      const zones = [
        { w: 0.03, c1: '#ef4444', c2: '#f87171' },
        { w: 0.22, c1: '#f87171', c2: '#fbbf24' },
        { w: 0.50, c1: '#34d399', c2: '#10b981' },
        { w: 0.22, c1: '#fbbf24', c2: '#f87171' },
        { w: 0.03, c1: '#f87171', c2: '#ef4444' }
      ];
      let zoneX = barX;
      zones.forEach(z => {
        const zw = barW * z.w;
        const zGrad = ctx.createLinearGradient(zoneX, 0, zoneX + zw, 0);
        zGrad.addColorStop(0, z.c1);
        zGrad.addColorStop(1, z.c2);
        ctx.fillStyle = zGrad;
        ctx.fillRect(zoneX, barY, zw + 1, barH);
        zoneX += zw;
      });
      ctx.restore();

      // 标记点
      const markerPct = Math.max(1, Math.min(99, ind.percentile)) / 100;
      const markerX = barX + barW * markerPct;
      const markerCY = barY + barH / 2;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(markerX, markerCY, 14, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#1a1a2e';
      ctx.beginPath();
      ctx.arc(markerX, markerCY, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(markerX, markerCY, 4, 0, Math.PI * 2);
      ctx.fill();

      // 刻度标签
      ctx.font = '20px sans-serif';
      ctx.fillStyle = '#c4c4c4';
      ctx.textAlign = 'center';
      ['3%', '25%', '50%', '75%', '97%'].forEach((label, i) => {
        ctx.fillText(label, barX + barW * [0.03, 0.25, 0.50, 0.75, 0.97][i], barY + barH + 24);
      });

      // 详细值
      ctx.font = '22px sans-serif';
      ctx.fillStyle = '#b0b8c4';
      ctx.textAlign = 'left';
      ctx.fillText('测量 ' + ind.value + ind.unit + '    中位数 ' + ind.median + ind.unit + '    Z值 ' + ind.zScore, cx, y + indCardH - 16);

      y += indCardH + cardGap;
    });

    // ========== 底部 ==========
    y += 6;
    // 装饰线
    const footerGrad = ctx.createLinearGradient(pad + 200, 0, w - pad - 200, 0);
    footerGrad.addColorStop(0, theme.footerC1);
    footerGrad.addColorStop(0.5, theme.footerC2);
    footerGrad.addColorStop(1, theme.footerC3);
    ctx.fillStyle = footerGrad;
    ctx.fillRect(pad + 200, y, cardW - 400, 2);
    y += 28;

    ctx.textAlign = 'center';
    ctx.font = '24px sans-serif';
    ctx.fillStyle = '#b0b8c4';
    ctx.fillText('参考标准：WS/T 423-2022《7岁以下儿童生长标准》', w / 2, y);
    y += 36;
    ctx.font = 'bold 28px sans-serif';
    ctx.fillStyle = '#9ca3af';
    ctx.fillText('小程序「标记吧」· 免费使用', w / 2, y);
  }

  _drawCard(x, y, w, h, r) {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(0,0,0,0.04)';
    this.roundRect(x + 2, y + 4, w, h, r);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    this.roundRect(x, y, w, h, r);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.05)';
    ctx.lineWidth = 1;
    this.roundRect(x, y, w, h, r);
    ctx.stroke();
  }

  roundRect(x, y, w, h, r) {
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

module.exports = GrowthPosterDrawer;
