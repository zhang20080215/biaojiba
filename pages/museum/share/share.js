// pages/museum/share/share.js —— 中国国家一级博物馆「参观足迹」海报预览页
// 框架参考电影海报预览页（顶部返回+版式切换+配色选择+底部保存），预览用 canvas 当图（backing
// 1242×1660 + CSS 缩放），导出临时文件供保存到相册；纯 canvas 线条/文字绘制，零网络图片依赖
// （规避 iOS webp 白图 + 加载慢）。保存走 rewardedSaveGate；署名无二维码/外链（合规）。
//
// 两种版式：
//   map  「足迹地图」—— 31 省瓦片格子地图，点阵展示各省一级博物馆、参观过点亮。
//   list 「博物馆清单」—— 按省份列出全部一级博物馆（简称），参观过高亮、未去灰显。
// 多套配色：BG_THEMES（粉蓝/暖金/青雾），切换即重绘，本地记住上次选择。
const CanvasHelper = require('../../../utils/canvasHelper.js');
const DataLoader = require('../../../utils/dataLoader.js');
const rewardedSaveGate = require('../../../utils/rewardedSaveGate.js');
const userStore = require('../../../utils/userStore.js');
const museumShortName = require('../../../utils/museumShortName.js').museumShortName;

const THEME = 'museum';
const CANVAS_W = 1242;
const CANVAS_H = 1660;

// 省份展示顺序（与列表页一致，地理向）
const PROVINCE_ORDER = ['北京', '天津', '河北', '山西', '内蒙古', '辽宁', '吉林', '黑龙江', '上海', '江苏', '浙江', '安徽', '福建', '江西', '山东', '河南', '湖北', '湖南', '广东', '广西', '海南', '重庆', '四川', '贵州', '云南', '西藏', '陕西', '甘肃', '青海', '宁夏', '新疆'];

// 瓦片布局 [col,row]，6×6 紧凑连续镶嵌，含港澳台（无一级博物馆）
const COLS = 6, ROWS = 6;
const TILE_LAYOUT = {
    '新疆': [0, 0], '内蒙古': [1, 0], '北京': [2, 0], '辽宁': [3, 0], '吉林': [4, 0], '黑龙江': [5, 0],
    '青海': [0, 1], '甘肃': [1, 1], '宁夏': [2, 1], '山西': [3, 1], '河北': [4, 1], '天津': [5, 1],
    '西藏': [0, 2], '四川': [1, 2], '陕西': [2, 2], '河南': [3, 2], '山东': [4, 2], '江苏': [5, 2],
    '云南': [0, 3], '贵州': [1, 3], '重庆': [2, 3], '湖北': [3, 3], '安徽': [4, 3], '上海': [5, 3],
    '广西': [0, 4], '湖南': [1, 4], '江西': [2, 4], '浙江': [3, 4], '福建': [4, 4], '台湾': [5, 4],
    '海南': [1, 5], '广东': [2, 5], '香港': [3, 5], '澳门': [4, 5]
};

