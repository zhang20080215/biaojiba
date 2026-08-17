// pages/province/share/share.js —— 全国旅游省份「拼图地图」海报预览页
// 框架/配色对齐 5A 景区海报页（顶部返回 + 版式切换 + 配色选择 + 底部保存），预览用 canvas 当图
// （backing 1242×1660 + CSS 缩放），纯 canvas 线条/文字绘制、零网络图片。保存走 rewardedSaveGate；
// 署名无二维码/外链（合规）。
//
// 两种版式：
//   map  「拼图地图」—— 34 省像素网格拼图（utils/chinaProvinceGrid.js）：每省一块正交单元，
//        去过点亮、想去柔色、未去浅色；相邻异省之间描横/竖发丝缝，省名简称标在质心。
//   list 「省份清单」—— 按七大分区列出全部省份（简称），去过高亮加粗、未去灰显。
const CanvasHelper = require('../../../utils/canvasHelper.js');
const DataLoader = require('../../../utils/dataLoader.js');
const rewardedSaveGate = require('../../../utils/rewardedSaveGate.js');
const userStore = require('../../../utils/userStore.js');
const G = require('../../../utils/chinaProvinceGrid.js');

const THEME = 'province';
const CANVAS_W = 1242;
const CANVAS_H = 1660;

// 配色主题：沿用电影 TOP250 海报的 3 套背景渐变（粉蓝/暖金/青雾）。只切背景；元素色固定 PALETTE。
const BG_THEMES = [
    { key: 'pinkBlue', name: '粉蓝', start: '#FDECEC', end: '#D2F1FE' },
    { key: 'goldSand', name: '暖金', start: '#FEEFBF', end: '#F8F3E7' },
    { key: 'greenMist', name: '青雾', start: '#E1E6D1', end: '#EAF0F9' }
];
const PALETTE = {
    title: '#2D2D2B',
    pillBg: 'rgba(255,255,255,0.55)',
    pillBorder: 'rgba(255,255,255,0.72)',
    // 拼图地图三态填充（柔和配色）
    visitedFill: '#7FA3C9',      // 去过：柔和靛蓝
    visitedText: '#FFFFFF',
    wishFill: '#EEC98A',         // 想去：柔和暖杏
    wishText: '#7A5A22',
    noneFill: '#ECE6DB',         // 未去：暖米浅色
    noneText: '#9C968A',
    seam: 'rgba(84,78,68,0.14)', // 省界横竖缝（柔和发丝）
    outer: 'rgba(84,78,68,0.30)',
    // 清单版式
    listVisited: '#2F63A0',
    listUnvisited: '#A7A498',
    provPillText: '#4A4A46',
    hairline: 'rgba(45,45,43,0.20)',
    legendText: '#6F6F68',
    sig: 'rgba(45,45,43,0.70)'
};
const THEME_STORAGE_KEY = 'provinceShareTheme';

