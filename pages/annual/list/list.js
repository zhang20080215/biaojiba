import DataLoader from '../../../utils/dataLoader';
import imageCacheManager from '../../../utils/imageCacheManager';

var adConfig = require('../../../utils/adConfig');

const ANNUAL_YEAR = 2026;

function pad2(value) {
    return String(value).padStart(2, '0');
}

function getCurrentMonthKey() {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    return `${year}-${pad2(month)}`;
}

function getTodayKey() {
    const now = new Date();
    return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

function normalizeDateValue(value) {
    if (!value) return '';
    if (typeof value === 'object' && value.toDate) {
        return value.toDate().toISOString().slice(0, 10);
    }
    if (typeof value === 'object' && value instanceof Date) {
        return value.toISOString().slice(0, 10);
    }
    return String(value).replace(/\./g, '-').replace(/\//g, '-').slice(0, 10);
}

function getReleaseMonthKey(movie) {
    const explicit = movie.releaseMonth || movie.monthKey;
    if (explicit) return String(explicit);

    const releaseDate = normalizeDateValue(movie.releaseDate);
    const matched = releaseDate.match(/^(\d{4})-(\d{2})/);
    if (matched) return `${matched[1]}-${matched[2]}`;
    return `${ANNUAL_YEAR}-00`;
}

function compareByReleaseDate(a, b) {
    const dateA = normalizeDateValue(a.releaseDate);
    const dateB = normalizeDateValue(b.releaseDate);

    if (dateA && dateB && dateA !== dateB) {
        return dateA.localeCompare(dateB);
    }
    if (dateA && !dateB) return -1;
    if (!dateA && dateB) return 1;
    return String(a.title || '').localeCompare(String(b.title || ''));
}

function toDisplayScore(value, suffix = '') {
    if (value === undefined || value === null || value === '') return '暂无';
    const numeric = Number(value);
    if (Number.isNaN(numeric) || numeric <= 0) return '暂无';
    const base = Number.isInteger(numeric) ? String(numeric) : numeric.toFixed(1).replace(/\.0$/, '');
    return `${base}${suffix}`;
}

function toTomatometerText(value) {
    if (value === undefined || value === null || value === '') return '暂无';
    const text = String(value).trim();
    if (!text) return '暂无';
    if (/%$/.test(text)) return text;
    const numeric = Number(text);
    if (Number.isNaN(numeric) || numeric <= 0) return '暂无';
    return `${Math.round(numeric)}%`;
}

Page({
    data: {
        userInfo: null,
        openid: '',
        allMovies: [],
        movies: [],
        monthSummaries: [],
        selectedMonth: '',
        selectedMonthLabel: '',
        selectedMonthCount: 0,
        markStatusMap: {},
        markDateMap: {},
        watchedIds: [],
        wishIds: [],
        watchedCount: 0,
        wishCount: 0,
        unwatchedCount: 0,
        allCount: 0,
        statusFilter: 'all',
        isBatchEditing: false,
        selectedMovieIds: [],
        imageCache: {},
        loadingImages: {},
        loading: false,
        showAuthModal: false,
        tempAvatar: '',
        tempNickname: '',
        showInfeedAd: false,
        adUnitIds: {
            movielist_infeed: adConfig.getAdUnitId('movielist_infeed') || '',
        },
    },

    onLoad() {
        if (!wx.cloud) {
            wx.showToast({ title: '请升级基础库', icon: 'none' });
            return;
        }

        wx.setNavigationBarTitle({ title: `${ANNUAL_YEAR} 院线电影` });
        this.checkLoginStatus();
        this.loadAllMovies();
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
        }, 400);
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
        if (!this.hasLogin()) {
            this.onGetUserProfile();
        }
    },

    onShareTap() {
        if (!this.hasLogin()) {
            wx.showToast({ title: '请先登录', icon: 'none' });
            this.onGetUserProfile();
            return;
        }

        wx.showActionSheet({
            itemList: ['海报墙', '文字卡片'],
            success: (res) => {
                const type = res.tapIndex === 0 ? 'poster' : 'text';
                wx.navigateTo({ url: `/pages/annual/share/share?type=${type}` });
            }
        });
    },

    onGetUserProfile() {
        if (this.data.loading) return;

        this.setData({ loading: true });
        wx.showLoading({ title: '准备登录...' });
        wx.cloud.callFunction({
            name: 'getOpenid',
            success: (ret) => {
                const openid = ret && ret.result ? ret.result.openid : '';
                wx.hideLoading();
                this.setData({ loading: false });

                if (!openid) {
                    wx.showToast({ title: '获取 openid 失败', icon: 'none' });
                    return;
                }

                this.setData({
                    openid,
                    showAuthModal: true,
                    tempAvatar: '',
                    tempNickname: ''
                });
            },
            fail: (err) => {
                console.error('getOpenid failed:', err);
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

            const userInfo = {
                _openid: openid,
                nickName: tempNickname.trim(),
                avatarUrl: finalAvatarUrl
            };
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
            this.setData({ userInfo, showAuthModal: false });
            wx.hideLoading();
            wx.showToast({ title: '登录成功', icon: 'success' });
            this.loadUserMarks();
        } catch (err) {
            console.error('save user info failed:', err);
            wx.hideLoading();
            wx.showToast({ title: '保存失败，请重试', icon: 'none' });
        }
    },

    buildAnnualMovieViewModel(movie) {
        const releaseDate = normalizeDateValue(movie.releaseDate);
        const releaseMonth = getReleaseMonthKey(movie);
        const releaseMonthNum = releaseMonth.split('-')[1] || '';
        const releaseDateText = releaseDate
            ? `${releaseDate.slice(5, 7)}.${releaseDate.slice(8, 10)}`
            : '上映待定';

        return {
            ...movie,
            _id: String(movie._id),
            releaseDate,
            releaseMonth,
            releaseMonthNum,
            releaseDateText,
            directorText: String(movie.director || '').trim() || '导演待补充',
            thumbCover: imageCacheManager.getThumbnailUrl(movie.cover || movie.coverUrl || movie.originalCover, 'list'),
            cover: movie.cover || movie.coverUrl || movie.originalCover || '/images/default-movie.jpg',
            imageLoaded: false,
            imageError: false,
            doubanRatingText: toDisplayScore(movie.doubanRating || movie.rating),
            imdbRatingText: toDisplayScore(movie.imdbRating),
            rottenTomatoesText: toTomatometerText(movie.rottenTomatoes),
            subtitleText: String(movie.originalTitle || '').trim(),
        };
    },

    buildMonthSummaries(allMovies) {
        const countMap = {};
        allMovies.forEach((movie) => {
            countMap[movie.releaseMonth] = (countMap[movie.releaseMonth] || 0) + 1;
        });

        const currentMonthKey = getCurrentMonthKey();
        const summaries = [];
        for (let month = 1; month <= 12; month++) {
            const key = `${ANNUAL_YEAR}-${pad2(month)}`;
            summaries.push({
                key,
                month,
                label: `${month}月`,
                count: countMap[key] || 0,
                isCurrentMonth: key === currentMonthKey
            });
        }
        return summaries;
    },

    getDefaultMonth(monthSummaries) {
        const currentMonthKey = getCurrentMonthKey();
        const current = monthSummaries.find((item) => item.key === currentMonthKey);
        if (current) return current.key;

        const firstWithMovies = monthSummaries.find((item) => item.count > 0);
        return firstWithMovies ? firstWithMovies.key : `${ANNUAL_YEAR}-01`;
    },

    setSelectedMonthMeta(selectedMonth) {
        const summary = this.data.monthSummaries.find((item) => item.key === selectedMonth);
        this.setData({
            selectedMonth,
            selectedMonthLabel: summary ? summary.label : '',
            selectedMonthCount: summary ? summary.count : 0
        });
    },

    async loadAllMovies(forceRefresh = false) {
        wx.showNavigationBarLoading();
        try {
            const refreshKey = 'annual_movies_last_refresh_day';
            const todayKey = getTodayKey();
            const shouldDailyRefresh = wx.getStorageSync(refreshKey) !== todayKey;
            const finalForceRefresh = forceRefresh || shouldDailyRefresh;

              const openid = this.getActiveOpenid() || null;
            const { movies, marks } = await DataLoader.loadMoviesData('annual', openid, finalForceRefresh);
            wx.setStorageSync(refreshKey, todayKey);

            const allMovies = movies
                .map((movie) => this.buildAnnualMovieViewModel(movie))
                .sort(compareByReleaseDate);

            const { markStatusMap, markDateMap, watchedIds, wishIds, stats } = DataLoader.processMarks(marks, allMovies);
            const monthSummaries = this.buildMonthSummaries(allMovies);
            const selectedMonth = monthSummaries.some((item) => item.key === this.data.selectedMonth)
                ? this.data.selectedMonth
                : this.getDefaultMonth(monthSummaries);
            const selectedMonthMeta = monthSummaries.find((item) => item.key === selectedMonth);

            this.data.allMovies = allMovies;

            this.setData({
                allMovies,
                monthSummaries,
                selectedMonth,
                selectedMonthLabel: selectedMonthMeta ? selectedMonthMeta.label : '',
                selectedMonthCount: selectedMonthMeta ? selectedMonthMeta.count : 0,
                markStatusMap,
                markDateMap,
                watchedIds,
                wishIds,
                watchedCount: stats.watched,
                wishCount: stats.wish,
                unwatchedCount: stats.unwatched,
                allCount: allMovies.length,
            }, () => {
                this.updateFilteredMovies();
                wx.hideNavigationBarLoading();
            });
        } catch (err) {
            console.error('load annual movies failed:', err);
            this.setData({
                allMovies: [],
                movies: [],
                monthSummaries: [],
                allCount: 0,
                selectedMonthCount: 0
            });
            wx.hideNavigationBarLoading();
            wx.showToast({ title: '加载失败，请重试', icon: 'none' });
        }
    },

    async loadUserMarks() {
        const openid = this.getActiveOpenid();
        if (!openid) return;

        wx.showNavigationBarLoading();
        try {
            const { marks } = await DataLoader.loadMoviesData('annual', openid, false);
            const { markStatusMap, markDateMap, watchedIds, wishIds, stats } = DataLoader.processMarks(marks, this.data.allMovies);

            this.setData({
                markStatusMap,
                markDateMap,
                watchedIds,
                wishIds,
                watchedCount: stats.watched,
                wishCount: stats.wish,
                unwatchedCount: stats.unwatched
            }, () => {
                this.updateFilteredMovies();
                wx.hideNavigationBarLoading();
            });
        } catch (err) {
            console.error('refresh annual marks failed:', err);
            wx.hideNavigationBarLoading();
        }
    },

    updateFilteredMovies() {
        const { allMovies, markStatusMap, selectedMonth, statusFilter } = this.data;
        let movies = allMovies.filter((movie) => movie.releaseMonth === selectedMonth);

        if (statusFilter === 'watched') {
            movies = movies.filter((movie) => markStatusMap[movie._id] === 'watched');
        } else if (statusFilter === 'wish') {
            movies = movies.filter((movie) => markStatusMap[movie._id] === 'wish');
        } else if (statusFilter === 'unwatched') {
            movies = movies.filter((movie) => !markStatusMap[movie._id]);
        }

        movies = movies.map((movie) => ({
            ...movie,
            checked: this.data.selectedMovieIds.includes(String(movie._id))
        }));

        this.setData({ movies });
    },

    onMonthSelect(e) {
        const selectedMonth = e.currentTarget.dataset.month;
        if (!selectedMonth || selectedMonth === this.data.selectedMonth) return;
        const summary = this.data.monthSummaries.find((item) => item.key === selectedMonth);

        this.setData({
            selectedMonth,
            selectedMonthLabel: summary ? summary.label : '',
            selectedMonthCount: summary ? summary.count : 0,
            isBatchEditing: false,
            selectedMovieIds: []
        }, () => {
            this.updateFilteredMovies();
        });
    },

    onStatusFilterChange(e) {
        const statusFilter = e.currentTarget.dataset.filter || 'all';
        if (statusFilter === this.data.statusFilter) return;

        this.setData({
            statusFilter,
            isBatchEditing: false,
            selectedMovieIds: []
        }, () => {
            this.updateFilteredMovies();
        });
    },

    formatMarkDate(dateStr) {
        if (!dateStr) return '';
        try {
            const date = new Date(dateStr);
            if (Number.isNaN(date.getTime())) return '';
            return `${date.getMonth() + 1}/${date.getDate()}`;
        } catch (err) {
            return '';
        }
    },

    recalculateMarkStats(markStatusMap) {
        let watchedCount = 0;
        let wishCount = 0;
        const allCount = this.data.allMovies.length;

        Object.keys(markStatusMap).forEach((movieId) => {
            if (markStatusMap[movieId] === 'watched') watchedCount++;
            if (markStatusMap[movieId] === 'wish') wishCount++;
        });

        return {
            watchedCount,
            wishCount,
            unwatchedCount: Math.max(0, allCount - watchedCount - wishCount),
            watchedIds: Object.keys(markStatusMap).filter((movieId) => markStatusMap[movieId] === 'watched'),
            wishIds: Object.keys(markStatusMap).filter((movieId) => markStatusMap[movieId] === 'wish'),
        };
    },

    applyBatchMarksLocally(movieIds, status) {
        const markStatusMap = { ...this.data.markStatusMap };
        const markDateMap = { ...this.data.markDateMap };
        const now = this.formatMarkDate(new Date().toISOString());

        movieIds.forEach((movieId) => {
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
            isBatchEditing: false,
            selectedMovieIds: []
        }, () => {
            this.updateFilteredMovies();
        });
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
        const movieId = String(e.currentTarget.dataset.movieId || '');
        if (!movieId) return;

        let selectedMovieIds = [...this.data.selectedMovieIds];
        const existingIndex = selectedMovieIds.indexOf(movieId);
        if (existingIndex > -1) {
            selectedMovieIds.splice(existingIndex, 1);
        } else {
            selectedMovieIds.push(movieId);
        }

        const movies = this.data.movies.map((movie) => ({
            ...movie,
            checked: selectedMovieIds.includes(String(movie._id))
        }));

        this.setData({ selectedMovieIds, movies });
    },

    onMovieCardTap(e) {
        if (!this.data.isBatchEditing) return;
        this.onMovieCheck(e);
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
            success: (res) => {
                wx.hideLoading();
                if (res.result && res.result.success) {
                    this.applyBatchMarksLocally(movieIds, status);
                    wx.showToast({
                        title: status === 'unwatched' ? '已批量标记未看' : '批量标记成功',
                        icon: 'success'
                    });
                } else {
                    wx.showToast({ title: '部分标记失败', icon: 'none' });
                }
            },
            fail: (err) => {
                wx.hideLoading();
                console.error('batchUpdateMarks failed:', err);
                wx.showToast({ title: '网络错误，请重试', icon: 'none' });
            }
        });
    },

    onMarkTap(e) {
        const openid = this.getActiveOpenid();
        if (!openid) {
            wx.showModal({
                title: '提示',
                content: '请登录后再进行标记',
                confirmText: '去登录',
                success: (res) => {
                    if (res.confirm) this.onGetUserProfile();
                }
            });
            return;
        }

        const movieId = String(e.currentTarget.dataset.id || '');
        const type = e.currentTarget.dataset.type;
        if (!movieId || !type || !openid) {
            wx.showToast({ title: '数据不完整', icon: 'none' });
            return;
        }

        const db = wx.cloud.database();
        db.collection('Marks').where({ movieId, openid }).get().then((res) => {
            const now = new Date().toISOString();
            if (res.data.length > 0) {
                db.collection('Marks').doc(res.data[0]._id).update({
                    data: { status: type, marked_at: now }
                }).then(() => {
                    const markStatusMap = { ...this.data.markStatusMap, [movieId]: type };
                    const markDateMap = { ...this.data.markDateMap, [movieId]: this.formatMarkDate(now) };
                    const { watchedCount, wishCount, unwatchedCount, watchedIds, wishIds } = this.recalculateMarkStats(markStatusMap);
                    this.setData({
                        markStatusMap,
                        markDateMap,
                        watchedCount,
                        wishCount,
                        unwatchedCount,
                        watchedIds,
                        wishIds
                    }, () => this.updateFilteredMovies());
                    wx.showToast({ title: type === 'watched' ? '已标记已看' : '已标记想看', icon: 'success' });
                });
            } else {
                db.collection('Marks').add({
                    data: { movieId, openid, status: type, marked_at: now }
                }).then(() => {
                    const markStatusMap = { ...this.data.markStatusMap, [movieId]: type };
                    const markDateMap = { ...this.data.markDateMap, [movieId]: this.formatMarkDate(now) };
                    const { watchedCount, wishCount, unwatchedCount, watchedIds, wishIds } = this.recalculateMarkStats(markStatusMap);
                    this.setData({
                        markStatusMap,
                        markDateMap,
                        watchedCount,
                        wishCount,
                        unwatchedCount,
                        watchedIds,
                        wishIds
                    }, () => this.updateFilteredMovies());
                    wx.showToast({ title: type === 'watched' ? '已标记已看' : '已标记想看', icon: 'success' });
                });
            }
        });
    },

    onImageLoad(e) {
        const movieId = String(e.currentTarget.dataset.movieId || '');
        if (!movieId) return;

        this.updateMovieImageStatus(movieId, { imageLoaded: true, imageError: false });
        this.addToImageCache(movieId, e.currentTarget.src);
    },

    onImageError(e) {
        const movieId = String(e.currentTarget.dataset.movieId || '');
        if (!movieId) return;
        this.updateMovieImageStatus(movieId, { imageLoaded: false, imageError: true });
        this.tryFallbackImage(movieId);
    },

    updateMovieImageStatus(movieId, status) {
        const movies = this.data.movies.map((movie) => (
            String(movie._id) === String(movieId) ? { ...movie, ...status } : movie
        ));
        const allMovies = this.data.allMovies.map((movie) => (
            String(movie._id) === String(movieId) ? { ...movie, ...status } : movie
        ));
        this.setData({ movies, allMovies });
    },

    addToImageCache(movieId, imageUrl) {
        const imageCache = { ...this.data.imageCache, [movieId]: imageUrl };
        this.setData({ imageCache });
    },

    tryFallbackImage(movieId) {
        const movie = this.data.allMovies.find((item) => String(item._id) === String(movieId));
        const cloudUrl = movie && (movie.cover || movie.coverUrl);

        if (cloudUrl && cloudUrl.startsWith('cloud://')) {
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
            return;
        }

        this.updateMovieImage(movieId, movie && movie.originalCover ? movie.originalCover : '/images/default-movie.jpg');
    },

    updateMovieImage(movieId, imageUrl) {
        const movies = this.data.movies.map((movie) => (
            String(movie._id) === String(movieId) ? { ...movie, cover: imageUrl } : movie
        ));
        const allMovies = this.data.allMovies.map((movie) => (
            String(movie._id) === String(movieId) ? { ...movie, cover: imageUrl } : movie
        ));
        this.setData({ movies, allMovies });
    },

    initAds() {
        if (this.data.adUnitIds.movielist_infeed) {
            this.setData({ showInfeedAd: true });
        }
    },

    onInfeedAdLoad() {},

    onInfeedAdError() {
        this.setData({ showInfeedAd: false });
    },

    preloadVisibleImages() {
        const visibleMovies = this.data.movies.slice(0, 18);
        visibleMovies.forEach((movie) => {
            if (!movie.imageLoaded && !movie.imageError && !this.data.loadingImages[movie._id]) {
                this.data.loadingImages[movie._id] = true;
                if (String(movie.cover || '').startsWith('cloud://')) {
                    this.updateMovieImageStatus(movie._id, { imageLoaded: true });
                    delete this.data.loadingImages[movie._id];
                    return;
                }
                wx.getImageInfo({
                    src: movie.cover,
                    success: () => {
                        this.updateMovieImageStatus(movie._id, { imageLoaded: true });
                    },
                    fail: () => {
                        this.updateMovieImageStatus(movie._id, { imageError: true });
                        this.tryFallbackImage(movie._id);
                    },
                    complete: () => {
                        delete this.data.loadingImages[movie._id];
                    }
                });
            }
        });
    },

    onShareAppMessage() {
        return {
            title: `${ANNUAL_YEAR} 院线电影`,
            path: '/pages/annual/list/list'
        };
    }
});
