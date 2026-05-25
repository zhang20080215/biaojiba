/**
 * 每日打卡 · 顶部 toast helper
 *
 * wx.showToast 原生只能在屏幕中央显示且不可调整位置，
 * 这里用页面 setData 驱动一个固定在中上部的自定义 toast，体验更轻、不挡水瓶/数字。
 *
 * 使用：
 *   const toast = require('../../../utils/dailyToast.js');
 *   toast.show(this, '已保存到相册', { icon: 'success' });
 *
 * 页面侧需求：
 *   data 里初始化 toast: { show: false, text: '', icon: '' }
 *   wxml 渲染一个 .top-toast 节点（见 daily/index/share/stats 三页）
 */

let _timer = null;

function show(page, text, opts) {
  const o = opts || {};
  const duration = o.duration || 1800;
  const icon = o.icon || 'none';     // 'none' | 'success'
  if (!page || !page.setData) return;
  page.setData({
    toast: { show: true, text: text || '', icon }
  });
  if (_timer) clearTimeout(_timer);
  _timer = setTimeout(() => {
    if (page.setData) page.setData({ 'toast.show': false });
    _timer = null;
  }, duration);
}

function hide(page) {
  if (_timer) { clearTimeout(_timer); _timer = null; }
  if (page && page.setData) page.setData({ 'toast.show': false });
}

module.exports = { show, hide };
