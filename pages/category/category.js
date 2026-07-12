var adConfig = require('../../utils/adConfig')
var userStore = require('../../utils/userStore.js')
var themeRegistry = require('../../utils/themeRegistry.js')

// 每日主题横排块的图标/底色/文字色（按主题 id）—— 暖调协调配色
var DAILY_BLOCK_META = {
  daily_movie: { emoji: '🎬', color: '#F6DED5', label: '#B05B43' }, // 暖陶土
  daily_read:  { emoji: '📖', color: '#E5EAD2', label: '#6E7B45' }, // 橄榄绿（呼应主题色）
  daily_sport: { emoji: '🏋️', color: '#DEE7FF', label: '#3F6AD6' }, // 清新蓝（呼应每日运动页风格）
  daily_water: { emoji: '💧', color: '#D8E7EC', label: '#3F7E93' }  // 雾蓝
};
var DAILY_BLOCK_SOON = { emoji: '✨', color: '#EFE9DD', label: '#A89B85' };

// 没有静态设计封面的主题：用榜单 rank=1 那部电影的封面做卡片图（整图铺满裁剪+主题色叠色，
// 见 category.wxss 的 .cover-tint）。主题色变体由各主题对象自带的 tintClass 决定
// ——加载/匹配失败前，category.wxml 里同 id 的 .cover-placeholder 兜底占位符照常显示。
var DYNAMIC_COVER_THEMES = [
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
  // collection 省略时默认 generic_theme_movies；读书通用主题（generic_theme_books）显式指定
  { id: 'maodun_books', theme: 'maodun', collection: 'generic_theme_books' },
  { id: 'newbery_books', theme: 'newbery', collection: 'generic_theme_books' }
];

