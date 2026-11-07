// 每日电影 / 每日读书分享页：把封面加载成 canvas image 节点（movie/share、read/share 共用）。
//
// 只信任云存储（cloud://）封面：批量换临时链接后加载；豆瓣等直链一律占位——canvas 不做 downloadFile 直链，
// 避免依赖域名白名单（syncDailyLog 写入时已把 meta.poster / meta.cover 镜像成 cloud://）。
// 无封面 / 换链失败 / 加载失败 → null，绘制器画占位。
//
// 原来逐张串行加载，一张要「下载 + 读图片信息 + 建 image」三步，年度海报 100 多部要等几十秒（用户反馈）。
// 现在同时加载 CONCURRENCY 张：wx.downloadFile 同时最多 10 个，留几个给页面上别的请求。
// 不碰 wx：换链和加载由调用方传进来，tools/test-poster-covers.cjs 用假函数测。

const CONCURRENCY = 6;
const TEMP_URL_BATCH = 50;     // getTempFileURL 单次上限

/** 对 items 逐个跑 fn，同时最多 limit 个；isCancelled() 为真时不再开新的 */
async function mapLimit(items, limit, fn, isCancelled) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      if (isCancelled && isCancelled()) return;
      const i = next++;
      await fn(items[i], i);
    }
  };
  const n = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: n }, worker));
}

/**
 * 补齐 nodes 里还没有的封面（已有的 key 不重复加载，切范围 / 主题 / 版式重绘复用）。
 * opts:
 *   movies          [{ key, poster }]
 *   nodes           key → image 节点 | null，就地写入
 *   getTempFileURL  fileIDs → Promise<{ fileList: [{ fileID, tempFileURL }] }>
 *   load            url → Promise<image 节点>
 *   onProgress      (done, total)，每加载完一张调一次（可选）
 *   isCancelled     () → bool，页面卸载后停止（可选）
 *   allowHttp       true 时 http(s) 封面不换链、直接交给 load（榜单页：封面可能是豆瓣直链，
 *                   load 用 CanvasHelper.loadImage，它自己会下载并走跨页面缓存）。默认 false，每日电影 / 读书行为不变
 */
async function ensureCoverNodes(opts) {
  const { movies, nodes, getTempFileURL, load, onProgress, isCancelled, allowHttp } = opts;
  const pending = (movies || []).filter(m => !(m.key in nodes));
  if (!pending.length) return;

  // 1. 收集 cloud:// 封面
  const cloudIds = [];
  pending.forEach(m => {
    const raw = m.poster || '';
    if (raw.indexOf('cloud://') === 0 && cloudIds.indexOf(raw) < 0) cloudIds.push(raw);
  });

  // 2. 换临时链接：每批 50 个，几批同时发
  const tempMap = {};
  const batches = [];
  for (let i = 0; i < cloudIds.length; i += TEMP_URL_BATCH) batches.push(cloudIds.slice(i, i + TEMP_URL_BATCH));
  await Promise.all(batches.map(async list => {
    try {
      const r = await getTempFileURL(list);
      ((r && r.fileList) || []).forEach(f => { if (f.fileID && f.tempFileURL) tempMap[f.fileID] = f.tempFileURL; });
    } catch (e) {
      console.warn('getTempFileURL fail', e);
    }
  }));

  // 3. 并发加载
  let done = 0;
  await mapLimit(pending, CONCURRENCY, async m => {
    const raw = m.poster || '';
    const url = tempMap[raw] || (allowHttp && /^https?:\/\//.test(raw) ? raw : '');
    let node = null;
    if (url) {
      try { node = await load(url); } catch (e) { node = null; }
    }
    nodes[m.key] = node;
    done += 1;
    if (onProgress) onProgress(done, pending.length);
  }, isCancelled);
}

module.exports = { CONCURRENCY, mapLimit, ensureCoverNodes };
