const test = require('node:test'), assert = require('node:assert/strict'), fs = require('fs'), vm = require('vm'), path = require('path');
const functionRoot = path.resolve(__dirname,'../cloudfunctions/getThemeHub');
function mockCloud(options = {}) {
  const tables = {
    theme_registry: [], movies: [{_id:'a'},{_id:'b'},{_id:'retired',isTop250:false}],
    douban_books: [{_id:'book'}],
    Marks: [
      {_id:'1',movieId:'a',openid:'me',status:'watched'},
      {_id:'2',movieId:'a',openid:'me',status:'watched'},
      {_id:'3',movieId:'b',openid:'other',status:'wish'},
      {_id:'4',movieId:'retired',openid:'retired-user',status:'watched'},
      ...(options.realOpenids||[]).map((openid,i)=>({_id:'r'+i,movieId:i%2?'a':'b',openid,status:'watched'})),
      {_id:'5',movieId:'b',openid:'',status:'watched'},
      {_id:'6',movieId:'b',openid:'invalid',status:'unwatched'}
    ],
    BookMarks: [{_id:'bookmark',bookId:'book',openid:'me',status:'read',source:'douban'}],
    theme_hub_cache: []
  };
  const queries = [], writes = [], aggregations = [];
  function predicate(fn) { fn.and = other => predicate(value => fn(value) && other(value)); return fn; }
  const command = {
    neq: x => predicate(v => v !== x), eq: x => predicate(v => v === x), exists: x => predicate(v => (v !== undefined) === x),
    gt: x => predicate(v => v > x), gte: x => predicate(v => v >= x), lt: x => predicate(v => v < x), in: xs => predicate(v => xs.includes(v)), nin: xs => predicate(v => !xs.includes(v)),
    and: xs => ({ and:xs }), or: xs => predicate(v => xs.some(fn => fn(v)))
  };
  function matches(row,filter) { return !filter || (filter.and ? filter.and.every(f=>matches(row,f)) : Object.entries(filter).every(([k,v]) => typeof v === 'function' ? v(row[k]) : row[k] === v)); }
  function collection(name) {
    const q = { where(filter) { this.filter=filter;queries.push({name,filter});return this; }, match(filter) { this.filter={...this.filter,...filter};return this; }, orderBy(){return this;}, limit(n){this.n=n;return this;}, field(){return this;}, group(){return this;}, count(){
      if(this.aggregating)return this;
      if(options.fail===name)return Promise.reject(new Error('offline'));
      return Promise.resolve().then(async()=>{
        if(options.beforeCount)await options.beforeCount();
        return {total:(tables[name]||[]).filter(r=>matches(r,this.filter)).length};
      });
    }, aggregate(){this.aggregating=true;return this;},
      async get() { if(options.fail === name) throw new Error('offline');return {data:(tables[name] || []).filter(r=>matches(r,this.filter)).slice(0,this.n || 1000)}; },
      async end() {
        if (options.beforeAggregate) await options.beforeAggregate();
        aggregations.push({ name, fields: Object.keys(this.filter || {}) });
        if (options.fail === name) throw new Error('offline');
        if (options.failAggregate) throw new Error('timeout');
        // 整表去重超时、按 openid 切段后能跑完（豆瓣 TOP250 的线上表现）
        if (options.failUnsplit && !('openid' in (this.filter||{}))) throw Object.assign(new Error('DATABASE_TIMEOUT'),{errCode:-501001});
        if (options.failRange && 'openid' in (this.filter||{}) && options.failRange(this.filter)) throw Object.assign(new Error('DATABASE_TIMEOUT'),{errCode:-501001});
        if (options.failCurrent && this.filter.status) throw Object.assign(new Error('[FailedOperation.Timeout] Database cluster is temporarily busy or unavailable'), { errCode: -501001 });
        const people = new Set((tables[name] || []).filter(r=>matches(r,this.filter)).map(r=>r.openid));
        return {list:people.size ? [{total:people.size}] : []};
      },
      doc(id) { return { get:async()=>{const data=(tables[name] || []).find(r=>r._id===id);if(!data)throw new Error('missing');return {data:structuredClone(data)};}, set:async({data})=>{tables[name] = (tables[name] || []).filter(r=>r._id!==id).concat([{...structuredClone(data),_id:id}]);writes.push({name,id,data:structuredClone(data)});} }; }
    }; return q;
  }
  let transactionTail=Promise.resolve();
  let openTransactions=0;
  const db = { command, collection, createCollection:async()=>{}, runTransaction(work) {
    // 真实云数据库：同一文档的事务重叠会冲突失败；默认模拟成排队执行
    if(options.conflictOnOverlap)return (async()=>{
      if(openTransactions>0)throw Object.assign(new Error('transaction conflict'),{errCode:-502005});
      openTransactions++;try{await new Promise(r=>setImmediate(r));return await work(db);}finally{openTransactions--;}
    })();
    const result=transactionTail.then(()=>work(db));transactionTail=result.catch(()=>{});return result;
  } };
  const cloud = { init(){},database:()=>db,getWXContext:()=>({OPENID: options.noIdentity ? '' : 'me'}) };
  const sandbox = { exports:{},require:p=>p==='wx-server-sdk'?cloud:require(path.join(functionRoot,p)), console:{warn(){}},process:{env:{}},Date,Promise,Map,Set };
  vm.runInNewContext(fs.readFileSync(path.join(functionRoot,'index.js'),'utf8'),sandbox);
  const freshInstance = () => {
    const other = {...sandbox,exports:{}};
    vm.runInNewContext(fs.readFileSync(path.join(functionRoot,'index.js'),'utf8'),other);
    return other.exports.main;
  };
  return {main:sandbox.exports.main,tables,queries,writes,aggregations,freshInstance};
}