// 配色主题：采用「豆瓣电影TOP250」海报的 3 套背景渐变（粉蓝/暖金/青雾）。
// 只切背景渐变；文字/元素颜色固定用 PALETTE（与电影海报一致的配色语言）。
const BG_THEMES = [
    { key: 'pinkBlue', name: '粉蓝', start: '#FDECEC', end: '#D2F1FE' },
    { key: 'goldSand', name: '暖金', start: '#FEEFBF', end: '#F8F3E7' },
    { key: 'greenMist', name: '青雾', start: '#E1E6D1', end: '#EAF0F9' }
];
const PALETTE = {
    title: '#2D2D2B',
    provPillText: '#4A4A46',
    pillBg: 'rgba(255,255,255,0.55)',
    pillBorder: 'rgba(255,255,255,0.72)',
    visited: '#6F8244',       // 参观过文字（深橄榄，加粗）
    unvisited: '#A7A498',     // 未去文字（灰）
    dotVisited: '#9AAB65',
    dotUnvisited: '#D2CEC3',
    tileVisited: 'rgba(255,255,255,0.50)',
    tileHas: 'rgba(255,255,255,0.28)',
    tileNone: 'rgba(255,255,255,0.14)',
    tileStroke: 'rgba(255,255,255,0.85)',
    hairline: 'rgba(45,45,43,0.20)',
    legendText: '#6F6F68',
    sig: 'rgba(45,45,43,0.70)'
};
const THEME_STORAGE_KEY = 'museumShareTheme';

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
        themeChips: BG_THEMES       // {key,name,start,end}，色卡点用 start→end 渐变
    },

    posterData: null,
    _ready: false,
    _destroyed: false,
    _previewTemp: null,
    _rendering: false,

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
        const screenW = win.windowWidth || 375;
        // 预览尽量占满内容宽（左右各 space-3≈screenW*24/750），减少四周留白
        const previewW = Math.round(screenW * (1 - 48 / 750));
        const previewH = Math.round(previewW * CANVAS_H / CANVAS_W);

        // 恢复上次选择的配色
        let themeKey = 'pinkBlue';
        try { themeKey = wx.getStorageSync(THEME_STORAGE_KEY) || 'pinkBlue'; } catch (e) {}
        const theme = getTheme(themeKey);

        this.setData({ statusBarHeight, navBarHeight, previewW, previewH, activeThemeKey: theme.key, theme });
        wx.setNavigationBarTitle({ title: '海报预览' });
        rewardedSaveGate.refreshHint(this);
        this.fetchData();
    },

    onReady() {
        this._ready = true;
        this.maybeGenerate();
    },

    onBack() {
        if (getCurrentPages().length > 1) wx.navigateBack();
        else wx.redirectTo({ url: '/pages/museum/list/list' });
    },

    onShareAppMessage() {
        return { title: '我的国家一级博物馆打卡足迹', path: '/pages/museum/list/list' };
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

            // 瓦片地图用的省级统计（只统计有瓦片布局的省份）
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

            // 博物馆清单用的分省分组（按 PROVINCE_ORDER，组内按 rank）
            const byProv = {};
            allSpots.forEach(s => {
                const p = (s.province || '').trim();
                if (!p) return;
                if (!byProv[p]) byProv[p] = [];
                byProv[p].push({
                    name: s.shortName || museumShortName(s.name),
                    rank: s.rank || 0,
                    visited: markStatusMap[s._id] === 'watched'
                });
            });
            const groups = [];
            PROVINCE_ORDER.forEach(p => {
                const arr = byProv[p];
                if (!arr || !arr.length) return;
                // 每省内：参观过的排最前（组内再按 rank），未去在后
                arr.sort((a, b) => (b.visited - a.visited) || (a.rank - b.rank));
                groups.push({ prov: p, total: arr.length, visited: arr.filter(x => x.visited).length, spots: arr });
            });

            if (!visitedTotal) {
                wx.showModal({ title: '还没有足迹', content: '先去打卡参观过的博物馆吧', showCancel: false, success: () => this.onBack() });
                return;
            }

            const litProvinces = Object.keys(provStats).filter(k => provStats[k].visited > 0).length;
            const userInfo = userStore.getUserInfo() || {};
            this.posterData = {
                nickname: userInfo.nickName || '博物馆爱好者',
                visitedCount: visitedTotal,
                totalCount: allSpots.length,
                provinceCount: litProvinces,
                provStats,
                groups
            };
            this.safeSetData({ loading: false });
            this.maybeGenerate();
        } catch (err) {
            if (this._destroyed) return;
            console.error('museum share fetch fail', err);
            wx.showToast({ title: '加载失败', icon: 'none' });
        }
    },

    // ── 交互：切版式 / 切配色 ──
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
                wx.createSelectorQuery().in(this).select('#museumCard').fields({ node: true, size: true }).exec(res => {
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
                this.drawTiles(ctx, helper, this.posterData.provStats, theme);
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
            console.error('museum share render fail', err);
            if (!this._destroyed) wx.showToast({ title: '生成失败', icon: 'none' });
        } finally {
            this._rendering = false;
            if (this._pendingRender && !this._destroyed) { this._pendingRender = false; this.generatePoster(); }
        }
    },

    // ── 通用：背景 / 头部 / 图例 / 页脚 ──
    drawBackground(ctx, theme) {
        const W = CANVAS_W, H = CANVAS_H;
        // 对角渐变 start→end（与电影海报卡片一致）
        const bg = ctx.createLinearGradient(0, 0, W, H);
        bg.addColorStop(0, theme.start);
        bg.addColorStop(1, theme.end);
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, W, H);
    },

    // 紧凑头部：标题 + 一行三个胶囊统计（打卡/点亮/覆盖）
    drawHeader(ctx, helper, data, theme) {
        const W = CANVAS_W;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = PALETTE.title;
        ctx.font = 'bold 60px sans-serif';
        ctx.fillText('国家一级博物馆打卡', W / 2, 106);

        const total = data.totalCount || 0;
        const cover = total ? Math.round(data.visitedCount / total * 100) : 0;
        const labels = [`打卡 ${data.visitedCount}/${total}`, `点亮 ${data.provinceCount} 省`, `覆盖 ${cover}%`];
        const fontPx = 34, pillH = 62, padX = 30, gap = 20, radius = 31;
        ctx.font = `600 ${fontPx}px sans-serif`;
        const widths = labels.map(t => ctx.measureText(t).width + padX * 2);
        const totalW = widths.reduce((a, b) => a + b, 0) + gap * 2;
        let px = (W - totalW) / 2;
        const py = 142;
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

    // 紧凑页脚：发丝渐变分隔线 + 一行（图例 · 署名）
    drawFooter(ctx, theme) {
        const W = CANVAS_W;
        // 发丝分隔线（两端淡出）
        const hy = 1588, inset = 210;
        const hg = ctx.createLinearGradient(inset, 0, W - inset, 0);
        hg.addColorStop(0, 'rgba(0,0,0,0)');
        hg.addColorStop(0.5, PALETTE.hairline);
        hg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.strokeStyle = hg; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(inset, hy); ctx.lineTo(W - inset, hy); ctx.stroke();

        // 一行：● 参观过  ● 未去   ·   搜索标记吧小程序 · 制作同款图
        const y = 1636, dotR = 10, dotGap = 12, itemGap = 30;
        const legFont = '28px sans-serif';
        const sig = '搜索标记吧小程序 · 制作同款图';
        const sigFont = '600 28px sans-serif';
        const sepText = '   ·   ';
        ctx.textBaseline = 'middle';
        ctx.font = legFont;
        const w1 = dotR * 2 + dotGap + ctx.measureText('参观过').width;
        const w2 = dotR * 2 + dotGap + ctx.measureText('未去').width;
        const wsep = ctx.measureText(sepText).width;
        ctx.font = sigFont;
        const wsig = ctx.measureText(sig).width;
        const totalW = w1 + itemGap + w2 + wsep + wsig;
        let x = (W - totalW) / 2;

        const drawLeg = (color, label) => {
            ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x + dotR, y, dotR, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = PALETTE.legendText; ctx.font = legFont; ctx.textAlign = 'left';
            ctx.fillText(label, x + dotR * 2 + dotGap, y);
            x += dotR * 2 + dotGap + ctx.measureText(label).width;
        };
        drawLeg(PALETTE.dotVisited, '参观过'); x += itemGap;
        drawLeg(PALETTE.dotUnvisited, '未去');
        ctx.fillStyle = PALETTE.legendText; ctx.font = legFont; ctx.textAlign = 'left'; ctx.fillText(sepText, x, y); x += wsep;
        ctx.fillStyle = PALETTE.sig; ctx.font = sigFont; ctx.textAlign = 'left'; ctx.fillText(sig, x, y);
        ctx.textBaseline = 'alphabetic';
    },

    // ── 版式一：瓦片格子地图 ──
    drawTiles(ctx, helper, provStats, theme) {
        const marginX = 28, gy0 = 228, gridW = CANVAS_W - marginX * 2, gridH = 1332;
        const cw = gridW / COLS, ch = gridH / ROWS;
        const gx0 = marginX;

        Object.keys(TILE_LAYOUT).forEach(prov => {
            const pos = TILE_LAYOUT[prov];
            const st = provStats[prov] || { total: 0, visited: 0 };
            const total = st.total, vis = Math.min(st.visited, total);
            const hasMuseum = total > 0;
            const cx = gx0 + pos[0] * cw, cy = gy0 + pos[1] * ch;

            ctx.fillStyle = vis > 0 ? PALETTE.tileVisited : (hasMuseum ? PALETTE.tileHas : PALETTE.tileNone);
            ctx.fillRect(cx, cy, cw, ch);
            ctx.strokeStyle = PALETTE.tileStroke; ctx.lineWidth = 2;
            ctx.strokeRect(cx + 1, cy + 1, cw - 2, ch - 2);

            ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
            ctx.fillStyle = hasMuseum ? PALETTE.provPillText : '#B7B4AA'; ctx.font = 'bold 27px sans-serif';
            ctx.fillText(prov, cx + 16, cy + 40);

            if (!hasMuseum) {
                ctx.textAlign = 'center'; ctx.fillStyle = '#C3C0B6'; ctx.font = '24px sans-serif';
                ctx.fillText('暂无', cx + cw / 2, cy + ch / 2 + 16);
                return;
            }

            ctx.textAlign = 'right';
            ctx.fillStyle = vis > 0 ? PALETTE.visited : '#A7A498'; ctx.font = '22px sans-serif';
            ctx.fillText(vis + '/' + total, cx + cw - 14, cy + 39);

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
                ctx.fillStyle = i < vis ? PALETTE.dotVisited : PALETTE.dotUnvisited;
                ctx.fill();
            }
        });
    },

    // ── 版式二：博物馆清单（紧凑分区式）──
    // 每省另起一行，行首一个圆角「省名 参观过/总数」胶囊，其后流排该省全部博物馆简称
    // （参观过=主色加粗、未去=灰）；双列、字号自适应；用行中线基线对齐胶囊与文字。
    drawListPoster(ctx, helper, data, theme) {
        const groups = data.groups || [];
        const BODY_TOP = 224, BODY_BOT = 1560, MARGIN = 44, COLGAP = 44;
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

            let col = 0;
            let x = colLeft(0);
            let y = BODY_TOP + half;   // y = 当前行中线
            let atColTop = true;

            const nextColIfNeeded = () => {
                if (y + half > BODY_BOT) {
                    col++;
                    if (col > 1) return false;
                    x = colLeft(col); y = BODY_TOP + half; atColTop = true;
                }
                return true;
            };

            for (let gi = 0; gi < groups.length; gi++) {
                const g = groups[gi];
                if (!atColTop) { y += lh + secGap; x = colLeft(col); }
                if (!nextColIfNeeded()) return false;

                // 省名胶囊
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

                // 博物馆简称
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
                        ctx.fillStyle = sp.visited ? PALETTE.visited : PALETTE.unvisited;
                        ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
                        ctx.fillText(sp.name, x, y);
                    }
                    x += w + space;
                    atColTop = false;
                }
            }
            return true;
        };

        // 字号自适应：从大到小取首个放得下的
        const SIZES = [24, 22, 20, 18, 16];
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
            console.error('museum share save fail', err);
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
