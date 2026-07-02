var adConfig = require('../../utils/adConfig')
var userStore = require('../../utils/userStore.js')

// 每日主题横排块的图标/底色/文字色（按主题 id）—— 暖调协调配色
var DAILY_BLOCK_META = {
  daily_movie: { emoji: '🎬', color: '#F6DED5', label: '#B05B43' }, // 暖陶土
  daily_read:  { emoji: '📖', color: '#E5EAD2', label: '#6E7B45' }, // 橄榄绿（呼应主题色）
  daily_sport: { emoji: '🏋️', color: '#DEE7FF', label: '#3F6AD6' }, // 清新蓝（呼应每日运动页风格）
  daily_water: { emoji: '💧', color: '#D8E7EC', label: '#3F7E93' }  // 雾蓝
};
var DAILY_BLOCK_SOON = { emoji: '✨', color: '#EFE9DD', label: '#A89B85' };

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
        id: 'oscar_cinematography_movies',
        title: '历届奥斯卡最佳摄影奖',
        description: '奥斯卡最佳摄影历年获奖，每年一部影像典范',
        image: '/images/cover-oscar-cinematography.webp',
        userCount: 0,
        tag: '电影',
        category: 'movie',
        isNew: true,
        wishFrom: 'And**',
        url: '/pages/oscarCinematography/list/list'
      },
      {
        id: 'daily_movie',
        title: '每日电影',
        description: '记录每天看过的电影，攒成年度片单',
        image: '/images/cover-daily-movie.webp',
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
        image: '/images/cover-oscar-anime.webp',
        userCount: 0,
        tag: '电影',
        category: 'movie',
        isNew: true,
        wishFrom: '安然**',
        url: '/pages/oscarAnime/list/list'
      },
      {
        id: 'movie_search_all_platforms',
        title: '全平台电影评分查询',
        description: '搜索任意电影，对比豆瓣 / IMDB / 烂番茄评分',
        image: '/images/cover-movie-search.webp',
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
        userCount: 0,
        tag: '读书',
        category: 'reading',
        url: '/pages/doubanBooks/list/list'
      },
      {
        id: 'douban_movies',
        title: '豆瓣电影 TOP250',
        description: '华语影迷的经典片单，记录你的观影旅程',
        image: '/images/cover-douban.jpg',
        userCount: 0,
        tag: '电影',
        category: 'movie',
        url: '/pages/douban/list/list'
      },
      {
        id: 'imdb_movies',
        title: 'IMDB电影 TOP250',
        description: '全球影迷票选，影史高分 250 部电影',
        image: '/images/cover-imdb.jpg',
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
        userCount: 0,
        tag: '电影',
        category: 'movie',
        url: '/pages/oscar/list/list'
      },
      {
        id: 'boxoffice_movies',
        title: '全球电影票房榜',
        description: '全球票房最高的电影，见证影史商业传奇',
        image: '/images/cover-boxoffice.jpg',
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

    this.checkLoginStatus();
    this.buildDailyBlocks();
    this.filterThemes('all');

    // 非关键数据加载延迟到首屏渲染后，避免拉长 onLoad 长任务
    wx.nextTick(() => {
      this.loadUserCounts();
      this.initAds();
    });
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
        data: { type: this.data.requestType, content }
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
        // 书线：marks 集合是 BookMarks，主键是 bookId，按 source 字段区分豆瓣/微信读书
        { id: 'douban_books', collection: 'douban_books', topFiltered: true, marksCollection: 'BookMarks', idField: 'bookId', source: 'douban' },
        { id: 'weread_books', collection: 'weread_books', topFiltered: true, marksCollection: 'BookMarks', idField: 'bookId', source: 'weread' }
      ];

    const themes = [...this.data.themes];

    // 骞惰缁熻姣忎釜涓婚鐨勭嫭绔嬬敤鎴锋暟
    const results = await Promise.allSettled(
      themeConfigs.map(config => this._countThemeUsers(db, _, config))
    );

    results.forEach((result, index) => {
      const themeIdx = themes.findIndex(t => t.id === themeConfigs[index].id);
      if (themeIdx === -1) return;
      const realUsers = result.status === 'fulfilled' ? result.value : 0;
      const displayCount = realUsers + 100;
      themes[themeIdx].userCount = displayCount;
      themes[themeIdx].userCountText = this.formatUserCount(displayCount);
    });

    // 鑲插効涓婚锛氫粠 growth_records 闆嗗悎缁熻鐙珛鐢ㄦ埛鏁?
    try {
      const growthRes = await db.collection('growth_records').aggregate()
        .match({ openid: _.exists(true) })
        .group({ _id: '$openid' })
        .count('total')
        .end();
      const growthUsers = growthRes.list.length > 0 ? growthRes.list[0].total : 0;
      const idx = themes.findIndex(t => t.id === 'child_growth');
      if (idx !== -1) {
        const displayCount = growthUsers + 100;
        themes[idx].userCount = displayCount;
        themes[idx].userCountText = this.formatUserCount(displayCount);
      }
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
      const idx = themes.findIndex(t => t.id === extraConfigs[i].id);
      if (idx === -1) return;
      const displayCount = realUsers + 100;
      themes[idx].userCount = displayCount;
      themes[idx].userCountText = this.formatUserCount(displayCount);
    });

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
      movieIds.push(...res.data.map(m => m._id));
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



