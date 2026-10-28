// 数值型每日主题 · 分享海报（?theme=steps&date=YYYY-MM-DD）
// 版式：单日 / 月度；配色：四套全站主题色，默认跟随当前主题，选过的本地记住。
// canvas 是原生组件、藏不住，直接拿它当屏幕预览（backing 1080×1440，CSS 缩放显示），导出的临时文件只给「保存到相册」用。
const toast = require('../../../utils/dailyToast.js');
const rewardedSaveGate = require('../../../utils/rewardedSaveGate.js');
const MetricPosterDrawer = require('../../../utils/metricPosterDrawer.js');
const palette = require('../../../utils/daily/palette.js');
const D = require('../../../utils/daily/date.js');
const M = require('../../../utils/daily/metric.js');
const C = require('./common.js');

const { width: CANVAS_W, height: CANVAS_H } = MetricPosterDrawer.SIZE;
const MAX_DAY_BACK = 400;

Page({
  data: {
    toast: { show: false, text: '', icon: '' },
    themeClass: '',
    themeId: 'steps',
    title: '',
    today: '',
    layout: 'day',
    date: '',
    periodLabel: '',
    canPrev: true,
    canNext: false,
    previewW: 300,
    previewH: 400,
    ready: false,
    empty: false,
    emptyText: '',
    isGenerating: false,
    needRewardedAd: false,
    colors: palette.LIST,
    colorId: palette.DEFAULT_ID
  },

  onLoad(options) {
    const theme = C.resolveTheme(options && options.theme);
    this.theme = theme;
    this._storageKey = theme.id + 'ShareTheme';
    const today = D.todayStr();
    const date = options && options.date && options.date <= today ? options.date : today;
    const win = D.getWindowInfoCompat();
    const previewW = Math.min(Math.round((win.windowWidth || 375) * 0.84), 340);
    let colorId = palette.idFromClass(palette.currentClass());
    try {
      const saved = wx.getStorageSync(this._storageKey);
      if (saved && palette.THEMES[saved]) colorId = saved;
    } catch (e) { /* ignore */ }
    this.setData({
      themeClass: C.themeState().themeClass,
      themeId: theme.id,
      title: '分享' + theme.title,
      emptyText: theme.vocab.emptyText,
      today,
      date,
      previewW,
      previewH: Math.round(previewW * CANVAS_H / CANVAS_W),
      colorId
    });
    rewardedSaveGate.refreshHint(this);
    this.fetch();
  },

  onReady() {
    this._ready = true;
    this.render();
  },

  onUnload() {
    this._destroyed = true;
  },

  onShareAppMessage() {
    return { title: `我的${this.theme.title}`, path: `/pages/daily/metric/index?theme=${this.data.themeId}` };
  },

  // ========= 选项 =========
  onLayout(e) {
    const layout = e.currentTarget.dataset.layout;
    if (layout === this.data.layout) return;
    this.setData({ layout });
    this.fetch();
  },
  onPrev() {
    if (!this.data.canPrev) return;
    this._shift(-1);
  },
  onNext() {
    if (!this.data.canNext) return;
    this._shift(1);
  },
  _shift(delta) {
    const { layout, date, today } = this.data;
    let next;
    if (layout === 'day') {
      next = D.addDays(date, delta);
    } else {
      const n = D.addMonths(Number(date.slice(0, 4)), Number(date.slice(5, 7)), delta);
      next = D.ymd(n.year, n.month, 1);
    }
    this.setData({ date: next > today ? today : next });
    this.fetch();
  },
  onColor(e) {
    const id = e.currentTarget.dataset.id;
    if (id === this.data.colorId) return;
    try { wx.setStorageSync(this._storageKey, id); } catch (err) { /* ignore */ }
    this.setData({ colorId: id });
    this.render();
  },

  // ========= 数据 =========
  async fetch() {
    const { layout, date, today, themeId } = this.data;
    const isDay = layout === 'day';
    const y = Number(date.slice(0, 4)), m = Number(date.slice(5, 7));
    const range = isDay ? { from: date, to: date } : D.monthRange(y, m);
    this.setData({
      ready: false,
      periodLabel: isDay ? `${D.formatDateCN(date)} ${D.weekdayCN(date)}` : D.formatMonthLabel(y, m),
      canPrev: isDay ? D.daysBetween(date, today) < MAX_DAY_BACK : D.daysBetween(range.from, today) < MAX_DAY_BACK,
      canNext: isDay ? date < today : range.to < today
    });
    const seq = (this._seq || 0) + 1;
    this._seq = seq;
    try {
      const r = await C.callDaily({ action: 'getRange', theme: themeId, from: range.from, to: range.to });
      if (this._destroyed || seq !== this._seq) return;
      const goal = (r.settings && r.settings.daily_goal) || this.theme.defaultGoal;
      const map = M.toDayMap(r.days);
      const eq = this.theme.vocab.equivalent;
      const eqText = v => (eq && v > 0 ? `${eq.label} ${M.equivalentOf(v, eq)} ${eq.unit}` : '');
      if (isDay) {
        const has = date in map;
        const value = map[date] || 0;
        this._poster = has ? {
          layout: 'day',
          title: `${date.slice(0, 4)}年${D.formatDateCN(date)} ${D.weekdayCN(date)}`,
          value,
          goal,
          unit: this.theme.unit,
          cheer: this.theme.cheerFor ? this.theme.cheerFor(goal > 0 ? value / goal : 0, value, goal) : '',
          equivalentText: eqText(value)
        } : { layout: 'empty', title: `${date.slice(0, 4)}年${D.formatDateCN(date)} ${D.weekdayCN(date)}` };
      } else {
        const summary = M.summarize(map, range.from, range.to, goal, today);
        this._poster = summary.dataDays ? {
          layout: 'month',
          title: D.formatMonthLabel(y, m),
          unit: this.theme.unit,
          goal,
          cells: M.buildMonthCells(y, m, map, goal, today),
          summary,
          equivalentText: eqText(summary.total)
        } : { layout: 'empty', title: D.formatMonthLabel(y, m) };
      }
      this.setData({ empty: this._poster.layout === 'empty' });
      this.render();
    } catch (err) {
      if (seq !== this._seq) return;
      console.warn('[metric share] fetch fail', err);
      toast.show(this, '加载失败');
    }
  },

  // ========= 出图 =========
  async render() {
    if (!this._ready || this._destroyed || !this._poster) return;
    const seq = (this._renderSeq || 0) + 1;
    this._renderSeq = seq;
    try {
      const canvas = await new Promise((resolve, reject) => {
        wx.createSelectorQuery().in(this).select('#metricPoster').fields({ node: true }).exec(res => {
          if (res && res[0] && res[0].node) resolve(res[0].node);
          else reject(new Error('Canvas 节点获取失败'));
        });
      });
      if (this._destroyed || seq !== this._renderSeq) return;
      canvas.width = CANVAS_W;
      canvas.height = CANVAS_H;
      const ctx = canvas.getContext('2d');
      new MetricPosterDrawer(canvas, ctx).draw(this._poster, palette.get(this.data.colorId), this.theme.vocab);
      // 双帧让绘制提交到 bitmap，避免导出空白
      await new Promise(resolve => canvas.requestAnimationFrame(() => canvas.requestAnimationFrame(resolve)));
      if (this._destroyed || seq !== this._renderSeq) return;
      const out = await wx.canvasToTempFilePath({ canvas, fileType: 'png', quality: 1 });
      if (this._destroyed || seq !== this._renderSeq) return;
      this._tempPath = out.tempFilePath;
      this.setData({ ready: true });
    } catch (err) {
      console.error('[metric share] render fail', err);
      if (!this._destroyed) toast.show(this, '生成失败');
    }
  },

  async saveImage() {
    if (this.data.isGenerating) return;
    if (this.data.empty) {
      toast.show(this, this.data.emptyText);
      return;
    }
    if (!this._tempPath || !this.data.ready) {
      toast.show(this, '图片还没生成好');
      return;
    }
    const granted = await rewardedSaveGate.ensureGrant(this);
    if (!granted) return;
    try {
      this.setData({ isGenerating: true });
      await wx.saveImageToPhotosAlbum({ filePath: this._tempPath });
      toast.show(this, '已保存到相册', { icon: 'success' });
    } catch (err) {
      console.error('[metric share] save fail', err);
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
      if (!this._destroyed) this.setData({ isGenerating: false });
    }
  }
});
