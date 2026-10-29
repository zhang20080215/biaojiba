const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');
function client() {
  const memory = new Map(), cloudRows = new Map();
  let user = 'alice', offline = true, now = 1800000000000;
  const context = { module: { exports: {} }, console, Date: class extends Date { static now() { return now; } },
    getApp: () => ({ globalData: { openid: user } }),
    require: p => p === './hubStore' ? { invalidateSummary() {} } : require('../utils/hubModel'),
    wx: { getStorageSync: k => memory.get(k), setStorageSync: (k,v) => memory.set(k, structuredClone(v)),
      cloud: { callFunction: async ({ data }) => {
        if (offline) throw new Error('offline');
        if (data.action === 'save') { cloudRows.set(user + data.row.id, structuredClone(data.row)); return { result: { success: true } }; }
        return { result: { success: true, rows: [...cloudRows.values()].filter(r => r.owner === user) } };
      } } }
  };
  vm.runInNewContext(fs.readFileSync('utils/markTimeline.js','utf8'), context);
  return { api: context.module.exports, memory, cloudRows, tick: ms => now += ms, online: () => offline = false, user: v => user = v };
}
test('continuous successful marks merge; timeout, new page and batch define separate records', async () => {
  const f = client(), p = { data: { allMovies: [{ _id:'1', title:'电影一' }] } };
  f.api.record(p, 'douban', 'watched', ['1']); await f.api.flush();
  f.api.record(p, 'douban', 'wish', ['2']); await f.api.flush();
  let r = await f.api.list(); assert.equal(r.rows.length,1); assert.equal(r.rows[0].count,2); assert.equal(r.rows[0].items[0].title,'电影一');
  f.tick(120001); f.api.record(p,'douban','watched',['3']); await f.api.flush();
  f.api.record(p,'douban','watched',['4','5'],'batch'); await f.api.flush();
  f.api.record({data:{}},'douban','watched',['6']); await f.api.flush();
  r = await f.api.list(); assert.equal(r.rows.length,4); assert.equal(r.rows.find(r => r.mode === 'batch').count,2);
});
test('outbox survives failed requests and repeated retries upsert rather than duplicate', async () => {
  const f = client(), p = { data:{} };
  f.api.record(p,'daily:read','checkin',[{ title:'读书' }]); await f.api.flush();
  assert.equal((await f.api.list()).offline,true);
  f.online(); await f.api.flush(); await f.api.flush();
  assert.equal(f.cloudRows.size,1); assert.equal(f.memory.get('markTimelineOutboxV1:alice').length,0);
  f.api.record(p,'daily:read','checkin',[{ title:'再读' }]); await f.api.flush();
  assert.equal(f.cloudRows.size,1); assert.equal([...f.cloudRows.values()][0].count,2);
});
test('users cannot see or flush another user outbox', async () => {
  const f=client(); f.api.record({data:{}},'douban','watched',['1']); await f.api.flush();
  f.user('bob'); f.online(); assert.equal((await f.api.list()).rows.length,0); assert.equal(f.cloudRows.size,0);
  f.user('alice'); await f.api.flush(); assert.equal(f.cloudRows.size,1);
});
test('large batches retain every item and expand without inventing extra events', async () => {
  const f=client(); f.api.record({data:{}},'douban','watched',Array.from({length:250},(_,i)=>({title:'电影'+i})),'batch'); await f.api.flush();
  const rows=(await f.api.list()).rows; assert.equal(rows.length,1); assert.equal(rows[0].items.length,250);
  assert.equal(f.api.present(rows,[])[0].items.length,9); rows[0].expanded=true;
  assert.equal(f.api.present(rows,[])[0].items.length,250);
});
test('cloud save uses caller identity, rejects spoofing, and ignores stale revisions', async () => {
  const docs = new Map();
  const db = { runTransaction: async fn => fn({ collection: () => ({ doc: id => ({
    get: async () => { if (!docs.has(id)) throw new Error('document not exist'); return {data: docs.get(id)}; },
    set: async ({data}) => docs.set(id,data)
  }) }) }) };
  const context = { exports:{}, require:p => p === 'wx-server-sdk' ? { init(){}, database:()=>db, getWXContext:()=>({OPENID:'alice'}) } : require(p) };
  vm.runInNewContext(fs.readFileSync('cloudfunctions/markTimeline/index.js','utf8'),context);
  const row={id:'abcdefgh_123',owner:'bob',theme:'douban',at:100,createdAt:100,count:1,revision:1,items:[{title:'电影',status:'watched'}]};
  assert.equal((await context.exports.main({action:'save',row})).success,false);
  row.owner='alice'; assert.equal((await context.exports.main({action:'save',row})).success,true);
  row.revision=2; row.count=2; await context.exports.main({action:'save',row});
  row.revision=1; row.count=1; await context.exports.main({action:'save',row});
  assert.equal(docs.size,1); assert.equal([...docs.values()][0].count,2);
});
test('classification separates daily entries and personal progress stays in profile', async () => {
  const fixture = require('./navigation-fixture.cjs');
  const f=fixture('discover'); f.page.onLoad(); f.page.onShow(); await new Promise(setImmediate);
  assert.equal(f.page.data.dailyThemes.length,require('../utils/themeCatalog').filter(t => t.category === 'daily' && !t.hidden).length);
  f.page.onDiscoverSection({currentTarget:{dataset:{section:'daily'}}}); assert.equal(f.page.data.discoverSection,'daily');
  assert.ok(f.page.data.filteredThemes.every(t => t.category !== 'daily'));
  const p=fixture('profile'); p.page.onLoad(); p.page.onShow(); await new Promise(setImmediate);
  p.page.onPersonalTab({currentTarget:{dataset:{tab:'marked'}}});
  assert.equal(p.page.data.personalThemes[0].progressText,'已看 32 / 250 · 待完成 8');
  assert.ok(p.page.data.personalThemes.length <= 3);
});

