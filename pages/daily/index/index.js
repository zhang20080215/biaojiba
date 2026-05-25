// pages/daily/index/index.js
// 每日打卡 · 主页（按 URL 参数 theme 加载对应配置）
// 视觉来自 Claude Design 「Water Tracker」交付稿：米白 + 粗黑描边 + 黄盖小水瓶
const { getTheme, ACCENT_HEX } = require('../../../utils/dailyThemes.js');
const { buildBottleSvg, buildCupSvg, PRESET_FILL_LEVELS } = require('../../../utils/dailyBottle.js');
const toast = require('../../../utils/dailyToast.js');

const WD_FULL = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

Page({
  data: {
    themeId: 'water',
    theme: null,
    accent: 'yellow',
    accentHex: ACCENT_HEX.yellow,

    toast: { show: false, text: '', icon: '' },

    statusBarHeight: 20,
    navBarHeight: 48,
    navOffset: 68,

    // 日期导航：0 = 今天，-1 = 昨天，最远 -29
    dayOffset: 0,
    canGoNext: false,
    canGoPrev: true,
    today: '',                  // 真实今日 YYYY-MM-DD
    viewDate: '',               // 当前查看日期 YYYY-MM-DD
    datePrimary: '今天',
    dateSecondary: '',

    // 数据
    totalValue: 0,
    goalValue: 2000,
    remaining: 2000,
    unit: 'ml',
    progress: 0,                // 0~1
    progressPct: 0,
    pctPercent: 0,              // 进度条 width 百分比（响应式）
    presets: [100, 200, 350],
    cupSvgs: ['', '', ''],      // 三个 quick preset 的杯子 SVG（按水位 0.25/0.55/0.9）
    isToday: true,
    loading: true,

    // 水瓶 SVG (data URL)
    bottleSvg: '',

    // 设置抽屉
    settingsOpen: false,
    draft: { goal: 2000, q1: 100, q2: 200, q3: 350 },
    goalRange: [500, 5000],
    goalStep: 100,
    presetRange: [50, 1000],
    presetStep: 50
  },

  onLoad(options) {
    const themeId = (options && options.theme) || 'water';
    const theme = getTheme(themeId);
    const navMetrics = this.getNavMetrics();
    this.theme = theme;

    const themeView = {
      id: theme.id,
      title: theme.title,
      unit: theme.unit,
      unitLabel: theme.unitLabel,
      tag: theme.tag,
      inverseGoal: theme.inverseGoal
    };

    wx.setNavigationBarColor({
      frontColor: theme.navTextStyle === 'white' ? '#ffffff' : '#000000',
      backgroundColor: theme.navBg
    });
    wx.setNavigationBarTitle({ title: theme.title });

    const accent = theme.accent || 'yellow';
    const accentHex = ACCENT_HEX[accent] || ACCENT_HEX.yellow;
    this.setData({
      themeId,
      theme: themeView,
      accent,
      accentHex,
      statusBarHeight: navMetrics.statusBarHeight,
      navBarHeight: navMetrics.navBarHeight,
      navOffset: navMetrics.navOffset,
      unit: theme.unit,
      goalRange: theme.goalRange,
      goalStep: theme.goalStep,
      presetRange: theme.presetRange,
      presetStep: theme.presetStep,
      presets: theme.defaultPresets.slice(),
      cupSvgs: PRESET_FILL_LEVELS.map(f => buildCupSvg(f)),
      goalValue: theme.defaultGoal,
      remaining: theme.defaultGoal,
      // 立刻渲染一个 0 进度的占位水瓶，避免等云函数返回前页面空白
      bottleSvg: buildBottleSvg(0, accentHex)
    });

    this.refresh();
  },

  onShow() {
    // 跨日：若 dayOffset=0（今日视图）但服务端口径下今天已经变了，
    // 清掉缓存的 today，让 refresh() 重新认锚
    if (this.data.dayOffset === 0 && this.data.today) {
      const realToday = this._dateForOffset(0);
      if (realToday !== this.data.today) this.setData({ today: '' });
    }
    if (!this.data.loading) this.refresh();
  },

  getNavMetrics() {
    const fallback = { statusBarHeight: 20, navBarHeight: 48, navOffset: 68 };
    try {
      const systemInfo = wx.getSystemInfoSync ? wx.getSystemInfoSync() : {};
      const statusBarHeight = systemInfo.statusBarHeight || fallback.statusBarHeight;
      let navBarHeight = fallback.navBarHeight;
      if (wx.getMenuButtonBoundingClientRect) {
        const menu = wx.getMenuButtonBoundingClientRect();
        if (menu && menu.top && menu.height) {
          navBarHeight = (menu.top - statusBarHeight) * 2 + menu.height;
        }
      }
      return {
        statusBarHeight,
        navBarHeight,
        navOffset: statusBarHeight + navBarHeight
      };
    } catch (err) {
      return fallback;
    }
  },

  onShareAppMessage() {
    const title = (this.theme && this.theme.title) || '每日喝水';
    return {
      title: `${title}，做更好的自己`,
      path: `/pages/daily/index/index?theme=${this.data.themeId}`
    };
  },

  onShareTimeline() {
    return {
      title: ((this.theme && this.theme.title) || '每日喝水') + '，分享我的健康日记',
      query: 'theme=' + this.data.themeId
    };
  },

  // ========= 拉数据 =========
  refresh() {
    this.setData({ loading: true });
    const target = this._dateForOffset(this.data.dayOffset);
    wx.cloud.callFunction({
      name: 'syncDailyLog',
      data: { action: 'getToday', theme: this.data.themeId, date: target },
      success: res => {
        if (!res.result || !res.result.success) {
          toast.show(this, '加载失败');
          this.setData({ loading: false });
          return;
        }
        const { today, settings, date } = res.result;
        // 真实今日 = 服务端在 dayOffset=0 时返回的 date
        if (this.data.dayOffset === 0 && !this.data.today) {
          this.setData({ today: date });
        }
        const totalValue = today.total_value || 0;
        const goalValue = (settings && settings.daily_goal) != null
          ? settings.daily_goal : this.theme.defaultGoal;
        const presets = (settings && settings.presets && settings.presets.length)
          ? settings.presets.slice() : this.theme.defaultPresets.slice();
        this.applyState({ totalValue, goalValue, presets, viewDate: date });
        this.setData({ loading: false });
      },
      fail: err => {
        console.error(err);
        toast.show(this, '网络异常');
        this.setData({ loading: false });
      }
    });
  },

  applyState({ totalValue, goalValue, presets, viewDate }) {
    const ratio = goalValue > 0 ? totalValue / goalValue : 0;
    const progress = Math.min(1, Math.max(0, ratio));
    const remaining = Math.max(0, goalValue - totalValue);
    const today = this.data.today || viewDate;
    const isToday = viewDate === today;

    const cupSvgs = PRESET_FILL_LEVELS.map(f => buildCupSvg(f));
    const dateLabel = this._formatDateLabel(viewDate, today);

    this.setData({
      viewDate,
      totalValue,
      goalValue,
      remaining,
      progress,
      progressPct: Math.round(progress * 100),
      pctPercent: progress * 100,
      presets,
      cupSvgs,
      isToday,
      datePrimary: dateLabel.primary,
      dateSecondary: dateLabel.secondary,
      canGoNext: this.data.dayOffset < 0,
      canGoPrev: this.data.dayOffset > -29,
      bottleSvg: buildBottleSvg(progress, this.data.accentHex),
      'draft.goal': goalValue,
      'draft.q1': presets[0] || this.theme.defaultPresets[0],
      'draft.q2': presets[1] || this.theme.defaultPresets[1],
      'draft.q3': presets[2] || this.theme.defaultPresets[2]
    });
  },

  // ========= 日期导航 =========
  onPrevDay() {
    if (!this.data.canGoPrev) return;
    this.setData({ dayOffset: this.data.dayOffset - 1 });
    this.refresh();
  },
  onNextDay() {
    if (!this.data.canGoNext) return;
    this.setData({ dayOffset: this.data.dayOffset + 1 });
    this.refresh();
  },
  onBackToToday() {
    if (this.data.dayOffset === 0) return;
    this.setData({ dayOffset: 0 });
    this.refresh();
  },

  // ========= 顶栏 =========
  onBack() {
    // 有上级页面 → 返回；否则回到分类首页（深链/分享场景兜底）
    if (getCurrentPages().length > 1) {
      wx.navigateBack();
    } else {
      wx.reLaunch({ url: '/pages/category/category' });
    }
  },
  onOpenStats() {
    wx.navigateTo({ url: `/pages/daily/stats/stats?theme=${this.data.themeId}` });
  },
  onOpenSettings() {
    this.setData({
      settingsOpen: true,
      'draft.goal': this.data.goalValue,
      'draft.q1': this.data.presets[0],
      'draft.q2': this.data.presets[1],
      'draft.q3': this.data.presets[2]
    });
  },
  onCloseSettings() {
    this.setData({ settingsOpen: false });
  },

  // ========= 步进控件 =========
  onStep(e) {
    const { field, dir } = e.currentTarget.dataset;
    const draft = this.data.draft;
    const value = Number(draft[field]) || 0;
    let step, min, max;
    if (field === 'goal') {
      step = this.data.goalStep;
      [min, max] = this.data.goalRange;
    } else {
      step = this.data.presetStep;
      [min, max] = this.data.presetRange;
    }
    const next = Math.max(min, Math.min(max, value + step * (dir === 'up' ? 1 : -1)));
    this.setData({ [`draft.${field}`]: next });
  },

  onSaveSettings() {
    const { goal, q1, q2, q3 } = this.data.draft;
    const presets = [Number(q1), Number(q2), Number(q3)].filter(n => Number.isFinite(n) && n > 0);
    wx.showLoading({ title: '保存中', mask: true });
    Promise.all([
      this._callCloud({ action: 'setGoal', theme: this.data.themeId, daily_goal: Number(goal) }),
      this._callCloud({ action: 'setPresets', theme: this.data.themeId, presets })
    ]).then(() => {
      wx.hideLoading();
      this.setData({ settingsOpen: false });
      this.applyState({
        totalValue: this.data.totalValue,
        goalValue: Number(goal),
        presets,
        viewDate: this.data.viewDate
      });
    }).catch(err => {
      wx.hideLoading();
      console.error(err);
      toast.show(this, '保存失败');
    });
  },

  // ========= 快捷记录 =========
  // 单飞：一次记录尚未完成前忽略后续 tap，避免连点导致重复 addEntry + 服务端并发写入。
  onPresetTap(e) {
    if (this._adding) return;
    const value = Number(e.currentTarget.dataset.value);
    if (!value) return;
    this._adding = true;
    const wasToday = this.data.isToday;
    const viewDate = this.data.viewDate;
    wx.cloud.callFunction({
      name: 'syncDailyLog',
      data: { action: 'addEntry', theme: this.data.themeId, date: viewDate, value },
      success: res => {
        if (!res.result || !res.result.success) {
          toast.show(this, '记录失败');
          return;
        }
        const day = res.result.day;
        const oldTotal = this.data.totalValue;
        this.applyState({
          totalValue: day.total_value,
          goalValue: this.data.goalValue,
          presets: this.data.presets,
          viewDate: this.data.viewDate
        });
        wx.vibrateShort && wx.vibrateShort({ type: 'light' });
        if (wasToday) {
          if (oldTotal < this.data.goalValue && day.total_value >= this.data.goalValue) {
            toast.show(this, '今日目标达成', { icon: 'success' });
          }
        } else {
          const [, m, d] = viewDate.split('-');
          toast.show(this, `已补录到 ${Number(m)}月${Number(d)}日`);
        }
      },
      fail: () => toast.show(this, '网络异常'),
      complete: () => { this._adding = false; }
    });
  },

  // ========= 辅助 =========
  _callCloud(payload) {
    return new Promise((resolve, reject) => {
      wx.cloud.callFunction({
        name: 'syncDailyLog',
        data: payload,
        success: res => {
          if (res.result && res.result.success) resolve(res.result);
          else reject(new Error((res.result && res.result.error) || 'cloud-fail'));
        },
        fail: reject
      });
    });
  },

  _dateForOffset(offset) {
    const now = new Date(Date.now() + 8 * 3600 * 1000);
    const utcMid = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    utcMid.setUTCDate(utcMid.getUTCDate() + offset);
    return utcMid.toISOString().slice(0, 10);
  },

  _formatDateLabel(viewDate, today) {
    if (!viewDate) return { primary: '今天', secondary: '' };
    const [y, m, d] = viewDate.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    const wd = WD_FULL[dt.getUTCDay()];
    const datePart = `${m}月${d}日`;
    if (viewDate === today) return { primary: '今天', secondary: `${datePart} · ${wd}` };
    if (this.data.dayOffset === -1) return { primary: '昨天', secondary: `${datePart} · ${wd}` };
    return { primary: datePart, secondary: wd };
  }
});
