const { evaluate, formatAge } = require('../../../utils/growthCalculator.js');

Page({
  data: {
    input: null,
    results: null,
    indicators: [],
    nutrition: null,
    genderText: '',
    ageText: '',
    genderIcon: '',
    showRange: false
  },

  onLoad() {
    const app = getApp();
    const input = app.globalData?.growthInput;
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

  onShareTap() {
    wx.navigateTo({
      url: '/pages/growth/share/share'
    });
  },

  onBackTap() {
    wx.navigateBack();
  }
});
