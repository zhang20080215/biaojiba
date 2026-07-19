// pages/genericBookList/share/share.js —— 通用读书海报生成页（?theme=xxx 决定主题）
// 结构/画布布局算法整体镜像 pages/genericList/share/share.js（电影版：海报墙 + 文字胶囊/列表两种样式、
// CanvasHelper 内联绘制、bgThemes 背景选择、rewardedSaveGate 保存门槛），只做词汇替换：
// watched/wish/unwatched → read/wish/unread，Marks/processMarks → BookMarks/processBookMarks。
const CanvasHelper = require('../../../utils/canvasHelper.js');
const DataLoader = require('../../../utils/dataLoader.js');
var adConfig = require('../../../utils/adConfig');
const rewardedSaveGate = require('../../../utils/rewardedSaveGate.js');
const userStore = require('../../../utils/userStore.js');
var { getThemeConfig } = require('../../../utils/genericBookThemeConfig.js');
// 排序方向按主题不同，见 utils/genericBookThemeConfig.js 的 cfg.orderDirection
function queryOptionsFor(cfg) {
    return { orderByField: 'rank', orderDirection: (cfg && cfg.orderDirection) || 'asc' };
}

const FOOTER_TEXT = '小程序：标记吧，免费制作同款图';
const FIXED_CANVAS_WIDTH = 1242;
const FIXED_CANVAS_HEIGHT = 1660;
// 紧凑画布：文字卡片（胶囊/列表）在图书较少时优先尝试的更小画布——画布本身缩小 + 字号绝对值
// 放大两件事一起做，比只放大字号更"丰满"；3:4 比例（跟每日运动分享卡片同款分辨率一致）
const COMPACT_CANVAS_WIDTH = 1080;
const COMPACT_CANVAS_HEIGHT = 1440;
const MAX_POSTER_CANVAS_HEIGHT = 4200;
const CARD_INNER_PADDING = 56;
const CARD_TITLE_Y = 86;
const CARD_STATS_Y = 138;
const CARD_CONTENT_TOP = 210;
const CARD_BOTTOM_RESERVE = 80;

