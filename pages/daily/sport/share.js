const toast = require('../../../utils/dailyToast.js');
const rewardedSaveGate = require('../../../utils/rewardedSaveGate.js');
const SportPosterDrawer = require('../../../utils/sportPosterDrawer.js');
const { getNavMetrics, getWindowInfoCompat, todayStr, formatDateCN, flattenSports } = require('./common.js');

const CANVAS_W = 1080;
const CANVAS_H = 1440;
const WEEK_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const THEME_STORAGE_KEY = 'sportShareTheme';

// 右下角运动插画池 —— 把图片放进 pages/daily/sport/illus/ 后，在这里登记文件路径即可。
// 要求：PNG 透明底、四周裁紧；建议宽≈720px。留空则不画插画（海报照常居中）。
// 选图按日期稳定（同一天每次出图一致，便于反复分享）。
const SPORT_ILLUS = [
  // '/pages/daily/sport/illus/run.png',
  // '/pages/daily/sport/illus/kettlebell.png',
  // '/pages/daily/sport/illus/benchpress.png',
];

function pickIllus(dateStr) {
  if (!SPORT_ILLUS.length) return null;
  let sum = 0;
  for (let i = 0; i < String(dateStr).length; i++) sum += String(dateStr).charCodeAt(i);
  return SPORT_ILLUS[sum % SPORT_ILLUS.length];
}

// 运动向激励短句池（按日期稳定取一句，便于分享）
const CHEERS = [
  '坚持，是看得见的复利',
  '今天的汗水，明天的底气',
  '动起来，就已经赢了一半',
  '自律给我自由',
  '日拱一卒，不负光阴',
  '把运动变成习惯，把习惯变成热爱',
  '强大的身体，藏着自律的灵魂'
];

function weekdayOf(dateStr) {
  const p = String(dateStr || '').split('-').map(Number);
  if (p.length < 3 || p.some(isNaN)) return '';
  return WEEK_CN[new Date(p[0], p[1] - 1, p[2]).getDay()];
}

function pickCheer(dateStr) {
  let sum = 0;
  for (let i = 0; i < String(dateStr).length; i++) sum += String(dateStr).charCodeAt(i);
  return CHEERS[sum % CHEERS.length];
}

