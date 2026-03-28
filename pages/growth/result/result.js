const { evaluate, formatAge } = require('../../../utils/growthCalculator.js');
const GrowthPosterDrawer = require('../../../utils/growthPosterDrawer.js');

Page({
  data: {
    input: null,
    results: null,
    indicators: [],
    nutrition: null,
    genderText: '',
    ageText: '',
    genderIcon: '',
    showRange: false,
    isGenerating: false
  },

  onLoad(options) {
    wx.setNavigationBarTitle({ title: '生长发育评估结果' });

    // 优先从 URL 参数读取（SEO 爬虫可独立访问），其次从 globalData 读取
    let input;
    if (options.gender && options.ageMonths && options.weight && options.height) {
      input = {
        gender: options.gender,
        ageMonths: parseInt(options.ageMonths),
        weight: parseFloat(options.weight),
        height: parseFloat(options.height),
        headCirc: options.headCirc ? parseFloat(options.headCirc) : null
      };
    } else {
      const app = getApp();
      input = app.globalData?.growthInput;
    }

    if (!input) {
      wx.showModal({
        title: '数据错误',
        content: '请重新输入评估数据',
        showCancel: false,
        success: () => wx.navigateBack()
      });
      return;
    }

    const results = evaluate(input.gender, input.ageMonths, input.weight, input.height, input.headCirc);

    // 构建指标列表
    const indicators = [];
    const keys = ['weightForAge', 'heightForAge', 'bmiForAge', 'headCircForAge'];
    for (const key of keys) {
      if (results[key]) {
        indicators.push(results[key]);
      }
    }

    this.setData({
      input,
      results,
      indicators,
      nutrition: results.nutrition,
      genderText: input.gender === 'male' ? '男' : '女',
      genderIcon: input.gender === 'male' ? '♂' : '♀',
      ageText: formatAge(input.ageMonths)
    });
  },

  onToggleRange() {
    this.setData({ showRange: !this.data.showRange });
  },

  async onSavePoster() {
    if (this.data.isGenerating) return;
    const { input, results } = this.data;
    if (!input || !results) {
      wx.showToast({ title: '数据未准备好', icon: 'none' });
      return;
    }

    try {
      this.setData({ isGenerating: true });
      wx.showLoading({ title: '生成海报中...', mask: true });

      // 获取离屏 Canvas
      const canvas = await new Promise((resolve, reject) => {
        const query = wx.createSelectorQuery().in(this);
        query.select('#posterCanvas').fields({ node: true, size: true }).exec(res => {
          if (!res || !res[0] || !res[0].node) {
            reject(new Error('Canvas节点获取失败'));
            return;
          }
          resolve(res[0].node);
        });
      });

      const W = 1242, H = 1660;
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext('2d');

      // 绘制海报
      const drawer = new GrowthPosterDrawer(canvas, ctx, W, H);
      const ageText = formatAge(input.ageMonths);
      drawer.draw(input, results, ageText);

      // 等待渲染完成
      await new Promise(resolve => setTimeout(resolve, 300));

      // 导出图片
      const res = await wx.canvasToTempFilePath({
        canvas: canvas,
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
  },

  onShareAppMessage() {
    const { input } = this.data;
    if (input) {
      let path = `/pages/growth/result/result?gender=${input.gender}&ageMonths=${input.ageMonths}&weight=${input.weight}&height=${input.height}`;
      if (input.headCirc) path += `&headCirc=${input.headCirc}`;
      return {
        title: `${this.data.genderText}宝宝${this.data.ageText}生长发育评估报告`,
        path
      };
    }
    return {
      title: '儿童生长发育评估',
      path: '/pages/growth/input/input'
    };
  },

  onBackTap() {
    wx.navigateBack();
  }
});
