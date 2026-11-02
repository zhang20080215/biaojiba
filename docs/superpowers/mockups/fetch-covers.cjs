// 下载样稿用的豆瓣封面到 covers/（不进仓库）：node docs/superpowers/mockups/fetch-covers.cjs
// 豆瓣图床校验 Referer，带 movie.douban.com 才给图。
const fs = require('fs'), path = require('path'), https = require('https');
const dir = path.join(__dirname, 'covers');
const films = JSON.parse(fs.readFileSync(path.join(__dirname, 'films.json'), 'utf8'));
fs.mkdirSync(dir, { recursive: true });

function get(url, file) {
  return new Promise((resolve) => {
    https.get(url, { headers: { Referer: 'https://movie.douban.com/', 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return resolve(false); }
      res.pipe(fs.createWriteStream(file)).on('finish', () => resolve(true));
    }).on('error', () => resolve(false));
  });
}

(async () => {
  let ok = 0;
  for (const f of films) {
    const file = path.join(dir, f.id + '.jpg');
    if (fs.existsSync(file)) { ok++; continue; }
    if (await get(f.cover.replace('s_ratio_poster', 'm_ratio_poster'), file)) ok++;
  }
  console.log(`covers: ${ok}/${films.length}`);
})();
