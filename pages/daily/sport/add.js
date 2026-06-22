const toast = require('../../../utils/dailyToast.js');
const fitnessTypes = require('../../../utils/fitnessTypes.js');
const sportIcons = require('../../../utils/sportIcons.js');
const { getNavMetrics, todayStr, buildSummary } = require('./common.js');

// 预生成带线性图标 URI 的分类结构（图标来自 utils/sportIcons.js）
const CATEGORIES = fitnessTypes.categories.map(c => ({
  id: c.id,
  name: c.name,
  iconUri: sportIcons.uriForCategory(c.id),
  groups: (c.groups || []).map(g => ({
    part: g.part,
    types: (g.types || []).map(t => ({ name: t.name, icon: t.icon, iconUri: sportIcons.uriForType(t.name) }))
  }))
}));

function formatDateText(d) {
  const p = String(d || '').split('-').map(Number);
  if (p.length < 3 || p.some(isNaN)) return d || '';
  return `${p[0]}年${p[1]}月${p[2]}日`;
}

Page({
  data: {
    toast: { show: false, text: '', icon: '' },
    statusBarHeight: 20,
    navBarHeight: 48,
    navOffset: 68,

    date: '',
    dateText: '',

    categories: CATEGORIES,
    activeCategory: 'cardio',
    selectedType: '',
    selectedIcon: '',

    // 动态字段开关
    showDuration: true,
    showDistance: false,
    distanceUnit: 'km',
    showStrength: false,

    // 字段值
    duration: '',
    distance: '',
    sets: '',
    reps: '',
    weight: '',

    // 本次待保存的多组动作
    pendingList: [],

    // 编辑态（左滑「编辑」进入）：只改这一条，不支持多组
    editing: false,

    submitting: false
  },

  onLoad(options) {
    const nav = getNavMetrics();
    const date = (options && options.date) || todayStr();
    const editing = !!(options && options.ts);
    this.editTs = editing ? Number(options.ts) : 0;
    this.editDate = date; // 编辑态锁定原日期
    this.setData({
      statusBarHeight: nav.statusBarHeight,
      navBarHeight: nav.navBarHeight,
      navOffset: nav.navOffset,
      date,
      dateText: formatDateText(date),
      editing
    });
    wx.setNavigationBarColor({ frontColor: '#000000', backgroundColor: '#FAFBFF' });
    wx.setNavigationBarTitle({ title: editing ? '编辑运动' : '添加运动' });
    if (editing) this.loadEditEntry(date, this.editTs);
  },

  // 拉取该日记录，定位待编辑条目并回填表单
  loadEditEntry(date, ts) {
    wx.cloud.callFunction({
      name: 'syncDailyLog',
      data: { action: 'getRange', theme: 'sport', from: date, to: date },
      success: res => {
        const result = res && res.result;
        const days = (result && result.days) || [];
        const day = days.find(d => d.date === date);
        const entry = ((day && day.entries) || []).find(en => en.ts === ts);
        if (!entry) {
          toast.show(this, '记录不存在');
          setTimeout(() => wx.navigateBack(), 600);
          return;
        }
        const m = entry.meta || {};
        const config = fitnessTypes.getFieldConfig(m.type);
        this.setData({
          activeCategory: m.category || 'cardio',
          selectedType: m.type || '',
          selectedIcon: m.icon || '🏃',
          showDuration: config.showDuration,
          showDistance: config.showDistance,
          distanceUnit: config.distanceUnit || m.distanceUnit || 'km',
          showStrength: config.showStrength,
          duration: m.duration != null ? String(m.duration) : '',
          distance: m.distance != null ? String(m.distance) : '',
          sets: m.sets != null ? String(m.sets) : '',
          reps: m.reps != null ? String(m.reps) : '',
          weight: m.weight != null ? String(m.weight) : ''
        });
      },
      fail: err => {
        console.error('sport loadEditEntry fail', err);
        toast.show(this, '加载失败');
      }
    });
  },

  onBack() {
    if (getCurrentPages().length > 1) wx.navigateBack();
    else wx.redirectTo({ url: '/pages/daily/sport/index' });
  },

  onDateChange(e) {
    if (this.data.editing) return; // 编辑态锁定日期
    const date = e.detail.value;
    this.setData({ date, dateText: formatDateText(date) });
  },

  // 切换大类：重置类型与字段
  onCategoryTap(e) {
    const cat = e.currentTarget.dataset.category;
    if (cat === this.data.activeCategory) return;
    this.setData({
      activeCategory: cat,
      selectedType: '',
      selectedIcon: '',
      showDuration: cat === 'cardio',
      showDistance: false,
      distanceUnit: 'km',
      showStrength: false,
      duration: '',
      distance: '',
      sets: '',
      reps: '',
      weight: ''
    });
  },

  // 选择子类型：按 getFieldConfig 切换动态字段
  onTypeTap(e) {
    const type = e.currentTarget.dataset.type;
    const icon = e.currentTarget.dataset.icon || '🏃';
    const config = fitnessTypes.getFieldConfig(type);
    this.setData({
      selectedType: type,
      selectedIcon: icon,
      showDuration: config.showDuration,
      showDistance: config.showDistance,
      distanceUnit: config.distanceUnit || 'km',
      showStrength: config.showStrength,
      duration: '',
      distance: '',
      sets: '',
      reps: '',
      weight: ''
    });
  },

  onDurationInput(e) { this.setData({ duration: e.detail.value }); },
  onDistanceInput(e) { this.setData({ distance: e.detail.value }); },
  onSetsInput(e) { this.setData({ sets: e.detail.value }); },
  onRepsInput(e) { this.setData({ reps: e.detail.value }); },
  onWeightInput(e) { this.setData({ weight: e.detail.value }); },

  // 校验当前表单并构建 meta；失败时 toast 并返回 null
  buildCurrentMeta() {
    const {
      selectedType, selectedIcon, activeCategory,
      duration, distance, sets, reps, weight,
      showDuration, showDistance, showStrength, distanceUnit
    } = this.data;

    if (!selectedType) {
      toast.show(this, '请选择运动类型');
      return null;
    }
    if (showDuration) {
      const d = parseFloat(duration);
      if (!duration || isNaN(d) || d <= 0 || d > 600) {
        toast.show(this, '请输入有效时长(1-600分钟)');
        return null;
      }
    }
    if (showDistance) {
      const dist = parseFloat(distance);
      if (!distance || isNaN(dist) || dist <= 0) {
        toast.show(this, '请输入有效距离');
        return null;
      }
    }
    if (showStrength) {
      const s = parseInt(sets);
      const r = parseInt(reps);
      if (!sets || isNaN(s) || s <= 0 || s > 50) {
        toast.show(this, '请输入有效组数(1-50)');
        return null;
      }
      if (!reps || isNaN(r) || r <= 0 || r > 200) {
        toast.show(this, '请输入有效次数(1-200)');
        return null;
      }
    }

    return {
      category: activeCategory,
      type: selectedType,
      icon: selectedIcon || '🏃',
      duration: showDuration ? parseFloat(duration) : null,
      distance: showDistance ? parseFloat(distance) : null,
      distanceUnit: showDistance ? distanceUnit : null,
      sets: showStrength ? parseInt(sets) : null,
      reps: showStrength ? parseInt(reps) : null,
      weight: (showStrength && weight) ? parseFloat(weight) : null
    };
  },

  // 把当前表单的字段值清空（保留大类，便于继续添加同类动作）
  resetCurrentForm() {
    this.setData({
      selectedType: '',
      selectedIcon: '',
      showDuration: this.data.activeCategory === 'cardio',
      showDistance: false,
      distanceUnit: 'km',
      showStrength: false,
      duration: '',
      distance: '',
      sets: '',
      reps: '',
      weight: ''
    });
  },

  // 「再加一组」：校验当前表单 → 入清单 → 重置表单
  onAddMore() {
    const meta = this.buildCurrentMeta();
    if (!meta) return;
    const item = { id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, meta, iconUri: sportIcons.uriForType(meta.type), type: meta.type, summary: buildSummary(meta) };
    this.setData({ pendingList: this.data.pendingList.concat(item) });
    this.resetCurrentForm();
    toast.show(this, '已加入清单', { icon: 'success' });
  },

  // 删除清单中的某一组
  onRemovePending(e) {
    const idx = e.currentTarget.dataset.index;
    const list = this.data.pendingList.slice();
    list.splice(idx, 1);
    this.setData({ pendingList: list });
  },

  // 顺序保存一组动作（返回 Promise<bool>）
  saveOne(meta) {
    return wx.cloud.callFunction({
      name: 'syncDailyLog',
      data: { action: 'addEntry', theme: 'sport', date: this.data.date, value: 1, meta }
    }).then(res => {
      const result = res && res.result;
      return !!(result && result.success);
    });
  },

  // 编辑态：只更新这一条
  onSubmitEdit() {
    const meta = this.buildCurrentMeta();
    if (!meta) return;
    this.setData({ submitting: true });
    wx.cloud.callFunction({
      name: 'syncDailyLog',
      data: { action: 'updateEntry', theme: 'sport', date: this.editDate, ts: this.editTs, value: 1, meta },
      success: res => {
        const result = res && res.result;
        if (!result || !result.success) {
          toast.show(this, '保存失败');
          return;
        }
        toast.show(this, '已保存', { icon: 'success' });
        setTimeout(() => wx.navigateBack(), 450);
      },
      fail: err => {
        console.error('sport updateEntry fail', err);
        toast.show(this, '网络异常');
      },
      complete: () => this.setData({ submitting: false })
    });
  },

  async onSubmit() {
    if (this.data.submitting) return;
    if (this.data.editing) { this.onSubmitEdit(); return; }

    // 当前表单已选了类型 → 先并入清单（含校验），再统一保存
    if (this.data.selectedType) {
      const meta = this.buildCurrentMeta();
      if (!meta) return; // 当前表单填了一半且不合法，先提示
      const item = { id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, meta, iconUri: sportIcons.uriForType(meta.type), type: meta.type, summary: buildSummary(meta) };
      this.setData({ pendingList: this.data.pendingList.concat(item) });
      this.resetCurrentForm();
    }

    const items = this.data.pendingList;
    if (!items.length) {
      toast.show(this, '请至少添加一组动作');
      return;
    }

    this.setData({ submitting: true });
    try {
      const remaining = [];
      for (const item of items) {
        // 顺序写入，避免并发对同日唯一索引的争用；失败的留在清单里可重试，不会重复写
        // eslint-disable-next-line no-await-in-loop
        const done = await this.saveOne(item.meta);
        if (!done) remaining.push(item);
      }

      const ok = items.length - remaining.length;
      if (remaining.length === 0) {
        toast.show(this, `已记录${ok}组`, { icon: 'success' });
        setTimeout(() => { wx.navigateBack(); }, 450);
      } else {
        this.setData({ pendingList: remaining });
        toast.show(this, ok > 0 ? `已记录${ok}组，剩余${remaining.length}组请重试` : '记录失败');
      }
    } catch (err) {
      console.error('daily sport add fail', err);
      toast.show(this, '网络异常');
    } finally {
      this.setData({ submitting: false });
    }
  }
});