test('single-mark persistence failure generates no event; a successful retry generates one', async () => {
  let page, fail = true; const recorded=[];
  const persist = () => fail ? Promise.reject(new Error('write failed')) : Promise.resolve({_id:'mark1'});
  const context = { Page: p => page=p, console:{error(){}}, setTimeout, clearTimeout,
    require: p => p.includes('markTimeline') ? {record: (...args)=>recorded.push(args)} :
      p.includes('adConfig') ? {getAdUnitId:()=>'',isAdFree:()=>false} :
      p.includes('track') ? {trackMark(){}} : p.includes('markSync') ? {sync(){}} : {},
    wx:{ cloud:{database:()=>({collection:()=>({add:persist})})}, showToast(){} } };
  vm.runInNewContext(fs.readFileSync('pages/douban/list/list.js','utf8').replace(/^import .*;\r?\n/gm,''),context);
  page.getActiveOpenid=()=> 'alice'; page.applySingleMarkLocally=()=>{}; page.restoreSingleMarkLocally=()=>{};
  page.showCustomToast=()=>{}; page.setData=patch=>Object.assign(page.data,patch);
  page.setMark('film','watched'); await new Promise(setImmediate); assert.equal(recorded.length,0);
  fail=false; page.setMark('film','watched'); await new Promise(setImmediate); assert.equal(recorded.length,1);
});

test('partially successful batch logs only the confirmed IDs as one event', () => {
  let page; const recorded=[];
  const context={Page:p=>page=p, console, setTimeout:()=>{}, clearTimeout,
    require:p=>p.includes('markTimeline') ? {record:(...args)=>recorded.push(args)} : p.includes('adConfig') ? {getAdUnitId:()=>'',isAdFree:()=>false} : p.includes('track') ? {trackMark(){}} : {},
    wx:{showLoading(){},hideLoading(){},showToast(){}, cloud:{callFunction:({success})=>success({result:{success:false,succeededIds:['first']}})}}};
  vm.runInNewContext(fs.readFileSync('pages/douban/list/list.js','utf8').replace(/^import .*;\r?\n/gm,''),context);
  page.getActiveOpenid=()=> 'alice'; page.batchUpdateMarks(['first','failed'],'watched');
  assert.equal(recorded.length,1); assert.deepEqual(recorded[0][3],['first']); assert.equal(recorded[0][4],'batch');
});

