// utils/themeRegistryLoader.js
// 通用列表/海报页用：本地没有这个云端主题的注册信息时，先从云端拉一次注册表。
//
// 本地注册表缓存平时由首页 loadCloudRegistry 写入。用户从分享卡片直接进列表页时没经过首页，
// 缓存可能是空的，也可能是昨天的（里面没有今天新上的主题）。
// themeRegistry.js 刻意只依赖 wx.storage，所以调云函数的部分放在这里。

const themeRegistry = require('./themeRegistry.js');

let inflight = null;

// 硬编码主题和已缓存的云端主题都不用等，页面照旧同步启动
function needsFetch(theme, hardcoded) {
  return !!theme && !(hardcoded && hardcoded[theme]) && !themeRegistry.find(theme);
}

// 拉注册表写缓存，返回是否成功。失败不抛错：页面用默认配色继续走，数据路由不依赖它
function refresh() {
  if (inflight) return inflight;
  inflight = Promise.resolve()
    .then(() => wx.cloud.callFunction({ name: 'getThemeRegistry', data: {} }))
    .then((res) => {
      const result = res && res.result;
      if (!result || !result.success || !Array.isArray(result.themes)) return false;
      themeRegistry.writeAll(result.themes);
      return true;
    })
    .catch((e) => {
      console.warn('拉取主题注册表失败', e);
      return false;
    })
    .then((ok) => {
      inflight = null;
      return ok;
    });
  return inflight;
}

function ensureTheme(theme, hardcoded) {
  return needsFetch(theme, hardcoded) ? refresh() : Promise.resolve(true);
}

module.exports = { needsFetch, refresh, ensureTheme };
