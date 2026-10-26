// node tools/douban-scifi-seed/collect.js
// User scope: Douban explore, science fiction tag, score 8..10, default comprehensive order.
const fs = require('fs');
const path = require('path');
const axios = require('../../cloudfunctions/fetchOscarMovies/node_modules/axios');
const DIR = __dirname;
const CACHE = path.join(DIR, '.cache');
const headers = { Referer:'https://movie.douban.com/explore', 'User-Agent':'Mozilla/5.0', Accept:'application/json' };
const FEATURES = process.argv.includes('--features');
const pause = ms => new Promise(r=>setTimeout(r,ms));
async function detail(id) {
  const file=path.join(CACHE,'detail-'+id+'.json');
  if(fs.existsSync(file))return JSON.parse(fs.readFileSync(file));
  try {
    const r=await axios.get(`https://m.douban.com/rexxar/api/v2/movie/${id}`,{timeout:10000,headers:{...headers,Referer:'https://m.douban.com/'}});
    if(!r.data.id)return null;
    fs.writeFileSync(file,JSON.stringify(r.data));return r.data;
  }catch(e){return null;}
}
function isFeature(d) {
  if(!d||d.subtype!=='movie'||d.is_tv)return false;
  if((d.genres||[]).some(g=>['短片','纪录片','脱口秀','真人秀','舞台艺术','戏曲'].includes(g)))return false;
  if(/圣诞.*(?:特辑|特别集)|巡演|单口|演唱会|音乐会|舞台剧|新春SP|除夕特别篇/.test(d.title||''))return false;
  return (d.durations||[]).some(t=>Number(String(t).match(/\d+/)?.[0])>=60);
}
async function main() {
  fs.mkdirSync(CACHE,{recursive:true});
  const pool = new Map();
  for(const scoreRange of ['8,10']) {
  for (let start=0; start<2000 && pool.size<250; start+=50) {
    const url = 'https://m.douban.com/rexxar/api/v2/movie/recommend?refresh=0&start='+start+
      '&count=50&selected_categories=%7B%7D&uncollect=false&score_range='+scoreRange+'&tags='+encodeURIComponent('科幻')+'&sort=T';
    const r=await axios.get(url,{timeout:15000,headers});
    if (!Array.isArray(r.data.items)) throw Error('No movie items: '+JSON.stringify(r.data));
    fs.writeFileSync(path.join(CACHE,'page-'+scoreRange.replace(',','-')+'-'+start+'.json'),JSON.stringify(r.data));
    for (const x of r.data.items) {
      if (x.type!=='movie' || x.card==='chart' || !/^\d+$/.test(String(x.id))) continue;
      if (!(Number(x.rating?.value)>=8 && Number(x.rating?.value)<=10) || !x.pic?.large || !/^\d{4}$/.test(x.year||'')) continue;
      if (!pool.has(String(x.id))) pool.set(String(x.id),x);
    }
    console.log(`${scoreRange} offset ${start}: ${pool.size} movies`);
    if (r.data.items.length<50) break;
    await pause(300);
  }
  }
  const candidates=[...pool.values()];
  const rows=[];
  const rejected=[];
  if(FEATURES) {
    for(let i=0;i<candidates.length && rows.length<250;i+=5) {
      const batch=await Promise.all(candidates.slice(i,i+5).map(async x=>({x,d:await detail(x.id)})));
      for(const {x,d} of batch) {
        if(isFeature(d))rows.push({...x,detail:d});
        else rejected.push({id:x.id,title:x.title,reason:d?'非长片或特辑/演出':'详情不可读取'});
      }
      console.log(`verified ${Math.min(i+5,candidates.length)}: ${rows.length} features`);
      await pause(350);
    }
    rows.splice(250);
  } else rows.push(...candidates.slice(0,250));
  fs.writeFileSync(path.join(DIR,'excluded.review.json'),JSON.stringify(rejected,null,2)+'\n');
  if (rows.length!==250) throw Error(`Only ${rows.length}, no partial seed written`);
  const timestamp=new Date().toISOString();
  const list=rows.map((x,i)=>({rank:i+1,title:x.title,originalTitle:x.title,year:Number(x.year),doubanId:String(x.id),
    rating:Number(x.rating.value),ratingCount:Number(x.rating.count)||0,sourceRating:Number(x.rating.value),
    sourceRatingCount:Number(x.rating.count)||0,sourceCoverUrl:x.pic.large,
    sourceUrl:'https://movie.douban.com/explore',sourceSubjectUrl:`https://movie.douban.com/subject/${x.id}/`,
    sourceUpdatedAt:timestamp,ratingSource:'douban_recommend',
    ...(x.detail?{director:(x.detail.directors||[]).map(d=>d.name).filter(Boolean).join('、'),country:(x.detail.countries||[])[0]||'',
      genres:x.detail.genres||[],duration:x.detail.durations||[]}:{} )}));
  fs.writeFileSync(path.join(DIR,'doubanScifi250.json'),JSON.stringify(list,null,2)+'\n');
  fs.writeFileSync(path.join(DIR,'doubanScifi250.params.json'),JSON.stringify({theme:'doubanScifi250',idStrategy:'title-year',autoContinue:true,movieList:list},null,2)+'\n');
  console.log(JSON.stringify({total:list.length,scoreRange:[Math.min(...list.map(m=>m.rating)),Math.max(...list.map(m=>m.rating))],top:list.slice(0,5).map(x=>x.title)}));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
