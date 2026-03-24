const { evaluate, formatAge } = require('../../../utils/growthCalculator.js');
const GrowthPosterDrawer = require('../../../utils/growthPosterDrawer.js');

Page({
  data: {
    canvasWidth: 750,
    canvasHeight: 1200,
    isGenerating: false
  },

  canvas: null,
  ctx: null,
  input: null,
  results: null,
  ageText: '',

  onLoad() {
    const app = getApp();
    this.input = app.globalData?.growthInput;
    if (!this.input) {
      wx.showModal({
        title: '数据错误',
        content: '请重新输入评估数据',
        showCancel: false,
        success: () => wx.navigateBack()
      });
      return;
    }
    this.results = evaluate(this.input.gender, this.input.ageMonths, this.input.weight, this.input.height, this.input.headCirc);
    this.ageText = formatAge(this.input.ageMonths);

    // 动态计算画布高度
    const indicatorCount = ['weightForAge', 'heightForAge', 'weightForHeight', 'bmiForAge', 'headCircForAge']
      .filter(k => this.results[k]).length;
    const canvasHeight = 240 + 110 + (indicatorCount * 152) + 80;
    this.setData({ canvasHeight });
  },

  async onReady() {
    await new Promise(resolve => setTimeout(resolve, 300));
    await this.initCanvas();
  },

  initCanvas() {
    return new Promise((resolve, reject) => {
      const query = wx.createSelectorQuery().in(this);
      query.select('#growthCanvas').fields({ node: true, size: true }).exec(res => {
        if (!res || !res[0] || !res[0].node) {
          reject(new Error('Canvas节点获取失败'));
          return;
        }
        const canvas = res[0].node;
        const ctx = canvas.getContext('2d');
        const { canvasWidth, canvasHeight } = this.data;
        canvas.width = canvasWidth;
        canvas.height = canvasHeight;
        this.canvas = canvas;
        this.ctx = ctx;
        resolve();
      });
    });
  },

  async saveImage() {
    if (this.data.isGenerating) return;
    if (!this.ctx || !this.input || !this.results) {
      wx.showToast({ title: '数据未准备好', icon: 'none' });
      return;
    }

    try {
      this.setData({ isGenerating: true });
      wx.showLoading({ title: '生成图片中...', mask: true });

      // 绘制
      const drawer = new GrowthPosterDrawer(this.canvas, this.ctx, this.data.canvasWidth, this.data.canvasHeight);
      drawer.draw(this.input, this.results, this.ageText);

      // 导出图片
      await new Promise(resolve => setTimeout(resolve, 200));
      const res = await wx.canvasToTempFilePath({
        canvas: this.canvas,
        fileType: 'png',
        quality: 1
      });

      // 保存到相册
      await wx.saveImageToPhotosAlbum({ filePath: res.tempFilePath });
      wx.showToast({ title: '已保存到相册', icon: 'success' });
    } catch (err) {
      console.error('保存失败:', err);
      if (err.errMsg && err.errMsg.includes('auth deny')) {
        wx.showModal({
          title: '权限提示',
          content: '需要授权保存图片到相册',
          confirmText: '去设置',
          success: (res) => {
            if (res.confirm) wx.openSetting();
          }
        });
      } else {
        wx.showToast({ title: '保存失败', icon: 'none' });
      }
    } finally {
      this.setData({ isGenerating: false });
      wx.hideLoading();
    }
  }
});
