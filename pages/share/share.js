// pages/share/share.js
const CanvasHelper = require('../../utils/canvasHelper.js');
const DataLoader = require('../../utils/dataLoader.js');
const PosterDrawer = require('../../utils/posterDrawer.js');

Page({
  data: {
    userInfo: { nickName: '昵称', avatarUrl: '' },
    allMovies: [],
    watchedMovies: [],
    markStatusMap: {},
    stats: { watched: 0, wish: 0, unwatched: 0 },
    shareType: 'text',
    themeId: 'douban_movies',
    canvasSize: { width: 1242, height: 1660 },
    loadProgress: 0,
    isGenerating: false
  },

  canvasHelper: null,
  posterDrawer: null,

  async onLoad(options) {
    try {
      const shareType = options.type || 'text';
      const themeId = options.themeId || 'douban_movies';
      this.setData({ shareType, themeId });

      // 加载用户信息
      await this.loadUserInfo();

      // 加载数据（不依赖Canvas）
      await this.loadData();

    } catch (err) {
      console.error('页面加载失败:', err);
      wx.showModal({
        title: '加载失败',
        content: err.message || '请重试',
        showCancel: false
      });
    }
  },

  /**
   * 页面渲染完成
   */
  async onReady() {
    try {
      // 等待DOM完全渲染后再初始化Canvas
      await new Promise(resolve => setTimeout(resolve, 300));

      // 初始化Canvas
      await this.initCanvas();

      console.log('页面初始化完成');
    } catch (err) {
      console.error('Canvas初始化失败:', err);
      wx.showModal({
        title: 'Canvas初始化失败',
        content: err.message || '无法初始化画布，请重试',
        showCancel: false
      });
    }
  },

  /**
   * 加载用户信息
   */
  async loadUserInfo() {
    const userInfo = wx.getStorageSync('userInfo') || {
      nickName: '昵称',
      avatarUrl: ''
    };

    try {
      const res = await wx.cloud.getTempFileURL({
        fileList: [{
          fileID: 'cloud://cloud1-3gn3wryx716919c6.636c-cloud1-3gn3wryx716919c6-1360913831/GCGuV-qbcAAVSKH.png',
          maxAge: 60 * 60
        }]
      });

      const defaultAvatarUrl = res.fileList[0].tempFileURL;
      if (!userInfo.avatarUrl) {
        userInfo.avatarUrl = defaultAvatarUrl;
      }

      this.setData({ userInfo });
    } catch (err) {
      console.error('获取默认头像失败:', err);
      this.setData({ userInfo });
    }
  },

  /**
   * 初始化Canvas
   */
  initCanvas() {
    return new Promise((resolve, reject) => {
      const query = wx.createSelectorQuery().in(this);
      query.select('#shareCanvas')
        .fields({ node: true, size: true })
        .exec(res => {
          if (!res || !res[0] || !res[0].node) {
            console.error('Canvas节点获取失败，返回结果:', res);
            // 重试一次
            setTimeout(() => {
              const retryQuery = wx.createSelectorQuery().in(this);
              retryQuery.select('#shareCanvas')
                .fields({ node: true, size: true })
                .exec(retryRes => {
                  if (!retryRes || !retryRes[0] || !retryRes[0].node) {
                    reject(new Error('Canvas节点获取失败，请检查页面是否正常渲染'));
                    return;
                  }
                  this._setupCanvas(retryRes[0].node, resolve, reject);
                });
            }, 300);
            return;
          }

          this._setupCanvas(res[0].node, resolve, reject);
        });
    });
  },

  /**
   * 设置Canvas
   */
  _setupCanvas(canvasNode, resolve, reject) {
    try {
      const canvas = canvasNode;
      const ctx = canvas.getContext('2d');

      if (!ctx) {
        reject(new Error('无法获取Canvas 2D上下文'));
        return;
      }

      // 设置Canvas尺寸
      // 注意：这里的 canvasSize 基础宽度已经是 1242 等高分辨率数值，如果再乘 dpr 极易导致超出内存和 buffer limit
      // 我们强制将 dpr 设为 1（因为 1242 已经足够高清），或者限制其最大尺寸
      const sysInfo = wx.getWindowInfo();
      const dpr = this.data.canvasSize.width > 750 ? 1 : sysInfo.pixelRatio || 1;
      const { width, height } = this.data.canvasSize;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.scale(dpr, dpr);

      // 创建工具类实例
      this.canvasHelper = new CanvasHelper(canvas, ctx, this.data.canvasSize);
      this.posterDrawer = new PosterDrawer(this.canvasHelper);

      console.log('Canvas初始化成功');
      resolve();
    } catch (err) {
      console.error('Canvas设置失败:', err);
      reject(new Error('Canvas设置失败: ' + err.message));
    }
  },

  /**
   * 加载数据
   */
  async loadData() {
    try {
      wx.showLoading({ title: '加载数据中...' });

      const db = wx.cloud.database();
      const openid = this.data.userInfo && this.data.userInfo._openid ? this.data.userInfo._openid : '';

      // 并行加载电影和标记数据
      const [allMovies, allMarks] = await Promise.all([
        DataLoader.loadMovies(db, this.data.themeId),
        openid ? DataLoader.loadMarks(db, openid) : Promise.resolve([])
      ]);

      // 处理标记状态
      const { markStatusMap, stats, watchedMovies } =
        DataLoader.processMarks(allMarks, allMovies);

      this.setData({
        allMovies,
        markStatusMap,
        stats,
        watchedMovies
      });

      wx.hideLoading();
    } catch (err) {
      console.error('加载数据失败:', err);
      wx.hideLoading();
      wx.showToast({
        title: '加载数据失败: ' + (err.message || '未知错误'),
        icon: 'none',
        duration: 3000
      });
      throw err;
    }
  },

  /**
   * 保存图片
   */
  async saveImage() {
    if (this.data.isGenerating) {
      wx.showToast({ title: '正在生成中...', icon: 'none' });
      return;
    }

    if (!this.canvasHelper) {
      wx.showToast({ title: 'Canvas未初始化', icon: 'none' });
      return;
    }

    try {
      this.setData({ isGenerating: true });
      wx.showLoading({ title: '生成图片中...', mask: true });

      // 绘制图片
      await this.startDrawing();

      // 导出并保存
      await this.exportAndSaveImage();

      wx.showToast({ title: '保存成功', icon: 'success' });

    } catch (err) {
      console.error('保存图片失败:', err);
      wx.showModal({
        title: '保存失败',
        content: err.message || '图片生成失败,请重试',
        showCancel: false
      });
    } finally {
      this.setData({ isGenerating: false });
      wx.hideLoading();
    }
  },

  /**
   * 开始绘制
   */
  async startDrawing() {
    const { shareType } = this.data;

    // 清空画布
    this.canvasHelper.clear();

    if (shareType === 'poster') {
      await this.drawPosterWall();
    } else {
      await this.drawTextCard();
    }
  },

  /**
   * 绘制海报墙
   */
  async drawPosterWall() {
    const { width, height } = this.data.canvasSize;

    // 计算海报布局参数
    const padding = 60; // 与文字卡片保持一致的内边距
    const colsPerRow = 12;
    const gap = 12;
    const availableWidth = width - padding * 2;
    const posterWidth = Math.floor((availableWidth - gap * (colsPerRow - 1)) / colsPerRow);
    const posterHeight = Math.floor(posterWidth * 1.4);

    const startY = 120; // 标题下移，留出上方白边
    const posterAreaStartY = startY + 160; // 给标题和统计留出空间
    const posterAreaHeight = height - posterAreaStartY - 100;
    const maxRows = Math.floor(posterAreaHeight / (posterHeight + gap));
    const maxPosters = maxRows * colsPerRow;

    // 确保所有电影都能显示 - 如果电影数量超过限制，增加画布高度
    const actualMoviesCount = this.data.watchedMovies.length;
    const actualRows = Math.ceil(actualMoviesCount / colsPerRow);
    const neededHeight = posterAreaStartY + actualRows * (posterHeight + gap) + padding + 40;

    // 如果需要的高度超过当前画布高度，调整画布，保持比例
    if (neededHeight > height) {
      const newHeight = Math.min(neededHeight + 100, 5000); // 放宽最大高度以展示数百部海报
      const sysInfo = wx.getWindowInfo();
      const dpr = this.data.canvasSize.width > 750 ? 1 : sysInfo.pixelRatio || 1;
      const canvas = this.canvasHelper.canvas;
      const ctx = this.canvasHelper.ctx;
      canvas.height = newHeight * dpr;
      ctx.scale(dpr, dpr);
      this.canvasHelper.canvasSize = { width, height: newHeight };
      this.setData({ canvasSize: { width, height: newHeight } });
    }

    // 绘制背景（必须在画布尺寸调整完之后绘制）
    this.drawCardBackground();

    // 绘制标题和统计
    const ctx = this.canvasHelper.ctx;
    ctx.fillStyle = '#2c3e50';
    ctx.font = '600 36px sans-serif';
    ctx.textAlign = 'center';
    const titleText = this.data.themeId === 'imdb_movies' ? 'IMDb 电影 TOP 250 观影海报墙' : '豆瓣电影 TOP 250 观影海报墙';
    ctx.fillText(titleText, width / 2, startY);
    this.drawStats(ctx, padding, startY + 60, width - padding * 2);

    // 更新进度的回调
    const updateProgress = (progress) => {
      wx.showLoading({
        title: `生成中${progress}%`,
        mask: true
      });
    };

    // 绘制海报（传入调整后的canvasSize）
    await this.posterDrawer.drawPosterWall(
      this.data.watchedMovies,
      this.data.canvasSize,
      updateProgress
    );

    // 绘制底部 - 根据实际绘制的海报数量计算位置
    const lastPosterY = posterAreaStartY + actualRows * (posterHeight + gap);
    this.drawFooter(lastPosterY);
  },

  /**
   * 绘制文字卡片
   */
  async drawTextCard() {
    this.drawCardBackground();
    const changed = await this.drawMovieList(false);
    if (changed) {
      // 尺寸发生改变时，canvas 会被浏览器/框架完全清空
      // 必须重新填充绘制
      this.drawCardBackground();
      await this.drawMovieList(true);
    }
  },

  /**
   * 绘制卡片背景
   */
  drawCardBackground() {
    const ctx = this.canvasHelper.ctx;
    const { width, height } = this.data.canvasSize;

    // 绘制整体渐变背景作为整个画布的内容区底色
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, '#fdecec');
    gradient.addColorStop(1, '#d2f1fe');

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  },

  /**
   * 绘制电影列表
   */
  async drawMovieList(skipAdjust = false) {
    const ctx = this.canvasHelper.ctx;
    const { width } = this.data.canvasSize;
    const padding = 60; // 增加内边距
    const startY = 120; // 标题下移，留出上方白边
    const maxWidth = width - padding * 2;

    // 绘制标题
    ctx.fillStyle = '#2c3e50';
    ctx.font = '600 36px sans-serif';
    ctx.textAlign = 'center';
    const titleText = this.data.themeId === 'imdb_movies' ? 'IMDb 电影 TOP 250 观影海报墙' : '豆瓣电影 TOP 250 观影海报墙';
    ctx.fillText(titleText, width / 2, startY);

    // 绘制统计信息
    this.drawStats(ctx, padding, startY + 60, maxWidth);

    // 绘制电影标签
    const lastMovieY = this.drawMovieTags(ctx, padding, startY + 160, maxWidth);

    // 绘制底部
    const actualHeight = this.drawFooter(lastMovieY);

    // 调整画布高度
    if (!skipAdjust) {
      return this.adjustCanvasHeight(actualHeight);
    }
    return false;
  },

  /**
   * 绘制统计信息
   */
  drawStats(ctx, startX, startY, maxWidth) {
    const { stats } = this.data;
    const statItems = [
      { label: '已看', value: stats.watched, color: '#4CAF50' },
      { label: '想看', value: stats.wish, color: '#FF8F00' },
      { label: '未看', value: stats.unwatched, color: '#9E9E9E' }
    ];

    const itemWidth = 160;
    const itemHeight = 50;
    const gap = 30;
    const totalWidth = statItems.length * itemWidth + (statItems.length - 1) * gap;
    const startXCentered = startX + (maxWidth - totalWidth) / 2;

    statItems.forEach((item, index) => {
      const itemX = startXCentered + index * (itemWidth + gap);
      const itemY = startY;

      // 绘制背景
      const gradient = ctx.createLinearGradient(itemX, itemY, itemX + itemWidth, itemY + itemHeight);
      const colors = {
        '已看': ['rgba(76, 175, 80, 0.12)', 'rgba(76, 175, 80, 0.08)'],
        '想看': ['rgba(255, 193, 7, 0.12)', 'rgba(255, 193, 7, 0.08)'],
        '未看': ['rgba(158, 158, 158, 0.12)', 'rgba(158, 158, 158, 0.08)']
      };

      gradient.addColorStop(0, colors[item.label][0]);
      gradient.addColorStop(1, colors[item.label][1]);
      ctx.fillStyle = gradient;
      this.canvasHelper.drawRoundRectPath(itemX, itemY, itemWidth, itemHeight, 12);
      ctx.fill();

      // 绘制边框
      ctx.strokeStyle = item.color + '33';
      ctx.lineWidth = 1;
      this.canvasHelper.drawRoundRectPath(itemX, itemY, itemWidth, itemHeight, 12);
      ctx.stroke();

      // 绘制文字
      ctx.fillStyle = item.color;
      ctx.font = '500 18px sans-serif';
      ctx.textAlign = 'left';

      const labelText = item.label;
      const valueText = item.value.toString();
      const labelWidth = ctx.measureText(labelText).width;
      const totalTextWidth = labelWidth + ctx.measureText(valueText).width + 10;
      const textStartX = itemX + (itemWidth - totalTextWidth) / 2;

      ctx.fillText(labelText, textStartX, itemY + 32);
      ctx.font = '600 20px sans-serif';
      ctx.fillText(valueText, textStartX + labelWidth + 10, itemY + 32);
    });
  },

  /**
   * 绘制电影标签
   */
  drawMovieTags(ctx, startX, startY, maxWidth) {
    const movies = this.data.allMovies;
    const moviesPerRow = 14;
    const tagHeight = 30;
    const tagSpacing = 8;
    const rowSpacing = 14;
    const minTagWidth = 70;
    const contentPadding = 20;
    const contentMaxWidth = maxWidth - contentPadding * 2;

    const { height } = this.data.canvasSize;
    const footerHeight = 80;
    const availableHeight = height - startY - footerHeight - 60;
    const maxRows = Math.floor(availableHeight / (tagHeight + rowSpacing));
    const maxMovies = maxRows * moviesPerRow;

    let currentX = startX + contentPadding;
    let currentY = startY;
    let moviesInCurrentRow = 0;
    let moviesDrawn = 0;

    for (let i = 0; i < movies.length && moviesDrawn < maxMovies; i++) {
      const movie = movies[i];
      const status = this.data.markStatusMap[movie._id]
        ? this.data.markStatusMap[movie._id].status
        : 'unwatched';

      ctx.font = '500 18px sans-serif';
      const textWidth = ctx.measureText(movie.title).width;
      const tagWidth = Math.max(minTagWidth, textWidth + 20);

      // 换行检查
      if (moviesInCurrentRow >= moviesPerRow ||
        currentX + tagWidth > startX + contentPadding + contentMaxWidth) {
        currentX = startX + contentPadding;
        currentY += tagHeight + rowSpacing;
        moviesInCurrentRow = 0;

        if (currentY + tagHeight > height - footerHeight) {
          break;
        }
      }

      // 绘制标签
      this.drawMovieTag(ctx, currentX, currentY, tagWidth, tagHeight, movie.title, status);

      currentX += tagWidth + tagSpacing;
      moviesInCurrentRow++;
      moviesDrawn++;
    }

    // 显示剩余电影提示
    if (moviesDrawn < movies.length) {
      const remainingCount = movies.length - moviesDrawn;
      ctx.fillStyle = '#999';
      ctx.font = '18px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(
        `还有${remainingCount}部电影...`,
        startX + contentMaxWidth / 2,
        currentY + tagHeight + 20
      );
    }

    return currentY + tagHeight;
  },

  /**
   * 绘制单个电影标签
   */
  drawMovieTag(ctx, x, y, width, height, title, status) {
    // 绘制背景
    this.drawMovieTagBackground(ctx, x, y, width, height, status);
    // 绘制文字
    this.drawMovieTagText(ctx, x, y, width, height, title, status);
  },

  /**
   * 绘制标签背景
   */
  drawMovieTagBackground(ctx, x, y, width, height, status) {
    ctx.save();
    this.canvasHelper.drawRoundRectPath(x, y, width, height, height / 2);

    const styles = {
      watched: {
        gradient: ['rgba(76, 175, 80, 0.15)', 'rgba(76, 175, 80, 0.08)'],
        stroke: 'rgba(76, 175, 80, 0.3)'
      },
      wish: {
        gradient: ['rgba(255, 193, 7, 0.2)', 'rgba(255, 193, 7, 0.12)'],
        stroke: 'rgba(255, 193, 7, 0.4)'
      },
      unwatched: {
        gradient: ['rgba(158, 158, 158, 0.12)', 'rgba(158, 158, 158, 0.06)'],
        stroke: 'rgba(158, 158, 158, 0.3)'
      }
    };

    const style = styles[status] || styles.unwatched;
    const gradient = ctx.createLinearGradient(x, y, x + width, y + height);
    gradient.addColorStop(0, style.gradient[0]);
    gradient.addColorStop(1, style.gradient[1]);

    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.strokeStyle = style.stroke;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  },

  /**
   * 绘制标签文字
   */
  drawMovieTagText(ctx, x, y, width, height, title, status) {
    ctx.save();
    ctx.font = '500 18px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const colors = {
      watched: '#4CAF50',
      wish: '#FF8F00',
      unwatched: '#9E9E9E'
    };

    ctx.fillStyle = colors[status] || colors.unwatched;

    if (status === 'wish') {
      ctx.font = '600 18px sans-serif';
    }

    ctx.fillText(title, x + width / 2, y + height / 2);

    // 已看电影添加删除线
    if (status === 'watched') {
      ctx.strokeStyle = '#4CAF50';
      ctx.lineWidth = 2;
      const textY = y + height / 2;
      const textWidth = ctx.measureText(title).width;
      ctx.beginPath();
      ctx.moveTo(x + (width - textWidth) / 2, textY);
      ctx.lineTo(x + (width + textWidth) / 2, textY);
      ctx.stroke();
    }

    ctx.restore();
  },

  /**
   * 绘制底部
   */
  drawFooter(lastMovieY) {
    const { width } = this.data.canvasSize;
    const footerY = lastMovieY ? lastMovieY + 100 : 1600; // 大幅增加上方留白间距

    return footerY + 80; // 返回实际高度并增加额外底部缓冲留白
  },

  /**
   * 调整画布高度
   */
  adjustCanvasHeight(actualHeight) {
    const canvas = this.canvasHelper.canvas;
    const ctx = this.canvasHelper.ctx;
    const { width } = this.data.canvasSize;
    const newHeight = Math.min(actualHeight + 50, 2500); // 增加文字墙最大高度

    if (newHeight !== this.data.canvasSize.height) {
      const sysInfo = wx.getWindowInfo();
      const dpr = width > 750 ? 1 : sysInfo.pixelRatio || 1;
      canvas.width = width * dpr;
      canvas.height = newHeight * dpr;
      ctx.scale(dpr, dpr);

      this.canvasHelper.canvasSize = { width, height: newHeight };
      this.setData({ canvasSize: { width, height: newHeight } });
      return true; // 尺寸发生改变
    }
    return false; // 维持原尺寸
  },

  /**
   * 导出并保存图片
   */
  async exportAndSaveImage() {
    const canvas = this.canvasHelper.canvas;
    const { canvasSize } = this.data;

    if (!canvas) {
      throw new Error('Canvas未初始化');
    }

    try {
      // 先请求授权
      await this.requestSavePermission();

      // 获取设备像素比
      const sysInfo = wx.getWindowInfo();
      const dpr = canvasSize.width > 750 ? 1 : sysInfo.pixelRatio || 1;

      // 生成临时文件
      // 增加一个小延时，确保Canvas内容完全绘制完毕再导出
      const tempFilePath = await new Promise((resolve, reject) => {
        setTimeout(() => {
          console.log(`导出图片尺寸：${canvasSize.width * dpr} x ${canvasSize.height * dpr}`);
          wx.canvasToTempFilePath({
            canvas: canvas,
            x: 0,
            y: 0,
            width: canvasSize.width,
            height: canvasSize.height,
            destWidth: canvasSize.width * dpr,
            destHeight: canvasSize.height * dpr,
            fileType: 'jpg',
            quality: 0.9, // 适当降低质量以减小文件大小
            success: (res) => {
              console.log('生成临时文件成功:', res.tempFilePath);
              resolve(res.tempFilePath);
            },
            fail: (err) => {
              console.error('生成临时文件失败:', err);
              reject(new Error('生成图片失败: ' + (err.errMsg || '未知错误')));
            }
          }, this);
        }, 500);
      });

      // 保存到相册
      await new Promise((resolve, reject) => {
        wx.saveImageToPhotosAlbum({
          filePath: tempFilePath,
          success: () => {
            console.log('保存到相册成功');
            resolve();
          },
          fail: (err) => {
            console.error('保存到相册失败:', err);
            if (err.errMsg && err.errMsg.includes('auth deny')) {
              reject(new Error('需要授权保存图片到相册'));
            } else {
              reject(new Error('保存失败: ' + (err.errMsg || '未知错误')));
            }
          }
        });
      });

    } catch (err) {
      console.error('导出保存流程失败:', err);
      throw err;
    }
  },

  /**
   * 请求保存权限
   */
  async requestSavePermission() {
    try {
      const authSetting = await new Promise((resolve, reject) => {
        wx.getSetting({
          success: (res) => resolve(res.authSetting),
          fail: reject
        });
      });

      // 如果已授权，直接返回
      if (authSetting['scope.writePhotosAlbum']) {
        return true;
      }

      // 如果未授权，请求授权
      await new Promise((resolve, reject) => {
        wx.authorize({
          scope: 'scope.writePhotosAlbum',
          success: resolve,
          fail: (err) => {
            // 用户拒绝授权，引导打开设置
            if (err.errMsg && err.errMsg.includes('auth deny')) {
              wx.showModal({
                title: '需要授权',
                content: '请在设置中允许访问相册',
                confirmText: '去设置',
                success: (res) => {
                  if (res.confirm) {
                    wx.openSetting();
                  }
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
    } catch (err) {
      console.error('请求权限失败:', err);
      throw err;
    }
  },

  /**
   * 页面卸载时清理资源
   */
  onUnload() {
    if (this.canvasHelper) {
      this.canvasHelper.clearCache();
    }
  }
});
