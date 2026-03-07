// utils/canvasHelper.js - Canvas绘图工具类
const imageCacheManager = require('./imageCacheManager');

function CanvasHelper(canvas, ctx, canvasSize) {
  this.canvas = canvas;
  this.ctx = ctx;
  this.canvasSize = canvasSize;
  this.imageCache = {}; // 图片缓存，使用对象代替Map以提高兼容性
}

CanvasHelper.prototype.loadImage = async function (url, retryCount = 3) {
  // 1. 检查本页面内存缓存（最快）
  if (this.imageCache[url]) {
    return this.imageCache[url];
  }

  // 辅助函数：根据路径创建Image对象（用于 Canvas 2D）
  const createImageObject = (path) => {
    return new Promise((resolve, reject) => {
      if (this.canvas && this.canvas.createImage) {
        const img = this.canvas.createImage();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Image Object Load Error: ' + path));
        img.src = path;
      } else {
        resolve(path); // 降级为旧版路径
      }
    });
  };

  // 如果是网络图片或云存储图片，需要先下载到本地
  let localPath = url;

  // 判断是否是网络图片（http/https开头）
  if (url.startsWith('http://') || url.startsWith('https://')) {
    // 2. 查询跨页面会话缓存（列表页预下载的本地路径）
    const cachedPath = imageCacheManager.getLocalPath(url);
    if (cachedPath) {
      try {
        // 验证临时文件仍然可访问
        const res = await this._getImageInfo(cachedPath);
        const imgObj = await createImageObject(res.path);
        this.imageCache[url] = imgObj;
        console.debug('[ImageCache] 命中跨页面缓存:', url.substring(url.lastIndexOf('/') + 1));
        return imgObj;
      } catch (e) {
        // 临时文件已失效，继续正常下载
        console.debug('[ImageCache] 缓存路径失效，重新下载');
      }
    }

    // 3. 正常下载
    try {
      console.log(`下载网络图片到本地: ${url.substring(0, 60)}...`);
      localPath = await this._downloadFile(url);
      // 写入跨页面会话缓存，供下次复用
      imageCacheManager.cacheLocalPath(url, localPath);
      console.log(`下载成功，本地路径: ${localPath}`);
    } catch (err) {
      console.error('下载网络图片失败:', err);
      // 如果下载失败，尝试直接使用URL（某些情况下wx.getImageInfo支持网络URL）
    }
  }

  // 尝试获取图片信息
  for (let i = 0; i < retryCount; i++) {
    try {
      const res = await this._getImageInfo(localPath);
      const imgObj = await createImageObject(res.path);
      this.imageCache[url] = imgObj;
      return imgObj;
    } catch (err) {
      console.error(`加载图片失败 (尝试 ${i + 1}/${retryCount}):`, err, 'URL:', url);
      if (i === retryCount - 1) {
        // 最后一次尝试，如果localPath是下载的临时文件，尝试使用原始URL
        if (localPath !== url && url.startsWith('http')) {
          try {
            const res = await this._getImageInfo(url);
            const imgObj = await createImageObject(res.path);
            this.imageCache[url] = imgObj;
            return imgObj;
          } catch (finalErr) {
            throw err; // 抛出原始错误
          }
        }
        throw err;
      }
      // 等待后重试
      await this._sleep(500 * (i + 1));
    }
  }
};

CanvasHelper.prototype._getImageInfo = function (url) {
  return new Promise((resolve, reject) => {
    wx.getImageInfo({
      src: url,
      success: resolve,
      fail: reject
    });
  });
};

CanvasHelper.prototype._sleep = function (ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
};

CanvasHelper.prototype.drawAvatar = async function (avatarUrl, x, y, size) {
  const ctx = this.ctx;
  try {
    let imagePath;

    // 处理微信头像URL
    if (avatarUrl.startsWith('https://thirdwx.qlogo.cn')) {
      const tempPath = await this._downloadFile(avatarUrl);
      imagePath = await this.loadImage(tempPath);
    } else {
      imagePath = await this.loadImage(avatarUrl);
    }

    ctx.save();
    ctx.beginPath();
    ctx.arc(x + size / 2, y + size / 2, size / 2, 0, 2 * Math.PI);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(imagePath, x, y, size, size);
    ctx.restore();
  } catch (err) {
    console.error('绘制头像失败:', err);
    this._drawDefaultAvatar(x, y, size);
  }
};

CanvasHelper.prototype._downloadFile = function (url) {
  return new Promise((resolve, reject) => {
    wx.downloadFile({
      url,
      success: res => {
        if (res.statusCode === 200) {
          resolve(res.tempFilePath);
        } else {
          reject(new Error(`下载失败: ${res.statusCode}`));
        }
      },
      fail: reject
    });
  });
};

CanvasHelper.prototype._drawDefaultAvatar = function (x, y, size) {
  const ctx = this.ctx;
  ctx.save();
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size / 2, size / 2, 0, 2 * Math.PI);
  ctx.closePath();
  ctx.clip();
  ctx.fillStyle = "#eee";
  ctx.fillRect(x, y, size, size);
  ctx.restore();
};

CanvasHelper.prototype.getCloudTempUrl = async function (fileID) {
  try {
    const res = await wx.cloud.getTempFileURL({
      fileList: [{ fileID, maxAge: 60 * 60 }]
    });
    if (res.fileList && res.fileList[0] && res.fileList[0].tempFileURL) {
      return res.fileList[0].tempFileURL;
    }
    throw new Error('获取临时URL失败');
  } catch (err) {
    console.error('获取云存储URL失败:', err);
    throw err;
  }
};

CanvasHelper.prototype.clear = function () {
  const { width, height } = this.canvasSize;
  this.ctx.clearRect(0, 0, width, height);
};

CanvasHelper.prototype.clearCache = function () {
  this.imageCache = {};
};

// 添加其他方法
CanvasHelper.prototype.drawRoundRectPath = function (x, y, w, h, r) {
  const ctx = this.ctx;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
};

CanvasHelper.prototype.drawGradientBorder = function (x, y, width, height, borderWidth, borderRadius) {
  const ctx = this.ctx;
  const gradient = ctx.createLinearGradient(x, y, x + width, y + height);
  gradient.addColorStop(0, '#fdecec');
  gradient.addColorStop(1, '#d2f1fe');

  ctx.fillStyle = gradient;
  this.drawRoundRectPath(x, y, width, height, borderRadius);
  ctx.fill();

  ctx.fillStyle = '#fcfcfc';
  this.drawRoundRectPath(
    x + borderWidth,
    y + borderWidth,
    width - borderWidth * 2,
    height - borderWidth * 2,
    borderRadius - borderWidth
  );
  ctx.fill();
};

module.exports = CanvasHelper;