const today=require(path.join(functionRoot,'statsCache.js')).dayKey();
const registryReads=c=>c.queries.filter(q=>q.name==='theme_registry').length;
// 访客 stats → 领到令牌 → 后台 computeStats，返回后台统计的结果
async function visitAndCompute(main){
 const r=await main({action:'stats'});
 assert.ok(r.refreshToken,'expected this visitor to win the refresh lock');
 return main({action:'computeStats',token:r.refreshToken});
}

test('summary still uses caller identity',async()=>{
 const c=mockCloud();const r=await c.main({action:'summary',openid:'other'});
 assert.equal(r.rows.douban_movies.done,1);assert.equal(c.writes.length,0);
});
test("today's cache is returned without counting, registry scans or writes",async()=>{
 const c=mockCloud();c.tables.theme_hub_cache=[{_id:'public-v1',day:today,rows:{douban_movies:{users:9000}}}];
 const r=await c.main({action:'stats'});
 assert.equal(r.rows.douban_movies.users,9000);assert.equal(r.rows.douban_movies.valid,true);
 assert.equal(r.refreshToken,undefined);
 await c.main({action:'refreshStats',theme:'douban_movies'});
 assert.equal(c.aggregations.length,0);assert.equal(registryReads(c),0);assert.equal(c.writes.length,0);
});
test('the triggering visitor gets history immediately; counting happens only in computeStats',async()=>{
 const c=mockCloud();c.tables.theme_hub_cache=[{_id:'public-v1',day:'2000-01-01',rows:{douban_movies:{valid:true,users:99,total:250,updatedAt:1}}}];
 const first=await c.main({action:'stats'});
 assert.equal(first.rows.douban_movies.users,99);assert.ok(first.refreshToken);
 assert.equal(c.aggregations.length,0);assert.equal(registryReads(c),0);
 const r=await c.main({action:'computeStats',token:first.refreshToken});
 assert.equal(r.day,today);assert.equal(r.rows.douban_movies.users,4);assert.equal(r.rows.douban_movies.estimated,false);
 assert.deepEqual(c.aggregations[0].fields,['movieId']);
 assert.ok(c.writes.every(w=>w.id==='public-v1'));
 assert.equal(c.tables.theme_hub_cache[0].refresh,undefined);
 const n=c.aggregations.length,w=c.writes.length;
 const again=await c.freshInstance()({action:'stats'});
 assert.equal(again.rows.douban_movies.users,4);assert.equal(again.refreshToken,undefined);
 assert.equal(c.aggregations.length,n);assert.equal(c.writes.length,w);
});
test('other visitors during a refresh get no token and trigger nothing',async()=>{
 const c=mockCloud();c.tables.theme_hub_cache=[{_id:'public-v1',day:'2000-01-01',rows:{douban_movies:{valid:true,users:99,total:250}}}];
 const first=await c.main({action:'stats'});
 const second=await c.freshInstance()({action:'stats'});
 assert.equal(second.refreshing,true);assert.equal(second.refreshToken,undefined);assert.equal(second.rows.douban_movies.users,99);
 assert.equal(c.aggregations.length,0);
 await c.main({action:'computeStats',token:first.refreshToken});
 const n=c.aggregations.length;
 assert.equal((await c.main({action:'computeStats',token:first.refreshToken})).success,false);
 assert.equal(c.aggregations.length,n);
});
test('computeStats without the current lock token is rejected',async()=>{
 const c=mockCloud();c.tables.theme_hub_cache=[{_id:'public-v1',day:'2000-01-01',rows:{}}];
 assert.equal((await c.main({action:'computeStats',token:'forged'})).success,false);
 await c.main({action:'stats'});
 assert.equal((await c.main({action:'computeStats',token:'forged'})).success,false);
 assert.equal((await c.main({action:'computeStats'})).success,false);
 assert.equal(c.aggregations.length,0);
});
test('a token whose lock expired is rejected and the next visitor gets a new one',async()=>{
 const c=mockCloud();c.tables.theme_hub_cache=[{_id:'public-v1',rows:{},refresh:{day:today,lockUntil:1,token:'old',done:[]}}];
 assert.equal((await c.main({action:'computeStats',token:'old'})).success,false);
 const r=await c.main({action:'stats'});
 assert.ok(r.refreshToken&&r.refreshToken!=='old');
});
test('a failed theme keeps its old value and is not retried the same day',async()=>{
 const c=mockCloud({fail:'Marks'});c.tables.theme_hub_cache=[{_id:'public-v1',rows:{douban_movies:{valid:true,users:999,total:250,updatedAt:1}}}];
 const r=await visitAndCompute(c.main);
 assert.equal(r.rows.douban_movies.users,999);assert.equal(r.day,today);
 const q=c.queries.length;const again=await c.main({action:'stats'});
 assert.equal(again.refreshToken,undefined);assert.equal(c.queries.length,q);
});
const pad=x=>(x+'0000000000000000000000000000').slice(0,28);
const realOpenids=['ozCMC7-aa','ozCMC70bb','ozCMC7Gcc','ozCMC7Zdd','ozCMC7_ee','ozCMC7aff','ozCMC7zgg','ozCMC7zgg','ozCMC7zzz','zzzz-other-app'].map(pad);
test('a timed-out whole aggregate is replaced by an exact openid-range split, never the ÷3 estimate',async()=>{
 const c=mockCloud({failUnsplit:true,realOpenids});
 const r=await visitAndCompute(c.main);
 // 4 个基础用户（me/other/retired-user/空串）+ 9 个不同的真实 openid
 assert.equal(r.rows.douban_movies.users,13);assert.equal(r.rows.douban_movies.estimated,false);
});
test('a range that still times out is split into single-character ranges',async()=>{
 // 粗段 [ozCMC7w, +∞) 首次失败；拆成单字符段后都能跑完
 let coarseFails=0;
 const c=mockCloud({failUnsplit:true,realOpenids,failRange:f=>{
   const wide=f.openid(pad('ozCMC7w'))&&f.openid(pad('ozCMC7z'));
   if(wide&&coarseFails<1){coarseFails++;return true;}return false;
 }});
 const r=await visitAndCompute(c.main);
 assert.equal(coarseFails,1);assert.equal(r.rows.douban_movies.users,13);assert.equal(r.rows.douban_movies.estimated,false);
});
test('when even single ranges time out the old real value is kept and an old estimate is dropped',async()=>{
 const c=mockCloud({failAggregate:true});
 c.tables.theme_hub_cache=[{_id:'public-v1',rows:{douban_movies:{valid:true,users:49600,total:250},imdb_movies:{valid:true,users:1525128,estimated:true,total:250}}}];
 c.tables.imdb_movies=c.tables.movies;
 const r=await visitAndCompute(c.main);
 assert.equal(r.rows.douban_movies.users,49600);
 assert.equal(r.rows.imdb_movies,undefined);
 assert.equal(r.day,today);
});
test('an active lock blocks new tokens; an expired lock resumes after the finished themes',async()=>{
 const c=mockCloud();c.tables.theme_hub_cache=[{_id:'public-v1',rows:{},refresh:{day:today,lockUntil:Date.now()+60000,token:'busy',done:[]}}];
 const busy=await c.main({action:'stats'});
 assert.equal(busy.refreshing,true);assert.equal(busy.refreshToken,undefined);assert.equal(c.aggregations.length,0);assert.equal(c.writes.length,0);
 const d=mockCloud();d.tables.theme_hub_cache=[{_id:'public-v1',rows:{douban_movies:{valid:true,users:7,total:250}},refresh:{day:today,lockUntil:1,done:['douban_movies']}}];
 const r=await visitAndCompute(d.main);
 assert.equal(r.day,today);assert.equal(r.rows.douban_movies.users,7);
 assert.ok(!d.aggregations.some(a=>a.name==='Marks'));
});
test('a manual edit made while the query runs wins over the computed value',async()=>{
 let entered,release;const started=new Promise(r=>entered=r),gate=new Promise(r=>release=r);
 const d=mockCloud({beforeAggregate:async()=>{entered();await gate;}});
 const pending=visitAndCompute(d.main);await started;
 const cur=d.tables.theme_hub_cache[0];
 d.tables.theme_hub_cache=[{...cur,rows:{douban_movies:{users:12345}}}];release();
 assert.equal((await pending).rows.douban_movies.users,12345);
});
test('refreshStats never counts a caller-supplied theme on its own',async()=>{
 const c=mockCloud();c.tables.theme_hub_cache=[{_id:'public-v1',day:today,rows:{}}];
 await c.main({action:'refreshStats',theme:'secret'});await c.main({action:'refreshStats'});
 assert.equal(c.aggregations.length,0);assert.equal(c.writes.length,0);
});

test('concurrent theme counts still finish when overlapping transactions conflict',async()=>{
 const c=mockCloud({conflictOnOverlap:true});
 c.tables.imdb_movies=c.tables.movies;c.tables.oscar_movies=c.tables.movies;c.tables.boxoffice_movies=c.tables.movies;
 c.tables.theme_hub_cache=[{_id:'public-v1',day:'2000-01-01',rows:{}}];
 const r=await visitAndCompute(c.main);
 assert.equal(r.success,true);assert.equal(r.day,today);
 for(const id of ['douban_movies','imdb_movies','boxoffice_movies'])assert.equal(r.rows[id].users,4,id);
 assert.equal(r.rows.oscar_movies.users,5);
});
