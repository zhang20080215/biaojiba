// pages/daily/stats/stats.js
// 每日打卡 · 统计页（日/周/月 切换 + 周/月可前后翻页；月视图为周一开头日历）
const { getTheme, ACCENT_HEX } = require('../../../utils/dailyThemes.js');
const toast = require('../../../utils/dailyToast.js');

const WD_SHORT_MON = ['一', '二', '三', '四', '五', '六', '日'];   // 周一开头
const MAX_WEEK_BACK = 26;     // 最多回看 ~半年
const MAX_MONTH_BACK = 12;    // 最多回看 12 个月

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

    range: 'week',              // day | week | month
    weekOffset: 0,              // 0 = 当周, -1 = 上周
    monthOffset: 0,             // 0 = 当月, -1 = 上月
    loading: true,

    today: '',
    goalValue: 2000,
    unit: 'ml',

    // headline
    headline: { num: 0, sub: '' },
    headlineCap: '本周日均饮水',          // 顶部小字标题：完整一段，不再由两段拼接（避免中间空格）

    // 周/月翻页 nav
    showPeriodNav: true,
    periodLabel: '',
    canGoPrevPeriod: true,
    canGoNextPeriod: false,

    // chart
    chartTitle: '',
    showKpi: false,
    bars: [],                   // day/week 柱状（week 固定 7 个：周一~周日）
    cells: [],                  // month 日历 cells（含前置空白；item.empty=true 时占位）
    weekHeader: WD_SHORT_MON,   // 月视图日历表头
    kpi: []
  },

  onLoad(options) {
    const themeId = (options && options.theme) || 'water';
    const theme = getTheme(themeId);
    this.theme = theme;

    const accent = theme.accent || 'yellow';
    const accentHex = ACCENT_HEX[accent] || ACCENT_HEX.yellow;
    const nav = this._navMetrics();

    wx.setNavigationBarColor({
      frontColor: '#000000',
      backgroundColor: theme.navBg
    });

    this.setData({
      themeId,
      theme: { id: theme.id, title: theme.title },
      accent,
      accentHex,
      statusBarHeight: nav.statusBarHeight,
      navBarHeight: nav.navBarHeight,
      navOffset: nav.navOffset,
      unit: theme.unit,
      goalValue: theme.defaultGoal,
      today: this._today()
    });

    this.fetchPeriod();
  },

  onShow() {
    if (!this.data.loading) this.fetchPeriod();
  },

  _navMetrics() {
    const fallback = { statusBarHeight: 20, navBarHeight: 48, navOffset: 68 };
    try {
      const sysInfo = wx.getSystemInfoSync ? wx.getSystemInfoSync() : {};
      const statusBarHeight = sysInfo.statusBarHeight || fallback.statusBarHeight;
      let navBarHeight = fallback.navBarHeight;
      if (wx.getMenuButtonBoundingClientRect) {
        const menu = wx.getMenuButtonBoundingClientRect();
        if (menu && menu.top && menu.height) {
          navBarHeight = (menu.top - statusBarHeight) * 2 + menu.height;
        }
      }
      return { statusBarHeight, navBarHeight, navOffset: statusBarHeight + navBarHeight };
    } catch (e) {
      return fallback;
    }
  },

  onBack() {
    if (getCurrentPages().length > 1) {
      wx.navigateBack();
    } else {
      wx.redirectTo({ url: '/pages/daily/index/index?theme=' + this.data.themeId });
    }
  },

  // ========= range / period 切换 =========
  onRangeTap(e) {
    const r = e.currentTarget.dataset.range;
    if (!r || r === this.data.range) return;
    // 切 range 时重置 offset 到当下
    const patch = { range: r };
    if (r === 'week') patch.weekOffset = 0;
    if (r === 'month') patch.monthOffset = 0;
    this.setData(patch);
    this.fetchPeriod();
  },

  onPrevPeriod() {
    const range = this.data.range;
    if (range === 'week') {
      const next = this.data.weekOffset - 1;
      if (next < -MAX_WEEK_BACK) return;
      this.setData({ weekOffset: next });
    } else if (range === 'month') {
      const next = this.data.monthOffset - 1;
      if (next < -MAX_MONTH_BACK) return;
      this.setData({ monthOffset: next });
    } else {
      return;
    }
    this.fetchPeriod();
  },

  onNextPeriod() {
    const range = this.data.range;
    if (range === 'week') {
      if (this.data.weekOffset >= 0) return;
      this.setData({ weekOffset: this.data.weekOffset + 1 });
    } else if (range === 'month') {
      if (this.data.monthOffset >= 0) return;
      this.setData({ monthOffset: this.data.monthOffset + 1 });
    } else {
      return;
    }
    this.fetchPeriod();
  },

  // ========= 拉取当前 range/offset 对应的区间 =========
  fetchPeriod() {
    const range = this.data.range;
    const today = this.data.today || this._today();

    if (range === 'day') {
      // day: 只关心今天，单独走 getToday
      this.setData({ loading: true, showPeriodNav: false });
      wx.cloud.callFunction({
        name: 'syncDailyLog',
        data: { action: 'getToday', theme: this.data.themeId, date: today },
        success: res => {
          if (!res.result || !res.result.success) {
            toast.show(this, '加载失败');
            this.setData({ loading: false });
            return;
          }
          const goal = (res.result.settings && res.result.settings.daily_goal) || this.theme.defaultGoal;
          this.setData({ goalValue: goal });
          this._renderDay(res.result.today);
          this.setData({ loading: false });
        },
        fail: () => {
          toast.show(this, '网络异常');
          this.setData({ loading: false });
        }
      });
      return;
    }

    // week / month
    const period = range === 'week'
      ? this._weekRange(today, this.data.weekOffset)
      : this._monthRange(today, this.data.monthOffset);

    this.setData({ loading: true, showPeriodNav: true });
    wx.cloud.callFunction({
      name: 'syncDailyLog',
      data: { action: 'getRange', theme: this.data.themeId, from: period.from, to: period.to },
      success: res => {
        if (!res.result || !res.result.success) {
          toast.show(this, '加载失败');
          this.setData({ loading: false });
          return;
        }
        const goal = (res.result.settings && res.result.settings.daily_goal) || this.theme.defaultGoal;
        this.setData({ goalValue: goal });
        if (range === 'week') {
          this._renderWeek(res.result.days, period);
        } else {
          this._renderMonth(res.result.days, period);
        }
        this.setData({ loading: false });
      },
      fail: () => {
        toast.show(this, '网络异常');
        this.setData({ loading: false });
      }
    });
  },

  // ========= 渲染：day =========
  _renderDay(day) {
    const goal = this.data.goalValue;
    const ml = (day && day.total_value) || 0;
    // 完成率 = 总饮水 / 目标，不做 cap，超额时如实显示 (如 125%)
    const pct = goal ? ml / goal : 0;
    const date = this._parseDate((day && day.date) || this.data.today);
    this.setData({
      headlineCap: '今日饮水',
      headline: { num: ml, sub: `目标 ${goal}${this.data.unit} · 完成 ${Math.round(pct * 100)}%` },
      chartTitle: '今日饮水',
      showKpi: false,
      periodLabel: '',
      bars: [this._barItem({ date: this._dateStr(date), total_value: ml }, true, false)],
      cells: [],
      kpi: []
    });
  },

  // ========= 渲染：week =========
  _renderWeek(days, period) {
    const goal = this.data.goalValue;
    const today = this.data.today;
    // 仅统计已发生的天（避免本周末未到的天被算进"达标分母"）
    const happened = days.filter(d => d.date <= today);
    const total = happened.reduce((s, x) => s + (x.total_value || 0), 0);
    const completed = happened.filter(x => (x.total_value || 0) >= goal).length;
    const denom = happened.length || 1;
    const avg = Math.round(total / denom);

    const bars = days.map(d => {
      const isToday = d.date === today;
      const isFuture = d.date > today;
      return this._barItem(d, isToday, isFuture);
    });

    const rangePrefix = this.data.weekOffset === 0
      ? '本周' : (this.data.weekOffset === -1 ? '上周' : `${-this.data.weekOffset}周前`);
    this.setData({
      headlineCap: `${rangePrefix}日均饮水`,
      headline: { num: avg, sub: `累计 ${total}${this.data.unit} · 达标 ${completed}/${happened.length} 天` },
      chartTitle: this._formatWeekLabel(period),
      periodLabel: this._formatWeekLabel(period),
      canGoPrevPeriod: this.data.weekOffset > -MAX_WEEK_BACK,
      canGoNextPeriod: this.data.weekOffset < 0,
      showKpi: true,
      bars,
      cells: [],
      kpi: this._kpi(completed, happened.length, avg, total)
    });
  },

  // ========= 渲染：month =========
  _renderMonth(days, period) {
    const goal = this.data.goalValue;
    const today = this.data.today;
    const happened = days.filter(d => d.date <= today);
    const total = happened.reduce((s, x) => s + (x.total_value || 0), 0);
    const completed = happened.filter(x => (x.total_value || 0) >= goal).length;
    const denom = happened.length || 1;
    const avg = Math.round(total / denom);

    // 日历 cells：前置空白 + 当月每一天（按周一开头）
    const map = {};
    days.forEach(d => { map[d.date] = d; });
    const cells = [];
    const lastDay = period.lastDay;
    const firstWd = this._dayOfWeekMon(period.fromDate); // 0(周一)~6(周日)
    for (let i = 0; i < firstWd; i++) cells.push({ empty: true });
    for (let day = 1; day <= lastDay; day++) {
      const dStr = this._monthDateStr(period.year, period.month, day);
      const d = map[dStr] || { date: dStr, total_value: 0 };
      const value = d.total_value || 0;
      const pct = goal ? value / goal : 0;
      const fillPct = Math.min(1, pct);
      cells.push({
        empty: false,
        day,
        date: dStr,
        value,
        fillPctH: Math.round(fillPct * 100),
        isAchieved: pct >= 1,
        isToday: dStr === today,
        isFuture: dStr > today
      });
    }

    const rangePrefix = this.data.monthOffset === 0
      ? '本月' : (this.data.monthOffset === -1 ? '上月' : `${-this.data.monthOffset}月前`);
    this.setData({
      headlineCap: `${rangePrefix}日均饮水`,
      headline: { num: avg, sub: `累计 ${total}${this.data.unit} · 达标 ${completed}/${happened.length} 天` },
      chartTitle: `${period.year}年${period.month}月`,
      periodLabel: `${period.year}年${period.month}月`,
      canGoPrevPeriod: this.data.monthOffset > -MAX_MONTH_BACK,
      canGoNextPeriod: this.data.monthOffset < 0,
      showKpi: true,
      bars: [],
      cells,
      kpi: this._kpi(completed, happened.length || lastDay, avg, total)
    });
  },

  // ========= 单项 helpers =========
  _barItem(d, isToday, isFuture) {
    const goal = this.data.goalValue;
    const value = d.total_value || 0;
    const pct = goal ? value / goal : 0;
    const fillPct = Math.min(1, pct);
    // 颜色规则：所有天填充统一蓝色；达标边框变黑（在 wc-achieved 类里）。今天不再单独高亮。
    const fillColor = '#2A8BC4';
    const date = this._parseDate(d.date);
    return {
      date: d.date,
      value,
      pctText: isFuture ? '' : (value > 0 ? Math.round(pct * 100) + '%' : ''),
      pctHit: pct >= 1,
      fillPctH: isFuture ? 0 : Math.round(fillPct * 100),
      fillColor,
      label: WD_SHORT_MON[this._dayOfWeekMon(date)],
      isToday,
      isFuture,
      isAchieved: pct >= 1 && !isFuture
    };
  },

  _kpi(completed, days, avg, total) {
    const safeDays = days || 1;
    const pct = Math.round((completed / safeDays) * 100);
    return [
      { label: '达标天数', value: completed, unit: '/ ' + days },
      { label: '完成率', value: pct, unit: '%' },
      { label: '日均饮水', value: avg, unit: this.data.unit },
      { label: '累计饮水', value: total, unit: this.data.unit }
    ];
  },

  // ========= 日期工具 =========
  _today() {
    const d = new Date(Date.now() + 8 * 3600 * 1000);
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString().slice(0, 10);
  },

  _parseDate(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  },

  _dateStr(d) {
    return d.toISOString().slice(0, 10);
  },

  _addDays(date, n) {
    const dt = new Date(date.getTime());
    dt.setUTCDate(dt.getUTCDate() + n);
    return dt;
  },

  // 周一开头：JS getUTCDay() 0=周日 → 转 0(周一)~6(周日)
  _dayOfWeekMon(date) {
    return (date.getUTCDay() + 6) % 7;
  },

  // 给定一天，找它所在那一周的周一（按周一开头）；再加 offset*7 周
  _weekRange(todayStr, offset) {
    const today = this._parseDate(todayStr);
    const wdMon = this._dayOfWeekMon(today);              // 0~6
    const monday = this._addDays(today, -wdMon + offset * 7);
    const sunday = this._addDays(monday, 6);
    return {
      from: this._dateStr(monday),
      to: this._dateStr(sunday),
      fromDate: monday,
      toDate: sunday
    };
  },

  // 给定一天，找它所在那一月，再加 offset 月
  _monthRange(todayStr, offset) {
    const today = this._parseDate(todayStr);
    const y = today.getUTCFullYear();
    const m = today.getUTCMonth();    // 0~11
    const target = new Date(Date.UTC(y, m + offset, 1));
    const ty = target.getUTCFullYear();
    const tm = target.getUTCMonth();  // 0~11
    const lastDay = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
    const fromDate = new Date(Date.UTC(ty, tm, 1));
    const toDate = new Date(Date.UTC(ty, tm, lastDay));
    return {
      from: this._dateStr(fromDate),
      to: this._dateStr(toDate),
      fromDate,
      toDate,
      year: ty,
      month: tm + 1,    // 1~12 给展示用
      lastDay
    };
  },

  _monthDateStr(year, month1, day) {
    const m = String(month1).padStart(2, '0');
    const d = String(day).padStart(2, '0');
    return `${year}-${m}-${d}`;
  },

  _formatWeekLabel(period) {
    const f = period.fromDate;
    const t = period.toDate;
    const fm = f.getUTCMonth() + 1;
    const fd = f.getUTCDate();
    const tm = t.getUTCMonth() + 1;
    const td = t.getUTCDate();
    if (fm === tm) return `${fm}月${fd}日 - ${td}日`;
    return `${fm}月${fd}日 - ${tm}月${td}日`;
  }
});
