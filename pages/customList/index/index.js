// 我的影单 / 书单入口：每种类型一张卡，没有就「创建」，有就「查看 / 管理」。
const { MAX_ITEMS, TYPE_META, callList, listUrl } = require('../common.js');

function buildCards(lists, quota) {
  return ['movie', 'book'].map(type => {
    const meta = TYPE_META[type];
    const mine = lists.filter(l => l.type === type);
    return {
      type,
      noun: meta.noun,
      unit: meta.unit,
      brand: meta.brand,
      soft: meta.soft,
      list: mine[0] || null,
      canCreate: mine.length < ((quota && quota[type]) || 1),
    };
  });
}

Page({
  data: {
    loading: true,
    error: '',
    cards: buildCards([], null),
    maxItems: MAX_ITEMS,
  },

  onShow() {
    this.load();
  },

  async load() {
    try {
      const res = await callList('mine');
      this.setData({ loading: false, error: '', cards: buildCards(res.lists || [], res.quota) });
    } catch (e) {
      this.setData({ loading: false, error: e.message });
    }
  },

  findCard(type) {
    return this.data.cards.find(c => c.type === type);
  },

  onOpen(e) {
    const card = this.findCard(e.currentTarget.dataset.type);
    if (card && card.list) wx.navigateTo({ url: listUrl(card.list) });
  },

  onEdit(e) {
    const card = this.findCard(e.currentTarget.dataset.type);
    if (card && card.list) wx.navigateTo({ url: `/pages/customList/edit/edit?listId=${card.list._id}` });
  },

  onCreate(e) {
    const type = e.currentTarget.dataset.type;
    const meta = TYPE_META[type];
    wx.showModal({
      title: `创建${meta.noun}`,
      editable: true,
      placeholderText: `给${meta.noun}起个名字（20 字内）`,
      confirmText: '创建',
      success: async (r) => {
        if (!r.confirm) return;
        const title = String(r.content || '').trim().slice(0, 20) || `我的${meta.noun}`;
        wx.showLoading({ title: '创建中', mask: true });
        try {
          const res = await callList('create', { type, title });
          wx.hideLoading();
          wx.navigateTo({ url: `/pages/customList/edit/edit?listId=${res.listId}&fresh=1` });
        } catch (err) {
          wx.hideLoading();
          wx.showToast({ title: err.message, icon: 'none' });
        }
      },
    });
  },
});
