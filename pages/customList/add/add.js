// 往自建影单 / 书单里加东西，两种方式（顶部 tab 切换）：
//   榜单：选一个现有榜单 → 勾选条目 → 一次性加入（条目沿用榜单原 _id，已有标记直接带过来）
//   搜索：按片名 / 书名搜豆瓣 → 单条「加入」
// 容量上限 MAX_ITEMS 由云函数兜底，这里只做前端提示与截断。
const DataLoader = require('../../../utils/dataLoader.js');
const imageCacheManager = require('../../../utils/imageCacheManager.js');
const { getThemeConfig: movieCfg } = require('../../../utils/genericThemeConfig.js');
const { getThemeConfig: bookCfg } = require('../../../utils/genericBookThemeConfig.js');
const { MAX_ITEMS, TYPE_META, callList, markDirty, subLine, rankingSources, snapshotFromRanking, snapshotFromSearch } = require('../common.js');

Page({
  data: {
    listId: '',
    type: 'movie',
    meta: TYPE_META.movie,
    tab: 'rank',
    count: 0,
    maxItems: MAX_ITEMS,
    room: MAX_ITEMS,
    // 榜单
    sources: [],
    activeSource: '',
    rankLoading: false,
    rankItems: [],        // 当前榜单过滤后的展示行
    rankFilter: '',
    selectedMap: {},
    selectedCount: 0,
    // 搜索
    keyword: '',
    searching: false,
    searched: false,
    results: [],
    // 已在清单里的
    inListMap: {},
    addingId: '',
  },

  async onLoad(options) {
    const type = options.type === 'book' ? 'book' : 'movie';
    const meta = TYPE_META[type];
    this.setData({
      listId: options.listId || '',
      type,
      meta,
      tab: options.mode === 'search' ? 'search' : 'rank',
      sources: rankingSources(type),
    });
    wx.setNavigationBarTitle({ title: `添加${meta.item}` });
    await this.loadExisting();
    if (this.data.tab === 'rank' && this.data.sources.length) this.selectSource(this.data.sources[0].theme);
  },

  // 读清单现有条目：用来标「已在清单」、算剩余容量
  async loadExisting() {
    try {
      const res = await callList('get', { listId: this.data.listId });
      this._doubanIn = new Set();
      const inListMap = {};
      (res.movies || []).forEach(it => {
        inListMap[String(it._id)] = true;
        if (it.doubanId) this._doubanIn.add(String(it.doubanId));
      });
      const count = (res.movies || []).length;
      this.setData({ inListMap, count, room: Math.max(0, MAX_ITEMS - count) });
    } catch (e) {
      wx.showToast({ title: e.message, icon: 'none' });
    }
  },

  isInList(id, doubanId) {
    return !!(this.data.inListMap[id] || (doubanId && this._doubanIn && this._doubanIn.has(String(doubanId))));
  },

  onTab(e) {
    const tab = e.currentTarget.dataset.tab;
    if (tab === this.data.tab) return;
    this.setData({ tab });
    if (tab === 'rank' && !this.data.activeSource && this.data.sources.length) this.selectSource(this.data.sources[0].theme);
  },

  // ─── 榜单 ───
  onSourceTap(e) {
    this.selectSource(e.currentTarget.dataset.theme);
  },

  async selectSource(theme) {
    const src = this.data.sources.find(s => s.theme === theme);
    if (!src) return;
    this.setData({ activeSource: theme, rankLoading: true, rankItems: [], rankFilter: '', selectedMap: {}, selectedCount: 0 });
    const type = this.data.type;
    const cfg = type === 'book' ? bookCfg(theme) : movieCfg(theme);
    try {
      const raw = await DataLoader.loadThemeItems(theme, { orderByField: 'rank', orderDirection: src.orderDirection || cfg.orderDirection || 'asc' });
      if (this.data.activeSource !== theme) return; // 用户已切到别的榜单
      this._rankAll = raw.map((m, i) => {
        const snap = snapshotFromRanking(m, theme, type, cfg.source);
        return {
          _id: snap._id,
          rank: m.rank || i + 1,
          title: snap.title,
          sub: subLine(snap, type),
          thumb: imageCacheManager.getThumbnailUrl(snap.cover, 'list'),
          doubanId: snap.doubanId,
          snap,
        };
      });
      this.applyRankFilter();
    } catch (e) {
      console.error('[customList/add] 读取榜单失败', e);
      wx.showToast({ title: '榜单读取失败，请重试', icon: 'none' });
    } finally {
      if (this.data.activeSource === theme) this.setData({ rankLoading: false });
    }
  },

  onRankFilter(e) {
    this.setData({ rankFilter: e.detail.value });
    clearTimeout(this._filterTimer);
    this._filterTimer = setTimeout(() => this.applyRankFilter(), 200);
  },

  applyRankFilter() {
    const q = String(this.data.rankFilter || '').trim().toLowerCase();
    const rows = (this._rankAll || [])
      .filter(r => !q || String(r.title).toLowerCase().indexOf(q) >= 0)
      .map(r => ({ _id: r._id, rank: r.rank, title: r.title, sub: r.sub, thumb: r.thumb, added: this.isInList(r._id, r.doubanId) }));
    this.setData({ rankItems: rows });
  },

  onRankToggle(e) {
    const id = e.currentTarget.dataset.id;
    const row = this.data.rankItems.find(r => r._id === id);
    if (!row || row.added) return;
    const selectedMap = { ...this.data.selectedMap };
    if (selectedMap[id]) {
      delete selectedMap[id];
    } else {
      if (Object.keys(selectedMap).length >= this.data.room) {
        wx.showToast({ title: `最多还能加 ${this.data.room} ${this.data.meta.unit}`, icon: 'none' });
        return;
      }
      selectedMap[id] = true;
    }
    this.setData({ selectedMap, selectedCount: Object.keys(selectedMap).length });
  },

  // 全选当前可见（未加入的），超出容量截断
  onSelectAllVisible() {
    const selectedMap = { ...this.data.selectedMap };
    let n = Object.keys(selectedMap).length;
    const allOn = this.data.rankItems.filter(r => !r.added).every(r => selectedMap[r._id]);
    if (allOn) {
      this.data.rankItems.forEach(r => { delete selectedMap[r._id]; });
    } else {
      for (const r of this.data.rankItems) {
        if (r.added || selectedMap[r._id]) continue;
        if (n >= this.data.room) {
          wx.showToast({ title: `最多还能加 ${this.data.room} ${this.data.meta.unit}，已截断`, icon: 'none' });
          break;
        }
        selectedMap[r._id] = true;
        n++;
      }
    }
    this.setData({ selectedMap, selectedCount: Object.keys(selectedMap).length });
  },

  async onAddSelected() {
    const ids = Object.keys(this.data.selectedMap);
    if (!ids.length) return;
    const byId = {};
    (this._rankAll || []).forEach(r => { byId[r._id] = r.snap; });
    const items = ids.map(id => byId[id]).filter(Boolean);
    wx.showLoading({ title: '加入中', mask: true });
    try {
      const res = await this.addItems(items);
      wx.hideLoading();
      this.setData({ selectedMap: {}, selectedCount: 0 });
      this.applyRankFilter();
      this.toastResult(res);
    } catch (e) {
      wx.hideLoading();
      wx.showToast({ title: e.message, icon: 'none' });
    }
  },

  // ─── 搜索 ───
  onKeywordInput(e) {
    this.setData({ keyword: e.detail.value });
  },

  async onSearch() {
    const keyword = String(this.data.keyword || '').trim();
    if (!keyword || this.data.searching) return;
    this.setData({ searching: true, searched: false, results: [] });
    try {
      const res = await wx.cloud.callFunction({ name: this.data.meta.searchFn, data: { keyword } });
      const r = res && res.result;
      if (!r || !r.success) throw new Error((r && r.error) || '搜索失败');
      this._searchSnaps = {};
      const results = (r.candidates || []).map(c => {
        const snap = snapshotFromSearch(c, this.data.type);
        this._searchSnaps[snap.doubanId] = snap;
        return {
          doubanId: snap.doubanId,
          title: snap.title,
          sub: subLine(snap, this.data.type),
          thumb: imageCacheManager.getThumbnailUrl(snap.cover, 'list'),
          added: this.isInList('', snap.doubanId),
        };
      });
      this.setData({ results, searched: true });
    } catch (e) {
      console.error('[customList/add] 搜索失败', e);
      this.setData({ searched: true });
      wx.showToast({ title: '搜索失败，请稍后重试', icon: 'none' });
    } finally {
      this.setData({ searching: false });
    }
  },

  async onAddSearchItem(e) {
    const doubanId = e.currentTarget.dataset.id;
    const snap = this._searchSnaps && this._searchSnaps[doubanId];
    if (!snap || this.data.addingId) return;
    if (this.data.room <= 0) {
      wx.showToast({ title: `已达上限 ${MAX_ITEMS} 条`, icon: 'none' });
      return;
    }
    this.setData({ addingId: doubanId });
    try {
      const res = await this.addItems([snap]);
      this.toastResult(res);
    } catch (err) {
      wx.showToast({ title: err.message, icon: 'none' });
    } finally {
      this.setData({ addingId: '' });
    }
  },

  // ─── 共用 ───
  async addItems(items) {
    const res = await callList('addItems', { listId: this.data.listId, items });
    if (res.added) markDirty(this.data.listId);
    const inListMap = { ...this.data.inListMap };
    (res.addedIds || []).forEach(id => { inListMap[id] = true; });
    items.forEach(it => { if (it.doubanId && this._doubanIn) this._doubanIn.add(String(it.doubanId)); });
    const count = res.count != null ? res.count : this.data.count + (res.added || 0);
    const results = this.data.results.map(r => ({ ...r, added: r.added || items.some(it => it.doubanId && it.doubanId === r.doubanId) }));
    this.setData({ inListMap, count, room: Math.max(0, MAX_ITEMS - count), results });
    return res;
  },

  toastResult(res) {
    const unit = this.data.meta.unit;
    let title = res.added ? `已加入 ${res.added} ${unit}` : '没有新加入的条目';
    if (res.overflow) title += `，${res.overflow} ${unit}超出上限`;
    else if (res.skipped) title += `，${res.skipped} ${unit}已在清单`;
    wx.showToast({ title, icon: res.added ? 'success' : 'none' });
  },
});
