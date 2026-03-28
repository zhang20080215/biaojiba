Page({
  data: {
    userInfo: null,
    openid: '',
    loading: false,
    showAuthModal: false,
    tempAvatar: '',
    tempNickname: '',
    activeTab: 'all',
    themes: [
      {
        id: 'douban_movies',
        title: '豆瓣电影 TOP250',
        description: '华语影迷的经典片单，记录你的观影旅程',
        image: 'https://img1.doubanio.com/view/photo/s_ratio_poster/public/p480747492.jpg',
        userCount: 0,
        color: '#5b9bd5',
        tag: '电影',
        category: 'movie',
        url: '/pages/douban/list/list'
      },
      {
        id: 'imdb_movies',
        title: 'IMDb 电影 TOP250',
        description: '全球影迷票选，史上最高分250部电影',
        image: 'https://m.media-amazon.com/images/M/MV5BM2MyNjYxNmUtYTAwNi00MTYxLWJmNWYtYzZlODY3ZTk3OTFlXkEyXkFqcGdeQXVyNzkwMjQ5NzM@._V1_UX182_CR0,0,182,268_AL__QL50.jpg',
        userCount: 0,
        color: '#e0a050',
        tag: '电影',
        category: 'movie',
        url: '/pages/imdb/list/list'
      },
      {
        id: 'oscar_movies',
        title: '历届奥斯卡最佳影片',
        description: '奥斯卡金像奖历年最佳，每年一部经典',
        image: 'https://img9.doubanio.com/view/photo/s_ratio_poster/public/p2876555451.jpg',
        userCount: 0,
        color: '#e0a050',
        tag: '电影',
        category: 'movie',
        url: '/pages/oscar/list/list'
      },
      {
        id: 'boxoffice_movies',
        title: '全球电影票房榜',
        description: '全球票房最高的电影，见证影史商业传奇',
        image: 'https://img9.doubanio.com/view/photo/s_ratio_poster/public/p2180085848.jpg',
        userCount: 0,
        color: '#e8707a',
        tag: '电影',
        category: 'movie',
        url: '/pages/boxoffice/list/list'
      },
      {
        id: 'child_growth',
        title: '儿童生长发育评估',
        description: '依据国家标准，精准评估0~7岁宝宝发育状况',
        image: '',
        userCount: 0,
        color: '#f0a050',
        tag: '育儿',
        category: 'parenting',
        url: '/pages/growth/input/input'
      }
    ],
    filteredThemes: []
  },

  onLoad() {
    wx.setNavigationBarTitle({ title: '标记吧——标记生活的仪式感' });
    this.checkLoginStatus();
    this.filterThemes('all');
    this.loadUserCounts();
  },

  onShareAppMessage() {
    return {
      title: '标记吧——标记生活的仪式感，分享专属记录',
      path: '/pages/category/category'
    };
  },

  onShow() {
    this.checkLoginStatus();
    // 格式化用户数量并过滤
    const themes = this.data.themes.map(theme => ({
      ...theme,
      userCountText: this.formatUserCount(theme.userCount)
    }));
    this.setData({ themes });
    this.filterThemes(this.data.activeTab);
  },

  // 分类Tab切换
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
    // 确保 userCountText 存在
    filtered = filtered.map(t => ({
      ...t,
      userCountText: t.userCountText || this.formatUserCount(t.userCount)
    }));
    this.setData({ filteredThemes: filtered });
  },

  // 检查登录状态
  checkLoginStatus() {
    const userInfo = wx.getStorageSync('userInfo');
    if (userInfo) {
      this.setData({
        userInfo: userInfo,
        openid: userInfo._openid
      });
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
          wx.showToast({ title: '获取openid失败', icon: 'none' });
          return;
        }
        wx.hideLoading();
        this.setData({
          loading: false,
          openid: _openid,
          showAuthModal: true,
          tempAvatar: '',
          tempNickname: ''
        });
      },
      fail: err => {
        console.error('获取openid失败:', err);
        wx.hideLoading();
        this.setData({ loading: false });
        wx.showToast({ title: '网络错误，请重试', icon: 'none' });
      }
    });
  },

  onCancelAuth() {
    this.setData({ showAuthModal: false });
  },

  onChooseAvatar(e) {
    const { avatarUrl } = e.detail;
    this.setData({ tempAvatar: avatarUrl });
  },

  onNicknameInput(e) {
    this.setData({ tempNickname: e.detail.value });
  },

  async onConfirmAuth() {
    const { tempAvatar, tempNickname, openid } = this.data;
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

      wx.setStorageSync('userInfo', userInfo);
      this.setData({
        userInfo,
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

  onThemeTap(e) {
    if (this.data.loading) return;
    const themeId = e.currentTarget.dataset.themeId;

    if (themeId === 'douban_movies') {
      wx.navigateTo({ url: '/pages/douban/list/list' });
    } else if (themeId === 'imdb_movies') {
      wx.navigateTo({ url: '/pages/imdb/list/list' });
    } else if (themeId === 'oscar_movies') {
      wx.navigateTo({ url: '/pages/oscar/list/list' });
    } else if (themeId === 'boxoffice_movies') {
      wx.navigateTo({ url: '/pages/boxoffice/list/list' });
    } else if (themeId === 'child_growth') {
      wx.navigateTo({ url: '/pages/growth/input/input' });
    } else {
      wx.showToast({ title: '该主题正在开发中', icon: 'none', duration: 2000 });
    }
  },

  async loadUserCounts() {
    const db = wx.cloud.database();
    const _ = db.command;
    const themeConfigs = [
      { id: 'douban_movies', collection: 'movies' },
      { id: 'imdb_movies', collection: 'imdb_movies' },
      { id: 'oscar_movies', collection: 'oscar_movies' },
      { id: 'boxoffice_movies', collection: 'boxoffice_movies' }
    ];

    const themes = [...this.data.themes];

    // 并行统计每个主题的独立用户数
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

    // 育儿主题：从 growth_records 集合统计独立用户数
    try {
      const growthRes = await db.collection('growth_records').aggregate()
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

    this.setData({ themes });
    this.filterThemes(this.data.activeTab);
  },

  async _countThemeUsers(db, _, config) {
    // 1. 获取该主题所有电影 ID
    const movieIds = [];
    let offset = 0;
    const limit = 100;
    while (true) {
      const res = await db.collection(config.collection)
        .skip(offset).limit(limit).field({ _id: true }).get();
      movieIds.push(...res.data.map(m => m._id));
      if (res.data.length < limit) break;
      offset += limit;
    }
    if (movieIds.length === 0) return 0;

    // 2. 聚合统计独立用户数
    try {
      const res = await db.collection('Marks').aggregate()
        .match({ movieId: _.in(movieIds) })
        .group({ _id: '$openid' })
        .count('total')
        .end();
      return res.list.length > 0 ? res.list[0].total : 0;
    } catch (e) {
      // 降级：计算标记总数 / 平均每人标记数
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
    // 向下取整到最近的100步长
    const stepped = Math.floor(count / 100) * 100;
    if (stepped >= 1000) {
      const k = stepped / 1000;
      return (k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)) + 'k';
    }
    return stepped + '+';
  }
});
