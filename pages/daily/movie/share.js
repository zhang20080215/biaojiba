const toast = require('../../../utils/dailyToast.js');
const rewardedSaveGate = require('../../../utils/rewardedSaveGate.js');
const MoviePosterDrawer = require('../../../utils/moviePosterDrawer.js');
const CanvasHelper = require('../../../utils/canvasHelper.js');
const { getNavMetrics, getWindowInfoCompat, formatDateCN } = require('./common.js');

const THEME_STORAGE_KEY = 'movieShareTheme';
const MODE_STORAGE_KEY = 'moviePosterMode';   // 'xhs'(小红书 3:4) | 'raw'(原始海报比例)
const HIDE_RATINGS_KEY = 'moviePosterHideRatings';   // 单部海报是否隐藏全部平台评分（豆瓣/IMDb/烂番茄）

function keyOf(m) { return `${m.date}-${m.ts}`; }

// 'YYYY-MM-DD' → 'YYYY.M'
function ymOf(dateStr) {
  const p = String(dateStr || '').split('-');
  return p.length >= 2 ? `${p[0]}.${Number(p[1])}` : '';
}

// 'YYYY-MM-DD' → 'YYYY年M月D日观影'
function watchDateOf(dateStr) {
  const p = String(dateStr || '').split('-');
  return p.length >= 3 ? `${p[0]}年${Number(p[1])}月${Number(p[2])}日观影` : '';
}

