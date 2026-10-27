// 自建影单 / 书单的「名称 + 说明语」表单：创建（?type=movie|book）和修改（?listId=&title=&description=）共用。
// 创建成功直接换成管理页去挑内容；修改成功返回管理页（它 onShow 会重拉）。
const { TYPE_META, TITLE_MAX, DESC_MAX, callList, markDirty } = require('../common.js');

Page({
  data: {
    mode: 'create',
    type: 'movie',
    meta: TYPE_META.movie,
    listId: '',
    title: '',
    description: '',
    titleMax: TITLE_MAX,
    descMax: DESC_MAX,
    saving: false,
  },

  onLoad(options) {
    const listId = options.listId || '';
    const type = options.type === 'book' ? 'book' : 'movie';
    const meta = TYPE_META[type];
    const decode = v => (v ? decodeURIComponent(v) : '');
    this.setData({
      mode: listId ? 'edit' : 'create',
      type,
      meta,
      listId,
      title: decode(options.title).slice(0, TITLE_MAX),
      description: decode(options.description).slice(0, DESC_MAX),
    });
    wx.setNavigationBarTitle({ title: listId ? `编辑${meta.noun}信息` : `创建${meta.noun}` });
  },

  onTitleInput(e) {
    this.setData({ title: e.detail.value });
  },

  onDescInput(e) {
    this.setData({ description: e.detail.value });
  },

  async onSubmit() {
    if (this.data.saving) return;
    const { mode, type, listId, meta } = this.data;
    const title = String(this.data.title || '').trim().slice(0, TITLE_MAX);
    const description = String(this.data.description || '').trim().slice(0, DESC_MAX);
    if (mode === 'edit' && !title) {
      wx.showToast({ title: `${meta.noun}名称不能为空`, icon: 'none' });
      return;
    }
    this.setData({ saving: true });
    try {
      if (mode === 'create') {
        const res = await callList('create', { type, title: title || `我的${meta.noun}`, description });
        wx.redirectTo({ url: `/pages/customList/edit/edit?listId=${res.listId}&fresh=1` });
      } else {
        await callList('rename', { listId, title, description });
        markDirty(listId);
        wx.navigateBack();
      }
    } catch (e) {
      this.setData({ saving: false });
      wx.showToast({ title: e.message, icon: 'none' });
    }
  },
});