Page({
  data: {
    toast: { show: false, text: '', icon: '' },
    statusBarHeight: 20,
    navBarHeight: 48,
    navOffset: 68,

    date: '',
    loading: true,
    ready: false,
    previewW: 300,
    previewH: 400,
    isGenerating: false,
    needRewardedAd: false,

    themes: SportPosterDrawer.THEMES,   // [{ id, name, swatch }]
    themeId: SportPosterDrawer.DEFAULT_THEME
  },

  dayData: null,
  _ready: false,
  _rendered: false,
  _destroyed: false,

  // 页面已卸载后禁止再 setData，避免 "parent not found" 报错
  safeSetData(obj) {
    if (this._destroyed) return;
    this.setData(obj);
  },

  onUnload() {
    this._destroyed = true;
  },

  onLoad(options) {
    const nav = getNavMetrics();
    const date = (options && options.date) || todayStr();
    // 预览显示尺寸：按屏宽自适应，保持 3:4，封顶 340px
    const win = getWindowInfoCompat();
    const screenW = win.windowWidth || 375;
    const previewW = Math.min(Math.round(screenW * 0.84), 340);
    const previewH = Math.round(previewW * CANVAS_H / CANVAS_W);
    // 上次选过的主题色（本地记住），无则用默认
    let themeId = SportPosterDrawer.DEFAULT_THEME;
    try {
      const saved = wx.getStorageSync(THEME_STORAGE_KEY);
      if (saved && this.data.themes.some(t => t.id === saved)) themeId = saved;
    } catch (e) {}
    this.setData({
      statusBarHeight: nav.statusBarHeight,
      navBarHeight: nav.navBarHeight,
      navOffset: nav.navOffset,
      previewW,
      previewH,
      date,
      themeId
    });
    wx.setNavigationBarColor({ frontColor: '#000000', backgroundColor: '#FAFBFF' });
    wx.setNavigationBarTitle({ title: '分享运动卡片' });
    rewardedSaveGate.refreshHint(this);
    this.fetchDay();
  },

  onReady() {
    // 首屏渲染完成后才允许出图（与 growth/result 一致：在视图树稳定后再查 canvas 节点绘制）
    this._ready = true;
    this.maybeGenerate();
  },

  onBack() {
    if (getCurrentPages().length > 1) wx.navigateBack();
    else wx.redirectTo({ url: '/pages/daily/sport/index' });
  },

  onShareAppMessage() {
    return {
      title: '我的每日运动打卡',
      path: '/pages/daily/sport/index'
    };
  },

  // 切换主题色：更新选中态 → 本地记住 → 用新配色重绘 canvas
  onPickTheme(e) {
    const id = e.currentTarget.dataset.id;
    if (!id || id === this.data.themeId) return;
    // 卡片还没首次出图，或正在重绘，先不响应（避免并发查节点）
    if (!this.data.ready || !this.dayData) return;
    try { wx.setStorageSync(THEME_STORAGE_KEY, id); } catch (err) {}
    this.setData({ themeId: id, ready: false });
    this.generatePoster();
  },

  fetchDay() {
    const date = this.data.date;
    wx.cloud.callFunction({
      name: 'syncDailyLog',
      data: { action: 'getRange', theme: 'sport', from: date, to: date },
      success: res => {
        if (this._destroyed) return;
        const result = res && res.result;
        const days = (result && result.days) || [];
        const entries = flattenSports(days);
        if (!entries.length) {
          wx.showModal({
            title: '没有记录',
            content: '这一天还没有运动记录',
            showCancel: false,
            success: () => this.onBack()
          });
          return;
        }
        this.dayData = {
          dateLabel: formatDateCN(date),
          weekdayLabel: weekdayOf(date),
          count: entries.length,
          entries: entries.map(e => ({
            category: e.category,
            icon: e.icon,
            typeName: e.typeName,
            duration: e.duration,
            distance: e.distance,
            distanceUnit: e.distanceUnit,
            sets: e.sets,
            reps: e.reps,
            weight: e.weight
          })),
          cheer: pickCheer(date)
        };
        this.safeSetData({ loading: false });
        this.maybeGenerate();
      },
      fail: err => {
        if (this._destroyed) return;
        console.error('sport share getRange fail', err);
        toast.show(this, '加载失败');
      }
    });
  },

  // 仅当「首屏已渲染」且「数据已就绪」时才出图，且只出一次
  maybeGenerate() {
    if (this._rendered || this._destroyed) return;
    if (!this._ready || !this.dayData) return;
    this._rendered = true;
    this.generatePoster();
  },

  // 查节点 → 绘制 → 导出 → 预览（与 growth/result 同步骤，避免渲染期 setData 竞态）
  async generatePoster() {
    try {
      const canvas = await new Promise((resolve, reject) => {
        wx.createSelectorQuery().in(this).select('#sportCard').fields({ node: true, size: true }).exec(res => {
          if (!res || !res[0] || !res[0].node) reject(new Error('Canvas 节点获取失败'));
          else resolve(res[0].node);
        });
      });
      if (this._destroyed) return;
      canvas.width = CANVAS_W;
      canvas.height = CANVAS_H;
      const ctx = canvas.getContext('2d');

      // 右下角插画（按日期随机选一张；加载失败则不画）
      const illus = await this._loadIllus(canvas, pickIllus(this.data.date));
      if (this._destroyed) return;

      const drawer = new SportPosterDrawer(canvas, ctx, CANVAS_W, CANVAS_H);
      drawer.draw(this.dayData, illus, this.data.themeId);

      // 双帧让 Canvas 2D 把绘制提交到 bitmap，避免导出空白
      await new Promise(resolve => {
        canvas.requestAnimationFrame(() => canvas.requestAnimationFrame(resolve));
      });
      if (this._destroyed) return;
      // canvas 已直接显示在屏幕上；再导出一份临时文件供「保存到相册」用
      const res = await wx.canvasToTempFilePath({ canvas, fileType: 'png', quality: 1 });
      if (this._destroyed) return;
      this._previewTemp = res.tempFilePath;
      this.safeSetData({ ready: true });
    } catch (err) {
      console.error('sport share render fail', err);
      this._rendered = false;
      if (!this._destroyed) toast.show(this, '生成失败');
    }
  },

  // 加载本地插画为 canvas Image；无路径或失败都返回 null（海报照常出图）
  _loadIllus(canvas, path) {
    return new Promise(resolve => {
      if (!path || !canvas || !canvas.createImage) return resolve(null);
      const img = canvas.createImage();
      img.onload = () => resolve(img);
      img.onerror = () => { console.warn('sport illus load fail:', path); resolve(null); };
      img.src = path;
    });
  },

  async saveImage() {
    if (this.data.isGenerating) return;
    if (!this._previewTemp) {
      toast.show(this, '图片还没生成好');
      return;
    }
    const hasGrant = await rewardedSaveGate.ensureGrant(this);
    if (!hasGrant) return;

    try {
      this.setData({ isGenerating: true });
      await wx.saveImageToPhotosAlbum({ filePath: this._previewTemp });
      toast.show(this, '已保存到相册', { icon: 'success' });
    } catch (err) {
      console.error('sport share save fail', err);
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
