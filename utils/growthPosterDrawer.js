/**
 * 儿童生长评估海报绘制器
 * Canvas尺寸: 750 x 1200
 */
class GrowthPosterDrawer {
  constructor(canvas, ctx, width, height) {
    this.canvas = canvas;
    this.ctx = ctx;
    this.w = width;
    this.h = height;
  }

  /**
   * 绘制完整海报
   * @param {object} input - { gender, ageMonths, weight, height, headCirc }
   * @param {object} results - evaluate() 返回的结果
   * @param {string} ageText - 格式化的年龄文字
   */
  draw(input, results, ageText) {
    const ctx = this.ctx;
    const w = this.w;

    // 背景
    ctx.fillStyle = '#f5f6fa';
    ctx.fillRect(0, 0, w, this.h);

    let y = 0;

    // 顶部渐变色块
    const gradient = ctx.createLinearGradient(0, 0, w, 200);
    gradient.addColorStop(0, '#667eea');
    gradient.addColorStop(1, '#764ba2');
    ctx.fillStyle = gradient;
    this.roundRect(0, 0, w, 220, 0);
    ctx.fill();

    // 标题
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 36px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('儿童生长评估报告', w / 2, 60);

    ctx.font = '18px sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillText('依据 WS/T 423-2022 国家标准', w / 2, 90);

    // 儿童信息
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 26px sans-serif';
    const genderIcon = input.gender === 'male' ? '♂' : '♀';
    const genderText = input.gender === 'male' ? '男' : '女';
    ctx.fillText(genderIcon + ' ' + genderText + '  ' + ageText, w / 2, 140);

    ctx.font = '20px sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    let metricsText = '体重 ' + input.weight + 'kg · ' + (input.ageMonths < 24 ? '身长' : '身高') + ' ' + input.height + 'cm';
    if (input.headCirc) metricsText += ' · 头围 ' + input.headCirc + 'cm';
    ctx.fillText(metricsText, w / 2, 175);

    y = 240;

    // 营养状况卡片
    const nutrition = results.nutrition;
    ctx.fillStyle = '#ffffff';
    this.roundRect(24, y, w - 48, 90, 14);
    ctx.fill();

    ctx.font = 'bold 18px sans-serif';
    ctx.fillStyle = '#2c3e50';
    ctx.textAlign = 'left';
    ctx.fillText('营养状况', 48, y + 30);

    const statuses = [
      { label: '体重', value: nutrition.weightStatus },
      { label: '身高', value: nutrition.heightStatus },
      { label: '体型', value: nutrition.bodyStatus }
    ];

    const statusStartX = 48;
    const statusWidth = (w - 96) / 3;
    statuses.forEach((s, i) => {
      const sx = statusStartX + i * statusWidth;
      ctx.font = '14px sans-serif';
      ctx.fillStyle = '#95a5a6';
      ctx.textAlign = 'center';
      ctx.fillText(s.label, sx + statusWidth / 2, y + 58);
      ctx.font = 'bold 18px sans-serif';
      ctx.fillStyle = s.value === '正常' ? '#27ae60' : '#e74c3c';
      ctx.fillText(s.value, sx + statusWidth / 2, y + 80);
    });

    y += 110;

    // 指标卡片
    const indicators = [];
    const keys = ['weightForAge', 'heightForAge', 'bmiForAge', 'headCircForAge'];
    for (const key of keys) {
      if (results[key]) indicators.push(results[key]);
    }

    indicators.forEach((ind, idx) => {
      const cardH = 140;
      // 卡片背景
      ctx.fillStyle = '#ffffff';
      this.roundRect(24, y, w - 48, cardH, 14);
      ctx.fill();

      // 指标名 + 等级
      ctx.textAlign = 'left';
      ctx.font = 'bold 20px sans-serif';
      ctx.fillStyle = '#2c3e50';
      ctx.fillText(ind.name, 48, y + 30);

      // 等级标签
      const levelW = ctx.measureText(ind.level).width + 24;
      ctx.fillStyle = ind.color;
      this.roundRect(w - 48 - levelW, y + 14, levelW, 28, 14);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 16px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(ind.level, w - 48 - levelW / 2, y + 33);

      // 百分位数
      ctx.textAlign = 'left';
      ctx.font = 'bold 36px sans-serif';
      ctx.fillStyle = '#2c3e50';
      ctx.fillText(ind.percentile + '%', 48, y + 75);

      ctx.font = 'bold 36px sans-serif';
      const pWidth = ctx.measureText(ind.percentile + '%').width;
      ctx.font = '16px sans-serif';
      ctx.fillStyle = '#95a5a6';
      ctx.fillText('超过' + ind.percentile + '%的同龄儿童', 48 + pWidth + 12, y + 72);

      // 百分位条形图
      const barX = 48, barY = y + 92, barW = w - 96, barH = 14;
      // 背景条
      const zones = [
        { w: 0.03, c: '#e74c3c' },
        { w: 0.22, c: '#f39c12' },
        { w: 0.50, c: '#27ae60' },
        { w: 0.22, c: '#f39c12' },
        { w: 0.03, c: '#e74c3c' }
      ];
      let zoneX = barX;
      zones.forEach(z => {
        const zw = barW * z.w;
        ctx.fillStyle = z.c;
        ctx.fillRect(zoneX, barY, zw, barH);
        zoneX += zw;
      });
      // 圆角遮罩 (简单处理两端)
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(barX - 1, barY, 2, barH);
      ctx.fillRect(barX + barW - 1, barY, 2, barH);

      // 标记点
      const markerPct = Math.max(1, Math.min(99, ind.percentile)) / 100;
      const markerX = barX + barW * markerPct;
      ctx.fillStyle = '#2c3e50';
      ctx.beginPath();
      ctx.arc(markerX, barY + barH / 2, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(markerX, barY + barH / 2, 5, 0, Math.PI * 2);
      ctx.fill();

      // 详细值
      ctx.font = '14px sans-serif';
      ctx.fillStyle = '#bdc3c7';
      ctx.textAlign = 'left';
      ctx.fillText('测量 ' + ind.value + ind.unit + '  中位数 ' + ind.median + ind.unit + '  Z=' + ind.zScore, 48, y + 130);

      y += cardH + 12;
    });

    // 底部水印
    y += 10;
    ctx.font = '14px sans-serif';
    ctx.fillStyle = '#bdc3c7';
    ctx.textAlign = 'center';
    ctx.fillText('参考标准：WS/T 423-2022《7岁以下儿童生长标准》', w / 2, y);
    y += 24;
    ctx.fillText('搜索小程序：标记吧 免费使用', w / 2, y);
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
