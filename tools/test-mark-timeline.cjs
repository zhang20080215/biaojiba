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
  assert.deepEqual(item('daily:read'), { title: '红楼梦', cover: '', status: 'checkin', progress: '已读 320/1606 页（20%） · 已读 12 天', extra: '曹雪芹' });
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

// ── 主句文案：一个直接写「看过《A》」，多个 / 批量写「标记了 N 部看过的电影」 ──
test('timeline summaries use one skeleton: single = state + title, several / batch = 标记了 N 部…', () => {
  const { present } = require('../utils/markTimeline');
  const themes = [{ id: 'm', domain: 'movie' }, { id: 'tv', domain: 'tv' }, { id: 'b', domain: 'reading' }, { id: 'sp', domain: 'travel' }, { id: 'mu', domain: 'travel' }];
  const it = (title, status = 'watched', extra = {}) => ({ title, status, ...extra });
  const say = (theme, items, mode = 'single') => present([{ id: 'r', theme, at: Date.now(), mode, items }], theme === 'mu' ? [{ id: 'mu', domain: 'travel' }] : themes)[0].summary;
  // 榜单：单个
  assert.equal(say('m', [it('肖申克的救赎')]), '看过《肖申克的救赎》');
  assert.equal(say('m', [it('霸王别姬', 'wish')]), '想看《霸王别姬》');
  assert.equal(say('b', [it('红楼梦')]), '读过《红楼梦》');
  assert.equal(say('sp', [it('黄山')]), '去过黄山');
  assert.equal(say('sp', [it('黄山', 'wish')]), '想去黄山');
  // 多个（连续标记）和批量同一句式
  const many = n => Array.from({ length: n }, (_, i) => it('片' + i));
  assert.equal(say('m', many(3)), '标记了 3 部看过的电影');
  assert.equal(say('m', many(12), 'batch'), '标记了 12 部看过的电影');
  assert.equal(say('m', [it('a', 'wish'), it('b', 'wish')]), '标记了 2 部想看的电影');
  assert.equal(say('tv', many(2)), '标记了 2 部看过的剧');
  assert.equal(say('b', many(4), 'batch'), '标记了 4 本读过的书');
  assert.equal(say('sp', many(5), 'batch'), '标记了 5 个去过的地方');
  // 混合：单个段直接写，连着两段数量句时后一段省掉「标记了」
  assert.equal(say('m', [it('A'), it('B', 'wish')]), '看过《A》，想看《B》');
  assert.equal(say('m', [...many(3), it('x', 'wish'), it('y', 'wish')]), '标记了 3 部看过的电影，2 部想看的电影');
  assert.equal(say('m', [...many(2), it('x', 'wish')]), '标记了 2 部看过的电影，想看《x》');
  // 取消
  assert.equal(say('m', [it('A', 'unmark')]), '取消了《A》的标记');
  assert.equal(say('m', [it('A', 'unmark'), it('B', 'unmark')]), '取消了 2 部电影的标记');
});

test('daily check-ins: in progress = 在看 / 在读, finished or no progress = 看过 / 读过', () => {
  const { present } = require('../utils/markTimeline');
  const say = (theme, item) => present([{ id: 'r', theme, at: Date.now(), mode: 'single', items: [{ status: 'checkin', ...item }] }], [])[0];
  assert.equal(say('daily:movie', { title: '漫长的季节', progress: '看到第 8 集 / 共 12 集' }).summary, '在看《漫长的季节》');
  assert.equal(say('daily:movie', { title: '漫长的季节', progress: '看到第 12 集 / 共 12 集' }).summary, '看过《漫长的季节》');
  assert.equal(say('daily:movie', { title: '肖申克的救赎' }).summary, '看过《肖申克的救赎》');
  assert.equal(say('daily:read', { title: '红楼梦', progress: '已读 320/1606 页（20%）' }).summary, '在读《红楼梦》');
  assert.equal(say('daily:read', { title: '红楼梦', progress: '已读 1606/1606 页（100%）' }).summary, '读过《红楼梦》');
  assert.equal(say('daily:read', { title: '红楼梦' }).summary, '读过《红楼梦》');
  assert.equal(say('daily:read', { title: '天官赐福', progress: '已读 12/252 章（5%）' }).summary, '在读《天官赐福》');
  assert.equal(say('daily:read', { title: '红楼梦', progress: '读到第 320 / 1606 页（20%）' }).summary, '在读《红楼梦》', 'rows saved before the wording change still read as in-progress');
  assert.equal(say('daily:movie', { title: '漫长的季节', progress: '看到第 8 集 / 共 12 集' }).items[0].statusText, '在看');
  assert.equal(say('daily:sport', { title: '深蹲' }).summary, '练了深蹲');
  assert.equal(say('daily:water', { title: '250ml' }).summary, '喝了 250ml 水');
});

test('book progress snapshot follows the book unit: 页 for print books, 章 for web novels', async () => {
  const f = client();
  f.api.record({ data: { allBooks: [] } }, 'daily:read', 'checkin', [{ title: '天官赐福', currentPage: 12, totalPages: 252, progressUnit: '章', readDays: 3 }]);
  f.api.record({ data: { allBooks: [] } }, 'daily:read', 'checkin', [{ title: '红楼梦', currentPage: 320, totalPages: 1606, readDays: 12 }]);
  const rows = JSON.parse(JSON.stringify((await f.api.list()).rows));
  const progress = title => rows.flatMap(r => r.items).find(i => i.title === title).progress;
  assert.equal(progress('天官赐福'), '已读 12/252 章（5%） · 已读 3 天');
  assert.equal(progress('红楼梦'), '已读 320/1606 页（20%） · 已读 12 天');
});

test('rows saved with the old progress wording display in the new wording; the stored text is untouched', () => {
  const { present } = require('../utils/markTimeline');
  const show = progress => {
    const row = { id: 'r', theme: 'daily:read', at: Date.now(), mode: 'single', items: [{ title: '红楼梦', status: 'checkin', progress }] };
    const out = present([row], [])[0];
    assert.equal(row.items[0].progress, progress, 'source row is not mutated');
    return out.detail.progress;
  };
  assert.equal(show('读到第 320 / 1606 页（20%） · 已读 12 天'), '已读 320/1606 页（20%） · 已读 12 天');
  assert.equal(show('读到第 120 页'), '已读 120 页');
  assert.equal(show('读到第 120 页 · 已读 3 天'), '已读 120 页 · 已读 3 天');
  assert.equal(show('已读 320/1606 页（20%）'), '已读 320/1606 页（20%）');
  assert.equal(show('看到第 8 集 / 共 12 集'), '看到第 8 集 / 共 12 集', 'episode wording is not touched');
});
