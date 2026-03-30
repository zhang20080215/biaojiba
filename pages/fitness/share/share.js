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

  loadImage(canvas, src) {
    return new Promise((resolve, reject) => {
      const img = canvas.createImage();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
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

      const isCardio = record.category === 'cardio';

      // === Color palette ===
      const palette = isCardio ? {
        bgDark: '#080d1f',
        bgMid: '#0e1a3a',
        glow1: [60, 130, 240],    // electric blue
        glow2: [100, 180, 255],   // sky
        glow3: [180, 120, 255],   // purple accent
        accent: '#5DA0FF',
        accentBright: '#78BDFF',
        accentSoft: 'rgba(93,160,255,',
        gradA: '#4A7FD4',
        gradB: '#78BDFF',
      } : {
        bgDark: '#120a04',
        bgMid: '#1f1008',
        glow1: [255, 150, 60],    // warm orange
        glow2: [255, 100, 80],    // coral
        glow3: [255, 200, 100],   // gold accent
        accent: '#FF9A4A',
        accentBright: '#FFB870',
        accentSoft: 'rgba(255,154,74,',
        gradA: '#F08C4A',
        gradB: '#FFB870',
      };

      // ========================================
      // 1. CINEMATIC BACKGROUND — layered mesh
      // ========================================
      // Base
      ctx.fillStyle = palette.bgDark;
      ctx.fillRect(0, 0, W, H);

      // Noise-like grain texture (simulated with many tiny dots)
      ctx.globalAlpha = 0.03;
      for (let i = 0; i < 3000; i++) {
        const x = Math.random() * W;
        const y = Math.random() * H;
        const s = Math.random() * 2 + 0.5;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x, y, s, s);
      }
      ctx.globalAlpha = 1.0;

      // Large color mesh blobs (5 layers for depth)
      const blobs = [
        { x: W * 0.15, y: H * 0.12, r: 500, c: palette.glow1, a: 0.18 },
        { x: W * 0.82, y: H * 0.08, r: 400, c: palette.glow3, a: 0.12 },
        { x: W * 0.5,  y: H * 0.42, r: 550, c: palette.glow2, a: 0.10 },
        { x: W * 0.2,  y: H * 0.75, r: 420, c: palette.glow1, a: 0.08 },
        { x: W * 0.85, y: H * 0.88, r: 480, c: palette.glow2, a: 0.12 },
      ];
      blobs.forEach(b => {
        const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.r);
        g.addColorStop(0, `rgba(${b.c[0]},${b.c[1]},${b.c[2]},${b.a})`);
        g.addColorStop(0.6, `rgba(${b.c[0]},${b.c[1]},${b.c[2]},${b.a * 0.3})`);
        g.addColorStop(1, 'transparent');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
      });

      // ========================================
      // 2. FLOATING LIGHT PARTICLES
      // ========================================
      const particles = [];
      for (let i = 0; i < 40; i++) {
        particles.push({
          x: Math.random() * W,
          y: Math.random() * H,
          r: Math.random() * 4 + 1,
          a: Math.random() * 0.4 + 0.1,
        });
      }
      particles.forEach(p => {
        const pg = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 4);
        pg.addColorStop(0, `rgba(255,255,255,${p.a})`);
        pg.addColorStop(0.4, `rgba(255,255,255,${p.a * 0.3})`);
        pg.addColorStop(1, 'transparent');
        ctx.fillStyle = pg;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * 4, 0, Math.PI * 2);
        ctx.fill();
      });

      // ========================================
      // 3. TOP SECTION — Completion badge
      // ========================================
      ctx.textAlign = 'center';

      // "WORKOUT COMPLETED" — spaced-out, uppercase
      ctx.font = '600 24px sans-serif';
      ctx.fillStyle = `${palette.accentSoft}0.5)`;
      ctx.fillText('W O R K O U T   C O M P L E T E D', W / 2, 72);

      // Thin accent line under title
      const titleLineGrad = ctx.createLinearGradient(W / 2 - 160, 0, W / 2 + 160, 0);
      titleLineGrad.addColorStop(0, 'transparent');
      titleLineGrad.addColorStop(0.3, `${palette.accentSoft}0.4)`);
      titleLineGrad.addColorStop(0.7, `${palette.accentSoft}0.4)`);
      titleLineGrad.addColorStop(1, 'transparent');
      ctx.strokeStyle = titleLineGrad;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(W / 2 - 160, 90);
      ctx.lineTo(W / 2 + 160, 90);
      ctx.stroke();

      // Date
      ctx.font = '28px sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.fillText(record.date || '今天', W / 2, 124);

      // ========================================
      // 4. ILLUSTRATION — hero area with halo
      // ========================================
      const illustCX = W / 2;
      const illustCY = 400;

      // Halo glow behind illustration (large, soft)
      const halo = ctx.createRadialGradient(illustCX, illustCY, 0, illustCX, illustCY, 360);
      halo.addColorStop(0, `${palette.accentSoft}0.15)`);
      halo.addColorStop(0.5, `${palette.accentSoft}0.05)`);
      halo.addColorStop(1, 'transparent');
      ctx.fillStyle = halo;
      ctx.fillRect(0, 100, W, 600);

      // Decorative ring behind illustration
      ctx.strokeStyle = `${palette.accentSoft}0.08)`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(illustCX, illustCY, 280, 0, Math.PI * 2);
      ctx.stroke();

      // Second ring (dashed feel — two arcs)
      ctx.strokeStyle = `${palette.accentSoft}0.12)`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(illustCX, illustCY, 310, -0.8, 0.8);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(illustCX, illustCY, 310, Math.PI - 0.6, Math.PI + 0.6);
      ctx.stroke();

      // The illustration itself
      try {
        const illustImg = await this.loadImage(canvas, '/images/跑步机跑步_女.png');
        const imgRatio = illustImg.width / illustImg.height;
        const drawH = 480;
        const drawW = drawH * imgRatio;
        const imgX = illustCX - drawW / 2;
        const imgY = illustCY - drawH / 2 + 20;
        ctx.drawImage(illustImg, imgX, imgY, drawW, drawH);
      } catch (e) {
        console.error('插画加载失败:', e);
      }

      // ========================================
      // 5. GLASSMORPHISM MAIN CARD
      // ========================================
      const cardX = 60;
      const cardY = 700;
      const cardW = W - 120;
      const cardH = 700;
      const cardR = 48;

      // Card outer glow / shadow
      ctx.shadowColor = `${palette.accentSoft}0.15)`;
      ctx.shadowBlur = 80;
      ctx.shadowOffsetY = 10;
      ctx.fillStyle = 'rgba(0,0,0,0.01)';
      this.roundRect(ctx, cardX, cardY, cardW, cardH, cardR);
      ctx.fill();
      ctx.shadowColor = 'transparent';

      // Glass layer 1 — base
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      this.roundRect(ctx, cardX, cardY, cardW, cardH, cardR);
      ctx.fill();

      // Glass layer 2 — top-half highlight (frosted glass refraction)
      ctx.save();
      this.roundRect(ctx, cardX, cardY, cardW, cardH, cardR);
      ctx.clip();
      const topHighlight = ctx.createLinearGradient(0, cardY, 0, cardY + cardH * 0.5);
      topHighlight.addColorStop(0, 'rgba(255,255,255,0.10)');
      topHighlight.addColorStop(1, 'rgba(255,255,255,0.0)');
      ctx.fillStyle = topHighlight;
      ctx.fillRect(cardX, cardY, cardW, cardH * 0.5);

      // Inner light leak (diagonal prismatic streak)
      const streak = ctx.createLinearGradient(cardX, cardY, cardX + cardW * 0.7, cardY + cardH * 0.3);
      streak.addColorStop(0, 'transparent');
      streak.addColorStop(0.3, `${palette.accentSoft}0.04)`);
      streak.addColorStop(0.5, 'rgba(255,255,255,0.03)');
      streak.addColorStop(0.7, `${palette.accentSoft}0.02)`);
      streak.addColorStop(1, 'transparent');
      ctx.fillStyle = streak;
      ctx.fillRect(cardX, cardY, cardW, cardH);
      ctx.restore();

      // Glass border — prismatic gradient stroke
      const borderGrad = ctx.createLinearGradient(cardX, cardY, cardX + cardW, cardY + cardH);
      borderGrad.addColorStop(0, 'rgba(255,255,255,0.35)');
      borderGrad.addColorStop(0.25, 'rgba(255,255,255,0.10)');
      borderGrad.addColorStop(0.5, 'rgba(255,255,255,0.04)');
      borderGrad.addColorStop(0.75, 'rgba(255,255,255,0.10)');
      borderGrad.addColorStop(1, 'rgba(255,255,255,0.20)');
      ctx.strokeStyle = borderGrad;
      ctx.lineWidth = 2;
      this.roundRect(ctx, cardX, cardY, cardW, cardH, cardR);
      ctx.stroke();

      // ========================================
      // 6. CARD CONTENT
      // ========================================
      const cInnerX = cardX + 70;
      const cInnerW = cardW - 140;

      // --- Type badge (glowing pill) ---
      const badgeY = cardY + 60;
      const badgeW = 210;
      const badgeH = 54;
      const badgeX = W / 2 - badgeW / 2;

      // Badge glow
      ctx.shadowColor = `${palette.accentSoft}0.6)`;
      ctx.shadowBlur = 30;
      const bGrad = ctx.createLinearGradient(badgeX, badgeY, badgeX + badgeW, badgeY + badgeH);
      bGrad.addColorStop(0, palette.gradA);
      bGrad.addColorStop(1, palette.gradB);
      ctx.fillStyle = bGrad;
      this.roundRect(ctx, badgeX, badgeY, badgeW, badgeH, badgeH / 2);
      ctx.fill();
      ctx.shadowColor = 'transparent';

      ctx.fillStyle = '#fff';
      ctx.font = 'bold 26px sans-serif';
      ctx.fillText(isCardio ? '有氧运动' : '力量训练', W / 2, badgeY + 38);

      // --- Exercise name (hero text, white, large) ---
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 80px sans-serif';
      ctx.fillText(record.type, W / 2, badgeY + 150);

      // --- Subtle underline below exercise name ---
      const nameLineY = badgeY + 172;
      const nlGrad = ctx.createLinearGradient(W / 2 - 100, 0, W / 2 + 100, 0);
      nlGrad.addColorStop(0, 'transparent');
      nlGrad.addColorStop(0.3, `${palette.accentSoft}0.25)`);
      nlGrad.addColorStop(0.7, `${palette.accentSoft}0.25)`);
      nlGrad.addColorStop(1, 'transparent');
      ctx.strokeStyle = nlGrad;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(W / 2 - 100, nameLineY);
      ctx.lineTo(W / 2 + 100, nameLineY);
      ctx.stroke();

      // ========================================
      // 7. DATA METRICS — frosted sub-cards
      // ========================================
      const dataItems = [];
      if (record.duration) dataItems.push({ label: '时长', value: `${record.duration}`, unit: '分钟' });
      if (record.distance) dataItems.push({ label: '距离', value: `${record.distance}`, unit: record.distanceUnit || 'km' });
      if (record.sets) dataItems.push({ label: '组数', value: `${record.sets}`, unit: '组' });
      if (record.reps) dataItems.push({ label: '次数', value: `${record.reps}`, unit: '次/组' });
      if (record.weight) dataItems.push({ label: '重量', value: `${record.weight}`, unit: 'kg' });

      const dataY = badgeY + 210;
      const dataH = 210;
      const gap = 16;
      const singleW = (cInnerW - gap * (dataItems.length - 1)) / Math.max(dataItems.length, 1);

      dataItems.forEach((item, i) => {
        const sx = cInnerX + i * (singleW + gap);

        // Individual frosted metric card
        ctx.fillStyle = 'rgba(255,255,255,0.06)';
        this.roundRect(ctx, sx, dataY, singleW, dataH, 20);
        ctx.fill();

        // Metric card subtle border
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.lineWidth = 1;
        this.roundRect(ctx, sx, dataY, singleW, dataH, 20);
        ctx.stroke();

        const cx = sx + singleW / 2;

        // Label (top, small)
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        ctx.font = '24px sans-serif';
        ctx.fillText(item.label, cx, dataY + 40);

        // Value (center, big, glowing)
        ctx.shadowColor = `${palette.accentSoft}0.4)`;
        ctx.shadowBlur = 15;
        ctx.fillStyle = palette.accentBright;
        ctx.font = 'bold 72px sans-serif';
        ctx.fillText(item.value, cx, dataY + 125);
        ctx.shadowColor = 'transparent';

        // Unit (bottom)
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.font = '26px sans-serif';
        ctx.fillText(item.unit, cx, dataY + 175);
      });

      // ========================================
      // 8. MOTIVATIONAL QUOTE
      // ========================================
      const quotes = [
        '每一滴汗水都不会被辜负',
        '自律给我自由',
        '今天的努力，是明天的底气',
        '坚持是最好的天赋',
        '没有捷径，唯有坚持'
      ];
      const quote = quotes[Math.floor(Math.random() * quotes.length)];
      const quoteY = dataY + dataH + 70;
      ctx.fillStyle = 'rgba(255,255,255,0.28)';
      ctx.font = 'italic 28px sans-serif';
      ctx.fillText(`"${quote}"`, W / 2, quoteY);

      // ========================================
      // 9. USER FOOTER
      // ========================================
      const footerY = cardY + cardH + 50;

      // User avatar with luminous ring
      if (userInfo && userInfo.avatarUrl) {
        try {
          let avatarSrc = userInfo.avatarUrl;
          if (avatarSrc.startsWith('cloud://')) {
            const tempRes = await wx.cloud.getTempFileURL({ fileList: [avatarSrc] });
            if (tempRes.fileList && tempRes.fileList[0] && tempRes.fileList[0].tempFileURL) {
              avatarSrc = tempRes.fileList[0].tempFileURL;
            }
          }
          const avatarImg = await this.loadImage(canvas, avatarSrc);
          const aSize = 84;
          const aCX = W / 2;
          const aCY = footerY + aSize / 2;

          // Outer glow ring
          ctx.shadowColor = `${palette.accentSoft}0.5)`;
          ctx.shadowBlur = 25;
          const ringGrad = ctx.createLinearGradient(aCX - aSize, aCY - aSize, aCX + aSize, aCY + aSize);
          ringGrad.addColorStop(0, palette.gradA);
          ringGrad.addColorStop(1, palette.gradB);
          ctx.strokeStyle = ringGrad;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(aCX, aCY, aSize / 2 + 5, 0, Math.PI * 2);
          ctx.stroke();
          ctx.shadowColor = 'transparent';

          // Avatar clip
          ctx.save();
          ctx.beginPath();
          ctx.arc(aCX, aCY, aSize / 2, 0, Math.PI * 2);
          ctx.clip();
          ctx.drawImage(avatarImg, aCX - aSize / 2, aCY - aSize / 2, aSize, aSize);
          ctx.restore();
        } catch (e) {
          console.error('头像加载失败:', e);
        }
      }

      // Nickname
      if (userInfo && userInfo.nickName) {
        ctx.fillStyle = 'rgba(255,255,255,0.65)';
        ctx.font = '28px sans-serif';
        ctx.fillText(userInfo.nickName, W / 2, footerY + 120);
      }

      // ========================================
      // 10. BRAND FOOTER
      // ========================================
      // Divider line
      const dLineY = H - 110;
      const dGrad = ctx.createLinearGradient(W * 0.2, 0, W * 0.8, 0);
      dGrad.addColorStop(0, 'transparent');
      dGrad.addColorStop(0.3, 'rgba(255,255,255,0.08)');
      dGrad.addColorStop(0.7, 'rgba(255,255,255,0.08)');
      dGrad.addColorStop(1, 'transparent');
      ctx.strokeStyle = dGrad;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(W * 0.2, dLineY);
      ctx.lineTo(W * 0.8, dLineY);
      ctx.stroke();

      // Brand text
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.font = '24px sans-serif';
      ctx.fillText('标记吧 · 健身打卡', W / 2, H - 65);

      // Bottom accent glow bar
      const btmGrad = ctx.createLinearGradient(W / 2 - 100, 0, W / 2 + 100, 0);
      btmGrad.addColorStop(0, 'transparent');
      btmGrad.addColorStop(0.2, `${palette.accentSoft}0.5)`);
      btmGrad.addColorStop(0.5, `${palette.accentSoft}0.7)`);
      btmGrad.addColorStop(0.8, `${palette.accentSoft}0.5)`);
      btmGrad.addColorStop(1, 'transparent');
      ctx.strokeStyle = btmGrad;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(W / 2 - 100, H - 38);
      ctx.lineTo(W / 2 + 100, H - 38);
      ctx.stroke();

      this.canvas = canvas;
      this.setData({ posterReady: true });
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
