// pages/province/list/list.js —— 全国旅游省份列表页
// 数据走 getProvinces（专属集合 travel_provinces），标记复用 Marks（去过=watched、想去=wish）
// + batchUpdateMarks，交互骨架借鉴 pages/scenic/list，去掉封面图（纯色文字卡），
// 省份筛选换成「七大地理分区」筛选。
import DataLoader from '../../../utils/dataLoader';
var adConfig = require('../../../utils/adConfig');
var { trackMark, trackShare } = require('../../../utils/track.js');
var userStore = require('../../../utils/userStore.js');

const THEME = 'province';
const PAGE_SIZE = 34;   // 省份总量小，一屏基本可放下
// 七大地理分区固定顺序
const REGION_ORDER = ['华北', '东北', '华东', '华中', '华南', '西南', '西北'];

Page({
    data: {
        userInfo: null,
        openid: '',
        pendingOpenid: '',
        allSpots: [],
        spots: [],
        regions: [],             // 数据里出现过的分区（按 REGION_ORDER 排序）
        currentRegion: '',       // '' = 全部分区
        searchKeyword: '',
        markStatusMap: {},
        markDateMap: {},
        markRecordIdMap: {},
        visitedCount: 0,
        wishCount: 0,
        unvisitedCount: 0,
        allCount: 0,
        visitedProgressText: '0%',
        visitedProgressWidth: '0%',
        activeTab: 0,
        isBatchEditing: false,
        selectedIds: [],
        loading: false,
        dataLoaded: false,
        hasMore: false,
        markSheetVisible: false,
        markSheetId: '',
        markSheetStatus: '',
        showAuthModal: false,
        customToast: '',
        customToastVisible: false,
        tempAvatar: '',
        tempNickname: '',
        // 旅游省份主题配色（靛蓝，与 5A 青绿 / 博物馆金褐区分）
        cfg: {
            title: '全国旅游省份',
            slogan: '点亮你走过的省份，拼出专属中国足迹',
            brandPrimary: '#3A6EA5',
            brandSoft: '#6C97C4',
            shadowRgb: '58, 110, 165'
        },
        infeedSlots: {},
        adUnitIds: {
            movielist_infeed: adConfig.getAdUnitId('movielist_infeed') || '',
        },
    },

    onLoad() {
        if (!wx.cloud) {
            wx.showToast({ title: '请升级基础库', icon: 'none' });
            return;
        }
        wx.setNavigationBarTitle({ title: this.data.cfg.title });
        this.checkLoginStatus();
        this.loadAllSpots(true);
        this.initAds();
        this.setNavBarColor();
    },

    async onPullDownRefresh() {
        await this.loadAllSpots(true);
        wx.stopPullDownRefresh();
    },

    onShow() {
        this.checkLoginStatus();
        this.setNavBarColor();
    },

    setNavBarColor() {
        wx.setNavigationBarColor({ frontColor: '#ffffff', backgroundColor: this.data.cfg.brandPrimary, animation: { duration: 0 } });
    },

    onUnload() {
        if (this._toastTimer) clearTimeout(this._toastTimer);
    },

    getStoredUserInfo() {
        const userInfo = userStore.getUserInfo();
        if (!userInfo) return null;
        const openid = userInfo._openid || userInfo.openid || '';
        return openid ? { ...userInfo, _openid: openid, openid } : userInfo;
    },

    getActiveOpenid() {
        const u = this.data.userInfo || {};
        return u._openid || u.openid || this.data.openid || ((this.getStoredUserInfo() || {})._openid) || '';
    },

    hasLogin() {
        return !!this.getActiveOpenid();
    },

    buildProgress(visited = 0, all = 0) {
        const pct = all > 0 ? Math.min(100, Math.round((visited / all) * 100)) : 0;
        return { visitedProgressText: `${pct}%`, visitedProgressWidth: `${pct}%` };
    },

    checkLoginStatus() {
        const userInfo = this.getStoredUserInfo();
        if (userInfo) {
            this.setData({ userInfo, openid: userInfo._openid || '', pendingOpenid: '' });
        } else {
            this.setData({ userInfo: null, openid: '' });
        }
    },

    // ─── 数据加载 ───
    async loadAllSpots(forceRefresh = false) {
        wx.showNavigationBarLoading();
        try {
            const openid = this.getActiveOpenid() || null;
            const { movies, marks } = await DataLoader.loadMoviesData(THEME, openid, forceRefresh, { orderByField: 'rank', orderDirection: 'asc' });

            const allSpots = movies.map(m => ({
                ...m,
                _id: String(m._id),
                shortName: m.shortName || m.name,
                areaText: m.area ? `${m.area}万km²` : ''
            }));

            const present = new Set(allSpots.map(s => s.region).filter(Boolean));
            const regions = REGION_ORDER.filter(r => present.has(r));

            this.data.allSpots = allSpots;

            const { markStatusMap, markDateMap, markRecordIdMap, stats } = DataLoader.processMarks(marks, allSpots);

            this.setData({
                markStatusMap, markDateMap, markRecordIdMap,
                visitedCount: stats.watched, wishCount: stats.wish, unvisitedCount: stats.unwatched,
                allCount: allSpots.length, regions, dataLoaded: true,
                ...this.buildProgress(stats.watched, allSpots.length)
            }, () => {
                this.updateFilteredSpots();
                wx.hideNavigationBarLoading();
            });
        } catch (err) {
            console.error('加载省份数据失败:', err);
            this.data.allSpots = [];
            this._filtered = [];
            this._renderedCount = 0;
            this.setData({
                spots: [], markStatusMap: {}, markDateMap: {}, markRecordIdMap: {},
                visitedCount: 0, wishCount: 0, unvisitedCount: 0, allCount: 0,
                dataLoaded: true, hasMore: false,
                ...this.buildProgress(0, 0)
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
            const { marks } = await DataLoader.loadMoviesData(THEME, openid, false, { orderByField: 'rank', orderDirection: 'asc' });
            const { markStatusMap, markDateMap, markRecordIdMap, stats } = DataLoader.processMarks(marks, this.data.allSpots);
            this.setData({
                markStatusMap, markDateMap, markRecordIdMap,
                visitedCount: stats.watched, wishCount: stats.wish, unvisitedCount: stats.unwatched,
                ...this.buildProgress(stats.watched, this.data.allSpots.length)
            }, () => {
                this.updateFilteredSpots({ preserve: true });
                wx.hideNavigationBarLoading();
            });
        } catch (err) {
            console.error('刷新标记失败:', err);
            wx.hideNavigationBarLoading();
        }
    },

    updateFilteredSpots(opts) {
        const preserve = opts && opts.preserve;
        const { allSpots, markStatusMap, activeTab, currentRegion, searchKeyword } = this.data;
        let list = allSpots || [];
        const kw = (searchKeyword || '').trim().toLowerCase();
        if (kw) {
            list = list.filter(s => {
                const hay = `${s.name || ''} ${s.shortName || ''} ${s.region || ''} ${s.capital || ''}`.toLowerCase();
                return hay.indexOf(kw) >= 0;
            });
        } else if (currentRegion) {
            list = list.filter(s => s.region === currentRegion);
        }
        if (activeTab === 1) list = list.filter(s => markStatusMap[s._id] === 'watched');
        else if (activeTab === 2) list = list.filter(s => markStatusMap[s._id] === 'wish');
        else if (activeTab === 3) list = list.filter(s => !markStatusMap[s._id]);
        this._filtered = list;

        const target = preserve
            ? Math.min(Math.max(this._renderedCount || PAGE_SIZE, PAGE_SIZE), list.length)
            : PAGE_SIZE;
        this._renderedCount = 0;
        this.renderUpTo(target);
    },

    renderUpTo(count) {
        const all = this._filtered || [];
        const { selectedIds } = this.data;
        const target = Math.min(count, all.length);
        const slice = all.slice(0, target).map(s => ({ ...s, checked: selectedIds.includes(String(s._id)) }));
        this._renderedCount = target;
        this.setData({ spots: slice, hasMore: target < all.length });
    },

    loadMoreSpots() {
        const all = this._filtered || [];
        const start = this._renderedCount || 0;
        if (start >= all.length) return;
        const end = Math.min(all.length, start + PAGE_SIZE);
        const { selectedIds } = this.data;
        const updates = { hasMore: end < all.length };
        for (let i = start; i < end; i++) {
            const s = all[i];
            updates[`spots[${i}]`] = { ...s, checked: selectedIds.includes(String(s._id)) };
        }
        this._renderedCount = end;
        this.setData(updates);
    },

    onReachBottom() {
        this.loadMoreSpots();
    },

    onTabChange(e) {
        const idx = Number(e.currentTarget.dataset.idx);
        this.setData({ activeTab: idx, isBatchEditing: false, selectedIds: [] }, () => this.updateFilteredSpots());
    },

    onRegionTap(e) {
        const r = e.currentTarget.dataset.region || '';
        if (r === this.data.currentRegion && !this.data.searchKeyword) return;
        this.setData({ currentRegion: r, searchKeyword: '', isBatchEditing: false, selectedIds: [] }, () => this.updateFilteredSpots());
    },

    onSearchInput(e) {
        const v = e.detail.value || '';
        const patch = { searchKeyword: v, isBatchEditing: false, selectedIds: [] };
        if (v.trim()) patch.currentRegion = '';
        this.setData(patch, () => this.updateFilteredSpots());
    },

    onSearchClear() {
        this.setData({ searchKeyword: '' }, () => this.updateFilteredSpots());
    },

    recalcStats(markStatusMap) {
        let visited = 0, wish = 0;
        const all = this.data.allSpots.length;
        Object.keys(markStatusMap).forEach(id => {
            if (markStatusMap[id] === 'watched') visited++;
            else if (markStatusMap[id] === 'wish') wish++;
        });
        return { visited, wish, unvisited: Math.max(0, all - visited - wish) };
    },

    applySingleMarkLocally(id, status, markedAt, recordId) {
        const markStatusMap = { ...this.data.markStatusMap };
        const markDateMap = { ...this.data.markDateMap };
        const markRecordIdMap = { ...this.data.markRecordIdMap };
        markStatusMap[id] = status;
        markDateMap[id] = this.formatMarkDate(markedAt);
        if (recordId) markRecordIdMap[id] = recordId;

        const { visited, wish, unvisited } = this.recalcStats(markStatusMap);
        const nextData = {
            markStatusMap, markDateMap, markRecordIdMap,
            visitedCount: visited, wishCount: wish, unvisitedCount: unvisited,
            ...this.buildProgress(visited, this.data.allSpots.length)
        };
        if (this.data.activeTab === 0) this.setData(nextData);
        else this.setData(nextData, () => this.updateFilteredSpots({ preserve: true }));
    },

    restoreSingleMarkLocally(id, snapshot) {
        const markStatusMap = { ...this.data.markStatusMap };
        const markDateMap = { ...this.data.markDateMap };
        const markRecordIdMap = { ...this.data.markRecordIdMap };
        if (snapshot.status) markStatusMap[id] = snapshot.status; else delete markStatusMap[id];
        if (snapshot.date) markDateMap[id] = snapshot.date; else delete markDateMap[id];
        if (snapshot.recordId) markRecordIdMap[id] = snapshot.recordId; else delete markRecordIdMap[id];

        const { visited, wish, unvisited } = this.recalcStats(markStatusMap);
        const nextData = {
            markStatusMap, markDateMap, markRecordIdMap,
            visitedCount: visited, wishCount: wish, unvisitedCount: unvisited,
            ...this.buildProgress(visited, this.data.allSpots.length)
        };
        if (this.data.activeTab === 0) this.setData(nextData);
        else this.setData(nextData, () => this.updateFilteredSpots({ preserve: true }));
    },

    formatMarkDate(dateStr) {
        if (!dateStr) return '';
        try {
            const d = new Date(dateStr);
            if (isNaN(d.getTime())) return '';
            return `${d.getMonth() + 1}/${d.getDate()}`;
        } catch (e) { return ''; }
    },

    onMarkTap(e) {
        const id = String(e.currentTarget.dataset.id);
        const type = e.currentTarget.dataset.type;
        if (!id || !type) { wx.showToast({ title: '数据不完整', icon: 'none' }); return; }
        this.setMark(id, type);
    },

    onOpenMarkSheet(e) {
        if (!this.getActiveOpenid()) {
            wx.showModal({
                title: '提示', content: '请登录后再进行标记', confirmText: '去登录',
                success: (res) => { if (res.confirm) this.onGetUserProfile(); }
            });
            return;
        }
        const id = String(e.currentTarget.dataset.id);
        if (!id) return;
        this.setData({ markSheetVisible: true, markSheetId: id, markSheetStatus: this.data.markStatusMap[id] || '' });
    },

    onMarkSheetPick(e) {
        const status = e.currentTarget.dataset.status || '';
        const id = this.data.markSheetId;
        this.setData({ markSheetVisible: false });
        if (id) this.setMark(id, status);
    },

    onCloseMarkSheet() {
        this.setData({ markSheetVisible: false });
    },

    setMark(id, targetStatus) {
        trackMark('province', targetStatus || 'unmark', 'single', 1);
        const openid = this.getActiveOpenid();
        if (!openid) {
            wx.showModal({
                title: '提示', content: '请登录后再进行标记', confirmText: '去登录',
                success: (res) => { if (res.confirm) this.onGetUserProfile(); }
            });
            return;
        }
        id = String(id);
        if (!id) return;
        const currentStatus = this.data.markStatusMap[id] || '';
        if (currentStatus === targetStatus) return;

        if (!this._pendingMarkMap) this._pendingMarkMap = {};
        if (this._pendingMarkMap[id]) return;

        const snapshot = {
            status: currentStatus,
            date: this.data.markDateMap[id] || '',
            recordId: this.data.markRecordIdMap[id] || ''
        };
        const db = wx.cloud.database();
        const existingRecordId = this.data.markRecordIdMap[id];
        this._pendingMarkMap[id] = true;

        if (!targetStatus) {
            this.clearSingleMarkLocally(id);
            this.showCustomToast('已取消标记');
            // 取消标记一律按 (id, openid) 删**全部**匹配记录，不走 doc(existingRecordId) 只删一条。
            // 历史上 batchUpdateMarks/batchUpdateBookMarks 的 _.in 没分片、被 .get() 默认 100 条上限
            // 静默截断，给批量标过 100+ 条的用户造出过重复记录。只删一条的话旧记录留在库里，下次
            // 加载又被读回来 —— 表现就是「取消不掉、标记复活，状态还可能变回旧的」。删全部顺手把
            // 这些历史重复清干净，且不需要单独跑清理脚本。
            const persist = db.collection('Marks').where({ movieId: id, openid }).remove();
            persist.catch(err => {
                console.error('取消标记失败:', err);
                this.restoreSingleMarkLocally(id, snapshot);
                wx.showToast({ title: '取消失败，请重试', icon: 'none' });
            }).finally(() => { delete this._pendingMarkMap[id]; });
            return;
        }

        const now = new Date().toISOString();
        this.applySingleMarkLocally(id, targetStatus, now, existingRecordId);
        this.showCustomToast(targetStatus === 'watched' ? '✓ 已标记为去过' : '✓ 已标记为想去');

        const persist = existingRecordId
            ? db.collection('Marks').doc(existingRecordId).update({ data: { status: targetStatus, marked_at: now } })
            : db.collection('Marks').add({ data: { movieId: id, openid, status: targetStatus, marked_at: now } });

        persist.then(res => {
            if (!existingRecordId && res && res._id) {
                this.setData({ markRecordIdMap: { ...this.data.markRecordIdMap, [id]: res._id } });
            }
        }).catch(err => {
            console.error('标记失败:', err);
            this.restoreSingleMarkLocally(id, snapshot);
            wx.showToast({ title: '标记失败，请重试', icon: 'none' });
        }).finally(() => {
            delete this._pendingMarkMap[id];
        });
    },

    clearSingleMarkLocally(id) {
        const markStatusMap = { ...this.data.markStatusMap };
        const markDateMap = { ...this.data.markDateMap };
        const markRecordIdMap = { ...this.data.markRecordIdMap };
        delete markStatusMap[id];
        delete markDateMap[id];
        delete markRecordIdMap[id];

        const { visited, wish, unvisited } = this.recalcStats(markStatusMap);
        const nextData = {
            markStatusMap, markDateMap, markRecordIdMap,
            visitedCount: visited, wishCount: wish, unvisitedCount: unvisited,
            ...this.buildProgress(visited, this.data.allSpots.length)
        };
        if (this.data.activeTab === 0) this.setData(nextData);
        else this.setData(nextData, () => this.updateFilteredSpots({ preserve: true }));
    },

    showCustomToast(msg) {
        if (this._toastTimer) clearTimeout(this._toastTimer);
        this.setData({ customToast: msg, customToastVisible: true });
        this._toastTimer = setTimeout(() => { this.setData({ customToastVisible: false }); }, 1500);
    },

    // ─── 批量标记 ───
    onStartBatchEdit() {
        if (!this.hasLogin()) { this.onGetUserProfile(); return; }
        this.setData({ isBatchEditing: true, selectedIds: [] });
        this.updateFilteredSpots({ preserve: true });
    },

    onCancelBatchEdit() {
        this.setData({ isBatchEditing: false, selectedIds: [] });
        this.updateFilteredSpots({ preserve: true });
    },

    onSpotCheck(e) {
        const id = e.currentTarget.dataset.id;
        if (id === undefined || id === null) return;
        let selectedIds = this.data.selectedIds;
        const index = selectedIds.indexOf(id);
        let checked;
        if (index > -1) { selectedIds.splice(index, 1); checked = false; }
        else { selectedIds = [...selectedIds, id]; checked = true; }
        const spots = this.data.spots.map(s => (String(s._id) === String(id) ? { ...s, checked } : s));
        this.setData({ selectedIds, spots });
    },

    onBatchVisited() { this._batch('watched'); },
    onBatchWish() { this._batch('wish'); },
    onBatchUnvisited() { this._batch('unwatched'); },

    _batch(status) {
        if (this.data.selectedIds.length === 0) { wx.showToast({ title: '请选择省份', icon: 'none' }); return; }
        const ids = this.data.selectedIds;
        const openid = this.getActiveOpenid();
        if (!openid) { wx.showToast({ title: '请先登录', icon: 'none' }); return; }

        trackMark('province', status, 'batch', ids.length);
        wx.showLoading({ title: '批量更新中...' });
        wx.cloud.callFunction({
            name: 'batchUpdateMarks',
            data: { movieIds: ids, status, openid },
            success: res => {
                wx.hideLoading();
                if (res.result && res.result.success) {
                    this.applyBatchLocally(ids, status);
                    wx.showToast({ title: '批量标记成功', icon: 'success' });
                    setTimeout(() => { this.loadUserMarks(); }, 300);
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

    applyBatchLocally(ids, status) {
        const markStatusMap = { ...this.data.markStatusMap };
        const markDateMap = { ...this.data.markDateMap };
        const now = this.formatMarkDate(new Date().toISOString());
        ids.forEach(id => {
            const nid = String(id);
            if (status === 'unwatched') { delete markStatusMap[nid]; delete markDateMap[nid]; }
            else { markStatusMap[nid] = status; markDateMap[nid] = now; }
        });
        const { visited, wish, unvisited } = this.recalcStats(markStatusMap);
        this.setData({
            markStatusMap, markDateMap,
            visitedCount: visited, wishCount: wish, unvisitedCount: unvisited,
            ...this.buildProgress(visited, this.data.allSpots.length),
            isBatchEditing: false, selectedIds: []
        }, () => this.updateFilteredSpots({ preserve: true }));
    },

    // ─── 分享 ───
    onShareTap() {
        if (!this.hasLogin()) {
            wx.showToast({ title: '请先完成登录', icon: 'none' });
            this.onGetUserProfile();
            return;
        }
        if (this.data.visitedCount === 0) {
            wx.showToast({ title: '先打卡去过的省份吧', icon: 'none' });
            return;
        }
        wx.navigateTo({ url: '/pages/province/share/share' });
    },

    // ─── 登录 ───
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
                this.setData({ loading: false, pendingOpenid: _openid, showAuthModal: true, tempAvatar: '', tempNickname: '' });
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
        if (!openid) { wx.showToast({ title: '请先完成登录', icon: 'none' }); return; }
        if (!tempAvatar || tempAvatar === '/images/default-avatar.svg') { wx.showToast({ title: '请选择头像', icon: 'none' }); return; }
        if (!tempNickname || !tempNickname.trim()) { wx.showToast({ title: '请输入昵称', icon: 'none' }); return; }

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
                await db.collection('users').add({ data: { openid, nickname: userInfo.nickName, avatarUrl: userInfo.avatarUrl, created_at: new Date(), updated_at: new Date() } });
            } else {
                await db.collection('users').doc(userRes.data[0]._id).update({ data: { nickname: userInfo.nickName, avatarUrl: userInfo.avatarUrl, updated_at: new Date() } });
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

    onShareAppMessage() {
        trackShare('province', 'appmsg', this.route);
        return { title: '全国旅游省份 - 点亮你走过的中国', path: '/pages/province/list/list' };
    },

    onShareTimeline() {
        trackShare('province', 'timeline', this.route);
        return { title: '全国旅游省份 - 点亮你走过的中国', query: '' };
    },

    // ========== 广告 ==========
    initAds() {
        if (!this.data.adUnitIds.movielist_infeed) return;
        var slots = {};
        for (var pos = 8; pos <= 28; pos += 20) { slots[pos] = true; }
        this.setData({ infeedSlots: slots });
    },
    onInfeedAdLoad() {},
    onInfeedAdError(e) {
        var pos = e.currentTarget.dataset.position;
        if (pos !== undefined) this.setData({ ['infeedSlots.' + pos]: false });
    }
});
