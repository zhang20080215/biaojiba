// 全部剧集：只传地区tag，评分8~10，综合排序。
const fs = require('fs');
const path = require('path');
const axios = require('../../cloudfunctions/fetchOscarMovies/node_modules/axios');
const configs = [
  {theme:'doubanTvKorea250', region:'韩国', title:'豆瓣高分韩剧TOP250', order:112, emoji:'🇰🇷'},
  {theme:'doubanTvJapan250', region:'日本', title:'豆瓣高分日剧TOP250', order:113, emoji:'🇯🇵'}
];
async function collect(cfg) {
  const cache = path.join(__dirname,'.cache');
  fs.mkdirSync(cache,{recursive:true});
  const pool = new Map();
  for(let start=0; start<1000 && pool.size<250; start+=50) {
    const params={refresh:0,start,count:50,selected_categories:'{}',uncollect:false,score_range:'8,10',tags:cfg.region,sort:'T'};
    const {data}=await axios.get('https://m.douban.com/rexxar/api/v2/tv/recommend',{
      params,timeout:20000,headers:{Referer:'https://movie.douban.com/tv/','User-Agent':'Mozilla/5.0',Accept:'application/json'}
    });
    if(!Array.isArray(data.items))throw Error('Missing items '+cfg.region);
    fs.writeFileSync(path.join(cache,cfg.region+'-'+start+'.json'),JSON.stringify(data));
    for(const x of data.items) {
      if(x.card==='chart'||!/^\d+$/.test(String(x.id)))continue;
      if(x.type!=='tv')throw Error('Unexpected type '+x.type+': '+x.title);
      if(!(Number(x.rating?.value)>=8 && Number(x.rating?.value)<=10))throw Error('Rating outside scope '+x.title);
      if(!x.pic?.large||!/^\d{4}$/.test(String(x.year)))throw Error('Missing year/cover '+x.title);
      if(!pool.has(String(x.id)))pool.set(String(x.id),x);
    }
    console.log(cfg.region+' offset '+start+': '+pool.size);
    if(data.items.length===0)break;
    await new Promise(r=>setTimeout(r,350));
  }
  const rows=[...pool.values()].slice(0,250);
  if(rows.length!==250)throw Error(cfg.region+' only '+rows.length+'; refusing incomplete TOP250');
  const timestamp=new Date().toISOString();
  const list=rows.map((x,i)=>({rank:i+1,title:x.title,originalTitle:x.title,year:Number(x.year),doubanId:String(x.id),
    rating:Number(x.rating.value),ratingCount:Number(x.rating.count)||0,sourceRating:Number(x.rating.value),sourceRatingCount:Number(x.rating.count)||0,
    sourceCoverUrl:x.pic.large,sourceUrl:'https://movie.douban.com/tv/',sourceSubjectUrl:`https://movie.douban.com/subject/${x.id}/`,
    sourceUpdatedAt:timestamp,sourceRegion:cfg.region,sourceType:'全部剧集',ratingSource:'douban_recommend'}));
  const registry={_id:cfg.theme,theme:cfg.theme,type:'movie',enabled:true,order:cfg.order,cardId:cfg.theme,
    title:cfg.title,description:`豆瓣选剧集：全部剧集、${cfg.region}地区、评分8～10，综合排序前250部`,
    tag:'剧集',category:'tv',newBadge:true,wishFrom:'',placeholderEmoji:cfg.emoji,slogan:'标记你看过的高分剧集，生成专属观剧海报',
    brandPrimary:'#4776C8',brandSoft:'#93B2EB',shadowRgb:'71, 118, 200',showEdition:false,firstDirectorOnly:true,orderDirection:'asc',ratingLabel:'豆瓣'};
  const write=(suffix,obj,compact=false)=>fs.writeFileSync(path.join(__dirname,cfg.theme+suffix+'.json'),JSON.stringify(obj,null,compact?undefined:2)+'\n');
  write('',list);write('.params',{theme:cfg.theme,idStrategy:'title-year',autoContinue:true,movieList:list});
  write('.registry',registry);write('.registry.import',registry,true);
  console.log(JSON.stringify({theme:cfg.theme,total:list.length,minRating:Math.min(...list.map(x=>x.rating)),top:list.slice(0,5).map(x=>x.title)}));
}
(async()=>{for(const cfg of configs)await collect(cfg);})().catch(e=>{console.error(e.message);process.exitCode=1;});
