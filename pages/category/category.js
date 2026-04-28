var adConfig = require('../../utils/adConfig')

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
    themeClass: '',
    showThemePicker: false,
    statusBarHeight: 20,
    headerPadTop: 0,
    // 骞垮憡鐩稿叧
    showNativeAd: false,
    showBannerAd: false,
    adUnitIds: {
      category_native: adConfig.getAdUnitId('category_native') || '',
      category_banner: adConfig.getAdUnitId('category_banner') || '',
    },
    themes: [
      {
        id: 'douban_books',
        title: '豆瓣读书 TOP250',
        description: '华语读者的经典书单，记录你的阅读旅程',
        image: '/images/cover-douban-books.jpg',
        userCount: 0,
        tag: '读书',
        category: 'reading',
        isNew: true,
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
    filteredThemes: []
  },

  onLoad() {
    // 鑷畾涔夊鑸細鑾峰彇鐘舵€佹爮楂樺害鍜岃兌鍥婃寜閽綅缃?
    const windowInfo = wx.getWindowInfo();
    const menuBtn = wx.getMenuButtonBoundingClientRect();
    // header paddingTop = 鑳跺泭鎸夐挳椤堕儴鐣欑櫧
    const headerPadTop = menuBtn.top;
    const savedTheme = wx.getStorageSync('appTheme') || 'theme-green';
    const app = getApp();
    app.globalData.theme = savedTheme;
    this.setData({
      statusBarHeight: windowInfo.statusBarHeight || 20,
      headerPadTop,
      themeClass: savedTheme
    });

    this.checkLoginStatus();
    this.filterThemes('all');
    this.loadUserCounts();
    this.initAds();
  },

  onShareAppMessage() {
    return {
      title: '标记吧，标记生活的仪式感，分享专属记录',
      path: '/pages/category/category'
    };
  },

  onShow() {
    this.checkLoginStatus();
    // 鏍煎紡鍖栫敤鎴锋暟閲忓苟杩囨护
    const themes = this.data.themes.map(theme => ({
      ...theme,
      userCountText: this.formatUserCount(theme.userCount)
    }));
    this.setData({ themes });
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

  filterThemes(tab) {
    const { themes } = this.data;
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
    const userInfo = wx.getStorageSync('userInfo');
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

  // 寮€濮嬬櫥褰?
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

    wx.showLoading({ title: '淇濆瓨涓?..', mask: true });
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

      wx.setStorageSync('userInfo', userInfo);
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
          wx.removeStorageSync('userInfo');
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
        { id: 'boxoffice_movies', collection: 'boxoffice_movies', topFiltered: true }
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
      console.error('鍔犺浇鑲插効缁熻澶辫触:', e);
    }


    this.setData({ themes });
    this.filterThemes(this.data.activeTab);
  },

  async _countThemeUsers(db, _, config) {
    // 1. 鑾峰彇璇ヤ富棰樻墍鏈夌數褰?ID
    const movieIds = [];
    let offset = 0;
    const limit = 100;
    while (true) {
      const whereCondition = config.topFiltered ? { isTop250: _.neq(false) } : {};
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
      const res = await db.collection('Marks').aggregate()
        .match({ movieId: _.in(movieIds) })
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
        const { total } = await db.collection('Marks')
          .where({ movieId: _.in(chunk) }).count();
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
    var ids = this.data.adUnitIds;
    // 浼樺厛灞曠ず鍘熺敓骞垮憡锛屾湁 unitId 鎵嶅皾璇?
    if (ids.category_native) {
      this.setData({ showNativeAd: true });
    }
    // Banner 浣滀负鍏滃簳锛屽師鐢熷箍鍛婂け璐ユ椂鏄剧ず
    if (ids.category_banner && !ids.category_native) {
      this.setData({ showBannerAd: true });
    }
  },

  onNativeAdLoad() {
    this.setData({ showNativeAd: true });
  },
  onNativeAdError() {
    this.setData({ showNativeAd: false });
    // 鍘熺敓骞垮憡澶辫触锛岄檷绾т负 Banner
    if (this.data.adUnitIds.category_banner) {
      this.setData({ showBannerAd: true });
    }
  },
  onBannerAdLoad() {
    this.setData({ showBannerAd: true });
  },
  onBannerAdError() {
    this.setData({ showBannerAd: false });
  },
});