Page({
    data: {
        userInfo: { nickName: '昵称', avatarUrl: '' },
        allBooks: [],
        readBooks: [],
        markStatusMap: {},
        stats: { read: 0, wish: 0, unread: 0 },
        shareType: 'text',
        textStyle: 'capsule',
        listGridRows: 50,
        canvasSize: { width: FIXED_CANVAS_WIDTH, height: FIXED_CANVAS_HEIGHT },
        isGenerating: false,
        needRewardedAd: false,
        showBannerAd: false,
        statusBarHeight: 20,
        headerPadTop: 0,
        menuBtnHeight: 32,
        theme: '',
        cfg: {},
        activeBgTheme: 'pinkBlue',
        bgThemes: [
            { key: 'pinkBlue', name: '粉蓝', start: '#FDECEC', end: '#D2F1FE' },
            { key: 'goldSand', name: '暖金', start: '#FEEFBF', end: '#F8F3E7' },
            { key: 'greenMist', name: '青雾', start: '#E1E6D1', end: '#EAF0F9' }
        ],
        currentGradient: { start: '#FDECEC', end: '#D2F1FE' },
        posterGridStyle: 'grid-template-columns: repeat(12, 1fr); gap: 6rpx;',
        posterCardStyle: `aspect-ratio: ${FIXED_CANVAS_WIDTH} / ${FIXED_CANVAS_HEIGHT};`,
        uiText: {
            back: '‹',
            pageTitle: '海报预览',
            background: '背景',
            themeCheck: '✓',
            cardTitle: '读书海报',
            watched: '已读',
            wish: '想读',
            unwatched: '未读',
            emptyPoster: '暂无已读图书',
            emptyMovie: '暂无图书数据',
            watermark: '小程序：标记吧，免费制作同款图',
            saving: '生成中...',
            saveButton: '保存图片到相册',
            loadingShare: '正在生成分享图...'
        },
        adUnitIds: {
            share_banner: adConfig.getAdUnitId('share_banner') || ''
        }
    },

    canvasHelper: null,

    async onLoad(options) {
        try {
            const theme = (options && options.theme) || '';
            const cfg = getThemeConfig(theme);
            wx.setNavigationBarTitle({ title: '海报预览' });
            const windowInfo = wx.getWindowInfo();
            const menuBtn = wx.getMenuButtonBoundingClientRect();
            this.setData({
                shareType: options.type || 'text',
                statusBarHeight: windowInfo.statusBarHeight || 20,
                headerPadTop: menuBtn.top,
                menuBtnHeight: menuBtn.height,
                theme,
                cfg,
                'uiText.cardTitle': `${cfg.title}读书海报`
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

    onBack() {
        wx.navigateBack({
            fail: () => {
                wx.reLaunch({ url: `/pages/genericBookList/list/list?theme=${this.data.theme}` });
            }
        });
    },

    onBgThemeTap(e) {
        const key = e.currentTarget.dataset.key;
        const theme = this.data.bgThemes.find(item => item.key === key);
        if (!theme) return;
        this.setData({
            activeBgTheme: theme.key,
            currentGradient: { start: theme.start, end: theme.end }
        });
    },

    onTextStyleTap(e) {
        const style = e.currentTarget.dataset.style;
        if (style) this.setData({ textStyle: style });
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
        const userInfo = userStore.getUserInfo() || { nickName: '昵称', avatarUrl: '' };
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
                    reject(new Error('Canvas节点获取失败'));
                    return;
                }
                this.setupCanvas(res[0].node);
                resolve();
            });
        });
    },

    setupCanvas(canvasNode) {
        const canvas = canvasNode;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('无法获取Canvas 2D上下文');
        const { width, height } = this.data.canvasSize;
        const windowInfo = wx.getWindowInfo();
        const dpr = width > 750 ? 1 : (windowInfo.pixelRatio || 1);
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        if (ctx.setTransform) {
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        } else {
            ctx.scale(dpr, dpr);
        }
        this.canvasHelper = new CanvasHelper(canvas, ctx, { width, height });
    },

    resizeCanvas(width, height) {
        const canvas = this.canvasHelper.canvas;
        const ctx = this.canvasHelper.ctx;
        const windowInfo = wx.getWindowInfo();
        const dpr = width > 750 ? 1 : (windowInfo.pixelRatio || 1);
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

    async loadData() {
        try {
            wx.showLoading({ title: '加载数据中...' });
            const openid = this.data.userInfo && this.data.userInfo._openid ? this.data.userInfo._openid : '';
            const { movies: allBooks, marks: allMarks } = await DataLoader.loadMoviesData(this.data.theme, openid, false, queryOptionsFor(this.data.cfg));
            const { markStatusMap, stats, readBooks } = DataLoader.processBookMarks(allMarks, allBooks);
            const listGridRows = Math.max(1, Math.ceil(allBooks.length / 5));
            this.setData({ allBooks, markStatusMap, stats, readBooks, listGridRows }, () => {
                this.updatePosterPreviewLayout();
            });
            wx.hideLoading();
        } catch (err) {
            console.error('加载数据失败:', err);
            wx.hideLoading();
            wx.showToast({ title: '加载数据失败', icon: 'none', duration: 3000 });
            throw err;
        }
    },

    getPosterLayoutConfig(totalInput) {
        const total = Math.max(0, totalInput == null ? this.data.readBooks.length : totalInput);
        const effectiveTotal = Math.max(1, total);
        const contentWidth = FIXED_CANVAS_WIDTH - CARD_INNER_PADDING * 2;
        const maxCols = Math.min(14, effectiveTotal);
        const buildLayout = (cols) => {
            const rows = Math.ceil(effectiveTotal / cols);
            const gapX = cols >= 14 ? 4 : cols >= 12 ? 5 : cols >= 9 ? 6 : 8;
            const gapY = rows >= 18 ? 4 : rows >= 12 ? 6 : 8;
            const posterWidth = Math.floor((contentWidth - gapX * (cols - 1)) / cols);
            const posterHeight = Math.floor(posterWidth * 1.5);
            const gridHeight = rows * posterHeight + Math.max(0, rows - 1) * gapY;
            const canvasHeight = Math.max(FIXED_CANVAS_HEIGHT, CARD_CONTENT_TOP + gridHeight + CARD_BOTTOM_RESERVE);
            return { cols, rows, gapX, gapY, posterWidth, posterHeight, gridHeight, canvasHeight };
        };
        const layouts = [];

        for (let cols = 1; cols <= maxCols; cols++) {
            layouts.push(buildLayout(cols));
        }

        const withinBaseHeight = layouts.filter(layout => layout.canvasHeight <= FIXED_CANVAS_HEIGHT);
        let chosen;

        if (withinBaseHeight.length) {
            chosen = withinBaseHeight.sort((a, b) => {
                if (b.canvasHeight !== a.canvasHeight) return b.canvasHeight - a.canvasHeight;
                if (b.posterWidth !== a.posterWidth) return b.posterWidth - a.posterWidth;
                return a.cols - b.cols;
            })[0];
        } else {
            chosen = layouts.sort((a, b) => {
                if (a.canvasHeight !== b.canvasHeight) return a.canvasHeight - b.canvasHeight;
                if (b.posterWidth !== a.posterWidth) return b.posterWidth - a.posterWidth;
                return a.cols - b.cols;
            })[0];
        }

        if (chosen.canvasHeight > FIXED_CANVAS_HEIGHT && chosen.cols < maxCols) {
            const denserLayout = buildLayout(maxCols);
            if (denserLayout.canvasHeight < chosen.canvasHeight) {
                chosen = denserLayout;
            }
        }

        if (chosen.canvasHeight > MAX_POSTER_CANVAS_HEIGHT) {
            chosen = { ...chosen, canvasHeight: MAX_POSTER_CANVAS_HEIGHT };
        }

        return chosen;
    },

    updatePosterPreviewLayout() {
        const layout = this.getPosterLayoutConfig();
        this.setData({
            posterGridStyle: `grid-template-columns: repeat(${layout.cols}, 1fr); gap: ${Math.max(4, layout.gapX)}rpx;`,
            posterCardStyle: `aspect-ratio: ${FIXED_CANVAS_WIDTH} / ${layout.canvasHeight};`
        });
    },

    async saveImage() {
        if (this.data.isGenerating) {
            wx.showToast({ title: '正在生成中...', icon: 'none' });
            return;
        }
        if (!this.canvasHelper) {
            wx.showToast({ title: 'Canvas未初始化', icon: 'none' });
            return;
        }

        const hasGrant = await rewardedSaveGate.ensureGrant(this);
        if (!hasGrant) {
            return;
        }

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
            wx.showModal({ title: '保存失败', content: err.message || '图片生成失败，请重试', showCancel: false });
        } finally {
            this.setData({ isGenerating: false });
        }
    },

    // 胶囊尺寸都按同一套比例从字号推导（跟原设计 20/38/16/10/6 的比例一致），
    // 保证「先算最佳字号」和「按字号画图」用的是同一份几何关系。
    capsuleMetricsFor(fontSize) {
        return {
            fontSize,
            textFontSize: Math.round(fontSize * 0.9),
            pillH: Math.round(fontSize * 1.7),
            pillPadX: Math.round(fontSize * 0.8),
            gapX: Math.round(fontSize * 0.5),
            gapY: Math.round(fontSize * 0.45)
        };
    },

    // 用给定字号模拟胶囊流式换行（真实测量文字宽度），算出胶囊堆叠到底部所需的高度
    simulateCapsuleStackHeight(fontSize, maxWidth) {
        const { pillH, pillPadX, gapX, gapY, textFontSize } = this.capsuleMetricsFor(fontSize);
        const books = this.data.allBooks;
        if (!books.length) return pillH;

        const ctx = this.canvasHelper && this.canvasHelper.ctx;
        let measure;
        if (ctx) {
            ctx.save();
            ctx.font = `400 ${textFontSize}px sans-serif`;
            measure = (text) => ctx.measureText(text).width;
        } else {
            measure = (text) => text.length * textFontSize;
        }

        let curX = 0;
        let curY = 0;
        let bottom = pillH;

        books.forEach(book => {
            const textW = measure(book.title);
            const pillW = textW + pillPadX * 2;
            if (curX + pillW > maxWidth && curX > 0) {
                curX = 0;
                curY += pillH + gapY;
            }
            curX += pillW + gapX;
            bottom = curY + pillH;
        });

        if (ctx) ctx.restore();
        return bottom;
    },

    // 在给定画布宽高下，二分查找"胶囊堆叠高度不超过这个画布可用高度"的最大字号（绝对像素）。
    // 找不到（即使 BASE_FONT 都放不下）时返回 null，调用方应换更大的画布尺寸再试。
    searchCapsuleFontForCanvas(canvasWidth, canvasHeight, baseFont, maxFont) {
        const scale = canvasWidth / FIXED_CANVAS_WIDTH;
        const maxWidth = canvasWidth - Math.round(CARD_INNER_PADDING * scale) * 2;
        const targetHeight = canvasHeight - Math.round(CARD_CONTENT_TOP * scale) - Math.round(CARD_BOTTOM_RESERVE * scale);

        const baseHeight = this.simulateCapsuleStackHeight(baseFont, maxWidth);
        if (baseHeight > targetHeight) return null;

        let lo = baseFont;
        let hi = maxFont;
        let best = baseFont;
        while (lo <= hi) {
            const mid = Math.floor((lo + hi) / 2);
            const height = this.simulateCapsuleStackHeight(mid, maxWidth);
            if (height <= targetHeight) {
                best = mid;
                lo = mid + 1;
            } else {
                hi = mid - 1;
            }
        }
        return best;
    },

    // 决定胶囊文字卡片用哪个画布尺寸 + 字号：优先试紧凑画布（1080×1440），连基准字号都放不下
    // 时退回标准画布重新找字号；标准画布基准字号都放不下（书很多）时，维持动态增高兜底
    decideCapsuleLayout() {
        const BASE_FONT = 20;
        const MAX_FONT = 28;

        if (!this.data.allBooks.length) {
            return { width: FIXED_CANVAS_WIDTH, height: FIXED_CANVAS_HEIGHT, fontSize: BASE_FONT };
        }

        const compactFont = this.searchCapsuleFontForCanvas(COMPACT_CANVAS_WIDTH, COMPACT_CANVAS_HEIGHT, BASE_FONT, MAX_FONT);
        if (compactFont != null) {
            return { width: COMPACT_CANVAS_WIDTH, height: COMPACT_CANVAS_HEIGHT, fontSize: compactFont };
        }

        const fullFont = this.searchCapsuleFontForCanvas(FIXED_CANVAS_WIDTH, FIXED_CANVAS_HEIGHT, BASE_FONT, MAX_FONT);
        if (fullFont != null) {
            return { width: FIXED_CANVAS_WIDTH, height: FIXED_CANVAS_HEIGHT, fontSize: fullFont };
        }

        const maxWidth = FIXED_CANVAS_WIDTH - CARD_INNER_PADDING * 2;
        const bottom = this.simulateCapsuleStackHeight(BASE_FONT, maxWidth);
        const estimatedHeight = CARD_CONTENT_TOP + bottom + CARD_BOTTOM_RESERVE;
        return { width: FIXED_CANVAS_WIDTH, height: Math.max(FIXED_CANVAS_HEIGHT, estimatedHeight), fontSize: BASE_FONT };
    },

    async startDrawing() {
        let nextCanvasSize;
        if (this.data.shareType === 'poster') {
            nextCanvasSize = { width: FIXED_CANVAS_WIDTH, height: this.getPosterLayoutConfig().canvasHeight };
        } else if (this.data.textStyle === 'capsule') {
            const decided = this.decideCapsuleLayout();
            nextCanvasSize = { width: decided.width, height: decided.height };
            this._decidedFontSize = decided.fontSize;
        } else {
            const decided = this.decideListLayout();
            nextCanvasSize = { width: decided.width, height: decided.height };
            this._decidedFontSize = decided.fontSize;
            this._decidedColumns = decided.columns;
        }

        if (
            this.data.canvasSize.width !== nextCanvasSize.width ||
            this.data.canvasSize.height !== nextCanvasSize.height
        ) {
            this.resizeCanvas(nextCanvasSize.width, nextCanvasSize.height);
        }

        this.canvasHelper.clear();
        if (this.data.shareType === 'poster') {
            await this.drawPosterWall();
        } else {
            await this.drawTextCard();
        }
    },

    getPalette() {
        const { currentGradient } = this.data;
        return {
            cardStart: currentGradient.start,
            cardEnd: currentGradient.end,
            textPrimary: '#2D2D2B',
            textMuted: '#9C998F',
            statBg: 'rgba(255, 255, 255, 0.42)',
            read: '#9AAB65',
            wish: '#D4A828',
            unread: '#9C998F',
            readBg: 'rgba(225, 230, 209, 0.84)',
            wishBg: 'rgba(254, 239, 191, 0.86)',
            unreadBg: 'rgba(242, 240, 234, 0.84)',
            panelBg: 'rgba(248, 243, 231, 0.84)',
            panelStroke: 'rgba(255, 255, 255, 0.58)',
            divider: 'rgba(255, 255, 255, 0.55)'
        };
    },

    getScale() {
        return this.data.canvasSize.width / FIXED_CANVAS_WIDTH;
    },

    getCardLayout() {
        const { width, height } = this.data.canvasSize;
        const scale = this.getScale();
        const innerPadding = Math.round(CARD_INNER_PADDING * scale);
        return {
            cardX: 0,
            cardY: 0,
            cardWidth: width,
            cardHeight: height,
            innerPadding,
            contentX: innerPadding,
            contentWidth: width - innerPadding * 2,
            titleY: Math.round(CARD_TITLE_Y * scale),
            statsY: Math.round(CARD_STATS_Y * scale),
            contentY: Math.round(CARD_CONTENT_TOP * scale),
            footerY: height - Math.round(44 * scale)
        };
    },

    drawCard() {
        const ctx = this.canvasHelper.ctx;
        const palette = this.getPalette();
        const layout = this.getCardLayout();
        const gradient = ctx.createLinearGradient(0, 0, layout.cardWidth, layout.cardHeight);
        gradient.addColorStop(0, palette.cardStart);
        gradient.addColorStop(1, palette.cardEnd);

        ctx.save();
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, layout.cardWidth, layout.cardHeight);
        ctx.restore();

        return layout;
    },

    drawCardHeader(card) {
        const ctx = this.canvasHelper.ctx;
        const palette = this.getPalette();
        const scale = this.getScale();
        ctx.save();
        ctx.fillStyle = palette.textPrimary;
        ctx.font = `700 ${Math.round(40 * scale)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(this.data.uiText.cardTitle, card.cardX + card.cardWidth / 2, card.titleY);
        ctx.restore();
        this.drawStats(card);
    },

    drawStats(card) {
        const ctx = this.canvasHelper.ctx;
        const palette = this.getPalette();
        const scale = this.getScale();
        const items = [
            { text: `已读 ${this.data.stats.read}`, color: palette.read },
            { text: `想读 ${this.data.stats.wish}`, color: palette.wish },
            { text: `未读 ${this.data.stats.unread}`, color: palette.unread }
        ];
        const gap = Math.round(16 * scale);
        const pillHeight = Math.round(46 * scale);

        ctx.save();
        ctx.font = `500 ${Math.round(24 * scale)}px sans-serif`;
        const widths = items.map(item => Math.ceil(ctx.measureText(item.text).width + Math.round(36 * scale)));
        const totalWidth = widths.reduce((sum, width) => sum + width, 0) + gap * (widths.length - 1);
        let currentX = card.cardX + (card.cardWidth - totalWidth) / 2;

        items.forEach((item, index) => {
            const width = widths[index];
            ctx.fillStyle = palette.statBg;
            this.canvasHelper.drawRoundRectPath(currentX, card.statsY, width, pillHeight, Math.round(23 * scale));
            ctx.fill();
            ctx.strokeStyle = palette.divider;
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.fillStyle = item.color;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(item.text, currentX + width / 2, card.statsY + pillHeight / 2 + 1);
            currentX += width + gap;
        });
        ctx.restore();
    },

    getPosterMetrics(card) {
        const layout = this.getPosterLayoutConfig();
        const usedWidth = layout.cols * layout.posterWidth + Math.max(0, layout.cols - 1) * layout.gapX;
        const startX = card.contentX + Math.floor((card.contentWidth - usedWidth) / 2);
        return {
            ...layout,
            startX,
            startY: card.contentY
        };
    },

    async drawPosterWall() {
        const card = this.drawCard();
        this.drawCardHeader(card);
        const posterMetrics = this.getPosterMetrics(card);
        const books = this.data.readBooks;
        const total = books.length;
        const batchSize = posterMetrics.cols;

        for (let i = 0; i < books.length; i += batchSize) {
            const batch = books.slice(i, i + batchSize);
            await Promise.all(batch.map((book, index) => {
                const globalIndex = i + index;
                const row = Math.floor(globalIndex / posterMetrics.cols);
                const col = globalIndex % posterMetrics.cols;
                const x = posterMetrics.startX + col * (posterMetrics.posterWidth + posterMetrics.gapX);
                const y = posterMetrics.startY + row * (posterMetrics.posterHeight + posterMetrics.gapY);
                return this.drawPosterItem(book, x, y, posterMetrics.posterWidth, posterMetrics.posterHeight);
            }));

            if (total > 0) {
                const progress = Math.floor(((i + batch.length) / total) * 100);
                wx.showLoading({ title: `生成中 ${progress}%`, mask: true });
            }
        }

        if (!books.length) {
            const ctx = this.canvasHelper.ctx;
            const palette = this.getPalette();
            ctx.save();
            ctx.fillStyle = palette.textMuted;
            ctx.font = '26px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('暂无已读图书', card.cardX + card.cardWidth / 2, posterMetrics.startY + 80);
            ctx.restore();
        }

        this.drawFooter(card);
    },

    async drawPosterItem(book, x, y, width, height) {
        const ctx = this.canvasHelper.ctx;
        try {
            let imageUrl = book.cover || book.coverUrl || book.originalCover;
            if (!imageUrl) throw new Error('missing cover');
            if (imageUrl.startsWith('cloud://')) {
                imageUrl = await this.canvasHelper.getCloudTempUrl(imageUrl);
            }
            const image = await this.canvasHelper.loadImage(imageUrl);
            ctx.save();
            this.canvasHelper.drawRoundRectPath(x, y, width, height, 8);
            ctx.clip();
            ctx.drawImage(image, x, y, width, height);
            ctx.restore();
        } catch (err) {
            this.drawPosterPlaceholder(x, y, width, height);
        }
    },

    drawPosterPlaceholder(x, y, width, height) {
        const ctx = this.canvasHelper.ctx;
        const palette = this.getPalette();
        ctx.save();
        ctx.fillStyle = palette.panelBg;
        this.canvasHelper.drawRoundRectPath(x, y, width, height, 8);
        ctx.fill();
        ctx.fillStyle = palette.textMuted;
        ctx.font = '18px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('封面', x + width / 2, y + height / 2);
        ctx.restore();
    },

    // 行高按字号推导（舒适阅读比例），跟胶囊的 capsuleMetricsFor 是同一个思路
    listRowHeightFor(fontSize) {
        return Math.round(fontSize * 1.8 + 6);
    },

    // 算可用高度（列数不影响高度，只跟画布尺寸有关）
    listAvailableHeightFor(canvasWidth, canvasHeight) {
        const scale = canvasWidth / FIXED_CANVAS_WIDTH;
        const panelHeight = canvasHeight - Math.round(CARD_CONTENT_TOP * scale) - Math.round(34 * scale) - Math.round(44 * scale);
        const paddingTop = Math.round(10 * scale);
        return panelHeight - paddingTop * 2;
    },

    // 在给定画布高度、行数下，二分查找"整体内容高度不超过可用高度"的最大字号（绝对像素）
    searchListFontForRows(availableHeight, rows, baseFont, maxFont) {
        if (rows * this.listRowHeightFor(baseFont) > availableHeight) return null;
        let lo = baseFont;
        let hi = maxFont;
        let best = baseFont;
        while (lo <= hi) {
            const mid = Math.floor((lo + hi) / 2);
            if (rows * this.listRowHeightFor(mid) <= availableHeight) {
                best = mid;
                lo = mid + 1;
            } else {
                hi = mid - 1;
            }
        }
        return best;
    },

    // 决定列表文字卡片用哪个画布尺寸 + 列数 + 字号
    decideListLayout() {
        const BASE_FONT = 16;
        const MAX_FONT = 22;
        const CANDIDATE_COLUMNS = [5, 4, 3, 2];
        const total = this.data.allBooks.length;

        if (!total) {
            return { width: FIXED_CANVAS_WIDTH, height: FIXED_CANVAS_HEIGHT, fontSize: BASE_FONT, columns: 5 };
        }

        const tryCanvas = (canvasWidth, canvasHeight) => {
            const availableHeight = this.listAvailableHeightFor(canvasWidth, canvasHeight);
            let bestOption = null;
            CANDIDATE_COLUMNS.forEach(columns => {
                const rows = Math.max(1, Math.ceil(total / columns));
                const font = this.searchListFontForRows(availableHeight, rows, BASE_FONT, MAX_FONT);
                if (font == null) return;
                const fillRatio = Math.min(1, (rows * this.listRowHeightFor(font)) / availableHeight);
                if (!bestOption || fillRatio > bestOption.fillRatio + 0.02) {
                    bestOption = { columns, font, fillRatio };
                }
            });
            return bestOption;
        };

        const compact = tryCanvas(COMPACT_CANVAS_WIDTH, COMPACT_CANVAS_HEIGHT);
        if (compact) {
            return { width: COMPACT_CANVAS_WIDTH, height: COMPACT_CANVAS_HEIGHT, fontSize: compact.font, columns: compact.columns };
        }

        const full = tryCanvas(FIXED_CANVAS_WIDTH, FIXED_CANVAS_HEIGHT);
        if (full) {
            return { width: FIXED_CANVAS_WIDTH, height: FIXED_CANVAS_HEIGHT, fontSize: full.font, columns: full.columns };
        }

        return { width: FIXED_CANVAS_WIDTH, height: FIXED_CANVAS_HEIGHT, fontSize: BASE_FONT, columns: 5 };
    },

    buildTagLayout(card) {
        const ctx = this.canvasHelper.ctx;
        const scale = this.getScale();
        const panelX = card.contentX;
        const panelY = card.contentY;
        const panelWidth = card.contentWidth;
        const panelHeight = card.footerY - panelY - Math.round(34 * scale);
        const columns = this._decidedColumns || 5;
        const rows = Math.max(1, Math.ceil(this.data.allBooks.length / columns));
        const paddingTop = Math.round(10 * scale);
        const gapX = Math.round(18 * scale);
        const cellWidth = (panelWidth - gapX * (columns - 1)) / columns;

        const maxFontSize = this._decidedFontSize;
        const comfortableRowHeight = this.listRowHeightFor(maxFontSize);
        const stretchedRowHeight = (panelHeight - paddingTop * 2) / rows;
        const rowHeight = Math.min(comfortableRowHeight, stretchedRowHeight);

        const fontSize = Math.max(10, Math.min(maxFontSize, Math.floor(rowHeight - 6)));
        const dotSize = Math.max(6, Math.round(fontSize * 0.42));
        const textLeftGap = 8;

        const contentHeight = rows * rowHeight;
        const availableHeight = panelHeight - paddingTop * 2;
        const extraTop = Math.max(0, (availableHeight - contentHeight) / 2);
        const startY = panelY + paddingTop + extraTop;

        ctx.save();
        ctx.font = `500 ${fontSize}px sans-serif`;

        const items = this.data.allBooks.map((book, index) => {
            const column = Math.floor(index / rows);
            const row = index % rows;
            return {
                x: panelX + column * (cellWidth + gapX),
                y: startY + row * rowHeight,
                width: cellWidth,
                height: rowHeight,
                fontSize,
                dotSize,
                textLeftGap,
                title: book.title,
                status: this.data.markStatusMap[book._id] || 'unread'
            };
        });
        ctx.restore();

        return { items, panelY, panelHeight };
    },

    async drawTextCard() {
        const card = this.drawCard();
        this.drawCardHeader(card);
        if (this.data.textStyle === 'capsule') {
            this.drawCapsuleLayout(card);
        } else {
            const layout = this.buildTagLayout(card);
            this.drawTextMatrix(layout);
        }
        this.drawFooter(card);
    },

    drawCapsuleLayout(card) {
        const ctx = this.canvasHelper.ctx;
        const palette = this.getPalette();
        const books = this.data.allBooks;
        if (!books.length) {
            ctx.save();
            ctx.fillStyle = palette.textMuted;
            ctx.font = '24px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('暂无图书数据', card.cardWidth / 2, card.contentY + 80);
            ctx.restore();
            return;
        }

        const fontSize = this._decidedFontSize;
        const { pillH, pillPadX, gapX, gapY, textFontSize } = this.capsuleMetricsFor(fontSize);
        const startX = card.contentX;
        const maxWidth = card.contentWidth;
        let curX = startX;
        let curY = card.contentY;

        const bgMap = { read: palette.readBg, wish: palette.wishBg, unread: palette.unreadBg };
        const colorMap = {
            read: '#6F8244',
            wish: '#A07F12',
            unread: '#6F6F68'
        };
        const borderMap = {
            read: 'rgba(154, 171, 101, 0.35)',
            wish: 'rgba(212, 168, 40, 0.35)',
            unread: 'rgba(156, 153, 143, 0.28)'
        };

        ctx.save();
        ctx.font = `400 ${textFontSize}px sans-serif`;

        books.forEach(book => {
            const status = this.data.markStatusMap[book._id] || 'unread';
            const textW = ctx.measureText(book.title).width;
            const pillW = textW + pillPadX * 2;

            if (curX + pillW > startX + maxWidth && curX > startX) {
                curX = startX;
                curY += pillH + gapY;
            }

            ctx.fillStyle = bgMap[status];
            this.canvasHelper.drawRoundRectPath(curX, curY, pillW, pillH, Math.round(pillH / 2));
            ctx.fill();

            ctx.strokeStyle = borderMap[status];
            ctx.lineWidth = 1;
            ctx.stroke();

            ctx.fillStyle = colorMap[status];
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            const textY = curY + pillH / 2 + 1;
            const textX = curX + pillPadX;
            ctx.fillText(book.title, textX, textY);

            if (status === 'read') {
                ctx.strokeStyle = 'rgba(111, 130, 68, 0.75)';
                ctx.lineWidth = Math.max(1, Math.round(textFontSize * 0.075));
                ctx.beginPath();
                ctx.moveTo(textX, textY);
                ctx.lineTo(textX + textW, textY);
                ctx.stroke();
            }

            curX += pillW + gapX;
        });
        ctx.restore();
    },

    drawTextMatrix(layout) {
        const ctx = this.canvasHelper.ctx;
        const palette = this.getPalette();
        if (!layout.items.length) {
            ctx.save();
            ctx.fillStyle = palette.textMuted;
            ctx.font = '24px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('暂无图书数据', this.data.canvasSize.width / 2, layout.panelY + layout.panelHeight / 2);
            ctx.restore();
            return;
        }

        layout.items.forEach((item) => {
            this.drawBookText(item);
        });
    },

    drawBookText(item) {
        const ctx = this.canvasHelper.ctx;
        const palette = this.getPalette();
        const dotColor = {
            read: palette.read,
            wish: palette.wish,
            unread: palette.unread
        }[item.status] || palette.unread;
        const titleColor = 'rgba(45, 45, 43, 0.82)';
        const textX = item.x + item.dotSize + item.textLeftGap;
        const centerY = item.y + item.height / 2;
        const maxTextWidth = item.width - item.dotSize - item.textLeftGap - 4;

        ctx.save();
        ctx.fillStyle = dotColor;
        ctx.beginPath();
        ctx.arc(item.x + item.dotSize / 2, centerY, item.dotSize / 2, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = titleColor;
        ctx.font = `500 ${item.fontSize}px sans-serif`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        const textWidth = ctx.measureText(item.title).width;
        const renderedWidth = Math.min(textWidth, maxTextWidth);

        if (textWidth > maxTextWidth) {
            const scaleX = maxTextWidth / textWidth;
            ctx.save();
            ctx.translate(textX, centerY);
            ctx.scale(scaleX, 1);
            ctx.fillText(item.title, 0, 0);
            ctx.restore();
        } else {
            ctx.fillText(item.title, textX, centerY);
        }

        if (item.status === 'read') {
            ctx.strokeStyle = 'rgba(45, 45, 43, 0.55)';
            ctx.lineWidth = Math.max(1, Math.round(item.fontSize * 0.08));
            ctx.beginPath();
            ctx.moveTo(textX, centerY);
            ctx.lineTo(textX + renderedWidth, centerY);
            ctx.stroke();
        }
        ctx.restore();
    },

    drawFooter(card) {
        const ctx = this.canvasHelper.ctx;
        const scale = this.getScale();
        ctx.save();
        ctx.fillStyle = 'rgba(45, 45, 43, 0.72)';
        ctx.font = `600 ${Math.round(20 * scale)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(FOOTER_TEXT, card.cardX + card.cardWidth / 2, card.footerY);
        ctx.restore();
    },

    async exportAndSaveImage() {
        const canvas = this.canvasHelper.canvas;
        const { canvasSize } = this.data;
        if (!canvas) throw new Error('Canvas未初始化');

        await this.requestSavePermission();
        const windowInfo = wx.getWindowInfo();
        const dpr = canvasSize.width > 750 ? 1 : (windowInfo.pixelRatio || 1);
        await new Promise(resolve => {
            canvas.requestAnimationFrame(() => canvas.requestAnimationFrame(resolve));
        });
        const tempFilePath = await new Promise((resolve, reject) => {
            wx.canvasToTempFilePath({
                canvas,
                x: 0,
                y: 0,
                width: canvasSize.width,
                height: canvasSize.height,
                destWidth: canvasSize.width * dpr,
                destHeight: canvasSize.height * dpr,
                fileType: 'jpg',
                quality: 0.92,
                success: res => resolve(res.tempFilePath),
                fail: err => reject(new Error('生成图片失败: ' + (err.errMsg || '未知错误')))
            }, this);
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
        const authSetting = await new Promise((resolve, reject) => {
            wx.getSetting({ success: res => resolve(res.authSetting), fail: reject });
        });
        if (authSetting['scope.writePhotosAlbum']) return true;

        await new Promise((resolve, reject) => {
            wx.authorize({
                scope: 'scope.writePhotosAlbum',
                success: resolve,
                fail: (err) => {
                    if (err.errMsg && err.errMsg.includes('auth deny')) {
                        wx.showModal({
                            title: '需要授权',
                            content: '请在设置中允许访问相册',
                            confirmText: '去设置',
                            success: (res) => {
                                if (res.confirm) wx.openSetting();
                            }
                        });
                        reject(new Error('用户拒绝授权'));
                    } else {
                        reject(err);
                    }
                }
            });
        });
        return true;
    },

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
            title: `我的${this.data.cfg.title}读书海报`,
            path: `/pages/genericBookList/list/list?theme=${this.data.theme}`
        };
    },

    onUnload() {
        if (this.canvasHelper) this.canvasHelper.clearCache();
    }
});
