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
        // 搜索下方 tips 条：紧跟搜索行；未生效 = 文案 + 「看视频」按钮，生效中 = 只剩到期提示
        f.page.setData({showAdFreeTip:true, adFreePassUntilText:''});
        let tn = nodes(render(f.page.data));
        const searchIdx = tn.findIndex(n => n.attr && n.attr.class === 'hub-hero-search-row');
        const tipIdx = tn.findIndex(n => n.attr && (n.attr.class || '').startsWith('hub-adfree-tip'));
        assert.ok(searchIdx >= 0 && tipIdx > searchIdx, 'tip sits right under the search row');
        assert.ok(tn.slice(searchIdx + 1, tipIdx).every(n => searchIdx < tipIdx && !(n.attr && (n.attr.class || '').startsWith('hub-section'))));
        let tipText = JSON.stringify(tn[tipIdx]);
        assert.ok(tipText.includes('看段视频，30 分钟无页面广告') && tipText.includes('onWatchAdFreeVideo'));
        const helpOf = node => (node.children || []).filter(c => c.attr && c.attr.class === 'hub-adfree-help');
        assert.equal(helpOf(tn[tipIdx]).length, 1, 'question mark in the offer state');
        assert.equal(helpOf(tn[tipIdx])[0].attr.bindtap, 'onAdFreeHelp');
        const kids = tn[tipIdx].children.map(c => c.attr && c.attr.class);
        assert.ok(kids.indexOf('hub-adfree-help') < kids.indexOf('hub-adfree-btn'), 'question mark sits before the 看视频 button');
        f.page.setData({adFreePassUntilText:'14:32'});
        tn = nodes(render(f.page.data)); tipText = JSON.stringify(tn.find(n => n.attr && (n.attr.class || '').startsWith('hub-adfree-tip')));
        assert.ok(tipText.includes('页面广告已关闭至 14:32') && !tipText.includes('onWatchAdFreeVideo'));
        assert.equal(helpOf(tn.find(n => n.attr && (n.attr.class || '').startsWith('hub-adfree-tip'))).length, 1, 'question mark while the pass runs');
        f.page.setData({showAdFreeTip:false, adFreePassUntilText:''});
        assert.ok(!nodes(render(f.page.data)).some(n => n.attr && (n.attr.class || '').startsWith('hub-adfree-tip')));
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
        // 标签下广告：独立卡片紧跟在标签后面，渲染出来之前不描边，失败后整块消失
        f.page.setData({discoverSection:'lists', showDiscoverAd:true, discoverAdReady:false, 'adUnitIds.discover_tab_native':'adunit-tab'});
        let adNodes = nodes(render(f.page.data));
        const tabsIndex = adNodes.findIndex(n => n.attr && n.attr.class === 'hub-major-tabs');
        const adIndex = adNodes.findIndex(n => n.attr && (n.attr.class || '').startsWith('hub-tab-ad'));
        assert.ok(tabsIndex >= 0 && adIndex > tabsIndex, 'ad follows the section tabs');
        assert.equal(adNodes[adIndex].attr.class.trim(), 'hub-tab-ad');
        assert.ok(adNodes.slice(tabsIndex + 1, adIndex).every(n => n.tag !== 'wx-view' || n.attr['data-section']), 'nothing sits between the tab line and the ad');
        assert.equal(adNodes[adIndex].children[0].tag, 'wx-ad-custom'); assert.equal(adNodes[adIndex].children[0].attr.unitId, 'adunit-tab');
        f.page.setData({discoverAdReady:true});
        adNodes = nodes(render(f.page.data));
        assert.ok(adNodes.some(n => n.attr && n.attr.class === 'hub-tab-ad hub-tab-ad-ready'));
        f.page.setData({showDiscoverAd:false, discoverAdReady:false});
        adNodes = nodes(render(f.page.data));
        assert.ok(!adNodes.some(n => n.attr && (n.attr.class || '').startsWith('hub-tab-ad')));
        assert.ok(adNodes.some(n => n.attr && n.attr.class === 'hub-major-tabs'), 'tabs markup does not change with the ad');
        // 自定义分区：读取中 → 一份影单 + 待创建书单；云函数失败时只出重试
        f.page.setData({discoverSection:'custom', customState:'loading'});
        assert.equal(nodes(render(f.page.data)).filter(n => n.attr && n.attr.class === 'hub-custom-card').length,2);
        f.page.setData({customState:'ready', customCards:[
          {type:'movie',noun:'影单',unit:'部',item:'电影',list:{_id:'l1',type:'movie',title:'周末片单',description:'周末窝在家里看',count:3,covers:['cloud://a.jpg','cloud://b.jpg']},canCreate:false},
          {type:'book',noun:'书单',unit:'本',item:'图书',list:null,canCreate:true}]});
        const customTree = render(f.page.data), customNodes = nodes(customTree), customText = JSON.stringify(customTree);
        assert.equal(customNodes.filter(n => n.attr && n.attr.class === 'hub-custom-card').length,2);
        assert.equal(customNodes.filter(n => n.attr && n.attr.class === 'hub-custom-cover').length,2);
        assert.ok(customText.includes('周末片单') && customText.includes('周末窝在家里看') && customText.includes('创建书单') && customText.includes('管理影单'));
        assert.ok(customText.includes('实验功能，每个用户可创建 1 个自定义影单和书单。'));
        assert.ok(!customText.includes('从现有榜单里勾选'), 'only the experimental note sits under the section tabs');
        assert.equal(customNodes.filter(n => n.attr && n.attr.class === 'hub-muted hub-custom-desc').length,1);
        assert.equal(customNodes.filter(n => n.attr && n.attr.class === 'hub-search').length,0);
        f.page.setData({customState:'error', customError:'网络异常，请重试'});
        assert.ok(JSON.stringify(render(f.page.data)).includes('重新加载'));
        assert.equal(nodes(render(f.page.data)).filter(n => n.attr && n.attr.class === 'hub-custom-card').length,0);
        f.page.setData({discoverSection:'lists'});
      }
      if (kind === 'profile') {
        // 头像卡下广告：紧跟头像卡、在「我的主题」前（「我的」里已没有影单·书单入口）；渲染出来才加 ready（占位 + 描边）
        f.page.setData({showProfileAd:true, profileAdReady:false, 'adUnitIds.profile_top_native':'adunit-profile'});
        let pn = nodes(render(f.page.data));
        const cardIdx = pn.findIndex(n => n.attr && n.attr.class === 'hub-profile');
        const adIdx = pn.findIndex(n => n.attr && (n.attr.class || '').startsWith('hub-profile-ad'));
        const menuIdx = pn.findIndex(n => n.attr && n.attr.class === 'hub-section-top hub-section');
        assert.ok(!JSON.stringify(render(f.page.data)).includes('我的影单 · 书单'), 'profile no longer links to custom lists');
        assert.ok(cardIdx >= 0 && cardIdx < adIdx && adIdx < menuIdx, 'ad sits between the avatar card and 我的主题');
        assert.equal(pn[adIdx].attr.class.trim(), 'hub-profile-ad');
        assert.equal(pn[adIdx].children[0].tag, 'wx-ad-custom'); assert.equal(pn[adIdx].children[0].attr.unitId, 'adunit-profile');
        f.page.setData({profileAdReady:true});
        assert.ok(nodes(render(f.page.data)).some(n => n.attr && n.attr.class === 'hub-profile-ad hub-profile-ad-ready'));
        f.page.setData({showProfileAd:false, profileAdReady:false});
        assert.ok(!nodes(render(f.page.data)).some(n => n.attr && (n.attr.class || '').startsWith('hub-profile-ad')));
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
