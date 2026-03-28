const { formatAge } = require('../../../utils/growthCalculator.js');

Page({
  onLoad() {
    wx.setNavigationBarTitle({ title: '儿童生长发育评估' });
  },

  onShareAppMessage() {
    return {
      title: '儿童生长发育评估 - 依据国家标准精准评估',
      path: '/pages/growth/input/input'
    };
  },

  data: {
    gender: 'male',
    // 年龄picker
    yearRange: ['0岁', '1岁', '2岁', '3岁', '4岁', '5岁', '6岁'],
    monthRange: ['0月', '1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月'],
    yearIndex: 0,
    monthIndex: 0,
    ageMonths: 0,
    ageText: '0月龄',
    // 输入值
    weight: '',
    height: '',
    headCirc: '',
    // 是否显示头围
    showHeadCirc: true
  },

  onGenderTap(e) {
    const gender = e.currentTarget.dataset.gender;
    this.setData({ gender });
  },

  onYearChange(e) {
    const yearIndex = parseInt(e.detail.value);
    this.setData({ yearIndex });
    this.updateAge();
  },

  onMonthChange(e) {
    const monthIndex = parseInt(e.detail.value);
    this.setData({ monthIndex });
    this.updateAge();
  },

  updateAge() {
    const { yearIndex, monthIndex } = this.data;
    let ageMonths = yearIndex * 12 + monthIndex;
    // 最大83月（6岁11月）
    if (ageMonths > 83) ageMonths = 83;
    const ageText = formatAge(ageMonths);
    const showHeadCirc = ageMonths <= 36;
    this.setData({ ageMonths, ageText, showHeadCirc });
    // 如果超过3岁，清空头围
    if (!showHeadCirc) {
      this.setData({ headCirc: '' });
    }
  },

  onWeightInput(e) {
    this.setData({ weight: e.detail.value });
  },

  onHeightInput(e) {
    this.setData({ height: e.detail.value });
  },

  onHeadCircInput(e) {
    this.setData({ headCirc: e.detail.value });
  },

  onSubmit() {
    const { gender, ageMonths, weight, height, headCirc, showHeadCirc } = this.data;

    // 校验
    const w = parseFloat(weight);
    const h = parseFloat(height);
    const hc = showHeadCirc ? parseFloat(headCirc) : null;

    if (!weight || isNaN(w) || w < 1 || w > 50) {
      wx.showToast({ title: '请输入有效体重(1-50kg)', icon: 'none' });
      return;
    }
    if (!height || isNaN(h) || h < 40 || h > 135) {
      wx.showToast({ title: '请输入有效身高(40-135cm)', icon: 'none' });
      return;
    }
    if (showHeadCirc && headCirc && !isNaN(hc)) {
      if (hc < 25 || hc > 55) {
        wx.showToast({ title: '请输入有效头围(25-55cm)', icon: 'none' });
        return;
      }
    }

    const inputData = {
      gender,
      ageMonths,
      weight: w,
      height: h,
      headCirc: (showHeadCirc && headCirc) ? hc : null
    };

    // 存储数据到全局（兼容旧逻辑）
    const app = getApp();
    app.globalData = app.globalData || {};
    app.globalData.growthInput = inputData;

    // 同时通过 URL 参数传递（支持独立访问，利于 SEO）
    let url = `/pages/growth/result/result?gender=${gender}&ageMonths=${ageMonths}&weight=${w}&height=${h}`;
    if (inputData.headCirc) url += `&headCirc=${inputData.headCirc}`;
    wx.navigateTo({ url });
  }
});
