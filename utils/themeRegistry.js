// utils/themeRegistry.js
// 通用主题「云端注册表」的本地缓存总线（wx.storage）。
//
// 谁写：pages/category 拉 getThemeRegistry 云函数后 writeAll()。
// 谁读：
//   - utils/dataLoader.js   —— cloudFnForTheme() 给未硬编码的新主题路由 getThemeMovies/getThemeBooks
//   - utils/genericThemeConfig.js / genericBookThemeConfig.js —— getThemeConfig() 对未知主题回落到注册表
//
// 存在的意义：新增一个通用书单/影单主题 = 云端插一条 + 灌库，前端硬编码零改动、不用发版。
// 现有硬编码主题不依赖它（是永久兜底）；本模块只依赖 wx.storage，无 wx.cloud，避免循环引用。
const CACHE_KEY = 'themeRegistryCache';
const TTL_MS = 24 * 60 * 60 * 1000; // 与 dataLoader 影单缓存一致

function _read() {
  try {
    const c = wx.getStorageSync(CACHE_KEY);
    if (c && Array.isArray(c.themes)) return c;
  } catch (e) {}
  return null;
}

// 返回注册表主题数组（无缓存时 []）
function readAll() {
  const c = _read();
  return c ? c.themes : [];
}

// 缓存是否在有效期内（category 页决定要不要用缓存即时渲染 / 是否仍需刷新）
function isFresh() {
  const c = _read();
  return !!(c && c.ts && (Date.now() - c.ts) < TTL_MS);
}

function writeAll(themes) {
  try {
    wx.setStorageSync(CACHE_KEY, {
      ts: Date.now(),
      themes: Array.isArray(themes) ? themes : []
    });
  } catch (e) {
    console.warn('写入主题注册表缓存失败', e);
  }
}

// 按 theme id 找一条注册文档（未命中返回 null）
function find(theme) {
  if (!theme) return null;
  const list = readAll();
  for (let i = 0; i < list.length; i++) {
    if (list[i] && list[i].theme === theme) return list[i];
  }
  return null;
}

module.exports = { CACHE_KEY, readAll, isFresh, writeAll, find };
