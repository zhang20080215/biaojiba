// pages/city/share/share.js —— 全国旅游城市「城市热力图」海报预览页
// 框架/配色对齐 5A 景区海报页；预览用 canvas 当图（1242×1660 + CSS 缩放），纯 canvas 绘制、
// 零网络图片。保存走 rewardedSaveGate；署名无二维码/外链（合规）。
//
// 两种版式：
//   map  「城市热力图」—— 复用省份像素网格（utils/chinaProvinceGrid.js），每省块按
//        「该省去过城市数 / 该省优秀旅游城市总数」上色深浅（choropleth 热力），标省名 + 去过/总。
//   list 「城市清单」—— 按省份列出全部优秀旅游城市（简称），去过高亮加粗、未去灰显。
const CanvasHelper = require('../../../utils/canvasHelper.js');
const DataLoader = require('../../../utils/dataLoader.js');
const rewardedSaveGate = require('../../../utils/rewardedSaveGate.js');
const userStore = require('../../../utils/userStore.js');
const G = require('../../../utils/chinaProvinceGrid.js');
const GEO = require('../../../utils/chinaGeo.js');

const THEME = 'city';
const CANVAS_W = 1242;
const CANVAS_H = 1660;

const BG_THEMES = [
    { key: 'pinkBlue', name: '粉蓝', start: '#FDECEC', end: '#D2F1FE' },
    { key: 'goldSand', name: '暖金', start: '#FEEFBF', end: '#F8F3E7' },
    { key: 'greenMist', name: '青雾', start: '#E1E6D1', end: '#EAF0F9' }
];
const PALETTE = {
    title: '#2D2D2B',
    pillBg: 'rgba(255,255,255,0.55)',
    pillBorder: 'rgba(255,255,255,0.72)',
    // 真实地理地图：陆地浅底 + 海岸描边；城市一城一点，去过点亮=暖橙、未去=浅灰
    land: 'rgba(255,255,255,0.58)',
    coast: 'rgba(45,45,43,0.40)',
    dotLit: '#C9743A',
    dotDim: '#CFC6BA',
    labelDark: '#4A3B2C',
    labelHalo: 'rgba(255,255,255,0.9)',
    // 清单
    listVisited: '#B25E20',
    listUnvisited: '#A7A498',
    provPillText: '#4A4A46',
    hairline: 'rgba(45,45,43,0.20)',
    legendText: '#6F6F68',
    sig: 'rgba(45,45,43,0.70)'
};
const THEME_STORAGE_KEY = 'cityShareTheme';

function getTheme(key) {
    return BG_THEMES.find(t => t.key === key) || BG_THEMES[0];
}

function lerpColor(a, b, t) {
    const r = Math.round(a[0] + (b[0] - a[0]) * t);
    const g = Math.round(a[1] + (b[1] - a[1]) * t);
    const bl = Math.round(a[2] + (b[2] - a[2]) * t);
    return `rgb(${r},${g},${bl})`;
}

