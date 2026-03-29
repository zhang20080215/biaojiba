Page({
  data: {
    records: [],
    groupedRecords: [],
    loading: true,
    hasMore: true,
    page: 0,
    pageSize: 20
  },

  onLoad() {
    wx.setNavigationBarTitle({ title: '训练记录' });
    this.loadRecords();
  },

  onShareAppMessage() {
    return {
      title: '健身打卡 - 我的训练记录',
      path: '/pages/fitness/input/input'
    };
  },

  onReachBottom() {
    if (this.data.hasMore && !this.data.loading) {
      this.loadRecords();
    }
  },

  async loadRecords() {
    const userInfo = wx.getStorageSync('userInfo');
    if (!userInfo) return;

    this.setData({ loading: true });
    const db = wx.cloud.database();
    const { page, pageSize, records } = this.data;

    try {
      const res = await db.collection('fitness_records')
        .where({ openid: userInfo._openid })
        .orderBy('created_at', 'desc')
        .skip(page * pageSize)
        .limit(pageSize)
        .get();

      const newRecords = [...records, ...res.data];
      const grouped = this.groupByDate(newRecords);

      this.setData({
        records: newRecords,
        groupedRecords: grouped,
        page: page + 1,
        hasMore: res.data.length === pageSize,
        loading: false
      });
    } catch (err) {
      console.error('加载训练记录失败:', err);
      this.setData({ loading: false });
      wx.showToast({ title: '加载失败', icon: 'none' });
    }
  },

  groupByDate(records) {
    const map = {};
    records.forEach(r => {
      const date = r.date || this.formatDate(new Date(r.created_at));
      if (!map[date]) map[date] = [];
      map[date].push(r);
    });
    return Object.keys(map).sort((a, b) => b.localeCompare(a)).map(date => ({
      date,
      dateLabel: this.getDateLabel(date),
      items: map[date]
    }));
  },

  formatDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  },

  getDateLabel(dateStr) {
    const today = this.formatDate(new Date());
    const yesterday = this.formatDate(new Date(Date.now() - 86400000));
    if (dateStr === today) return '今天';
    if (dateStr === yesterday) return '昨天';
    return dateStr;
  },

  formatRecord(r) {
    if (r.category === 'cardio') {
      let text = r.duration ? `${r.duration}分钟` : '';
      if (r.distance) text += ` · ${r.distance}${r.distanceUnit || 'km'}`;
      return text;
    }
    let text = `${r.sets}组 × ${r.reps}次`;
    if (r.weight) text += ` · ${r.weight}kg`;
    return text;
  },

  onRecordTap(e) {
    const record = e.currentTarget.dataset.record;
    const app = getApp();
    app.globalData = app.globalData || {};
    app.globalData.fitnessRecord = record;
    app.globalData.fitnessUserInfo = wx.getStorageSync('userInfo');
    wx.navigateTo({ url: '/pages/fitness/share/share' });
  },

  async onDeleteRecord(e) {
    const id = e.currentTarget.dataset.id;
    const res = await new Promise(resolve => {
      wx.showModal({
        title: '确认删除',
        content: '确定要删除这条训练记录吗？',
        success: resolve
      });
    });
    if (!res.confirm) return;

    try {
      const db = wx.cloud.database();
      await db.collection('fitness_records').doc(id).remove();
      const records = this.data.records.filter(r => r._id !== id);
      const grouped = this.groupByDate(records);
      this.setData({ records, groupedRecords: grouped });
      wx.showToast({ title: '已删除', icon: 'success' });
    } catch (err) {
      console.error('删除失败:', err);
      wx.showToast({ title: '删除失败', icon: 'none' });
    }
  }
});
