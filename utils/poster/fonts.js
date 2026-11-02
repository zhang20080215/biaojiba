// 海报数字字体：Inter 子集（只含数字、拉丁字母和几个符号，每个字重约 10KB），给 canvas 用。
// 中文仍用系统字体（iOS 苹方）—— 中文字体动辄几 MB，不加载。
//
// 字体文件放在云存储 poster_fonts/，由 cloudfunctions/uploadStaticAssets 上传（控制台手传的文件小程序端读不到）。
// 先试 woff2，失败再试 ttf；整体 1.5 秒超时，失败就回退系统数字字体（tokens.num(…, false)），版式不依赖 Inter 才成立。
// 一次会话只加载一次，结果缓存在模块变量里。
// 字体：Inter © The Inter Project Authors，SIL Open Font License 1.1（可商用、可随应用分发）。
// 子集取自 Google Fonts css2 的 text= 参数，源文件在 cloudfunctions/uploadStaticAssets/assets/poster_fonts/。
const { NUM_FAMILY } = require('./tokens.js');

const BASE = 'cloud://cloud1-3gn3wryx716919c6.636c-cloud1-3gn3wryx716919c6-1360913831/poster_fonts/';
const WEIGHTS = ['500', '700', '800'];
const TIMEOUT = 1500;

let _promise = null;

function withTimeout(p, ms) {
  return Promise.race([p, new Promise(resolve => setTimeout(() => resolve(false), ms))]);
}

function loadFace(url, weight) {
  return new Promise(resolve => {
    wx.loadFontFace({
      family: NUM_FAMILY,
      source: `url("${url}")`,
      desc: { weight },
      scopes: ['native'],          // canvas 2d 是原生渲染，只给 webview 用的字体它看不见
      global: true,
      success: () => resolve(true),
      fail: () => resolve(false)
    });
  });
}

async function loadAll() {
  if (typeof wx === 'undefined' || !wx.loadFontFace || !wx.cloud) return false;
  const files = [];
  WEIGHTS.forEach(w => { files.push(`${BASE}inter-${w}.woff2`, `${BASE}inter-${w}.ttf`); });
  let map = {};
  try {
    const r = await wx.cloud.getTempFileURL({ fileList: files });
    ((r && r.fileList) || []).forEach(f => { if (f.tempFileURL) map[f.fileID] = f.tempFileURL; });
  } catch (e) {
    return false;
  }
  const results = await Promise.all(WEIGHTS.map(async w => {
    const woff2 = map[`${BASE}inter-${w}.woff2`];
    const ttf = map[`${BASE}inter-${w}.ttf`];
    if (woff2 && await loadFace(woff2, w)) return true;
    if (ttf && await loadFace(ttf, w)) return true;
    return false;
  }));
  // 三个字重都要到位才算成功：缺一个字重时系统会拿别的字重硬凑，比全用系统字体更难看
  return results.every(Boolean);
}

/** 开始加载（可重复调用，只加载一次）；返回 Promise<boolean>，最多等 1.5 秒 */
function ensureFonts() {
  if (!_promise) {
    _promise = withTimeout(loadAll(), TIMEOUT).then(ok => {
      if (!ok) _promise = null;    // 这次没成：下次打开海报页再试，不在本页反复重试
      return !!ok;
    });
  }
  return _promise;
}

module.exports = { ensureFonts };
