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

// _timer 是模块级的，回调会闭包住调用时的 page。若该页在 duration 内被 onUnload（返回/跳转），
// 定时器仍会往已销毁的页面 setData，渲染层即报 insertTextView/updateTextView:fail ... not found。
// 页面若维护了 _destroyed 标记则据此跳过；未维护该标记的页面行为不变。
function alive(page) {
  return !!(page && typeof page.setData === 'function' && !page._destroyed);
}

function show(page, text, opts) {
  const o = opts || {};
  const duration = o.duration || 1800;
  const icon = o.icon || 'none';     // 'none' | 'success'
  if (!alive(page)) return;
  page.setData({
    toast: { show: true, text: text || '', icon }
  });
  if (_timer) clearTimeout(_timer);
  _timer = setTimeout(() => {
    if (alive(page)) page.setData({ 'toast.show': false });
    _timer = null;
  }, duration);
}

function hide(page) {
  if (_timer) { clearTimeout(_timer); _timer = null; }
  if (alive(page)) page.setData({ 'toast.show': false });
}

module.exports = { show, hide };
