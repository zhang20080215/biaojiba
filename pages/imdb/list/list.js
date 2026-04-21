import DataLoader from '../../../utils/dataLoader';
import imageCacheManager from '../../../utils/imageCacheManager';
var adConfig = require('../../../utils/adConfig');
var adManager = require('../../../utils/adManager');

Page({
    data: {
        userInfo: null,
        openid: '',
        pendingOpenid: '',
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
        watchedProgressPercent: 0,
        watchedProgressText: '0%',
        watchedProgressWidth: '0%',
        activeTab: 0,
        currentFilter: 'all',
        isBatchEditing: false,
        selectedMovieIds: [],
        loading: false,
        showAuthModal: false,
        customToast: '',
        customToastVisible: false,
        showSharePicker: false,
        tempAvatar: '',
        tempNickname: '',
        themeClass: '',
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

        const savedTheme = wx.getStorageSync('appTheme') || getApp().globalData.theme || '';

        this.setData({
            themeClass: savedTheme
        });

        this.checkLoginStatus();
        this.loadAllMovies();
        this.initAds();
        this.setNavBarColor(savedTheme);
    },

    async onPullDownRefresh() {
        await this.loadAllMovies(true);
        wx.stopPullDownRefresh();
    },

    onShow() {
        const currentTheme = getApp().globalData.theme || '';
        if (this.data.themeClass !== currentTheme) {
            this.setData({ themeClass: currentTheme });
        }
        this.checkLoginStatus();
        this.setNavBarColor(currentTheme);
    },

    // 将导航栏背景色与 hero 配色对齐，消除 hairline 对比度
    setNavBarColor(theme) {
        const colorMap = {
            'theme-gold':  { bg: '#F7D66E', fg: '#000000' },
            'theme-green': { bg: '#9AAB65', fg: '#ffffff' },
            'theme-sand':  { bg: '#F8F3E7', fg: '#000000' },
        };
        const c = colorMap[theme] || { bg: '#FAE0E4', fg: '#000000' };
        wx.setNavigationBarColor({ frontColor: c.fg, backgroundColor: c.bg, animation: { duration: 0 } });
    },

    buildWatchedProgress(watchedCount = 0, allCount = 0) {
        const safeWatchedCount = Math.max(0, Number(watchedCount) || 0);
        const safeAllCount = Math.max(0, Number(allCount) || 0);
        const watchedProgressPercent = safeAllCount > 0
            ? Math.min(100, Math.round((safeWatchedCount / safeAllCount) * 100))
            : 0;

        return {
            watchedProgressPercent,
            watchedProgressText: `${watchedProgressPercent}%`,
            watchedProgressWidth: `${watchedProgressPercent}%`
        };
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
            this.setData({ userInfo, openid: userInfo._openid || '', pendingOpenid: '' });
        } else {
            this.setData({ userInfo: null, openid: '' });
        }
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
        if (this._navigatingToShare) return;
        this._navigatingToShare = true;

        this.setData({ showSharePicker: false }, () => {
            wx.nextTick(() => {
                adManager.showInterstitial('share_interstitial').then(() => {
                    wx.navigateTo({
                        url: `/pages/imdb/share/share?type=${type}`,
                        complete: () => {
                            this._navigatingToShare = false;
                        }
                    });
                });
            });
        });
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
                    wx.showToast({ title: '获取 openid 失败', icon: 'none' });
                    return;
                }
                wx.hideLoading();
                this.setData({
                    loading: false,
                    pendingOpenid: _openid,
                    showAuthModal: true,
                    tempAvatar: '',
                    tempNickname: ''
                });
            },
            fail: err => {
                console.error('获取 openid 失败:', err);
                wx.hideLoading();
                this.setData({ loading: false });
                wx.showToast({ title: '网络错误，请重试', icon: 'none' });
            }
        });
    },

    onCancelAuth() {
        this.setData({ showAuthModal: false, pendingOpenid: '' });
    },

    onChooseAvatar(e) {
        this.setData({ tempAvatar: e.detail.avatarUrl });
    },

    onNicknameInput(e) {
        this.setData({ tempNickname: e.detail.value });
    },

    async onConfirmAuth() {
        const { tempAvatar, tempNickname } = this.data;
        const openid = this.data.pendingOpenid || this.data.openid;
        if (!openid) {
            wx.showToast({ title: '请先完成登录', icon: 'none' });
            return;
        }
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
                    data: {
                        openid,
                        nickname: userInfo.nickName,
                        avatarUrl: userInfo.avatarUrl,
                        created_at: new Date(),
                        updated_at: new Date()
                    }
                });
            } else {
                await db.collection('users').doc(userRes.data[0]._id).update({
                    data: {
                        nickname: userInfo.nickName,
                        avatarUrl: userInfo.avatarUrl,
                        updated_at: new Date()
                    }
                });
            }

            wx.setStorageSync('userInfo', userInfo);
            this.setData({ userInfo, openid, pendingOpenid: '', showAuthModal: false });
            wx.hideLoading();
            wx.showToast({ title: '登录成功', icon: 'success' });
            this.loadUserMarks();
        } catch (err) {
            console.error('保存用户信息失败:', err);
            wx.hideLoading();
            wx.showToast({ title: '保存失败，请重试', icon: 'none' });
        }
    },

    normalizeTextList(value, separator = ' / ') {
        if (Array.isArray(value)) {
            return value.filter(Boolean).join(separator);
        }
        if (value === undefined || value === null) return '';
        return String(value).trim();
    },

    trimText(value, maxLength = 48) {
        const text = this.normalizeTextList(value);
        if (!text) return '';
        return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
    },

    buildImdbMovieViewModel(movie) {
        const directorText = this.normalizeTextList(movie.directors || movie.director);
        const genreText = this.normalizeTextList(movie.genre || movie.genres);
        const countryText = this.normalizeTextList(movie.country || movie.countries);
        const languageText = this.normalizeTextList(movie.language || movie.languages);
        const runtimeText = this.normalizeTextList(movie.runtime || movie.duration);

        return {
            ...movie,
            _id: String(movie._id),
            thumbCover: imageCacheManager.getThumbnailUrl(movie.cover || movie.coverUrl || movie.originalCover, 'list'),
            yearText: movie.year ? String(movie.year) : '',
            extraMetaPrimary: [directorText, genreText].filter(Boolean).join(' · '),
            extraMetaSecondary: [countryText || languageText, runtimeText].filter(Boolean).join(' · '),
        };
    },

    async loadAllMovies(forceRefresh = false) {
        wx.showNavigationBarLoading();
        try {
            const openid = this.getActiveOpenid() || null;
            const { movies, marks } = await DataLoader.loadMoviesData('imdb', openid, forceRefresh);

            const allMovies = movies.map(movie => this.buildImdbMovieViewModel(movie));
            this.data.allMovies = allMovies;
            this.data.allCount = allMovies.length;

            const { markStatusMap, markDateMap, watchedIds, wishIds, stats } = DataLoader.processMarks(marks, allMovies);

            this.setData({
                markStatusMap,
                markDateMap,
                watchedIds,
                wishIds,
                watchedCount: stats.watched,
                wishCount: stats.wish,
                unwatchedCount: stats.unwatched,
                allCount: allMovies.length,
                ...this.buildWatchedProgress(stats.watched, allMovies.length),
                allMovies,
                movies: allMovies
            }, () => {
                this.updateFilteredMovies();
                wx.hideNavigationBarLoading();
            });
        } catch (err) {
            console.error('加载电影/标记数据失败:', err);
            this.setData({
                allMovies: [],
                movies: [],
                watchedCount: 0,
                wishCount: 0,
                unwatchedCount: 0,
                allCount: 0,
                ...this.buildWatchedProgress(0, 0)
            });
            wx.showToast({ title: '暂无数据或加载失败', icon: 'none' });
            wx.hideNavigationBarLoading();
        }
    },

    async loadUserMarks() {
        const openid = this.getActiveOpenid();
        if (!openid) return;
        wx.showNavigationBarLoading();
        try {
            const { marks } = await DataLoader.loadMoviesData('imdb', openid, false);
            const { markStatusMap, markDateMap, watchedIds, wishIds, stats } = DataLoader.processMarks(marks, this.data.allMovies);
            this.setData({
                markStatusMap,
                markDateMap,
                watchedIds,
                wishIds,
                watchedCount: stats.watched,
                wishCount: stats.wish,
                unwatchedCount: stats.unwatched,
                ...this.buildWatchedProgress(stats.watched, this.data.allMovies.length)
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
        else if (activeTab === 1) movies = allMovies.filter(movie => markStatusMap[movie._id] === 'watched');
        else if (activeTab === 2) movies = allMovies.filter(movie => markStatusMap[movie._id] === 'wish');
        else if (activeTab === 3) movies = allMovies.filter(movie => !markStatusMap[movie._id]);

        movies = movies.map(movie => ({
            ...movie,
            checked: this.data.selectedMovieIds.includes(String(movie._id))
        }));

        this.setData({ movies });
    },

    onTabChange(e) {
        const idx = Number(e.currentTarget.dataset.idx);
        this.setData({ activeTab: idx, isBatchEditing: false, selectedMovieIds: [] }, this.updateFilteredMovies);
    },

    recalculateMarkStats(markStatusMap) {
        let watchedCount = 0;
        let wishCount = 0;
        const allCount = this.data.allMovies.length;

        Object.keys(markStatusMap).forEach(movieId => {
            const status = markStatusMap[movieId];
            if (status === 'watched') watchedCount++;
            else if (status === 'wish') wishCount++;
        });

        return {
            watchedCount,
            wishCount,
            unwatchedCount: Math.max(0, allCount - watchedCount - wishCount),
            watchedIds: Object.keys(markStatusMap).filter(movieId => markStatusMap[movieId] === 'watched'),
            wishIds: Object.keys(markStatusMap).filter(movieId => markStatusMap[movieId] === 'wish')
        };
    },

    applyBatchMarksLocally(movieIds, status) {
        const markStatusMap = { ...this.data.markStatusMap };
        const markDateMap = { ...this.data.markDateMap };
        const now = this.formatMarkDate(new Date().toISOString());

        movieIds.forEach(movieId => {
            const normalizedMovieId = String(movieId);
            if (status === 'unwatched') {
                delete markStatusMap[normalizedMovieId];
                delete markDateMap[normalizedMovieId];
            } else {
                markStatusMap[normalizedMovieId] = status;
                markDateMap[normalizedMovieId] = now;
            }
        });

        const { watchedCount, wishCount, unwatchedCount, watchedIds, wishIds } = this.recalculateMarkStats(markStatusMap);

        this.setData({
            markStatusMap,
            markDateMap,
            watchedIds,
            wishIds,
            watchedCount,
            wishCount,
            unwatchedCount,
            ...this.buildWatchedProgress(watchedCount, this.data.allMovies.length),
            isBatchEditing: false,
            selectedMovieIds: []
        }, () => {
            this.updateFilteredMovies();
        });
    },

    onMarkTap(e) {
        const openid = this.getActiveOpenid();
        if (!openid) {
            wx.showModal({
                title: '提示',
                content: '请登录后再进行标记',
                confirmText: '去登录',
                success: res => {
                    if (res.confirm) this.onGetUserProfile();
                }
            });
            return;
        }

        const movieId = String(e.currentTarget.dataset.id);
        const type = e.currentTarget.dataset.type;
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

                    this.setData({
                        markStatusMap,
                        markDateMap,
                        watchedCount,
                        wishCount,
                        unwatchedCount,
                        ...this.buildWatchedProgress(watchedCount, this.data.allMovies.length)
                    }, this.updateFilteredMovies);
                    this.showCustomToast(type === 'watched' ? '已标记为已看' : '已标记为想看');
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

                    this.setData({
                        markStatusMap,
                        markDateMap,
                        watchedCount,
                        wishCount,
                        unwatchedCount,
                        ...this.buildWatchedProgress(watchedCount, this.data.allMovies.length)
                    }, this.updateFilteredMovies);
                    this.showCustomToast(type === 'watched' ? '已标记为已看' : '已标记为想看');
                });
            }
        });
    },

    showCustomToast(msg) {
        if (this._toastTimer) clearTimeout(this._toastTimer);
        this.setData({ customToast: msg, customToastVisible: true });
        this._toastTimer = setTimeout(() => {
            this.setData({ customToastVisible: false });
        }, 1500);
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

    onBatchUnwatch() {
        if (this.data.selectedMovieIds.length === 0) {
            wx.showToast({ title: '请选择电影', icon: 'none' });
            return;
        }
        this.batchUpdateMarks(this.data.selectedMovieIds, 'unwatched');
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
                    this.applyBatchMarksLocally(movieIds, status);
                    wx.showToast({ title: '批量标记成功', icon: 'success' });
                    setTimeout(() => {
                        this.loadUserMarks();
                    }, 300);
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

    onImageError(e) {
        const movieId = e.currentTarget.dataset.movieId;
        if (movieId) {
            this.tryFallbackImage(movieId);
        }
    },

    tryFallbackImage(movieId) {
        const movie = this.data.movies.find(m => String(m._id) === String(movieId));
        if (movie && movie.originalCover && movie.cover !== movie.originalCover) {
            this.updateMovieImage(movieId, movie.originalCover);
        } else {
            this.updateMovieImage(movieId, 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzAwIiBoZWlnaHQ9IjQ1MCIgdmlld0JveD0iMCAwIDMwMCA0NTAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHdpZHRoPSIzMDAiIGhlaWdodD0iNDUwIiBmaWxsPSIjRjVGNUY1Ii8+CjxwYXRoIGQ9Ik0xNTAgMjAwTDEyMCAyNTBMMTUwIDMwMEwyMDAgMjUwTDE1MCAyMDBaIiBmaWxsPSIjQ0NDQ0NDIi8+Cjx0ZXh0IHg9IjE1MCIgeT0iMzUwIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmaWxsPSIjOTk5OTk5IiBmb250LXNpemU9IjE0Ij7lm77niYfmlrDpl7vnpL7kvJ08L3RleHQ+Cjwvc3ZnPgo=');
        }
    },

    // 只对命中的下标做定点 setData，避免把 250 条电影数组整体回传给视图层
    updateMovieImage(movieId, imageUrl) {
        const targetId = String(movieId);
        const updates = {};
        const mIdx = this.data.movies.findIndex(m => String(m._id) === targetId);
        if (mIdx >= 0) {
            updates[`movies[${mIdx}].cover`] = imageUrl;
            updates[`movies[${mIdx}].thumbCover`] = imageUrl;
        }
        const aIdx = this.data.allMovies.findIndex(m => String(m._id) === targetId);
        if (aIdx >= 0) {
            updates[`allMovies[${aIdx}].cover`] = imageUrl;
            updates[`allMovies[${aIdx}].thumbCover`] = imageUrl;
        }
        if (Object.keys(updates).length) this.setData(updates);
    },

    onShareAppMessage() {
        return {
            title: 'IMDB电影TOP250 - 标记你的全球佳片',
            path: '/pages/imdb/list/list'
        };
    },

    initAds() {
        if (this.data.adUnitIds.movielist_infeed) {
            this.setData({ showInfeedAd: true });
        }
    },

    onInfeedAdLoad() {},

    onInfeedAdError() {
        this.setData({ showInfeedAd: false });
    }
});
