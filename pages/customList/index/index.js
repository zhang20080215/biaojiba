// 我的影单 / 书单入口：每种类型一张卡，没有就「创建」，有就「查看 / 管理」。
const { MAX_ITEMS, callList, listUrl, buildCards, promptCreate } = require('../common.js');

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
    promptCreate(e.currentTarget.dataset.type);
  },
});
