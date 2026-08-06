// pages/scenic/share/share.js —— 全国5A旅游景区「旅行足迹」分享海报
// 「瓦片格子地图」：31 个省按地理区位紧凑连续镶嵌（贴合无间距），每格用点阵展示该省全部
// 5A 景区，去过点亮绿点、未去灰点，格头标「去过/总数」。头部为打卡进度英雄数字，页脚署名。
// 纯 canvas 线条填充，零网络图片依赖（规避 iOS webp 白图 + 加载慢）。
// canvas 直接当预览图显示（backing 1242×1660 + CSS 缩放），导出临时文件供保存到相册；
// 保存走 rewardedSaveGate。署名无二维码/外链（合规）。
const CanvasHelper = require('../../../utils/canvasHelper.js');
const DataLoader = require('../../../utils/dataLoader.js');
const rewardedSaveGate = require('../../../utils/rewardedSaveGate.js');
const userStore = require('../../../utils/userStore.js');

const THEME = 'scenic5a';
const CANVAS_W = 1242;
const CANVAS_H = 1660;
const BRAND = '#2E8B72';
const BRAND_SOFT = '#5FB89C';
const DOT_VISITED = BRAND;
const DOT_UNVISITED = '#CBD9D3';

// 省份瓦片布局 [col,row]，6×6 紧凑连续镶嵌（贴合无间距、无内部空洞），按地理区位
// （西→东、北→南，不严格面积）。含港澳台（无 5A，格内显示「暂无 5A」）；两角留空。
const COLS = 6, ROWS = 6;
const TILE_LAYOUT = {
    '新疆': [0, 0], '内蒙古': [1, 0], '北京': [2, 0], '辽宁': [3, 0], '吉林': [4, 0], '黑龙江': [5, 0],
    '青海': [0, 1], '甘肃': [1, 1], '宁夏': [2, 1], '山西': [3, 1], '河北': [4, 1], '天津': [5, 1],
    '西藏': [0, 2], '四川': [1, 2], '陕西': [2, 2], '河南': [3, 2], '山东': [4, 2], '江苏': [5, 2],
    '云南': [0, 3], '贵州': [1, 3], '重庆': [2, 3], '湖北': [3, 3], '安徽': [4, 3], '上海': [5, 3],
    '广西': [0, 4], '湖南': [1, 4], '江西': [2, 4], '浙江': [3, 4], '福建': [4, 4], '台湾': [5, 4],
    '海南': [1, 5], '广东': [2, 5], '香港': [3, 5], '澳门': [4, 5]
};

