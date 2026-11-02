// 本地预览样稿用的极简静态服务：node docs/superpowers/mockups/serve.cjs → http://localhost:5178/refined.html
// /repo/<路径> 映射到仓库根目录（只读 .js / 字体），调试页 harness.html 用它直接加载 utils/poster 的源码。
const http = require('http'), fs = require('fs'), path = require('path');
const root = __dirname, repo = path.resolve(__dirname, '..', '..', '..');
const types = {
  '.html': 'text/html; charset=utf-8', '.jpg': 'image/jpeg', '.json': 'application/json',
  '.js': 'text/javascript; charset=utf-8', '.woff2': 'font/woff2', '.ttf': 'font/ttf'
};
http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  let base = root, rel = url.replace(/^\/+/, '') || 'refined.html';
  if (rel.startsWith('repo/')) {
    base = repo; rel = rel.slice(5);
    if (!/\.(js|woff2|ttf)$/.test(rel)) { res.writeHead(403); return res.end(); }
  }
  const p = path.join(base, rel);
  if (!p.startsWith(base) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(p).pipe(res);
}).listen(5178);
