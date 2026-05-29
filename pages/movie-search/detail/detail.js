// 全平台电影评分查询：详情页
// 入参 query.doubanId → 调 fetchMovieFullInfo 拿三平台数据
// UI 沉浸式海报 + 4 评分卡浮在海报上 + 保存图片到相册（走激励广告 gate）

const toast = require('../../../utils/dailyToast.js');
const { decorateMovie } = require('../../../utils/movieFormat.js');
const CanvasHelper = require('../../../utils/canvasHelper.js');
const rewardedSaveGate = require('../../../utils/rewardedSaveGate.js');

// 海报固定尺寸 1080×1440（3:4，与详情页一致比例）
const POSTER_W = 1080;
const POSTER_H = 1440;
const FOOTER_TEXT = '全平台电影评分查询 · 微信搜「标记吧」小程序';

function getNavMetrics() {
  const fallback = { statusBarHeight: 20, navBarHeight: 44, navOffset: 64 };
  try {
    const systemInfo = wx.getSystemInfoSync ? wx.getSystemInfoSync() : {};
    const statusBarHeight = systemInfo.statusBarHeight || fallback.statusBarHeight;
    let navBarHeight = fallback.navBarHeight;
    if (wx.getMenuButtonBoundingClientRect) {
      const menu = wx.getMenuButtonBoundingClientRect();
      if (menu && menu.top && menu.height) {
        navBarHeight = (menu.top - statusBarHeight) * 2 + menu.height;
      }
    }
    return { statusBarHeight, navBarHeight, navOffset: statusBarHeight + navBarHeight };
  } catch (e) {
    return fallback;
  }
}