Page({
    data: {
        statusBarHeight: 20,
        navBarHeight: 48,
        navOffset: 68,
        previewW: 300,
        previewH: 400,
        loading: true,
        ready: false,
        isGenerating: false,
        needRewardedAd: false
    },

    posterData: null,
    _ready: false,
    _rendered: false,
    _destroyed: false,

    safeSetData(obj) {
        if (this._destroyed) return;
        this.setData(obj);
    },

    onUnload() { this._destroyed = true; },

    onLoad() {
        const win = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
        const menu = wx.getMenuButtonBoundingClientRect();
        const statusBarHeight = win.statusBarHeight || 20;
        const navBarHeight = (menu.top - statusBarHeight) * 2 + menu.height;
        const navOffset = statusBarHeight + navBarHeight;
        const screenW = win.windowWidth || 375;
        const previewW = Math.min(Math.round(screenW * 0.84), 340);
        const previewH = Math.round(previewW * CANVAS_H / CANVAS_W);
        this.setData({ statusBarHeight, navBarHeight, navOffset, previewW, previewH });
        wx.setNavigationBarColor({ frontColor: '#ffffff', backgroundColor: BRAND });
        wx.setNavigationBarTitle({ title: '旅行足迹' });
        rewardedSaveGate.refreshHint(this);
        this.fetchData();
    },

    onReady() {
        this._ready = true;
        this.maybeGenerate();
    },

    onBack() {
        if (getCurrentPages().length > 1) wx.navigateBack();
        else wx.redirectTo({ url: '/pages/scenic/list/list' });
    },

    onShareAppMessage() {
        return { title: '我的5A旅游景区打卡足迹', path: '/pages/scenic/list/list' };
    },

    getOpenid() {
        const app = getApp();
        if (app && app.globalData && app.globalData.openid) return app.globalData.openid;
        const u = userStore.getUserInfo() || {};
        return u._openid || u.openid || '';
    },

    async fetchData() {
        try {
            const openid = this.getOpenid() || null;
            const { movies, marks } = await DataLoader.loadMoviesData(THEME, openid, false, { orderByField: 'rank', orderDirection: 'asc' });
            if (this._destroyed) return;

            const allSpots = movies.map(m => ({ ...m, _id: String(m._id) }));
            const { markStatusMap } = DataLoader.processMarks(marks, allSpots);

            // 按省份统计「该省全部 5A 数」与「去过数」；只统计有瓦片布局的省份
            const provStats = {};
            let visitedTotal = 0;
            allSpots.forEach(s => {
                const p = (s.province || '').trim();
                const watched = markStatusMap[s._id] === 'watched';
                if (watched) visitedTotal++;
                if (!TILE_LAYOUT[p]) return;
                if (!provStats[p]) provStats[p] = { total: 0, visited: 0 };
                provStats[p].total++;
                if (watched) provStats[p].visited++;
            });

            if (!visitedTotal) {
                wx.showModal({
                    title: '还没有足迹',
                    content: '先去打卡去过的5A景区吧',
                    showCancel: false,
                    success: () => this.onBack()
                });
                return;
            }

            const litProvinces = Object.keys(provStats).filter(k => provStats[k].visited > 0).length;
            const userInfo = userStore.getUserInfo() || {};
            this.posterData = {
                nickname: userInfo.nickName || '旅行者',
                avatar: userInfo.avatarUrl || '',
                visitedCount: visitedTotal,
                totalCount: allSpots.length,
                provinceCount: litProvinces,
                provStats
            };
            this.safeSetData({ loading: false });
            this.maybeGenerate();
        } catch (err) {
            if (this._destroyed) return;
            console.error('scenic share fetch fail', err);
            wx.showToast({ title: '加载失败', icon: 'none' });
        }
    },

    maybeGenerate() {
        if (this._rendered || this._destroyed) return;
        if (!this._ready || !this.posterData) return;
        this._rendered = true;
        this.generatePoster();
    },

    async generatePoster() {
        try {
            const canvas = await new Promise((resolve, reject) => {
                wx.createSelectorQuery().in(this).select('#scenicCard').fields({ node: true, size: true }).exec(res => {
                    if (!res || !res[0] || !res[0].node) reject(new Error('Canvas 节点获取失败'));
                    else resolve(res[0].node);
                });
            });
            if (this._destroyed) return;
            canvas.width = CANVAS_W;
            canvas.height = CANVAS_H;
            const ctx = canvas.getContext('2d');
            const helper = new CanvasHelper(canvas, ctx, { width: CANVAS_W, height: CANVAS_H });

            await this.drawPoster(canvas, ctx, helper, this.posterData);
            if (this._destroyed) return;

            await new Promise(resolve => {
                canvas.requestAnimationFrame(() => canvas.requestAnimationFrame(resolve));
            });
            if (this._destroyed) return;
            const res = await wx.canvasToTempFilePath({ canvas, fileType: 'png', quality: 1 });
            if (this._destroyed) return;
            this._previewTemp = res.tempFilePath;
            this.safeSetData({ ready: true });
        } catch (err) {
            console.error('scenic share render fail', err);
            this._rendered = false;
            if (!this._destroyed) wx.showToast({ title: '生成失败', icon: 'none' });
        }
    },

    async drawPoster(canvas, ctx, helper, data) {
        const W = CANVAS_W, H = CANVAS_H;

        // ── 背景 ──
        const bg = ctx.createLinearGradient(0, 0, 0, H);
        bg.addColorStop(0, '#E7F5EF');
        bg.addColorStop(0.4, '#F3FAF7');
        bg.addColorStop(1, '#FFFFFF');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = 'rgba(95, 184, 156, 0.14)';
        ctx.beginPath(); ctx.arc(W - 30, 60, 180, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(46, 139, 114, 0.08)';
        ctx.beginPath(); ctx.arc(50, H - 70, 140, 0, Math.PI * 2); ctx.fill();

        // ── 标题 ──
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = BRAND;
        ctx.font = 'bold 68px sans-serif';
        ctx.fillText('我的5A旅行足迹', W / 2, 134);

        // ── 英雄数字：打卡 N / 359 个 5A 景区 ──
        const spots = data.visitedCount;
        const totalSpots = data.totalCount || 0;
        const litProv = data.provinceCount;
        ctx.fillStyle = BRAND;
        ctx.font = 'bold 88px sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(String(spots), W / 2 - 10, 228);
        ctx.textAlign = 'left';
        ctx.fillStyle = '#9AA9A3';
        ctx.font = '40px sans-serif';
        ctx.fillText(`/ ${totalSpots} 个 5A 景区`, W / 2 + 10, 228);
        ctx.textAlign = 'center';
        ctx.fillStyle = '#5A6B64';
        ctx.font = '34px sans-serif';
        const cover = totalSpots ? Math.round(spots / totalSpots * 100) : 0;
        ctx.fillText(`已点亮 ${litProv} 个省份 · 覆盖 ${cover}%`, W / 2, 284);

        // ── 瓦片格子地图 ──
        this.drawTiles(ctx, helper, data.provStats);

        // ── 图例（居中一行：● 去过   ● 未去）──
        ctx.textBaseline = 'alphabetic';
        ctx.font = '28px sans-serif';
        const ly = 1560;
        const legItems = [[DOT_VISITED, '去过'], [DOT_UNVISITED, '未去']];
        let legW = 0;
        legItems.forEach(it => { legW += 22 + 10 + ctx.measureText(it[1]).width + 40; });
        let lgx = (W - legW) / 2;
        legItems.forEach(it => {
            ctx.fillStyle = it[0]; ctx.beginPath(); ctx.arc(lgx + 11, ly - 9, 11, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#6A7B74'; ctx.textAlign = 'left'; ctx.fillText(it[1], lgx + 11 + 22, ly);
            lgx += 22 + 10 + ctx.measureText(it[1]).width + 40;
        });

        // ── 页脚署名（无二维码/外链）──
        ctx.textAlign = 'center';
        ctx.fillStyle = BRAND;
        ctx.font = 'bold 32px sans-serif';
        ctx.fillText('标记吧 · 全国5A旅游景区', W / 2, 1624);
    },

    // 瓦片格子地图：每省一格（按 TILE_LAYOUT 区位），贴合无间距、白色细缝分隔；
    // 格内点阵=该省全部 5A，前 vis 个点亮绿点、其余灰点；港澳台无 5A 显示「暂无 5A」
    drawTiles(ctx, helper, provStats) {
        const marginX = 28, gy0 = 324, gridW = CANVAS_W - marginX * 2, gridH = 1176;
        const cw = gridW / COLS, ch = gridH / ROWS;
        const gx0 = marginX;

        Object.keys(TILE_LAYOUT).forEach(prov => {
            const pos = TILE_LAYOUT[prov];
            const st = provStats[prov] || { total: 0, visited: 0 };
            const total = st.total, vis = Math.min(st.visited, total);
            const has5A = total > 0;
            const cx = gx0 + pos[0] * cw, cy = gy0 + pos[1] * ch;

            // 底色（贴合，无内边距）+ 白色细缝分隔
            ctx.fillStyle = vis > 0 ? 'rgba(46,139,114,.09)' : (has5A ? 'rgba(125,140,133,.07)' : 'rgba(125,140,133,.04)');
            ctx.fillRect(cx, cy, cw, ch);
            ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 2;
            ctx.strokeRect(cx + 1, cy + 1, cw - 2, ch - 2);

            // 省名
            ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
            ctx.fillStyle = has5A ? '#37473F' : '#9DAAA4'; ctx.font = 'bold 27px sans-serif';
            ctx.fillText(prov, cx + 16, cy + 40);

            // 港澳台等无 5A 的：居中「暂无 5A」，不画点阵
            if (!has5A) {
                ctx.textAlign = 'center'; ctx.fillStyle = '#B4C0BB'; ctx.font = '24px sans-serif';
                ctx.fillText('暂无 5A', cx + cw / 2, cy + ch / 2 + 16);
                return;
            }

            // 计数
            ctx.textAlign = 'right';
            ctx.fillStyle = vis > 0 ? BRAND : '#9DAAA4'; ctx.font = '22px sans-serif';
            ctx.fillText(vis + '/' + total, cx + cw - 14, cy + 39);

            // 点阵：该省全部 5A（前 vis 个点亮）
            const n = total;
            const areaX = cx + 16, areaY = cy + 56;
            const areaW = cw - 32, areaH = ch - 70;
            const dcols = Math.max(1, Math.ceil(Math.sqrt(n * areaW / areaH)));
            const drows = Math.ceil(n / dcols);
            const pitchX = areaW / dcols, pitchY = areaH / drows;
            const rad = Math.max(3.5, Math.min(pitchX, pitchY) / 2 * 0.6);
            for (let i = 0; i < n; i++) {
                const r = Math.floor(i / dcols), c = i % dcols;
                const px = areaX + pitchX * (c + 0.5), py = areaY + pitchY * (r + 0.5);
                ctx.beginPath(); ctx.arc(px, py, rad, 0, Math.PI * 2);
                ctx.fillStyle = i < vis ? DOT_VISITED : DOT_UNVISITED;
                ctx.fill();
            }
        });
    },

    async saveImage() {
        if (this.data.isGenerating) return;
        if (!this._previewTemp) { wx.showToast({ title: '图片还没生成好', icon: 'none' }); return; }
        const hasGrant = await rewardedSaveGate.ensureGrant(this);
        if (!hasGrant) return;
        try {
            this.setData({ isGenerating: true });
            await wx.saveImageToPhotosAlbum({ filePath: this._previewTemp });
            wx.showToast({ title: '已保存到相册', icon: 'success' });
        } catch (err) {
            console.error('scenic share save fail', err);
            if (err.errMsg && err.errMsg.includes('auth deny')) {
                wx.showModal({
                    title: '权限提示', content: '需要授权保存图片到相册', confirmText: '去设置',
                    success: r => { if (r.confirm) wx.openSetting(); }
                });
            } else {
                wx.showToast({ title: '保存失败', icon: 'none' });
            }
        } finally {
            this.safeSetData({ isGenerating: false });
        }
    }
});
