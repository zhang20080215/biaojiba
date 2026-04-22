// pages/boxoffice/share/share.js - 全球电影票房榜海报生成页
const CanvasHelper = require('../../../utils/canvasHelper.js');
const DataLoader = require('../../../utils/dataLoader.js');
const BoxofficePosterDrawer = require('../../../utils/boxofficePosterDrawer.js');
var adConfig = require('../../../utils/adConfig');
const rewardedSaveGate = require('../../../utils/rewardedSaveGate.js');

const TITLE = '全球电影票房榜观影海报墙';

Page({
    data: {
        userInfo: { nickName: '昵称', avatarUrl: '' },
        allMovies: [],
        watchedMovies: [],
        markStatusMap: {},
        stats: { watched: 0, wish: 0, unwatched: 0 },
        shareType: 'wall',
        textStyle: 'grid',
        listGridRows: 25,
        textListColumns: [],
        canvasSize: { width: 1242, height: 1660 },
        loadProgress: 0,
        isGenerating: false,
        needRewardedAd: false,
        showBannerAd: false,
        statusBarHeight: 20,
        headerPadTop: 0,
        menuBtnHeight: 32,
        themeClass: '',
        activeBgTheme: 'pinkBlue',
        bgThemes: [
            { key: 'warmSand', name: '暖杏', start: '#F8F3E7', end: '#FAECE7' },
            { key: 'pinkBlue', name: '粉蓝', start: '#FDECEC', end: '#D2F1FE' },
            { key: 'greenMist', name: '青雾', start: '#E1E6D1', end: '#EAF0F9' }
        ],
        currentGradient: { start: '#FDECEC', end: '#D2F1FE' },
        textCardBgStyle: 'background: linear-gradient(135deg, #FDECEC 0%, #D2F1FE 100%);',
        adUnitIds: {
            share_banner: adConfig.getAdUnitId('share_banner') || '',
        },
    },

    canvasHelper: null,
    posterDrawer: null,

    getDoubanBgThemes() {
        return [
            { key: 'pinkBlue', name: '\u7c89\u84dd', start: '#FDECEC', end: '#D2F1FE' },
            { key: 'goldSand', name: '\u6696\u91d1', start: '#FEEFBF', end: '#F8F3E7' },
            { key: 'greenMist', name: '\u9752\u96fe', start: '#E1E6D1', end: '#EAF0F9' }
        ];
    },

    async onLoad(options) {
        try {
            const shareType = options.type || 'wall';
            const windowInfo = wx.getWindowInfo();
            const menuBtn = wx.getMenuButtonBoundingClientRect();
            const themeClass = wx.getStorageSync('appTheme') || 'theme-green';
            const bgThemes = this.getDoubanBgThemes();
            const defaultTheme = bgThemes[0];

            this.setData({
                shareType,
                statusBarHeight: windowInfo.statusBarHeight || 20,
                headerPadTop: menuBtn.top,
                menuBtnHeight: menuBtn.height,
                themeClass,
                bgThemes,
                activeBgTheme: defaultTheme.key,
                currentGradient: { start: defaultTheme.start, end: defaultTheme.end },
                textCardBgStyle: `background: linear-gradient(135deg, ${defaultTheme.start} 0%, ${defaultTheme.end} 100%);`
            });
            await this.loadUserInfo();
            await this.loadData();
            this.initAds();
            rewardedSaveGate.refreshHint(this);
        } catch (err) {
            console.error('页面加载失败:', err);
            wx.showModal({ title: '加载失败', content: err.message || '请重试', showCancel: false });
        }
    },

    onShow() {
        const themeClass = wx.getStorageSync('appTheme') || 'theme-green';
        if (themeClass !== this.data.themeClass) {
            this.setData({ themeClass });
        }
    },

    onBack() {
        wx.navigateBack({
            fail: () => {
                wx.reLaunch({ url: '/pages/boxoffice/list/list' });
            }
        });
    },

    onTextStyleTap(e) {
        const style = e.currentTarget.dataset.style;
        if (style) {
            this.setData({ textStyle: style });
        }
    },

    onBgThemeTap(e) {
        const key = e.currentTarget.dataset.key;
        const theme = this.data.bgThemes.find(item => item.key === key);
        if (!theme) return;
        this.setData({
            activeBgTheme: theme.key,
            currentGradient: { start: theme.start, end: theme.end },
            textCardBgStyle: `background: linear-gradient(135deg, ${theme.start} 0%, ${theme.end} 100%);`
        });
    },

    async onReady() {
        try {
            await new Promise(resolve => setTimeout(resolve, 300));
            await this.initCanvas();
        } catch (err) {
            console.error('Canvas初始化失败:', err);
            wx.showModal({ title: 'Canvas初始化失败', content: err.message || '无法初始化画布，请重试', showCancel: false });
        }
    },

    onHide() {
        wx.hideLoading();
        if (this.data.isGenerating) {
            this.setData({ isGenerating: false });
        }
    },

    async loadUserInfo() {
        const userInfo = wx.getStorageSync('userInfo') || { nickName: '昵称', avatarUrl: '' };
        try {
            const res = await wx.cloud.getTempFileURL({
                fileList: [{ fileID: 'cloud://cloud1-3gn3wryx716919c6.636c-cloud1-3gn3wryx716919c6-1360913831/GCGuV-qbcAAVSKH.png', maxAge: 60 * 60 }]
            });
            if (!userInfo.avatarUrl) userInfo.avatarUrl = res.fileList[0].tempFileURL;
            this.setData({ userInfo });
        } catch (err) {
            console.error('获取默认头像失败:', err);
            this.setData({ userInfo });
        }
    },

    initCanvas() {
        return new Promise((resolve, reject) => {
            const query = wx.createSelectorQuery().in(this);
            query.select('#shareCanvas').fields({ node: true, size: true }).exec(res => {
                if (!res || !res[0] || !res[0].node) {
                    setTimeout(() => {
                        const retryQuery = wx.createSelectorQuery().in(this);
                        retryQuery.select('#shareCanvas').fields({ node: true, size: true }).exec(retryRes => {
                            if (!retryRes || !retryRes[0] || !retryRes[0].node) {
                                reject(new Error('Canvas节点获取失败')); return;
                            }
                            this._setupCanvas(retryRes[0].node, resolve, reject);
                        });
                    }, 300);
                    return;
                }
                this._setupCanvas(res[0].node, resolve, reject);
            });
        });
    },

    _setupCanvas(canvasNode, resolve, reject) {
        try {
            const canvas = canvasNode;
            const ctx = canvas.getContext('2d');
            if (!ctx) { reject(new Error('无法获取Canvas 2D上下文')); return; }

            const sysInfo = wx.getWindowInfo();
            const dpr = this.data.canvasSize.width > 750 ? 1 : sysInfo.pixelRatio || 1;
            const { width, height } = this.data.canvasSize;
            canvas.width = width * dpr;
            canvas.height = height * dpr;
            if (ctx.setTransform) {
                ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            } else {
                ctx.scale(dpr, dpr);
            }

            this.canvasHelper = new CanvasHelper(canvas, ctx, this.data.canvasSize);
            this.posterDrawer = new BoxofficePosterDrawer(this.canvasHelper);
            resolve();
        } catch (err) {
            reject(new Error('Canvas设置失败: ' + err.message));
        }
    },

    // 每次保存前重新获取 canvas 节点，防止 setData 导致节点引用失效
    ensureCanvas() {
        return new Promise((resolve, reject) => {
            const query = wx.createSelectorQuery().in(this);
            query.select('#shareCanvas').fields({ node: true, size: true }).exec(res => {
                if (!res || !res[0] || !res[0].node) {
                    reject(new Error('Canvas节点获取失败'));
                    return;
                }
                const canvas = res[0].node;
                const ctx = canvas.getContext('2d');
                const { width, height } = this.data.canvasSize;
                const dpr = width > 750 ? 1 : (wx.getWindowInfo().pixelRatio || 1);
                canvas.width = width * dpr;
                canvas.height = height * dpr;
                if (ctx.setTransform) {
                    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
                } else {
                    ctx.scale(dpr, dpr);
                }
                if (this.canvasHelper) {
                    this.canvasHelper.canvas = canvas;
                    this.canvasHelper.ctx = ctx;
                    this.canvasHelper.canvasSize = { width, height };
                } else {
                    this.canvasHelper = new CanvasHelper(canvas, ctx, { width, height });
                    this.posterDrawer = new BoxofficePosterDrawer(this.canvasHelper);
                }
                resolve();
            });
        });
    },

    // 统一的画布尺寸调整：同时重设 width/height 并重置变换
    resizeCanvas(width, height) {
        const canvas = this.canvasHelper.canvas;
        const ctx = this.canvasHelper.ctx;
        const sysInfo = wx.getWindowInfo();
        const dpr = width > 750 ? 1 : sysInfo.pixelRatio || 1;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        if (ctx.setTransform) {
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        } else {
            ctx.scale(dpr, dpr);
        }
        this.canvasHelper.canvasSize = { width, height };
        this.setData({ canvasSize: { width, height } });
    },

    // 提前计算各模式需要的画布高度，避免边画边 resize
    computeCanvasHeight() {
        const baseWidth = 1242;
        const baseHeight = 1660;
        if (this.data.shareType === 'wall') {
            const cols = 10;
            const padding = 24;
            const colGap = 3;
            const rowGap = 3;
            const gridStartY = 230;
            const footerHeight = 75;
            const availableW = baseWidth - padding * 2;
            const movies = this.data.allMovies || [];
            const rows = Math.max(1, Math.ceil(movies.length / cols));
            const posterW = Math.floor((availableW - (cols - 1) * colGap) / cols);
            const posterH = Math.floor(posterW * 1.5);
            const needed = gridStartY + rows * posterH + (rows - 1) * rowGap + footerHeight + 20;
            return Math.max(baseHeight, needed);
        }
        if (this.data.shareType === 'poster') {
            const padding = 40;
            const colsPerRow = 10;
            const gap = 8;
            const startY = 120;
            const posterAreaStartY = startY + 160;
            const movies = this.data.watchedMovies || [];
            const actualRows = Math.max(1, Math.ceil(movies.length / colsPerRow));
            const availableWidth = baseWidth - padding * 2;
            const posterWidth = Math.floor((availableWidth - gap * (colsPerRow - 1)) / colsPerRow);
            const posterHeight = Math.floor(posterWidth * 1.4);
            const needed = posterAreaStartY + actualRows * (posterHeight + gap) + padding + 40;
            return Math.min(Math.max(baseHeight, needed + 100), 5000);
        }
        // 文字列表模式：根据行数动态计算高度，保证每行足够大
        if (this.data.shareType === 'text' && this.data.textStyle === 'list') {
            const listCols = 4;
            const movies = this.data.allMovies || [];
            const listRows = Math.max(1, Math.ceil(movies.length / listCols));
            const listCellH = 52;
            const listRowGap = 2;
            const listHeaderH = 28;
            const gridStartY = 225;
            const footerH = 75;
            const needed = gridStartY + listHeaderH + listRows * listCellH + (listRows - 1) * listRowGap + footerH;
            return Math.max(baseHeight, needed);
        }
        return baseHeight;
    },

    async loadData() {
        try {
            wx.showLoading({ title: '加载数据中...' });
            const openid = this.data.userInfo && this.data.userInfo._openid ? this.data.userInfo._openid : '';
            const { movies, marks } = await DataLoader.loadMoviesData('boxoffice', openid, false);
            const { markStatusMap, stats, watchedMovies } = DataLoader.processMarks(marks, movies);
            const listGridRows = Math.max(1, Math.ceil(movies.length / 4));
            const textListColumns = this.buildTextListColumns(movies, listGridRows);
            this.setData({ allMovies: movies, markStatusMap, stats, watchedMovies, listGridRows, textListColumns });
            wx.hideLoading();
        } catch (err) {
            console.error('加载数据失败:', err);
            wx.hideLoading();
            wx.showToast({ title: '加载数据失败', icon: 'none', duration: 3000 });
            throw err;
        }
    },

    async saveImage() {
        if (this.data.isGenerating) { wx.showToast({ title: '正在生成中...', icon: 'none' }); return; }
        if (!this.canvasHelper) { wx.showToast({ title: 'Canvas未初始化', icon: 'none' }); return; }

        const hasGrant = await rewardedSaveGate.ensureGrant(this);
        if (!hasGrant) return;

        try {
            this.setData({ isGenerating: true });
            wx.showLoading({ title: '生成图片中...', mask: true });
            await this.startDrawing();
            await this.exportAndSaveImage();
            wx.hideLoading();
            wx.showToast({ title: '保存成功', icon: 'success' });
        } catch (err) {
            wx.hideLoading();
            console.error('保存图片失败:', err);
            wx.showModal({ title: '保存失败', content: err.message || '图片生成失败,请重试', showCancel: false });
        } finally {
            this.setData({ isGenerating: false });
        }
    },

    async startDrawing() {
        await this.ensureCanvas();
        const targetWidth = 1242;
        const targetHeight = this.computeCanvasHeight();
        if (
            this.data.canvasSize.width !== targetWidth ||
            this.data.canvasSize.height !== targetHeight
        ) {
            this.resizeCanvas(targetWidth, targetHeight);
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        this.canvasHelper.clear();
        if (this.data.shareType === 'wall') {
            await this.drawMovieWall();
        } else if (this.data.shareType === 'poster') {
            await this.drawPosterWall();
        } else {
            await this.drawTextCard();
        }
    },

    // ════════════════════════════════════════
    //  电影墙模式 — 全部100部海报 + 状态蒙层 + 片名
    // ════════════════════════════════════════
    async drawMovieWall() {
        const ctx = this.canvasHelper.ctx;
        const { width, height } = this.data.canvasSize;

        const cols = 10;
        const padding = 24;
        const colGap = 3;
        const rowGap = 3;
        const headerTitleY = 80;
        const statsY = 160;
        const gridStartY = 230;
        const footerHeight = 75;
        const availableW = width - padding * 2;

        const movies = this.data.allMovies;
        const rows = Math.max(1, Math.ceil(movies.length / cols));
        const posterW = Math.floor((availableW - (cols - 1) * colGap) / cols);
        const posterH = Math.floor(posterW * 1.5); // 保持 2:3 海报比例

        const gridEndY = gridStartY + rows * posterH + (rows - 1) * rowGap;

        this.drawCardBackground();
        this.drawCanvasHeader(ctx, width, headerTitleY);
        this.drawStats(ctx, padding + 20, statsY, width - (padding + 20) * 2, true);

        wx.showLoading({ title: '加载图片中...', mask: true });
        const imageMap = await this._preloadWallImages(movies);

        for (let i = 0; i < movies.length; i++) {
            const movie = movies[i];
            const row = Math.floor(i / cols);
            const col = i % cols;
            const x = padding + col * (posterW + colGap);
            const y = gridStartY + row * (posterH + rowGap);
            const status = this.data.markStatusMap[movie._id] || 'unwatched';
            const imgObj = imageMap[movie._id] || null;
            this._drawWallCellSync(movie, x, y, posterW, posterH, status, imgObj);

            if (i % 10 === 9) {
                wx.showLoading({ title: `绘制中${Math.floor(((i + 1) / movies.length) * 100)}%`, mask: true });
            }
        }

        this.drawFooter(gridEndY);
    },

    async _preloadWallImages(movies) {
        const imageMap = {};
        const cloudEntries = [];
        const urlMap = {};
        movies.forEach(movie => {
            const url = movie.cover || movie.coverUrl || movie.originalCover;
            if (!url) return;
            if (url.startsWith('cloud://')) {
                cloudEntries.push({ fileID: url, movieId: movie._id });
            } else {
                urlMap[movie._id] = url;
            }
        });

        if (cloudEntries.length > 0) {
            const chunkSize = 50;
            for (let c = 0; c < cloudEntries.length; c += chunkSize) {
                const chunk = cloudEntries.slice(c, Math.min(c + chunkSize, cloudEntries.length));
                try {
                    const fileList = chunk.map(e => ({ fileID: e.fileID, maxAge: 60 * 60 }));
                    const res = await wx.cloud.getTempFileURL({ fileList });
                    res.fileList.forEach((item, idx) => {
                        if (item.tempFileURL) {
                            urlMap[chunk[idx].movieId] = item.tempFileURL;
                        }
                    });
                } catch (err) {
                    console.error('批量获取云存储临时URL失败:', err);
                    for (const entry of chunk) {
                        try {
                            const tempUrl = await this.canvasHelper.getCloudTempUrl(entry.fileID);
                            urlMap[entry.movieId] = tempUrl;
                        } catch (e) { /* skip */ }
                    }
                }
            }
        }

        const movieIds = Object.keys(urlMap);
        const batchSize = 6;
        for (let i = 0; i < movieIds.length; i += batchSize) {
            const batch = movieIds.slice(i, Math.min(i + batchSize, movieIds.length));
            const results = await Promise.allSettled(
                batch.map(async (movieId) => {
                    const imgObj = await this.canvasHelper.loadImage(urlMap[movieId]);
                    return { movieId, imgObj };
                })
            );
            results.forEach(r => {
                if (r.status === 'fulfilled') {
                    imageMap[r.value.movieId] = r.value.imgObj;
                }
            });
            wx.showLoading({ title: `加载图片${Math.floor(((i + batch.length) / movieIds.length) * 100)}%`, mask: true });
        }

        return imageMap;
    },

    _drawWallCellSync(movie, x, y, w, h, status, imgObj) {
        const ctx = this.canvasHelper.ctx;
        const radius = 6;

        ctx.save();
        this.canvasHelper.drawRoundRectPath(x, y, w, h, radius);
        ctx.clip();

        ctx.fillStyle = '#f5f3f1';
        ctx.fillRect(x, y, w, h);

        if (imgObj) {
            try {
                // aspect-fill：裁剪居中绘制，保持海报比例不变形
                const imgW = imgObj.width || w;
                const imgH = imgObj.height || h;
                const imgRatio = imgW / imgH;
                const cellRatio = w / h;
                let sx, sy, sw, sh;
                if (imgRatio > cellRatio) {
                    sh = imgH;
                    sw = imgH * cellRatio;
                    sx = (imgW - sw) / 2;
                    sy = 0;
                } else {
                    sw = imgW;
                    sh = imgW / cellRatio;
                    sx = 0;
                    sy = (imgH - sh) / 2;
                }
                ctx.drawImage(imgObj, sx, sy, sw, sh, x, y, w, h);
            } catch (e) { /* keep bg */ }
        } else {
            ctx.fillStyle = '#F2F0EA';
            ctx.fillRect(x, y, w, h);
            ctx.fillStyle = 'rgba(156, 153, 143, 0.5)';
            ctx.font = '20px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('🏆', x + w / 2, y + h / 2 - 8);
        }

        if (status === 'watched') {
            const overlay = ctx.createLinearGradient(x, y, x, y + h);
            overlay.addColorStop(0, 'rgba(154, 171, 101, 0.03)');
            overlay.addColorStop(1, 'rgba(154, 171, 101, 0.12)');
            ctx.fillStyle = overlay;
            ctx.fillRect(x, y, w, h);
        } else if (status === 'wish') {
            const overlay = ctx.createLinearGradient(x, y, x, y + h);
            overlay.addColorStop(0, 'rgba(212, 168, 40, 0.03)');
            overlay.addColorStop(1, 'rgba(212, 168, 40, 0.10)');
            ctx.fillStyle = overlay;
            ctx.fillRect(x, y, w, h);
        } else {
            ctx.fillStyle = 'rgba(45, 45, 43, 0.50)';
            ctx.fillRect(x, y, w, h);
        }

        const textGradH = h * 0.38;
        const textGrad = ctx.createLinearGradient(x, y + h - textGradH, x, y + h);
        textGrad.addColorStop(0, 'rgba(0, 0, 0, 0)');
        textGrad.addColorStop(0.5, 'rgba(0, 0, 0, 0.5)');
        textGrad.addColorStop(1, 'rgba(0, 0, 0, 0.85)');
        ctx.fillStyle = textGrad;
        ctx.fillRect(x, y + h - textGradH, w, textGradH);

        ctx.font = '600 13px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillStyle = '#ffffff';
        let title = movie.title;
        const maxTextW = w - 6;
        if (ctx.measureText(title).width > maxTextW) {
            while (title.length > 1 && ctx.measureText(title + '…').width > maxTextW) {
                title = title.slice(0, -1);
            }
            title += '…';
        }
        ctx.fillText(title, x + w / 2, y + h - 4);

        if (status === 'watched') {
            this._drawStatusBadge(ctx, x + w - 2, y + 2, '✓', 'rgba(76, 175, 80, 0.9)');
        } else if (status === 'wish') {
            this._drawStatusBadge(ctx, x + w - 2, y + 2, '♡', 'rgba(255, 165, 2, 0.9)');
        }

        ctx.restore();

        if (status === 'watched') {
            ctx.save();
            ctx.strokeStyle = 'rgba(154, 171, 101, 0.45)';
            ctx.lineWidth = 1.5;
            this.canvasHelper.drawRoundRectPath(x, y, w, h, radius);
            ctx.stroke();
            ctx.restore();
        } else if (status === 'wish') {
            ctx.save();
            ctx.strokeStyle = 'rgba(212, 168, 40, 0.38)';
            ctx.lineWidth = 1;
            this.canvasHelper.drawRoundRectPath(x, y, w, h, radius);
            ctx.stroke();
            ctx.restore();
        }
    },

    _drawStatusBadge(ctx, rightX, topY, text, bgColor) {
        const size = 18;
        const cx = rightX - size / 2;
        const cy = topY + size / 2;
        ctx.beginPath();
        ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
        ctx.fillStyle = bgColor;
        ctx.fill();
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#fff';
        ctx.fillText(text, cx, cy);
    },

    // ════════════════════════════════════════
    //  海报墙模式（已看电影封面拼图）
    // ════════════════════════════════════════
    async drawPosterWall() {
        const ctx = this.canvasHelper.ctx;
        const { width, height } = this.data.canvasSize;
        const padding = 40;
        const colsPerRow = 10;
        const gap = 8;
        const availableWidth = width - padding * 2;
        const posterWidth = Math.floor((availableWidth - gap * (colsPerRow - 1)) / colsPerRow);
        const posterHeight = Math.floor(posterWidth * 1.4);

        const startY = 120;
        const posterAreaStartY = startY + 160;
        const actualMoviesCount = this.data.watchedMovies.length;
        const actualRows = Math.max(1, Math.ceil(actualMoviesCount / colsPerRow));

        this.drawCardBackground();
        this.drawCanvasHeader(ctx, width, startY);
        this.drawStats(ctx, padding, startY + 60, width - padding * 2);
        this.drawContentPanel(24, posterAreaStartY - 18, width - 48, Math.max(220, actualRows * (posterHeight + gap) - gap + 36));

        const updateProgress = (progress) => {
            wx.showLoading({ title: `生成中${progress}%`, mask: true });
        };

        await this.posterDrawer.drawPosterWall(this.data.watchedMovies, this.data.canvasSize, updateProgress);
        this.drawFooter(null);
    },

    // ════════════════════════════════════════
    //  文字海报模式 — 5列×20行 规则网格
    // ════════════════════════════════════════
    async drawTextCard() {
        const ctx = this.canvasHelper.ctx;
        const { width, height } = this.data.canvasSize;

        const headerTitleY = 80;
        const statsY = 155;
        const gridStartY = 225;
        const footerHeight = 75;
        const gridEndY = height - footerHeight;
        const padding = 30;

        this.drawCardBackground();
        this.drawCanvasHeader(ctx, width, headerTitleY);
        this.drawStats(ctx, padding + 20, statsY, width - (padding + 20) * 2);
        if (this.data.textStyle === 'list') {
            this.drawMovieList(ctx, padding, gridStartY, width - padding * 2, gridEndY - gridStartY);
        } else {
            this.drawMovieGrid(ctx, padding, gridStartY, width - padding * 2, gridEndY - gridStartY);
        }
        this.drawFooter(gridEndY);
    },

    // ════════════════════════════════════════
    //  公共绘制组件
    // ════════════════════════════════════════

    drawContentPanel(x, y, width, height) {
        const ctx = this.canvasHelper.ctx;
        ctx.save();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.38)';
        this.canvasHelper.drawRoundRectPath(x, y, width, height, 24);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.58)';
        ctx.lineWidth = 1;
        this.canvasHelper.drawRoundRectPath(x, y, width, height, 24);
        ctx.stroke();
        ctx.restore();
    },

    drawCardBackground() {
        const ctx = this.canvasHelper.ctx;
        const { width, height } = this.data.canvasSize;

        const gradient = ctx.createLinearGradient(0, 0, width, height);
        if (this.data.shareType === 'text') {
            gradient.addColorStop(0, this.data.currentGradient.start);
            gradient.addColorStop(1, this.data.currentGradient.end);
        } else {
            gradient.addColorStop(0, '#F8F3E7');
            gradient.addColorStop(0.5, '#EEF3E5');
            gradient.addColorStop(1, '#FAECE7');
        }
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);

        // 顶部柔和漫反射
        ctx.save();
        const spotRadius = width * 0.6;
        const spotGrad = ctx.createRadialGradient(width / 2, 0, 0, width / 2, 0, spotRadius);
        spotGrad.addColorStop(0, 'rgba(255, 255, 255, 0.4)');
        spotGrad.addColorStop(0.55, 'rgba(210, 241, 254, 0.14)');
        spotGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = spotGrad;
        ctx.fillRect(0, 0, width, spotRadius);
        ctx.restore();

        // 顶部 & 底部装饰边
        this.drawCoralLine(ctx, 0, width);
        this.drawCoralLine(ctx, height - 4, width);
    },

    drawCoralLine(ctx, y, width) {
        const grad = ctx.createLinearGradient(0, 0, width, 0);
        grad.addColorStop(0, 'rgba(255, 255, 255, 0)');
        grad.addColorStop(0.25, 'rgba(156, 153, 143, 0.18)');
        grad.addColorStop(0.5, 'rgba(182, 202, 235, 0.45)');
        grad.addColorStop(0.75, 'rgba(156, 153, 143, 0.18)');
        grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, y, width, 4);
    },

    drawCanvasHeader(ctx, width, startY) {
        ctx.font = '800 44px sans-serif';
        const titleText = TITLE;
        const titleWidth = ctx.measureText(titleText).width;
        const iconText = '🏆';
        ctx.font = '32px sans-serif';
        const iconWidth = ctx.measureText(iconText).width;
        const iconGap = 14;
        const totalHeaderW = iconWidth + iconGap + titleWidth;
        const headerStartX = (width - totalHeaderW) / 2;

        // 奖杯图标
        ctx.font = '32px sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(iconText, headerStartX, startY - 6);

        // 主标题
        ctx.fillStyle = '#2D2D2B';
        ctx.font = '800 44px sans-serif';
        ctx.textAlign = 'center';
        const titleCenterX = headerStartX + iconWidth + iconGap + titleWidth / 2;
        ctx.fillText(titleText, titleCenterX, startY);

        // 副标题
        ctx.fillStyle = 'rgba(156, 153, 143, 0.8)';
        ctx.font = '400 20px sans-serif';
        ctx.fillText('Worldwide Box Office · Top 100', width / 2, startY + 34);

        // 分割线
        const lineY = startY + 50;
        const lineGrad = ctx.createLinearGradient(width * 0.15, 0, width * 0.85, 0);
        lineGrad.addColorStop(0, 'rgba(255, 255, 255, 0)');
        lineGrad.addColorStop(0.3, 'rgba(156, 153, 143, 0.22)');
        lineGrad.addColorStop(0.5, 'rgba(182, 202, 235, 0.5)');
        lineGrad.addColorStop(0.7, 'rgba(156, 153, 143, 0.22)');
        lineGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = lineGrad;
        ctx.fillRect(width * 0.1, lineY, width * 0.8, 2);
    },

    drawStats(ctx, startX, startY, maxWidth, showIcon) {
        const { stats } = this.data;
        const statItems = [
            { label: '已看', value: stats.watched, color: '#9AAB65', iconFill: 'rgba(154, 171, 101, 0.18)', iconStroke: 'rgba(154, 171, 101, 0.36)', badge: '✓', badgeBg: 'rgba(154, 171, 101, 0.95)' },
            { label: '想看', value: stats.wish, color: '#D4A828', iconFill: 'rgba(212, 168, 40, 0.16)', iconStroke: 'rgba(212, 168, 40, 0.34)', badge: '♡', badgeBg: 'rgba(212, 168, 40, 0.95)' },
            { label: '未看', value: stats.unwatched, color: '#9C998F', iconFill: 'rgba(156, 153, 143, 0.12)', iconStroke: 'rgba(156, 153, 143, 0.28)', badge: null, badgeBg: null }
        ];

        const itemWidth = showIcon ? 180 : 160;
        const itemHeight = 50;
        const gap = 30;
        const totalWidth = statItems.length * itemWidth + (statItems.length - 1) * gap;
        const startXCentered = startX + (maxWidth - totalWidth) / 2;

        statItems.forEach((item, index) => {
            const itemX = startXCentered + index * (itemWidth + gap);
            const itemY = startY;

            const gradient = ctx.createLinearGradient(itemX, itemY, itemX + itemWidth, itemY + itemHeight);
            const bgColors = {
                '已看': ['rgba(225, 230, 209, 0.9)', 'rgba(225, 230, 209, 0.55)'],
                '想看': ['rgba(254, 239, 191, 0.92)', 'rgba(254, 239, 191, 0.56)'],
                '未看': ['rgba(242, 240, 234, 0.9)', 'rgba(242, 240, 234, 0.55)']
            };
            gradient.addColorStop(0, bgColors[item.label][0]);
            gradient.addColorStop(1, bgColors[item.label][1]);
            ctx.fillStyle = gradient;
            this.canvasHelper.drawRoundRectPath(itemX, itemY, itemWidth, itemHeight, 12);
            ctx.fill();

            ctx.strokeStyle = item.color + '44';
            ctx.lineWidth = 1;
            this.canvasHelper.drawRoundRectPath(itemX, itemY, itemWidth, itemHeight, 12);
            ctx.stroke();

            ctx.fillStyle = item.color;
            ctx.font = '500 18px sans-serif';
            ctx.textAlign = 'left';
            const labelText = item.label;
            const valueText = item.value.toString();
            const labelWidth = ctx.measureText(labelText).width;
            ctx.font = '600 20px sans-serif';
            const valueWidth = ctx.measureText(valueText).width;

            const iconSize = showIcon ? 14 : 0;
            const iconGap = showIcon ? 8 : 0;
            const textGap = 10;
            const contentWidth = iconSize + iconGap + labelWidth + textGap + valueWidth;
            let curX = itemX + (itemWidth - contentWidth) / 2;
            const textY = itemY + 32;

            if (showIcon) {
                const iconY = textY - iconSize + 2;
                ctx.fillStyle = item.iconFill;
                ctx.fillRect(curX, iconY, iconSize, iconSize);
                ctx.strokeStyle = item.iconStroke;
                ctx.lineWidth = 1;
                ctx.strokeRect(curX, iconY, iconSize, iconSize);

                if (item.badge) {
                    const badgeR = 4;
                    const bx = curX + iconSize;
                    const by = iconY;
                    ctx.beginPath();
                    ctx.arc(bx, by + badgeR, badgeR, 0, Math.PI * 2);
                    ctx.fillStyle = item.badgeBg;
                    ctx.fill();
                    ctx.font = 'bold 6px sans-serif';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillStyle = '#fff';
                    ctx.fillText(item.badge, bx, by + badgeR);
                }

                curX += iconSize + iconGap;
            }

            ctx.fillStyle = item.color;
            ctx.font = '500 18px sans-serif';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'alphabetic';
            ctx.fillText(labelText, curX, textY);
            curX += labelWidth + textGap;

            ctx.font = '600 20px sans-serif';
            ctx.fillText(valueText, curX, textY);
        });
    },

    drawMovieGrid(ctx, startX, startY, availW, availH) {
        const movies = this.data.allMovies;
        const cols = 5;
        const rows = 20;
        const colGap = 6;
        const rowGap = 4;

        const cellW = Math.floor((availW - (cols - 1) * colGap) / cols);
        const cellH = Math.floor((availH - (rows - 1) * rowGap) / rows);
        const totalH = rows * cellH + (rows - 1) * rowGap;
        const totalW = cols * cellW + (cols - 1) * colGap;
        const offsetX = startX + (availW - totalW) / 2;
        const offsetY = startY + (availH - totalH) / 2;

        for (let i = 0; i < movies.length && i < cols * rows; i++) {
            const movie = movies[i];
            const row = Math.floor(i / cols);
            const col = i % cols;
            const x = offsetX + col * (cellW + colGap);
            const y = offsetY + row * (cellH + rowGap);
            const status = this.data.markStatusMap[movie._id] || 'unwatched';
            this._drawTextCell(ctx, x, y, cellW, cellH, movie, status);
        }
    },

    buildTextListColumns(movies, rowsPerColumn) {
        const columns = [];
        const totalColumns = 4;
        for (let columnIndex = 0; columnIndex < totalColumns; columnIndex++) {
            const startIndex = columnIndex * rowsPerColumn;
            const endIndex = Math.min(startIndex + rowsPerColumn, movies.length);
            columns.push({
                key: `col-${columnIndex}`,
                header: endIndex > startIndex ? `TOP${startIndex + 1}~${endIndex}` : '',
                movies: movies.slice(startIndex, endIndex)
            });
        }
        return columns;
    },

    drawMovieList(ctx, startX, startY, availW, availH) {
        const movies = this.data.allMovies;
        const cols = 4;
        const rows = Math.max(1, Math.ceil(movies.length / cols));
        const colGap = 14;
        const rowGap = 2;
        const headerHeight = 28;
        const cellW = Math.floor((availW - (cols - 1) * colGap) / cols);
        const cellH = Math.floor((availH - headerHeight - (rows - 1) * rowGap) / rows);

        for (let col = 0; col < cols; col++) {
            const startRank = col * rows + 1;
            const endRank = Math.min((col + 1) * rows, movies.length);
            if (startRank > movies.length) continue;
            const headerX = startX + col * (cellW + colGap);
            this.drawTextListHeader(ctx, headerX, startY, `TOP${startRank}~${endRank}`);
        }

        for (let i = 0; i < movies.length; i++) {
            const movie = movies[i];
            const col = Math.floor(i / rows);
            const row = i % rows;
            const x = startX + col * (cellW + colGap);
            const y = startY + headerHeight + row * (cellH + rowGap);
            const status = this.data.markStatusMap[movie._id] || 'unwatched';
            this.drawMovieListItem(ctx, x, y, cellW, cellH, movie, status);
        }
    },

    drawTextListHeader(ctx, x, y, text) {
        ctx.save();
        const lineX = x + 6;
        ctx.strokeStyle = 'rgba(156, 153, 143, 0.65)';
        ctx.lineWidth = 2.5;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(lineX, y + 3);
        ctx.lineTo(lineX, y + 19);
        ctx.stroke();

        ctx.font = '700 19px sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = 'rgba(45, 45, 43, 0.75)';
        ctx.fillText(text, x + 16, y + 12);
        ctx.restore();
    },

    legacyDrawMovieListItem(ctx, x, y, w, h, movie, status) {
        const dotColorMap = {
            watched: '#9AAB65',
            wish: '#D4A828',
            unwatched: '#9C998F'
        };
        const titleColorMap = {
            watched: 'rgba(45, 45, 43, 0.72)',
            wish: 'rgba(45, 45, 43, 0.82)',
            unwatched: 'rgba(111, 111, 104, 0.88)'
        };
        const dotSize = Math.max(6, Math.floor(h * 0.22));
        const textX = x + dotSize + 12;
        const centerY = y + h / 2;
        const maxTextWidth = w - dotSize - 18;
        let title = movie.title;

        ctx.save();
        ctx.fillStyle = dotColorMap[status] || dotColorMap.unwatched;
        ctx.beginPath();
        ctx.arc(x + dotSize / 2 + 8, centerY, dotSize / 2, 0, Math.PI * 2);
        ctx.fill();

        ctx.font = '500 15px sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        if (ctx.measureText(title).width > maxTextWidth) {
            while (title.length > 1 && ctx.measureText(title + '…').width > maxTextWidth) {
                title = title.slice(0, -1);
            }
            title += '…';
        }
        ctx.fillStyle = titleColorMap[status] || titleColorMap.unwatched;
        ctx.fillText(title, textX, centerY);

        if (status === 'watched') {
            const textWidth = Math.min(ctx.measureText(title).width, maxTextWidth);
            ctx.strokeStyle = 'rgba(123, 154, 60, 0.55)';
            ctx.lineWidth = 1.4;
            ctx.beginPath();
            ctx.moveTo(textX, centerY);
            ctx.lineTo(textX + textWidth, centerY);
            ctx.stroke();
        }
        ctx.restore();
    },

    drawMovieListItem(ctx, x, y, w, h, movie, status) {
        const dotColor = { watched: '#9AAB65', wish: '#D4A828', unwatched: '#9C998F' };
        const titleColor = {
            watched: 'rgba(45, 45, 43, 0.78)',
            wish: 'rgba(45, 45, 43, 0.85)',
            unwatched: 'rgba(90, 88, 82, 0.82)'
        };
        const dotR = 4;
        const dotCenterX = x + 6;
        const textX = x + 18;
        const centerY = y + h / 2;
        const maxTextWidth = w - 22;
        let title = movie.title;

        ctx.save();
        ctx.fillStyle = dotColor[status] || dotColor.unwatched;
        ctx.beginPath();
        ctx.arc(dotCenterX, centerY, dotR, 0, Math.PI * 2);
        ctx.fill();

        ctx.font = '500 24px sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        if (ctx.measureText(title).width > maxTextWidth) {
            while (title.length > 1 && ctx.measureText(title + '…').width > maxTextWidth) {
                title = title.slice(0, -1);
            }
            title += '…';
        }
        ctx.fillStyle = titleColor[status] || titleColor.unwatched;
        ctx.fillText(title, textX, centerY);

        if (status === 'watched') {
            const textWidth = Math.min(ctx.measureText(title).width, maxTextWidth);
            ctx.strokeStyle = 'rgba(123, 154, 60, 0.5)';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(textX, centerY);
            ctx.lineTo(textX + textWidth, centerY);
            ctx.stroke();
        }
        ctx.restore();
    },

    legacyDrawTextCell(ctx, x, y, w, h, movie, status) {
        const radius = 10;

        ctx.save();
        this.canvasHelper.drawRoundRectPath(x, y, w, h, radius);
        const styles = {
            watched: { bg: ['rgba(225, 230, 209, 0.92)', 'rgba(225, 230, 209, 0.56)'], stroke: 'rgba(154, 171, 101, 0.32)' },
            wish: { bg: ['rgba(254, 239, 191, 0.92)', 'rgba(254, 239, 191, 0.56)'], stroke: 'rgba(212, 168, 40, 0.32)' },
            unwatched: { bg: ['rgba(242, 240, 234, 0.92)', 'rgba(242, 240, 234, 0.56)'], stroke: 'rgba(156, 153, 143, 0.18)' }
        };
        const style = styles[status] || styles.unwatched;
        const grad = ctx.createLinearGradient(x, y, x, y + h);
        grad.addColorStop(0, style.bg[0]);
        grad.addColorStop(1, style.bg[1]);
        ctx.fillStyle = grad;
        ctx.fill();
        ctx.strokeStyle = style.stroke;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();

        // 排名（上半部分）
        const rankText = movie.rank ? `No.${movie.rank}` : '';
        ctx.save();
        ctx.font = '400 14px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const rankColors = { watched: 'rgba(154, 171, 101, 0.72)', wish: 'rgba(212, 168, 40, 0.72)', unwatched: 'rgba(156, 153, 143, 0.88)' };
        ctx.fillStyle = rankColors[status] || rankColors.unwatched;
        ctx.fillText(rankText, x + w / 2, y + h * 0.3);
        ctx.restore();

        // 电影名（下半部分）
        ctx.save();
        const titleColors = { watched: '#7B9A3C', wish: '#C4862D', unwatched: '#7F7A70' };
        ctx.fillStyle = titleColors[status] || titleColors.unwatched;
        ctx.font = status === 'wish' ? '600 16px sans-serif' : '500 16px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        let title = movie.title;
        const maxTitleW = w - 10;
        if (ctx.measureText(title).width > maxTitleW) {
            while (title.length > 1 && ctx.measureText(title + '…').width > maxTitleW) {
                title = title.slice(0, -1);
            }
            title += '…';
        }
        ctx.fillText(title, x + w / 2, y + h * 0.65);

        if (status === 'watched') {
            const textWidth = ctx.measureText(title).width;
            ctx.strokeStyle = 'rgba(123, 154, 60, 0.45)';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(x + (w - textWidth) / 2, y + h * 0.65);
            ctx.lineTo(x + (w + textWidth) / 2, y + h * 0.65);
            ctx.stroke();
        }
        ctx.restore();
    },

    _drawTextCell(ctx, x, y, w, h, movie, status) {
        const rankText = movie.rank ? `${movie.rank}` : '';
        const statusTheme = {
            watched: {
                rank: 'rgba(154, 171, 101, 0.6)',
                title: '#6B8A2E',
                boxFill: 'rgba(225, 230, 209, 0.85)',
                boxStroke: 'rgba(154, 171, 101, 0.25)'
            },
            wish: {
                rank: 'rgba(212, 168, 40, 0.6)',
                title: '#B8842A',
                boxFill: 'rgba(254, 239, 191, 0.85)',
                boxStroke: 'rgba(212, 168, 40, 0.25)'
            },
            unwatched: {
                rank: 'rgba(156, 153, 143, 0.55)',
                title: '#7F7A70',
                boxFill: 'rgba(242, 240, 234, 0.85)',
                boxStroke: 'rgba(156, 153, 143, 0.15)'
            }
        };
        const theme = statusTheme[status] || statusTheme.unwatched;

        ctx.save();
        // 背景圆角卡片
        const boxInset = 2;
        const boxX = x + boxInset;
        const boxW = w - boxInset * 2;
        const boxH = h - 2;
        const boxY = y + 1;
        ctx.fillStyle = theme.boxFill;
        this.canvasHelper.drawRoundRectPath(boxX, boxY, boxW, boxH, 10);
        ctx.fill();
        ctx.strokeStyle = theme.boxStroke;
        ctx.lineWidth = 0.8;
        ctx.stroke();

        // 排名（左上小字）
        ctx.fillStyle = theme.rank;
        ctx.font = '500 13px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(rankText, x + w / 2, y + h * 0.28);

        // 电影名（居中主体）
        let title = movie.title;
        ctx.font = '600 17px sans-serif';
        const maxTitleW = boxW - 12;
        if (ctx.measureText(title).width > maxTitleW) {
            while (title.length > 1 && ctx.measureText(title + '…').width > maxTitleW) {
                title = title.slice(0, -1);
            }
            title += '…';
        }
        const titleWidth = Math.min(ctx.measureText(title).width, maxTitleW);
        const titleY = y + h * 0.65;
        ctx.fillStyle = theme.title;
        ctx.fillText(title, x + w / 2, titleY);

        // 已看划线
        if (status === 'watched') {
            ctx.strokeStyle = 'rgba(107, 138, 46, 0.4)';
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.moveTo(x + (w - titleWidth) / 2, titleY);
            ctx.lineTo(x + (w + titleWidth) / 2, titleY);
            ctx.stroke();
        }
        ctx.restore();
    },

    drawFooter(lastMovieY) {
        const ctx = this.canvasHelper.ctx;
        const { width, height } = this.data.canvasSize;

        const footerY = lastMovieY
            ? Math.min(lastMovieY + 40, height - 44)
            : height - 44;

        ctx.save();
        ctx.fillStyle = 'rgba(45, 45, 43, 0.72)';
        ctx.font = '600 20px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('搜索小程序：标记吧，免费制作同款图片', width / 2, footerY);
        ctx.restore();

        return footerY + 30;
    },

    async exportAndSaveImage() {
        const canvas = this.canvasHelper.canvas;
        const { canvasSize } = this.data;
        if (!canvas) throw new Error('Canvas未初始化');

        await this.requestSavePermission();
        const dpr = canvasSize.width > 750 ? 1 : (wx.getWindowInfo().pixelRatio || 1);
        const tempFilePath = await new Promise((resolve, reject) => {
            setTimeout(() => {
                wx.canvasToTempFilePath({
                    canvas,
                    x: 0, y: 0,
                    width: canvasSize.width,
                    height: canvasSize.height,
                    destWidth: canvasSize.width * dpr,
                    destHeight: canvasSize.height * dpr,
                    fileType: 'jpg',
                    quality: 0.92,
                    success: res => resolve(res.tempFilePath),
                    fail: err => reject(new Error('生成图片失败: ' + (err.errMsg || '未知错误')))
                }, this);
            }, 300);
        });

        await new Promise((resolve, reject) => {
            wx.saveImageToPhotosAlbum({
                filePath: tempFilePath,
                success: resolve,
                fail: (err) => {
                    if (err.errMsg && err.errMsg.includes('auth deny')) {
                        reject(new Error('需要授权保存图片到相册'));
                    } else {
                        reject(new Error('保存失败: ' + (err.errMsg || '未知错误')));
                    }
                }
            });
        });
    },

    async requestSavePermission() {
        try {
            const authSetting = await new Promise((resolve, reject) => {
                wx.getSetting({ success: (res) => resolve(res.authSetting), fail: reject });
            });
            if (authSetting['scope.writePhotosAlbum']) return true;
            await new Promise((resolve, reject) => {
                wx.authorize({
                    scope: 'scope.writePhotosAlbum', success: resolve,
                    fail: (err) => {
                        if (err.errMsg && err.errMsg.includes('auth deny')) {
                            wx.showModal({
                                title: '需要授权', content: '请在设置中允许访问相册', confirmText: '去设置',
                                success: (res) => { if (res.confirm) wx.openSetting(); }
                            });
                            reject(new Error('用户拒绝授权'));
                        } else { reject(err); }
                    }
                });
            });
            return true;
        } catch (err) {
            console.error('请求权限失败:', err);
            throw err;
        }
    },

    // ========== 广告 ==========
    initAds() {
        if (this.data.adUnitIds.share_banner) {
            this.setData({ showBannerAd: true });
        }
    },
    onBannerAdLoad() {
        this.setData({ showBannerAd: true });
    },
    onBannerAdError() {
        this.setData({ showBannerAd: false });
    },

    onShareAppMessage() {
        return {
            title: '我的全球电影票房榜观影海报',
            path: '/pages/boxoffice/list/list'
        };
    },

    onUnload() {
        wx.hideLoading();
        if (this.data.isGenerating) {
            this.setData({ isGenerating: false });
        }
        if (this.canvasHelper) this.canvasHelper.clearCache();
    }
});
