/**
 * 用户信息内存缓存
 * userInfo 在 20+ 页面里被高频 getStorageSync 反复同步读取（阻塞 JS 线程）。
 * 这里做模块级单例缓存：首次读 storage 一次，之后全走内存；写入时同步更新内存 + storage。
 *
 * 用法：
 *   const userStore = require('<rel>/utils/userStore.js')
 *   const info = userStore.getUserInfo()       // 读（缓存）
 *   userStore.setUserInfo(info)                 // 写（内存 + storage）
 *   userStore.clearUserInfo()                   // 退出登录
 */

var STORAGE_KEY = 'userInfo'
var _cache = null
var _loaded = false

function getUserInfo() {
  if (!_loaded) {
    try {
      _cache = wx.getStorageSync(STORAGE_KEY) || null
    } catch (e) {
      _cache = null
    }
    _loaded = true
  }
  return _cache
}

function setUserInfo(info) {
  _cache = info || null
  _loaded = true
  try {
    if (info) {
      wx.setStorageSync(STORAGE_KEY, info)
    } else {
      wx.removeStorageSync(STORAGE_KEY)
    }
  } catch (e) { /* ignore */ }
}

function clearUserInfo() {
  setUserInfo(null)
}

module.exports = {
  getUserInfo: getUserInfo,
  setUserInfo: setUserInfo,
  clearUserInfo: clearUserInfo,
}
