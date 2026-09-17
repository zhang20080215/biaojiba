const toast = require('../../../utils/dailyToast.js');
const rewardedSaveGate = require('../../../utils/rewardedSaveGate.js');
const BookPosterDrawer = require('../../../utils/bookPosterDrawer.js');
const CanvasHelper = require('../../../utils/canvasHelper.js');
const { getNavMetrics, getWindowInfoCompat, formatDateCN, todayStr, flattenBooks, dedupeBooks } = require('./common.js');

// 每日电影分享页（pages/daily/movie/share）的读书版：版式、选项面板、取数/筛选/出图流程逐行对应，
// 绘制器换成 bookPosterDrawer（同一套版式 + 读书词表），数据换成 flattenBooks / dedupeBooks。
// 两种进入方式：
//   1. 日历页条目「分享」：app.globalData.bookPosterSelection = [一本] → 单本海报（比例 / 隐藏评分）
//   2. 日历页「海报」：?year=&month= → 范围海报：拉全部记录，按「年度 / 月度」范围筛选，
//      版式 整体 / 按月份 / 按评分 / 日历（仅月度），背景三套对齐豆瓣 TOP250 海报页。
const THEME_STORAGE_KEY = 'readShareTheme';
const MODE_STORAGE_KEY = 'readPosterMode';   // 'xhs'(小红书 3:4) | 'raw'(原始封面比例)
const HIDE_RATINGS_KEY = 'readPosterHideRatings';   // 单本海报是否隐藏豆瓣评分
const LAYOUT_STORAGE_KEY = 'readPosterLayout';       // 范围版式：'whole' | 'month' | 'rating' | 'calendar'(仅月度)
const RANGE_STORAGE_KEY = 'readPosterRange';         // 范围粒度：'year' | 'month'
const LAYOUTS = ['whole', 'month', 'rating', 'calendar'];
const TITLE_MAX = 20;                                  // 自定义标题字数上限
const MAX_BOOKS = 300;                                 // 绘制器上限：超出按日期取前 300 本，统计仍按全量、海报页脚注明

function keyOf(m) { return `${m.date}-${m.ts}`; }

// 'YYYY-MM-DD' → 'YYYY.M'
function ymOf(dateStr) {
  const p = String(dateStr || '').split('-');
  return p.length >= 2 ? `${p[0]}.${Number(p[1])}` : '';
}

// 'YYYY-MM-DD' → 'YYYY年M月D日阅读'
function readDateOf(dateStr) {
  const p = String(dateStr || '').split('-');
  return p.length >= 3 ? `${p[0]}年${Number(p[1])}月${Number(p[2])}日阅读` : '';
}

function pad2(n) { return String(n).padStart(2, '0'); }

