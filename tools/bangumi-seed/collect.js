// node tools/bangumi-seed/collect.js — collect a consistent official ranking snapshot.
const fs = require('fs');
const path = require('path');
const cheerio = require('../../cloudfunctions/fetchOscarMovies/node_modules/cheerio');
const axios = require('../../cloudfunctions/fetchOscarMovies/node_modules/axios');
const DIR = __dirname;
const norm = s => String(s || '').normalize('NFKC').toLowerCase().replace(/[\s·・~〜～:：、,，.。!！?？\-—()（）]/g, '');
async function main() {
  const pool = JSON.parse(fs.readFileSync(path.join(DIR, '../douban-tv-seed/doubanTvAnime.json'), 'utf8'));
  const movies = [];
  const browserFile = process.argv[2];
  const browserPages = browserFile ? JSON.parse(fs.readFileSync(browserFile, 'utf8').replace(/^.*?\n(?=\{)/s, '')).result.value : null;
  for (let page = 1; movies.length < 250; page++) {
    const url = `https://bgm.tv/anime/browser?sort=rank&page=${page}`;
    const html = browserPages ? browserPages.find(p => p.page === page).html
      : (await axios.get(url, { timeout: 30000, headers: { 'User-Agent': 'Mozilla/5.0 XiaoBiaoji/1.0' } })).data;
    const $ = cheerio.load(html);
    const before = movies.length;
    $('#browserItemList > li').each((_, el) => {
      const row = $(el);
      const rank = Number(row.find('.rank').text().replace(/\D/g, ''));
      if (!rank || rank > 252) return;
      const anchor = row.find('h3 a');
      const bangumiId = anchor.attr('href').match(/subject\/(\d+)/)[1];
      if (['1773', '72266'].includes(bangumiId)) return;
      const title = anchor.text().trim();
      const originalTitle = row.find('h3 small').text().trim() || title;
      const info = row.find('.info').text().trim();
      const yearMatch = info.match(/(?:19|20)\d{2}/);
      const year = yearMatch ? Number(yearMatch[0]) : null;
      const candidates = pool.filter(d => d.year === year && [title, originalTitle].some(t => norm(t) === norm(d.title)));
      const cover = row.find('img').attr('src') || '';
      const votes = row.find('.tip_j').text().match(/(\d+)人评分/);
      movies.push({ rank, sourceRank: rank, year, title, originalTitle, bangumiId,
        bangumiRating: Number(row.find('.fade').text()) || 0,
        bangumiRatingCount: votes ? Number(votes[1]) : 0,
        bangumiUrl: `https://bangumi.tv/subject/${bangumiId}`,
        bangumiCover: cover.startsWith('//') ? 'https:' + cover : cover,
        ...(candidates.length === 1 ? { doubanId: candidates[0].doubanId } : {}),
        sourceUrl: 'https://bangumi.tv/anime/browser?sort=rank',
        sourceUpdatedAt: new Date().toISOString()
      });
    });
    if (movies.length === before) throw new Error(`No ranked items on page ${page}`);
    console.log(`page ${page}: ${movies.length}`);
    await new Promise(r => setTimeout(r, 700));
  }
  movies.sort((a, b) => a.rank - b.rank);
  const expectedRanks = Array.from({length:252}, (_,i)=>i+1).filter(rank=>![67,92].includes(rank));
  if (movies.length !== 250 || new Set(movies.map(m => m.bangumiId)).size !== 250 || movies.some((m, i) => m.sourceRank !== expectedRanks[i])) throw new Error('Ranking changed or is incomplete; retry collection');
  movies.forEach((m,i)=>{ m.rank=i+1; if(m.bangumiId==='512876')m.doubanId='37040084'; });
  fs.writeFileSync(path.join(DIR, 'bangumi250.json'), JSON.stringify(movies, null, 2) + '\n');
  fs.writeFileSync(path.join(DIR, 'bangumi250.params.json'), JSON.stringify({ theme: 'bangumi250', idStrategy: 'title-year', autoContinue: true, movieList: movies }, null, 2) + '\n');
  console.log(`250 items; ${movies.filter(m => m.doubanId).length} exact title/year Douban candidates; review matches before import.`);
}
main().catch(e => { console.error(e); process.exitCode = 1; });
