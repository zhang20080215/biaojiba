// pages/scenic/list/list.js —— 全国5A旅游景区列表页
// 数据走 getScenicSpots（专属集合 scenic_5a），标记复用 Marks（去过=watched、想去=wish）+ batchUpdateMarks，
// 交互骨架借鉴 pages/genericList/list，去掉电影专属（评分/届数/导演），新增省份筛选 + 旅游化文案。
import DataLoader from '../../../utils/dataLoader';
import imageCacheManager from '../../../utils/imageCacheManager';
var adConfig = require('../../../utils/adConfig');
var userStore = require('../../../utils/userStore.js');

const THEME = 'scenic5a';
const TOTAL = 359;
// 省份筛选固定顺序（与数据源 desc 省份短名一致）
const PROVINCE_ORDER = ['北京', '天津', '河北', '山西', '内蒙古', '辽宁', '吉林', '黑龙江', '上海', '江苏', '浙江', '安徽', '福建', '江西', '山东', '河南', '湖北', '湖南', '广东', '广西', '海南', '重庆', '四川', '贵州', '云南', '西藏', '陕西', '甘肃', '青海', '宁夏', '新疆'];

Page({
    data: {
        userInfo: null,
        openid: '',
        pendingOpenid: '',
        allSpots: [],
        spots: [],
        provinces: [],           // 数据里出现过的省份（按 PROVINCE_ORDER 排序）
        currentProvince: '',     // '' = 全部省份
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
        showAuthModal: false,
        customToast: '',
        customToastVisible: false,
        tempAvatar: '',
        tempNickname: '',
        // 旅游主题配色（山水青绿）
        cfg: {
            title: '全国5A旅游景区',
            slogan: '打卡你走过的山河，攒成专属旅行足迹',
            brandPrimary: '#2E8B72',
            brandSoft: '#5FB89C',
            shadowRgb: '46, 139, 114'
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
                thumbCover: imageCacheManager.getThumbnailUrl(m.cover || m.originalCover, 'list')
            }));

            // 汇总数据里出现的省份，按固定顺序
            const present = new Set(allSpots.map(s => s.province).filter(Boolean));
            const provinces = PROVINCE_ORDER.filter(p => present.has(p));

            this.data.allSpots = allSpots;

            const { markStatusMap, markDateMap, markRecordIdMap, stats } = DataLoader.processMarks(marks, allSpots);

            this.setData({
                markStatusMap, markDateMap, markRecordIdMap,
                visitedCount: stats.watched, wishCount: stats.wish, unvisitedCount: stats.unwatched,
                allCount: allSpots.length, provinces,
                ...this.buildProgress(stats.watched, allSpots.length),
                allSpots
            }, () => {
                this.updateFilteredSpots();
                wx.hideNavigationBarLoading();
            });
        } catch (err) {
            console.error('加载景区数据失败:', err);
            this.setData({
                allSpots: [], spots: [], markStatusMap: {}, markDateMap: {}, markRecordIdMap: {},
                visitedCount: 0, wishCount: 0, unvisitedCount: 0, allCount: 0,
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
                this.updateFilteredSpots();
                wx.hideNavigationBarLoading();
            });
        } catch (err) {
            console.error('刷新标记失败:', err);
            wx.hideNavigationBarLoading();
        }
    },

    updateFilteredSpots() {
        const { allSpots, markStatusMap, activeTab, currentProvince, selectedIds } = this.data;
        let list = allSpots;
        if (currentProvince) list = list.filter(s => s.province === currentProvince);
        if (activeTab === 1) list = list.filter(s => markStatusMap[s._id] === 'watched');
        else if (activeTab === 2) list = list.filter(s => markStatusMap[s._id] === 'wish');
        else if (activeTab === 3) list = list.filter(s => !markStatusMap[s._id]);
        list = list.map(s => ({ ...s, checked: selectedIds.includes(String(s._id)) }));
        this.setData({ spots: list });
    },

    onTabChange(e) {
        const idx = Number(e.currentTarget.dataset.idx);
        this.setData({ activeTab: idx, isBatchEditing: false, selectedIds: [] }, this.updateFilteredSpots);
    },

    onProvinceTap(e) {
        const p = e.currentTarget.dataset.province || '';
        if (p === this.data.currentProvince) return;
        this.setData({ currentProvince: p, isBatchEditing: false, selectedIds: [] }, this.updateFilteredSpots);
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
        else this.setData(nextData, () => this.updateFilteredSpots());
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
        else this.setData(nextData, () => this.updateFilteredSpots());
    },

    formatMarkDate(dateStr) {
        if (!dateStr) return '';
        try {
            const d = new Date(dateStr);
            if (isNaN(d.getTime())) return '';
            return `${d.getMonth() + 1}/${d.getDate()}`;
        } catch (e) { return ''; }
    },

    // 单点标记（去过=watched / 想去=wish），乐观更新 + 写 Marks
    onMarkTap(e) {
        const openid = this.getActiveOpenid();
        if (!openid) {
            wx.showModal({
                title: '提示', content: '请登录后再进行标记', confirmText: '去登录',
                success: (res) => { if (res.confirm) this.onGetUserProfile(); }
            });
            return;
        }
        const id = String(e.currentTarget.dataset.id);
        const type = e.currentTarget.dataset.type;
        if (!id || !type) { wx.showToast({ title: '数据不完整', icon: 'none' }); return; }

        if (!this._pendingMarkMap) this._pendingMarkMap = {};
        if (this._pendingMarkMap[id]) return;

        const snapshot = {
            status: this.data.markStatusMap[id] || '',
            date: this.data.markDateMap[id] || '',
            recordId: this.data.markRecordIdMap[id] || ''
        };
        const now = new Date().toISOString();
        const db = wx.cloud.database();
        const existingRecordId = this.data.markRecordIdMap[id];

        this._pendingMarkMap[id] = true;
        this.applySingleMarkLocally(id, type, now, existingRecordId);
        this.showCustomToast(type === 'watched' ? '✓ 已标记为去过' : '✓ 已标记为想去');

        const persist = existingRecordId
            ? db.collection('Marks').doc(existingRecordId).update({ data: { status: type, marked_at: now } })
            : db.collection('Marks').add({ data: { movieId: id, openid, status: type, marked_at: now } });

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

    showCustomToast(msg) {
        if (this._toastTimer) clearTimeout(this._toastTimer);
        this.setData({ customToast: msg, customToastVisible: true });
        this._toastTimer = setTimeout(() => { this.setData({ customToastVisible: false }); }, 1500);
    },

    // ─── 批量标记 ───
    onStartBatchEdit() {
        if (!this.hasLogin()) { this.onGetUserProfile(); return; }
        this.setData({ isBatchEditing: true, selectedIds: [] });
        this.updateFilteredSpots();
    },

    onCancelBatchEdit() {
        this.setData({ isBatchEditing: false, selectedIds: [] });
        this.updateFilteredSpots();
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
        if (this.data.selectedIds.length === 0) { wx.showToast({ title: '请选择景区', icon: 'none' }); return; }
        const ids = this.data.selectedIds;
        const openid = this.getActiveOpenid();
        if (!openid) { wx.showToast({ title: '请先登录', icon: 'none' }); return; }

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
        }, () => this.updateFilteredSpots());
    },

    // ─── 分享 ───
    onShareTap() {
        if (!this.hasLogin()) {
            wx.showToast({ title: '请先完成登录', icon: 'none' });
            this.onGetUserProfile();
            return;
        }
        if (this.data.visitedCount === 0) {
            wx.showToast({ title: '先打卡去过的景区吧', icon: 'none' });
            return;
        }
        wx.navigateTo({ url: '/pages/scenic/share/share' });
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

    onImageError(e) {
        const id = e.currentTarget.dataset.id;
        if (!id) return;
        const spot = this.data.spots.find(s => String(s._id) === String(id));
        if (spot && spot.originalCover && spot.cover !== spot.originalCover) {
            this.updateSpotImage(id, spot.originalCover);
        }
    },

    updateSpotImage(id, url) {
        const targetId = String(id);
        const updates = {};
        const sIdx = this.data.spots.findIndex(s => String(s._id) === targetId);
        if (sIdx >= 0) { updates[`spots[${sIdx}].cover`] = url; updates[`spots[${sIdx}].thumbCover`] = url; }
        const aIdx = this.data.allSpots.findIndex(s => String(s._id) === targetId);
        if (aIdx >= 0) { updates[`allSpots[${aIdx}].cover`] = url; updates[`allSpots[${aIdx}].thumbCover`] = url; }
        if (Object.keys(updates).length) this.setData(updates);
    },

    onShareAppMessage() {
        return { title: '全国5A旅游景区 - 打卡你走过的山河', path: '/pages/scenic/list/list' };
    },

    // ========== 广告 ==========
    initAds() {
        if (!this.data.adUnitIds.movielist_infeed) return;
        var slots = {};
        for (var pos = 5; pos <= 25; pos += 20) { slots[pos] = true; }
        this.setData({ infeedSlots: slots });
    },
    onInfeedAdLoad() {},
    onInfeedAdError(e) {
        var pos = e.currentTarget.dataset.position;
        if (pos !== undefined) this.setData({ ['infeedSlots.' + pos]: false });
    }
});
