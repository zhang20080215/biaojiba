// 从豆瓣导入「看过 / 想看」：一次性搬家，不记豆瓣账号（见 cloudfunctions/importDoubanMarks 文件头）
//
// 流程：填豆瓣 ID → 预读总数 → 选导入范围 → 逐页导入（进度条）→ 汇总 / 撤销
// 云函数每次只读 1 页 50 条，循环在这里做；页与页之间停一下，给豆瓣那边留点余地。
const { track } = require('../../utils/track.js');

const FN = 'importDoubanMarks';
const PAGE_GAP_MS = 800;
const MAX_RETRY = 3;

function call(data) {
  return wx.cloud.callFunction({ name: FN, data }).then(res => (res && res.result) || { success: false, error: '没有返回' });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

Page({
  data: {
    themeClass: '',
    step: 'input',          // input | preview | importing | done | undone
    idText: '',
    uid: '',
    doneTotal: 0,
    wishTotal: 0,
    withWish: true,
    busy: false,
    errorText: '',
    resumable: false,       // 导入中断过：按钮显示「继续导入」
    progressRead: 0,
    progressTotal: 0,
    progressPercent: 0,
    phaseText: '',
    summary: null,
    undoing: false,
  },

  onLoad() {
    this.setData({ themeClass: getApp().globalData.theme || '' });
    track('douban_import', { step: 'open', result: '', count: 0 });
  },

  onUnload() {
    this._destroyed = true;
  },

  onIdInput(e) {
    this.setData({ idText: String(e.detail.value || '').trim(), errorText: '' });
  },

  async onPreview() {
    if (this.data.busy) return;
    const id = this.data.idText;
    if (!id) return;
    this.setData({ busy: true, errorText: '' });
    try {
      const r = await call({ action: 'preview', uid: id });
      if (this._destroyed) return;
      track('douban_import', { step: 'preview', result: r.success ? 'ok' : (r.code || 'fail'), count: r.success ? r.doneTotal : 0 });
      if (!r.success) { this.setData({ busy: false, errorText: r.error || '读取失败，请重试' }); return; }
      this.setData({
        busy: false, step: 'preview', uid: r.uid,
        doneTotal: r.doneTotal, wishTotal: r.wishTotal, withWish: r.wishTotal > 0, resumable: false
      });
    } catch (e) {
      this.setData({ busy: false, errorText: '网络不太好，请重试' });
    }
  },

  onToggleWish() {
    if (this.data.wishTotal > 0) this.setData({ withWish: !this.data.withWish });
  },

  onChangeAccount() {
    this.setData({ step: 'input', uid: '', errorText: '', resumable: false });
  },

  async onStart() {
    if (this.data.busy) return;
    const statuses = this.data.withWish && this.data.wishTotal > 0 ? ['done', 'mark'] : ['done'];
    this.setData({ busy: true, errorText: '' });
    let job;
    try {
      job = await call({ action: 'start', statuses });
    } catch (e) {
      job = { success: false, error: '网络不太好，请重试' };
    }
    if (this._destroyed) return;
    if (!job.success) {
      track('douban_import', { step: 'start', result: job.code || 'fail', count: 0 });
      this.setData({ busy: false, errorText: job.error || '开始失败，请重试' });
      return;
    }
    track('douban_import', { step: 'start', result: job.resumed ? 'resumed' : 'ok', count: 0 });
    wx.setKeepScreenOn({ keepScreenOn: true });
    const total = (job.statuses.indexOf('done') >= 0 ? this.data.doneTotal : 0) + (job.statuses.indexOf('mark') >= 0 ? this.data.wishTotal : 0);
    this._importId = job.importId;
    this.setData({ step: 'importing', busy: false, errorText: '', progressTotal: total, progressRead: (job.counters && job.counters.read) || 0 });
    this._updateProgress();
    await this._runImport(job);
  },

  _updateProgress(phase) {
    const { progressRead, progressTotal } = this.data;
    const pct = progressTotal ? Math.min(100, Math.round(progressRead / progressTotal * 100)) : 0;
    const data = { progressPercent: pct };
    if (phase) data.phaseText = phase;
    this.setData(data);
  },

  async _runImport(job) {
    const labels = { done: '看过', mark: '想看' };
    for (const status of job.statuses) {
      let start = job.cursors && job.cursors[status] != null ? job.cursors[status] : 0;
      while (start != null && start >= 0) {
        if (this._destroyed) return;
        this._updateProgress('「' + labels[status] + '」');
        let r = null;
        for (let attempt = 0; attempt < MAX_RETRY; attempt++) {
          try {
            r = await call({ action: 'page', importId: job.importId, uid: this.data.uid, status, start });
          } catch (e) {
            r = { success: false, code: 'NETWORK', error: '网络不稳定' };
          }
          if (r.success || r.code === 'PAUSED' || r.code === 'NO_JOB' || r.code === 'USER_NOT_FOUND') break;
          await sleep(1500 * (attempt + 1));
        }
        if (this._destroyed) return;
        if (!r.success) {
          track('douban_import', { step: 'page', result: r.code || 'fail', count: this.data.progressRead });
          wx.setKeepScreenOn({ keepScreenOn: false });
          this.setData({ step: 'preview', resumable: true, errorText: (r.error || '导入中断') + '，已导入的会保留' });
          this._markDirty();
          return;
        }
        this.setData({ progressRead: this.data.progressRead + r.read });
        this._updateProgress();
        start = r.nextStart;
        if (start != null) await sleep(PAGE_GAP_MS);
      }
    }
    await this._finish(job.importId);
  },

  async _finish(importId) {
    let r;
    try { r = await call({ action: 'finish', importId }); } catch (e) { r = { success: false }; }
    wx.setKeepScreenOn({ keepScreenOn: false });
    if (this._destroyed) return;
    const c = (r && r.counters) || {};
    const imported = (c.added || 0) + (c.upgraded || 0);
    track('douban_import', { step: 'done', result: r && r.success ? 'ok' : 'fail', count: imported });
    this._markDirty();
    this.setData({
      step: 'done',
      progressPercent: 100,
      summary: {
        read: c.read || 0,
        imported,
        skipped: c.skipped || 0,
        unmatched: c.unmatched || 0,
        top250: c.top250 || 0
      }
    });
  },

  // 让列表页、首页的进度回来时重拉标记
  _markDirty() {
    getApp().globalData.doubanImportDirty = true;
    try { require('../../utils/hubStore').invalidateSummary(); } catch (e) { /* 首页摘要失效失败不影响导入 */ }
  },

  onGoTop250() {
    const pages = getCurrentPages();
    const prev = pages.length > 1 ? pages[pages.length - 2] : null;
    if (prev && prev.route === 'pages/douban/list/list') wx.navigateBack();
    else wx.redirectTo({ url: '/pages/douban/list/list' });
  },

  onGoDailyMovie() {
    track('douban_import', { step: 'daily_movie', result: '', count: 0 });
    wx.redirectTo({ url: '/pages/daily/movie/index' });
  },

  onUndo() {
    if (this.data.undoing || !this._importId) return;
    wx.showModal({
      title: '撤销这次导入？',
      content: '这次导入的标记会还原，之后你自己改过的不受影响。',
      confirmText: '撤销',
      confirmColor: '#C0392B',
      success: res => { if (res.confirm) this._runUndo(); }
    });
  },

  async _runUndo() {
    this.setData({ undoing: true });
    let removed = 0;
    let restored = 0;
    try {
      for (let i = 0; i < 40; i++) {
        const r = await call({ action: 'undo', importId: this._importId });
        if (!r.success) throw new Error(r.error || '撤销失败');
        removed += r.removed;
        restored += r.restored;
        if (!r.remaining) break;
      }
      track('douban_import', { step: 'undo', result: 'ok', count: removed + restored });
      this._markDirty();
      this.setData({ undoing: false, step: 'undone', summary: Object.assign({}, this.data.summary, { removed, restored }) });
    } catch (e) {
      track('douban_import', { step: 'undo', result: 'fail', count: removed + restored });
      this.setData({ undoing: false });
      wx.showToast({ title: '撤销没完成，请再点一次', icon: 'none' });
    }
  },
});