Page({
  data: {
    toast: { show: false, text: '', icon: '' },
    statusBarHeight: 20,
    navBarHeight: 48,
    navOffset: 68,

    loading: true,
    ready: false,
    empty: false,        // 范围内没有读书记录（画空态，保存按钮禁用）
    previewW: 300,
    previewH: 400,
    slotH: 400,          // 预览槽固定高度：切换比例时按钮不跳动
    isGenerating: false,
    needRewardedAd: false,

    themes: BookPosterDrawer.THEMES,
    themeId: BookPosterDrawer.DEFAULT_THEME,

    // 单本海报比例：xhs=小红书 3:4（可能裁切封面）/ raw=原始封面比例（不裁）
    singleBook: false,
    posterMode: 'xhs',
    hasRatings: false,   // 单本书是否有豆瓣评分（决定是否显示开关）
    hideRatings: false,  // 单本书是否隐藏豆瓣评分

    // 范围海报
    rangeMode: 'year',   // 'year' | 'month'
    rangeYear: 0,
    rangeMonth: 0,
    rangeLabel: '',
    canNextRange: false,
    posterLayout: 'whole',
    calendarOk: false,   // 范围粒度为月度时才能选「日历」
    customTitle: '',     // 自定义标题（≤20 字，空 = 各版式默认标题）
    titleMax: TITLE_MAX
  },

  posterData: null,   // 传给绘制器的数据
  _all: null,         // 范围模式：全部读书记录（展平、未去重）
  _canvasW: 1242,
  _canvasH: 1660,
  _coverNodes: {},    // key → ImageNode|null，跨范围/主题切换复用
  _ready: false,
  _rendered: false,
  _destroyed: false,

  safeSetData(obj) { if (!this._destroyed) this.setData(obj); },
  onUnload() { this._destroyed = true; },

  onLoad(options) {
    const nav = getNavMetrics();
    const app = getApp();
    const selection = (app && app.globalData && app.globalData.bookPosterSelection) || [];
    if (app && app.globalData) app.globalData.bookPosterSelection = null;   // 一次性，别留给下次

    let themeId = BookPosterDrawer.DEFAULT_THEME;
    let posterMode = 'xhs';
    let posterLayout = 'whole';
    let rangeMode = 'year';
    let hideRatings = false;
    try {
      const saved = wx.getStorageSync(THEME_STORAGE_KEY);
      if (saved && this.data.themes.some(t => t.id === saved)) themeId = saved;
      const savedMode = wx.getStorageSync(MODE_STORAGE_KEY);
      if (savedMode === 'xhs' || savedMode === 'raw') posterMode = savedMode;
      const savedLayout = wx.getStorageSync(LAYOUT_STORAGE_KEY);
      if (LAYOUTS.indexOf(savedLayout) >= 0) posterLayout = savedLayout;
      const savedRange = wx.getStorageSync(RANGE_STORAGE_KEY);
      if (savedRange === 'year' || savedRange === 'month') rangeMode = savedRange;
      hideRatings = !!wx.getStorageSync(HIDE_RATINGS_KEY);
    } catch (e) {}
    this._hideRatings = hideRatings;
    wx.setNavigationBarTitle({ title: '分享阅读海报' });

    // 首屏只发一次 setData：canvas 是原生组件，其相邻 wx:if 文本节点若在首次渲染前
    // 被多批 setData 反复增删，渲染层会报 insertTextView:fail parent not found。
    const patch = {
      statusBarHeight: nav.statusBarHeight,
      navBarHeight: nav.navBarHeight,
      navOffset: nav.navOffset,
      themeId,
      posterMode,
      posterLayout,
      rangeMode,
      hideRatings
    };

    // ---- 单本：直接出图 ----
    if (selection.length) {
      this._isSingle = true;
      Object.assign(patch, this._buildPosterData(selection.slice(0, 1)), this._previewSizePatch(), { loading: false, singleBook: true });
      this.setData(patch);
      rewardedSaveGate.refreshHint(this);   // 异步，setData 落在首屏渲染之后
      return;
    }

    // ---- 范围：默认当前年度（日历页传来的年份），拉全量后再筛 ----
    this._isSingle = false;
    const today = todayStr();
    const y = Number(options && options.year) || Number(today.slice(0, 4));
    const m = Number(options && options.month) || Number(today.slice(5, 7));
    this._today = today;
    Object.assign(patch, { rangeYear: y, rangeMonth: m }, this._rangePatch(rangeMode, y, m));
    if (patch.posterLayout === 'calendar' && !patch.calendarOk) patch.posterLayout = 'whole';
    this.setData(patch);
    rewardedSaveGate.refreshHint(this);
    this.fetchAll();
  },

  onReady() {
    this._ready = true;
    this.maybeGenerate();
  },

  onBack() {
    if (getCurrentPages().length > 1) wx.navigateBack();
    else wx.redirectTo({ url: '/pages/daily/read/index' });
  },

  onShareAppMessage() {
    return { title: '我的读书记录', path: '/pages/daily/read/index' };
  },

  // ================= 范围模式：取数 + 筛选 =================
  fetchAll() {
    wx.cloud.callFunction({
      name: 'syncDailyLog',
      data: { action: 'getAll', theme: 'read' },
      success: res => {
        if (this._destroyed) return;
        const result = res && res.result;
        if (!result || !result.success) {
          toast.show(this, '加载失败');
          this.setData({ loading: false });
          return;
        }
        this._all = flattenBooks(result.days || []);
        this._applyRange();
        this.setData(Object.assign({ loading: false }, this._previewSizePatch()));
        this.maybeGenerate();
      },
      fail: err => {
        console.error('read share getAll fail', err);
        if (this._destroyed) return;
        toast.show(this, '加载失败');
        this.setData({ loading: false });
      }
    });
  },

  // 范围文案 / 下一段是否可用 / 日历是否可选
  _rangePatch(mode, y, m) {
    const today = this._today || todayStr();
    const curY = Number(today.slice(0, 4)), curM = Number(today.slice(5, 7));
    const isMonth = mode === 'month';
    return {
      rangeMode: mode,
      rangeLabel: isMonth ? `${y}年${m}月` : `${y}年`,
      canNextRange: isMonth ? (y < curY || (y === curY && m < curM)) : y < curY,
      calendarOk: isMonth
    };
  },

  // 按当前范围筛出书 → 重建 posterData（除日历外按「本」去重，与日历页书墙口径一致）
  _applyRange() {
    const { rangeMode, rangeYear, rangeMonth } = this.data;
    const prefix = rangeMode === 'month' ? `${rangeYear}-${pad2(rangeMonth)}` : String(rangeYear);
    let list = (this._all || []).filter(m => String(m.date || '').indexOf(prefix) === 0);
    if (this._layout() !== 'calendar') list = dedupeBooks(list);
    list.sort((a, b) => (a.date !== b.date) ? (a.date < b.date ? -1 : 1) : ((a.ts || 0) - (b.ts || 0)));
    const lead = rangeMode === 'month' ? `${rangeYear}年${rangeMonth}月` : `${rangeYear}年度`;
    const keepTitle = this.posterData ? (this.posterData.customTitle || '') : '';
    this._buildPosterData(list);
    this.posterData.periodLead = lead;
    this.posterData.customTitle = keepTitle;
    this.safeSetData({ empty: list.length === 0 });
  },

  onRangeMode(e) {
    const mode = e.currentTarget.dataset.mode;
    if (!mode || mode === this.data.rangeMode || !this.data.ready) return;
    try { wx.setStorageSync(RANGE_STORAGE_KEY, mode); } catch (err) {}
    const patch = this._rangePatch(mode, this.data.rangeYear, this.data.rangeMonth);
    // 年度下没有「日历」：退回整体
    if (!patch.calendarOk && this.data.posterLayout === 'calendar') patch.posterLayout = 'whole';
    this._reRange(patch);
  },

  onPrevRange() { this._stepRange(-1); },
  onNextRange() { if (this.data.canNextRange) this._stepRange(1); },

  _stepRange(dir) {
    if (!this.data.ready) return;
    let { rangeMode, rangeYear: y, rangeMonth: m } = this.data;
    if (rangeMode === 'month') {
      m += dir;
      if (m < 1) { m = 12; y -= 1; }
      if (m > 12) { m = 1; y += 1; }
    } else {
      y += dir;
    }
    this._reRange(Object.assign({ rangeYear: y, rangeMonth: m }, this._rangePatch(rangeMode, y, m)));
  },

  _reRange(patch) {
    this.setData(Object.assign({ ready: false }, patch));
    this._applyRange();
    this.generatePoster();
  },

  // ---- 组装海报数据（标题/副标题/均分/逐本字段）；返回需要 setData 的补丁，由调用方合批 ----
  _buildPosterData(selection) {
    // 绘制器最多渲染 300 本：超出的按日期截前 300，但统计（本数/平均分/阅读日）按全量算，海报页脚会注明
    const totalCount = selection.length;
    const fullStats = BookPosterDrawer.summarize(selection);
    if (selection.length > MAX_BOOKS) selection = selection.slice(0, MAX_BOOKS);
    const n = selection.length;
    let subtitle = '';
    if (n) {
      const first = selection[0].date;
      const last = selection[n - 1].date;
      if (n === 1) subtitle = `${ymOf(first)} · 共 1 本`;
      else if (ymOf(first) === ymOf(last)) subtitle = `${ymOf(first)} · 共 ${n} 本`;
      else subtitle = `${ymOf(first)} - ${ymOf(last)} · 共 ${n} 本`;
    }
    const rated = selection.filter(m => Number(m.rating) > 0);
    let avgText = '';
    if (rated.length) {
      const avg = rated.reduce((s, m) => s + Number(m.rating), 0) / rated.length;
      avgText = `平均 ${(avg * 2).toFixed(1)}`;
    }
    // 绘制器的 movies 字段名沿用（版式代码共用），每项即一本书
    const movies = selection.map(m => ({
      key: keyOf(m),
      date: m.date,          // 'YYYY-MM-DD'，按月份 / 日历版式分组用
      poster: m.poster || '',
      title: m.title,
      year: m.year,
      // 署名行 + 标签胶囊（单本封面海报用）：作者 / 阅读进度（已读 N/M 页 · 已读 N 天）
      byline: m.author ? `作者 ${m.author}` : '',
      tags: [m.progressLabel, m.readDaysLabel].filter(Boolean),
      dateLabel: formatDateCN(m.date),
      watchDateText: readDateOf(m.date),
      rating: Number(m.rating) || 0,
      moodEmoji: m.moodEmoji || '',
      moodLabel: m.moodLabel || '',
      note: m.note || '',
      platformRatings: m.platformRatings || []
    }));
    this.posterData = { title: '我的阅读记录', subtitle, avgText, movies, customTitle: '', periodLead: '', totalCount, fullStats };

    // 单本书：记住完整豆瓣评分，按开关整体隐藏
    let hasRatings = false;
    if (this._isSingle && n) {
      this._rawRatings = movies[0].platformRatings || [];
      hasRatings = this._rawRatings.length > 0;
      this._applyRatingsFilter();
    }
    const size = this._isSingle
      ? BookPosterDrawer.computeSize(Math.max(1, n))
      : BookPosterDrawer.computeLayoutSize(this._layout(), movies);
    this._canvasW = size.width;
    this._canvasH = size.height;
    return { hasRatings };
  },

  // 计算预览尺寸：宽 = 页面内容宽（与上方选项面板左右对齐）。单本用固定高度的预览槽
  // （= previewW*1.5，容纳 3:4 与原始封面比例），画布在槽内居中——切换比例时下方控件不跳动。
  _previewSizePatch() {
    const screenW = getWindowInfoCompat().windowWidth || 375;
    const maxW = Math.round(screenW * (1 - 64 / 750));   // .content 左右各 32rpx
    let previewW = maxW;
    let previewH = Math.round(maxW * this._canvasH / this._canvasW);
    let slotH;
    if (this._isSingle) {
      slotH = Math.round(maxW * 1.5);
      if (previewH > slotH) {                       // 极窄封面：限高、按比例收窄
        previewH = slotH;
        previewW = Math.round(slotH * this._canvasW / this._canvasH);
      }
    } else {
      slotH = previewH;                             // 长图：槽高跟内容
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

  onPickLayout(e) {
    const layout = e.currentTarget.dataset.layout;
    if (!layout || layout === this.data.posterLayout) return;
    if (layout === 'calendar' && !this.data.calendarOk) { toast.show(this, '日历版式只在「月度」范围下可用'); return; }
    if (!this.data.ready) return;
    try { wx.setStorageSync(LAYOUT_STORAGE_KEY, layout); } catch (err) {}
    const wasCal = this._layout() === 'calendar';
    this.setData({ posterLayout: layout, ready: false });
    // 日历不去重（同一本书多天各占一格），其余版式按本去重：跨过日历边界要重筛
    if (wasCal !== (layout === 'calendar')) this._applyRange();
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

  // 依据开关整体隐藏单本书的豆瓣评分卡（改写 posterData 供绘制器读取）
  _applyRatingsFilter() {
    if (!this._isSingle || !this.posterData || !this.posterData.movies.length) return;
    this.posterData.movies[0].platformRatings =
      this._hideRatings ? [] : (this._rawRatings || []);
  },

  // 当前生效的版式（单本没有版式概念，恒为 whole；日历只在月度下生效）
  _layout() {
    if (this._isSingle) return 'whole';
    const l = this.data.posterLayout;
    if (l === 'calendar' && !this.data.calendarOk) return 'whole';
    return LAYOUTS.indexOf(l) >= 0 ? l : 'whole';
  },

  // 自定义标题：输入时只记值，失焦/回车再重绘（避免每敲一个字就出一张图）
  onTitleInput(e) {
    const v = String(e.detail.value || '').slice(0, TITLE_MAX);
    this.setData({ customTitle: v });
  },
  onTitleCommit() {
    const v = String(this.data.customTitle || '').trim().slice(0, TITLE_MAX);
    if (!this.posterData || v === (this.posterData.customTitle || '')) return;
    this.posterData.customTitle = v;
    if (!this.data.ready) { this._titleDirty = true; return; }
    this.setData({ ready: false });
    this.generatePoster();
  },

  // 依据模式确定画布尺寸：raw 单本跟随封面真实比例（不裁切）；长图版式高随内容；其余走 3:4
  _resolveCanvasSize() {
    const layout = this._layout();
    const movies = this.posterData.movies;
    const base = (this._isSingle || (layout === 'whole' && movies.length))
      ? BookPosterDrawer.computeSize(Math.max(1, movies.length))
      : BookPosterDrawer.computeLayoutSize(layout, movies);
    let W = base.width, H = base.height;
    if (this.data.posterMode === 'raw' && this._isSingle && movies.length) {
      const node = this._coverNodes[movies[0].key];
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
        wx.createSelectorQuery().in(this).select('#bookCard').fields({ node: true, size: true }).exec(res => {
          if (!res || !res[0] || !res[0].node) reject(new Error('Canvas 节点获取失败'));
          else resolve(res[0].node);
        });
      });
      if (this._destroyed) return;
      const ctx = canvas.getContext('2d');

      // 只加载还没缓存的封面（createImage 不依赖画布尺寸；切范围/主题/版式重绘复用）
      await this._ensureCovers(canvas, ctx, this.posterData.movies);
      if (this._destroyed) return;

      // 封面就绪后再定画布尺寸（raw 单本要用封面真实比例），随后同步预览框
      this._resolveCanvasSize();
      canvas.width = this._canvasW;
      canvas.height = this._canvasH;
      this._syncPreviewToCanvas();

      const drawer = new BookPosterDrawer(canvas, ctx, this._canvasW, this._canvasH);
      drawer.draw(this.posterData, this._coverNodes, this.data.themeId, this._layout());

      await new Promise(resolve => {
        canvas.requestAnimationFrame(() => canvas.requestAnimationFrame(resolve));
      });
      if (this._destroyed) return;
      const res = await wx.canvasToTempFilePath({ canvas, fileType: 'png', quality: 1 });
      if (this._destroyed) return;
      this._previewTemp = res.tempFilePath;
      this.safeSetData({ ready: true });
      if (this._titleDirty) { this._titleDirty = false; this.onTitleCommit(); }
    } catch (err) {
      console.error('read share render fail', err);
      this._rendered = false;
      if (!this._destroyed) {
        toast.show(this, '生成失败');
        this.safeSetData({ ready: true });   // 别把控件锁死，让用户能换个范围/版式再试
      }
    }
  },

  // 加载缺失的封面为 image 节点。仅信任云存储（cloud://）封面：换成临时链接后加载；
  // 豆瓣等直链一律占位——canvas 不做 downloadFile，避免依赖域名白名单（syncDailyLog 写入时已把 meta.cover 镜像成 cloud://）。
  async _ensureCovers(canvas, ctx, movies) {
    const nodes = this._coverNodes;
    const pending = movies.filter(m => !(m.key in nodes));
    if (!pending.length) return;
    // 1. 收集 cloud:// 封面，映射 key→fileID
    const idByKey = {};
    const cloudIds = [];
    pending.forEach(m => {
      const raw = m.poster || '';
      if (raw && raw.indexOf('cloud://') === 0) {
        idByKey[m.key] = raw;
        if (cloudIds.indexOf(raw) < 0) cloudIds.push(raw);
      }
    });
    // 2. 批量换取临时链接（getTempFileURL 单次上限 50）
    const tempMap = {};
    for (let i = 0; i < cloudIds.length; i += 50) {
      try {
        const r = await wx.cloud.getTempFileURL({ fileList: cloudIds.slice(i, i + 50) });
        (r.fileList || []).forEach(f => { if (f.fileID && f.tempFileURL) tempMap[f.fileID] = f.tempFileURL; });
      } catch (e) {
        console.warn('getTempFileURL fail', e);
      }
    }
    // 3. 逐张加载（无 cloud 封面 / 换链失败 / 加载失败 → null，绘制器画占位）
    const helper = new CanvasHelper(canvas, ctx, { width: this._canvasW, height: this._canvasH });
    for (const m of pending) {
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
  },

  async saveImage() {
    if (this.data.isGenerating || this.data.empty) return;
    if (!this._previewTemp) { toast.show(this, '图片还没生成好'); return; }
    const hasGrant = await rewardedSaveGate.ensureGrant(this);
    if (!hasGrant) return;
    try {
      this.setData({ isGenerating: true });
      await wx.saveImageToPhotosAlbum({ filePath: this._previewTemp });
      toast.show(this, '已保存到相册', { icon: 'success' });
    } catch (err) {
      console.error('read share save fail', err);
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