Page({
  data: {
    doubanId: '',
    movie: null,
    loading: false,
    error: '',
    statusBarHeight: 20,
    navBarHeight: 44,
    navOffset: 64,
    toast: { show: false, text: '', icon: '' },
    // 保存按钮 / 广告 gate
    isGenerating: false,
    needRewardedAd: false
  },

  canvasHelper: null,

  onLoad(query) {
    const navMetrics = getNavMetrics();
    this.setData({
      statusBarHeight: navMetrics.statusBarHeight,
      navBarHeight: navMetrics.navBarHeight,
      navOffset: navMetrics.navOffset
    });

    const doubanId = (query && query.doubanId) || '';
    if (!doubanId) {
      this.setData({ error: '缺少电影 ID' });
      return;
    }
    this.setData({ doubanId });
    this.fetchInfo();
    rewardedSaveGate.refreshHint(this);
  },

  async onReady() {
    // 离屏 Canvas 初始化（异步，不阻塞主体渲染）
    try {
      await new Promise(r => setTimeout(r, 100));
      await this.initCanvas();
    } catch (e) {
      console.warn('detail Canvas 初始化失败:', e && e.message);
    }
  },

  async fetchInfo() {
    if (!this.data.doubanId) return;
    if (this.data.loading) return;

    this.setData({ loading: true, error: '' });

    try {
      const res = await wx.cloud.callFunction({
        name: 'fetchMovieFullInfo',
        data: { doubanId: this.data.doubanId }
      });
      const result = res && res.result;
      if (!result || !result.success || !result.movie) {
        this.setData({
          loading: false,
          error: (result && result.error) || '获取电影数据失败'
        });
        return;
      }
      this.setData({
        loading: false,
        movie: decorateMovie(result.movie)
      });
    } catch (e) {
      console.error('fetchMovieFullInfo 异常', e);
      this.setData({ loading: false, error: '网络异常，请重试' });
    }
  },

  onRetry() {
    this.fetchInfo();
  },

  // ===== 离屏 Canvas =====
  initCanvas() {
    return new Promise((resolve, reject) => {
      const query = wx.createSelectorQuery().in(this);
      query.select('#saveCanvas').fields({ node: true, size: true }).exec(res => {
        if (!res || !res[0] || !res[0].node) {
          reject(new Error('Canvas 节点获取失败'));
          return;
        }
        const canvas = res[0].node;
        const ctx = canvas.getContext('2d');
        // 物理画布尺寸 = 海报固定尺寸（已经是 1080×1440，不再做 DPR 缩放）
        canvas.width = POSTER_W;
        canvas.height = POSTER_H;
        this.canvasHelper = new CanvasHelper(canvas, ctx, { width: POSTER_W, height: POSTER_H });
        resolve();
      });
    });
  },

  // ===== 保存按钮入口 =====
  async onSaveImage() {
    if (!this.data.movie) return;
    if (this.data.isGenerating) {
      toast.show(this, '正在生成中…');
      return;
    }

    // 1. 广告 gate
    const ok = await rewardedSaveGate.ensureGrant(this);
    if (!ok) return;

    // 2. 兜底再次初始化 Canvas（避免 onReady 时机问题）
    if (!this.canvasHelper) {
      try {
        await this.initCanvas();
      } catch (e) {
        wx.showModal({ title: '保存失败', content: '画布初始化失败，请稍后重试', showCancel: false });
        return;
      }
    }

    try {
      this.setData({ isGenerating: true });
      wx.showLoading({ title: '生成图片中…', mask: true });
      await this.drawSavePoster();
      await this.exportAndSave();
      wx.hideLoading();
      wx.showToast({ title: '保存成功', icon: 'success' });
    } catch (err) {
      wx.hideLoading();
      console.error('保存失败:', err);
      wx.showModal({ title: '保存失败', content: (err && err.message) || '请重试', showCancel: false });
    } finally {
      this.setData({ isGenerating: false });
    }
  },

  // ===== 绘制 1080×1440 海报 =====
  // 排版/间距严格对齐详情页 hero-content：rpx × 1.44 → px（750rpx 设计稿 → 1080px 海报）
  async drawSavePoster() {
    const ctx = this.canvasHelper.ctx;
    const movie = this.data.movie;
    const W = POSTER_W;  // 1080
    const H = POSTER_H;  // 1440

    // ===== 1. 海报背景 aspectFill =====
    ctx.fillStyle = '#2a3520';
    ctx.fillRect(0, 0, W, H);
    if (movie.poster) {
      try {
        let posterUrl = movie.poster;
        if (posterUrl.startsWith('cloud://')) {
          posterUrl = await this.canvasHelper.getCloudTempUrl(posterUrl);
        }
        const img = await this.canvasHelper.loadImage(posterUrl);
        const ir = img.width / img.height;
        const cr = W / H;
        let dw, dh, dx, dy;
        if (ir > cr) {
          dh = H; dw = H * ir; dy = 0; dx = (W - dw) / 2;
        } else {
          dw = W; dh = W / ir; dx = 0; dy = (H - dh) / 2;
        }
        ctx.drawImage(img, dx, dy, dw, dh);
      } catch (e) {
        console.warn('海报加载失败，使用纯色背景', e && e.message);
      }
    }

    // ===== 2. 渐变蒙层（与详情页一致：顶透 → 底 0.85 黑） =====
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(0.35, 'rgba(0,0,0,0.1)');
    grad.addColorStop(0.7, 'rgba(0,0,0,0.55)');
    grad.addColorStop(1, 'rgba(0,0,0,0.85)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // ===== 3. 详情页 rpx → 海报 px 映射（1080/750 = 1.44） =====
    // hero-content padding 32rpx h / 88rpx bottom; hero-meta 内 padding 16rpx h
    const contentX = 46;           // hero-content padding-x: 32rpx*1.44≈46
    const metaInnerX = contentX + 23;  // + hero-meta padding 16rpx*1.44=23
    const padBottom = 127;         // hero-content padding-bottom 88rpx*1.44=127
    const blockGap = 46;           // hero-content gap (var--space-4) 32rpx*1.44=46

    // 标题 / 副行 / genre
    const titleSize = 69;          // 48rpx*1.44
    const titleLH = Math.round(titleSize * 1.2);  // line-height 1.2 → 83
    const subSize = 37;            // 26rpx*1.44
    const subLH = Math.round(subSize * 1.4);      // 52
    const subMt = 14;              // 10rpx*1.44
    const genreSize = 32;          // 22rpx*1.44
    const genrePadV = 6;           // 4rpx*1.44
    const genrePadH = 23;          // 16rpx*1.44
    const genreTagH = Math.round(genreSize * 1.4) + genrePadV * 2;  // ~57
    const genreGap = 14;           // 10rpx*1.44
    const genreMt = 23;            // var--space-2 16rpx*1.44

    // 评分卡
    const ratingRowPadX = 12;      // hero-rating-row padding 0 8rpx*1.44
    const ratingGap = 17;          // 12rpx*1.44
    const ratingPadTop = 23;       // hero-rating-cell padding 16rpx*1.44
    const ratingPadBottom = 20;    // 14rpx*1.44
    const ratingLabelSize = 32;    // 22rpx*1.44
    const ratingValueMt = 14;      // 10rpx*1.44
    const ratingValueSize = 49;    // 34rpx*1.44
    const ratingVotesMt = 9;       // 6rpx*1.44
    const ratingVotesSize = 26;    // 18rpx*1.44
    const ratingRadius = 23;       // var--radius-md 16rpx*1.44

    const ratingCellH = ratingPadTop + ratingLabelSize + ratingValueMt + ratingValueSize +
                        ratingVotesMt + ratingVotesSize + ratingPadBottom;  // 173

    // ===== 4. 计算"自底向上"的 Y 坐标 =====
    const ratingY = H - padBottom - ratingCellH;

    // hero-meta 高度（标题 + sub + genre 全部存在时）
    const subParts = [];
    if (movie.year) subParts.push(movie.year);
    if (movie.directorText) subParts.push('导演 ' + movie.directorText);
    const hasSub = subParts.length > 0;
    const hasGenre = movie.genres && movie.genres.length > 0;

    let metaH = titleLH;
    if (hasSub) metaH += subMt + subLH;
    if (hasGenre) metaH += genreMt + genreTagH;

    const titleY = ratingY - blockGap - metaH;  // hero-meta top

    // ===== 5. 画标题（左对齐，与详情页 .hero-title 一致：白色 800 + text-shadow） =====
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 12;             // 8rpx*1.44≈12
    ctx.shadowOffsetY = 3;           // 2rpx*1.44≈3
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '800 ' + titleSize + 'px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    this._drawTextAutoScale(ctx, movie.title || '', metaInnerX, titleY, W - metaInnerX * 2);
    ctx.restore();

    // ===== 6. 画副行：年份 · 导演 X =====
    let nextY = titleY + titleLH;
    if (hasSub) {
      nextY += subMt;
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.4)';
      ctx.shadowBlur = 6;            // 4rpx*1.44≈6
      ctx.shadowOffsetY = 1;
      ctx.fillStyle = 'rgba(255,255,255,0.88)';
      ctx.font = '500 ' + subSize + 'px sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(subParts.join('  ·  '), metaInnerX, nextY);
      ctx.restore();
      nextY += subLH;
    }

    // ===== 7. 画 genre tags（白透底 + 白透边框 + 白字胶囊） =====
    if (hasGenre) {
      nextY += genreMt;
      ctx.save();
      ctx.font = '400 ' + genreSize + 'px sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      let cx = metaInnerX;
      const maxRight = W - metaInnerX;
      const tagBaseline = nextY + genreTagH / 2;
      movie.genres.forEach(g => {
        const tw = ctx.measureText(g).width;
        const tagW = tw + genrePadH * 2;
        // 同一行放不下就停（避免溢出，详情页里有 flex-wrap，海报里简单截断）
        if (cx + tagW > maxRight) return;
        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        this.canvasHelper.drawRoundRectPath(cx, nextY, tagW, genreTagH, genreTagH / 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.4)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = '#FFFFFF';
        ctx.fillText(g, cx + genrePadH, tagBaseline);
        cx += tagW + genreGap;
      });
      ctx.restore();
    }

    // ===== 8. 画评分卡（4 列固定宽度，少的右侧留空，与详情页一致） =====
    const ratings = this.buildRatingList(movie);
    if (ratings.length > 0) {
      const ratingsAreaX = contentX + ratingRowPadX;
      const ratingsAreaW = W - ratingsAreaX * 2;
      const cellW = Math.floor((ratingsAreaW - ratingGap * 3) / 4);  // 总是按 4 列均分
      ratings.forEach((r, i) => {
        const x = ratingsAreaX + i * (cellW + ratingGap);
        // 卡片白底
        ctx.save();
        ctx.fillStyle = 'rgba(255,255,255,0.92)';
        this.canvasHelper.drawRoundRectPath(x, ratingY, cellW, ratingCellH, ratingRadius);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.6)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.restore();

        // label "豆瓣" 22rpx 600 weight #6a7752
        ctx.fillStyle = '#6a7752';
        ctx.font = '600 ' + ratingLabelSize + 'px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(r.label, x + cellW / 2, ratingY + ratingPadTop);

        // value "9.3" 34rpx 800 weight #6a8035
        ctx.fillStyle = '#6a8035';
        ctx.font = '800 ' + ratingValueSize + 'px sans-serif';
        ctx.fillText(
          r.value,
          x + cellW / 2,
          ratingY + ratingPadTop + ratingLabelSize + ratingValueMt
        );

        // votes "110万人评" 18rpx #94a176
        ctx.fillStyle = '#94a176';
        ctx.font = '400 ' + ratingVotesSize + 'px sans-serif';
        ctx.fillText(
          r.votes,
          x + cellW / 2,
          ratingY + ratingPadTop + ratingLabelSize + ratingValueMt + ratingValueSize + ratingVotesMt
        );
      });
    }

    // ===== 9. 水印（详情页本身无水印，海报上加一行作为版权标识，缩小弱化） =====
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '400 20px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(FOOTER_TEXT, W / 2, H - 32);
  },

  // 超宽自动横向缩放避免分行（与豆瓣 share 页一致策略）
  _drawTextAutoScale(ctx, text, x, y, maxWidth) {
    const w = ctx.measureText(text).width;
    if (w <= maxWidth) {
      ctx.fillText(text, x, y);
      return;
    }
    const scale = maxWidth / w;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, 1);
    ctx.fillText(text, 0, 0);
    ctx.restore();
  },

  // 从 movie 抽 4 平台数据 + 简写副文本（缺数据的跳过）
  buildRatingList(movie) {
    const list = [];
    if (movie.douban && movie.douban.rating) {
      list.push({
        label: '豆瓣',
        value: String(movie.douban.rating),
        votes: movie.doubanVotesLabel || ''
      });
    }
    if (movie.imdb && movie.imdb.rating) {
      list.push({
        label: 'IMDB',
        value: String(movie.imdb.rating),
        votes: movie.imdbVotesLabel || ''
      });
    }
    if (movie.hasRtCritic) {
      list.push({
        label: '新鲜度',
        value: movie.rtCriticText,
        votes: movie.rtCriticCountLabel || '影评人'
      });
    }
    if (movie.hasRtAudience) {
      list.push({
        label: '爆米花',
        value: movie.rtAudienceText,
        votes: movie.rtAudienceCountLabel || '观众'
      });
    }
    return list;
  },

  // ===== 导出 + 写入相册 =====
  async exportAndSave() {
    const canvas = this.canvasHelper.canvas;
    if (!canvas) throw new Error('Canvas 未初始化');

    await this.requestSavePermission();

    // 等两帧让 Canvas 2D 把绘制提交到 bitmap（部分机型 setTimeout 不可靠）
    await new Promise(resolve => {
      canvas.requestAnimationFrame(() => canvas.requestAnimationFrame(resolve));
    });

    const tempFilePath = await new Promise((resolve, reject) => {
      wx.canvasToTempFilePath({
        canvas,
        x: 0,
        y: 0,
        width: POSTER_W,
        height: POSTER_H,
        destWidth: POSTER_W,
        destHeight: POSTER_H,
        fileType: 'jpg',
        quality: 0.92,
        success: res => resolve(res.tempFilePath),
        fail: err => reject(new Error('生成图片失败: ' + (err.errMsg || '未知错误')))
      }, this);
    });

    await new Promise((resolve, reject) => {
      wx.saveImageToPhotosAlbum({
        filePath: tempFilePath,
        success: resolve,
        fail: (err) => {
          if (err.errMsg && err.errMsg.includes('auth deny')) {
            reject(new Error('需要授权保存图片到相册'));
          } else {
            reject(new Error('保存失败: ' + (err.errMsg || '未知错误')));
          }
        }
      });
    });
  },

  async requestSavePermission() {
    const authSetting = await new Promise((resolve, reject) => {
      wx.getSetting({ success: res => resolve(res.authSetting), fail: reject });
    });
    if (authSetting['scope.writePhotosAlbum']) return true;

    await new Promise((resolve, reject) => {
      wx.authorize({
        scope: 'scope.writePhotosAlbum',
        success: resolve,
        fail: (err) => {
          if (err.errMsg && err.errMsg.includes('auth deny')) {
            wx.showModal({
              title: '需要授权',
              content: '请在设置中允许访问相册',
              confirmText: '去设置',
              success: (r) => {
                if (r.confirm) wx.openSetting();
              }
            });
            reject(new Error('用户拒绝授权'));
          } else {
            reject(err);
          }
        }
      });
    });
    return true;
  },

  onUnload() {
    if (this.canvasHelper) this.canvasHelper.clearCache();
  }
});
