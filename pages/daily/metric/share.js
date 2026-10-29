// 数值型每日主题 · 统计报表海报（?theme=steps）
// 统计页点「生成海报」时把页面当前的样子拍成快照（stats.js _snapshot，放在 globalData.metricReport），
// 这里按页面 1:1 画成一张长图（utils/metricReportPoster.js：宽 1080、高随内容，颜色跟当时的全站主题色），
// 只在底部加「搜索“标记吧”小程序，免费制作同款图」水印。没有任何可调项：要换周期 / 画法 / 缩放，回统计页调好再生成。
// canvas 是原生组件、藏不住，直接拿它当屏幕预览（CSS 缩放显示），导出的临时文件只给「保存到相册」用；
// 保存前要看激励视频（rewardedSaveGate，slot save_image_rewarded）。
const toast = require('../../../utils/dailyToast.js');
const rewardedSaveGate = require('../../../utils/rewardedSaveGate.js');
const ReportPoster = require('../../../utils/metricReportPoster.js');
const D = require('../../../utils/daily/date.js');
const C = require('./common.js');

Page({
  data: {
    toast: { show: false, text: '', icon: '' },
    themeClass: '',
    themeId: 'steps',
    title: '',
    previewW: 300,
    previewH: 400,
    ready: false,
    empty: false,
    emptyText: '',
    isGenerating: false,
    needRewardedAd: false
  },

  onLoad(options) {
    const theme = C.resolveTheme(options && options.theme);
    this.theme = theme;
    const app = getApp();
    const snap = app.globalData && app.globalData.metricReport;
    // 只认同一个主题的快照；没有（比如页面被系统回收后恢复）就提示回统计页重新生成
    this._snap = snap && snap.themeId === theme.id ? snap : null;
    this._height = this._snap ? ReportPoster.heightOf(this._snap) : Math.round(ReportPoster.WIDTH * 4 / 3);
    const win = D.getWindowInfoCompat();
    const previewW = Math.min(Math.round((win.windowWidth || 375) * 0.84), 340);
    this.setData({
      themeClass: C.themeState().themeClass,
      themeId: theme.id,
      title: theme.title + '海报',
      empty: !this._snap,
      emptyText: '请回到统计页重新点「生成海报」',
      previewW,
      previewH: Math.round(previewW * this._height / ReportPoster.WIDTH)
    });
    rewardedSaveGate.refreshHint(this);
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

  // ========= 出图 =========
  async render() {
    if (!this._ready || this._destroyed || !this._snap) return;
    try {
      const canvas = await new Promise((resolve, reject) => {
        wx.createSelectorQuery().in(this).select('#metricPoster').fields({ node: true }).exec(res => {
          if (res && res[0] && res[0].node) resolve(res[0].node);
          else reject(new Error('Canvas 节点获取失败'));
        });
      });
      if (this._destroyed) return;
      canvas.width = ReportPoster.WIDTH;
      canvas.height = this._height;
      ReportPoster.draw(canvas.getContext('2d'), this._snap);
      // 双帧让绘制提交到 bitmap，避免导出空白
      await new Promise(resolve => canvas.requestAnimationFrame(() => canvas.requestAnimationFrame(resolve)));
      if (this._destroyed) return;
      const out = await wx.canvasToTempFilePath({ canvas, fileType: 'png', quality: 1 });
      if (this._destroyed) return;
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
