// 运维函数：把随函数打包的 assets/ 目录原样传到云存储（cloudPath = assets/ 下的相对路径）。
//
// 为什么要经云函数传而不是控制台手传：本环境的存储权限不是「所有用户可读」（改权限要付费），
// 控制台手传的文件没有创建者身份，小程序端 getTempFileURL 直接报 STORAGE_EXCEED_AUTHORITY；
// 云函数以管理端身份上传的文件（各主题 `{xxx}_covers/` 封面都是这么来的）小程序端能读。
//
// 用法（云端测试）：
//   { "dryRun": true }                       只列出将要上传的文件
//   {}                                       全部上传，同名覆盖
//   { "only": ["category_covers/cover-daily-water.jpg"] }   只传指定几个
//
// 新增静态资源 = 把文件放进 assets/<云存储目录>/ 后重新部署再跑一次；不用改代码。
const cloud = require('wx-server-sdk');
const fs = require('fs');
const path = require('path');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const ASSETS_DIR = path.join(__dirname, 'assets');

function walk(dir, base) {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const rel = base ? `${base}/${name}` : name;
    if (fs.statSync(full).isDirectory()) out.push(...walk(full, rel));
    else if (!name.startsWith('.')) out.push({ rel, full, size: fs.statSync(full).size });
  }
  return out;
}

exports.main = async (event = {}) => {
  const { dryRun = false, only } = event;
  if (!fs.existsSync(ASSETS_DIR)) return { success: false, error: 'assets/ 目录不存在' };

  let files = walk(ASSETS_DIR, '');
  if (Array.isArray(only) && only.length) {
    const set = new Set(only);
    files = files.filter(f => set.has(f.rel));
  }
  if (dryRun) return { success: true, dryRun: true, count: files.length, files: files.map(f => ({ cloudPath: f.rel, size: f.size })) };

  const uploaded = [];
  const failed = [];
  for (const f of files) {
    try {
      const res = await cloud.uploadFile({ cloudPath: f.rel, fileContent: fs.readFileSync(f.full) });
      uploaded.push({ cloudPath: f.rel, size: f.size, fileID: res.fileID });
    } catch (e) {
      failed.push({ cloudPath: f.rel, error: e.message || String(e) });
    }
  }
  return { success: failed.length === 0, uploaded, failed };
};
