// 自定义底部 tab：取代原生 tabBar，唯一目的是能按云端开关隐藏「记录」tab
// （app_config.showRecordsTab，默认 false = 提审包里不出现，过审后云端打开）。
// 外观对齐原来的原生 tabBar：灰字 #77776D、底色 #FAFAFA、选中色与选中图标随主题色。
// 各 tab 页 onShow 经 hubStore.applyTabStyle → sync(kind, theme) 推选中态。
const adConfig = require('../utils/adConfig');

const TABS = [
  { kind: 'home', text: '首页', path: '/pages/category/category' },
  { kind: 'discover', text: '分类', path: '/pages/discover/index' },
  { kind: 'records', text: '记录', path: '/pages/records/index' },
  { kind: 'profile', text: '我的', path: '/pages/profile/index' }
];
const SELECTED_COLOR = { 'theme-green': '#526631', 'theme-gold': '#856216', 'theme-sand': '#756448', '': '#9F4865' };
const ICON_SUFFIX = { 'theme-green': '', 'theme-gold': '-gold', 'theme-sand': '-sand', '': '-pink' };

function buildTabs(theme) {
  const suffix = ICON_SUFFIX[theme] == null ? '' : ICON_SUFFIX[theme];
  return TABS.filter(t => t.kind !== 'records' || adConfig.shouldShowRecordsTab()).map(t => ({
    kind: t.kind,
    text: t.text,
    path: t.path,
    icon: '/images/tabs/' + t.kind + '.png',
    activeIcon: '/images/tabs/' + t.kind + '-active' + suffix + '.png'
  }));
}

Component({
  data: { tabs: [], selected: '', theme: 'theme-green', selectedColor: SELECTED_COLOR['theme-green'] },
  lifetimes: {
    attached() {
      const app = getApp();
      const theme = app && app.globalData && app.globalData.theme != null ? app.globalData.theme : 'theme-green';
      this._render(this.data.selected, theme);
      // 云端配置晚于首屏到达时（首次装机、或刚在云端打开开关），即时增减「记录」tab
      this._onConfig = () => this._render(this.data.selected, this.data.theme);
      adConfig.onRemoteApplied(this._onConfig);
    },
    detached() { adConfig.offRemoteApplied(this._onConfig); }
  },
  methods: {
    sync(kind, theme) { this._render(kind, theme == null ? 'theme-green' : theme); },
    _render(kind, theme) {
      this.setData({
        tabs: buildTabs(theme),
        selected: kind || '',
        theme,
        selectedColor: SELECTED_COLOR[theme] || SELECTED_COLOR['theme-green']
      });
    },
    onTap(e) {
      const { kind, path } = e.currentTarget.dataset;
      if (kind === this.data.selected) return;
      wx.switchTab({ url: path });
    }
  }
});
