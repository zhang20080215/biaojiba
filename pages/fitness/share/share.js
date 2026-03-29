Page({
  data: {
    record: null,
    userInfo: null,
    posterReady: false,
    saving: false
  },

  onLoad() {
    const app = getApp();
    const record = app.globalData && app.globalData.fitnessRecord;
    const userInfo = app.globalData && app.globalData.fitnessUserInfo;
    if (!record) {
      wx.showToast({ title: '没有训练数据', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 1500);
      return;
    }
    this.setData({ record, userInfo });
    this.drawPoster();
  },

  onShareAppMessage() {
    return {
      title: '我刚完成了一次训练打卡！',
      path: '/pages/fitness/input/input'
    };
  },

  async drawPoster() {
    const { record, userInfo } = this.data;
    const query = wx.createSelectorQuery();
    query.select('#posterCanvas').fields({ node: true, size: true }).exec(async (res) => {
      if (!res[0]) return;
      const canvas = res[0].node;
      const ctx = canvas.getContext('2d');

      const W = 1242;
      const H = 1660;
      canvas.width = W;
      canvas.height = H;
      const dpr = W / res[0].width;

      // 背景
      const bgGrad = ctx.createLinearGradient(0, 0, W, H);
      bgGrad.addColorStop(0, '#f0f4f8');
      bgGrad.addColorStop(1, '#e8eef5');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, W, H);

      // 顶部装饰条
      const headerH = 420;
      const hGrad = ctx.createLinearGradient(0, 0, W, headerH);
      hGrad.addColorStop(0, '#4A7FD4');
      hGrad.addColorStop(0.5, '#5B9BE6');
      hGrad.addColorStop(1, '#F08C4A');
      ctx.fillStyle = hGrad;
      this.roundRect(ctx, 0, 0, W, headerH, 0);
      ctx.fill();

      // 装饰圆
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.beginPath();
      ctx.arc(W - 100, 60, 200, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(100, headerH - 40, 140, 0, Math.PI * 2);
      ctx.fill();

      // 插图区域 - 绘制装饰性健身图标
      this.drawFitnessIllustration(ctx, W, headerH, record.category);

      // 标题
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 72px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('训练打卡', W / 2, 120);

      ctx.font = '36px sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.fillText(record.date || '今天', W / 2, 180);

      // 主体卡片
      const cardY = headerH - 60;
      const cardH = 820;
      const cardX = 80;
      const cardW = W - 160;
      ctx.fillStyle = '#ffffff';
      this.roundRect(ctx, cardX, cardY, cardW, cardH, 32);
      ctx.fill();
      ctx.shadowColor = 'transparent';

      // 训练类型标签
      const badgeY = cardY + 60;
      const isCardio = record.category === 'cardio';
      const badgeGrad = ctx.createLinearGradient(cardX + 60, badgeY, cardX + 260, badgeY + 60);
      badgeGrad.addColorStop(0, isCardio ? '#4A7FD4' : '#F08C4A');
      badgeGrad.addColorStop(1, isCardio ? '#5B9BE6' : '#F0A86A');
      ctx.fillStyle = badgeGrad;
      this.roundRect(ctx, cardX + 60, badgeY, 200, 60, 30);
      ctx.fill();

      ctx.fillStyle = '#fff';
      ctx.font = 'bold 30px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(isCardio ? '有氧运动' : '力量训练', cardX + 160, badgeY + 42);

      // 训练名称
      ctx.fillStyle = '#2c3e50';
      ctx.font = 'bold 68px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(record.type, W / 2, badgeY + 160);

      // 数据展示
      const dataY = badgeY + 240;
      const dataItems = [];
      if (record.duration) dataItems.push({ label: '时长', value: `${record.duration}`, unit: '分钟' });
      if (record.distance) dataItems.push({ label: '距离', value: `${record.distance}`, unit: record.distanceUnit || 'km' });
      if (record.sets) dataItems.push({ label: '组数', value: `${record.sets}`, unit: '组' });
      if (record.reps) dataItems.push({ label: '次数', value: `${record.reps}`, unit: '次/组' });
      if (record.weight) dataItems.push({ label: '重量', value: `${record.weight}`, unit: 'kg' });

      const itemW = cardW / Math.max(dataItems.length, 1);
      dataItems.forEach((item, i) => {
        const cx = cardX + itemW * i + itemW / 2;
        // 数值
        ctx.fillStyle = isCardio ? '#4A7FD4' : '#F08C4A';
        ctx.font = 'bold 80px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(item.value, cx, dataY + 20);
        // 单位
        ctx.fillStyle = '#999';
        ctx.font = '30px sans-serif';
        ctx.fillText(item.unit, cx, dataY + 70);
        // 标签
        ctx.fillStyle = '#bbb';
        ctx.font = '28px sans-serif';
        ctx.fillText(item.label, cx, dataY + 120);

        // 分隔线
        if (i < dataItems.length - 1) {
          ctx.strokeStyle = '#f0f0f0';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(cardX + itemW * (i + 1), dataY - 60);
          ctx.lineTo(cardX + itemW * (i + 1), dataY + 140);
          ctx.stroke();
        }
      });

      // 激励语
      const quotes = [
        '每一滴汗水都不会被辜负',
        '自律给我自由',
        '今天的努力，是明天的底气',
        '坚持是最好的天赋',
        '没有捷径，唯有坚持'
      ];
      const quote = quotes[Math.floor(Math.random() * quotes.length)];
      ctx.fillStyle = '#ccc';
      ctx.font = '32px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`"${quote}"`, W / 2, cardY + cardH - 80);

      // 底部用户信息
      const footerY = cardY + cardH + 60;

      // 用户头像
      if (userInfo && userInfo.avatarUrl) {
        try {
          let avatarSrc = userInfo.avatarUrl;
          if (avatarSrc.startsWith('cloud://')) {
            const tempRes = await wx.cloud.getTempFileURL({ fileList: [avatarSrc] });
            if (tempRes.fileList && tempRes.fileList[0] && tempRes.fileList[0].tempFileURL) {
              avatarSrc = tempRes.fileList[0].tempFileURL;
            }
          }
          const avatarImg = canvas.createImage();
          await new Promise((resolve, reject) => {
            avatarImg.onload = resolve;
            avatarImg.onerror = reject;
            avatarImg.src = avatarSrc;
          });

          ctx.save();
          ctx.beginPath();
          ctx.arc(W / 2, footerY + 50, 50, 0, Math.PI * 2);
          ctx.clip();
          ctx.drawImage(avatarImg, W / 2 - 50, footerY, 100, 100);
          ctx.restore();
        } catch (e) {
          console.error('头像加载失败:', e);
        }
      }

      // 昵称
      if (userInfo && userInfo.nickName) {
        ctx.fillStyle = '#666';
        ctx.font = '32px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(userInfo.nickName, W / 2, footerY + 140);
      }

      // 底部品牌
      ctx.fillStyle = '#ccc';
      ctx.font = '26px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('标记吧 · 健身打卡', W / 2, H - 80);

      this.canvas = canvas;
      this.setData({ posterReady: true });
    });
  },

  drawFitnessIllustration(ctx, W, headerH, category) {
    const centerY = headerH / 2 + 60;

    // 画一个大的装饰圆环
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.arc(W / 2, centerY, 100, 0, Math.PI * 2);
    ctx.stroke();

    // 中间的图标文字
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.font = '80px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(category === 'cardio' ? '🏃' : '🏋️', W / 2, centerY);
    ctx.textBaseline = 'alphabetic';

    // 左右装饰小圆点
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    [
      [W / 2 - 180, centerY - 40, 16],
      [W / 2 + 180, centerY + 30, 12],
      [W / 2 - 140, centerY + 60, 10],
      [W / 2 + 150, centerY - 50, 14]
    ].forEach(([x, y, r]) => {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    });
  },

  roundRect(ctx, x, y, w, h, r) {
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
  },

  savePoster() {
    if (this.data.saving || !this.canvas) return;
    this.setData({ saving: true });

    wx.canvasToTempFilePath({
      canvas: this.canvas,
      width: 1242,
      height: 1660,
      destWidth: 1242,
      destHeight: 1660,
      success: (res) => {
        wx.saveImageToPhotosAlbum({
          filePath: res.tempFilePath,
          success: () => {
            this.setData({ saving: false });
            wx.showToast({ title: '已保存到相册', icon: 'success' });
          },
          fail: (err) => {
            this.setData({ saving: false });
            if (err.errMsg.includes('deny') || err.errMsg.includes('auth')) {
              wx.showModal({
                title: '提示',
                content: '需要授权保存图片到相册',
                confirmText: '去设置',
                success: (res) => {
                  if (res.confirm) wx.openSetting();
                }
              });
            } else {
              wx.showToast({ title: '保存失败', icon: 'none' });
            }
          }
        });
      },
      fail: () => {
        this.setData({ saving: false });
        wx.showToast({ title: '生成图片失败', icon: 'none' });
      }
    });
  }
});
