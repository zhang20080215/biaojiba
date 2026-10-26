// Offline layout inspection only: renders real compiled WXML with fixture data.
// This does not emulate WeChat APIs or replace a native-device acceptance pass.
const fs = require('fs'), path = require('path'), cp = require('child_process'), http = require('http'), os = require('os');
const root = path.resolve(__dirname,'..'), out = path.join(os.tmpdir(),'xiaobiaoji-hub-preview');
const result = cp.spawnSync(process.execPath,[path.join(__dirname,'test-navigation-render.cjs')],{cwd:root,env:{...process.env,HUB_PREVIEW_DIR:out},encoding:'utf8',windowsHide:true});
if(result.status) throw new Error(result.stderr || result.stdout);
const esc = s => String(s).replace(/[&<>"']/g,c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const rpx = s => s.replace(/(-?\d+(?:\.\d+)?)rpx/g,(_,n) => `calc(100vw * ${Number(n)/750})`);
function html(node) {
  if(typeof node !== 'object') return esc(node == null ? '' : node);
  const children = (node.children || []).map(html).join('');
  if(node.tag === 'virtual' || node.tag === 'wx-page') return children;
  const tag = {'wx-view':'div','wx-text':'span','wx-image':'img','wx-input':'input','wx-button':'button','wx-scroll-view':'div','wx-textarea':'textarea'}[node.tag] || 'div';
  const attrs = { ...(node.attr || {}) };
  if (node.tag === 'wx-scroll-view' && attrs.scrollX) attrs['data-scroll-x'] = 'true';
  if (node.tag === 'wx-scroll-view' && attrs.showScrollbar === false) attrs['data-hide-scrollbar'] = 'true';
  const attributes = Object.entries(attrs).filter(([k,v]) => ['class','style','src','placeholder','value','hidden','role','ariaLabel','data-scroll-x','data-hide-scrollbar'].includes(k) && v !== false && v != null).map(([k,v]) => {
    if(k === 'hidden') return 'hidden';
    if(k === 'src' && String(v).startsWith('cloud:')) return '';
    if(k === 'style') v=rpx(v);
    return `${k === 'ariaLabel' ? 'aria-label' : k}="${esc(v)}"`;
  }).join(' ');
  return `<${tag} ${attributes}>${tag === 'input' || tag === 'img' ? '' : children + `</${tag}>`}`;
}
const css = rpx(['styles/theme.wxss','styles/hub-legacy.wxss','styles/hub-icons.wxss','styles/hub.wxss'].map(p => fs.readFileSync(path.join(root,p),'utf8')).join('\n').replace(/(^|[\s,])page(?=[\s.,{:#])/gm,'$1body')) + '\n.hub-title-scroll{overflow-x:auto;scrollbar-width:none}.hub-title-scroll::-webkit-scrollbar{display:none}body .preview-tabs{background:var(--bg-page);border-color:var(--line-subtle)}';
const kinds=['home','discover','records','profile'];
const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(/^\/images\/[a-zA-Z0-9_./-]+$/.test(url.pathname) && !url.pathname.includes('..')) {
    const asset=path.join(root,url.pathname);
    if(fs.existsSync(asset)) { res.setHeader('Content-Type',asset.endsWith('.png')?'image/png':'image/svg+xml'); return res.end(fs.readFileSync(asset)); }
  }
  const kind=url.searchParams.get('page') || 'home';
  if(!kinds.includes(kind)){res.statusCode=404;return res.end();}
  const theme=url.searchParams.get('theme') || 'theme-green';
  const palette={ 'theme-green':{suffix:'',color:'#526631'}, 'theme-pink':{suffix:'-pink',color:'#9F4865'}, 'theme-gold':{suffix:'-gold',color:'#856216'}, 'theme-sand':{suffix:'-sand',color:'#756448'} }[theme];
  if(!palette){res.statusCode=404;return res.end();}
  res.setHeader('Content-Type','text/html; charset=utf-8');
  const nav=kinds.map((k,i)=>`<a href="/?page=${k}&theme=${theme}" style="color:${k===kind?palette.color:'#77776D'}"><img src="/images/tabs/${k}${k===kind?'-active'+palette.suffix:''}.png"><span>${['首页','分类','记录','我的'][i]}</span></a>`).join('');
  res.end(`<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>标记吧布局验收 · 测试数据</title><style>body{margin:0;font-family:system-ui,sans-serif}*{box-sizing:border-box}button,input,textarea{font-family:inherit;border:0}button{font-size:inherit}input{background:transparent;outline:0}img{object-fit:cover}[hidden]{display:none!important}${css}.hub-root{padding-bottom:80px}[data-scroll-x]{overflow-x:auto;overflow-y:hidden}[data-hide-scrollbar]{scrollbar-width:none}[data-hide-scrollbar]::-webkit-scrollbar{display:none}.preview-tabs{position:fixed;bottom:0;left:0;right:0;background:#fffcf5;display:flex;height:58px;z-index:10;border-top:1px solid #ede7da}.preview-tabs a{width:25%;display:flex;align-items:center;justify-content:center;flex-direction:column;text-decoration:none;font-size:11px}.preview-tabs img{width:25px;height:25px;margin-bottom:2px}.preview-label{position:absolute;top:6px;left:15px;font-size:9px;color:#6f6f68}</style><span class="preview-label">布局验收 · 测试数据</span>${html(JSON.parse(fs.readFileSync(path.join(out,kind+(kind==='discover' && url.searchParams.get('section')==='daily' ? '-daily' : ['empty','stress','list','locked'].includes(url.searchParams.get('state')) ? '-'+url.searchParams.get('state') : '')+'-'+theme+'.json'))))}<nav class="preview-tabs">${nav}</nav></html>`);
});
server.listen(4179,'127.0.0.1',()=>console.log('Layout fixture: http://127.0.0.1:4179'));
