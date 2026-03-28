import DataLoader from '../../../utils/dataLoader';
import imageCacheManager from '../../../utils/imageCacheManager';

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
        currentFilter: 'all',
        isBatchEditing: false,
        selectedMovieIds: [],
        imageCache: {},
        loadingImages: {},
        loading: false,
        showAuthModal: false,
        tempAvatar: '',
        tempNickname: '',
        showShareModal: false
    },

    onLoad() {
        if (!wx.cloud) {
            wx.showToast({ title: '请升级基础库', icon: 'none' });
            return;
        }
        wx.setNavigationBarTitle({ title: '全球电影票房榜' });
        this.checkLoginStatus();
        this.loadAllMovies();
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

    checkLoginStatus() {
        const userInfo = wx.getStorageSync('userInfo');
        if (userInfo) {
            this.setData({ userInfo, openid: userInfo._openid });
        } else {
            this.setData({ userInfo: null, openid: '' });
        }
    },

    onShareTap() {
        if (!this.data.userInfo) {
            wx.showToast({ title: '请先完成登录', icon: 'none' });
            this.onGetUserProfile();
            return;
        }
        this.setData({ showShareModal: true });
    },

    onShareSelect(e) {
        const type = e.currentTarget.dataset.type;
        this.setData({ showShareModal: false });
        wx.navigateTo({ url: `/pages/boxoffice/share/share?type=${type}` });
    },

    onCloseShareModal() {
        this.setData({ showShareModal: false });
    },

    onHeaderLoginClick() {
        if (!this.data.userInfo) {
            this.onGetUserProfile();
        }
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
                this.setData({
                    loading: false, openid: _openid,
                    showAuthModal: true, tempAvatar: '', tempNickname: ''
                });
            },
            fail: err => {
                console.error('获取openid失败:', err);
                wx.hideLoading();
                this.setData({ loading: false });
                wx.showToast({ title: '网络错误，请重试', icon: 'none' });
            }
        });
    },

    onCancelAuth() { this.setData({ showAuthModal: false }); },
    onChooseAvatar(e) { this.setData({ tempAvatar: e.detail.avatarUrl }); },
    onNicknameInput(e) { this.setData({ tempNickname: e.detail.value }); },

    async onConfirmAuth() {
        const { tempAvatar, tempNickname, openid } = this.data;
        if (!tempAvatar || tempAvatar === '/images/default-avatar.svg') {
            wx.showToast({ title: '请选择头像', icon: 'none' }); return;
        }
        if (!tempNickname || !tempNickname.trim()) {
            wx.showToast({ title: '请输入昵称', icon: 'none' }); return;
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
            const openid = this.data.userInfo ? this.data.userInfo._openid : null;
            const { movies, marks } = await DataLoader.loadMoviesData('boxoffice', openid, forceRefresh);

            // 检测缓存数据是否缺少封面（首条有cover字段说明数据完整）
            if (!forceRefresh && movies.length > 0 && !movies[0].cover) {
                DataLoader.invalidateMovieCache('boxoffice');
                return this.loadAllMovies(true);
            }

            const allMovies = movies.map(m => ({
                ...m,
                _id: String(m._id),
                thumbCover: imageCacheManager.getThumbnailUrl(m.cover || m.coverUrl || m.originalCover, 'list'),
                imageLoaded: false,
                imageError: false
            }));
            this.data.allMovies = allMovies;
            this.data.allCount = allMovies.length;

            const { markStatusMap, markDateMap, watchedIds, wishIds, stats } = DataLoader.processMarks(marks, allMovies);

            this.setData({
                markStatusMap, markDateMap, watchedIds, wishIds,
                watchedCount: stats.watched, wishCount: stats.wish,
                unwatchedCount: stats.unwatched, allCount: allMovies.length,
                allMovies, movies: allMovies
            }, () => {
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
        if (!this.data.userInfo || !this.data.userInfo._openid) return;
        wx.showNavigationBarLoading();
        try {
            const openid = this.data.userInfo._openid;
            const { marks } = await DataLoader.loadMoviesData('boxoffice', openid, false);
            const { markStatusMap, markDateMap, watchedIds, wishIds, stats } = DataLoader.processMarks(marks, this.data.allMovies);
            this.setData({
                markStatusMap, markDateMap, watchedIds, wishIds,
                watchedCount: stats.watched, wishCount: stats.wish, unwatchedCount: stats.unwatched
            }, () => {
                this.updateFilteredMovies();
                wx.hideNavigationBarLoading();
            });
        } catch (err) {
            console.error('刷新标记失败:', err);
            wx.hideNavigationBarLoading();
        }
    },

    updateFilteredMovies() {
        const { allMovies, markStatusMap, activeTab } = this.data;
        let movies = [];
        if (activeTab === 0) movies = allMovies;
        else if (activeTab === 1) movies = allMovies.filter(m => markStatusMap[m._id] === 'watched');
        else if (activeTab === 2) movies = allMovies.filter(m => markStatusMap[m._id] === 'wish');
        else if (activeTab === 3) movies = allMovies.filter(m => !markStatusMap[m._id]);
        movies = movies.map(movie => ({ ...movie, checked: this.data.selectedMovieIds.includes(String(movie._id)) }));
        this.setData({ movies });
    },

    onTabChange(e) {
        const idx = Number(e.currentTarget.dataset.idx);
        this.setData({ activeTab: idx, isBatchEditing: false, selectedMovieIds: [] }, this.updateFilteredMovies);
    },

    onMarkTap(e) {
        if (!this.data.userInfo) {
            wx.showModal({
                title: '提示', content: '请登录后再进行标记', confirmText: '去登录',
                success: (res) => { if (res.confirm) this.onGetUserProfile(); }
            });
            return;
        }

        const movieId = String(e.currentTarget.dataset.id);
        const type = e.currentTarget.dataset.type;
        const openid = this.data.userInfo._openid;
        if (!movieId || !type || !openid) {
            wx.showToast({ title: '数据不完整', icon: 'none' }); return;
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
                    this.setData({ markStatusMap, markDateMap, watchedCount, wishCount, unwatchedCount }, this.updateFilteredMovies);
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
                    this.setData({ markStatusMap, markDateMap, watchedCount, wishCount, unwatchedCount }, this.updateFilteredMovies);
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
        } catch (e) { return ''; }
    },

    onStartBatchEdit() {
        if (!this.data.userInfo) { this.onGetUserProfile(); return; }
        this.setData({ isBatchEditing: true, selectedMovieIds: [] });
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
            wx.showToast({ title: '请选择电影', icon: 'none' }); return;
        }
        this.batchUpdateMarks(this.data.selectedMovieIds, 'watched');
    },

    onBatchWish() {
        if (this.data.selectedMovieIds.length === 0) {
            wx.showToast({ title: '请选择电影', icon: 'none' }); return;
        }
        this.batchUpdateMarks(this.data.selectedMovieIds, 'wish');
    },

    batchUpdateMarks(movieIds, status) {
        const openid = this.data.userInfo._openid;
        if (!openid) { wx.showToast({ title: '请先登录', icon: 'none' }); return; }

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
        // 找到原始电影数据，尝试 cloud:// 转临时URL
        const movie = this.data.allMovies.find(m => String(m._id) === String(movieId));
        const cloudUrl = movie && (movie.cover || movie.coverUrl);
        if (cloudUrl && cloudUrl.startsWith('cloud://')) {
            if (!this._fallbackAttempted) this._fallbackAttempted = {};
            if (this._fallbackAttempted[movieId]) {
                this.updateMovieImage(movieId, '/images/default-movie.jpg');
                return;
            }
            this._fallbackAttempted[movieId] = true;
            wx.cloud.getTempFileURL({
                fileList: [cloudUrl],
                success: (res) => {
                    const fileItem = res.fileList && res.fileList[0];
                    if (fileItem && fileItem.tempFileURL) {
                        this.updateMovieImage(movieId, fileItem.tempFileURL);
                    } else {
                        this.updateMovieImage(movieId, '/images/default-movie.jpg');
                    }
                },
                fail: () => {
                    this.updateMovieImage(movieId, '/images/default-movie.jpg');
                }
            });
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
            title: '全球电影票房榜 - 见证影史商业传奇',
            path: '/pages/boxoffice/list/list'
        };
    },

    preloadVisibleImages() {
        const visibleMovies = this.data.movies.slice(0, 20);
        visibleMovies.forEach(movie => {
            if (!movie.imageLoaded && !movie.imageError && !this.data.loadingImages[movie._id]) {
                this.data.loadingImages[movie._id] = true;
                const img = this.data.movies.find(m => m._id === movie._id);
                if (img && img.cover) {
                    // cloud:// 文件 ID 不能用 wx.getImageInfo 预检，<image> 组件可直接渲染
                    if (img.cover.startsWith('cloud://')) {
                        this.updateMovieImageStatus(movie._id, { imageLoaded: true });
                        delete this.data.loadingImages[movie._id];
                        return;
                    }
                    wx.getImageInfo({
                        src: img.cover,
                        success: () => { this.updateMovieImageStatus(movie._id, { imageLoaded: true }); },
                        fail: () => {
                            this.updateMovieImageStatus(movie._id, { imageError: true });
                            this.tryFallbackImage(movie._id);
                        },
                        complete: () => { delete this.data.loadingImages[movie._id]; }
                    });
                }
            }
        });
    }
});
