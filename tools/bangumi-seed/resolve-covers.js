// Resolve only the 30 external covers reported by the user; no database writes.
const fs = require('fs');
const path = require('path');
const axios = require('../../cloudfunctions/fetchOscarMovies/node_modules/axios');
const queries = {
  '876': 'CLANNAD AFTER STORY', '321': 'Kidou Keisatsu Patlabor 2 the Movie',
  '839': 'PERFECT BLUE', '263750': 'Shingeki no Kyojin Season 3 Part 2',
  '840': 'Sennen Joyuu', '238': 'Innocence', '106207': 'Mushishi Zoku Shou 2nd Season',
  '39923': 'Shin Seiki Evangelion Movie Air Magokoro wo Kimi ni',
  '848': 'Hachimitsu to Clover II', '335036': 'Arcane',
  '470660': 'Chainsaw Man Reze hen', '217300': 'Shingeki no Kyojin Season 3',
  '309311': 'Cyberpunk Edgerunners', '148037': 'Kizumonogatari III Reiketsu hen',
  '55770': 'Shingeki no Kyojin', '88473': 'Mushishi Hihamukage',
  '118335': 'Shingeki no Kyojin 2', '750': 'ARIA The OVA ARIETTA',
  '512876': 'Liu Yang Qing', '13552': 'Kidou Keisatsu Patlabor NEW OVA',
  '285901': 'Golden Kamuy 3', '518425': 'Fanren Xiu Xian Chuan',
  '4077': 'Ookiku Furikabutte Natsu no Taikai hen', '696': 'Kenpuu Denki Berserk',
  '148036': 'Kizumonogatari II Nekketsu hen', '389474': 'Kaguya sama wa Kokurasetai First Kiss wa Owaranai',
  '77480': 'Gin no Saji 2', '88433': 'Kiseijuu Sei no Kakuritsu',
  '37063': 'Kaleido Star Legend of Phoenix Layla Hamilton Monogatari', '3428': 'Bakuman.'
};
const norm = s => String(s || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
async function main() {
  const list = JSON.parse(fs.readFileSync(path.join(__dirname, 'bangumi250.json'), 'utf8'));
  const cacheDir = path.join(__dirname, '.cache', 'anilist');
  fs.mkdirSync(cacheDir, {recursive:true});
  const output = [];
  for (const m of list.filter(m => queries[m.bangumiId])) {
    const search = queries[m.bangumiId];
    const file = path.join(cacheDir, m.bangumiId + '.json');
    let candidates;
    if (fs.existsSync(file)) candidates = JSON.parse(fs.readFileSync(file, 'utf8'));
    else {
      const r = await axios.post('https://graphql.anilist.co', {
        query: 'query($search:String){Page(perPage:5){media(search:$search,type:ANIME){id title{native romaji english} format startDate{year} episodes siteUrl coverImage{large extraLarge}}}}', variables:{search}
      }, {timeout:15000});
      if (r.data.errors) throw new Error(JSON.stringify(r.data.errors));
      candidates = r.data.data.Page.media;
      fs.writeFileSync(file, JSON.stringify(candidates,null,2));
      await new Promise(r=>setTimeout(r,900));
    }
    const acceptable = candidates.filter(c => Math.abs((c.startDate.year || 0)-m.year)<=1 &&
      [c.title.native,c.title.romaji,c.title.english].some(t => [search,m.title,m.originalTitle].some(q=>norm(q)===norm(t))));
    // Only unambiguous full-title/year matches. The combined Evangelion edition and
    // ongoing Chinese-series seasons require manual cover verification.
    const chosen = acceptable.length===1 && !['39923','518425'].includes(m.bangumiId) ? acceptable[0] : null;
    output.push({bangumiId:m.bangumiId,rank:m.rank,title:m.title,year:m.year,search,chosen,candidates});
    console.log(`${m.rank}. ${m.title}: ${chosen ? chosen.id : 'REVIEW'}`);
  }
  fs.writeFileSync(path.join(__dirname,'bangumi250.covers.review.json'), JSON.stringify(output,null,2)+'\n');
  const covers=output.filter(x=>x.chosen).map(x=>({bangumiId:x.bangumiId,coverUrl:x.chosen.coverImage.large,coverSource:'anilist',coverSourceUrl:x.chosen.siteUrl}));
  fs.writeFileSync(path.join(__dirname,'bangumi250.alt-covers.params.json'),JSON.stringify({theme:'bangumi250',alternativeCovers:covers},null,2)+'\n');
  console.log(`Resolved ${covers.length}/${output.length}; others require review.`);
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
