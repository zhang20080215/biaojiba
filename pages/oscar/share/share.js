// pages/oscar/share/share.js - Oscar 海报生成页
const CanvasHelper = require('../../../utils/canvasHelper.js');
const DataLoader = require('../../../utils/dataLoader.js');
const OscarPosterDrawer = require('../../../utils/oscarPosterDrawer.js');
var adConfig = require('../../../utils/adConfig');
const rewardedSaveGate = require('../../../utils/rewardedSaveGate.js');

Page({
    data: {
        userInfo: { nickName: '昵称', avatarUrl: '' },
        allMovies: [],
        watchedMovies: [],
        markStatusMap: {},
        stats: { watched: 0, wish: 0, unwatched: 0 },
        shareType: 'wall',
        canvasSize: { width: 1242, height: 1660 },
        loadProgress: 0,
        isGenerating: false,
        needRewardedAd: false,
        showBannerAd: false,
        adUnitIds: {
            share_banner: adConfig.getAdUnitId('share_banner') || '',
        },
    },

    canvasHelper: null,
    posterDrawer: null,

    async onLoad(options) {
        try {
            wx.setNavigationBarTitle({ title: '奥斯卡最佳影片海报' });
            const shareType = options.type || 'wall';
            this.setData({ shareType });
            await this.loadUserInfo();
            await this.loadData();
            this.initAds();
            rewardedSaveGate.refreshHint(this);
        } catch (err) {
            console.error('页面加载失败:', err);
            wx.showModal({ title: '加载失败', content: err.message || '请重试', showCancel: false });
        }
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
            ctx.scale(dpr, dpr);

            this.canvasHelper = new CanvasHelper(canvas, ctx, this.data.canvasSize);
            this.posterDrawer = new OscarPosterDrawer(this.canvasHelper);
            resolve();
        } catch (err) {
            reject(new Error('Canvas设置失败: ' + err.message));
        }
    },

    async loadData() {
        try {
            wx.showLoading({ title: '加载数据中...' });
            const openid = this.data.userInfo && this.data.userInfo._openid ? this.data.userInfo._openid : '';
            const { movies, marks } = await DataLoader.loadMoviesData('oscar', openid, false);
            const { markStatusMap, stats, watchedMovies } = DataLoader.processMarks(marks, movies);
            this.setData({ allMovies: movies, markStatusMap, stats, watchedMovies });
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
    //  电影墙模式 — 全部97部海报 + 状态蒙层 + 片名
    //  核心：加载与绘制分离，避免 ctx.clip 并发交叉污染
    // ════════════════════════════════════════
    async drawMovieWall() {
        const ctx = this.canvasHelper.ctx;
        const { width, height } = this.data.canvasSize; // 1242 × 1660

        // ── 布局参数 ──
        const cols = 11;
        const padding = 30;
        const colGap = 5;
        const rowGap = 5;
        const headerTitleY = 80;
        const statsY = 160;
        const gridStartY = 230;
        const footerHeight = 75;
        const gridEndY = height - footerHeight;
        const availableW = width - padding * 2;
        const availableH = gridEndY - gridStartY;

        const movies = this.data.allMovies;
        const rows = Math.ceil(movies.length / cols);
        const posterW = Math.floor((availableW - (cols - 1) * colGap) / cols);
        const posterH = Math.floor((availableH - (rows - 1) * rowGap) / rows);

        // ── 背景 + Header + Stats（含图例图标） ──
        this.drawCardBackground();
        this.drawCanvasHeader(ctx, width, headerTitleY);
        this.drawStats(ctx, padding + 20, statsY, width - (padding + 20) * 2, true);

        // ── Phase 1: 批量预加载所有图片（异步并发） ──
        wx.showLoading({ title: '加载图片中...', mask: true });
        const imageMap = await this._preloadWallImages(movies);

        // ── Phase 2: 同步逐个绘制（无并发，ctx 状态安全） ──
        for (let i = 0; i < movies.length; i++) {
            const movie = movies[i];
            const row = Math.floor(i / cols);
            const col = i % cols;
            const x = padding + col * (posterW + colGap);
            const y = gridStartY + row * (posterH + rowGap);
            const status = this.data.markStatusMap[movie._id] || 'unwatched';
            const imgObj = imageMap[movie._id] || null;
            this._drawWallCellSync(movie, x, y, posterW, posterH, status, imgObj);

            // 每 11 个更新进度
            if (i % 11 === 10) {
                wx.showLoading({ title: `绘制中${Math.floor(((i + 1) / movies.length) * 100)}%`, mask: true });
            }
        }

        // ── Footer ──
        this.drawFooter(gridEndY);
    },

    // 批量预加载全部电影图片，返回 { movieId: imageObj }
    async _preloadWallImages(movies) {
        const imageMap = {};

        // 1) 批量获取 cloud:// 临时 URL（一次 API 调用）
        const cloudEntries = [];
        const urlMap = {}; // movieId -> finalUrl
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
            // getTempFileURL 每次最多 50 个，需分批
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

        // 2) 分批并发加载图片对象
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

    // 纯同步绘制单个电影墙格子（无 await，ctx 状态安全）
    _drawWallCellSync(movie, x, y, w, h, status, imgObj) {
        const ctx = this.canvasHelper.ctx;
        const radius = 6;

        // 1) clip 到圆角矩形 + 底色
        ctx.save();
        this.canvasHelper.drawRoundRectPath(x, y, w, h, radius);
        ctx.clip();

        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(x, y, w, h);

        // 2) 海报图片
        if (imgObj) {
            try {
                ctx.drawImage(imgObj, x, y, w, h);
            } catch (e) {
                // drawImage 失败，保持底色
            }
        } else {
            // 占位符
            ctx.fillStyle = '#2a2a2a';
            ctx.fillRect(x, y, w, h);
            ctx.fillStyle = 'rgba(212, 175, 55, 0.4)';
            ctx.font = '20px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('🏆', x + w / 2, y + h / 2 - 8);
        }

        // 3) 状态蒙层
        if (status === 'watched') {
            const overlay = ctx.createLinearGradient(x, y, x, y + h);
            overlay.addColorStop(0, 'rgba(212, 175, 55, 0.05)');
            overlay.addColorStop(1, 'rgba(212, 175, 55, 0.12)');
            ctx.fillStyle = overlay;
            ctx.fillRect(x, y, w, h);
        } else if (status === 'wish') {
            const overlay = ctx.createLinearGradient(x, y, x, y + h);
            overlay.addColorStop(0, 'rgba(255, 193, 7, 0.05)');
            overlay.addColorStop(1, 'rgba(255, 193, 7, 0.10)');
            ctx.fillStyle = overlay;
            ctx.fillRect(x, y, w, h);
        } else {
            ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
            ctx.fillRect(x, y, w, h);
        }

        // 4) 底部文字渐变遮罩
        const textGradH = h * 0.38;
        const textGrad = ctx.createLinearGradient(x, y + h - textGradH, x, y + h);
        textGrad.addColorStop(0, 'rgba(0, 0, 0, 0)');
        textGrad.addColorStop(0.5, 'rgba(0, 0, 0, 0.5)');
        textGrad.addColorStop(1, 'rgba(0, 0, 0, 0.85)');
        ctx.fillStyle = textGrad;
        ctx.fillRect(x, y + h - textGradH, w, textGradH);

        // 5) 电影名
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

        // 6) 状态角标
        if (status === 'watched') {
            this._drawStatusBadge(ctx, x + w - 2, y + 2, '✓', 'rgba(212, 175, 55, 0.9)');
        } else if (status === 'wish') {
            this._drawStatusBadge(ctx, x + w - 2, y + 2, '♡', 'rgba(255, 193, 7, 0.9)');
        }

        ctx.restore();

        // 7) 已看/想看边框（restore 后绘制，不受 clip 限制）
        if (status === 'watched') {
            ctx.save();
            ctx.strokeStyle = 'rgba(212, 175, 55, 0.45)';
            ctx.lineWidth = 1.5;
            this.canvasHelper.drawRoundRectPath(x, y, w, h, radius);
            ctx.stroke();
            ctx.restore();
        } else if (status === 'wish') {
            ctx.save();
            ctx.strokeStyle = 'rgba(255, 193, 7, 0.4)';
            ctx.lineWidth = 1;
            this.canvasHelper.drawRoundRectPath(x, y, w, h, radius);
            ctx.stroke();
            ctx.restore();
        }
    },

    // 绘制状态角标（在 clip 内调用）
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
        const headerHeight = 100;

        this.drawCardBackground();
        this.drawCanvasHeader(ctx, width, headerHeight);
        this.drawStats(ctx, 60, headerHeight + 30, width - 120);

        const updateProgress = (progress) => {
            wx.showLoading({ title: `生成中${progress}%`, mask: true });
        };
        await this.posterDrawer.drawPosterWall(this.data.watchedMovies, this.data.canvasSize, updateProgress);
        this.drawFooter(height - 60);
    },

    // ════════════════════════════════════════
    //  文字海报模式 — 6列×17行 规则网格
    // ════════════════════════════════════════
    async drawTextCard() {
        const ctx = this.canvasHelper.ctx;
        const { width, height } = this.data.canvasSize; // 1242 × 1660

        // 布局
        const headerTitleY = 80;
        const statsY = 155;
        const gridStartY = 225;
        const footerHeight = 75;
        const gridEndY = height - footerHeight;
        const padding = 30;

        this.drawCardBackground();
        this.drawCanvasHeader(ctx, width, headerTitleY);
        this.drawStats(ctx, padding + 20, statsY, width - (padding + 20) * 2);
        this.drawMovieGrid(ctx, padding, gridStartY, width - padding * 2, gridEndY - gridStartY);
        this.drawFooter(gridEndY);
    },

    // ════════════════════════════════════════
    //  公共绘制组件
    // ════════════════════════════════════════

    // ─── 背景 ───
    drawCardBackground() {
        const ctx = this.canvasHelper.ctx;
        const { width, height } = this.data.canvasSize;

        const gradient = ctx.createLinearGradient(0, 0, 0, height);
        gradient.addColorStop(0, '#0a0a0a');
        gradient.addColorStop(0.3, '#151515');
        gradient.addColorStop(0.7, '#131313');
        gradient.addColorStop(1, '#0d0d0d');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);

        // 顶部聚光灯光晕
        ctx.save();
        const spotRadius = width * 0.6;
        const spotGrad = ctx.createRadialGradient(width / 2, 0, 0, width / 2, 0, spotRadius);
        spotGrad.addColorStop(0, 'rgba(212, 175, 55, 0.08)');
        spotGrad.addColorStop(0.5, 'rgba(212, 175, 55, 0.03)');
        spotGrad.addColorStop(1, 'rgba(212, 175, 55, 0)');
        ctx.fillStyle = spotGrad;
        ctx.fillRect(0, 0, width, spotRadius);
        ctx.restore();

        // 顶部 & 底部金色装饰边
        this.drawGoldLine(ctx, 0, width);
        this.drawGoldLine(ctx, height - 4, width);
    },

    // ─── 程序化绘制小金人图标 ───
    _drawOscarIcon(ctx, x, y, w, h) {
        ctx.save();
        const cx = x + w / 2;
        const scaleX = w / 28;
        const scaleY = h / 42;

        // 金色渐变
        const grad = ctx.createLinearGradient(x, y, x, y + h);
        grad.addColorStop(0, '#f5d98a');
        grad.addColorStop(0.5, '#d4af37');
        grad.addColorStop(1, '#b8960c');
        ctx.fillStyle = grad;

        // 头部
        ctx.beginPath();
        ctx.arc(cx, y + 5 * scaleY, 3.5 * scaleX, 0, Math.PI * 2);
        ctx.fill();

        // 身体
        ctx.beginPath();
        ctx.moveTo(cx - 3 * scaleX, y + 10 * scaleY);
        ctx.quadraticCurveTo(cx - 4 * scaleX, y + 18 * scaleY, cx - 3.5 * scaleX, y + 24 * scaleY);
        ctx.lineTo(cx + 3.5 * scaleX, y + 24 * scaleY);
        ctx.quadraticCurveTo(cx + 4 * scaleX, y + 18 * scaleY, cx + 3 * scaleX, y + 10 * scaleY);
        ctx.closePath();
        ctx.fill();

        // 左臂
        ctx.beginPath();
        ctx.moveTo(cx - 3 * scaleX, y + 12 * scaleY);
        ctx.quadraticCurveTo(cx - 8 * scaleX, y + 16 * scaleY, cx - 7 * scaleX, y + 18 * scaleY);
        ctx.lineTo(cx - 3 * scaleX, y + 15 * scaleY);
        ctx.closePath();
        ctx.fill();

        // 右臂
        ctx.beginPath();
        ctx.moveTo(cx + 3 * scaleX, y + 12 * scaleY);
        ctx.quadraticCurveTo(cx + 8 * scaleX, y + 16 * scaleY, cx + 7 * scaleX, y + 18 * scaleY);
        ctx.lineTo(cx + 3 * scaleX, y + 15 * scaleY);
        ctx.closePath();
        ctx.fill();

        // 手持物（竖条）
        const barW = 2 * scaleX;
        const barH = 14 * scaleY;
        ctx.fillRect(cx - barW / 2, y + 10 * scaleY, barW, barH);

        // 底座（梯形）
        ctx.beginPath();
        ctx.moveTo(cx - 4 * scaleX, y + 24 * scaleY);
        ctx.lineTo(cx - 5.5 * scaleX, y + 30 * scaleY);
        ctx.lineTo(cx + 5.5 * scaleX, y + 30 * scaleY);
        ctx.lineTo(cx + 4 * scaleX, y + 24 * scaleY);
        ctx.closePath();
        ctx.fill();

        // 基座上层
        const baseW1 = 13 * scaleX;
        const baseH1 = 3 * scaleY;
        ctx.beginPath();
        this.canvasHelper.drawRoundRectPath(cx - baseW1 / 2, y + 30 * scaleY, baseW1, baseH1, 1.5 * scaleX);
        ctx.fill();

        // 基座下层
        const baseW2 = 16 * scaleX;
        const baseH2 = 4 * scaleY;
        ctx.beginPath();
        this.canvasHelper.drawRoundRectPath(cx - baseW2 / 2, y + 33.5 * scaleY, baseW2, baseH2, 2 * scaleX);
        ctx.fill();

        ctx.restore();
    },

    drawGoldLine(ctx, y, width) {
        const grad = ctx.createLinearGradient(0, 0, width, 0);
        grad.addColorStop(0, 'rgba(212, 175, 55, 0)');
        grad.addColorStop(0.25, 'rgba(212, 175, 55, 0.25)');
        grad.addColorStop(0.5, 'rgba(245, 217, 138, 0.5)');
        grad.addColorStop(0.75, 'rgba(212, 175, 55, 0.25)');
        grad.addColorStop(1, 'rgba(212, 175, 55, 0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, y, width, 4);
    },

    // ─── Header（含程序化绘制的小金人图标）───
    drawCanvasHeader(ctx, width, startY) {
        // 标题文字测量
        ctx.font = '800 44px sans-serif';
        const titleText = '历届奥斯卡最佳影片';
        const titleWidth = ctx.measureText(titleText).width;
        const iconW = 28;
        const iconH = 42;
        const iconGap = 14;
        const totalHeaderW = iconW + iconGap + titleWidth;
        const headerStartX = (width - totalHeaderW) / 2;

        // 绘制小金人图标
        this._drawOscarIcon(ctx, headerStartX, startY - 34, iconW, iconH);

        // 主标题
        ctx.fillStyle = '#f5d98a';
        ctx.font = '800 44px sans-serif';
        ctx.textAlign = 'center';
        const titleCenterX = headerStartX + iconW + iconGap + titleWidth / 2;
        ctx.fillText(titleText, titleCenterX, startY);

        // 副标题
        ctx.fillStyle = 'rgba(212, 175, 55, 0.4)';
        ctx.font = '400 20px sans-serif';
        ctx.fillText('Academy Awards · Best Picture', width / 2, startY + 34);

        const lineY = startY + 50;
        const lineGrad = ctx.createLinearGradient(width * 0.15, 0, width * 0.85, 0);
        lineGrad.addColorStop(0, 'rgba(212, 175, 55, 0)');
        lineGrad.addColorStop(0.3, 'rgba(212, 175, 55, 0.35)');
        lineGrad.addColorStop(0.5, 'rgba(245, 217, 138, 0.55)');
        lineGrad.addColorStop(0.7, 'rgba(212, 175, 55, 0.35)');
        lineGrad.addColorStop(1, 'rgba(212, 175, 55, 0)');
        ctx.fillStyle = lineGrad;
        ctx.fillRect(width * 0.1, lineY, width * 0.8, 2);
    },

    // ─── 统计栏（showIcon=true 时在标签前绘制图例小方块）───
    drawStats(ctx, startX, startY, maxWidth, showIcon) {
        const { stats } = this.data;
        const statItems = [
            { label: '已看', value: stats.watched, color: '#e5c05c', iconFill: 'rgba(212, 175, 55, 0.35)', iconStroke: 'rgba(212, 175, 55, 0.7)', badge: '✓', badgeBg: 'rgba(212, 175, 55, 0.9)' },
            { label: '想看', value: stats.wish, color: '#ffd54f', iconFill: 'rgba(255, 193, 7, 0.3)', iconStroke: 'rgba(255, 193, 7, 0.6)', badge: '♡', badgeBg: 'rgba(255, 193, 7, 0.9)' },
            { label: '未看', value: stats.unwatched, color: '#888888', iconFill: 'rgba(0, 0, 0, 0.55)', iconStroke: 'rgba(120, 120, 120, 0.4)', badge: null, badgeBg: null }
        ];

        const itemWidth = showIcon ? 180 : 160;
        const itemHeight = 50;
        const gap = 30;
        const totalWidth = statItems.length * itemWidth + (statItems.length - 1) * gap;
        const startXCentered = startX + (maxWidth - totalWidth) / 2;

        statItems.forEach((item, index) => {
            const itemX = startXCentered + index * (itemWidth + gap);
            const itemY = startY;

            // 背景
            const gradient = ctx.createLinearGradient(itemX, itemY, itemX + itemWidth, itemY + itemHeight);
            const bgColors = {
                '已看': ['rgba(212, 175, 55, 0.2)', 'rgba(212, 175, 55, 0.08)'],
                '想看': ['rgba(255, 193, 7, 0.2)', 'rgba(255, 193, 7, 0.08)'],
                '未看': ['rgba(158, 158, 158, 0.15)', 'rgba(158, 158, 158, 0.06)']
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

            // 内容：图标 + 标签 + 数值
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

            // 图例小方块
            if (showIcon) {
                const iconY = textY - iconSize + 2;
                ctx.fillStyle = item.iconFill;
                ctx.fillRect(curX, iconY, iconSize, iconSize);
                ctx.strokeStyle = item.iconStroke;
                ctx.lineWidth = 1;
                ctx.strokeRect(curX, iconY, iconSize, iconSize);

                // 角标
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

            // 标签
            ctx.fillStyle = item.color;
            ctx.font = '500 18px sans-serif';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'alphabetic';
            ctx.fillText(labelText, curX, textY);
            curX += labelWidth + textGap;

            // 数值
            ctx.font = '600 20px sans-serif';
            ctx.fillText(valueText, curX, textY);
        });
    },

    // ─── 文字海报：6列×17行规则网格 ───
    drawMovieGrid(ctx, startX, startY, availW, availH) {
        const movies = this.data.allMovies;
        const cols = 6;
        const rows = 17;
        const colGap = 10;
        const rowGap = Math.floor((availH - rows * 1) / rows); // 先算cellH

        const cellW = Math.floor((availW - (cols - 1) * colGap) / cols);
        // 精确计算：把 availH 分配给 rows 个 cell + (rows-1) 个 gap
        const gap = 10;
        const cellH = Math.floor((availH - (rows - 1) * gap) / rows);
        // 居中修正
        const totalH = rows * cellH + (rows - 1) * gap;
        const totalW = cols * cellW + (cols - 1) * colGap;
        const offsetX = startX + (availW - totalW) / 2;
        const offsetY = startY + (availH - totalH) / 2;

        for (let i = 0; i < movies.length; i++) {
            const movie = movies[i];
            const row = Math.floor(i / cols);
            const col = i % cols;
            const x = offsetX + col * (cellW + colGap);
            const y = offsetY + row * (cellH + gap);
            const status = this.data.markStatusMap[movie._id] || 'unwatched';
            this._drawTextCell(ctx, x, y, cellW, cellH, movie, status);
        }
    },

    _drawTextCell(ctx, x, y, w, h, movie, status) {
        const radius = 10;

        // 背景
        ctx.save();
        this.canvasHelper.drawRoundRectPath(x, y, w, h, radius);
        const styles = {
            watched: { bg: ['rgba(212, 175, 55, 0.22)', 'rgba(212, 175, 55, 0.08)'], stroke: 'rgba(212, 175, 55, 0.4)' },
            wish: { bg: ['rgba(255, 193, 7, 0.20)', 'rgba(255, 193, 7, 0.08)'], stroke: 'rgba(255, 193, 7, 0.45)' },
            unwatched: { bg: ['rgba(120, 120, 120, 0.14)', 'rgba(120, 120, 120, 0.05)'], stroke: 'rgba(120, 120, 120, 0.22)' }
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

        // 年份（上半部分）
        const yearText = movie.year ? `${movie.year}年` : '';
        ctx.save();
        ctx.font = '400 14px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const yearColors = { watched: 'rgba(212, 175, 55, 0.55)', wish: 'rgba(255, 193, 7, 0.55)', unwatched: 'rgba(180, 180, 180, 0.45)' };
        ctx.fillStyle = yearColors[status] || yearColors.unwatched;
        ctx.fillText(yearText, x + w / 2, y + h * 0.30);
        ctx.restore();

        // 电影名（下半部分）
        ctx.save();
        const titleColors = { watched: '#d4af37', wish: '#FFC107', unwatched: '#BDBDBD' };
        const fontWeight = status === 'wish' ? '600' : '500';
        ctx.font = `${fontWeight} 18px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = titleColors[status] || titleColors.unwatched;

        let title = movie.title;
        const maxTextW = w - 14;
        if (ctx.measureText(title).width > maxTextW) {
            while (title.length > 1 && ctx.measureText(title + '…').width > maxTextW) {
                title = title.slice(0, -1);
            }
            title += '…';
        }
        const titleY = y + h * 0.65;
        ctx.fillText(title, x + w / 2, titleY);

        // 已看：删除线
        if (status === 'watched') {
            ctx.strokeStyle = 'rgba(212, 175, 55, 0.5)';
            ctx.lineWidth = 1.5;
            const tw = ctx.measureText(title).width;
            ctx.beginPath();
            ctx.moveTo(x + (w - tw) / 2, titleY);
            ctx.lineTo(x + (w + tw) / 2, titleY);
            ctx.stroke();
        }
        ctx.restore();
    },

    // ─── 底部水印（上下边距对称居中）───
    drawFooter(lastMovieY) {
        const ctx = this.canvasHelper.ctx;
        const { width, height } = this.data.canvasSize;

        const contentEndY = lastMovieY || (height - 75);
        // 水印文字垂直居中于 contentEndY 与画布底部之间
        const footerSpace = height - contentEndY;
        const textCenterY = contentEndY + footerSpace / 2;
        // 金色分割线在文字上方 16px
        const lineY = textCenterY - 16;

        this.drawGoldLine(ctx, lineY, width);

        ctx.save();
        ctx.font = '400 20px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = 'rgba(200, 200, 200, 0.6)';
        ctx.fillText('搜索小程序：标记吧  免费制作同款图片', width / 2, textCenterY + 4);
        ctx.restore();

        return textCenterY + 20;
    },

    async exportAndSaveImage() {
        const canvas = this.canvasHelper.canvas;
        const { canvasSize } = this.data;
        if (!canvas) throw new Error('Canvas未初始化');

        try {
            await this.requestSavePermission();
            const sysInfo = wx.getWindowInfo();
            const dpr = canvasSize.width > 750 ? 1 : sysInfo.pixelRatio || 1;
            const tempFilePath = await new Promise((resolve, reject) => {
                setTimeout(() => {
                    wx.canvasToTempFilePath({
                        canvas, x: 0, y: 0,
                        width: canvasSize.width, height: canvasSize.height,
                        destWidth: canvasSize.width * dpr, destHeight: canvasSize.height * dpr,
                        fileType: 'jpg', quality: 0.9,
                        success: (res) => resolve(res.tempFilePath),
                        fail: (err) => reject(new Error('生成图片失败: ' + (err.errMsg || '未知错误')))
                    }, this);
                }, 500);
            });

            await new Promise((resolve, reject) => {
                wx.saveImageToPhotosAlbum({
                    filePath: tempFilePath,
                    success: () => resolve(),
                    fail: (err) => {
                        if (err.errMsg && err.errMsg.includes('auth deny')) reject(new Error('需要授权保存图片到相册'));
                        else reject(new Error('保存失败: ' + (err.errMsg || '未知错误')));
                    }
                });
            });
        } catch (err) {
            console.error('导出保存流程失败:', err);
            throw err;
        }
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
            title: '我的奥斯卡最佳影片观影海报',
            path: '/pages/oscar/list/list'
        };
    },

    onUnload() {
        if (this.canvasHelper) this.canvasHelper.clearCache();
    }
});
