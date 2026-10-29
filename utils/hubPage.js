const hubModel = require('./hubModel');
const hubStore = require('./hubStore');
const hubStats = require('./hubStats');
const timeline = require('./markTimeline');
const hubFlags = require('./hubFlags');
const hubIcons = require('./hubIcons');
const wishLike = require('./wishLike');
const { track } = require('./track');
var adConfig = require('./adConfig')
var rewardedAdManager = require('./rewardedAdManager')
var { awaitOpenid } = require('./openidWaiter.js')
var userStore = require('./userStore.js')
var themeRegistry = require('./themeRegistry.js')
var customList = require('../pages/customList/common.js')

// 用户对分类页的本地偏好（跨会话保留）：置顶主题 id 列表 + 卡片展示模式
// 「我的 → 我的收藏」直接沿用旧首页置顶数据及顺序，不新建存储键或覆盖迁移；分类页卡片右上角的星标读写的也是这份数据。
var PIN_STORAGE_KEY = 'categoryPinnedIds';
var VIEW_MODE_STORAGE_KEY = 'categoryViewMode';
var DYN_COVER_STORAGE_KEY = 'categoryDynCovers';  // 动态封面 URL 本地缓存 { [themeId]: coverUrl }

// 「记录」未开放时蒙版下面展示的雏形：示例时间轴，不拉任何用户数据。
// 海报来自 loadRecordsDemoCovers 读到的真实封面（按片名/书名查，存本地 RECORDS_DEMO_COVERS_KEY，读到过就不再查），
// 读到之前先用首页缓存的榜单 rank=1 封面（肖申克的救赎 / 红楼梦）顶上，再没有就显示表情占位。
var RECORDS_DEMO_COVERS_KEY = 'recordsDemoCoversV1';
var DEMO_MOVIES = ['肖申克的救赎', '霸王别姬', '阿甘正传', '千与千寻'];
var DEMO_BOOK = '红楼梦';
function recordsDemoRows(dynCovers, demo, now) {
  const c = dynCovers && typeof dynCovers === 'object' ? dynCovers : {};
  const d = demo && typeof demo === 'object' ? demo : {};
  const poster = title => (d.covers && d.covers[title]) || '';
  const spot = d.spot || { title: '黄山', cover: '', extra: '安徽 · 黄山' };
  const minute = 60000, hour = 60 * minute;
  return [
    { id: 'demo_1', theme: 'daily:movie', at: now - 12 * minute, count: 1, mode: 'single',
      items: [{ title: '肖申克的救赎', cover: poster('肖申克的救赎') || c.douban_movies || '', status: 'checkin', stars: 5, mood: '🥹 感动',
        note: '希望是美好的事物，也许是人间至善。', extra: '豆瓣 9.7 · 1994 · 弗兰克·德拉邦特' }] },
    { id: 'demo_2', theme: 'daily:read', at: now - 3 * hour, count: 1, mode: 'single',
      items: [{ title: DEMO_BOOK, cover: poster(DEMO_BOOK) || c.douban_books || '', status: 'checkin', stars: 4,
        note: '满纸荒唐言，一把辛酸泪。', progress: '读到第 320 / 1606 页（20%） · 已读 12 天', extra: '豆瓣 9.6 · 曹雪芹' }] },
    { id: 'demo_3', theme: 'douban', at: now - 26 * hour, count: 3, mode: 'batch',
      items: DEMO_MOVIES.slice(1).map(title => ({ title, cover: poster(title), status: 'watched' })) },
    { id: 'demo_4', theme: 'scenic5a', at: now - 3 * 24 * hour, count: 1, mode: 'single',
      items: [{ title: spot.title, cover: spot.cover || '', status: 'watched', extra: spot.extra || '' }] }
  ];
}

var SEARCH_CATEGORY_LABELS = { movie: '电影', tv: '剧集', anime: '动漫', oscar: '奥斯卡', reading: '读书', travel: '旅行', parenting: '育儿' };
// 快捷词只展示主题词，不展示完整榜单名或搜索别名。
var SEARCH_QUICK_WORDS = [
  '日剧', '韩剧', '美剧', '英剧', '华语', '外语',
  '科幻', '喜剧', '悬疑', '推理', '恐怖', '动作', '战争', '文艺', '动画',
  '豆瓣', 'IMDB', 'Letterboxd', '动漫', '微信读书',
  '奥斯卡', '金棕榈', '视与听', '茅盾', '纽伯瑞', '诺贝尔',
  '东野圭吾', '阿加莎', '漫威', '迪士尼', '皮克斯', '梦工厂',
  '景区', '博物馆', '省份', '城市', '育儿'
];
var SEARCH_ALIASES = {
  douban_movies: ['豆瓣250', '豆瓣电影250', '电影TOP250'],
  daily_sleep: ['睡眠', '每日睡眠', '作息'],   // 2026-10-29 改名「每日早睡」，搜「睡眠」仍要能找到
  douban_books: ['豆瓣图书', '书单', '图书TOP250'],
  douban_tv_cn: ['国剧', '国产剧', '华语剧'],
  douban_tv_foreign: ['外语剧集', '海外剧', '美剧', '英剧', '韩剧', '日剧'],
  douban_tv_anime: ['番剧', '动漫'],
  bangumi_anime: ['动漫', '番剧', 'Bangumi'],
  imdb_movies: ['IMDB', 'IMBD'],
  travel_provinces: ['省份', '旅游'],
  travel_cities: ['城市', '旅游']
};

function normalizeSearch(value) {
  return String(value || '').toLowerCase().replace(/[\s·\-_/]/g, '');
}

// 每日主题横排块的图标/底色/文字色（按主题 id）—— 暖调协调配色
var DAILY_BLOCK_META = {
  daily_movie: { emoji: '🎬', color: '#F6DED5', label: '#B05B43' }, // 暖陶土
  daily_read:  { emoji: '📖', color: '#E5EAD2', label: '#6E7B45' }, // 橄榄绿（呼应主题色）
  daily_sport: { emoji: '🏋️', color: '#DEE7FF', label: '#3F6AD6' }, // 清新蓝（呼应每日运动页风格）
  daily_water: { emoji: '💧', color: '#D8E7EC', label: '#3F7E93' }, // 雾蓝
  // isNew：首页块图标右上角挂「NEW」角标（2026-10-29 随步数 / 早睡上线加的，过一两个版本删掉这两个字段即可）
  daily_steps: { emoji: '👟', color: '#E8E3F3', label: '#6A5A9C', isNew: true }, // 淡紫
  daily_sleep: { emoji: '🌙', color: '#DFE3F0', label: '#4A5785', isNew: true }  // 夜蓝
};
var DAILY_BLOCK_SOON = { emoji: '✨', color: '#EFE9DD', label: '#A89B85' };

// Open games appear in home shortcuts and discovery tools, outside the list popularity pool.
// Releasing a hidden mode also requires registering its route and removing its pack exclusion.
var GAME_BLOCKS = [
  { key: 'guess_cross', mode: 'cross', title: '每日电影填词', sub: '五部电影横竖交叉，每天一局', emoji: '🔤', color: '#DEE6EF', label: '#46617F', url: '/pages/guess/cross/index' },
  { key: 'guess_grid',  mode: 'grid',  title: '交叉填格', emoji: '🎬', color: '#E7EBD5', label: '#5E7238', url: '/pages/guess/grid/index', hidden: true },
  { key: 'guess_clue',  mode: 'clue',  title: '线索猜片', emoji: '🔍', color: '#EDE4F0', label: '#6B5A8C', url: '/pages/guess/clue/index', hidden: true }
];

