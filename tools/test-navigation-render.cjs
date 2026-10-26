const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('node:assert/strict'), cp = require('child_process'), os = require('os');
const fixture = require('./navigation-fixture.cjs');
const root = path.resolve(__dirname, '..');
const compilerRoot = process.env.WECHAT_COMPILER_DIR || 'D:/Program Files (x86)/Tencent/wechatdev/resources/app.asar.unpacked/node_modules/wcc-exec';
const output = path.join(os.tmpdir(), 'xiaobiaoji-navigation-' + process.pid + '.js');
const cssOutput = output + '.css';
const routes = ['category/category','discover/index','records/index','profile/index'];
function compile(binary, args) {
  const r = cp.spawnSync(path.join(compilerRoot,binary), args, { cwd:root, encoding:'utf8', windowsHide:true });
  if (r.error || r.status !== 0) throw r.error || new Error(r.stderr || r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
}
function nodes(tree) { return typeof tree === 'object' && tree ? [tree].concat((tree.children || []).flatMap(nodes)) : []; }
async function main() {
  compile('wcc.exe', ['-o',output, ...routes.map(p => 'pages/' + p + '.wxml'), 'templates/hub.wxml','templates/hub-overlays.wxml']);
  compile('wcsc.exe', ['-o',cssOutput, ...routes.map(p => 'pages/' + p + '.wxss'), 'styles/hub.wxss','styles/hub-icons.wxss','styles/hub-legacy.wxss','styles/theme.wxss','app.wxss']);
  const errors = [], sandbox = { window: {}, console: { log: e => errors.push(e), warn: e => errors.push(e) } };
  vm.createContext(sandbox); vm.runInContext(fs.readFileSync(output,'utf8'),sandbox);
  for (const [index,kind] of ['home','discover','records','profile'].entries()) {
    for (const options of [{}, { partial:true }, { theme:'' }, { theme:'theme-gold' }, { theme:'theme-sand' }, { offline:true, empty:true }]) {
      const f = fixture(kind,options); f.page.onLoad(); f.page.onShow(); await new Promise(resolve => setImmediate(resolve));
      const render = sandbox.$gwx('pages/' + routes[index] + '.wxml');
      const tree = render(f.page.data);
      const all = nodes(tree);
      assert.ok(all.some(n => n.attr && n.attr.class === 'hub-brand'), kind + ' title');
      if (kind === 'home') {
        assert.equal(all.filter(n => n.attr && n.attr.class === 'hub-card exposure-card').length,options.offline ? 14 : 4, 'latest plus offline fallback cards');
        const popular = all.filter(n => n.attr && n.attr.class === 'hub-popular-row exposure-card');
        assert.equal(popular.length, options.offline ? 0 : options.partial ? 12 : 10, 'partial rankings retain two unranked entrances');
        if (options.partial) {
          assert.ok(popular.some(n=>n.attr['data-id']==='douban_movies'));
          assert.ok(popular.some(n=>n.attr['data-id']==='imdb_movies'));
          assert.ok(JSON.stringify(tree).includes('人数暂未更新'));
        }
        const rendered = JSON.stringify(tree);
        assert.ok(rendered.indexOf('每日标记') < rendered.indexOf('最新上线'));
        assert.ok(rendered.indexOf('最新上线') < rendered.indexOf(options.offline ? '精选榜单' : '最受欢迎'));
        assert.ok(rendered.includes('许愿来自'));
        assert.ok(!rendered.includes('探索这份清单'));
        assert.ok(!rendered.includes('继续标记'));
        assert.ok(!all.some(n => n.attr && n.attr.class === 'hub-eyebrow'), 'home has no subtitle');
        const covers = all.filter(n => n.attr && ['hub-cover', 'hub-popular-cover'].includes(n.attr.class));
        const wishes = all.filter(n => n.attr && n.attr.class === 'hub-wish-from');
        assert.equal(covers.flatMap(nodes).filter(n => n.attr && n.attr.class === 'hub-wish-from').length, wishes.length, 'all wish attribution lives on the cover');
        for (const card of all.filter(n => n.attr && ['hub-card exposure-card', 'hub-popular-row exposure-card'].includes(n.attr.class))) {
          const titles = nodes(card).filter(n => n.attr && n.attr.class === 'hub-title-scroll');
          assert.equal(titles.length, 1, 'every list title has its own horizontal scroll container');
          assert.equal(titles[0].tag, 'wx-scroll-view');
        }
      }
      if (kind === 'profile' && !options.offline) assert.ok(JSON.stringify(tree).includes('已看 32 / 250'));
      if (kind === 'records' && !options.empty) assert.ok(JSON.stringify(tree).includes('看了一部电影《肖申克的救赎》，想看《霸王别姬》'));
      if (kind === 'records') {
        const locked = fixture('records', { ...options, recordsLocked: true }); locked.page.onLoad(); locked.page.onShow(); await new Promise(resolve => setImmediate(resolve));
        const lockedTree = JSON.stringify(render(locked.page.data));
        assert.ok(lockedTree.includes('records-mask'), 'locked records shows the gray mask');
        assert.ok(lockedTree.includes('像刷朋友圈一样') && lockedTree.includes('查看自己的每日标记'), 'locked records shows the slogan');
        assert.ok(lockedTree.includes('期待上线'), 'locked records shows the wish-like button');
        assert.ok(lockedTree.includes('肖申克的救赎'), 'locked records keeps the demo feed underneath');
        assert.ok(!JSON.stringify(render(f.page.data)).includes('records-mask'), 'open records has no mask');
        if (process.env.HUB_PREVIEW_DIR && !options.offline) {
          // 预览：带一次点赞迸发，页面加载时动画播放一遍
          locked.page.onWishLike(); locked.page.onWishLike(); locked.page.onWishLike();
          fs.mkdirSync(process.env.HUB_PREVIEW_DIR,{recursive:true});
          fs.writeFileSync(path.join(process.env.HUB_PREVIEW_DIR,'records-locked-' + (options.theme || (options.theme === '' ? 'theme-pink' : 'theme-green')) + '.json'),JSON.stringify(render(locked.page.data)));
        }
      }
      if (kind === 'discover') {
        f.page.onDiscoverSection({currentTarget:{dataset:{section:'daily'}}});
        const dailyTree = render(f.page.data);
        assert.equal(nodes(dailyTree).filter(n => n.attr && n.attr.class === 'hub-daily-card').length,4);
        assert.equal(nodes(dailyTree).filter(n => n.attr && n.attr.class === 'hub-card exposure-card').length,0);
        if (process.env.HUB_PREVIEW_DIR && !options.offline) {
          fs.mkdirSync(process.env.HUB_PREVIEW_DIR,{recursive:true});
          fs.writeFileSync(path.join(process.env.HUB_PREVIEW_DIR,'discover-daily-' + (options.theme || (options.theme === '' ? 'theme-pink' : 'theme-green')) + '.json'),JSON.stringify(dailyTree));
        }
      }
      for (const node of all.filter(n => n.attr && (n.attr.class || '').includes('modal-overlay'))) assert.equal(node.attr.hidden, true);
      // Optional inspectable HTML is derived from the actual compiler tree, using fixture data.
      if (process.env.HUB_PREVIEW_DIR && !options.offline) {
        const out = process.env.HUB_PREVIEW_DIR; fs.mkdirSync(out,{recursive:true});
        const theme = options.theme == null ? 'theme-green' : options.theme;
        fs.writeFileSync(path.join(out,kind + '-' + (theme || 'theme-pink') + '.json'),JSON.stringify(tree));
        if (options.theme == null) fs.writeFileSync(path.join(out,kind + '.json'),JSON.stringify(tree));
        if (options.theme == null) {
          if (kind === 'profile') {
            f.page.setData({userInfo:{nickName:'把每一个普通的日子都认真收藏起来的读书人'}, personalThemes:f.page.data.personalThemes.map(t=>({...t,title:'这是一份很长很长的主题名称 · '+t.title}))});
            fs.writeFileSync(path.join(out,kind+'-stress-theme-green.json'),JSON.stringify(render(f.page.data)));
          }
          if (kind === 'records') {
            f.page.setData({timelineRows:[],timelineOffline:false,timelineLoading:false});
            fs.writeFileSync(path.join(out,kind+'-empty-theme-green.json'),JSON.stringify(render(f.page.data)));
          }
          if (kind === 'discover') {
            f.page.setData({discoverSection:'lists',viewMode:'list'});
            fs.writeFileSync(path.join(out,kind+'-list-theme-green.json'),JSON.stringify(render(f.page.data)));
          }
        }
      }
      f.page.onUnload();
      console.log('PASS compiled render:',kind, options.offline ? '(offline / empty)' : '(' + (options.theme == null ? 'theme-green' : options.theme || 'theme-pink') + ')');
    }
  }
  assert.deepEqual(errors,[], 'WXML runtime warnings/errors');
}
main().catch(e => { console.error(e); process.exitCode=1; }).finally(() => { for (const p of [output,cssOutput]) if(fs.existsSync(p)) fs.unlinkSync(p); });
