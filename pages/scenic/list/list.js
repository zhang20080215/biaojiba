// pages/scenic/list/list.js —— 全国5A旅游景区列表页
// 数据走 getScenicSpots（专属集合 scenic_5a），标记复用 Marks（去过=watched、想去=wish）+ batchUpdateMarks，
// 交互骨架借鉴 pages/genericList/list，去掉电影专属（评分/届数/导演），新增省份筛选 + 旅游化文案。
import DataLoader from '../../../utils/dataLoader';
import imageCacheManager from '../../../utils/imageCacheManager';
var adConfig = require('../../../utils/adConfig');
var { trackMark, trackShare } = require('../../../utils/track.js');
var userStore = require('../../../utils/userStore.js');
var scenicShortName = require('../../../utils/scenicShortName.js').scenicShortName;

const THEME = 'scenic5a';
const TOTAL = 359;
const PAGE_SIZE = 24;   // 分批渲染每页条数（首屏只渲染一页，上拉自动追加）
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
        provinceCounts: {},      // 省份 → 该省景区总数，显示在省份栏名字后面
        currentProvince: '',     // '' = 全部省份
        searchKeyword: '',       // 搜索关键词（匹配名称/简称/省市）
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
        dataLoaded: false,       // 首屏数据是否已到位（区分「加载中」与「真的没有」）
        hasMore: false,          // 当前筛选下是否还有未渲染的下一页
        markSheetVisible: false, // 标记纠正弹窗
        markSheetId: '',
        markSheetStatus: '',
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
                // 简称：优先用库里的 shortName 字段（灌库已写入时），否则前端即时提取
                shortName: m.shortName || scenicShortName(m.name),
                thumbCover: imageCacheManager.getThumbnailUrl(m.cover || m.originalCover, 'list')
            }));

            // 汇总数据里出现的省份，按固定顺序
            // 省份 → 条数：显示在左侧省份栏名字后面。刻意取该省的**全部**条数、
            // 不随 activeTab 变化——否则切「去过/想去」时整条省份栏的数字会跟着跳，
            // 而它此时的角色是「这个省一共有多少」，是稳定的目录信息。
            const provinceCounts = {};
            allSpots.forEach(s => {
                if (s.province) provinceCounts[s.province] = (provinceCounts[s.province] || 0) + 1;
            });
            const provinces = PROVINCE_ORDER.filter(p => provinceCounts[p] > 0);

            // allSpots 只用于本地筛选/统计，WXML 从不渲染它 —— 直接挂到 data 上，
            // 不走 setData，省掉一次 359 条的跨线程传输（真正渲染的是分页后的 spots）。
            this.data.allSpots = allSpots;

            const { markStatusMap, markDateMap, markRecordIdMap, stats } = DataLoader.processMarks(marks, allSpots);

            this.setData({
                markStatusMap, markDateMap, markRecordIdMap,
                visitedCount: stats.watched, wishCount: stats.wish, unvisitedCount: stats.unwatched,
                allCount: allSpots.length, provinces, provinceCounts, dataLoaded: true,
                ...this.buildProgress(stats.watched, allSpots.length)
            }, () => {
                this.updateFilteredSpots();
                wx.hideNavigationBarLoading();
            });
        } catch (err) {
            console.error('加载景区数据失败:', err);
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

    // 计算当前筛选后的完整列表（存到 this._filtered，不进 setData），再分页渲染。
    // opts.preserve=true：保持已渲染的条数（标记更新后重算时用，避免列表回弹到首页）。
    updateFilteredSpots(opts) {
        const preserve = opts && opts.preserve;
        const { allSpots, markStatusMap, activeTab, currentProvince, searchKeyword } = this.data;
        let list = allSpots || [];
        const kw = (searchKeyword || '').trim().toLowerCase();
        if (kw) {
            list = list.filter(s => {
                const hay = `${s.name || ''} ${s.shortName || ''} ${s.province || ''} ${s.city || ''} ${s.location || ''}`.toLowerCase();
                return hay.indexOf(kw) >= 0;
            });
        } else if (currentProvince) {
            list = list.filter(s => s.province === currentProvince);
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

    // 从头渲染到第 count 条（整段替换 spots，用于筛选切换/重算）
    renderUpTo(count) {
        const all = this._filtered || [];
        const { selectedIds } = this.data;
        const target = Math.min(count, all.length);
        const slice = all.slice(0, target).map(s => ({ ...s, checked: selectedIds.includes(String(s._id)) }));
        this._renderedCount = target;
        this.setData({ spots: slice, hasMore: target < all.length });
    },

    // 上拉追加下一页：只把新增的一批按下标追加进 spots，不整段重传
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

    // 改成左省份/右列表两栏定高布局后，页面本身不再滚动，onReachBottom 永远不会触发；
    // 分页由右栏 scroll-view 的 bindscrolltolower="loadMoreSpots" 接管。这里保留只为
    // 兼容极端情况下页面仍可滚动的机型，正常路径下它是死代码。
    onReachBottom() {
        this.loadMoreSpots();
    },

    onTabChange(e) {
        const idx = Number(e.currentTarget.dataset.idx);
        this.setData({ activeTab: idx, isBatchEditing: false, selectedIds: [] }, () => this.updateFilteredSpots());
    },

    onProvinceTap(e) {
        const p = e.currentTarget.dataset.province || '';
        if (p === this.data.currentProvince && !this.data.searchKeyword) return;
        // 选省份时清空搜索（两者互斥，避免冲突）
        this.setData({ currentProvince: p, searchKeyword: '', isBatchEditing: false, selectedIds: [] }, () => this.updateFilteredSpots());
    },

    // 搜索：输入即过滤；有关键词时清空省份筛选（搜索跨全部省份）
    onSearchInput(e) {
        const v = e.detail.value || '';
        const patch = { searchKeyword: v, isBatchEditing: false, selectedIds: [] };
        if (v.trim()) patch.currentProvince = '';
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

    // 快捷按钮（未标记时的 想去/去过）→ 直接标记
    onMarkTap(e) {
        const id = String(e.currentTarget.dataset.id);
        const type = e.currentTarget.dataset.type;
        if (!id || !type) { wx.showToast({ title: '数据不完整', icon: 'none' }); return; }
        this.setMark(id, type);
    },

    // 点击已标记的标签 → 打开纠正弹窗（去过/想去/没去过）
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
        const status = e.currentTarget.dataset.status || '';   // 'watched' | 'wish' | '' (没去过)
        const id = this.data.markSheetId;
        this.setData({ markSheetVisible: false });
        if (id) this.setMark(id, status);
    },

    onCloseMarkSheet() {
        this.setData({ markSheetVisible: false });
    },

    // 统一标记入口：targetStatus 为 'watched'|'wish'|''（''=没去过=取消标记）。乐观更新 + 写 Marks
    setMark(id, targetStatus) {
        trackMark('scenic5a', targetStatus || 'unmark', 'single', 1); // 埋点：单标记
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
        if (currentStatus === targetStatus) return;   // 选了当前状态，无变化

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

        // 没去过 → 取消标记
        if (!targetStatus) {
            this.clearSingleMarkLocally(id);
            this.showCustomToast('已取消标记');
            const persist = existingRecordId
                ? db.collection('Marks').doc(existingRecordId).remove()
                : db.collection('Marks').where({ movieId: id, openid }).remove();
            persist.catch(err => {
                console.error('取消标记失败:', err);
                this.restoreSingleMarkLocally(id, snapshot);
                wx.showToast({ title: '取消失败，请重试', icon: 'none' });
            }).finally(() => { delete this._pendingMarkMap[id]; });
            return;
        }

        // 设为 / 切换到 targetStatus
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

    // 本地清除单个标记（取消标记用）
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
        if (this.data.selectedIds.length === 0) { wx.showToast({ title: '请选择景区', icon: 'none' }); return; }
        const ids = this.data.selectedIds;
        const openid = this.getActiveOpenid();
        if (!openid) { wx.showToast({ title: '请先登录', icon: 'none' }); return; }

        trackMark('scenic5a', status, 'batch', ids.length); // 埋点：批量标记
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
        trackShare('scenic5a', 'appmsg', this.route);
        return { title: '全国5A旅游景区 - 打卡你走过的山河', path: '/pages/scenic/list/list' };
    },

    onShareTimeline() {
        trackShare('scenic5a', 'timeline', this.route);
        return { title: '全国5A旅游景区 - 打卡你走过的山河', query: '' };
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