// 动态封面主题：用榜单 rank=1 那部作品的封面做卡片图（整图铺满裁剪 + 主题色叠色，叠色/占位配色
// 由各主题行的 brand 派生成 inline style，见 _decorateThemes）。封面回来前 wxml 显示 skeleton 流光占位，
// 加载/匹配失败则停在 emoji 渐变占位。字段：
//   collection — 省略默认 generic_theme_movies；theme — 共享集合里按 theme 过滤
//   top        — TOP 榜集合（movies/imdb_movies/…）要排除软删记录（isTop250:false 的也可能 rank=1）
//   latest     — rank 即届数的奖项榜（奥斯卡系），取 rank 最大的一届而不是 rank=1（1929 年的《翼》）
// 包里不再带任何设计封面图（2026-09 起，原 10 张 cover-*.jpg 合计 250KB 全部删除）；
// 没有榜单集合的五张卡（每日电影/读书/运动/喝水 + 评分查询）的封面放云存储 category_covers/，image 直接填 fileID
//（源图在 tools/category-covers/，四张每日卡是 1:1 简约图标，同一奶油底 + 各自 brand 色）。
var DYNAMIC_COVER_THEMES = [
  // 老主题（专属集合）
  { id: 'douban_movies', collection: 'movies', top: true },
  { id: 'imdb_movies', collection: 'imdb_movies', top: true },
  { id: 'boxoffice_movies', collection: 'boxoffice_movies', top: true },
  { id: 'oscar_movies', collection: 'oscar_movies', latest: true },
  { id: 'oscar_anime_movies', collection: 'oscar_anime_movies', latest: true },
  { id: 'oscar_cinematography_movies', theme: 'oscarCinematography', latest: true },
  { id: 'douban_books', collection: 'douban_books', top: true },
  { id: 'weread_books', collection: 'weread_books', top: true },
  { id: 'rt_horror_movies', theme: 'rtHorror' },
  { id: 'rt_war_movies', theme: 'rtWar' },
  { id: 'rt_animation_movies', theme: 'rtAnimation' },
  { id: 'palme_dor_movies', theme: 'palmeDor' },
  { id: 'oscar_screenplay_movies', theme: 'oscarScreenplay' },
  { id: 'oscar_foreign_movies', theme: 'oscarForeign' },
  { id: 'oscar_director_movies', theme: 'oscarDirector' },
  { id: 'oscar_vfx_movies', theme: 'oscarVFX' },
  { id: 'oscar_actor_movies', theme: 'oscarActor' },
  { id: 'oscar_actress_movies', theme: 'oscarActress' },
  { id: 'rt_action_movies', theme: 'rtAction' },
  { id: 'letterboxd500_movies', theme: 'letterboxd500' },
  // 豆瓣「选剧集」9 分以上三主题
  { id: 'douban_tv_cn', theme: 'doubanTvCn' },
  { id: 'douban_tv_foreign', theme: 'doubanTvForeign' },
  { id: 'douban_tv_anime', theme: 'doubanTvAnime' },
  { id: 'bangumi_anime', theme: 'bangumi250' },
  { id: 'arthouse_movies', theme: 'arthouse' },
  { id: 'sightsound_movies', theme: 'sightsound' },
  // collection 省略时默认 generic_theme_movies；读书通用主题（generic_theme_books）显式指定
  { id: 'maodun_books', theme: 'maodun', collection: 'generic_theme_books' },
  { id: 'newbery_books', theme: 'newbery', collection: 'generic_theme_books' },
  // 旅游主题（专属集合 scenic_5a），卡片图用 rank=1 景区封面
  { id: 'scenic_5a', theme: 'scenic5a', collection: 'scenic_5a' },
  // 博物馆主题（专属集合 museum_grade1），卡片图用 rank=1 博物馆封面
  { id: 'museum_grade1', theme: 'museum', collection: 'museum_grade1' }
];