Page({
  data: {
    userInfo: null,
    openid: '',
    pendingOpenid: '',
    loading: false,
    showAuthModal: false,
    tempAvatar: '',
    tempNickname: '',
    activeTab: 'all',
    dailyBlocks: [],
    themeClass: '',
    showThemePicker: false,
    statusBarHeight: 20,
    headerPadTop: 0,
    // 骞垮憡鐩稿叧
    showNativeAd: false,
    adUnitIds: {
      category_native: adConfig.getAdUnitId('category_native') || '',
    },
    themes: [
      {
        id: 'oscar_foreign_movies',
        title: '历届奥斯卡最佳外语片',
        description: '奥斯卡最佳国际影片历届获奖，看见世界各地的电影',
        image: '',
        tintClass: 'oscar-foreign',
        userCount: 0,
        tag: '奥斯卡',
        category: 'oscar',
        isNew: true,
        wishFrom: '伍**',
        url: '/pages/genericList/list/list?theme=oscarForeign'
      },
      {
        id: 'rt_action_movies',
        title: '史上最佳动作电影',
        description: '烂番茄评选史上最佳动作片，标记你的肾上腺素时刻',
        image: '',
        tintClass: 'rt-action',
        userCount: 0,
        tag: '电影',
        category: 'movie',
        isNew: true,
        wishFrom: '德**',
        url: '/pages/genericList/list/list?theme=rtAction'
      },
      {
        id: 'letterboxd500_movies',
        title: 'Letterboxd Top 500',
        description: 'Letterboxd 影迷评分最高 500 部电影，硬核影迷片单',
        image: '',
        tintClass: 'letterboxd500',
        userCount: 0,
        tag: '电影',
        category: 'movie',
        isNew: true,
        wishFrom: 'Be**',
        url: '/pages/genericList/list/list?theme=letterboxd500'
      },
      {
        id: 'palme_dor_movies',
        title: '历届金棕榈奖',
        description: '戛纳电影节历届金棕榈获奖影片，含届数·导演·国家',
        image: '',
        tintClass: 'palme',
        userCount: 0,
        tag: '电影',
        category: 'movie',
        isNew: true,
        url: '/pages/genericList/list/list?theme=palmeDor'
      },
      {
        id: 'oscar_screenplay_movies',
        title: '历届奥斯卡最佳原创剧本',
        description: '奥斯卡最佳原创剧本历届获奖，编剧功力的年度标杆',
        image: '',
        tintClass: 'oscar-screenplay',
        userCount: 0,
        tag: '奥斯卡',
        category: 'oscar',
        isNew: true,
        wishFrom: 'Mi**',
        url: '/pages/genericList/list/list?theme=oscarScreenplay'
      },
      {
        id: 'oscar_director_movies',
        title: '历届奥斯卡最佳导演',
        description: '奥斯卡最佳导演历届获奖，标记你看过的封神之作',
        image: '',
        tintClass: 'oscar-director',
        userCount: 0,
        tag: '奥斯卡',
        category: 'oscar',
        isNew: true,
        url: '/pages/genericList/list/list?theme=oscarDirector'
      },
      {
        id: 'oscar_vfx_movies',
        title: '历届奥斯卡最佳视觉效果',
        description: '奥斯卡最佳视觉效果历届获奖，大银幕的想象力天花板',
        image: '',
        tintClass: 'oscar-vfx',
        userCount: 0,
        tag: '奥斯卡',
        category: 'oscar',
        isNew: true,
        url: '/pages/genericList/list/list?theme=oscarVFX'
      },
      {
        id: 'oscar_actor_movies',
        title: '历届奥斯卡最佳男主角',
        description: '奥斯卡影帝历届获奖，标记你看过的封神演技',
        image: '',
        tintClass: 'oscar-actor',
        userCount: 0,
        tag: '奥斯卡',
        category: 'oscar',
        isNew: true,
        url: '/pages/genericList/list/list?theme=oscarActor'
      },
      {
        id: 'oscar_actress_movies',
        title: '历届奥斯卡最佳女主角',
        description: '奥斯卡影后历届获奖，标记你看过的高光时刻',
        image: '',
        tintClass: 'oscar-actress',
        userCount: 0,
        tag: '奥斯卡',
        category: 'oscar',
        isNew: true,
        url: '/pages/genericList/list/list?theme=oscarActress'
      },
      {
        id: 'maodun_books',
        title: '历届茅盾文学奖',
        description: '中国长篇小说最高荣誉，标记你读过的茅盾文学奖获奖作品',
        image: '',
        tintClass: 'maodun',
        userCount: 0,
        tag: '读书',
        category: 'reading',
        isNew: true,
        url: '/pages/genericBookList/list/list?theme=maodun'
      },
      {
        id: 'newbery_books',
        title: '纽伯瑞儿童文学金奖',
        description: '美国儿童文学最高荣誉，标记你读过的纽伯瑞金奖作品',
        image: '',
        tintClass: 'newbery',
        userCount: 0,
        tag: '读书',
        category: 'reading',
        isNew: true,
        url: '/pages/genericBookList/list/list?theme=newbery'
      },
      {
        id: 'douban_movies',
        title: '豆瓣电影 TOP250',
        description: '华语影迷的经典片单，记录你的观影旅程',
        image: '/images/cover-douban.jpg',
        tintClass: 'douban-movies',
        userCount: 0,
        tag: '电影',
        category: 'movie',
        url: '/pages/douban/list/list'
      },
      {
        id: 'oscar_cinematography_movies',
        title: '历届奥斯卡最佳摄影奖',
        description: '奥斯卡最佳摄影历年获奖，每年一部影像典范',
        image: '/images/cover-oscar-cinematography.jpg',
        tintClass: 'oscar-cinema',
        userCount: 0,
        tag: '奥斯卡',
        category: 'oscar',
        isNew: true,
        wishFrom: 'And**',
        url: '/pages/genericList/list/list?theme=oscarCinematography'
      },
      {
        id: 'rt_horror_movies',
        title: '史上最佳恐怖电影',
        description: '烂番茄评选史上最佳200部恐怖片，标记你的胆量',
        image: '',
        tintClass: 'rt-horror',
        userCount: 0,
        tag: '电影',
        category: 'movie',
        isNew: true,
        url: '/pages/genericList/list/list?theme=rtHorror'
      },
      {
        id: 'rt_war_movies',
        title: '史上最佳战争电影',
        description: '烂番茄评选史上最佳150部战争片，铭记历史与人性',
        image: '',
        tintClass: 'rt-war',
        userCount: 0,
        tag: '电影',
        category: 'movie',
        isNew: true,
        url: '/pages/genericList/list/list?theme=rtWar'
      },
      {
        id: 'rt_animation_movies',
        title: '史上最佳动画电影',
        description: '烂番茄评选史上最佳动画长片，重温童心与想象',
        image: '',
        tintClass: 'rt-animation',
        userCount: 0,
        tag: '电影',
        category: 'movie',
        isNew: true,
        url: '/pages/genericList/list/list?theme=rtAnimation'
      },
      {
        id: 'daily_movie',
        title: '每日电影',
        description: '记录每天看过的电影，攒成年度片单',
        image: '/images/cover-daily-movie.jpg',
        tintClass: 'daily-movie',
        userCount: 0,
        tag: '每日',
        category: 'daily',
        isNew: true,
        url: '/pages/daily/movie/index'
      },
      {
        id: 'daily_read',
        title: '每日读书',
        description: '记录每天读过的书，攒成年度书单',
        image: '/images/cover-douban-books.jpg',
        tintClass: 'daily-read',
        userCount: 0,
        tag: '每日',
        category: 'daily',
        isNew: true,
        url: '/pages/daily/read/index'
      },
      {
        id: 'daily_sport',
        title: '每日运动',
        description: '记录每次训练，坚持养成习惯',
        image: '',
        userCount: 0,
        tag: '每日',
        category: 'daily',
        isNew: true,
        url: '/pages/daily/sport/index'
      },
      {
        id: 'oscar_anime_movies',
        title: '历届奥斯卡最佳动画长篇',
        description: '奥斯卡最佳动画长篇历年获奖，每年一部经典动画',
        image: '/images/cover-oscar-anime.jpg',
        tintClass: 'oscar-anime',
        userCount: 0,
        tag: '奥斯卡',
        category: 'oscar',
        isNew: true,
        wishFrom: '安然**',
        url: '/pages/genericList/list/list?theme=oscarAnime'
      },
      {
        id: 'movie_search_all_platforms',
        title: '全平台电影评分查询',
        description: '搜索任意电影，对比豆瓣 / IMDB / 烂番茄评分',
        image: '/images/cover-movie-search.jpg',
        tintClass: 'movie-search',
        userCount: 0,
        tag: '电影',
        category: 'movie',
        isNew: true,
        url: '/pages/movie-search/input/input'
      },
      {
        id: 'daily_water',
        title: '每日喝水',
        description: '记录每日饮水量，养成健康习惯',
        image: '',
        userCount: 0,
        tag: '每日',
        category: 'daily',
        isNew: true,
        url: '/pages/daily/index/index?theme=water'
      },
      {
        id: 'weread_books',
        title: '微信读书 TOP200 总榜',
        description: '微信读书全平台热榜，记录你的阅读旅程',
        image: '/images/cover-weread-santi.png',
        imageMode: 'center',  // 不拉伸，按原图大小居中显示
        tintClass: 'weread',
        userCount: 0,
        tag: '读书',
        category: 'reading',
        url: '/pages/weread/list/list'
      },
      {
        id: 'douban_books',
        title: '豆瓣读书 TOP250',
        description: '华语读者的经典书单，记录你的阅读旅程',
        image: '/images/cover-douban-books.jpg',
        tintClass: 'douban-books',
        userCount: 0,
        tag: '读书',
        category: 'reading',
        url: '/pages/doubanBooks/list/list'
      },
      {
        id: 'imdb_movies',
        title: 'IMDB电影 TOP250',
        description: '全球影迷票选，影史高分 250 部电影',
        image: '/images/cover-imdb.jpg',
        tintClass: 'imdb',
        userCount: 0,
        tag: '电影',
        category: 'movie',
        url: '/pages/imdb/list/list'
      },
      {
        id: 'oscar_movies',
        title: '历届奥斯卡最佳影片',
        description: '奥斯卡金像奖历年最佳，每年一部经典',
        image: '/images/cover-oscar.jpg',
        tintClass: 'oscar-best',
        userCount: 0,
        tag: '奥斯卡',
        category: 'oscar',
        url: '/pages/oscar/list/list'
      },
      {
        id: 'boxoffice_movies',
        title: '全球电影票房榜',
        description: '全球票房最高的电影，见证影史商业传奇',
        image: '/images/cover-boxoffice.jpg',
        tintClass: 'boxoffice',
        userCount: 0,
        tag: '电影',
        category: 'movie',
        url: '/pages/boxoffice/list/list'
      },
      // {
      //   id: 'chinese_awards',
      //   title: '华语电影最高荣誉殿堂',
      //   description: '金马、金像、金鸡、百花四大奖项历年最佳影片',
      //   image: 'https://img9.doubanio.com/view/photo/s_ratio_poster/public/p2557573348.jpg',
      //   userCount: 0,
      //   tag: '电影',
      //   category: 'movie',
      //   url: '/pages/chinese-awards/list/list'
      // },
      {
        id: 'child_growth',
        title: '儿童生长发育评估',
        description: '依据国家标准，精准评估 0~7 岁宝宝发育状况',
        image: '',
        userCount: 0,
        tag: '育儿',
        category: 'parenting',
        url: '/pages/growth/input/input'
      }
    ],
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
    const savedTheme = getApp().globalData.theme || 'theme-green';
    this.setData({
      statusBarHeight: windowInfo.statusBarHeight || 20,
      headerPadTop,
      themeClass: savedTheme
    });

    // 云端注册表：先用本地缓存的新主题即时合入卡片（无网络等待），稍后 loadCloudRegistry 再拉最新
    this._mergeCloudThemes(themeRegistry.readAll());

    this.checkLoginStatus();
    this.buildDailyBlocks();
    this.filterThemes('all');

    // 非关键数据加载延迟到首屏渲染后，避免拉长 onLoad 长任务
    wx.nextTick(() => {
      this.loadCloudRegistry();
      this.loadUserCounts();
      this.loadDynamicCovers();
      this.initAds();
    });
  },

  // ── 云端主题注册表（不用发版上新书单/影单）──
  // 拉取最新注册表 → 写本地缓存 → 合入卡片；失败则维持缓存/硬编码兜底，分类页照常。
  async loadCloudRegistry() {
    try {
      const res = await wx.cloud.callFunction({ name: 'getThemeRegistry', data: {} });
      const result = res && res.result;
      if (!result || !result.success || !Array.isArray(result.themes)) return;
      themeRegistry.writeAll(result.themes);
      const added = this._mergeCloudThemes(result.themes);
      if (added) {
        // 新合入的云端主题补封面和参与人数
        this.loadDynamicCovers();
        this.loadUserCounts();
      }
    } catch (e) {
      console.warn('加载云端主题注册表失败', e);
    }
  },

  // 把注册表文档构建成卡片并「前插」进 this.data.themes（按 id 去重，重复调用幂等）。
  // 返回是否有新卡片合入。云端主题文档同时缓存在 this._cloudThemeDocs 供封面/人数派生。
  _mergeCloudThemes(docs) {
    if (!Array.isArray(docs) || docs.length === 0) return false;
    this._cloudThemeDocs = docs;
    const existingIds = new Set((this.data.themes || []).map(t => t.id));
    const newCards = docs
      .filter(d => d && d.theme && d.cardId && !existingIds.has(d.cardId))
      .sort((a, b) => (a.order || 0) - (b.order || 0))
      .map(d => this._buildCloudCard(d));
    if (newCards.length === 0) return false;
    // 前插：新主题排在网格最前，利于曝光
    const themes = newCards.concat(this.data.themes || []);
    this.setData({ themes });
    this.filterThemes(this.data.activeTab);
    return true;
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
      image: '',
      tintClass: '',
      // 云端主题没有对应 wxss class，配色走内联 style
      tintStyle: `background: linear-gradient(135deg, ${soft}80 0%, ${primary}80 100%);`,
      coverStyle: `background: linear-gradient(135deg, ${soft} 0%, ${primary} 100%);`,
      placeholderEmoji: d.placeholderEmoji || (isBook ? '📖' : '🎬'),
      userCount: 0,
      userCountText: this.formatUserCount(0),
      tag: d.tag || (isBook ? '读书' : '电影'),
      category: d.category || (isBook ? 'reading' : 'movie'),
      isNew: !!d.newBadge,
      newBadge: !!d.newBadge,
      wishFrom: d.wishFrom || '',
      url: base + d.theme,
      _cloud: true,
      _theme: d.theme,
      _collection: isBook ? 'generic_theme_books' : 'generic_theme_movies',
      _source: d.source || d.theme
    };
  },

  // 没有静态设计封面的主题：拉一次各自榜单 rank=1 的封面，拼成卡片图
  async loadDynamicCovers() {
    const db = wx.cloud.database();
    // 硬编码老主题 + 云端注册表新主题，都用各自榜单 rank=1 的封面做卡片图
    const cloudDyn = (this._cloudThemeDocs || []).map(d => ({
      id: d.cardId, theme: d.theme, collection: d.type === 'book' ? 'generic_theme_books' : 'generic_theme_movies'
    }));
    const dynList = DYNAMIC_COVER_THEMES.concat(cloudDyn);
    const results = await Promise.allSettled(
      dynList.map(cfg =>
        db.collection(cfg.collection || 'generic_theme_movies')
          .where({ theme: cfg.theme, rank: 1 })
          .field({ cover: true })
          .limit(1)
          .get()
      )
    );

    const covers = {};
    results.forEach((result, i) => {
      const cfg = dynList[i];
      if (result.status !== 'fulfilled') return;
      const doc = result.value.data && result.value.data[0];
      if (!doc || !doc.cover) return; // 没匹配到就让占位符继续兜底
      covers[cfg.id] = { cover: doc.cover };
    });
    if (Object.keys(covers).length === 0) return;

    // 现读 this.data.themes 再合并，而不是用调用开始时的旧快照 —— 避免跟 loadUserCounts()
    // 并发写入时互相用过时快照覆盖对方刚写的字段（比如把这里刚写的 dynamicCover 冲掉）
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
    // 首次 show 紧随 onLoad，主题/卡片已构建，跳过重复 rebuild
    if (this._firstShow) {
      this._firstShow = false;
      return;
    }
    // 鏍煎紡鍖栫敤鎴锋暟閲忓苟杩囨护
    const themes = this.data.themes.map(theme => ({
      ...theme,
      userCountText: this.formatUserCount(theme.userCount)
    }));
    this.setData({ themes });
    this.buildDailyBlocks();
    this.filterThemes(this.data.activeTab);
  },

  // 涓婚鍒囨崲
  onToggleThemePicker() {
    this.setData({ showThemePicker: !this.data.showThemePicker });
  },

  onThemeSelect(e) {
    const theme = e.currentTarget.dataset.theme;
    const app = getApp();
    app.globalData.theme = theme;
    wx.setStorageSync('appTheme', theme);
    this.setData({ themeClass: theme, showThemePicker: false });
  },

  // 鍒嗙被Tab鍒囨崲
  onTabTap(e) {
    const tab = e.currentTarget.dataset.tab;
    this.setData({ activeTab: tab });
    this.filterThemes(tab);
  },

  // 每日主题独立成顶部横排块（最多 4 个真实；不足 4 个时补「敬请期待」），不进下方卡片网格
  buildDailyBlocks() {
    const daily = (this.data.themes || []).filter(t => t.category === 'daily').slice(0, 4);
    const blocks = daily.map(t => {
      const meta = DAILY_BLOCK_META[t.id] || DAILY_BLOCK_SOON;
      return { key: t.id, id: t.id, title: t.title, url: t.url, emoji: meta.emoji, color: meta.color, label: meta.label, placeholder: false };
    });
    if (blocks.length < 4) {
      blocks.push({ key: 'soon', title: '敬请期待', emoji: DAILY_BLOCK_SOON.emoji, color: DAILY_BLOCK_SOON.color, label: DAILY_BLOCK_SOON.label, placeholder: true });
    }
    this.setData({ dailyBlocks: blocks });
  },

  filterThemes(tab) {
    // 每日主题已独立到顶部横排块，下方网格只放非 daily 主题
    const themes = (this.data.themes || []).filter(t => t.category !== 'daily');
    let filtered;
    if (tab === 'all') {
      filtered = themes;
    } else {
      filtered = themes.filter(t => t.category === tab);
    }
    // 纭繚 userCountText 瀛樺湪
    filtered = filtered.map(t => ({
      ...t,
      userCountText: t.userCountText || this.formatUserCount(t.userCount)
    }));
    this.setData({ filteredThemes: filtered });
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
          tempAvatar: '',
          tempNickname: ''
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

  async loadUserCounts() {
    const db = wx.cloud.database();
    const _ = db.command;
      const themeConfigs = [
        { id: 'douban_movies', collection: 'movies', topFiltered: true },
        { id: 'imdb_movies', collection: 'imdb_movies', topFiltered: true },
        { id: 'oscar_movies', collection: 'oscar_movies', topFiltered: false },
        { id: 'oscar_anime_movies', collection: 'oscar_anime_movies', topFiltered: false },
        { id: 'boxoffice_movies', collection: 'boxoffice_movies', topFiltered: true },
        { id: 'oscar_cinematography_movies', collection: 'generic_theme_movies', theme: 'oscarCinematography', topFiltered: false },
        { id: 'rt_horror_movies', collection: 'generic_theme_movies', theme: 'rtHorror', topFiltered: false },
        { id: 'rt_war_movies', collection: 'generic_theme_movies', theme: 'rtWar', topFiltered: false },
        { id: 'rt_animation_movies', collection: 'generic_theme_movies', theme: 'rtAnimation', topFiltered: false },
        { id: 'palme_dor_movies', collection: 'generic_theme_movies', theme: 'palmeDor', topFiltered: false },
        { id: 'oscar_screenplay_movies', collection: 'generic_theme_movies', theme: 'oscarScreenplay', topFiltered: false },
        { id: 'oscar_foreign_movies', collection: 'generic_theme_movies', theme: 'oscarForeign', topFiltered: false },
        { id: 'oscar_director_movies', collection: 'generic_theme_movies', theme: 'oscarDirector', topFiltered: false },
        { id: 'oscar_vfx_movies', collection: 'generic_theme_movies', theme: 'oscarVFX', topFiltered: false },
        { id: 'oscar_actor_movies', collection: 'generic_theme_movies', theme: 'oscarActor', topFiltered: false },
        { id: 'oscar_actress_movies', collection: 'generic_theme_movies', theme: 'oscarActress', topFiltered: false },
        { id: 'rt_action_movies', collection: 'generic_theme_movies', theme: 'rtAction', topFiltered: false },
        { id: 'letterboxd500_movies', collection: 'generic_theme_movies', theme: 'letterboxd500', topFiltered: false },
        // 书线：marks 集合是 BookMarks，主键是 bookId，按 source 字段区分豆瓣/微信读书/各通用读书主题
        { id: 'douban_books', collection: 'douban_books', topFiltered: true, marksCollection: 'BookMarks', idField: 'bookId', source: 'douban' },
        { id: 'weread_books', collection: 'weread_books', topFiltered: true, marksCollection: 'BookMarks', idField: 'bookId', source: 'weread' },
        { id: 'maodun_books', collection: 'generic_theme_books', theme: 'maodun', topFiltered: false, marksCollection: 'BookMarks', idField: 'bookId', source: 'maodun' },
        { id: 'newbery_books', collection: 'generic_theme_books', theme: 'newbery', topFiltered: false, marksCollection: 'BookMarks', idField: 'bookId', source: 'newbery' }
      ];

    // 云端注册表新主题：按 type 拼参与人数统计配置（电影走 Marks，书走 BookMarks）
    (this._cloudThemeDocs || []).forEach(d => {
      if (!d || !d.cardId || !d.theme) return;
      if (d.type === 'book') {
        themeConfigs.push({ id: d.cardId, collection: 'generic_theme_books', theme: d.theme, topFiltered: false, marksCollection: 'BookMarks', idField: 'bookId', source: d.source || d.theme });
      } else {
        themeConfigs.push({ id: d.cardId, collection: 'generic_theme_movies', theme: d.theme, topFiltered: false });
      }
    });

    // 按 id 收集统计增量，最后统一合并到 this.data.themes —— 不持有调用开始时的旧快照，
    // 避免跟 loadDynamicCovers() 并发写入时互相用过时快照覆盖对方刚写的字段
    const countUpdates = {};

    // 骞惰缁熻姣忎釜涓婚鐨勭嫭绔嬬敤鎴锋暟
    const results = await Promise.allSettled(
      themeConfigs.map(config => this._countThemeUsers(db, _, config))
    );

    results.forEach((result, index) => {
      const realUsers = result.status === 'fulfilled' ? result.value : 0;
      const displayCount = realUsers + 100;
      countUpdates[themeConfigs[index].id] = { userCount: displayCount, userCountText: this.formatUserCount(displayCount) };
    });

    // 鑲插効涓婚锛氫粠 growth_records 闆嗗悎缁熻鐙珛鐢ㄦ埛鏁?
    try {
      const growthRes = await db.collection('growth_records').aggregate()
        .match({ openid: _.exists(true) })
        .group({ _id: '$openid' })
        .count('total')
        .end();
      const growthUsers = growthRes.list.length > 0 ? growthRes.list[0].total : 0;
      const displayCount = growthUsers + 100;
      countUpdates['child_growth'] = { userCount: displayCount, userCountText: this.formatUserCount(displayCount) };
    } catch (e) {
      console.error('加载育儿统计失败:', e);
    }

    // 每日喝水 / 每日电影：DailyLogs 按 theme 统计独立用户；全平台评分查询：user_movie_queries 统计独立用户
    const countDistinctOpenid = async (collection, match) => {
      try {
        const res = await db.collection(collection).aggregate()
          .match(match)
          .group({ _id: '$openid' })
          .count('total')
          .end();
        return res.list.length > 0 ? res.list[0].total : 0;
      } catch (e) {
        console.error('统计独立用户失败:', collection, e);
        return 0;
      }
    };
    const extraConfigs = [
      { id: 'daily_water', collection: 'DailyLogs', match: { theme: 'water', openid: _.exists(true) } },
      { id: 'daily_movie', collection: 'DailyLogs', match: { theme: 'movie', openid: _.exists(true) } },
      { id: 'movie_search_all_platforms', collection: 'user_movie_queries', match: { openid: _.exists(true) } }
    ];
    const extraResults = await Promise.all(
      extraConfigs.map(cfg => countDistinctOpenid(cfg.collection, cfg.match))
    );
    extraResults.forEach((realUsers, i) => {
      const displayCount = realUsers + 100;
      countUpdates[extraConfigs[i].id] = { userCount: displayCount, userCountText: this.formatUserCount(displayCount) };
    });

    const themes = this.data.themes.map(t => countUpdates[t.id] ? { ...t, ...countUpdates[t.id] } : t);
    this.setData({ themes });
    this.filterThemes(this.data.activeTab);
  },

  async _countThemeUsers(db, _, config) {
    const marksCollection = config.marksCollection || 'Marks';
    const idField = config.idField || 'movieId';
    const buildMatch = (ids) => {
      const m = { [idField]: _.in(ids) };
      if (config.source === 'weread') {
        m.source = 'weread';
      } else if (config.source === 'douban') {
        // 兼容老 BookMarks 记录无 source 字段（视为 douban）
        m.source = _.or([_.eq('douban'), _.exists(false)]);
      } else if (config.source) {
        // 各通用读书主题（generic_theme_books）自己的 source 值，精确匹配即可——
        // bookId 已按主题前缀天然隔离，这里加过滤只是让统计口径更严谨
        m.source = config.source;
      }
      return m;
    };
    // 1. 鑾峰彇璇ヤ富棰樻墍鏈夌數褰?ID
    const movieIds = [];
    let offset = 0;
    const limit = 100;
    while (true) {
      // topFiltered=false 的集合（如 oscar_movies）没有 isTop250 可筛，但也不能用空 where（会触发"全量扫表"告警）；
      // 用 _id 存在判断：_id 是默认索引字段，等价于"取全部"，但走索引、不算空查询。
      const whereCondition = config.topFiltered ? { isTop250: _.neq(false) } : { _id: _.exists(true) };
      // 共享集合（generic_theme_movies）走 enrichThemeMovies 灌入的新主题，多传一个 theme 精确过滤
      if (config.theme) whereCondition.theme = config.theme;
      const res = await db.collection(config.collection)
        .where(whereCondition)
        .skip(offset).limit(limit).field({ _id: true }).get();
      res.data.forEach(m => movieIds.push(m._id));
      if (res.data.length < limit) break;
      offset += limit;
    }
    if (movieIds.length === 0) return 0;

    // 2. 鑱氬悎缁熻鐙珛鐢ㄦ埛鏁?
    try {
      const res = await db.collection(marksCollection).aggregate()
        .match(buildMatch(movieIds))
        .group({ _id: '$openid' })
        .count('total')
        .end();
      return res.list.length > 0 ? res.list[0].total : 0;
    } catch (e) {
      // 闄嶇骇锛氳绠楁爣璁版€绘暟 / 骞冲潎姣忎汉鏍囪鏁?
      let markCount = 0;
      const chunkSize = 100;
      for (let i = 0; i < movieIds.length; i += chunkSize) {
        const chunk = movieIds.slice(i, i + chunkSize);
        const { total } = await db.collection(marksCollection)
          .where(buildMatch(chunk)).count();
        markCount += total;
      }
      return Math.ceil(markCount / 3);
    }
  },

  formatUserCount(count) {
    // 鍚戜笅鍙栨暣鍒版渶杩戠殑100姝ラ暱
    const stepped = Math.floor(count / 100) * 100;
    if (stepped >= 1000) {
      const k = stepped / 1000;
      return (k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)) + 'k';
    }
    return stepped + '+';
  },

  // ========== 骞垮憡 ==========
  initAds() {
    if (this.data.adUnitIds.category_native) {
      this.setData({ showNativeAd: true });
    }
  },

  onNativeAdLoad() {},
  onNativeAdError() {
    this.setData({ showNativeAd: false });
  },
});



