// 管理一份自建影单 / 书单：改名、调整顺序、移除条目（单个 / 批量）、删除整份清单，
// 以及去「添加」页（从榜单勾选 / 按名字搜索）。
const imageCacheManager = require('../../../utils/imageCacheManager.js');
const { MAX_ITEMS, TYPE_META, callList, listUrl, markDirty, subLine } = require('../common.js');

Page({
  data: {
    listId: '',
    type: 'movie',
    meta: TYPE_META.movie,
    title: '',
    items: [],
    count: 0,
    maxItems: MAX_ITEMS,
    loading: true,
    selecting: false,
    selectedMap: {},
    selectedCount: 0,
  },

  onLoad(options) {
    this.setData({ listId: options.listId || '' });
    this._fresh = options.fresh === '1';
  },

  onShow() {
    this.load();
  },

  async load() {
    if (!this.data.listId) return;
    try {
      const res = await callList('get', { listId: this.data.listId });
      const list = res.list || {};
      if (!list.isOwner) {
        wx.showToast({ title: '只能管理自己的清单', icon: 'none' });
        setTimeout(() => wx.navigateBack(), 1200);
        return;
      }
      const type = list.type === 'book' ? 'book' : 'movie';
      const items = (res.movies || []).map(it => ({
        _id: String(it._id),
        title: it.title,
        sub: subLine(it, type),
        thumb: imageCacheManager.getThumbnailUrl(it.cover, 'list'),
      }));
      this.setData({ type, meta: TYPE_META[type], title: list.title, items, count: items.length, loading: false });
      wx.setNavigationBarTitle({ title: `管理${TYPE_META[type].noun}` });
      // 刚创建的空清单：直接引导去添加
      if (this._fresh && !items.length) {
        this._fresh = false;
        this.onAddFromRanking();
      }
    } catch (e) {
      this.setData({ loading: false });
      wx.showToast({ title: e.message, icon: 'none' });
    }
  },

  onRename() {
    wx.showModal({
      title: `修改${this.data.meta.noun}名称`,
      editable: true,
      content: this.data.title,
      placeholderText: '20 字内',
      success: async (r) => {
        if (!r.confirm) return;
        const title = String(r.content || '').trim().slice(0, 20);
        if (!title || title === this.data.title) return;
        try {
          await callList('rename', { listId: this.data.listId, title });
          this.setData({ title });
          markDirty(this.data.listId);
        } catch (e) {
          wx.showToast({ title: e.message, icon: 'none' });
        }
      },
    });
  },

  onAddFromRanking() {
    this.goAdd('rank');
  },

  onAddBySearch() {
    this.goAdd('search');
  },

  goAdd(mode) {
    if (this.data.count >= MAX_ITEMS) {
      wx.showToast({ title: `已达上限 ${MAX_ITEMS} 条`, icon: 'none' });
      return;
    }
    wx.navigateTo({ url: `/pages/customList/add/add?listId=${this.data.listId}&type=${this.data.type}&mode=${mode}` });
  },

  onViewList() {
    const url = listUrl({ _id: this.data.listId, type: this.data.type, title: this.data.title });
    // 从列表页「编辑」进来的，返回即可回到列表页
    const pages = getCurrentPages();
    const prev = pages[pages.length - 2];
    if (prev && prev.route === TYPE_META[this.data.type].listPage.slice(1) && prev.data && prev.data.listId === this.data.listId) {
      wx.navigateBack();
      return;
    }
    wx.navigateTo({ url });
  },

  onItemMore(e) {
    const id = e.currentTarget.dataset.id;
    const idx = this.data.items.findIndex(i => i._id === id);
    if (idx < 0) return;
    const actions = [];
    if (idx > 0) actions.push({ label: '移到最前', run: () => this.move(id, 'top') });
    if (idx > 0) actions.push({ label: '上移一位', run: () => this.move(id, 'up') });
    if (idx < this.data.items.length - 1) actions.push({ label: '下移一位', run: () => this.move(id, 'down') });
    actions.push({ label: `移出${this.data.meta.noun}`, run: () => this.remove([id]) });
    wx.showActionSheet({
      itemList: actions.map(a => a.label),
      success: (r) => actions[r.tapIndex] && actions[r.tapIndex].run(),
    });
  },

  async move(id, to) {
    // 乐观更新本地顺序，失败再重拉
    const items = this.data.items.slice();
    const idx = items.findIndex(i => i._id === id);
    const target = to === 'top' ? 0 : to === 'up' ? idx - 1 : idx + 1;
    const [it] = items.splice(idx, 1);
    items.splice(target, 0, it);
    this.setData({ items });
    try {
      await callList('moveItem', { listId: this.data.listId, id, to });
      markDirty(this.data.listId);
    } catch (e) {
      wx.showToast({ title: e.message, icon: 'none' });
      this.load();
    }
  },

  async remove(ids) {
    wx.showLoading({ title: '移除中', mask: true });
    try {
      const res = await callList('removeItems', { listId: this.data.listId, ids });
      const drop = new Set(ids);
      const items = this.data.items.filter(i => !drop.has(i._id));
      this.setData({ items, count: res.count != null ? res.count : items.length, selecting: false, selectedMap: {}, selectedCount: 0 });
      markDirty(this.data.listId);
      wx.hideLoading();
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: e.message, icon: 'none' });
    }
  },

  onToggleSelecting() {
    this.setData({ selecting: !this.data.selecting, selectedMap: {}, selectedCount: 0 });
  },

  onToggleItem(e) {
    if (!this.data.selecting) return;
    const id = e.currentTarget.dataset.id;
    const selectedMap = { ...this.data.selectedMap };
    if (selectedMap[id]) delete selectedMap[id];
    else selectedMap[id] = true;
    this.setData({ selectedMap, selectedCount: Object.keys(selectedMap).length });
  },

  onRemoveSelected() {
    const ids = Object.keys(this.data.selectedMap);
    if (!ids.length) return;
    wx.showModal({
      title: '移除条目',
      content: `从${this.data.meta.noun}移除 ${ids.length} ${this.data.meta.unit}？已有的标记不受影响。`,
      confirmText: '移除',
      confirmColor: '#E64340',
      success: (r) => { if (r.confirm) this.remove(ids); },
    });
  },

  onDeleteList() {
    wx.showModal({
      title: `删除${this.data.meta.noun}`,
      content: `删除「${this.data.title}」后无法恢复（你的标记记录会保留）。删除后可以重新创建。`,
      confirmText: '删除',
      confirmColor: '#E64340',
      success: async (r) => {
        if (!r.confirm) return;
        wx.showLoading({ title: '删除中', mask: true });
        try {
          await callList('remove', { listId: this.data.listId });
          // 页面栈里若还开着这份清单的列表页，回去时重拉并显示「已被删除」
          markDirty(this.data.listId);
          wx.hideLoading();
          wx.showToast({ title: '已删除', icon: 'success' });
          setTimeout(() => wx.redirectTo({ url: '/pages/customList/index/index' }), 800);
        } catch (e) {
          wx.hideLoading();
          wx.showToast({ title: e.message, icon: 'none' });
        }
      },
    });
  },
});