module.exports = function createHubPage(pageKind) {
  // 「记录」tab 未开放时只显示蒙版，不加载任何时间轴数据（开关见 utils/hubFlags.js）
  const recordsLocked = pageKind === 'records' && !hubFlags.recordsOpen;
  return {
  _pageKind: pageKind,
  data: {
    pageKind,
    recordsLocked,
    wishLikes: 0, wishTotalText: '100+', likePop: '', likeBursts: [],
    pageTitle: { home: '标记吧', discover: '分类', records: '记录', profile: '我的' }[pageKind],
    discoverSection: 'lists', dailyThemes: [],
    // 分类页「自定义」分区：用户自建影单/书单，切到该分区才读（customList mine）
    customCards: customList.buildCards([], null), customState: 'idle', customError: '', customMaxItems: customList.MAX_ITEMS,
    personalTab: 'common', personalExpanded: false, personalThemes: [], personalTotal: 0,
    personalTabs: [{id:'common',label:'我的收藏'},{id:'recent',label:'最近使用'},{id:'marked',label:'标记进度'}],
    timelineRows: [], timelineLoading: false, timelineOffline: false, timelineHasMore: false,
    sortMode: 'popular',
    hotThemes: [], pendingClassicThemes: [], fallbackThemes: [], newThemes: [], commonThemes: [], recentThemes: [], markedThemes: [],
    popularityReady: false, statsState: 'loading', summaryState: 'loading', summaryRows: {},
    categories: [{id:'all',label:'全部'},{id:'movie',label:'电影'},{id:'tv',label:'剧集'},{id:'anime',label:'动漫'},{id:'reading',label:'读书'},{id:'travel',label:'旅行'},{id:'tools',label:'工具'}],
    userInfo: null,
    openid: '',
    pendingOpenid: '',
    loading: false,
    showAuthModal: false,
    tempAvatar: '',
    tempNickname: '',
    activeTab: 'all',
    dailyBlocks: [],
    searchQuery: '',
    searchKeywords: [],
    gameBlocks: GAME_BLOCKS.filter(function (g) { return !g.hidden; }),
    themeClass: '',
    showThemePicker: false,
    // 会员码（= openid）。展示用的截断串；完整串放实例字段 _memberCode，不进 data
    memberCodeShort: '',
    isAdFree: adConfig.isAdFree(),
    vipExpireText: '',
    // 卡片展示模式：'cover'（封面网格，默认）| 'list'（列表）——用户上次选择本地保留
    viewMode: 'cover',
    // 置顶主题 id（按展示先后排序）——用户上次选择本地保留
    pinnedIds: [],
    // 置顶管理面板
    showPinManager: false,
    pinManagerList: [],
    statusBarHeight: 20,
    headerPadTop: 0,
    // 骞垮憡鐩稿叧
    showNativeAd: false,
    showTopAd: false,
    // 分类页标签线下的原生位：showDiscoverAd 决定挂不挂组件，discoverAdReady 等广告真正渲染出来才描边，免得空框先露出来
    showDiscoverAd: false,
    discoverAdReady: false,
    // 「我的」头像卡下的原生位，同样等渲染出来才占位、描边
    showProfileAd: false,
    profileAdReady: false,
    // 首页搜索下方 tips 条：看一段视频换 30 分钟不展示页面广告（adConfig.grantAdFreePass）。
    // 会员不出；激励位被云端关掉也不出；生效期间换成「HH:MM 前不展示广告」
    showAdFreeTip: false,
    adFreePassUntilText: '',
    adUnitIds: {
      category_native: adConfig.getAdUnitId('category_native') || '',
      home_top_native: '',
      discover_tab_native: '',
      profile_top_native: '',
    },
    themes: require('./themeCatalog').map(t => ({ ...t })).concat(GAME_BLOCKS.filter(g => !g.hidden).map(g => ({ ...g, id: g.key, category: 'game', tag: '玩法', description: g.sub, placeholderEmoji: g.emoji }))),
    filteredThemes: [],
    // 片单/书单需求收集弹窗
    showRequestModal: false,
    requestType: 'movie',
    requestContent: ''
  },

  onLoad() {
    // 鑷畾涔夊鑸細鑾峰彇鐘舵€佹爮楂樺害鍜岃兌鍥婃寜閽綅缃?
    const windowInfo = wx.getWindowInfo();
    const menuBtn = wx.getMenuButtonBoundingClientRect();
    // header paddingTop = 鑳跺泭鎸夐挳椤堕儴鐣欑櫧
    const headerPadTop = menuBtn.top;
    this._firstShow = true;
    this._pageUnloaded = false;
    const savedTheme = getApp().globalData.theme == null ? 'theme-green' : getApp().globalData.theme;
    // 读取本地保留的展示模式 / 置顶配置（无则用默认）
    const savedViewMode = wx.getStorageSync(VIEW_MODE_STORAGE_KEY) === 'list' ? 'list' : 'cover';
    const savedPinned = wx.getStorageSync(PIN_STORAGE_KEY);
    this.setData({
      statusBarHeight: windowInfo.statusBarHeight || 20,
      headerPadTop,
      themeClass: savedTheme,
      viewMode: savedViewMode,
      pinnedIds: Array.isArray(savedPinned) ? savedPinned : []
    });

    // 硬编码主题行：把 brand 派生成 inline 配色、标出动态封面主题（云端注册表主题在 _buildCloudCard 里同样处理）
    this._decorateThemes();
    // 动态封面：先用本地缓存的封面 URL 填进主题（避免"占位图标→真图"闪烁），loadDynamicCovers 再刷新。
    // 必须在 _mergeCloudThemes 之前：它会调 filterThemes 生成首屏列表，晚于它填封面，首屏就会先闪一次图标
    this._seedDynCoversFromCache();
    // 云端注册表：先用本地缓存的新主题即时合入卡片（无网络等待），稍后 loadCloudRegistry 再拉最新
    this._mergeCloudThemes(themeRegistry.readAll());
    if (recordsLocked) {
      this._timelineRaw = this._recordsDemo();
      const cached = wishLike.cachedTotal();
      this._wishBase = cached ? cached.total : 0;
      this._renderWishLikes();
      wishLike.loadTotal().then(total => { this._wishBase = total; if (!this._pageUnloaded) this._renderWishLikes(); });
    }

    this.checkLoginStatus();
    this.buildDailyBlocks();
    this.filterThemes('all');

    // 非关键数据加载延迟到首屏渲染后，避免拉长 onLoad 长任务
    wx.nextTick(() => {
      if (this._pageUnloaded) return;
      this.loadCloudRegistry();
      if (pageKind === 'home' || pageKind === 'discover') this.loadUserCounts();
      if (pageKind === 'profile') this.loadPersonalSummary();
      if (pageKind === 'records') this.loadTimeline();
      if (pageKind !== 'profile' && !recordsLocked) this.loadDynamicCovers();
      if (recordsLocked) this.loadRecordsDemoCovers();
      this.initAds();
    });
  },

  _recordsDemo() {
    let dynCovers = null, demo = null;
    try { dynCovers = wx.getStorageSync(DYN_COVER_STORAGE_KEY); demo = wx.getStorageSync(RECORDS_DEMO_COVERS_KEY); } catch (e) {}
    return recordsDemoRows(dynCovers, demo, Date.now());
  },

  // 示例时间轴的真实海报：电影/书按名字查各自榜单集合，景区取 5A 榜第一名。
  // 公共榜单数据、与首页取动态封面同一种读法；查齐过一次就存本地，之后不再请求。
  async loadRecordsDemoCovers() {
    let cached = null;
    try { cached = wx.getStorageSync(RECORDS_DEMO_COVERS_KEY); } catch (e) {}
    const complete = cached && cached.covers && cached.spot && DEMO_MOVIES.concat(DEMO_BOOK).every(t => cached.covers[t]);
    // 查齐了就永远不再查；没查齐（某部片名库里没有、网络失败）也最多一天试一次
    if (complete || (cached && Date.now() - (cached.checkedAt || 0) < 86400000)) return;
    const db = wx.cloud.database();
    const _ = db.command;
    const [movies, books, spots] = await Promise.allSettled([
      db.collection('movies').where({ title: _.in(DEMO_MOVIES), isTop250: _.neq(false) }).field({ title: true, cover: true }).limit(20).get(),
      db.collection('douban_books').where({ title: DEMO_BOOK }).field({ title: true, cover: true }).limit(1).get(),
      db.collection('scenic_5a').where({ rank: 1 }).field({ name: true, shortName: true, cover: true, province: true, city: true }).limit(1).get()
    ]);
    if (this._pageUnloaded) return;
    const covers = { ...((cached && cached.covers) || {}) };
    [movies, books].forEach(r => {
      if (r.status !== 'fulfilled') return;
      (r.value.data || []).forEach(doc => { if (doc.title && doc.cover && !covers[doc.title]) covers[doc.title] = doc.cover; });
    });
    let spot = cached && cached.spot || null;
    const s = spots.status === 'fulfilled' && spots.value.data && spots.value.data[0];
    if (s && s.cover) {
      const title = s.shortName || s.name || '';
      const place = s.city && s.city !== s.province ? `${s.province} · ${s.city}` : (s.province || '');
      if (title) spot = { title, cover: s.cover, extra: place };
    }
    const next = { covers, spot, checkedAt: Date.now() };
    try { wx.setStorageSync(RECORDS_DEMO_COVERS_KEY, next); } catch (e) {}
    if (JSON.stringify({ covers, spot }) === JSON.stringify({ covers: (cached && cached.covers) || {}, spot: cached && cached.spot || null })) return;
    this._timelineRaw = this._recordsDemo();
    this.setData({ timelineRows: this._presentTimeline(this._timelineRaw, this.data.themes) });
  },

  // ── 云端主题注册表（不用发版上新书单/影单）──
  // 拉取最新注册表 → 写本地缓存 → 合入卡片；失败则维持缓存/硬编码兜底，分类页照常。
  async loadCloudRegistry() {
    try {
      const res = await wx.cloud.callFunction({ name: 'getThemeRegistry', data: {} });
      const result = res && res.result;
      if (this._pageUnloaded || !result || !result.success || !Array.isArray(result.themes)) return;
      themeRegistry.writeAll(result.themes);
      const added = this._mergeCloudThemes(result.themes);
      if (added) {
        // 新合入的云端主题补封面和参与人数
        this.loadDynamicCovers();
        if (pageKind === 'home' || pageKind === 'discover') this.loadUserCounts();
      }
    } catch (e) {
      console.warn('加载云端主题注册表失败', e);
    }
  },

  // 主题行的 brand: [soft, primary] → 叠色 tintStyle / 占位 coverStyle（跟云端主题卡同一套模板），
  // dynamic 标记该卡的封面要等 loadDynamicCovers 回来（skeleton 只给这些卡叠）
  _decorateThemes() {
    const dynamicIds = new Set(DYNAMIC_COVER_THEMES.map(c => c.id));
    const themes = (this.data.themes || []).map(t => ({
      ...t,
      ...this._brandStyles(t.brand),
      dynamic: dynamicIds.has(t.id)
    }));
    this.setData({ themes });
  },

  _brandStyles(brand) {
    const soft = (brand && brand[0]) || '#5C6B7A';
    const primary = (brand && brand[1]) || '#3B4252';
    return {
      tintStyle: `background: linear-gradient(135deg, ${soft}80 0%, ${primary}80 100%);`,
      coverStyle: `background: linear-gradient(135deg, ${soft} 0%, ${primary} 100%);`
    };
  },

  // 把注册表文档构建成卡片并「前插」进 this.data.themes（按 id 去重，重复调用幂等）。
  // 返回是否有新卡片合入。云端主题文档同时缓存在 this._cloudThemeDocs 供封面/人数派生。
  _mergeCloudThemes(docs) {
    if (!Array.isArray(docs)) return false;
    this._cloudThemeDocs = docs.filter(d => d && d.enabled !== false);
    const metadata = new Map(this._cloudThemeDocs.map(d => [d.cardId, d]));
    const base = (this.data.themes || []).filter(t => !t._cloud).map(t => {
      const d = metadata.get(t.id);
      return d ? { ...t, publishedAt: d.publishedAt || d.launchedAt || t.publishedAt || '', wishFrom: typeof d.wishFrom === 'string' ? d.wishFrom : t.wishFrom } : t;
    });
    const existingIds = new Set(base.map(t => t.id));
    const previous = new Map((this.data.themes || []).map(t => [t.id, t]));
    let coverCache = null;
    try { coverCache = wx.getStorageSync(DYN_COVER_STORAGE_KEY); } catch (e) {}
    const cachedCover = id => (coverCache && typeof coverCache === 'object' && coverCache[id] ? { cover: coverCache[id] } : undefined);
    const newCards = docs
      .filter(d => d && d.enabled !== false && d.theme && d.cardId && !existingIds.has(d.cardId))
      .sort((a, b) => (a.order || 0) - (b.order || 0))
      .map(d => ({ ...this._buildCloudCard(d), dynamicCover: (previous.get(d.cardId) && previous.get(d.cardId).dynamicCover) || cachedCover(d.cardId) }));
    const themes = newCards.concat(base);
    this.setData({ themes });
    this.filterThemes(this.data.activeTab);
    // 只有出现此前没有的云端卡片才算「新合入」，调用方据此决定是否重拉封面/人数
    return newCards.some(card => !(previous.get(card.id) && previous.get(card.id)._cloud));
  },

  _buildCloudCard(d) {
    const isBook = d.type === 'book';
    const base = isBook ? '/pages/genericBookList/list/list?theme=' : '/pages/genericList/list/list?theme=';
    const primary = d.brandPrimary || '#3B4252';
    const soft = d.brandSoft || primary;
    return {
      id: d.cardId,
      title: d.title || (isBook ? '主题书单' : '主题片单'),
      description: d.description || '',
      keywords: d.keywords || [],
      aliases: d.aliases || [],
      image: '',
      ...this._brandStyles([soft, primary]),
      dynamic: true,
      placeholderEmoji: d.placeholderEmoji || (isBook ? '📖' : '🎬'),
      userCount: 0,
      userCountText: this.formatUserCount(0),
      tag: d.tag || (isBook ? '读书' : '电影'),
      category: d.category || (isBook ? 'reading' : 'movie'),
      isNew: !!d.newBadge,
      newBadge: !!d.newBadge,
      publishedAt: d.publishedAt || d.launchedAt || '',
      wishFrom: d.wishFrom || '',
      url: base + d.theme,
      _cloud: true,
      _theme: d.theme,
      _collection: isBook ? 'generic_theme_books' : 'generic_theme_movies',
      _source: d.source || d.theme
    };
  },

  // 用本地缓存的封面 URL 立即回填 dynamicCover（首屏秒显真实封面，不闪占位）
  _seedDynCoversFromCache() {
    let cache;
    try { cache = wx.getStorageSync(DYN_COVER_STORAGE_KEY); } catch (e) { cache = null; }
    if (!cache || typeof cache !== 'object') return;
    let changed = false;
    const themes = (this.data.themes || []).map(t => {
      if (!t.dynamicCover && cache[t.id]) { changed = true; return { ...t, dynamicCover: { cover: cache[t.id] } }; }
      return t;
    });
    if (changed) this.setData({ themes });
  },

  // 把最新拉到的动态封面 URL 写入本地缓存（与已有条目合并，避免丢失本次未覆盖的主题）
  _writeDynCoverCache(covers) {
    try {
      const prev = wx.getStorageSync(DYN_COVER_STORAGE_KEY);
      const next = (prev && typeof prev === 'object') ? { ...prev } : {};
      Object.keys(covers).forEach(id => { if (covers[id] && covers[id].cover) next[id] = covers[id].cover; });
      wx.setStorageSync(DYN_COVER_STORAGE_KEY, next);
    } catch (e) { /* 缓存失败不影响功能 */ }
  },

  // 封面加载失败（缓存 URL 过期/失效等）→ 退回占位符，并清掉该条缓存，避免持续裂图
  onCoverError(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    const themes = (this.data.themes || []).map(t => t.id === id ? { ...t, image: '', dynamicCover: null } : t);
    this.setData({ themes });
    this.filterThemes(this.data.activeTab);
    try {
      const cache = wx.getStorageSync(DYN_COVER_STORAGE_KEY);
      if (cache && typeof cache === 'object' && cache[id]) { delete cache[id]; wx.setStorageSync(DYN_COVER_STORAGE_KEY, cache); }
    } catch (err) { /* ignore */ }
  },

  // 没有静态设计封面的主题：拉一次各自榜单 rank=1 的封面，拼成卡片图
  async loadDynamicCovers() {
    const db = wx.cloud.database();
    // 硬编码老主题 + 云端注册表新主题，都用各自榜单 rank=1 的封面做卡片图
    const cloudDyn = (this._cloudThemeDocs || []).map(d => ({
      id: d.cardId, theme: d.theme, collection: d.type === 'book' ? 'generic_theme_books' : 'generic_theme_movies'
    }));
    const dynList = DYNAMIC_COVER_THEMES.concat(cloudDyn);
    const _ = db.command;
    const results = await Promise.allSettled(
      dynList.map(cfg => {
        const where = {};
        if (cfg.theme) where.theme = cfg.theme;
        if (cfg.top) where.isTop250 = _.neq(false);
        if (!cfg.latest) where.rank = 1;
        let q = db.collection(cfg.collection || 'generic_theme_movies').where(where);
        if (cfg.latest) q = q.orderBy('rank', 'desc');
        return q.field({ cover: true }).limit(1).get();
      })
    );
    if (this._pageUnloaded) return;

    const covers = {};
    results.forEach((result, i) => {
      const cfg = dynList[i];
      if (result.status !== 'fulfilled') return;
      const doc = result.value.data && result.value.data[0];
      if (!doc || !doc.cover) return; // 没匹配到就让占位符继续兜底
      covers[cfg.id] = { cover: doc.cover };
    });
    if (Object.keys(covers).length === 0) return;

    // 回写本地缓存，供下次进页面首屏秒显
    this._writeDynCoverCache(covers);

    // 现读 this.data.themes 再合并，而不是用调用开始时的旧快照 —— 避免跟 loadUserCounts()
    // 并发写入时互相用过时快照覆盖对方刚写的字段（比如把这里刚写的 dynamicCover 冲掉）。
    // 封面与缓存一致（绝大多数情况）就不 setData、不重排列表，避免首屏后再整体重渲染一次
    const changed = t => covers[t.id] && (!t.dynamicCover || t.dynamicCover.cover !== covers[t.id].cover);
    if (!this.data.themes.some(changed)) return;
    const themes = this.data.themes.map(t => covers[t.id] ? { ...t, dynamicCover: covers[t.id] } : t);
    this.setData({ themes });
    this.filterThemes(this.data.activeTab);
  },

  // ── 片单/书单需求收集 ──
  onOpenRequestModal() {
    this.setData({ showRequestModal: true });
  },

  onCloseRequestModal() {
    this.setData({ showRequestModal: false });
  },

  onRequestTypeTap(e) {
    this.setData({ requestType: e.currentTarget.dataset.type });
  },

  onRequestInput(e) {
    this.setData({ requestContent: e.detail.value });
  },

  async onSubmitRequest() {
    const content = (this.data.requestContent || '').trim();
    if (!content) {
      wx.showToast({ title: '先写点内容吧', icon: 'none' });
      return;
    }
    if (this._requestSubmitting) return;
    this._requestSubmitting = true;
    wx.showLoading({ title: '提交中', mask: true });
    try {
      const res = await wx.cloud.callFunction({
        name: 'submitThemeRequest',
        data: { type: this.data.requestType, content, nickname: (this.data.userInfo && this.data.userInfo.nickName) || '' }
      });
      wx.hideLoading();
      const result = res && res.result;
      if (result && result.success) {
        this.setData({ showRequestModal: false, requestContent: '' });
        // 带 icon 的 toast 标题最多显示 7 个字符，超出会被截断
        wx.showToast({ title: '许愿已收到', icon: 'success' });
      } else {
        wx.showToast({ title: (result && result.error) || '提交失败，稍后再试', icon: 'none' });
      }
    } catch (err) {
      wx.hideLoading();
      console.warn('submitThemeRequest 失败', err);
      wx.showToast({ title: '网络异常，稍后再试', icon: 'none' });
    }
    this._requestSubmitting = false;
  },

  onShareAppMessage() {
    return {
      title: '标记吧，标记生活的仪式感，分享专属记录',
      path: '/pages/category/category'
    };
  },

  onShow() {
    this.checkLoginStatus();
    this._mergeCloudThemes(themeRegistry.readAll());
    this.setData({ themeClass: getApp().globalData.theme == null ? 'theme-green' : getApp().globalData.theme });
    hubStore.applyTabStyle(this.data.themeClass, this, pageKind);
    this.initAds();
    const intent = hubStore.takeIntent(pageKind);
    if (intent) this.setData({ discoverSection: 'lists', activeTab: intent.category || 'all', searchQuery: intent.query || '', sortMode: intent.sort || 'popular' });
    if (intent && pageKind === 'profile') this.setData({ personalTab: intent.personalTab || 'common', personalExpanded: false });
    this.filterThemes(this.data.activeTab);
    if (pageKind === 'profile') this.setData({ isAdFree: adConfig.isAdFree(), vipExpireText: this.buildExpireText() });
    if (!this._firstShow && (pageKind === 'home' || pageKind === 'discover')) this.loadUserCounts();
    if (!this._firstShow && pageKind === 'profile') this.loadPersonalSummary();
    if (!this._firstShow && pageKind === 'records') this.loadTimeline();
    if (!this._firstShow && pageKind === 'discover' && this.data.discoverSection === 'custom') this.loadCustomLists();
    this._firstShow = false;
  },

  // 涓婚鍒囨崲
  // 记录页：切走 tab 时把攒着的「期待上线」次数一次报上去
  onHide() { if (recordsLocked) this._flushWishLikes(); },

  onUnload() {
    if (recordsLocked) this._flushWishLikes();
    if (this._adFreePassTimer) { clearTimeout(this._adFreePassTimer); this._adFreePassTimer = null; }
    // syncMemberCode 的 openid 等待可能晚于页面销毁返回，落 setData 会往已销毁的
    // 父节点插节点（insertTextView:fail parent not found）
    this._pageUnloaded = true;
    if (this._cardObserver) this._cardObserver.disconnect();
  },

  onToggleThemePicker() {
    const opening = !this.data.showThemePicker;
    this.setData({ showThemePicker: opening });
    // 面板打开时才去取会员码，平时不为它花一次 openid 等待
    if (opening) this.syncMemberCode();
  },

  /**
   * 会员码 = openid。用户复制后发给运营，运营在云端 app_config 的
   * vip_users 集合里新增一条（_id 填这串码），该用户下次进入小程序即免广告。
   * 完整串只留在实例字段上，data 里只放截断展示串。
   */
  syncMemberCode() {
    this.setData({ isAdFree: adConfig.isAdFree(), vipExpireText: this.buildExpireText() });
    // 打开面板顺手强制查一次会员状态：用户刚付完款问「怎么还没生效」时，
    // 让他打开这个面板就能拿到最新结果，不用教他退出重进。force=true 跳过节流。
    adConfig.refreshAdFree(true).then(() => {
      if (this._pageUnloaded) return;
      this.setData({ isAdFree: adConfig.isAdFree(), vipExpireText: this.buildExpireText() });
    });
    if (this._memberCode) return;
    awaitOpenid(this, 3000).then((openid) => {
      if (!openid || this._pageUnloaded) return;
      this._memberCode = openid;
      this.setData({
        memberCodeShort: openid.slice(0, 6) + '…' + openid.slice(-6),
      });
    });
  },

  /** 会员到期文案：永久卡不显示日期，年卡显示到期日 */
  buildExpireText() {
    if (!adConfig.isAdFree()) return '';
    const expireAt = adConfig.getVipExpireAt();
    if (!expireAt) return '';
    const d = new Date(expireAt);
    return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()} 到期`;
  },

  onCopyMemberCode() {
    if (!this._memberCode) {
      wx.showToast({ title: '正在获取，请稍后重试', icon: 'none' });
      this.syncMemberCode();
      return;
    }
    wx.setClipboardData({ data: this._memberCode });
  },

  onThemeSelect(e) {
    const theme = e.currentTarget.dataset.theme;
    const app = getApp();
    app.globalData.theme = theme;
    wx.setStorageSync('appTheme', theme);
    this.setData({ themeClass: theme, showThemePicker: false });
    hubStore.applyTabStyle(theme, this, pageKind);
  },

  // 鍒嗙被Tab鍒囨崲
  onTabTap(e) {
    const tab = e.currentTarget.dataset.tab;
    this.setData({ activeTab: tab });
    this.filterThemes(tab);
  },

  onSearchInput(e) {
    this.setData({ searchQuery: e.detail.value, activeTab: 'all' });
    this.filterThemes('all');
  },

  onSearchConfirm() {
    this.filterThemes(this.data.activeTab);
  },

  onSearchKeywordTap(e) {
    const keyword = e.currentTarget.dataset.keyword;
    this.setData({ searchQuery: this.data.searchQuery === keyword ? '' : keyword, activeTab: 'all' });
    this.filterThemes('all');
  },

  onClearSearch() {
    this.setData({ searchQuery: '', activeTab: 'all' });
    this.filterThemes('all');
  },

  _themeKeywords(theme) {
    const extras = [theme.keywords, theme.aliases].reduce((all, value) => {
      return all.concat(Array.isArray(value) ? value : (typeof value === 'string' ? [value] : []));
    }, []);
    const title = theme.title || '';
    const topicWords = title.match(/豆瓣|IMDB|Letterboxd|Bangumi|微信读书|科幻|喜剧|悬疑|推理|恐怖|动作|战争|动画|动漫|韩剧|日剧|美剧|英剧|华语|外语|博物馆|旅游|茅盾|纽伯瑞|金棕榈/gi) || [];
    const author = /作品集$/.test(title) ? [title.replace(/作品集$/, '').trim()] : [];
    return [theme.title, theme.tag, SEARCH_CATEGORY_LABELS[theme.category]]
      .concat(topicWords, author, SEARCH_ALIASES[theme.id] || [], extras)
      .filter(value => typeof value === 'string' && value.trim());
  },

  // 每日主题独立成顶部横排块（一行 4 个，最多 6 个：第二行是每日步数、每日早睡；不足 4 个时补「敬请期待」），不进下方卡片网格
  buildDailyBlocks() {
    const daily = (this.data.themes || []).filter(t => t.category === 'daily').slice(0, 6);
    const blocks = daily.map(t => {
      const meta = DAILY_BLOCK_META[t.id] || DAILY_BLOCK_SOON;
      return { key: t.id, id: t.id, title: t.title, isNew: !!meta.isNew, url: t.url, iconKey: hubIcons.keyFor(t), emoji: meta.emoji, color: meta.color, label: meta.label, userCountText: t.userCountText || '', placeholder: false };
    });
    if (blocks.length < 4) {
      blocks.push({ key: 'soon', title: '敬请期待', iconKey: 'sparkle', emoji: DAILY_BLOCK_SOON.emoji, color: DAILY_BLOCK_SOON.color, label: DAILY_BLOCK_SOON.label, placeholder: true });
    }
    this.setData({ dailyBlocks: blocks });
  },

  filterThemes(tab) {
    const themes = hubModel.decorate(this.data.themes, this._stats || hubStore.readStats());
    const pinned = wx.getStorageSync(PIN_STORAGE_KEY);
    const pinnedIds = Array.isArray(pinned) ? pinned : [];
    const history = hubStore.readHistory();
    const byId = new Map(themes.map(t => [t.id, t]));
    const commonThemes = pinnedIds.map(id => byId.get(id)).filter(Boolean);
    const recentThemes = history.map(h => {
      const theme = themes.find(t => t.id === h.id || hubModel.routeKey(t) === h.id);
      return theme ? { ...theme, lastOpened: h.at } : null;
    }).filter(Boolean).slice(0, 8);
    const summaryRows = this.data.summaryRows || {};
    const withProgress = t => hubModel.withProgress(t, summaryRows[t.id]);
    const markedThemes = themes.filter(t => summaryRows[t.id] && (summaryRows[t.id].done || summaryRows[t.id].wish)).map(withProgress);
    const catalog = themes.filter(t => hubModel.isList(t));
    const hotThemes = hubModel.selectHot(catalog);
    const pendingClassicThemes = ['douban_movies', 'imdb_movies'].map(id => catalog.find(t => t.id === id))
      .filter(t => t && !t.countKnown);
    const fallbackThemes = pendingClassicThemes.concat(catalog.filter(t => t.contentCount !== 0 &&
      !pendingClassicThemes.some(p => p.id === t.id))).slice(0, 10);
    const newThemes = hubModel.selectNew(catalog);
    const pinnedSet = new Set(pinnedIds);
    const filteredThemes = hubModel.filter(themes.filter(t => t.category !== 'daily'), tab, this.data.searchQuery, this.data.sortMode, t => this._themeKeywords(t))
      .map(t => pinnedSet.has(t.id) ? { ...t, favorited: true } : t);
    const searchKeywords = SEARCH_QUICK_WORDS.filter(word => themes.some(t => this._themeKeywords(t).some(v => normalizeSearch(v).includes(normalizeSearch(word)))));
    this.setData({ themes, pinnedIds, commonThemes: commonThemes.map(t => summaryRows[t.id] ? withProgress(t) : { ...t, progressText: '已收藏 · 点击打开' }), recentThemes: recentThemes.map(withProgress), markedThemes,
      hotThemes, pendingClassicThemes, fallbackThemes, newThemes, filteredThemes, searchKeywords, dailyThemes: themes.filter(t => t.category === 'daily' && !t.hidden),
      popularityReady: catalog.some(t => t.countKnown && t.userCount > 0) });
    this.buildDailyBlocks();
    this.updatePersonalThemes();
    if (this._timelineRaw) this.setData({ timelineRows: this._presentTimeline(this._timelineRaw, themes) });
    this.observeCards();
  },

  // ── 展示模式切换（封面 / 列表）——本地保留 ──
  onSwitchViewMode(e) {
    const mode = e.currentTarget.dataset.mode === 'list' ? 'list' : 'cover';
    if (mode === this.data.viewMode) return;
    this.setData({ viewMode: mode });
    wx.setStorageSync(VIEW_MODE_STORAGE_KEY, mode);
  },

  // ── 批量置顶管理 ──
  onOpenPinManager() {
    const pinnedIds = this.data.pinnedIds || [];
    const pinnedSet = new Set(pinnedIds);
    const all = (this.data.themes || []).filter(t => !t.hidden);
    // 已置顶的按 pinnedIds 顺序排在管理列表前面，方便查看/取消；其余保持网格原顺序
    const pinnedItems = [];
    pinnedIds.forEach(id => {
      const item = all.find(t => t.id === id);
      if (item) pinnedItems.push(item);
    });
    const rest = all.filter(t => !pinnedSet.has(t.id));
    const list = pinnedItems.concat(rest).map(t => ({
      id: t.id, title: t.title, tag: t.tag, pinned: pinnedSet.has(t.id)
    }));
    this.setData({ showPinManager: true, pinManagerList: list });
  },

  onClosePinManager() {
    this.setData({ showPinManager: false });
  },

  // 置顶面板打开时拦截 touchmove，防止手势穿透带动整页滚动（内部 scroll-view 照常滚动）
  onNoop() {},

  onTogglePinItem(e) {
    const id = e.currentTarget.dataset.id;
    const list = this.data.pinManagerList.map(it =>
      it.id === id ? { ...it, pinned: !it.pinned } : it
    );
    this.setData({ pinManagerList: list });
  },

  onSavePin() {
    // 只修改面板中明确呈现的选项。暂未加载的云端主题保留原位置，避免保存时丢失旧置顶。
    const choices = new Map(this.data.pinManagerList.map(it => [it.id, it.pinned]));
    const saved = wx.getStorageSync(PIN_STORAGE_KEY);
    const previous = Array.isArray(saved) ? saved : [];
    const retained = previous.filter(id => !choices.has(id) || choices.get(id));
    const pinnedIds = Array.from(new Set(retained.concat(this.data.pinManagerList.filter(it => it.pinned).map(it => it.id))));
    wx.setStorageSync(PIN_STORAGE_KEY, pinnedIds);
    this.setData({ pinnedIds, showPinManager: false });
    this.filterThemes(this.data.activeTab);
    wx.showToast({ title: '收藏已更新', icon: 'success' });
  },

  // 分类页卡片右上角星标：新收藏追加到末尾，取消只删这一项，其余顺序不动
  onToggleFavorite(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    const saved = wx.getStorageSync(PIN_STORAGE_KEY);
    const previous = Array.isArray(saved) ? saved : [];
    const on = !previous.includes(id);
    const pinnedIds = on ? previous.concat(id) : previous.filter(x => x !== id);
    wx.setStorageSync(PIN_STORAGE_KEY, pinnedIds);
    this.filterThemes(this.data.activeTab);
    wx.showToast({ title: on ? '已收藏' : '已取消收藏', icon: 'none' });
    track('hub_favorite', { theme: id, on: on ? 1 : 0, version: 'v1' });
  },

  // 妫€鏌ョ櫥褰曠姸鎬?
  checkLoginStatus() {
    const userInfo = userStore.getUserInfo();
    if (userInfo) {
      const openid = userInfo._openid || userInfo.openid || '';
      this.setData({
        userInfo: { ...userInfo, _openid: openid, openid },
        openid,
        pendingOpenid: ''
      });
    } else {
      this.setData({ userInfo: null, openid: '' });
    }
  },

  // 开始登录
  onGetUserProfile() {
    if (this.data.loading) return;
    this.setData({ loading: true });
    wx.showLoading({ title: '准备登录...' });

    wx.cloud.callFunction({
      name: 'getOpenid',
      success: ret => {
        const _openid = ret.result.openid;
        if (!_openid) {
          wx.hideLoading();
          this.setData({ loading: false });
          wx.showToast({ title: '获取 openid 失败', icon: 'none' });
          return;
        }
        wx.hideLoading();
        this.setData({
          loading: false,
          pendingOpenid: _openid,
          showAuthModal: true,
          tempAvatar: (this.data.userInfo && this.data.userInfo.avatarUrl) || '',
          tempNickname: (this.data.userInfo && this.data.userInfo.nickName) || ''
        });
      },
      fail: err => {
        console.error('获取 openid 失败:', err);
        wx.hideLoading();
        this.setData({ loading: false });
        wx.showToast({ title: '网络错误，请重试', icon: 'none' });
      }
    });
  },

  onCancelAuth() {
    this.setData({ showAuthModal: false, pendingOpenid: '' });
  },

  onChooseAvatar(e) {
    const { avatarUrl } = e.detail;
    this.setData({ tempAvatar: avatarUrl });
  },

  onNicknameInput(e) {
    this.setData({ tempNickname: e.detail.value });
  },

  async onConfirmAuth() {
    const { tempAvatar, tempNickname } = this.data;
    const openid = this.data.pendingOpenid || this.data.openid;
    if (!openid) {
      wx.showToast({ title: '请先完成登录', icon: 'none' });
      return;
    }
    if (!tempAvatar || tempAvatar === '/images/default-avatar.svg') {
      wx.showToast({ title: '请选择头像', icon: 'none' });
      return;
    }
    if (!tempNickname || !tempNickname.trim()) {
      wx.showToast({ title: '请输入昵称', icon: 'none' });
      return;
    }

    wx.showLoading({ title: '保存中...', mask: true });
    try {
      let finalAvatarUrl = tempAvatar;
      if (tempAvatar.startsWith('wxfile://') || tempAvatar.startsWith('http://tmp/')) {
        const ext = tempAvatar.split('.').pop() || 'png';
        const cloudPath = `avatars/${openid}_${Date.now()}.${ext}`;
        const uploadRes = await wx.cloud.uploadFile({
          cloudPath: cloudPath,
          filePath: tempAvatar
        });
        finalAvatarUrl = uploadRes.fileID;
      }

      const userInfo = {
        _openid: openid,
        nickName: tempNickname,
        avatarUrl: finalAvatarUrl
      };

      const db = wx.cloud.database();
      const userRes = await db.collection('users').where({ openid }).get();
      if (userRes.data.length === 0) {
        await db.collection('users').add({
          data: {
            openid: openid,
            nickname: userInfo.nickName,
            avatarUrl: userInfo.avatarUrl,
            created_at: new Date(),
            updated_at: new Date()
          }
        });
      } else {
        await db.collection('users').doc(userRes.data[0]._id).update({
          data: {
            nickname: userInfo.nickName,
            avatarUrl: userInfo.avatarUrl,
            updated_at: new Date()
          }
        });
      }

      userStore.setUserInfo(userInfo);
      this.setData({
        userInfo,
        openid,
        pendingOpenid: '',
        showAuthModal: false
      });
      wx.hideLoading();
      wx.showToast({ title: '登录成功', icon: 'success' });
    } catch (err) {
      console.error('保存用户信息失败:', err);
      wx.hideLoading();
      wx.showToast({ title: '保存失败，请重试', icon: 'none' });
    }
  },

  onLogout() {
    wx.showModal({
      title: '确认退出',
      content: '确定要退出登录吗？',
      success: (res) => {
        if (res.confirm) {
          userStore.clearUserInfo();
          this.setData({
            userInfo: null,
            openid: ''
          });
          wx.showToast({ title: '已退出登录', icon: 'success' });
        }
      }
    });
  },

  async loadUserCounts(force = false) {
    if (this._countsFlight) return this._countsFlight;
    this.setData({ statsState: 'loading' });
    this._countsFlight = (async () => {
      try {
        const stats = await hubStore.loadStats(force, updated => {
          if (this._pageUnloaded) return;
          this._stats = hubStats.merge(this._stats || hubStore.readStats(), updated);
          this.filterThemes(this.data.activeTab);
          this.setData({ statsState: this.data.hotThemes.length ? 'ready' : updated.needsRefresh && !updated.refreshPaused ? 'loading' : 'error' });
        });
        if (this._pageUnloaded) return;
        this._stats = hubStats.merge(this._stats || hubStore.readStats(), stats);
        this.filterThemes(this.data.activeTab);
        this.setData({ statsState: this.data.hotThemes.length ? 'ready' : stats && stats.needsRefresh && !stats.refreshPaused ? 'loading' : 'error' });
      } catch (error) {
        if (!this._pageUnloaded) this.setData({ statsState: this.data.hotThemes.length ? 'ready' : 'error' });
      }
    })().finally(() => { this._countsFlight = null; });
    return this._countsFlight;
  },

  onRetryUserCounts() { return this.loadUserCounts(true); },

  formatUserCount(count) { return hubModel.formatCount(count); },

  // ========== 骞垮憡 ==========
  initAds() {
    // 每次都重新取，不复用 data 里那份——data 的初始值是在模块加载时算的，
    // 那时免广告白名单可能还没判定完（首次加白的用户尤其）。
    const unitId = pageKind === 'home' ? (adConfig.getAdUnitId('category_native') || '') : '';
    // 「最新上线」上方的原生位，与底部原生位各自独立开关、各自失败隐藏
    const topUnitId = pageKind === 'home' ? (adConfig.getAdUnitId('home_top_native') || '') : '';
    const discoverUnitId = pageKind === 'discover' ? (adConfig.getAdUnitId('discover_tab_native') || '') : '';
    const profileUnitId = pageKind === 'profile' ? (adConfig.getAdUnitId('profile_top_native') || '') : '';
    this.setData({
      'adUnitIds.category_native': unitId,
      showNativeAd: !!unitId,
      'adUnitIds.home_top_native': topUnitId,
      showTopAd: !!topUnitId,
      'adUnitIds.discover_tab_native': discoverUnitId,
      showDiscoverAd: !!discoverUnitId,
      'adUnitIds.profile_top_native': profileUnitId,
      showProfileAd: !!profileUnitId,
    });
    this.syncAdFreePass();
  },

  // 通行证状态 → tips 条文案；生效中就按到期时间定一个闹钟，到点重新取广告位（广告恢复、tips 条变回邀请）
  syncAdFreePass() {
    const until = adConfig.getAdFreePassUntil();
    if (this._adFreePassTimer) { clearTimeout(this._adFreePassTimer); this._adFreePassTimer = null; }
    if (until && !this._pageUnloaded) {
      this._adFreePassTimer = setTimeout(() => {
        this._adFreePassTimer = null;
        if (!this._pageUnloaded) this.initAds();
      }, Math.max(0, until - Date.now()) + 1000);
    }
    if (pageKind !== 'home') return;
    const offer = !adConfig.isAdFree() && !!adConfig.getAdUnitId('adfree_pass_rewarded');
    const pad = n => (n < 10 ? '0' : '') + n;
    const d = until ? new Date(until) : null;
    this.setData({
      showAdFreeTip: !adConfig.isAdFree() && (!!until || offer),
      adFreePassUntilText: d ? pad(d.getHours()) + ':' + pad(d.getMinutes()) : '',
    });
  },

  // tips 条上的问号：说清哪些广告不在 30 分钟范围内（与 adConfig.getPlacement 跳过的激励位一一对应，
  // 封面广告是流量主后台配的开屏位，代码管不着）
  onAdFreeHelp() {
    wx.showModal({
      title: '30 分钟无页面广告',
      // 弹窗正文在真机上居中排版，项目符号列表居中后圆点参差不齐，所以写成三行长度相近的短句。
      // 用用户看得见的说法：页面上的广告 = banner / 原生，弹出的广告 = 插屏，开屏广告 = 封面广告
      content: '页面上的广告、弹出的广告都会暂停\n打开小程序时的开屏广告照常显示\n保存海报、填字换提示仍需看视频',
      showCancel: false,
      confirmText: '知道了',
    });
  },

  async onWatchAdFreeVideo() {
    if (this._adFreeWatching || this.data.adFreePassUntilText) return;
    this._adFreeWatching = true;
    try {
      const outcome = await rewardedAdManager.showForReward('adfree_pass_rewarded', this, '看完视频才能生效');
      track('adfree_pass', { result: outcome });
      if (outcome === 'watched') {
        adConfig.grantAdFreePass();
        this.initAds();
        wx.showToast({ title: '页面广告已关闭 30 分钟', icon: 'none' });
      } else if (outcome === 'failed') {
        wx.showToast({ title: '暂时没有可播放的视频，请稍后再试', icon: 'none' });
      }
    } catch (e) {
      wx.showToast({ title: '暂时没有可播放的视频，请稍后再试', icon: 'none' });
    } finally {
      this._adFreeWatching = false;
    }
  },

  onOpenTheme(e) {
    const id = e.currentTarget.dataset.id;
    const item = this.data.themes.find(t => t.id === id) || this.data.gameBlocks.find(t => t.key === id);
    if (!item || !item.url) return;
    hubStore.remember(hubModel.routeKey(item));
    track('hub_click', { page: pageKind, theme: id, module: e.currentTarget.dataset.module || 'catalog', version: 'v1' });
    wx.navigateTo({ url: item.url, fail: () => wx.showToast({ title: '暂时无法打开', icon: 'none' }) });
  },
  onGoDiscover(e) {
    const data = (e && e.currentTarget && e.currentTarget.dataset) || {};
    hubStore.switchTo('discover', { category: data.category || 'all', sort: data.sort || 'popular', query: data.query || '' });
  },
  onHomeSearch(e) { hubStore.switchTo('discover', { query: (e.detail && e.detail.value) || this.data.searchQuery || '' }); },
  onDiscoverSection(e) {
    const section = e.currentTarget.dataset.section;
    this.setData({ discoverSection: section });
    if (section === 'custom') this.loadCustomLists();
  },
  // 首次读显示「读取中」，之后（从编辑页回来等）静默刷新，读失败也保留已有卡片
  loadCustomLists() {
    if (this._customLoading) return this._customLoading;
    const first = this.data.customState !== 'ready';
    if (first) this.setData({ customState: 'loading', customError: '' });
    this._customLoading = customList.callList('mine').then(res => {
      if (!this._pageUnloaded) this.setData({ customCards: customList.buildCards(res.lists || [], res.quota), customState: 'ready', customError: '' });
    }, err => {
      if (!this._pageUnloaded && first) this.setData({ customState: 'error', customError: err.message || '网络异常，请重试' });
    }).then(() => { this._customLoading = null; });
    return this._customLoading;
  },
  _customCard(e) { return this.data.customCards.find(c => c.type === e.currentTarget.dataset.type); },
  onCustomOpen(e) { const card = this._customCard(e); if (card && card.list) wx.navigateTo({ url: customList.listUrl(card.list) }); },
  onCustomEdit(e) { const card = this._customCard(e); if (card && card.list) wx.navigateTo({ url: '/pages/customList/edit/edit?listId=' + card.list._id }); },
  onCustomCreate(e) { const card = this._customCard(e); if (card && card.canCreate) customList.promptCreate(card.type); },
  onPersonalTab(e) { this.setData({ personalTab: e.currentTarget.dataset.tab, personalExpanded: false }); this.updatePersonalThemes(); },
  onExpandPersonal() { this.setData({ personalExpanded: !this.data.personalExpanded }); this.updatePersonalThemes(); },
  updatePersonalThemes() {
    const rows = { common: this.data.commonThemes, recent: this.data.recentThemes, marked: this.data.markedThemes }[this.data.personalTab] || [];
    this.setData({ personalTotal: rows.length, personalThemes: this.data.personalExpanded ? rows : rows.slice(0, 3) });
  },
  async loadTimeline(more = false) {
    if (recordsLocked || this.data.timelineLoading) return;
    this.setData({ timelineLoading: true });
    try {
      await awaitOpenid();
      const result = await timeline.list(more ? this._timelineCursor : null);
      if (this._pageUnloaded) return;
      const rows = new Map((more ? this._timelineRaw || [] : []).map(r => [r.id, r]));
      result.rows.forEach(r => rows.set(r.id, r));
      this._timelineRaw = Array.from(rows.values()).sort((a, b) => b.at - a.at);
      if (!result.offline) this._timelineCursor = result.cursor;
      this.setData({ timelineRows: this._presentTimeline(this._timelineRaw, this.data.themes), timelineHasMore: !!result.hasMore, timelineOffline: !!result.offline });
    } catch (e) { if (!this._pageUnloaded) this.setData({ timelineOffline: true }); }
    finally { if (!this._pageUnloaded) this.setData({ timelineLoading: false }); }
  },
  onExpandTimeline(e) {
    const id = e.currentTarget.dataset.id;
    this._timelineRaw = (this._timelineRaw || []).map(row => row.id === id ? { ...row, expanded: !row.expanded } : row);
    this.setData({ timelineRows: this._presentTimeline(this._timelineRaw, this.data.themes) });
  },
  onPreviewTimelineImage(e) {
    const { id, key } = e.currentTarget.dataset;
    const row = this.data.timelineRows.find(item => item.id === id);
    if (!row) return;
    const item = row.items.find(item => item.key === Number(key));
    if (!item || !item.cover) return;
    wx.previewImage({ current: item.cover, urls: row.items.filter(item => item.cover).map(item => item.cover) });
  },
  onRetryTimeline() { return this.loadTimeline(); },
  onLoadMoreTimeline() { return this.loadTimeline(true); },
  onReachBottom() { if (pageKind === 'records' && this.data.timelineHasMore) this.loadTimeline(true); },
  onGoProfile() { hubStore.switchTo('profile', { personalTab: 'marked' }); },
  onGoHome() { hubStore.switchTo('home'); },
  // 时间轴记录没有封面时显示所属主题的线条图标（按 present 解析出的 themeId 找主题）
  _presentTimeline(raw, themes) {
    const byId = new Map((themes || []).map(t => [t.id, t]));
    return timeline.present(raw, themes).map(row => ({ ...row, themeIconKey: hubIcons.keyFor(byId.get(row.themeId)) }));
  },
  // 首页搜索框旁的「反馈」：页面由 open-type="feedback" 原生打开，这里只记点击量
  onFeedbackTap() { track('hub_click', { page: pageKind, theme: 'feedback', module: 'feedback', version: 'v1' }); },
  // 「期待上线」点赞：每点一次爱心弹一下 + 迸出一圈小爱心和 +1（类小红书点赞），次数本地累计并上报埋点
  // 屏幕上的总数 = 云端总数 + 本地还没报上去的次数，取整到百展示
  _renderWishLikes() {
    const mine = wishLike.readMine();
    this.setData({ wishLikes: mine.count, wishTotalText: wishLike.formatTotal((this._wishBase || 0) + mine.count - mine.sent) });
  },
  _flushWishLikes() {
    clearTimeout(this._wishTimer);
    this._wishTimer = null;
    wishLike.flush().then(total => {
      if (total == null) return;
      this._wishBase = total;
      if (!this._pageUnloaded) this._renderWishLikes();
    });
  },
  onWishLike() {
    const mine = wishLike.tap();
    if (!mine) {
      wx.showToast({ title: '今天的期待都收到啦，明天再来为它加油吧', icon: 'none', duration: 2200 });
      return;
    }
    // 埋点只记每人每天第一次，连点不灌水
    if (mine.count === 1) track('records_wish_like', { count: 1 });
    if (wx.vibrateShort) wx.vibrateShort({ type: 'light', fail() {} });
    const id = Date.now() + '_' + mine.count;
    // 两个同样的动画类交替切换，连点时每次都能重新触发
    this.setData({ likePop: this.data.likePop === 'like-pop-a' ? 'like-pop-b' : 'like-pop-a',
      likeBursts: this.data.likeBursts.concat({ id }).slice(-4) });
    this._renderWishLikes();
    // 停手 FLUSH_MS 后合成一次上报；点满当天上限就不用再等
    clearTimeout(this._wishTimer);
    this._wishTimer = setTimeout(() => this._flushWishLikes(), mine.count >= wishLike.LIMIT ? 0 : wishLike.FLUSH_MS);
    setTimeout(() => {
      if (this._pageUnloaded) return;
      this.setData({ likeBursts: this.data.likeBursts.filter(b => b.id !== id) });
    }, 900);
  },
  onSortChange(e) { this.setData({ sortMode: e.currentTarget.dataset.sort }); this.filterThemes(this.data.activeTab); },
  onEditProfile() { this.onGetUserProfile(); },
  onSubscriptions() { wx.openSetting({ withSubscriptions: true }); },
  onAbout() { wx.showModal({ title: '关于标记吧', content: '用清单发现好内容，用标记留下生活。记录电影、阅读与旅行，回顾并分享你的专属记录。', showCancel: false }); },
  async loadPersonalSummary() {
    try {
      const result = await hubStore.loadSummary();
      if (this._pageUnloaded) return;
      this.setData({ summaryRows: result.rows || {}, summaryState: result.partial ? 'partial' : 'ready' });
      this.filterThemes(this.data.activeTab);
    } catch (e) {
      if (!this._pageUnloaded) this.setData({ summaryState: 'error' });
    }
  },
  async onPullDownRefresh() {
    hubStore.invalidateSummary();
    try {
      const work = [this.loadCloudRegistry()];
      if (pageKind === 'home' || pageKind === 'discover') work.push(this.loadUserCounts(true));
      if (pageKind === 'profile') work.push(this.loadPersonalSummary());
      if (pageKind === 'records') work.push(this.loadTimeline());
      await Promise.allSettled(work);
      if (!this._pageUnloaded) this.filterThemes(this.data.activeTab);
    } finally { wx.stopPullDownRefresh(); }
  },
  observeCards() {
    if (!wx.createIntersectionObserver || this._pageUnloaded || (pageKind !== 'home' && pageKind !== 'discover')) return;
    if (this._cardObserver) this._cardObserver.disconnect();
    wx.nextTick(() => {
      if (this._pageUnloaded) return;
      try {
        this._seenCards = this._seenCards || new Set();
        this._cardObserver = wx.createIntersectionObserver(this, { observeAll: true });
        this._cardObserver.relativeToViewport().observe('.exposure-card', res => {
          if (res.intersectionRatio <= 0 || !res.dataset) return;
          const key = res.dataset.module + ':' + res.dataset.id;
          if (this._seenCards.has(key)) return;
          this._seenCards.add(key);
          track('hub_exposure', { page: pageKind, theme: res.dataset.id, module: res.dataset.module, version: 'v1' });
        });
      } catch (e) { /* Analytics must not block content. */ }
    });
  },

  onNativeAdLoad() {},
  onNativeAdError() {
    this.setData({ showNativeAd: false });
  },
  onTopAdLoad() {},
  onTopAdError() {
    this.setData({ showTopAd: false });
  },
  onDiscoverAdLoad() { this.setData({ discoverAdReady: true }); },
  onProfileAdLoad() { this.setData({ profileAdReady: true }); },
  onProfileAdError() { this.setData({ showProfileAd: false, profileAdReady: false }); },
  onDiscoverAdError() {
    this.setData({ showDiscoverAd: false, discoverAdReady: false });
  },
}; };