function getTheme(key) {
    return BG_THEMES.find(t => t.key === key) || BG_THEMES[0];
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
        shareType: 'map',           // 'map' | 'list'
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
        else wx.redirectTo({ url: '/pages/province/list/list' });
    },

    onShareAppMessage() {
        return { title: '我的中国省份旅行足迹', path: '/pages/province/list/list' };
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

            // 省简称 → 状态（'watched' | 'wish' | ''）
            const statusByShort = {};
            let visited = 0, wish = 0;
            allSpots.forEach(s => {
                const st = markStatusMap[s._id] || '';
                statusByShort[s.shortName] = st;
                if (st === 'watched') visited++;
                else if (st === 'wish') wish++;
            });

            if (!visited) {
                wx.showModal({ title: '还没有足迹', content: '先去打卡去过的省份吧', showCancel: false, success: () => this.onBack() });
                return;
            }

            // 清单版式：按分区分组，组内去过排最前
            const byRegion = {};
            allSpots.forEach(s => {
                const r = s.region || '其他';
                if (!byRegion[r]) byRegion[r] = [];
                byRegion[r].push({ name: s.shortName, visited: markStatusMap[s._id] === 'watched' });
            });
            const groups = [];
            G.REGION_ORDER.forEach(r => {
                const arr = byRegion[r];
                if (!arr || !arr.length) return;
                arr.sort((a, b) => (b.visited - a.visited));
                groups.push({ prov: r, total: arr.length, visited: arr.filter(x => x.visited).length, spots: arr });
            });

            const userInfo = userStore.getUserInfo() || {};
            this.posterData = {
                nickname: userInfo.nickName || '旅行者',
                visitedCount: visited,
                wishCount: wish,
                totalCount: allSpots.length,
                statusByShort,
                groups
            };
            this.safeSetData({ loading: false });
            this.maybeGenerate();
        } catch (err) {
            if (this._destroyed) return;
            console.error('province share fetch fail', err);
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
                wx.createSelectorQuery().in(this).select('#provinceCard').fields({ node: true, size: true }).exec(res => {
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
                this.drawGrid(ctx, this.posterData.statusByShort);
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
            console.error('province share render fail', err);
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
        ctx.fillText('中国省份旅行打卡', W / 2, 106);

        const total = data.totalCount || 0;
        const cover = total ? Math.round(data.visitedCount / total * 100) : 0;
        const labels = [`去过 ${data.visitedCount}/${total}`, `想去 ${data.wishCount}`, `点亮 ${cover}%`];
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

        const y = 1636, dotR = 10, dotGap = 12, itemGap = 26;
        const legFont = '28px sans-serif';
        const sig = '搜索标记吧小程序 · 制作同款图';
        const sigFont = '600 28px sans-serif';
        const sepText = '   ·   ';
        ctx.textBaseline = 'middle';
        ctx.font = legFont;
        const wsep = ctx.measureText(sepText).width;
        ctx.font = sigFont;
        const wsig = ctx.measureText(sig).width;
        // 三态图例
        const legs = [[PALETTE.visitedFill, '去过'], [PALETTE.wishFill, '想去'], [PALETTE.noneFill, '未去']];
        ctx.font = legFont;
        let legW = 0;
        legs.forEach(l => { legW += dotR * 2 + dotGap + ctx.measureText(l[1]).width + itemGap; });
        const totalW = legW + wsep + wsig;
        let x = (W - totalW) / 2;
        legs.forEach(l => {
            ctx.fillStyle = l[0]; ctx.beginPath(); ctx.arc(x + dotR, y, dotR, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = 'rgba(45,45,43,0.18)'; ctx.lineWidth = 1; ctx.stroke();
            ctx.fillStyle = PALETTE.legendText; ctx.font = legFont; ctx.textAlign = 'left';
            ctx.fillText(l[1], x + dotR * 2 + dotGap, y);
            x += dotR * 2 + dotGap + ctx.measureText(l[1]).width + itemGap;
        });
        ctx.fillStyle = PALETTE.legendText; ctx.font = legFont; ctx.textAlign = 'left'; ctx.fillText(sepText, x, y); x += wsep;
        ctx.fillStyle = PALETTE.sig; ctx.font = sigFont; ctx.textAlign = 'left'; ctx.fillText(sig, x, y);
        ctx.textBaseline = 'alphabetic';
    },

    // ── 版式一：像素网格拼图地图 ──
    // 不强求方格：横向近满宽（小边距）、纵向填满头尾之间，单元可为矩形。
    drawGrid(ctx, statusByShort) {
        const COLS = G.COLS, ROWS = G.ROWS;
        const bandTop = 224, bandBot = 1544, marginX = 28;
        const cellW = Math.floor((CANVAS_W - marginX * 2) / COLS);
        const cellH = Math.floor((bandBot - bandTop) / ROWS);
        const gridW = cellW * COLS, gridH = cellH * ROWS;
        const gx0 = Math.round((CANVAS_W - gridW) / 2);
        const gy0 = Math.round(bandTop + ((bandBot - bandTop) - gridH) / 2);

        const fillFor = st => st === 'watched' ? PALETTE.visitedFill : (st === 'wish' ? PALETTE.wishFill : PALETTE.noneFill);

        // 1) 填充每格
        G.forEachCell((c, r, short) => {
            const st = statusByShort[short] || '';
            ctx.fillStyle = fillFor(st);
            ctx.fillRect(gx0 + c * cellW, gy0 + r * cellH, cellW, cellH);
        });

        // 2) 省界横竖缝：相邻异省之间描线
        ctx.strokeStyle = PALETTE.seam; ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
                const cur = G.GRID[r][c];
                const x = gx0 + c * cellW, y = gy0 + r * cellH;
                if (c + 1 < COLS && G.GRID[r][c + 1] !== cur) { ctx.moveTo(x + cellW, y); ctx.lineTo(x + cellW, y + cellH); }
                if (r + 1 < ROWS && G.GRID[r + 1][c] !== cur) { ctx.moveTo(x, y + cellH); ctx.lineTo(x + cellW, y + cellH); }
            }
        }
        ctx.stroke();

        // 3) 外框
        ctx.strokeStyle = PALETTE.outer; ctx.lineWidth = 2.5;
        ctx.strokeRect(gx0 + 1, gy0 + 1, gridW - 2, gridH - 2);

        // 4) 省名简称：每省质心处一枚标签，字号按省块 bbox 自适应
        const geom = G.geometry();
        Object.keys(geom).forEach(code => {
            const o = geom[code];
            const short = o.short;
            const st = statusByShort[short] || '';
            let minC = 99, maxC = -1, minR = 99, maxR = -1;
            o.cells.forEach(cl => { minC = Math.min(minC, cl[0]); maxC = Math.max(maxC, cl[0]); minR = Math.min(minR, cl[1]); maxR = Math.max(maxR, cl[1]); });
            const bw = (maxC - minC + 1) * cellW, bh = (maxR - minR + 1) * cellH;
            const cx = gx0 + (o.labelCell[0] + 0.5) * cellW;
            const cy = gy0 + (o.labelCell[1] + 0.5) * cellH;
            let fs = Math.min(cellH * 0.5, cellW * 0.5, bh * 0.44);
            const maxByW = (bw * 0.84) / Math.max(2, short.length);
            fs = Math.max(15, Math.min(fs, maxByW));
            ctx.font = `bold ${Math.round(fs)}px sans-serif`;
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillStyle = st === 'watched' ? PALETTE.visitedText : (st === 'wish' ? PALETTE.wishText : PALETTE.noneText);
            ctx.fillText(short, cx, cy);
        });
        ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    },

    // ── 版式二：省份清单（按分区分组）──
    drawListPoster(ctx, helper, data, theme) {
        const groups = data.groups || [];
        const BODY_TOP = 240, BODY_BOT = 1540, MARGIN = 60, COLGAP = 50;
        const COLW = (CANVAS_W - MARGIN * 2 - COLGAP) / 2;
        const colLeft = i => MARGIN + i * (COLW + COLGAP);

        const attempt = (fs, doDraw) => {
            const lh = Math.round(fs * 1.5);
            const secGap = Math.round(fs * 0.8);
            const space = Math.round(fs * 0.6);
            const pillPadX = Math.round(fs * 0.55);
            const pillH = Math.round(fs * 1.6);
            const nameFont = fs + 'px sans-serif';
            const nameFontB = 'bold ' + fs + 'px sans-serif';
            const pillFont = 'bold ' + Math.round(fs * 0.96) + 'px sans-serif';
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

        const SIZES = [40, 36, 32, 28, 24];
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
            console.error('province share save fail', err);
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
