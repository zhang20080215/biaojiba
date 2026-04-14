const DataLoader = require('../../../utils/dataLoader.js');
const imageCacheManager = require('../../../utils/imageCacheManager.js');
const adConfig = require('../../../utils/adConfig');

const AWARD_FILTERS = [
  { key: 'jinma', label: '金马奖' },
  { key: 'jinxiang', label: '金像奖' },
  { key: 'jinji', label: '金鸡奖' },
  { key: 'baihua', label: '百花奖' }
];

Page({
  data: {
    userInfo: null,
    openid: '',
    allMovies: [],
    movies: [],
    markStatusMap: {},
    markDateMap: {},
    watchedIds: [],
    wishIds: [],
    watchedCount: 0,
    wishCount: 0,
    unwatchedCount: 0,
    allCount: 0,
    activeTab: 0,
    activeAwardKey: 'jinma',
    awardFilters: AWARD_FILTERS,
    isBatchEditing: false,
    selectedMovieIds: [],
    imageCache: {},
    loadingImages: {},
    loading: false,
    showAuthModal: false,
    showSharePicker: false,
    tempAvatar: '',
    tempNickname: '',
    watchPercent: 0,
    showInfeedAd: false,
    adUnitIds: {
      movielist_infeed: adConfig.getAdUnitId('movielist_infeed') || ''
    }
  },

  onLoad() {
    if (!wx.cloud) {
      wx.showToast({ title: '请升级基础库', icon: 'none' });
      return;
    }
    wx.setNavigationBarTitle({ title: '华语电影最高荣誉殿堂' });
    this.checkLoginStatus();
    this.loadAllMovies(true);
    this.initAds();
  },

  async onPullDownRefresh() {
    await this.loadAllMovies(true);
    wx.stopPullDownRefresh();
  },

  onShow() {
    this.checkLoginStatus();
    setTimeout(() => {
      this.preloadVisibleImages();
    }, 500);
  },

  onBackHome() {
    wx.reLaunch({ url: '/pages/category/category' });
  },

  getStoredUserInfo() {
    const userInfo = wx.getStorageSync('userInfo');
    if (!userInfo) return null;
    const openid = userInfo._openid || userInfo.openid || '';
    return openid ? { ...userInfo, _openid: openid, openid } : userInfo;
  },

  getActiveOpenid() {
    const currentUserInfo = this.data.userInfo || {};
    return currentUserInfo._openid || currentUserInfo.openid || this.data.openid || ((this.getStoredUserInfo() || {})._openid) || '';
  },

  hasLogin() {
    return !!this.getActiveOpenid();
  },

  checkLoginStatus() {
    const userInfo = this.getStoredUserInfo();
    if (userInfo) {
      this.setData({ userInfo, openid: userInfo._openid || '' });
    } else {
      this.setData({ userInfo: null, openid: '' });
    }
  },

  onHeaderLoginClick() {
    if (!this.data.userInfo) this.onGetUserProfile();
  },

  onShareTap() {
    if (!this.hasLogin()) {
      wx.showToast({ title: '请先完成登录', icon: 'none' });
      this.onGetUserProfile();
      return;
    }
    this.setData({ showSharePicker: true });
  },

  onCloseSharePicker() {
    this.setData({ showSharePicker: false });
  },

  onSharePickerTouchMove() {},

  onShareTypeSelect(e) {
    const type = e.currentTarget.dataset.type;
    if (!type || this._navigatingToShare) return;
    this._navigatingToShare = true;
    this.setData({ showSharePicker: false }, () => {
      wx.nextTick(() => {
        wx.navigateTo({
          url: `/pages/chinese-awards/share/share?type=${type}`,
          complete: () => {
            this._navigatingToShare = false;
          }
        });
      });
    });
  },

  onGetUserProfile() {
    if (this.data.loading) return;
    this.setData({ loading: true });
    wx.showLoading({ title: '准备登录...' });
    wx.cloud.callFunction({
      name: 'getOpenid',
      success: ret => {
        const _openid = ret.result.openid;
        if (!_openid) {
          wx.hideLoading();
          this.setData({ loading: false });
          wx.showToast({ title: '获取openid失败', icon: 'none' });
          return;
        }
        wx.hideLoading();
        this.setData({ loading: false, openid: _openid, showAuthModal: true, tempAvatar: '', tempNickname: '' });
      },
      fail: err => {
        console.error('获取openid失败:', err);
        wx.hideLoading();
        this.setData({ loading: false });
        wx.showToast({ title: '网络错误，请重试', icon: 'none' });
      }
    });
  },

  onCancelAuth() {
    this.setData({ showAuthModal: false });
  },

  onChooseAvatar(e) {
    this.setData({ tempAvatar: e.detail.avatarUrl });
  },

  onNicknameInput(e) {
    this.setData({ tempNickname: e.detail.value });
  },

  async onConfirmAuth() {
    const { tempAvatar, tempNickname, openid } = this.data;
    if (!tempAvatar || tempAvatar === '/images/default-avatar.svg') {
      wx.showToast({ title: '请选择头像', icon: 'none' });
      return;
    }
    if (!tempNickname || !tempNickname.trim()) {
      wx.showToast({ title: '请输入昵称', icon: 'none' });
      return;
    }

    wx.showLoading({ title: '保存中...', mask: true });
    try {
      let finalAvatarUrl = tempAvatar;
      if (tempAvatar.startsWith('wxfile://') || tempAvatar.startsWith('http://tmp/')) {
        const ext = tempAvatar.split('.').pop() || 'png';
        const cloudPath = `avatars/${openid}_${Date.now()}.${ext}`;
        const uploadRes = await wx.cloud.uploadFile({ cloudPath, filePath: tempAvatar });
        finalAvatarUrl = uploadRes.fileID;
      }

      const userInfo = { _openid: openid, nickName: tempNickname, avatarUrl: finalAvatarUrl };
      const db = wx.cloud.database();
      const userRes = await db.collection('users').where({ openid }).get();
      if (userRes.data.length === 0) {
        await db.collection('users').add({
          data: { openid, nickname: userInfo.nickName, avatarUrl: userInfo.avatarUrl, created_at: new Date(), updated_at: new Date() }
        });
      } else {
        await db.collection('users').doc(userRes.data[0]._id).update({
          data: { nickname: userInfo.nickName, avatarUrl: userInfo.avatarUrl, updated_at: new Date() }
        });
      }

      wx.setStorageSync('userInfo', userInfo);
      this.setData({ userInfo, showAuthModal: false });
      wx.hideLoading();
      wx.showToast({ title: '登录成功', icon: 'success' });
      this.loadUserMarks();
    } catch (err) {
      console.error('保存用户信息失败:', err);
      wx.hideLoading();
      wx.showToast({ title: '保存失败，请重试', icon: 'none' });
    }
  },

  async loadAllMovies(forceRefresh = false) {
    wx.showNavigationBarLoading();
    try {
      const openid = this.getActiveOpenid() || null;
      const { movies, marks } = await DataLoader.loadMoviesData('chinese_awards', openid, forceRefresh);
      const allMovies = movies.map(m => ({
        ...m,
        _id: String(m._id),
        awardKey: String(m.awardKey || '').toLowerCase(),
        thumbCover: imageCacheManager.getThumbnailUrl(m.originalCover || m.coverUrl || m.cover, 'list'),
        playPlatformsText: Array.isArray(m.playPlatforms) ? m.playPlatforms.join(' / ') : (m.playPlatformsText || ''),
        ratingText: m.rating ? String(m.rating) : '暂无评分',
        imageLoaded: false,
        imageError: false
      }));

      this.data.allMovies = allMovies;
      const { markStatusMap, markDateMap, watchedIds, wishIds } = DataLoader.processMarks(marks, allMovies);
      this.setData({
        markStatusMap,
        markDateMap,
        watchedIds,
        wishIds,
        allMovies,
        movies: allMovies
      }, () => {
        this.syncAwardStats(markStatusMap);
        this.updateFilteredMovies();
        wx.hideNavigationBarLoading();
      });
    } catch (err) {
      console.error('加载电影/标记数据失败:', err);
      this.setData({ allMovies: [], movies: [], allCount: 0 });
      wx.showToast({ title: '暂无数据或加载失败', icon: 'none' });
      wx.hideNavigationBarLoading();
    }
  },

  async loadUserMarks() {
    const openid = this.getActiveOpenid();
    if (!openid) return;
    wx.showNavigationBarLoading();
    try {
      const { marks } = await DataLoader.loadMoviesData('chinese_awards', openid, false);
      const { markStatusMap, markDateMap, watchedIds, wishIds } = DataLoader.processMarks(marks, this.data.allMovies);
      this.setData({
        markStatusMap,
        markDateMap,
        watchedIds,
        wishIds
      }, () => {
        this.syncAwardStats(markStatusMap);
        this.updateFilteredMovies();
        wx.hideNavigationBarLoading();
      });
    } catch (err) {
      console.error('刷新标记失败:', err);
      wx.hideNavigationBarLoading();
    }
  },

  updateWatchPercent() {
    const { watchedCount, allCount } = this.data;
    const watchPercent = allCount > 0 ? Math.round((watchedCount / allCount) * 100) : 0;
    this.setData({ watchPercent });
  },

  getAwardFilteredMovies() {
    const { allMovies, activeAwardKey } = this.data;
    return allMovies.filter(movie => movie.awardKey === activeAwardKey);
  },

  syncAwardStats(markStatusMap = this.data.markStatusMap) {
    const awardMovies = this.getAwardFilteredMovies();
    let watchedCount = 0;
    let wishCount = 0;

    awardMovies.forEach(movie => {
      const status = markStatusMap[movie._id];
      if (status === 'watched') watchedCount++;
      else if (status === 'wish') wishCount++;
    });

    const allCount = awardMovies.length;
    const unwatchedCount = Math.max(0, allCount - watchedCount - wishCount);
    this.setData({ watchedCount, wishCount, unwatchedCount, allCount }, () => {
      this.updateWatchPercent();
    });
  },

  updateFilteredMovies() {
    const { markStatusMap, activeTab } = this.data;
    const awardMovies = this.getAwardFilteredMovies();
    let movies = awardMovies;
    if (activeTab === 1) movies = awardMovies.filter(m => markStatusMap[m._id] === 'watched');
    else if (activeTab === 2) movies = awardMovies.filter(m => markStatusMap[m._id] === 'wish');
    else if (activeTab === 3) movies = awardMovies.filter(m => !markStatusMap[m._id]);
    movies = movies.map(movie => ({ ...movie, checked: this.data.selectedMovieIds.includes(String(movie._id)) }));
    this.setData({ movies });
  },

  onAwardFilterTap(e) {
    const key = e.currentTarget.dataset.key;
    if (!key || key === this.data.activeAwardKey) return;
    this.setData({ activeAwardKey: key, isBatchEditing: false, selectedMovieIds: [], showSharePicker: false }, () => {
      this.syncAwardStats();
      this.updateFilteredMovies();
    });
  },

  onTabChange(e) {
    const idx = Number(e.currentTarget.dataset.idx);
    this.setData({ activeTab: idx, isBatchEditing: false, selectedMovieIds: [], showSharePicker: false }, () => this.updateFilteredMovies());
  },

  onMarkTap(e) {
    const openid = this.getActiveOpenid();
    if (!openid) {
      wx.showModal({
        title: '提示',
        content: '请登录后再进行标记',
        confirmText: '去登录',
        success: (res) => { if (res.confirm) this.onGetUserProfile(); }
      });
      return;
    }

    const movieId = String(e.currentTarget.dataset.id);
    const type = e.currentTarget.dataset.type;
    if (!movieId || !type) {
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
          const markStatusMap = { ...this.data.markStatusMap };
          const markDateMap = { ...this.data.markDateMap };
          const oldStatus = markStatusMap[movieId];
          markStatusMap[movieId] = type;
          markDateMap[movieId] = this.formatMarkDate(now);
          let { watchedCount, wishCount, unwatchedCount } = this.data;
          if (oldStatus === 'watched') watchedCount--;
          else if (oldStatus === 'wish') wishCount--;
          else unwatchedCount--;
          if (type === 'watched') watchedCount++;
          else if (type === 'wish') wishCount++;
          this.setData({ markStatusMap, markDateMap, watchedCount, wishCount, unwatchedCount }, () => {
            this.syncAwardStats(markStatusMap);
            this.updateFilteredMovies();
          });
          wx.showToast({ title: type === 'watched' ? '已更新为已看' : '已更新为想看' });
        });
      } else {
        db.collection('Marks').add({
          data: { movieId, openid, status: type, marked_at: now }
        }).then(() => {
          const markStatusMap = { ...this.data.markStatusMap };
          const markDateMap = { ...this.data.markDateMap };
          markStatusMap[movieId] = type;
          markDateMap[movieId] = this.formatMarkDate(now);
          let { watchedCount, wishCount, unwatchedCount } = this.data;
          if (type === 'watched') watchedCount++;
          else if (type === 'wish') wishCount++;
          unwatchedCount--;
          this.setData({ markStatusMap, markDateMap, watchedCount, wishCount, unwatchedCount }, () => {
            this.syncAwardStats(markStatusMap);
            this.updateFilteredMovies();
          });
          wx.showToast({ title: type === 'watched' ? '已看成功' : '想看成功' });
        });
      }
    });
  },

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

  onStartBatchEdit() {
    if (!this.hasLogin()) {
      this.onGetUserProfile();
      return;
    }
    this.setData({ isBatchEditing: true, selectedMovieIds: [], showSharePicker: false });
    this.updateFilteredMovies();
  },

  onCancelBatchEdit() {
    this.setData({ isBatchEditing: false, selectedMovieIds: [] });
    this.updateFilteredMovies();
  },

  onMovieCheck(e) {
    const movieId = e.currentTarget.dataset.movieId;
    if (movieId === undefined || movieId === null) return;

    let selectedMovieIds = this.data.selectedMovieIds;
    const index = selectedMovieIds.indexOf(movieId);
    let checked;
    if (index > -1) {
      selectedMovieIds.splice(index, 1);
      checked = false;
    } else {
      selectedMovieIds = [...selectedMovieIds, movieId];
      checked = true;
    }

    const updatedMovies = this.data.movies.map(movie => {
      if (String(movie._id) === String(movieId)) return { ...movie, checked };
      return movie;
    });
    this.setData({ selectedMovieIds, movies: updatedMovies });
  },

  onBatchWatch() {
    if (this.data.selectedMovieIds.length === 0) {
      wx.showToast({ title: '请选择电影', icon: 'none' });
      return;
    }
    this.batchUpdateMarks(this.data.selectedMovieIds, 'watched');
  },

  onBatchWish() {
    if (this.data.selectedMovieIds.length === 0) {
      wx.showToast({ title: '请选择电影', icon: 'none' });
      return;
    }
    this.batchUpdateMarks(this.data.selectedMovieIds, 'wish');
  },

  batchUpdateMarks(movieIds, status) {
    const openid = this.getActiveOpenid();
    if (!openid) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      return;
    }

    wx.showLoading({ title: '批量更新中...' });
    wx.cloud.callFunction({
      name: 'batchUpdateMarks',
      data: { movieIds, status, openid },
      success: res => {
        wx.hideLoading();
        if (res.result && res.result.success) {
          wx.showToast({ title: '批量标记成功', icon: 'success' });
          this.setData({ isBatchEditing: false, selectedMovieIds: [] });
          setTimeout(() => { this.loadUserMarks(); }, 500);
        } else {
          wx.showToast({ title: '部分标记失败', icon: 'none' });
        }
      },
      fail: err => {
        wx.hideLoading();
        console.error('批量标记云函数失败:', err);
        wx.showToast({ title: '网络错误，请重试', icon: 'none' });
      }
    });
  },

  onImageLoad(e) {
    const movieId = e.currentTarget.dataset.movieId;
    if (movieId) {
      this.updateMovieImageStatus(movieId, { imageLoaded: true, imageError: false });
      this.addToImageCache(movieId, e.currentTarget.src);
      const movie = this.data.allMovies.find(m => String(m._id) === String(movieId));
      if (movie) {
        const fullUrl = movie.cover || movie.coverUrl || movie.originalCover;
        if (fullUrl && !fullUrl.startsWith('cloud://')) imageCacheManager.prefetchToLocal(fullUrl);
      }
    }
  },

  onImageError(e) {
    const movieId = e.currentTarget.dataset.movieId;
    if (movieId) {
      this.updateMovieImageStatus(movieId, { imageLoaded: false, imageError: true });
      this.tryFallbackImage(movieId);
    }
  },

  updateMovieImageStatus(movieId, status) {
    const movies = this.data.movies.map(m => String(m._id) === String(movieId) ? { ...m, ...status } : m);
    const allMovies = this.data.allMovies.map(m => String(m._id) === String(movieId) ? { ...m, ...status } : m);
    this.setData({ movies, allMovies });
  },

  addToImageCache(movieId, imageUrl) {
    const imageCache = { ...this.data.imageCache };
    imageCache[movieId] = imageUrl;
    this.setData({ imageCache });
  },

  tryFallbackImage(movieId) {
    const movie = this.data.movies.find(m => String(m._id) === String(movieId));
    if (movie && movie.originalCover && movie.cover !== movie.originalCover) {
      this.updateMovieImage(movieId, movie.originalCover);
    } else {
      this.updateMovieImage(movieId, '/images/default-movie.jpg');
    }
  },

  updateMovieImage(movieId, imageUrl) {
    const movies = this.data.movies.map(m => String(m._id) === String(movieId) ? { ...m, cover: imageUrl } : m);
    const allMovies = this.data.allMovies.map(m => String(m._id) === String(movieId) ? { ...m, cover: imageUrl } : m);
    this.setData({ movies, allMovies });
  },

  onShareAppMessage() {
    return {
      title: '华语电影最高荣誉殿堂 - 记录你的华语观影旅程',
      path: '/pages/chinese-awards/list/list'
    };
  },

  initAds() {
    if (this.data.adUnitIds.movielist_infeed) this.setData({ showInfeedAd: true });
  },

  onInfeedAdLoad() {},

  onInfeedAdError() {
    this.setData({ showInfeedAd: false });
  },

  preloadVisibleImages() {
    const visibleMovies = this.data.movies.slice(0, 20);
    visibleMovies.forEach(movie => {
      if (!movie.imageLoaded && !movie.imageError && !this.data.loadingImages[movie._id]) {
        this.data.loadingImages[movie._id] = true;
        const img = this.data.movies.find(m => m._id === movie._id);
        const imageSrc = img && (img.thumbCover || img.cover || img.originalCover);
        if (imageSrc) {
          if (imageSrc.startsWith('cloud://')) {
            this.updateMovieImageStatus(movie._id, { imageLoaded: true });
            delete this.data.loadingImages[movie._id];
            return;
          }
          wx.getImageInfo({
            src: imageSrc,
            success: () => { this.updateMovieImageStatus(movie._id, { imageLoaded: true }); },
            fail: () => {
              this.updateMovieImageStatus(movie._id, { imageError: true });
              this.tryFallbackImage(movie._id);
            },
            complete: () => { delete this.data.loadingImages[movie._id]; }
          });
        } else {
          delete this.data.loadingImages[movie._id];
        }
      }
    });
  }
});
