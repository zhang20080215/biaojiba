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
        userCount: 1234,
        color: '#409eff',
        tag: '电影',
        category: 'movie'
      },
      {
        id: 'imdb_movies',
        title: 'IMDb 电影 TOP250',
        description: '全球影迷票选，史上最高分250部电影',
        image: 'https://m.media-amazon.com/images/M/MV5BM2MyNjYxNmUtYTAwNi00MTYxLWJmNWYtYzZlODY3ZTk3OTFlXkEyXkFqcGdeQXVyNzkwMjQ5NzM@._V1_UX182_CR0,0,182,268_AL__QL50.jpg',
        userCount: 376,
        color: '#f5c518',
        tag: '电影',
        category: 'movie'
      },
      {
        id: 'oscar_movies',
        title: '历届奥斯卡最佳影片',
        description: '奥斯卡金像奖历年最佳，每年一部经典',
        image: 'https://img9.doubanio.com/view/photo/s_ratio_poster/public/p2876555451.jpg',
        userCount: 0,
        color: '#d4af37',
        tag: '电影',
        category: 'movie'
      },
      {
        id: 'boxoffice_movies',
        title: '全球电影票房榜',
        description: '全球票房最高的电影，见证影史商业传奇',
        image: 'https://img9.doubanio.com/view/photo/s_ratio_poster/public/p2180085848.jpg',
        userCount: 0,
        color: '#FF4757',
        tag: '电影',
        category: 'movie'
      },
      {
        id: 'child_growth',
        title: '儿童生长发育评估',
        description: '依据国家标准，精准评估0~7岁宝宝发育状况',
        image: '',
        userCount: 0,
        color: '#f59e0b',
        tag: '育儿',
        category: 'parenting'
      }
    ],
    filteredThemes: []
  },

  onLoad() {
    this.checkLoginStatus();
    this.filterThemes('all');
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

  formatUserCount(count) {
    if (count >= 1000) {
      return (count / 1000).toFixed(1) + 'k';
    }
    return count.toString();
  }
});
