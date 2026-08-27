import DataLoader from '../../../utils/dataLoader';
import imageCacheManager from '../../../utils/imageCacheManager';
var adConfig = require('../../../utils/adConfig');
var { trackMark, trackShare } = require('../../../utils/track.js');
var adManager = require('../../../utils/adManager');
var userStore = require('../../../utils/userStore.js');
var markSync = require('../../../utils/markSync.js');

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
        markSheetVisible: false,
        markSheetId: '',
        markSheetStatus: '',
        showSharePicker: false,
        tempAvatar: '',
        tempNickname: '',
        themeClass: '',
        infeedSlots: {},
        adUnitIds: {
            movielist_infeed: adConfig.getAdUnitId('movielist_infeed') || ''
        }
    },

    onLoad() {
        if (!wx.cloud) {
            wx.showToast({ title: '请升级基础库', icon: 'none' });
            return;
        }

        const savedTheme = getApp().globalData.theme || '';

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

    onUnload() {
        if (this._toastTimer) clearTimeout(this._toastTimer);
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
        const userInfo = userStore.getUserInfo();
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
                        url: `/pages/boxoffice/share/share?type=${type}`,
                        complete: () => {
                            this._navigatingToShare = false;
                        }
                    });
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

            userStore.setUserInfo(userInfo);
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

    normalizeText(value, separator = ' / ') {
        if (Array.isArray(value)) {
            return value.filter(Boolean).join(separator);
        }
        if (value === undefined || value === null) return '';
        return String(value).trim();
    },

    formatBoxOffice(value) {
        if (value === undefined || value === null || value === '') return '';
        const amount = Number(value);
        if (Number.isNaN(amount) || amount <= 0) return String(value);

        if (amount >= 100000000) {
            return `$${(amount / 100000000).toFixed(amount >= 1000000000 ? 1 : 2)}亿`;
        }
        if (amount >= 10000) {
            return `$${(amount / 10000).toFixed(amount >= 10000000 ? 0 : 1)}万`;
        }
        return `$${amount}`;
    },

    buildBoxofficeMovieViewModel(movie) {
        const countryText = this.normalizeText(movie.country);

        return {
            ...movie,
            _id: String(movie._id),
            thumbCover: imageCacheManager.getThumbnailUrl(movie.cover || movie.coverUrl || movie.originalCover, 'list'),
            yearText: movie.year ? String(movie.year) : '',
            countryText,
            boxOfficeText: movie.boxOfficeText || this.formatBoxOffice(movie.boxOffice),
            ratingText: movie.rating === 0 || movie.rating ? String(movie.rating) : ''
        };
    },

    async loadAllMovies(forceRefresh = false) {
        wx.showNavigationBarLoading();
        try {
            const openid = this.getActiveOpenid() || null;
            const { movies, marks } = await DataLoader.loadMoviesData('boxoffice', openid, forceRefresh);

            if (!forceRefresh && movies.length > 0 && !movies[0].cover) {
                DataLoader.invalidateMovieCache('boxoffice');
                return this.loadAllMovies(true);
            }

            const allMovies = movies.map(movie => this.buildBoxofficeMovieViewModel(movie));
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
            const { marks } = await DataLoader.loadMoviesData('boxoffice', openid, false);
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

    onCopyTitle(e) {
        const title = e.currentTarget.dataset.title;
        if (!title) return;
        wx.setClipboardData({
            data: title,
            success: () => {
                wx.showToast({ title: '已复制', icon: 'success', duration: 1500 });
            }
        });
    },

    // 未标记时的快捷按钮（想看/已看）
    onMarkTap(e) {
        const movieId = String(e.currentTarget.dataset.id);
        const type = e.currentTarget.dataset.type;
        if (!movieId || !type) { wx.showToast({ title: '数据不完整', icon: 'none' }); return; }
        this.setMark(movieId, type);
    },

    // 点击已标记的标签 → 打开纠正弹窗（已看/想看/没看过）
    onOpenMarkSheet(e) {
        if (!this.getActiveOpenid()) {
            wx.showModal({
                title: '提示', content: '请登录后再进行标记', confirmText: '去登录',
                success: res => { if (res.confirm) this.onGetUserProfile(); }
            });
            return;
        }
        const movieId = String(e.currentTarget.dataset.id);
        if (!movieId) return;
        this.setData({ markSheetVisible: true, markSheetId: movieId, markSheetStatus: this.data.markStatusMap[movieId] || '' });
    },

    onMarkSheetPick(e) {
        const status = e.currentTarget.dataset.status || '';
        const movieId = this.data.markSheetId;
        this.setData({ markSheetVisible: false });
        if (movieId) this.setMark(movieId, status);
    },

    onCloseMarkSheet() { this.setData({ markSheetVisible: false }); },

    // 本地更新单个标记（status='' 表示取消），随后重算筛选
    applyMarkLocally(movieId, status) {
        const markStatusMap = { ...this.data.markStatusMap };
        const markDateMap = { ...this.data.markDateMap };
        const oldStatus = markStatusMap[movieId] || '';
        let { watchedCount, wishCount, unwatchedCount } = this.data;
        if (oldStatus === 'watched') watchedCount--; else if (oldStatus === 'wish') wishCount--; else unwatchedCount--;
        if (status === 'watched') watchedCount++; else if (status === 'wish') wishCount++; else unwatchedCount++;
        if (status) { markStatusMap[movieId] = status; markDateMap[movieId] = this.formatMarkDate(new Date().toISOString()); }
        else { delete markStatusMap[movieId]; delete markDateMap[movieId]; }
        this.setData({
            markStatusMap, markDateMap, watchedCount, wishCount, unwatchedCount,
            ...this.buildWatchedProgress(watchedCount, this.data.allMovies.length)
        }, this.updateFilteredMovies);
    },

    // 统一标记入口：targetStatus 为 'watched'|'wish'|''（''=没看过=取消标记）
    setMark(movieId, targetStatus) {
        const openid = this.getActiveOpenid();
        if (!openid) {
            wx.showModal({
                title: '提示', content: '请登录后再进行标记', confirmText: '去登录',
                success: res => { if (res.confirm) this.onGetUserProfile(); }
            });
            return;
        }
        movieId = String(movieId);
        if (!movieId) return;
        const currentStatus = this.data.markStatusMap[movieId] || '';
        if (currentStatus === targetStatus) return;

        trackMark('boxoffice', targetStatus || 'unmark', 'single', 1); // 埋点：单标记
        const db = wx.cloud.database();
        const now = new Date().toISOString();
        const finalize = () => {
            this.applyMarkLocally(movieId, targetStatus);
            // 跨榜单同步（详见 utils/markSync.js）：一处覆盖增/改/删三个分支
            markSync.sync(movieId, targetStatus);
            this.showCustomToast(!targetStatus ? '已取消标记' : (targetStatus === 'watched' ? '✓ 已标记为已看' : '✓ 已标记为想看'));
        };
        db.collection('Marks').where({ movieId, openid }).get().then(res => {
            if (!targetStatus) {
                if (!res.data.length) { finalize(); return; }
                return Promise.all(res.data.map(r => db.collection('Marks').doc(r._id).remove())).then(finalize);
            }
            if (res.data.length > 0) {
                return db.collection('Marks').doc(res.data[0]._id).update({ data: { status: targetStatus, marked_at: now } }).then(finalize);
            }
            return db.collection('Marks').add({ data: { movieId, openid, status: targetStatus, marked_at: now } }).then(finalize);
        }).catch(err => {
            console.error('标记失败:', err);
            wx.showToast({ title: '操作失败，请重试', icon: 'none' });
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
            if (Number.isNaN(d.getTime())) return '';
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
        // 批量取消会经 movie_alias 扩散到其他榜单里的同一部影片——误点一次的代价从「毁掉当前榜单」
        // 变成「毁掉全部榜单」，而且没有撤销。批量标记是加法不用拦，取消必须二次确认。
        const ids = this.data.selectedMovieIds;
        wx.showModal({
            title: '确认取消标记',
            content: '将取消 ' + ids.length + ' 部影片的标记，其他榜单中的同一部影片也会一并取消，且无法撤销。',
            confirmText: '确认取消',
            confirmColor: '#E64340',
            success: (res) => { if (res.confirm) this.batchUpdateMarks(ids, 'unwatched'); }
        });
    },

    batchUpdateMarks(movieIds, status) {
        const openid = this.getActiveOpenid();
        if (!openid) {
            wx.showToast({ title: '请先登录', icon: 'none' });
            return;
        }
        trackMark('boxoffice', status, 'batch', movieIds.length); // 埋点：批量标记

        wx.showLoading({ title: '批量更新中...' });
        wx.cloud.callFunction({
            name: 'batchUpdateMarks',
            data: { movieIds, status, openid },
            success: res => {
                wx.hideLoading();
                if (res.result && res.result.success) {
                    this.applyBatchMarksLocally(movieIds, status);
                    this.showCustomToast(status === 'unwatched' ? '已批量标记为未看' : '批量标记成功');
                } else {
                    wx.showToast({ title: '部分标记失败，正在刷新', icon: 'none' });
                    // 云函数已把「写成功条数」如实报回来，这里不能只弹个提示就完事：本地状态没跟着改，
                    // 用户看到的仍是旧的。重新拉一次标记，让显示收敛到云端真实状态。
                    setTimeout(() => { this.loadUserMarks(); }, 300);
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
        const movie = this.data.allMovies.find(item => String(item._id) === String(movieId));
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
                success: res => {
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

    // 只对命中的下标做定点 setData，避免把整张电影数组回传给视图层
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
        trackShare('boxoffice', 'appmsg', this.route);
        return {
            title: '全球电影票房榜 - 见证影史商业传奇',
            path: '/pages/boxoffice/list/list'
        };
    },

    onShareTimeline() {
        trackShare('boxoffice', 'timeline', this.route);
        return { title: '全球电影票房榜 - 见证影史商业传奇', query: '' };
    },

    initAds() {
        if (!this.data.adUnitIds.movielist_infeed) return;
        var slots = {};
        for (var pos = 5; pos <= 25; pos += 20) {
            slots[pos] = true;
        }
        this.setData({ infeedSlots: slots });
    },

    onInfeedAdLoad() {},

    onInfeedAdError(e) {
        var pos = e.currentTarget.dataset.position;
        if (pos !== undefined) this.setData({ ['infeedSlots.' + pos]: false });
    }
});