for (const kind of ['Marks','BookMarks']) test(`${kind} batch reports real successes and excludes failed or synchronized items`, async () => {
  const query = { where(){return this;}, field(){return this;}, limit(){return this;},
    get: async()=>({data:[]}), add:async({data})=> { if ((data.movieId || data.bookId) === 'failed') throw new Error('failed'); return {_id:'saved'}; } };
  const db={command:{in:v=>v,or:v=>v,eq:v=>v,exists:v=>v},collection:name=>name === 'movie_alias' ? {...query,get:async()=>({data:[{siblings:['synced-copy']}]})} : query};
  const context={exports:{},console:{error(){},warn(){}},require:()=>({init(){},database:()=>db})};
  vm.runInNewContext(fs.readFileSync(`cloudfunctions/batchUpdate${kind}/index.js`,'utf8'),context);
  const result=await context.exports.main({openid:'alice',movieIds:['first','failed'],bookIds:['first','failed'],status:kind === 'Marks' ? 'watched' : 'read'});
  assert.equal(result.success,false); assert.deepEqual(Array.from(result.succeededIds),['first']);
});

test('snapshots keep the details that make a record specific', async () => {
  const f = client();
  const list = { data: { cfg: { ratingLabel: 'IMDB' }, allMovies: [{ _id: '1', title: '肖申克的救赎', rating: 9.3, year: 1994, director: '弗兰克·德拉邦特、某某' }] } };
  f.api.record(list, 'imdb', 'watched', ['1']);
  f.api.record({ data: {} }, 'daily:movie', 'checkin', [{ title: '漫长的季节', poster: 'cloud://p.jpg', rating: 5, note: ' 好看 ', moodEmoji: '🥹', moodLabel: '感动',
    currentEpisode: 8, totalEpisodes: 12, platform: { douban: '9.4' }, year: '2023' }]);
  f.api.record({ data: {} }, 'daily:read', 'checkin', [{ title: '红楼梦', rating: 0, currentPage: 320, totalPages: 1606, readDays: 12, author: '曹雪芹、高鹗' }]);
  f.api.record({ data: { allSpots: [{ _id: 's', shortName: '黄山', name: '黄山风景区', province: '安徽', city: '黄山' }] } }, 'scenic5a', 'watched', ['s']);
  const rows = JSON.parse(JSON.stringify((await f.api.list()).rows));
  const item = theme => rows.find(r => r.theme === theme).items[0];
  assert.deepEqual(item('imdb'), { title: '肖申克的救赎', cover: '', status: 'watched', extra: 'IMDB 9.3 · 1994 · 弗兰克·德拉邦特' });
  assert.deepEqual(item('daily:movie'), { title: '漫长的季节', cover: 'cloud://p.jpg', status: 'checkin', stars: 5, note: '好看', mood: '🥹 感动',
    progress: '看到第 8 集 / 共 12 集', extra: '豆瓣 9.4 · 2023' });
  assert.deepEqual(item('daily:read'), { title: '红楼梦', cover: '', status: 'checkin', progress: '读到第 320 / 1606 页（20%） · 已读 12 天', extra: '曹雪芹' });
  assert.deepEqual(item('scenic5a'), { title: '黄山', cover: '', status: 'watched', extra: '安徽 · 黄山' });
});
test('cloud save keeps only bounded detail fields', async () => {
  const docs = new Map();
  const db = { runTransaction: async fn => fn({ collection: () => ({ doc: id => ({
    get: async () => { throw new Error('document not exist'); }, set: async ({data}) => docs.set(id,data)
  }) }) }) };
  const context = { exports:{}, require:p => p === 'wx-server-sdk' ? { init(){}, database:()=>db, getWXContext:()=>({OPENID:'alice'}) } : require(p) };
  vm.runInNewContext(fs.readFileSync('cloudfunctions/markTimeline/index.js','utf8'),context);
  const items = [{ title:'电影', status:'checkin', stars:9, note:'长'.repeat(300), mood:'😊 治愈', progress:'看到第 8 集', extra:'豆瓣 9.4', evil:'x' },
    { title:'书', status:'checkin', stars:4 }];
  await context.exports.main({ action:'save', row:{ id:'abcdefgh_123', owner:'alice', theme:'daily:movie', at:1, createdAt:1, count:2, revision:1, items } });
  const saved = [...docs.values()][0].items;
  assert.equal(saved[0].stars, undefined); assert.equal(saved[0].note.length, 140); assert.equal(saved[0].evil, undefined);
  assert.equal(saved[0].progress, '看到第 8 集'); assert.equal(saved[1].stars, 4);
});
