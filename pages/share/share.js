Page({
  data: {
    userInfo: {
      nickName: '昵称',
      avatarUrl: ''
    },
    allMovies: [],
    watchedMovies: [],
    markStatusMap: {},
    stats: { watched: 0, wish: 0, unwatched: 0 },
    canvas: null,
    ctx: null,
    shareType: 'text',
    defaultAvatar: '',
    canvasSize: { width: 0, height: 0 }
  },

  onLoad(options) {
    const shareType = options.type || 'text';
    this.setData({ shareType });

    const userInfo = wx.getStorageSync('userInfo') || {
      nickName: '昵称',
      avatarUrl: ''
    };
    
    // 获取默认头像的临时URL
    wx.cloud.getTempFileURL({
      fileList: [{
        fileID: 'cloud://cloud1-3gn3wryx716919c6.636c-cloud1-3gn3wryx716919c6-1360913831/GCGuV-qbcAAVSKH.png',
        maxAge: 60 * 60, // 有效期1小时
      }]
    }).then(res => {
      const defaultAvatarUrl = res.fileList[0].tempFileURL;
      if (!userInfo.avatarUrl) {
        userInfo.avatarUrl = defaultAvatarUrl;
      }
      this.setData({ 
        userInfo,
        defaultAvatar: defaultAvatarUrl
      }, () => {
        this.loadData();
        this.initCanvas();
      });
    }).catch(err => {
      console.error('获取默认头像失败', err);
      this.setData({ userInfo }, () => {
        this.loadData();
        this.initCanvas();
      });
    });
  },

  initCanvas() {
    const query = wx.createSelectorQuery();
    query.select('#shareCanvas')
      .fields({ node: true, size: true })
      .exec(res => {
        if (!res[0] || !res[0].node) {
          wx.showToast({ title: 'Canvas 初始化失败', icon: 'none' });
          return;
        }
        const canvas = res[0].node;
        const ctx = canvas.getContext('2d');
        
        // 设置合适的Canvas尺寸 - 1242*2000 (增加高度以显示完整电影)
        const dpr = wx.getWindowInfo().pixelRatio;
        const width = 1242; // 保持宽度
        const height = 2000; // 增加高度以显示更多电影
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        ctx.scale(dpr, dpr);
        
        this.setData({ 
          canvas, 
          ctx,
          canvasSize: { width, height }
        });
      });
  },

  loadData() {
    const db = wx.cloud.database();
    const openid = this.data.userInfo._openid;
    const MAX_LIMIT = 20;
    db.collection('movies').count().then(res => {
      const total = res.total;
      const batchTimes = Math.ceil(total / MAX_LIMIT);
      const tasks = [];
      for (let i = 0; i < batchTimes; i++) {
        const promise = db.collection('movies')
          .orderBy('rank', 'asc')
          .skip(i * MAX_LIMIT)
          .limit(MAX_LIMIT)
          .get();
        tasks.push(promise);
      }
      Promise.all(tasks).then(results => {
        let allMovies = [];
        results.forEach(res => allMovies = allMovies.concat(res.data));
        allMovies = allMovies.map(m => ({ ...m, _id: String(m._id) }));
        this.setData({ allMovies });

        db.collection('Marks').where({ openid }).count().then(countRes => {
          const total = countRes.total;
          const batchTimes = Math.ceil(total / MAX_LIMIT);
          const tasks = [];
          for (let i = 0; i < batchTimes; i++) {
            const promise = db.collection('Marks')
              .where({ openid })
              .skip(i * MAX_LIMIT)
              .limit(MAX_LIMIT)
              .get();
            tasks.push(promise);
          }
          Promise.all(tasks).then(results => {
            let allMarks = [];
            results.forEach(res => allMarks = allMarks.concat(res.data));
            const markStatusMap = {};
            allMarks.forEach(item => {
              const mid = String(item.movieId);
              if (!markStatusMap[mid] || new Date(item.marked_at) > new Date(markStatusMap[mid].marked_at)) {
                markStatusMap[mid] = item;
              }
            });
            const stats = { watched: 0, wish: 0, unwatched: 0 };
            const watchedMovies = [];

            allMovies.forEach(movie => {
              const mark = markStatusMap[movie._id];
              if (mark) {
                if (mark.status === 'watched') {
                  stats.watched++;
                  watchedMovies.push(movie);
                }
                else if (mark.status === 'wish') stats.wish++;
              } else {
                stats.unwatched++;
              }
            });

            this.setData({ 
              markStatusMap, 
              stats,
              watchedMovies
            });
          });
        });
      });
    });
  },

  drawAvatar(ctx, avatarUrl, x, y, size, cb) {
    // 如果是微信头像URL，需要先下载到本地
    if (avatarUrl.startsWith('https://thirdwx.qlogo.cn')) {
      wx.downloadFile({
        url: avatarUrl,
        success: res => {
          if (res.statusCode === 200) {
            this.drawAvatarImage(ctx, res.tempFilePath, x, y, size, cb);
          } else {
            this.drawDefaultAvatar(ctx, x, y, size, cb);
          }
        },
        fail: () => {
          this.drawDefaultAvatar(ctx, x, y, size, cb);
        }
      });
    } else {
      this.drawAvatarImage(ctx, avatarUrl, x, y, size, cb);
    }
  },

  drawAvatarImage(ctx, avatarUrl, x, y, size, cb) {
    wx.getImageInfo({
      src: avatarUrl,
      success: res => {
        ctx.save();
        ctx.beginPath();
        ctx.arc(x + size / 2, y + size / 2, size / 2, 0, 2 * Math.PI);
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(res.path, x, y, size, size);
        ctx.restore();
        if (cb) cb();
      },
      fail: () => {
        this.drawDefaultAvatar(ctx, x, y, size, cb);
      }
    });
  },

  drawDefaultAvatar(ctx, x, y, size, cb) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x + size / 2, y + size / 2, size / 2, 0, 2 * Math.PI);
    ctx.closePath();
    ctx.clip();
    ctx.fillStyle = "#eee";
    ctx.fillRect(x, y, size, size);
    ctx.restore();
    if (cb) cb();
  },

  drawRoundRect(ctx, x, y, w, h, r) {
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

  saveImage() {
    const { canvas, ctx, shareType } = this.data;
    if (!canvas || !ctx) {
      wx.showToast({ title: 'Canvas 未初始化', icon: 'none' });
      return;
    }

    // 直接开始生成图片
    wx.showLoading({ title: '生成图片中...' });
    this.startDrawing();
  },

  startDrawing() {
    const { shareType } = this.data;
    if (shareType === 'poster') {
      this.drawPosterWall().then(() => {
        this.exportImage();
      }).catch(err => {
        console.error('绘制海报墙失败', err);
        wx.hideLoading();
        wx.showToast({ title: '生成图片失败', icon: 'none' });
      });
    } else {
      this.drawTextCard().then(() => {
        this.exportImage();
      }).catch(err => {
        console.error('绘制文本卡片失败', err);
        wx.hideLoading();
        wx.showToast({ title: '生成图片失败', icon: 'none' });
      });
    }
  },

  async drawPosterWall() {
    const ctx = this.data.ctx;
    const { width, height } = this.data.canvasSize;
    const padding = 40;
    const colsPerRow = 6;
    const gap = 8;
    
    // 计算海报尺寸，确保不超出画布
    const availableWidth = width - padding * 2;
    const posterWidth = Math.floor((availableWidth - gap * (colsPerRow - 1)) / colsPerRow);
    const posterHeight = Math.floor(posterWidth * 1.4); // 调整宽高比
    
    // 计算海报区域
    const posterAreaStartY = 280;
    const posterAreaHeight = height - posterAreaStartY - padding - 40; // 40是底部文字空间
    const maxRows = Math.floor(posterAreaHeight / (posterHeight + gap));
    const maxPosters = maxRows * colsPerRow;

    // 清空画布
    ctx.clearRect(0, 0, width, height);

    // 绘制背景和基本信息
    await this.drawCardBackground();

    // 绘制海报
    const movies = this.data.watchedMovies.slice(0, maxPosters); // 限制海报数量
    const posterPromises = [];

    for (let i = 0; i < movies.length; i++) {
      const row = Math.floor(i / colsPerRow);
      const col = i % colsPerRow;
      const x = padding + col * (posterWidth + gap);
      const y = posterAreaStartY + row * (posterHeight + gap);

      // 确保海报不超出画布底部
      if (y + posterHeight <= height - padding - 40) {
        posterPromises.push(this.drawPoster(movies[i], x, y, posterWidth, posterHeight));
      }
    }

    // 等待所有海报绘制完成
    await Promise.all(posterPromises);
    this.drawFooter(); // 海报墙不需要传递lastMovieY
  },

  drawPoster(movie, x, y, width, height) {
    const ctx = this.data.ctx;
    return new Promise((resolve) => {
      // 绘制海报背景
      ctx.fillStyle = '#f0f0f0';
      ctx.fillRect(x, y, width, height);
      
      // 绘制边框
      ctx.strokeStyle = '#ddd';
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, width, height);
      
      // 获取图片URL，优先使用云存储的fileID
      let imageUrl = movie.cover || movie.coverUrl;
      
      // 如果没有图片URL，绘制占位符
      if (!imageUrl) {
        this.drawPosterPlaceholder(ctx, x, y, width, height, movie.title);
        resolve();
        return;
      }

      // 如果是云存储fileID，先获取临时URL
      if (imageUrl.startsWith('cloud://')) {
        wx.cloud.getTempFileURL({
          fileList: [{ fileID: imageUrl, maxAge: 60 * 60 }]
        }).then(res => {
          if (res.fileList && res.fileList[0] && res.fileList[0].tempFileURL) {
            this.loadAndDrawPosterImage(ctx, res.fileList[0].tempFileURL, x, y, width, height, movie.title, resolve);
          } else {
            this.drawPosterPlaceholder(ctx, x, y, width, height, movie.title);
            resolve();
          }
        }).catch(err => {
          console.error('获取云存储图片URL失败:', err);
          this.drawPosterPlaceholder(ctx, x, y, width, height, movie.title);
          resolve();
        });
      } else {
        // 直接使用HTTP URL
        this.loadAndDrawPosterImage(ctx, imageUrl, x, y, width, height, movie.title, resolve);
      }
    });
  },

  // 加载并绘制海报图片
  loadAndDrawPosterImage(ctx, imageUrl, x, y, width, height, title, resolve) {
    wx.getImageInfo({
      src: imageUrl,
      success: (res) => {
        try {
          // 绘制海报图片
          ctx.drawImage(res.path, x, y, width, height);
          
          // 绘制标题背景渐变
          const gradient = ctx.createLinearGradient(x, y + height - 30, x, y + height);
          gradient.addColorStop(0, 'rgba(0,0,0,0)');
          gradient.addColorStop(1, 'rgba(0,0,0,0.7)');
          ctx.fillStyle = gradient;
          ctx.fillRect(x, y + height - 30, width, 30);
          
          // 绘制标题
          ctx.fillStyle = '#fff';
          ctx.font = 'bold 12px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          
          // 处理长标题
          const maxWidth = width - 8;
          let displayTitle = title;
          if (ctx.measureText(title).width > maxWidth) {
            // 如果标题太长，截断并添加省略号
            while (ctx.measureText(displayTitle + '...').width > maxWidth && displayTitle.length > 0) {
              displayTitle = displayTitle.slice(0, -1);
            }
            displayTitle += '...';
          }
          
          ctx.fillText(displayTitle, x + width / 2, y + height - 15);
          resolve();
        } catch (error) {
          console.error('绘制海报图片时出错:', error);
          this.drawPosterPlaceholder(ctx, x, y, width, height, title);
          resolve();
        }
      },
      fail: (err) => {
        console.error('加载海报图片失败:', err, 'URL:', imageUrl);
        this.drawPosterPlaceholder(ctx, x, y, width, height, title);
        resolve();
      }
    });
  },

  // 绘制海报占位符
  drawPosterPlaceholder(ctx, x, y, width, height, title) {
    // 绘制占位符背景
    ctx.fillStyle = '#e0e0e0';
    ctx.fillRect(x, y, width, height);
    
    // 绘制占位符图标
    ctx.fillStyle = '#999';
    ctx.font = '24px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🎬', x + width / 2, y + height / 2 - 10);
    
    // 绘制标题
    ctx.fillStyle = '#666';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    // 处理长标题
    const maxWidth = width - 8;
    let displayTitle = title;
    if (ctx.measureText(title).width > maxWidth) {
      while (ctx.measureText(displayTitle + '...').width > maxWidth && displayTitle.length > 0) {
        displayTitle = displayTitle.slice(0, -1);
      }
      displayTitle += '...';
    }
    
    ctx.fillText(displayTitle, x + width / 2, y + height / 2 + 10);
  },

  // 绘制文字卡片
  async drawTextCard() {
    const ctx = this.data.ctx;
    const { width, height } = this.data.canvasSize;
    const padding = 40;

    // 清空画布
    ctx.clearRect(0, 0, width, height);

    // 绘制背景和基本信息
    await this.drawCardBackground();

    // 绘制电影列表
    await this.drawMovieList();
  },

  // 绘制电影列表
  async drawMovieList() {
    const ctx = this.data.ctx;
    const { width } = this.data.canvasSize;
    const padding = 40;
    const startY = 40; // 标题放在上边框上
    const maxWidth = width - padding * 2;

    // 绘制标题 - 匹配新的样式
    ctx.fillStyle = '#2c3e50';
    ctx.font = '600 36px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('豆瓣TOP250观影墙', width / 2, startY);

    // 绘制统计信息
    await this.drawStatsCanvas(ctx, padding, startY + 30, maxWidth);

    // 绘制电影标签
    const lastMovieY = await this.drawMovieTags(ctx, padding, startY + 120, maxWidth);
    
    // 绘制底部文字
    const actualHeight = this.drawFooter(lastMovieY);
    
    // 调整画布高度以减少底部空白
    this.adjustCanvasHeight(actualHeight);
  },

  // 绘制电影标签
  async drawMovieTags(ctx, startX, startY, maxWidth) {
    const movies = this.data.allMovies;
    const moviesPerRow = 14; // 增加每行电影数量
    const tagHeight = 30; // 稍微减少标签高度
    const tagSpacing = 8; // 减少间距
    const rowSpacing = 14; // 减少行间距
    const minTagWidth = 70; // 减少最小宽度
    // 调整电影内容区域左右边距为20px
    const contentPadding = 20;
    const contentMaxWidth = maxWidth - contentPadding * 2;
    const maxTagWidth = contentMaxWidth / moviesPerRow - tagSpacing;
    
    // 计算可用高度，使用更大的高度以显示更多电影
    const { height } = this.data.canvasSize;
    const footerHeight = 80; // 增加底部文字区域高度
    const availableHeight = height - startY - footerHeight - 60; // 增加底部边距
    const maxRows = Math.floor(availableHeight / (tagHeight + rowSpacing));
    const maxMovies = maxRows * moviesPerRow;
    
    let currentX = startX + contentPadding; // 添加左边距
    let currentY = startY;
    let moviesInCurrentRow = 0;
    let moviesDrawn = 0;

    for (let i = 0; i < movies.length && moviesDrawn < maxMovies; i++) {
      const movie = movies[i];
      const status = this.data.markStatusMap[movie._id] ? this.data.markStatusMap[movie._id].status : 'unwatched';
      
      // 计算标签宽度 - 不限制最大宽度，显示完整名称
      ctx.font = '500 18px sans-serif'; // 稍微减少字体大小
      const textWidth = ctx.measureText(movie.title).width;
      const tagWidth = Math.max(minTagWidth, textWidth + 20); // 减少内边距
      
      // 检查是否需要换行
      if (moviesInCurrentRow >= moviesPerRow || currentX + tagWidth > startX + contentPadding + contentMaxWidth) {
        currentX = startX + contentPadding; // 换行时也添加左边距
        currentY += tagHeight + rowSpacing;
        moviesInCurrentRow = 0;
        
        // 检查是否超出可用高度
        if (currentY + tagHeight > height - footerHeight) {
          break;
        }
      }
      
      // 绘制标签背景
      this.drawMovieTagBackground(ctx, currentX, currentY, tagWidth, tagHeight, status);
      
      // 绘制标签文字 - 显示完整名称
      this.drawMovieTagText(ctx, currentX, currentY, tagWidth, tagHeight, movie.title, status);
      
      currentX += tagWidth + tagSpacing;
      moviesInCurrentRow++;
      moviesDrawn++;
    }
    
    // 如果还有未显示的电影，在底部显示提示
    if (moviesDrawn < movies.length) {
      const remainingCount = movies.length - moviesDrawn;
      ctx.fillStyle = '#999';
      ctx.font = '18px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`还有${remainingCount}部电影...`, startX + contentMaxWidth / 2, currentY + tagHeight + 20);
    }
    
    // 返回最后一行电影的位置，用于底部文字定位
    return currentY + tagHeight;
  },

  // 绘制电影标签背景
  drawMovieTagBackground(ctx, x, y, width, height, status) {
    ctx.save();
    
    // 绘制圆角矩形
    this.drawRoundRect(ctx, x, y, width, height, height / 2);
    
    if (status === 'watched') {
      // 已看电影 - 绿色渐变
      const gradient = ctx.createLinearGradient(x, y, x + width, y + height);
      gradient.addColorStop(0, 'rgba(76, 175, 80, 0.15)');
      gradient.addColorStop(1, 'rgba(76, 175, 80, 0.08)');
      ctx.fillStyle = gradient;
      ctx.fill();
      
      // 绘制边框
      ctx.strokeStyle = 'rgba(76, 175, 80, 0.3)';
      ctx.lineWidth = 1;
      ctx.stroke();
    } else if (status === 'wish') {
      // 想看电影 - 黄色渐变
      const gradient = ctx.createLinearGradient(x, y, x + width, y + height);
      gradient.addColorStop(0, 'rgba(255, 193, 7, 0.2)');
      gradient.addColorStop(1, 'rgba(255, 193, 7, 0.12)');
      ctx.fillStyle = gradient;
      ctx.fill();
      
      // 绘制边框
      ctx.strokeStyle = 'rgba(255, 193, 7, 0.4)';
      ctx.lineWidth = 1;
      ctx.stroke();
    } else {
      // 未看电影 - 灰色
      const gradient = ctx.createLinearGradient(x, y, x + width, y + height);
      gradient.addColorStop(0, 'rgba(158, 158, 158, 0.12)');
      gradient.addColorStop(1, 'rgba(158, 158, 158, 0.06)');
      ctx.fillStyle = gradient;
      ctx.fill();
      
      // 绘制边框
      ctx.strokeStyle = 'rgba(158, 158, 158, 0.3)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    
    ctx.restore();
  },

  // 绘制电影标签文字
  drawMovieTagText(ctx, x, y, width, height, title, status) {
    ctx.save();
    
    // 设置文字样式
    ctx.font = '500 18px sans-serif'; // 与计算宽度时保持一致
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    // 显示完整标题，不添加省略号
    const displayTitle = title;
    
    // 设置文字颜色
    if (status === 'watched') {
      ctx.fillStyle = '#4CAF50';
    } else if (status === 'wish') {
      ctx.fillStyle = '#FF8F00';
      ctx.font = '600 18px sans-serif'; // 想看电影加粗，保持字体大小一致
    } else {
      ctx.fillStyle = '#9E9E9E';
    }
    
    // 绘制文字
    ctx.fillText(displayTitle, x + width / 2, y + height / 2);
    
    // 如果是已看电影，绘制中划线
    if (status === 'watched') {
      ctx.strokeStyle = '#4CAF50';
      ctx.lineWidth = 2;
      const textY = y + height / 2;
      const textWidth = ctx.measureText(displayTitle).width;
      ctx.beginPath();
      ctx.moveTo(x + (width - textWidth) / 2, textY);
      ctx.lineTo(x + (width + textWidth) / 2, textY);
      ctx.stroke();
    }
    
    ctx.restore();
  },

  drawCardBackground() {
    const ctx = this.data.ctx;
    const { width, height } = this.data.canvasSize;
    const padding = 40;
    const borderWidth = 24;
    const topPadding = 20; // 增加上边框高度以适应标题和统计区域

    // 透明背景
    ctx.clearRect(0, 0, width, height);

    // 绘制渐变边框
    this.drawGradientBorder(ctx, padding - borderWidth, padding - borderWidth - topPadding, 
      width - (padding - borderWidth) * 2, height - (padding - borderWidth) * 2 + topPadding, 
      borderWidth, 60);

    // 卡片内容区域 - 使用#fcfcfc底色，上边框更高
    ctx.fillStyle = '#fcfcfc';
    this.drawRoundRect(ctx, padding, padding - topPadding, width - padding * 2, height - padding * 2 + topPadding, 40);
    ctx.shadowColor = 'rgba(0,0,0,0.08)';
    ctx.shadowBlur = 30;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
  },

  // 绘制渐变边框
  drawGradientBorder(ctx, x, y, width, height, borderWidth, borderRadius) {
    // 创建渐变 - 16px边框，左上角#fdecec，右下角#d2f1fe
    const gradient = ctx.createLinearGradient(x, y, x + width, y + height);
    gradient.addColorStop(0, '#fdecec');      // 左上角：淡粉色
    gradient.addColorStop(1, '#d2f1fe');      // 右下角：淡蓝色

    // 绘制外圆角矩形
    ctx.fillStyle = gradient;
    this.drawRoundRect(ctx, x, y, width, height, borderRadius);
    ctx.fill();

    // 绘制内圆角矩形（#fcfcfc底色，形成边框效果）
    ctx.fillStyle = '#fcfcfc';
    this.drawRoundRect(ctx, x + borderWidth, y + borderWidth, 
      width - borderWidth * 2, height - borderWidth * 2, borderRadius - borderWidth);
    ctx.fill();
  },

  drawUserInfo() {
    const ctx = this.data.ctx;
    const { userInfo } = this.data;
    const padding = 40;

    // 绘制头像
    this.drawAvatar(ctx, userInfo.avatarUrl, padding, padding, 80, () => {
      // 绘制昵称
      ctx.fillStyle = '#555';
      ctx.font = 'bold 36px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(userInfo.nickName, padding + 100, padding + 50);
    });
  },

  drawStats() {
    const ctx = this.data.ctx;
    const { stats } = this.data;
    const padding = 40;
    const startY = 200;

    const statItems = [
      { label: '已看', value: stats.watched, color: '#4CAF50', bgColor: 'rgba(76, 175, 80, 0.1)' },
      { label: '想看', value: stats.wish, color: '#FFC107', bgColor: 'rgba(255, 193, 7, 0.1)' },
      { label: '未看', value: stats.unwatched, color: '#9E9E9E', bgColor: 'rgba(158, 158, 158, 0.1)' }
    ];

    statItems.forEach((item, index) => {
      const itemX = padding + index * 120;
      const itemY = startY;
      
      // 绘制渐变背景
      const gradient = ctx.createLinearGradient(itemX, itemY, itemX + 100, itemY + 50);
      gradient.addColorStop(0, item.bgColor);
      gradient.addColorStop(1, item.bgColor.replace('0.1', '0.05'));
      ctx.fillStyle = gradient;
      this.drawRoundRect(ctx, itemX, itemY, 100, 50, 12);
      ctx.fill();
      
      // 绘制边框
      ctx.strokeStyle = item.color + '40';
      ctx.lineWidth = 2;
      this.drawRoundRect(ctx, itemX, itemY, 100, 50, 12);
      ctx.stroke();
      
      // 绘制标签
      ctx.fillStyle = item.color;
      ctx.font = 'bold 18px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(item.label, itemX + 50, itemY + 20);
      
      // 绘制数值
      ctx.font = 'bold 24px sans-serif';
      ctx.fillText(item.value, itemX + 50, itemY + 40);
    });
  },

  // 绘制统计信息Canvas版本
  drawStatsCanvas(ctx, startX, startY, maxWidth) {
    const { stats } = this.data;
    const statItems = [
      { label: '已看', value: stats.watched, color: '#4CAF50' },
      { label: '想看', value: stats.wish, color: '#FF8F00' },
      { label: '未看', value: stats.unwatched, color: '#9E9E9E' }
    ];

    const itemWidth = 160; // 增加宽度以容纳标签和数字
    const itemHeight = 50; // 减少高度，单行显示
    const gap = 30; // 增加间距
    const totalWidth = statItems.length * itemWidth + (statItems.length - 1) * gap;
    const startXCentered = startX + (maxWidth - totalWidth) / 2;

    statItems.forEach((item, index) => {
      const itemX = startXCentered + index * (itemWidth + gap);
      const itemY = startY;
      
      // 绘制渐变背景
      const gradient = ctx.createLinearGradient(itemX, itemY, itemX + itemWidth, itemY + itemHeight);
      if (item.label === '已看') {
        gradient.addColorStop(0, 'rgba(76, 175, 80, 0.12)');
        gradient.addColorStop(1, 'rgba(76, 175, 80, 0.08)');
      } else if (item.label === '想看') {
        gradient.addColorStop(0, 'rgba(255, 193, 7, 0.12)');
        gradient.addColorStop(1, 'rgba(255, 193, 7, 0.08)');
      } else {
        gradient.addColorStop(0, 'rgba(158, 158, 158, 0.12)');
        gradient.addColorStop(1, 'rgba(158, 158, 158, 0.08)');
      }
      
      ctx.fillStyle = gradient;
      this.drawRoundRect(ctx, itemX, itemY, itemWidth, itemHeight, 12);
      ctx.fill();
      
      // 绘制边框
      ctx.strokeStyle = item.color + '33';
      ctx.lineWidth = 1;
      this.drawRoundRect(ctx, itemX, itemY, itemWidth, itemHeight, 12);
      ctx.stroke();
      
      // 绘制标签和数字在一行
      ctx.fillStyle = item.color;
      ctx.font = '500 18px sans-serif';
      ctx.textAlign = 'left';
      
      // 计算文字位置
      const labelText = item.label;
      const valueText = item.value.toString();
      const labelWidth = ctx.measureText(labelText).width;
      const valueWidth = ctx.measureText(valueText).width;
      const totalTextWidth = labelWidth + valueWidth + 10; // 10px间距
      const textStartX = itemX + (itemWidth - totalTextWidth) / 2;
      
      // 绘制标签
      ctx.fillText(labelText, textStartX, itemY + 32);
      
      // 绘制数值
      ctx.font = '600 20px sans-serif';
      ctx.fillText(valueText, textStartX + labelWidth + 10, itemY + 32);
    });
  },

  drawFooter(lastMovieY) {
    const ctx = this.data.ctx;
    const { width } = this.data.canvasSize;

    // 绘制底部文字 - 紧跟在最后一行电影后面
    ctx.fillStyle = '#999';
    ctx.font = '22px sans-serif';
    ctx.textAlign = 'center';
    const footerY = lastMovieY ? lastMovieY + 40 : 1600; // 如果知道最后一行位置就用它，否则用默认值
    ctx.fillText('使用微信小程序标记吧生成', width / 2, footerY);
    
    // 返回底部文字的位置，用于调整画布高度
    return footerY + 30; // 底部文字位置 + 30px边距
  },

  // 调整画布高度以减少底部空白
  adjustCanvasHeight(actualHeight) {
    const { canvas, ctx } = this.data;
    const { width } = this.data.canvasSize;
    
    // 计算新的高度，添加一些边距
    const newHeight = Math.min(actualHeight + 50, 2000); // 最多不超过2000px
    
    // 如果新高度小于当前高度，调整画布
    if (newHeight < this.data.canvasSize.height) {
      // 更新画布尺寸
      const dpr = wx.getWindowInfo().pixelRatio;
      canvas.width = width * dpr;
      canvas.height = newHeight * dpr;
      ctx.scale(dpr, dpr);
      
      // 更新canvasSize
      this.setData({
        canvasSize: { width, height: newHeight }
      });
    }
  },

  exportImage() {
    const { canvas } = this.data;
    wx.canvasToTempFilePath({
      canvas,
      success: res => {
        wx.hideLoading();
        wx.saveImageToPhotosAlbum({
          filePath: res.tempFilePath,
          success: () => {
            wx.showToast({ title: '保存成功', icon: 'success' });
          },
          fail: (err) => {
            console.error('保存图片失败', err);
            wx.showToast({ title: '保存失败', icon: 'none' });
          }
        });
      },
      fail: (err) => {
        console.error('生成图片失败', err);
        wx.hideLoading();
        wx.showToast({ title: '生成图片失败', icon: 'none' });
      }
    });
  }
});
