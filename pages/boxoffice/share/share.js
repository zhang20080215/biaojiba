// pages/boxoffice/share/share.js - 全球电影票房榜海报生成页
const CanvasHelper = require('../../../utils/canvasHelper.js');
const DataLoader = require('../../../utils/dataLoader.js');
const BoxofficeLoader = require('../../../utils/boxofficeLoader.js');
const BoxofficePosterDrawer = require('../../../utils/boxofficePosterDrawer.js');

const TITLE = '全球电影票房榜观影海报墙';

Page({
    data: {
        userInfo: { nickName: '昵称', avatarUrl: '' },
        allMovies: [],
        watchedMovies: [],
        markStatusMap: {},
        stats: { watched: 0, wish: 0, unwatched: 0 },
        shareType: 'text',
        canvasSize: { width: 1242, height: 1660 },
        loadProgress: 0,
        isGenerating: false
    },

    canvasHelper: null,
    posterDrawer: null,

    async onLoad(options) {
        try {
            const shareType = options.type || 'text';
            this.setData({ shareType });
            await this.loadUserInfo();
            await this.loadData();
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
            this.posterDrawer = new BoxofficePosterDrawer(this.canvasHelper);
            resolve();
        } catch (err) {
            reject(new Error('Canvas设置失败: ' + err.message));
        }
    },

    async loadData() {
        try {
            wx.showLoading({ title: '加载数据中...' });
            const db = wx.cloud.database();
            const openid = this.data.userInfo && this.data.userInfo._openid ? this.data.userInfo._openid : '';

            const [allMovies, allMarks] = await Promise.all([
                BoxofficeLoader.loadMovies(db),
                openid ? DataLoader.loadMarks(db, openid) : Promise.resolve([])
            ]);

            const { markStatusMap, stats, watchedMovies } = DataLoader.processMarks(allMarks, allMovies);
            this.setData({ allMovies, markStatusMap, stats, watchedMovies });
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

        try {
            this.setData({ isGenerating: true });
            wx.showLoading({ title: '生成图片中...', mask: true });
            await this.startDrawing();
            await this.exportAndSaveImage();
            wx.showToast({ title: '保存成功', icon: 'success' });
        } catch (err) {
            console.error('保存图片失败:', err);
            wx.showModal({ title: '保存失败', content: err.message || '图片生成失败,请重试', showCancel: false });
        } finally {
            this.setData({ isGenerating: false });
            wx.hideLoading();
        }
    },

    async startDrawing() {
        this.canvasHelper.clear();
        if (this.data.shareType === 'poster') {
            await this.drawPosterWall();
        } else {
            await this.drawTextCard();
        }
    },

    async drawPosterWall() {
        const { width, height } = this.data.canvasSize;
        const padding = 60;
        const colsPerRow = 12;
        const gap = 12;
        const availableWidth = width - padding * 2;
        const posterWidth = Math.floor((availableWidth - gap * (colsPerRow - 1)) / colsPerRow);
        const posterHeight = Math.floor(posterWidth * 1.4);

        const startY = 120;
        const posterAreaStartY = startY + 160;
        const actualMoviesCount = this.data.watchedMovies.length;
        const actualRows = Math.ceil(actualMoviesCount / colsPerRow);
        const neededHeight = posterAreaStartY + actualRows * (posterHeight + gap) + padding + 40;

        if (neededHeight > height) {
            const newHeight = Math.min(neededHeight + 100, 5000);
            const sysInfo = wx.getWindowInfo();
            const dpr = this.data.canvasSize.width > 750 ? 1 : sysInfo.pixelRatio || 1;
            const canvas = this.canvasHelper.canvas;
            const ctx = this.canvasHelper.ctx;
            canvas.height = newHeight * dpr;
            ctx.scale(dpr, dpr);
            this.canvasHelper.canvasSize = { width, height: newHeight };
            this.setData({ canvasSize: { width, height: newHeight } });
        }

        this.drawCardBackground();

        const ctx = this.canvasHelper.ctx;
        ctx.fillStyle = '#2c3e50';
        ctx.font = '600 36px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(TITLE, width / 2, startY);
        this.drawStats(ctx, padding, startY + 60, width - padding * 2);

        const updateProgress = (progress) => {
            wx.showLoading({ title: `生成中${progress}%`, mask: true });
        };

        await this.posterDrawer.drawPosterWall(this.data.watchedMovies, this.data.canvasSize, updateProgress);
        this.drawFooter(null);
    },

    async drawTextCard() {
        this.drawCardBackground();
        const changed = await this.drawMovieList(false);
        if (changed) {
            this.drawCardBackground();
            await this.drawMovieList(true);
        }
    },

    drawCardBackground() {
        const ctx = this.canvasHelper.ctx;
        const { width, height } = this.data.canvasSize;
        const gradient = ctx.createLinearGradient(0, 0, width, height);
        gradient.addColorStop(0, '#fff0f0');
        gradient.addColorStop(0.5, '#fff8e1');
        gradient.addColorStop(1, '#fff0f5');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);
    },

    async drawMovieList(skipAdjust = false) {
        const ctx = this.canvasHelper.ctx;
        const { width } = this.data.canvasSize;
        const padding = 60;
        const startY = 120;
        const maxWidth = width - padding * 2;

        ctx.fillStyle = '#2c3e50';
        ctx.font = '600 36px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(TITLE, width / 2, startY);

        this.drawStats(ctx, padding, startY + 60, maxWidth);
        const lastMovieY = this.drawMovieTags(ctx, padding, startY + 160, maxWidth);
        this.drawFooter(lastMovieY);

        if (!skipAdjust) return false;
        return false;
    },

    drawStats(ctx, startX, startY, maxWidth) {
        const { stats } = this.data;
        const statItems = [
            { label: '已看', value: stats.watched, color: '#4CAF50' },
            { label: '想看', value: stats.wish, color: '#FFA502' },
            { label: '未看', value: stats.unwatched, color: '#9E9E9E' }
        ];

        const itemWidth = 160;
        const itemHeight = 50;
        const gap = 30;
        const totalWidth = statItems.length * itemWidth + (statItems.length - 1) * gap;
        const startXCentered = startX + (maxWidth - totalWidth) / 2;

        statItems.forEach((item, index) => {
            const itemX = startXCentered + index * (itemWidth + gap);
            const itemY = startY;

            const gradient = ctx.createLinearGradient(itemX, itemY, itemX + itemWidth, itemY + itemHeight);
            const colors = {
                '已看': ['rgba(76, 175, 80, 0.12)', 'rgba(76, 175, 80, 0.08)'],
                '想看': ['rgba(255, 165, 2, 0.12)', 'rgba(255, 165, 2, 0.08)'],
                '未看': ['rgba(158, 158, 158, 0.12)', 'rgba(158, 158, 158, 0.08)']
            };
            gradient.addColorStop(0, colors[item.label][0]);
            gradient.addColorStop(1, colors[item.label][1]);
            ctx.fillStyle = gradient;
            this.canvasHelper.drawRoundRectPath(itemX, itemY, itemWidth, itemHeight, 12);
            ctx.fill();

            ctx.strokeStyle = item.color + '33';
            ctx.lineWidth = 1;
            this.canvasHelper.drawRoundRectPath(itemX, itemY, itemWidth, itemHeight, 12);
            ctx.stroke();

            ctx.fillStyle = item.color;
            ctx.font = '500 18px sans-serif';
            ctx.textAlign = 'left';
            const labelText = item.label;
            const valueText = item.value.toString();
            const labelWidth = ctx.measureText(labelText).width;
            const totalTextWidth = labelWidth + ctx.measureText(valueText).width + 10;
            const textStartX = itemX + (itemWidth - totalTextWidth) / 2;
            ctx.fillText(labelText, textStartX, itemY + 32);
            ctx.font = '600 20px sans-serif';
            ctx.fillText(valueText, textStartX + labelWidth + 10, itemY + 32);
        });
    },

    drawMovieTags(ctx, startX, startY, maxWidth) {
        const movies = this.data.allMovies;
        const moviesPerRow = 14;
        const tagHeight = 30;
        const tagSpacing = 8;
        const rowSpacing = 14;
        const minTagWidth = 70;
        const contentPadding = 20;
        const contentMaxWidth = maxWidth - contentPadding * 2;
        const { height } = this.data.canvasSize;
        const footerHeight = 80;
        const availableHeight = height - startY - footerHeight - 60;
        const maxRows = Math.floor(availableHeight / (tagHeight + rowSpacing));
        const maxMovies = maxRows * moviesPerRow;

        let currentX = startX + contentPadding;
        let currentY = startY;
        let moviesInCurrentRow = 0;
        let moviesDrawn = 0;

        for (let i = 0; i < movies.length && moviesDrawn < maxMovies; i++) {
            const movie = movies[i];
            const status = this.data.markStatusMap[movie._id] || 'unwatched';

            ctx.font = '500 18px sans-serif';
            const textWidth = ctx.measureText(movie.title).width;
            const tagWidth = Math.max(minTagWidth, textWidth + 20);

            if (moviesInCurrentRow >= moviesPerRow || currentX + tagWidth > startX + contentPadding + contentMaxWidth) {
                currentX = startX + contentPadding;
                currentY += tagHeight + rowSpacing;
                moviesInCurrentRow = 0;
                if (currentY + tagHeight > height - footerHeight) break;
            }

            this.drawMovieTag(ctx, currentX, currentY, tagWidth, tagHeight, movie.title, status);
            currentX += tagWidth + tagSpacing;
            moviesInCurrentRow++;
            moviesDrawn++;
        }

        if (moviesDrawn < movies.length) {
            const remainingCount = movies.length - moviesDrawn;
            ctx.fillStyle = '#999';
            ctx.font = '18px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(`还有${remainingCount}部电影...`, startX + contentMaxWidth / 2, currentY + tagHeight + 20);
        }
        return currentY + tagHeight;
    },

    drawMovieTag(ctx, x, y, width, height, title, status) {
        this.drawMovieTagBackground(ctx, x, y, width, height, status);
        this.drawMovieTagText(ctx, x, y, width, height, title, status);
    },

    drawMovieTagBackground(ctx, x, y, width, height, status) {
        ctx.save();
        this.canvasHelper.drawRoundRectPath(x, y, width, height, height / 2);
        const styles = {
            watched: { gradient: ['rgba(76, 175, 80, 0.15)', 'rgba(76, 175, 80, 0.08)'], stroke: 'rgba(76, 175, 80, 0.3)' },
            wish: { gradient: ['rgba(255, 165, 2, 0.2)', 'rgba(255, 165, 2, 0.12)'], stroke: 'rgba(255, 165, 2, 0.4)' },
            unwatched: { gradient: ['rgba(158, 158, 158, 0.12)', 'rgba(158, 158, 158, 0.06)'], stroke: 'rgba(158, 158, 158, 0.3)' }
        };
        const style = styles[status] || styles.unwatched;
        const gradient = ctx.createLinearGradient(x, y, x + width, y + height);
        gradient.addColorStop(0, style.gradient[0]);
        gradient.addColorStop(1, style.gradient[1]);
        ctx.fillStyle = gradient;
        ctx.fill();
        ctx.strokeStyle = style.stroke;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();
    },

    drawMovieTagText(ctx, x, y, width, height, title, status) {
        ctx.save();
        ctx.font = '500 18px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const colors = { watched: '#4CAF50', wish: '#FFA502', unwatched: '#9E9E9E' };
        ctx.fillStyle = colors[status] || colors.unwatched;
        if (status === 'wish') ctx.font = '600 18px sans-serif';
        ctx.fillText(title, x + width / 2, y + height / 2);
        if (status === 'watched') {
            ctx.strokeStyle = '#4CAF50';
            ctx.lineWidth = 2;
            const textY = y + height / 2;
            const textWidth = ctx.measureText(title).width;
            ctx.beginPath();
            ctx.moveTo(x + (width - textWidth) / 2, textY);
            ctx.lineTo(x + (width + textWidth) / 2, textY);
            ctx.stroke();
        }
        ctx.restore();
    },

    drawFooter(lastMovieY) {
        const ctx = this.canvasHelper.ctx;
        const { width, height } = this.data.canvasSize;

        const footerY = lastMovieY
            ? Math.min(lastMovieY + 40, height - 40)
            : height - 40;

        ctx.save();
        ctx.font = '400 22px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = 'rgba(80, 80, 80, 0.85)';
        ctx.fillText('搜索小程序：标记吧  免费制作同款图片', width / 2, footerY);
        ctx.restore();

        return footerY + 30;
    },

    adjustCanvasHeight(actualHeight) {
        const canvas = this.canvasHelper.canvas;
        const ctx = this.canvasHelper.ctx;
        const { width } = this.data.canvasSize;
        const newHeight = Math.min(actualHeight + 50, 2500);
        if (newHeight !== this.data.canvasSize.height) {
            const sysInfo = wx.getWindowInfo();
            const dpr = width > 750 ? 1 : sysInfo.pixelRatio || 1;
            canvas.width = width * dpr;
            canvas.height = newHeight * dpr;
            ctx.scale(dpr, dpr);
            this.canvasHelper.canvasSize = { width, height: newHeight };
            this.setData({ canvasSize: { width, height: newHeight } });
            return true;
        }
        return false;
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

    onUnload() {
        if (this.canvasHelper) this.canvasHelper.clearCache();
    }
});
