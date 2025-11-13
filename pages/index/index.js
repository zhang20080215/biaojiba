Page({
  data: {
    userInfo: null,
    openid: '',
    allMovies: [],
    movies: [],
    markStatusMap: {},     // movieId -> status
    markDateMap: {},       // movieId -> 格式化日期字符串
    watchedIds: [],        // 仅用于tab切换
    wishIds: [],           // 仅用于tab切换
    watchedCount: 0,
    wishCount: 0,
    unwatchedCount: 0,
    allCount: 0,
    activeTab: 0,          // 0全部 1已看 2想看 3未看
    currentFilter: 'all',
    isBatchEditing: false, // 是否处于批量编辑模式
    selectedMovieIds: [],  // 批量选中电影的ID列表
    imageCache: {},        // 图片缓存
    loadingImages: new Set(), // 正在加载的图片
  },

  onLoad() {
    if (!wx.cloud) {
      wx.showToast({ title: '请升级基础库', icon: 'none' });
      return;
    }
    // 检查登录状态
    this.checkLoginStatus();
    this.loadAllMovies();
  },

  onShow() {
    // 页面显示时检查登录状态
    this.checkLoginStatus();
    // 预加载可见区域图片
    setTimeout(() => {
      this.preloadVisibleImages();
    }, 500);
  },

  // 检查登录状态
  checkLoginStatus() {
    const userInfo = wx.getStorageSync('userInfo');
    if (userInfo) {
      this.setData({ 
        userInfo: userInfo, 
        openid: userInfo._openid 
      });
    } else {
      this.setData({ 
        userInfo: null, 
        openid: '' 
      });
    }
  },


  // 跳转到分享页面
  onShareTap() {
    wx.showActionSheet({
      itemList: ['海报墙', '文字卡片'],
      success: (res) => {
        const type = res.tapIndex === 0 ? 'poster' : 'text';
        wx.navigateTo({
          url: `/pages/share/share?type=${type}`
        });
      }
    });
  },

  // 拉取全部电影
  loadAllMovies() {
    const db = wx.cloud.database();
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
        let allData = [];
        results.forEach(res => allData = allData.concat(res.data));
        // 统一_id为字符串，并添加图片缓存标识
        allData = allData.map(m => ({ 
          ...m, 
          _id: String(m._id),
          imageLoaded: false, // 图片是否已加载
          imageError: false   // 图片是否加载失败
        }));
        this.setData({
          allMovies: allData,
          movies: allData,
          allCount: allData.length,
          unwatchedCount: allData.length
        }, this.loadUserMarks);
      });
    }).catch(err => {
      wx.showToast({ title: '加载电影失败', icon: 'none' });
    });
  },

  // 拉 marks 并做唯一状态统计
  loadUserMarks() {
    if (!this.data.userInfo || !this.data.userInfo._openid) {
      // 未登录时全部未看
      this.setData({
        markStatusMap: {}, markDateMap: {},
        watchedIds: [], wishIds: [],
        watchedCount: 0, wishCount: 0,
        unwatchedCount: this.data.allMovies.length,
        allCount: this.data.allMovies.length
      }, this.updateFilteredMovies);
      return;
    }
    const openid = this.data.userInfo._openid;
    const db = wx.cloud.database();
    const MAX_LIMIT = 20;

    // 先获取所有电影数量
    db.collection('movies').count().then(movieRes => {
      const totalMovies = movieRes.total;
      console.log('数据库中的电影总数:', totalMovies);

      // 获取用户标记总数
      db.collection('Marks').where({ openid }).count().then(countRes => {
        const total = countRes.total;
        console.log('用户标记总数:', total);
        
        // 计算需要分几次取
        const batchTimes = Math.ceil(total / MAX_LIMIT);
        const tasks = [];
        
        // 分批次获取所有标记
        for (let i = 0; i < batchTimes; i++) {
          const promise = db.collection('Marks')
            .where({ openid })
            .skip(i * MAX_LIMIT)
            .limit(MAX_LIMIT)
            .get();
          tasks.push(promise);
        }

        // 等待所有批次的数据获取完成
        Promise.all(tasks).then(results => {
          let allMarks = [];
          results.forEach(res => {
            allMarks = allMarks.concat(res.data);
          });
          
          console.log('获取到的所有标记数量:', allMarks.length);
          console.log('标记数据:', allMarks);
          
          // 只保留每部电影最新的一条状态（movieId => 最新的mark）
          const latestMark = {};
          allMarks.forEach(item => {
            let dateValue = item.marked_at;
            if (!dateValue) {
              console.log('发现没有日期的记录:', item);
              return;
            }
            
            // 确保日期是字符串格式
            if (typeof dateValue === 'object') {
              if (dateValue.toISOString) {
                dateValue = dateValue.toISOString();
              } else {
                dateValue = new Date(dateValue).toISOString();
              }
            } else if (typeof dateValue !== 'string') {
              dateValue = new Date(dateValue).toISOString();
            }
            
            const t = new Date(dateValue).getTime();
            const mid = String(item.movieId);
            if (!latestMark[mid] || t > latestMark[mid].time) {
              latestMark[mid] = {
                status: item.status,
                date: dateValue,
                time: t
              };
            } else {
              console.log('发现重复的电影ID:', mid, '旧记录:', latestMark[mid], '新记录:', {status: item.status, date: dateValue, time: t});
            }
          });
          
          console.log('去重后的记录数:', Object.keys(latestMark).length);
          console.log('去重后的记录:', latestMark);
          
          // 构建状态、日期map，并收集id数组做tab统计
          const markStatusMap = {};
          const markDateMap = {};
          const watchedIds = [];
          const wishIds = [];
          Object.keys(latestMark).forEach(mid => {
            // 确保从latestMark[mid]对象中正确获取status和date
            const status = latestMark[mid].status;
            const date = latestMark[mid].date;
            markStatusMap[mid] = status;
            markDateMap[mid] = this.formatMarkDate(date);
            if (status === 'watched') watchedIds.push(mid);
            if (status === 'wish') wishIds.push(mid);
          });
          
          console.log('watchedIds:', watchedIds);
          console.log('wishIds:', wishIds);
          
          const watchedCount = watchedIds.length;
          const wishCount = wishIds.length;
          const unwatchedCount = Math.max(0, totalMovies - watchedCount - wishCount);

          console.log('统计结果:', {
            totalMovies,
            watchedCount,
            wishCount,
            unwatchedCount,
            totalMarks: allMarks.length,
            uniqueMarks: Object.keys(latestMark).length
          });

          this.setData({
            markStatusMap, markDateMap,
            watchedIds, wishIds,
            watchedCount, wishCount, unwatchedCount,
            allCount: totalMovies
          }, this.updateFilteredMovies);
        }).catch(err => {
          console.error('获取标记数据失败:', err);
          this.setData({
            markStatusMap: {}, markDateMap: {},
            watchedIds: [], wishIds: [],
            watchedCount: 0, wishCount: 0,
            unwatchedCount: totalMovies,
            allCount: totalMovies
          }, this.updateFilteredMovies);
        });
      }).catch(err => {
        console.error('获取标记总数失败:', err);
      });
    }).catch(err => {
      console.error('获取电影总数失败:', err);
    });
  },

  // Tab筛选
  updateFilteredMovies() {
    const { allMovies, markStatusMap, activeTab } = this.data;
    let movies = [];
    if (activeTab === 0) {
      movies = allMovies;
    } else if (activeTab === 1) {
      movies = allMovies.filter(m => markStatusMap[m._id] === 'watched');
    } else if (activeTab === 2) {
      movies = allMovies.filter(m => markStatusMap[m._id] === 'wish');
    } else if (activeTab === 3) {
      movies = allMovies.filter(m => !markStatusMap[m._id]);
    }
    // 在更新movies列表时，确保每个电影项有checked属性用于批量编辑，并确保ID类型一致比较
    movies = movies.map(movie => ({ ...movie, checked: this.data.selectedMovieIds.includes(String(movie._id)) }));
    this.setData({ movies });
  },

  // Tab切换
  onTabChange(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    // 切换Tab时退出批量编辑模式
    this.setData({ activeTab: idx, isBatchEditing: false, selectedMovieIds: [] }, this.updateFilteredMovies);
  },

  // 标记
  onMarkTap(e) {
    if (!this.data.userInfo) {
      wx.showModal({
        title: '提示',
        content: '请登录后再进行标记',
        confirmText: '去登录',
        success: (res) => {
          if (res.confirm) {
            this.onGetUserProfile();
          }
        }
      });
      return;
    }

    const movieId = String(e.currentTarget.dataset.id);
    const type = e.currentTarget.dataset.type;
    const openid = this.data.userInfo._openid;
    if (!movieId || !type || !openid) {
      wx.showToast({ title: '数据不完整', icon: 'none' });
      return;
    }
    const db = wx.cloud.database();
    db.collection('Marks').where({ movieId, openid }).get().then(res => {
      const now = new Date().toISOString();
      if (res.data.length > 0) {
        db.collection('Marks').doc(res.data[0]._id).update({
          data: { status: type, marked_at: now }
        }).then(() => {
          // 直接更新本地数据，而不是重新加载
          const markStatusMap = { ...this.data.markStatusMap };
          const markDateMap = { ...this.data.markDateMap };
          markStatusMap[movieId] = { status: type, marked_at: now };
          markDateMap[movieId] = this.formatMarkDate(now);
          
          // 更新计数
          let watchedCount = this.data.watchedCount;
          let wishCount = this.data.wishCount;
          let unwatchedCount = this.data.unwatchedCount;
          
          // 移除旧的计数
          if (markStatusMap[movieId]?.status === 'watched') watchedCount--;
          else if (markStatusMap[movieId]?.status === 'wish') wishCount--;
          else unwatchedCount--;
          
          // 添加新的计数
          if (type === 'watched') watchedCount++;
          else if (type === 'wish') wishCount++;
          else unwatchedCount++;
          
          this.setData({
            markStatusMap,
            markDateMap,
            watchedCount,
            wishCount,
            unwatchedCount
          }, this.updateFilteredMovies);
          
          wx.showToast({ title: type === 'watched' ? '已更新为已看' : '已更新为想看' });
        });
      } else {
        db.collection('Marks').add({
          data: { movieId, openid, status: type, marked_at: now }
        }).then(() => {
          // 直接更新本地数据，而不是重新加载
          const markStatusMap = { ...this.data.markStatusMap };
          const markDateMap = { ...this.data.markDateMap };
          markStatusMap[movieId] = { status: type, marked_at: now };
          markDateMap[movieId] = this.formatMarkDate(now);
          
          // 更新计数
          let watchedCount = this.data.watchedCount;
          let wishCount = this.data.wishCount;
          let unwatchedCount = this.data.unwatchedCount;
          
          if (type === 'watched') watchedCount++;
          else if (type === 'wish') wishCount++;
          unwatchedCount--;
          
          this.setData({
            markStatusMap,
            markDateMap,
            watchedCount,
            wishCount,
            unwatchedCount
          }, this.updateFilteredMovies);
          
          wx.showToast({ title: type === 'watched' ? '已看成功' : '想看成功' });
        });
      }
    });
  },
  
  // 日期格式化（防止 [object Object]）
  formatMarkDate(dateStr) {
    if (!dateStr) return '';
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return '';
      return `${d.getMonth() + 1}/${d.getDate()}`;
    } catch (e) {
      return '';
    }
  },

  // 进入批量编辑模式
  onStartBatchEdit() {
    if (!this.data.userInfo) {
       wx.showToast({ title: '请先登录', icon: 'none' });
       return;
    }
    this.setData({ isBatchEditing: true, selectedMovieIds: [] });
    // 进入批量编辑模式时，需要刷新当前列表，确保有checked属性
    this.updateFilteredMovies();
  },

  // 取消批量编辑模式
  onCancelBatchEdit() {
    this.setData({ isBatchEditing: false, selectedMovieIds: [] });
    // 取消批量编辑模式时，需要刷新当前列表，清除checked状态
    this.updateFilteredMovies();
  },

  // 电影项复选框选中/取消选中
  onMovieCheck(e) {
    console.log('onMovieCheck event:', e); // 打印整个事件对象
    console.log('onMovieCheck currentTarget:', e.currentTarget); // 打印currentTarget
    
    // 从data-movie-id属性获取电影ID
    const movieId = e.currentTarget.dataset.movieId;

    console.log('Final movieId (from dataset.movieId):', movieId); // 打印最终使用的movieId

    if (movieId === undefined || movieId === null) {
        console.error('无法获取到电影ID');
        return;
    }

    let selectedMovieIds = this.data.selectedMovieIds;
    const index = selectedMovieIds.indexOf(movieId);
    const isCurrentlySelected = index > -1;

    let checked; // 定义一个变量来表示操作后的选中状态

    if (isCurrentlySelected) {
      // 如果当前已选中，则表示用户点击是为了取消选中
      selectedMovieIds.splice(index, 1); // 从数组中移除
      checked = false;
    } else {
      // 如果当前未选中，则表示用户点击是为了选中
      selectedMovieIds = [...selectedMovieIds, movieId]; // 添加到数组
      checked = true;
    }

    // 更新选中状态
    // 找到当前movies列表中对应的电影项并更新其checked状态
    const updatedMovies = this.data.movies.map(movie => {
       // 确保类型一致比较
       if (String(movie._id) === String(movieId)) {
         return { ...movie, checked: checked };
       } else {
         return movie;
       }
    });

    this.setData({ selectedMovieIds: selectedMovieIds, movies: updatedMovies });

    console.log('当前选中电影ID列表:', this.data.selectedMovieIds); // 添加日志，方便调试
  },

  // 批量标记为已看
  onBatchWatch() {
    const selectedMovieIds = this.data.selectedMovieIds;
    if (selectedMovieIds.length === 0) {
      wx.showToast({ title: '请选择电影', icon: 'none' });
      return;
    }
    this.batchUpdateMarks(selectedMovieIds, 'watched');
  },

  // 批量标记为想看
  onBatchWish() {
     const selectedMovieIds = this.data.selectedMovieIds;
     if (selectedMovieIds.length === 0) {
       wx.showToast({ title: '请选择电影', icon: 'none' });
       return;
     }
    this.batchUpdateMarks(selectedMovieIds, 'wish');
  },

  // 批量更新标记状态的通用函数
  batchUpdateMarks(movieIds, status) {
    const openid = this.data.userInfo._openid;
    if (!openid) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      return;
    }

    wx.showLoading({ title: '批量更新中...' });
    const db = wx.cloud.database();
    const _ = db.command;

    // 为了简化，这里我们对每个选中的电影都进行一次add或update操作。
    // 更优化的方式是先查询已存在的marks，再批量add新的和批量update已存在的。
    // 但考虑到通常批量操作数量不会特别大，单个操作也ok。
    const tasks = movieIds.map(movieId => {
        const now = new Date().toISOString();
        return db.collection('Marks').where({ movieId, openid }).get().then(res => {
            if (res.data.length > 0) {
                // 已存在标记，更新
                return db.collection('Marks').doc(res.data[0]._id).update({
                    data: { status: status, marked_at: now }
                }).then(() => {
                    console.log('批量更新标记成功:', { movieId, status, openid }); // 添加日志，打印更新结果
                });
            } else {
                // 不存在标记，新增
                return db.collection('Marks').add({
                    data: { movieId, openid, status: status, marked_at: now }
                }).then(() => {
                    console.log('批量添加标记成功:', { movieId, status, openid }); // 添加日志，打印添加结果
                });
            }
        }).catch(err => { // 捕获单个操作的错误，不中断整个批量操作
           console.error(`更新/新增标记 ${movieId} 失败:`, err);
           return Promise.reject(err); // 标记失败，继续下一个
        });
    });

    // 使用Promise.allSettled来等待所有任务完成，无论成功或失败
    Promise.allSettled(tasks).then(results => {
        console.log('批量更新结果:', results);
        wx.hideLoading();

        // 检查是否有失败的操作
        const failed = results.some(result => result.status === 'rejected');
        if (failed) {
            wx.showToast({ title: '部分电影标记失败', icon: 'none' });
        } else {
            wx.showToast({ title: '批量标记成功', icon: 'success' });
        }

        // 刷新用户标记数据和列表显示
        this.setData({ isBatchEditing: false, selectedMovieIds: [] }); // 退出批量编辑模式
        setTimeout(() => { // 增加延迟时间到 500ms
          this.loadUserMarks(); // 重新加载用户标记以更新统计和显示
        }, 500);
    }).catch(err => {
        // Promise.allSettled 不应该reject，但以防万一
        console.error('批量更新过程中发生未知错误:', err);
        wx.hideLoading();
        wx.showToast({ title: '批量更新失败', icon: 'none' });
        this.setData({ isBatchEditing: false, selectedMovieIds: [] }); // 退出批量编辑模式
        setTimeout(() => { // 增加延迟时间到 500ms
          this.loadUserMarks();
        }, 500);
    });
  },

  // 图片加载成功处理
  onImageLoad(e) {
    const movieId = e.currentTarget.dataset.movieId;
    if (movieId) {
      // 更新图片加载状态
      this.updateMovieImageStatus(movieId, { imageLoaded: true, imageError: false });
      
      // 添加到缓存
      this.addToImageCache(movieId, e.currentTarget.src);
    }
  },

  // 图片加载失败处理
  onImageError(e) {
    const movieId = e.currentTarget.dataset.movieId;
    if (movieId) {
      // 更新图片加载状态
      this.updateMovieImageStatus(movieId, { imageLoaded: false, imageError: true });
      
      // 尝试使用原始URL或默认图片
      this.tryFallbackImage(movieId);
    }
  },

  // 更新电影图片状态
  updateMovieImageStatus(movieId, status) {
    const movies = this.data.movies.map(movie => {
      if (String(movie._id) === String(movieId)) {
        return { ...movie, ...status };
      }
      return movie;
    });
    
    const allMovies = this.data.allMovies.map(movie => {
      if (String(movie._id) === String(movieId)) {
        return { ...movie, ...status };
      }
      return movie;
    });
    
    this.setData({ movies, allMovies });
  },

  // 添加到图片缓存
  addToImageCache(movieId, imageUrl) {
    const imageCache = { ...this.data.imageCache };
    imageCache[movieId] = imageUrl;
    this.setData({ imageCache });
  },

  // 尝试降级图片
  tryFallbackImage(movieId) {
    const movie = this.data.movies.find(m => String(m._id) === String(movieId));
    if (movie && movie.originalCover && movie.cover !== movie.originalCover) {
      // 使用原始URL
      this.updateMovieImage(movieId, movie.originalCover);
    } else {
      // 使用默认图片
      this.updateMovieImage(movieId, 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzAwIiBoZWlnaHQ9IjQ1MCIgdmlld0JveD0iMCAwIDMwMCA0NTAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHdpZHRoPSIzMDAiIGhlaWdodD0iNDUwIiBmaWxsPSIjRjVGNUY1Ii8+CjxwYXRoIGQ9Ik0xNTAgMjAwTDEyMCAyNTBMMTUwIDMwMEwyMDAgMjUwTDE1MCAyMDBaIiBmaWxsPSIjQ0NDQ0NDIi8+Cjx0ZXh0IHg9IjE1MCIgeT0iMzUwIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmaWxsPSIjOTk5OTk5IiBmb250LXNpemU9IjE0Ij7lm77niYfmlrDpl7vnpL7kvJ08L3RleHQ+Cjwvc3ZnPgo=');
    }
  },

  // 更新电影图片
  updateMovieImage(movieId, imageUrl) {
    const movies = this.data.movies.map(movie => {
      if (String(movie._id) === String(movieId)) {
        return { ...movie, cover: imageUrl };
      }
      return movie;
    });
    
    const allMovies = this.data.allMovies.map(movie => {
      if (String(movie._id) === String(movieId)) {
        return { ...movie, cover: imageUrl };
      }
      return movie;
    });
    
    this.setData({ movies, allMovies });
  },

  // 预加载图片
  preloadImage(imageUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(imageUrl);
      img.onerror = () => reject(new Error('Image load failed'));
      img.src = imageUrl;
    });
  },

  // 批量预加载可见区域图片
  preloadVisibleImages() {
    const visibleMovies = this.data.movies.slice(0, 20); // 只预加载前20个
    visibleMovies.forEach(movie => {
      if (!movie.imageLoaded && !movie.imageError && !this.data.loadingImages.has(movie._id)) {
        this.data.loadingImages.add(movie._id);
        this.preloadImage(movie.cover)
          .then(() => {
            this.updateMovieImageStatus(movie._id, { imageLoaded: true });
          })
          .catch(() => {
            this.updateMovieImageStatus(movie._id, { imageError: true });
            this.tryFallbackImage(movie._id);
          })
          .finally(() => {
            this.data.loadingImages.delete(movie._id);
          });
      }
    });
  },
});
