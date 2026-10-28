// 每日主题 · 自定义导航栏：固定在顶部 + 同高占位，页面不用再自己算 navOffset 留白
const D = require('../../../utils/daily/date.js');

Component({
  properties: {
    title: { type: String, value: '' },
    // 直接打开（没有上一页）时返回去哪；默认首页
    fallback: { type: String, value: '/pages/category/category' }
  },
  data: { statusBarHeight: 20, navBarHeight: 48, navOffset: 68 },
  lifetimes: {
    attached() {
      const n = D.getNavMetrics();
      this.setData({ statusBarHeight: n.statusBarHeight, navBarHeight: n.navBarHeight, navOffset: n.navOffset });
    }
  },
  methods: {
    onBack() {
      if (getCurrentPages().length > 1) wx.navigateBack();
      else wx.reLaunch({ url: this.data.fallback });
    }
  }
});
