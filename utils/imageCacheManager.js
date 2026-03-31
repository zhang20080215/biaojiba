// utils/imageCacheManager.js
// 会话级图片缓存管理器（模块单例，跨页面共享）
// 职责：
//   1. 将网络图片 URL 转换为缩略图 URL（列表用小图，海报用大图）
//   2. 将已 downloadFile 成功的 tempFilePath 存入内存 Map，供 canvasHelper 复用

// ── 内存缓存 Map：originalUrl → localTempPath ──
const _localPathCache = {};

/**
 * 将图片 URL 转换为适合列表展示的缩略图 URL
 * @param {string} url  原始封面 URL
 * @param {string} usage  'list'（小图）| 'poster'（原图）
 * @returns {string}
 */
function getThumbnailUrl(url, usage) {
    if (!url || typeof url !== 'string') return url;

    // 云存储路径：添加图片处理参数（使用微信云存储的 imageMogr2 接口）
    if (url.startsWith('cloud://')) {
        if (usage === 'poster') return url; // 海报页用原图

        // 如果是已被处理过的封面，避免再次经过云处理引发 500 错误
        if (url.includes('imdb_covers') || url.includes('oscar_covers') || url.includes('boxoffice_covers')) {
            return url;
        }

        // 列表页：压缩到宽度 200px，质量 75%
        return url + '?imageMogr2/thumbnail/200x/quality/75';
    }

    // 本地路径直接返回
    if (url.startsWith('wxfile://') || url.startsWith('/') || url.startsWith('data:')) {
        return url;
    }

    if (usage === 'poster') return url; // 海报页始终用原图

    // ── 豆瓣：l_ratio_poster → s_ratio_poster ──
    if (url.includes('doubanio.com')) {
        return url.replace('/l_ratio_poster/', '/s_ratio_poster/');
    }

    // ── IMDb：调整 URL 中内嵌的尺寸参数 ──
    // 原始格式示例：...._V1_UX182_CR0,0,182,268_AL_.jpg
    // 目标：缩至约 128px 宽
    if (url.includes('media-amazon.com')) {
        return url
            .replace(/UX\d+/g, 'UX128')
            .replace(/UY\d+/g, 'UY190')
            .replace(/_CR[\d,]+_/, '_CR0,0,128,190_');
    }

    // 其他 URL 直接返回
    return url;
}

/**
 * 将已下载成功的本地临时路径存入内存缓存
 * @param {string} originalUrl  原始图片 URL（以此为 key）
 * @param {string} localTempPath  wx.downloadFile 返回的 tempFilePath
 */
function cacheLocalPath(originalUrl, localTempPath) {
    if (originalUrl && localTempPath) {
        _localPathCache[originalUrl] = localTempPath;
    }
}

/**
 * 查询某 URL 是否已有本地缓存路径
 * @param {string} url
 * @returns {string|null}  本地路径或 null
 */
function getLocalPath(url) {
    return _localPathCache[url] || null;
}

/**
 * 后台静默预下载图片到临时文件并缓存（不阻塞调用方）
 * 供列表页 onImageLoad 调用，提前为海报生成热身
 * @param {string} url  原始（全尺寸）图片 URL
 */
function prefetchToLocal(url) {
    if (!url || _localPathCache[url]) return; // 已缓存则跳过
    if (url.startsWith('cloud://') || url.startsWith('wxfile://') ||
        url.startsWith('/') || url.startsWith('data:')) return;
    // 豆瓣图片服务器拒绝小程序 downloadFile 请求，直接跳过
    if (url.includes('doubanio.com')) return;

    wx.downloadFile({
        url: url,
        success: function (res) {
            if (res.statusCode === 200) {
                cacheLocalPath(url, res.tempFilePath);
                console.debug('[ImageCache] 预缓存成功:', url.substring(url.lastIndexOf('/') + 1));
            }
        },
        fail: function () {
            // 静默失败，不影响任何功能
        }
    });
}

module.exports = {
    getThumbnailUrl,
    cacheLocalPath,
    getLocalPath,
    prefetchToLocal
};