Page({
    data: {
        statusBarHeight: 20,
        navBarHeight: 44,
        previewW: 300,
        previewH: 400,
        loading: true,
        ready: false,
        isGenerating: false,
        needRewardedAd: false,
        shareType: 'map',
        activeThemeKey: 'pinkBlue',
        theme: BG_THEMES[0],
        themeChips: BG_THEMES
    },

    posterData: null,
    _ready: false,
    _destroyed: false,
    _previewTemp: null,
    _rendering: false,

    safeSetData(obj) { if (!this._destroyed) this.setData(obj); },
    onUnload() { this._destroyed = true; },

    onLoad() {
        const win = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
        const menu = wx.getMenuButtonBoundingClientRect();
        const statusBarHeight = win.statusBarHeight || 20;
        const navBarHeight = (menu.top - statusBarHeight) * 2 + menu.height;
        const screenW = win.windowWidth || 375;
        const previewW = Math.round(screenW * (1 - 48 / 750));
        const previewH = Math.round(previewW * CANVAS_H / CANVAS_W);

        let themeKey = 'pinkBlue';
        try { themeKey = wx.getStorageSync(THEME_STORAGE_KEY) || 'pinkBlue'; } catch (e) {}
        const theme = getTheme(themeKey);

        this.setData({ statusBarHeight, navBarHeight, previewW, previewH, activeThemeKey: theme.key, theme });
        wx.setNavigationBarTitle({ title: '海报预览' });
        rewardedSaveGate.refreshHint(this);
        this.fetchData();
    },

    onReady() { this._ready = true; this.maybeGenerate(); },

    onBack() {
        if (getCurrentPages().length > 1) wx.navigateBack();
        else wx.redirectTo({ url: '/pages/city/list/list' });
    },

    onShareAppMessage() {
        return { title: '我的中国旅游城市打卡足迹', path: '/pages/city/list/list' };
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

            // 按省聚合：total / visited
            const byProv = {};      // { short: {total, visited, cities:[{name,visited}]} }
            let visited = 0, wish = 0;
            allSpots.forEach(s => {
                const p = s.province || '其他';
                if (!byProv[p]) byProv[p] = { total: 0, visited: 0, cities: [] };
                const isV = markStatusMap[s._id] === 'watched';
                byProv[p].total++;
                if (isV) byProv[p].visited++;
                byProv[p].cities.push({ name: s.shortName || s.name, visited: isV });
                if (isV) visited++;
                else if (markStatusMap[s._id] === 'wish') wish++;
            });

            if (!visited) {
                wx.showModal({ title: '还没有足迹', content: '先去打卡去过的城市吧', showCancel: false, success: () => this.onBack() });
                return;
            }

            // 点亮省份数（去过城市 >=1）
            let litProvinces = 0;
            Object.keys(byProv).forEach(p => { if (byProv[p].visited > 0) litProvinces++; });

            // 清单版式：按省份顺序分组，组内去过排最前
            const PROV_ORDER = G.PROVINCES.map(x => x.short);
            const groups = [];
            PROV_ORDER.forEach(p => {
                const g = byProv[p];
                if (!g || !g.total) return;
                const arr = g.cities.slice().sort((a, b) => (b.visited - a.visited));
                groups.push({ prov: p, total: g.total, visited: g.visited, spots: arr });
            });

            const userInfo = userStore.getUserInfo() || {};
            this.posterData = {
                nickname: userInfo.nickName || '旅行者',
                visitedCount: visited,
                wishCount: wish,
                totalCount: allSpots.length,
                provinceCount: litProvinces,
                byProv,
                groups
            };
            this.safeSetData({ loading: false });
            this.maybeGenerate();
        } catch (err) {
            if (this._destroyed) return;
            console.error('city share fetch fail', err);
            wx.showToast({ title: '加载失败', icon: 'none' });
        }
    },

    onTypeTap(e) {
        const type = e.currentTarget.dataset.type;
        if (type === this.data.shareType) return;
        this.setData({ shareType: type, ready: false }, () => this.regenerate());
    },

    onThemeTap(e) {
        const key = e.currentTarget.dataset.key;
        if (key === this.data.activeThemeKey) return;
        const theme = getTheme(key);
        try { wx.setStorageSync(THEME_STORAGE_KEY, key); } catch (err) {}
        this.setData({ activeThemeKey: key, theme, ready: false }, () => this.regenerate());
    },

    maybeGenerate() {
        if (this._destroyed) return;
        if (!this._ready || !this.posterData) return;
        this.generatePoster();
    },

    regenerate() {
        if (this._destroyed || !this._ready || !this.posterData) return;
        this.generatePoster();
    },

    async generatePoster() {
        if (this._rendering) { this._pendingRender = true; return; }
        this._rendering = true;
        try {
            const canvas = await new Promise((resolve, reject) => {
                wx.createSelectorQuery().in(this).select('#cityCard').fields({ node: true, size: true }).exec(res => {
                    if (!res || !res[0] || !res[0].node) reject(new Error('Canvas 节点获取失败'));
                    else resolve(res[0].node);
                });
            });
            if (this._destroyed) return;
            canvas.width = CANVAS_W;
            canvas.height = CANVAS_H;
            const ctx = canvas.getContext('2d');
            const helper = new CanvasHelper(canvas, ctx, { width: CANVAS_W, height: CANVAS_H });

            const theme = this.data.theme;
            this.drawBackground(ctx, theme);
            this.drawHeader(ctx, helper, this.posterData, theme);
            if (this.data.shareType === 'list') {
                this.drawListPoster(ctx, helper, this.posterData, theme);
            } else {
                this.drawCities(ctx, this.posterData.byProv);
            }
            this.drawFooter(ctx, theme);
            if (this._destroyed) return;

            await new Promise(resolve => { canvas.requestAnimationFrame(() => canvas.requestAnimationFrame(resolve)); });
            if (this._destroyed) return;
            const res = await wx.canvasToTempFilePath({ canvas, fileType: 'png', quality: 1 });
            if (this._destroyed) return;
            this._previewTemp = res.tempFilePath;
            this.safeSetData({ ready: true });
        } catch (err) {
            console.error('city share render fail', err);
            if (!this._destroyed) wx.showToast({ title: '生成失败', icon: 'none' });
        } finally {
            this._rendering = false;
            if (this._pendingRender && !this._destroyed) { this._pendingRender = false; this.generatePoster(); }
        }
    },

    drawBackground(ctx, theme) {
        const bg = ctx.createLinearGradient(0, 0, CANVAS_W, CANVAS_H);
        bg.addColorStop(0, theme.start);
        bg.addColorStop(1, theme.end);
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    },

    drawHeader(ctx, helper, data, theme) {
        const W = CANVAS_W;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = PALETTE.title;
        ctx.font = 'bold 60px sans-serif';
        ctx.fillText('中国旅游城市打卡', W / 2, 106);

        const total = data.totalCount || 0;
        const cover = total ? Math.round(data.visitedCount / total * 100) : 0;
        const labels = [`去过 ${data.visitedCount}/${total}`, `点亮 ${data.provinceCount} 省`, `覆盖 ${cover}%`];
        const fontPx = 34, pillH = 62, padX = 30, gap = 20, radius = 31;
        ctx.font = `600 ${fontPx}px sans-serif`;
        const widths = labels.map(t => ctx.measureText(t).width + padX * 2);
        const totalW = widths.reduce((a, b) => a + b, 0) + gap * 2;
        let px = (W - totalW) / 2;
        const py = 150;
        labels.forEach((t, i) => {
            const w = widths[i];
            helper.drawRoundRectPath(px, py, w, pillH, radius);
            ctx.fillStyle = PALETTE.pillBg; ctx.fill();
            ctx.lineWidth = 2; ctx.strokeStyle = PALETTE.pillBorder; ctx.stroke();
            ctx.fillStyle = PALETTE.title; ctx.font = `600 ${fontPx}px sans-serif`;
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(t, px + w / 2, py + pillH / 2 + 1);
            px += w + gap;
        });
        ctx.textBaseline = 'alphabetic';
    },

    drawFooter(ctx, theme) {
        const W = CANVAS_W;
        const hy = 1588, inset = 210;
        const hg = ctx.createLinearGradient(inset, 0, W - inset, 0);
        hg.addColorStop(0, 'rgba(0,0,0,0)');
        hg.addColorStop(0.5, PALETTE.hairline);
        hg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.strokeStyle = hg; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(inset, hy); ctx.lineTo(W - inset, hy); ctx.stroke();

        // 图例：颜色越深去过越多 + 署名
        const y = 1636, dotR = 10, dotGap = 12, itemGap = 26;
        const sig = '搜索标记吧小程序 · 制作同款图';
        const sigFont = '600 28px sans-serif';
        const legFont = '28px sans-serif';
        const sepText = '   ·   ';
        ctx.textBaseline = 'middle';
        const legs = [[PALETTE.dotLit, '去过'], [PALETTE.dotDim, '未去']];
        ctx.font = legFont;
        let legW = 0;
        legs.forEach(l => { legW += dotR * 2 + dotGap + ctx.measureText(l[1]).width + itemGap; });
        const wsep = ctx.measureText(sepText).width;
        ctx.font = sigFont;
        const wsig = ctx.measureText(sig).width;
        const totalW = legW + wsep + wsig;
        let x = (W - totalW) / 2;
        legs.forEach(l => {
            ctx.fillStyle = l[0]; ctx.beginPath(); ctx.arc(x + dotR, y, dotR, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = PALETTE.legendText; ctx.font = legFont; ctx.textAlign = 'left';
            ctx.fillText(l[1], x + dotR * 2 + dotGap, y);
            x += dotR * 2 + dotGap + ctx.measureText(l[1]).width + itemGap;
        });
        ctx.fillStyle = PALETTE.legendText; ctx.font = legFont; ctx.textAlign = 'left'; ctx.fillText(sepText, x, y); x += wsep;
        ctx.fillStyle = PALETTE.sig; ctx.font = sigFont; ctx.fillText(sig, x, y);
        ctx.textBaseline = 'alphabetic';
    },

    // ── 版式一：真实地理地图（中国轮廓 + 城市按经纬度打点，去过点亮）──
    drawCities(ctx, byProv) {
        const bandTop = 212, bandBot = 1548;
        const rect = { x: 14, y: bandTop, w: CANVAS_W - 28, h: bandBot - bandTop };
        const project = GEO.makeProjector(rect);

        // 1) 陆地填充 + 海岸描边（大陆/海南/台湾/香港各一环）
        ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        GEO.BOUNDARY.forEach(ring => {
            ctx.beginPath();
            for (let i = 0; i < ring.length; i++) {
                const pt = project(ring[i][0], ring[i][1]);
                if (i === 0) ctx.moveTo(pt[0], pt[1]); else ctx.lineTo(pt[0], pt[1]);
            }
            ctx.closePath();
            ctx.fillStyle = PALETTE.land; ctx.fill();
            ctx.strokeStyle = PALETTE.coast; ctx.lineWidth = 2; ctx.stroke();
        });

        // 2) 城市点：先收集，未去（灰）先画、去过（橙+白边）后画置顶
        const dim = [], lit = [];
        Object.keys(byProv).forEach(prov => {
            const g = byProv[prov];
            if (!g || !g.cities) return;
            g.cities.forEach(c => {
                const co = GEO.CITY_COORDS[c.name];
                if (!co) return;
                const p = project(co[0], co[1]);
                (c.visited ? lit : dim).push(p);
            });
        });
        const rDim = 4.5, rLit = 6.5;
        ctx.fillStyle = PALETTE.dotDim;
        dim.forEach(p => { ctx.beginPath(); ctx.arc(p[0], p[1], rDim, 0, Math.PI * 2); ctx.fill(); });
        lit.forEach(p => {
            ctx.beginPath(); ctx.arc(p[0], p[1], rLit, 0, Math.PI * 2);
            ctx.fillStyle = PALETTE.dotLit; ctx.fill();
            ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,0.92)'; ctx.stroke();
        });
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    },

    // ── 版式二：城市清单（按省分组）──
    drawListPoster(ctx, helper, data, theme) {
        const groups = data.groups || [];
        const BODY_TOP = 236, BODY_BOT = 1544, MARGIN = 44, COLGAP = 40;
        const COLW = (CANVAS_W - MARGIN * 2 - COLGAP) / 2;
        const colLeft = i => MARGIN + i * (COLW + COLGAP);

        const attempt = (fs, doDraw) => {
            const lh = Math.round(fs * 1.42);
            const secGap = Math.round(fs * 0.7);
            const space = Math.round(fs * 0.46);
            const pillPadX = Math.round(fs * 0.5);
            const pillH = Math.round(fs * 1.5);
            const nameFont = fs + 'px sans-serif';
            const nameFontB = 'bold ' + fs + 'px sans-serif';
            const pillFont = 'bold ' + Math.round(fs * 0.94) + 'px sans-serif';
            const half = Math.round(lh / 2);

            let col = 0, x = colLeft(0), y = BODY_TOP + half, atColTop = true;
            const nextColIfNeeded = () => {
                if (y + half > BODY_BOT) {
                    col++; if (col > 1) return false;
                    x = colLeft(col); y = BODY_TOP + half; atColTop = true;
                }
                return true;
            };

            for (let gi = 0; gi < groups.length; gi++) {
                const g = groups[gi];
                if (!atColTop) { y += lh + secGap; x = colLeft(col); }
                if (!nextColIfNeeded()) return false;

                ctx.font = pillFont;
                const label = g.prov + ' ' + g.visited + '/' + g.total;
                const pillW = ctx.measureText(label).width + pillPadX * 2;
                if (doDraw) {
                    helper.drawRoundRectPath(x, y - pillH / 2, pillW, pillH, Math.round(pillH / 2));
                    ctx.fillStyle = PALETTE.pillBg; ctx.fill();
                    ctx.lineWidth = 2; ctx.strokeStyle = PALETTE.pillBorder; ctx.stroke();
                    ctx.fillStyle = PALETTE.provPillText; ctx.font = pillFont;
                    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
                    ctx.fillText(label, x + pillPadX, y + 1);
                }
                x += pillW + space * 1.4;
                atColTop = false;

                for (let si = 0; si < g.spots.length; si++) {
                    const sp = g.spots[si];
                    const f = sp.visited ? nameFontB : nameFont;
                    ctx.font = f;
                    const w = ctx.measureText(sp.name).width;
                    if (x + w > colLeft(col) + COLW) {
                        y += lh; x = colLeft(col);
                        if (!nextColIfNeeded()) return false;
                    }
                    if (doDraw) {
                        ctx.font = f;
                        ctx.fillStyle = sp.visited ? PALETTE.listVisited : PALETTE.listUnvisited;
                        ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
                        ctx.fillText(sp.name, x, y);
                    }
                    x += w + space;
                    atColTop = false;
                }
            }
            return true;
        };

        const SIZES = [26, 24, 22, 20, 18, 16];
        let chosen = SIZES[SIZES.length - 1];
        for (let i = 0; i < SIZES.length; i++) {
            if (attempt(SIZES[i], false)) { chosen = SIZES[i]; break; }
        }
        attempt(chosen, true);
        ctx.textBaseline = 'alphabetic';
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
            console.error('city share save fail', err);
            if (err.errMsg && err.errMsg.includes('auth deny')) {
                wx.showModal({ title: '权限提示', content: '需要授权保存图片到相册', confirmText: '去设置', success: r => { if (r.confirm) wx.openSetting(); } });
            } else {
                wx.showToast({ title: '保存失败', icon: 'none' });
            }
        } finally {
            this.safeSetData({ isGenerating: false });
        }
    }
});