Page({
  data: {
    toast: { show: false, text: '', icon: '' },
    statusBarHeight: 20,
    navBarHeight: 48,
    navOffset: 68,

    loading: true,
    ready: false,
    previewW: 300,
    previewH: 400,
    slotH: 400,          // 预览槽固定高度：切换比例时按钮不跳动
    isGenerating: false,
    needRewardedAd: false,

    themes: MoviePosterDrawer.THEMES,
    themeId: MoviePosterDrawer.DEFAULT_THEME,

    // 单部海报比例：xhs=小红书 3:4（可能裁切海报）/ raw=原始海报比例（不裁）
    singleMovie: false,
    posterMode: 'xhs',
    hasRatings: false,   // 单部电影是否有平台评分（决定是否显示开关）
    hideRatings: false   // 单部电影是否隐藏全部平台评分
  },

  posterData: null,   // 传给绘制器的数据
  _selection: null,   // 原始选中项
  _canvasW: 1080,
  _canvasH: 1440,
  _ready: false,
  _rendered: false,
  _destroyed: false,

  safeSetData(obj) { if (!this._destroyed) this.setData(obj); },
  onUnload() { this._destroyed = true; },

  onLoad() {
    const nav = getNavMetrics();
    const app = getApp();
    const selection = (app && app.globalData && app.globalData.moviePosterSelection) || [];

    let themeId = MoviePosterDrawer.DEFAULT_THEME;
    let posterMode = 'xhs';
    let hideRatings = false;
    try {
      const saved = wx.getStorageSync(THEME_STORAGE_KEY);
      if (saved && this.data.themes.some(t => t.id === saved)) themeId = saved;
      const savedMode = wx.getStorageSync(MODE_STORAGE_KEY);
      if (savedMode === 'xhs' || savedMode === 'raw') posterMode = savedMode;
      hideRatings = !!wx.getStorageSync(HIDE_RATINGS_KEY);
    } catch (e) {}
    this._hideRatings = hideRatings;

    // 首屏只发一次 setData：canvas 是原生组件，其相邻 wx:if 文本节点若在首次渲染前
    // 被多批 setData 反复增删，渲染层会报 insertTextView:fail parent not found。
    const patch = {
      statusBarHeight: nav.statusBarHeight,
      navBarHeight: nav.navBarHeight,
      navOffset: nav.navOffset,
      themeId,
      posterMode,
      hideRatings
    };
    wx.setNavigationBarTitle({ title: '分享观影卡片' });

    if (!selection.length) {
      this.setData(patch);
      toast.show(this, '没有可分享的电影');
      setTimeout(() => { if (!this._destroyed) this.onBack(); }, 900);
      return;
    }
    this._selection = selection;
    Object.assign(patch, this._buildPosterData(selection), this._previewSizePatch(), { loading: false });
    this.setData(patch);
    rewardedSaveGate.refreshHint(this);   // 异步，setData 落在首屏渲染之后
  },

  onReady() {
    this._ready = true;
    this.maybeGenerate();
  },

  onBack() {
    if (getCurrentPages().length > 1) wx.navigateBack();
    else wx.redirectTo({ url: '/pages/daily/movie/index' });
  },

  onShareAppMessage() {
    return { title: '我的观影记录', path: '/pages/daily/movie/index' };
  },

  // ---- 组装海报数据（标题/副标题/均分/逐部字段）；返回需要 setData 的补丁，由调用方合批 ----
  _buildPosterData(selection) {
    // 绘制器最多渲染 60 部，尺寸与渲染保持一致
    if (selection.length > 60) selection = selection.slice(0, 60);
    const n = selection.length;
    const first = selection[0].date;
    const last = selection[n - 1].date;
    let subtitle;
    if (n === 1) {
      subtitle = `${ymOf(first)} · 共 1 部`;
    } else if (ymOf(first) === ymOf(last)) {
      subtitle = `${ymOf(first)} · 共 ${n} 部`;
    } else {
      subtitle = `${ymOf(first)} - ${ymOf(last)} · 共 ${n} 部`;
    }
    const rated = selection.filter(m => Number(m.rating) > 0);
    let avgText = '';
    if (rated.length) {
      const avg = rated.reduce((s, m) => s + Number(m.rating), 0) / rated.length;
      avgText = `平均 ${(avg * 2).toFixed(1)}`;
    }
    const movies = selection.map(m => ({
      key: keyOf(m),
      title: m.title,
      year: m.year,
      director: m.director || '',
      genres: Array.isArray(m.genres) ? m.genres : [],
      dateLabel: formatDateCN(m.date),
      watchDateText: watchDateOf(m.date),
      rating: Number(m.rating) || 0,
      moodEmoji: m.moodEmoji || '',
      moodLabel: m.moodLabel || '',
      note: m.note || '',
      platformRatings: m.platformRatings || []
    }));
    this.posterData = { title: '我的观影记录', subtitle, avgText, movies };
    this._isSingle = (n === 1);

    // 单部电影：记住完整平台评分，按开关整体隐藏
    let hasRatings = false;
    if (this._isSingle) {
      this._rawRatings = movies[0].platformRatings || [];
      hasRatings = this._rawRatings.length > 0;
      this._applyRatingsFilter();
    }
    const size = MoviePosterDrawer.computeSize(n);
    this._canvasW = size.width;
    this._canvasH = size.height;

    return { singleMovie: this._isSingle, hasRatings };
  },

  // 计算预览尺寸。单部电影用固定高度的预览槽（= maxW*1.5，容纳 3:4 与原始海报比例），
  // 画布在槽内居中——切换「小红书/原始海报」时下方控件与保存按钮不跳动。
  _previewSizePatch() {
    const screenW = getWindowInfoCompat().windowWidth || 375;
    const maxW = Math.min(Math.round(screenW * 0.84), 340);
    let previewW = maxW;
    let previewH = Math.round(maxW * this._canvasH / this._canvasW);
    let slotH;
    if (this._isSingle) {
      slotH = Math.round(maxW * 1.5);
      if (previewH > slotH) {                       // 极窄海报：限高、按比例收窄
        previewH = slotH;
        previewW = Math.round(slotH * this._canvasW / this._canvasH);
      }
    } else {
      slotH = previewH;                             // 多部固定 3:4，无需预留
    }
    return { previewW, previewH, slotH };
  },

  onPickTheme(e) {
    const id = e.currentTarget.dataset.id;
    if (!id || id === this.data.themeId) return;
    if (!this.data.ready) return;
    try { wx.setStorageSync(THEME_STORAGE_KEY, id); } catch (err) {}
    this.setData({ themeId: id, ready: false });
    this.generatePoster();
  },

  onPickMode(e) {
    const mode = e.currentTarget.dataset.mode;
    if (!mode || mode === this.data.posterMode) return;
    if (!this.data.ready) return;
    try { wx.setStorageSync(MODE_STORAGE_KEY, mode); } catch (err) {}
    this.setData({ posterMode: mode, ready: false });
    this.generatePoster();
  },

  onToggleRatings() {
    if (!this.data.ready) return;
    const hide = !this._hideRatings;
    this._hideRatings = hide;
    try { wx.setStorageSync(HIDE_RATINGS_KEY, hide); } catch (err) {}
    this._applyRatingsFilter();
    this.setData({ hideRatings: hide, ready: false });
    this.generatePoster();
  },

  // 依据开关整体隐藏单部电影的平台评分卡（豆瓣/IMDb/烂番茄，改写 posterData 供绘制器读取）
  _applyRatingsFilter() {
    if (!this._isSingle || !this.posterData) return;
    this.posterData.movies[0].platformRatings =
      this._hideRatings ? [] : (this._rawRatings || []);
  },

  // 依据模式确定画布尺寸：raw 单部跟随海报真实比例（不裁切），其余走 3:4
  _resolveCanvasSize() {
    const base = MoviePosterDrawer.computeSize(this.posterData.movies.length);
    let W = base.width, H = base.height;
    if (this.data.posterMode === 'raw' && this._isSingle && this._coverNodes) {
      const node = this._coverNodes[this.posterData.movies[0].key];
      if (node && node.width && node.height) {
        H = Math.round(W * node.height / node.width);
      }
    }
    this._canvasW = W;
    this._canvasH = H;
  },

  // 预览框跟随画布比例（CSS 缩放，避免变形）
  _syncPreviewToCanvas() {
    this.safeSetData(this._previewSizePatch());
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
        wx.createSelectorQuery().in(this).select('#movieCard').fields({ node: true, size: true }).exec(res => {
          if (!res || !res[0] || !res[0].node) reject(new Error('Canvas 节点获取失败'));
          else resolve(res[0].node);
        });
      });
      if (this._destroyed) return;
      const ctx = canvas.getContext('2d');

      // 首次出图时加载全部封面（createImage 不依赖画布尺寸；缓存到实例，切主题/比例重绘复用）
      if (!this._coverNodes) {
        this._coverNodes = await this._loadCovers(canvas, ctx, this.posterData.movies);
      }
      if (this._destroyed) return;

      // 封面就绪后再定画布尺寸（raw 单部要用海报真实比例），随后同步预览框
      this._resolveCanvasSize();
      canvas.width = this._canvasW;
      canvas.height = this._canvasH;
      this._syncPreviewToCanvas();

      const drawer = new MoviePosterDrawer(canvas, ctx, this._canvasW, this._canvasH);
      drawer.draw(this.posterData, this._coverNodes, this.data.themeId);

      await new Promise(resolve => {
        canvas.requestAnimationFrame(() => canvas.requestAnimationFrame(resolve));
      });
      if (this._destroyed) return;
      const res = await wx.canvasToTempFilePath({ canvas, fileType: 'png', quality: 1 });
      if (this._destroyed) return;
      this._previewTemp = res.tempFilePath;
      this.safeSetData({ ready: true });
    } catch (err) {
      console.error('movie share render fail', err);
      this._rendered = false;
      if (!this._destroyed) toast.show(this, '生成失败');
    }
  },

  // 加载封面为 image 节点。仅信任云存储（cloud://）封面：换成临时链接后加载；
  // 豆瓣等直链一律占位——canvas 不做 downloadFile，避免依赖域名白名单（详见每日电影海报封面策略）。
  async _loadCovers(canvas, ctx, movies) {
    const nodes = {};
    // 1. 收集 cloud:// 封面，映射 key→fileID
    const idByKey = {};
    const cloudIds = [];
    movies.forEach(m => {
      const raw = (this._selection.find(s => `${s.date}-${s.ts}` === m.key) || {}).poster || '';
      if (raw && raw.indexOf('cloud://') === 0) {
        idByKey[m.key] = raw;
        if (cloudIds.indexOf(raw) < 0) cloudIds.push(raw);
      }
    });
    // 2. 批量换取临时链接
    const tempMap = {};
    if (cloudIds.length) {
      try {
        const r = await wx.cloud.getTempFileURL({ fileList: cloudIds });
        (r.fileList || []).forEach(f => { if (f.fileID && f.tempFileURL) tempMap[f.fileID] = f.tempFileURL; });
      } catch (e) {
        console.warn('getTempFileURL fail', e);
      }
    }
    // 3. 逐张加载（无 cloud 封面 / 换链失败 / 加载失败 → null，绘制器画占位）
    const helper = new CanvasHelper(canvas, ctx, { width: this._canvasW, height: this._canvasH });
    for (const m of movies) {
      if (this._destroyed) break;
      const fileId = idByKey[m.key];
      const url = fileId && tempMap[fileId];
      if (!url) { nodes[m.key] = null; continue; }
      try {
        nodes[m.key] = await helper.loadImage(url, 3);
      } catch (e) {
        nodes[m.key] = null;
      }
    }
    return nodes;
  },

  async saveImage() {
    if (this.data.isGenerating) return;
    if (!this._previewTemp) { toast.show(this, '图片还没生成好'); return; }
    const hasGrant = await rewardedSaveGate.ensureGrant(this);
    if (!hasGrant) return;
    try {
      this.setData({ isGenerating: true });
      await wx.saveImageToPhotosAlbum({ filePath: this._previewTemp });
      toast.show(this, '已保存到相册', { icon: 'success' });
    } catch (err) {
      console.error('movie share save fail', err);
      if (err.errMsg && err.errMsg.includes('auth deny')) {
        wx.showModal({
          title: '权限提示',
          content: '需要授权保存图片到相册',
          confirmText: '去设置',
          success: r => { if (r.confirm) wx.openSetting(); }
        });
      } else {
        toast.show(this, '保存失败');
      }
    } finally {
      this.safeSetData({ isGenerating: false });
    }
  }
});
