// 豆瓣读书 TOP250 列表页 — 完全镜像 pages/douban/list/list.js
// 差异：theme='douban_books'，BookMarks 集合，'read'/'wish'/'unread' 状态，bookId 字段。

import DataLoader from '../../../utils/dataLoader';
import imageCacheManager from '../../../utils/imageCacheManager';
var adConfig = require('../../../utils/adConfig');
var adManager = require('../../../utils/adManager');

Page({
    data: {
        userInfo: null,
        openid: '',
        pendingOpenid: '',
        allBooks: [],
        books: [],
        markStatusMap: {},
        markDateMap: {},
        markRecordIdMap: {},
        readIds: [],
        wishIds: [],
        readCount: 0,
        wishCount: 0,
        unreadCount: 0,
        allCount: 0,
        readProgressPercent: 0,
        readProgressText: '0%',
        readProgressWidth: '0%',
        activeTab: 0,
        currentFilter: 'all',
        isBatchEditing: false,
        selectedBookIds: [],
        loading: false,
        showAuthModal: false,
        customToast: '',
        customToastVisible: false,
        showSharePicker: false,
        tempAvatar: '',
        tempNickname: '',
        themeClass: '',
        statusBarHeight: 20,
        headerPadTop: 0,
        menuBtnHeight: 32,
        stickyTop: 0,
        // 广告复用电影线 movielist_infeed 槽位
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
        const savedTheme = wx.getStorageSync('appTheme') || getApp().globalData.theme || '';
        this.setData({
            statusBarHeight: 0,
            headerPadTop: 0,
            menuBtnHeight: 0,
            stickyTop: 0,
            themeClass: savedTheme
        });
        this.checkLoginStatus();
        this.loadAllBooks();
        this.initAds();
        this.setNavBarColor(savedTheme);
    },

    async onPullDownRefresh() {
        await this.loadAllBooks(true);
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

    buildReadProgress(readCount = 0, allCount = 0) {
        const safeReadCount = Math.max(0, Number(readCount) || 0);
        const safeAllCount = Math.max(0, Number(allCount) || 0);
        const readProgressPercent = safeAllCount > 0
            ? Math.min(100, Math.round((safeReadCount / safeAllCount) * 100))
            : 0;

        return {
            readProgressPercent,
            readProgressText: `${readProgressPercent}%`,
            readProgressWidth: `${readProgressPercent}%`
        };
    },

    refreshBooksAfterMarkChange() {
        if (this.data.activeTab === 0) return;
        this.updateFilteredBooks();
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
                        url: `/pages/doubanBooks/share/share?type=${type}`,
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
                    wx.showToast({ title: '获取openid失败', icon: 'none' });
                    return;
                }
                wx.hideLoading();
                this.setData({
                    loading: false, pendingOpenid: _openid,
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

    onCancelAuth() { this.setData({ showAuthModal: false, pendingOpenid: '' }); },
    onChooseAvatar(e) { this.setData({ tempAvatar: e.detail.avatarUrl }); },
    onNicknameInput(e) { this.setData({ tempNickname: e.detail.value }); },

    async onConfirmAuth() {
        const { tempAvatar, tempNickname } = this.data;
        const openid = this.data.pendingOpenid || this.data.openid;
        if (!openid) {
            wx.showToast({ title: '请先完成登录', icon: 'none' }); return;
        }
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

    // ─── 核心：加载图书 + 标记 ───
    async loadAllBooks(forceRefresh = false) {
        wx.showNavigationBarLoading();
        try {
            const openid = this.getActiveOpenid() || null;
            const { movies: rawBooks, marks } = await DataLoader.loadMoviesData('douban_books', openid, forceRefresh);

            const allBooks = rawBooks.map(b => ({
                ...b,
                _id: String(b._id),
                thumbCover: imageCacheManager.getThumbnailUrl(b.originalCover || b.coverUrl || b.cover, 'list')
            }));
            this.data.allBooks = allBooks;
            this.data.allCount = allBooks.length;

            const { markStatusMap, markDateMap, markRecordIdMap, readIds, wishIds, stats } = DataLoader.processBookMarks(marks, allBooks);

            this.setData({
                markStatusMap, markDateMap, markRecordIdMap, readIds, wishIds,
                readCount: stats.read, wishCount: stats.wish,
                unreadCount: stats.unread, allCount: allBooks.length,
                ...this.buildReadProgress(stats.read, allBooks.length),
                allBooks, books: allBooks
            }, () => {
                this.updateFilteredBooks();
                wx.hideNavigationBarLoading();
            });
        } catch (err) {
            console.error('加载图书/标记数据失败:', err);
            this.setData({
                allBooks: [],
                books: [],
                markStatusMap: {},
                markDateMap: {},
                markRecordIdMap: {},
                readCount: 0,
                wishCount: 0,
                unreadCount: 0,
                allCount: 0,
                ...this.buildReadProgress(0, 0)
            });
            wx.showToast({ title: '暂无数据或加载失败', icon: 'none' });
            wx.hideNavigationBarLoading();
        }
    },

    // ─── 仅刷新标记（登录后调用） ───
    async loadUserMarks() {
        const openid = this.getActiveOpenid();
        if (!openid) return;
        wx.showNavigationBarLoading();
        try {
            const { marks } = await DataLoader.loadMoviesData('douban_books', openid, false);
            const { markStatusMap, markDateMap, markRecordIdMap, readIds, wishIds, stats } = DataLoader.processBookMarks(marks, this.data.allBooks);
            this.setData({
                markStatusMap, markDateMap, markRecordIdMap, readIds, wishIds,
                readCount: stats.read, wishCount: stats.wish, unreadCount: stats.unread,
                ...this.buildReadProgress(stats.read, this.data.allBooks.length)
            }, () => {
                this.updateFilteredBooks();
                wx.hideNavigationBarLoading();
            });
        } catch (err) {
            console.error('刷新标记失败:', err);
            wx.hideNavigationBarLoading();
        }
    },

    updateFilteredBooks() {
        const { allBooks, markStatusMap, activeTab } = this.data;
        let books = [];
        if (activeTab === 0) books = allBooks;
        else if (activeTab === 1) books = allBooks.filter(b => markStatusMap[b._id] === 'read');
        else if (activeTab === 2) books = allBooks.filter(b => markStatusMap[b._id] === 'wish');
        else if (activeTab === 3) books = allBooks.filter(b => !markStatusMap[b._id]);
        books = books.map(book => ({ ...book, checked: this.data.selectedBookIds.includes(String(book._id)) }));
        this.setData({ books });
    },

    onTabChange(e) {
        const idx = Number(e.currentTarget.dataset.idx);
        this.setData({ activeTab: idx, isBatchEditing: false, selectedBookIds: [] }, this.updateFilteredBooks);
    },

    recalculateMarkStats(markStatusMap) {
        let readCount = 0;
        let wishCount = 0;
        const allCount = this.data.allBooks.length;

        Object.keys(markStatusMap).forEach(bookId => {
            const status = markStatusMap[bookId];
            if (status === 'read') readCount++;
            else if (status === 'wish') wishCount++;
        });

        return {
            readCount,
            wishCount,
            unreadCount: Math.max(0, allCount - readCount - wishCount),
            readIds: Object.keys(markStatusMap).filter(bookId => markStatusMap[bookId] === 'read'),
            wishIds: Object.keys(markStatusMap).filter(bookId => markStatusMap[bookId] === 'wish')
        };
    },

    applyBatchMarksLocally(bookIds, status) {
        const markStatusMap = { ...this.data.markStatusMap };
        const markDateMap = { ...this.data.markDateMap };
        const now = this.formatMarkDate(new Date().toISOString());

        bookIds.forEach(bookId => {
            const normalizedBookId = String(bookId);
            if (status === 'unread') {
                delete markStatusMap[normalizedBookId];
                delete markDateMap[normalizedBookId];
            } else {
                markStatusMap[normalizedBookId] = status;
                markDateMap[normalizedBookId] = now;
            }
        });

        const { readCount, wishCount, unreadCount, readIds, wishIds } = this.recalculateMarkStats(markStatusMap);

        this.setData({
            markStatusMap,
            markDateMap,
            readIds,
            wishIds,
            readCount,
            wishCount,
            unreadCount,
            ...this.buildReadProgress(readCount, this.data.allBooks.length),
            isBatchEditing: false,
            selectedBookIds: []
        }, () => {
            this.updateFilteredBooks();
        });
    },

    applySingleMarkLocally(bookId, status, markedAt, recordId) {
        const markStatusMap = { ...this.data.markStatusMap };
        const markDateMap = { ...this.data.markDateMap };
        const markRecordIdMap = { ...this.data.markRecordIdMap };
        const oldStatus = markStatusMap[bookId];

        markStatusMap[bookId] = status;
        markDateMap[bookId] = this.formatMarkDate(markedAt);
        if (recordId) {
            markRecordIdMap[bookId] = recordId;
        }

        let { readCount, wishCount, unreadCount } = this.data;
        if (oldStatus === 'read') readCount--;
        else if (oldStatus === 'wish') wishCount--;
        else unreadCount--;

        if (status === 'read') readCount++;
        else if (status === 'wish') wishCount++;

        const nextData = {
            markStatusMap,
            markDateMap,
            markRecordIdMap,
            readCount,
            wishCount,
            unreadCount,
            ...this.buildReadProgress(readCount, this.data.allBooks.length)
        };

        if (this.data.activeTab === 0) {
            this.setData(nextData);
            return;
        }

        this.setData(nextData, () => {
            this.refreshBooksAfterMarkChange();
        });
    },

    restoreSingleMarkLocally(bookId, snapshot) {
        const markStatusMap = { ...this.data.markStatusMap };
        const markDateMap = { ...this.data.markDateMap };
        const markRecordIdMap = { ...this.data.markRecordIdMap };

        if (snapshot.status) markStatusMap[bookId] = snapshot.status;
        else delete markStatusMap[bookId];

        if (snapshot.date) markDateMap[bookId] = snapshot.date;
        else delete markDateMap[bookId];

        if (snapshot.recordId) markRecordIdMap[bookId] = snapshot.recordId;
        else delete markRecordIdMap[bookId];

        const { readCount, wishCount, unreadCount } = this.recalculateMarkStats(markStatusMap);
        const nextData = {
            markStatusMap,
            markDateMap,
            markRecordIdMap,
            readCount,
            wishCount,
            unreadCount,
            ...this.buildReadProgress(readCount, this.data.allBooks.length)
        };

        if (this.data.activeTab === 0) {
            this.setData(nextData);
            return;
        }

        this.setData(nextData, () => {
            this.refreshBooksAfterMarkChange();
        });
    },

    onMarkTap(e) {
        const openid = this.getActiveOpenid();
        if (!openid) {
            wx.showModal({
                title: '提示', content: '请登录后再进行标记', confirmText: '去登录',
                success: (res) => { if (res.confirm) this.onGetUserProfile(); }
            });
            return;
        }

        const bookId = String(e.currentTarget.dataset.id);
        const type = e.currentTarget.dataset.type; // 'read' | 'wish'
        const runOptimisticMark = () => {
            if (!this._pendingMarkMap) this._pendingMarkMap = {};
            if (this._pendingMarkMap[bookId]) return;

            const snapshot = {
                status: this.data.markStatusMap[bookId] || '',
                date: this.data.markDateMap[bookId] || '',
                recordId: this.data.markRecordIdMap[bookId] || ''
            };
            const now = new Date().toISOString();
            const db = wx.cloud.database();
            const existingRecordId = this.data.markRecordIdMap[bookId];

            this._pendingMarkMap[bookId] = true;
            this.applySingleMarkLocally(bookId, type, now, existingRecordId);
            this.showCustomToast(type === 'read' ? '✓ 已标记为已读' : '✓ 已标记为想读');

            const persistMark = existingRecordId
                ? db.collection('BookMarks').doc(existingRecordId).update({
                    data: { status: type, marked_at: now }
                })
                : db.collection('BookMarks').add({
                    data: { bookId, openid, status: type, marked_at: now }
                });

            persistMark.then(res => {
                if (!existingRecordId && res && res._id) {
                    const markRecordIdMap = { ...this.data.markRecordIdMap, [bookId]: res._id };
                    this.setData({ markRecordIdMap });
                }
            }).catch(err => {
                console.error('标记失败:', err);
                this.restoreSingleMarkLocally(bookId, snapshot);
                wx.showToast({ title: '标记失败，请重试', icon: 'none' });
            }).finally(() => {
                delete this._pendingMarkMap[bookId];
            });
        };
        if (!bookId || !type || !openid) {
            wx.showToast({ title: '数据不完整', icon: 'none' }); return;
        }
        runOptimisticMark();
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
        } catch (e) { return ''; }
    },

    onStartBatchEdit() {
        if (!this.hasLogin()) { this.onGetUserProfile(); return; }
        this.setData({ isBatchEditing: true, selectedBookIds: [] });
        this.updateFilteredBooks();
    },

    onCancelBatchEdit() {
        this.setData({ isBatchEditing: false, selectedBookIds: [] });
        this.updateFilteredBooks();
    },

    onBookCheck(e) {
        const bookId = e.currentTarget.dataset.bookId;
        if (bookId === undefined || bookId === null) return;

        let selectedBookIds = this.data.selectedBookIds;
        const index = selectedBookIds.indexOf(bookId);
        let checked;
        if (index > -1) {
            selectedBookIds.splice(index, 1);
            checked = false;
        } else {
            selectedBookIds = [...selectedBookIds, bookId];
            checked = true;
        }

        const updatedBooks = this.data.books.map(book => {
            if (String(book._id) === String(bookId)) return { ...book, checked };
            return book;
        });
        this.setData({ selectedBookIds, books: updatedBooks });
    },

    onBatchRead() {
        if (this.data.selectedBookIds.length === 0) {
            wx.showToast({ title: '请选择图书', icon: 'none' }); return;
        }
        this.batchUpdateBookMarks(this.data.selectedBookIds, 'read');
    },

    onBatchWish() {
        if (this.data.selectedBookIds.length === 0) {
            wx.showToast({ title: '请选择图书', icon: 'none' }); return;
        }
        this.batchUpdateBookMarks(this.data.selectedBookIds, 'wish');
    },

    onBatchUnread() {
        if (this.data.selectedBookIds.length === 0) {
            wx.showToast({ title: '请选择图书', icon: 'none' }); return;
        }
        this.batchUpdateBookMarks(this.data.selectedBookIds, 'unread');
    },

    // ─── 批量标记：一次云函数调用 ───
    batchUpdateBookMarks(bookIds, status) {
        const openid = this.getActiveOpenid();
        if (!openid) { wx.showToast({ title: '请先登录', icon: 'none' }); return; }

        wx.showLoading({ title: '批量更新中...' });
        wx.cloud.callFunction({
            name: 'batchUpdateBookMarks',
            data: { bookIds, status, openid },
            success: res => {
                wx.hideLoading();
                if (res.result && res.result.success) {
                    this.applyBatchMarksLocally(bookIds, status);
                    wx.showToast({ title: '批量标记成功', icon: 'success' });
                    setTimeout(() => { this.loadUserMarks(); }, 300);
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
        const bookId = e.currentTarget.dataset.bookId;
        if (bookId) {
            this.tryFallbackImage(bookId);
        }
    },

    tryFallbackImage(bookId) {
        const book = this.data.books.find(b => String(b._id) === String(bookId));
        if (book && book.originalCover && book.cover !== book.originalCover) {
            this.updateBookImage(bookId, book.originalCover);
        } else {
            this.updateBookImage(bookId, 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzAwIiBoZWlnaHQ9IjQ1MCIgdmlld0JveD0iMCAwIDMwMCA0NTAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHdpZHRoPSIzMDAiIGhlaWdodD0iNDUwIiBmaWxsPSIjRjVGNUY1Ii8+CjxwYXRoIGQ9Ik0xNTAgMjAwTDEyMCAyNTBMMTUwIDMwMEwyMDAgMjUwTDE1MCAyMDBaIiBmaWxsPSIjQ0NDQ0NDIi8+Cjx0ZXh0IHg9IjE1MCIgeT0iMzUwIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmaWxsPSIjOTk5OTk5IiBmb250LXNpemU9IjE0Ij7lm77niYfmlrDpl7vnpL7kvJ08L3RleHQ+Cjwvc3ZnPgo=');
        }
    },

    // 只对命中的下标做定点 setData
    updateBookImage(bookId, imageUrl) {
        const targetId = String(bookId);
        const updates = {};
        const bIdx = this.data.books.findIndex(b => String(b._id) === targetId);
        if (bIdx >= 0) {
            updates[`books[${bIdx}].cover`] = imageUrl;
            updates[`books[${bIdx}].thumbCover`] = imageUrl;
        }
        const aIdx = this.data.allBooks.findIndex(b => String(b._id) === targetId);
        if (aIdx >= 0) {
            updates[`allBooks[${aIdx}].cover`] = imageUrl;
            updates[`allBooks[${aIdx}].thumbCover`] = imageUrl;
        }
        if (Object.keys(updates).length) this.setData(updates);
    },

    onShareAppMessage() {
        return {
            title: '豆瓣读书TOP250 - 记录你的阅读旅程',
            path: '/pages/doubanBooks/list/list'
        };
    },

    // ========== 广告 ==========
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
