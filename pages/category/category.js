Page({
  data: {
    userInfo: null,
    openid: '',
    loading: false,
    themes: [
      {
        id: 'douban_movies',
        title: '豆瓣电影TOP250',
        description: '电影海报墙分享',
        image: 'https://img1.doubanio.com/view/photo/s_ratio_poster/public/p480747492.jpg',
        userCount: 1234,
        color: '#409eff'
      },
      {
        id: 'books',
        title: '经典书籍收藏',
        description: '文学经典阅读记录',
        image: 'https://img1.doubanio.com/view/subject/s/public/s1070959.jpg',
        userCount: 856,
        color: '#67c23a'
      },
      {
        id: 'music',
        title: '音乐专辑收藏',
        description: '音乐作品收藏与评价',
        image: 'https://img1.doubanio.com/view/subject/s/public/s1070959.jpg',
        userCount: 642,
        color: '#e6a23c'
      },
      {
        id: 'games',
        title: '游戏收藏',
        description: '游戏作品体验记录',
        image: 'https://img1.doubanio.com/view/subject/s/public/s1070959.jpg',
        userCount: 423,
        color: '#f56c6c'
      },
      {
        id: 'travel',
        title: '旅行足迹',
        description: '旅行地点打卡记录',
        image: 'https://img1.doubanio.com/view/subject/s/public/s1070959.jpg',
        userCount: 789,
        color: '#909399'
      },
      {
        id: 'food',
        title: '美食收藏',
        description: '美食体验与评价',
        image: 'https://img1.doubanio.com/view/subject/s/public/s1070959.jpg',
        userCount: 567,
        color: '#ff9a9e'
      }
    ]
  },

  onLoad() {
    // 页面加载时的初始化
    this.checkLoginStatus();
  },

  onShow() {
    // 页面显示时检查登录状态
    this.checkLoginStatus();
    // 格式化用户数量显示
    const themes = this.data.themes.map(theme => ({
      ...theme,
      userCountText: this.formatUserCount(theme.userCount)
    }));
    this.setData({ themes });
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

  // 微信授权登录
  onGetUserProfile() {
    if (this.data.loading) return;
    
    this.setData({ loading: true });
    wx.showLoading({ title: '登录中...' });
    
    wx.getUserProfile({
      desc: '用于完善会员资料',
      success: res => {
        const userInfo = res.userInfo;
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
            userInfo._openid = _openid;
            this.setData({ userInfo, openid: _openid });
            wx.setStorageSync('userInfo', userInfo);
            // 注册用户
            const db = wx.cloud.database();
            db.collection('users').where({ openid: _openid }).get().then(res => {
              if (res.data.length === 0) {
                db.collection('users').add({
                  data: {
                    openid: _openid,
                    nickname: userInfo.nickName,
                    avatarUrl: userInfo.avatarUrl,
                    created_at: new Date(),
                    updated_at: new Date()
                  }
                }).catch(err => {
                  console.error('用户注册失败:', err);
                  wx.hideLoading();
                  this.setData({ loading: false });
                  wx.showToast({ title: '注册失败，请重试', icon: 'none' });
                });
              }
              wx.hideLoading();
              this.setData({ loading: false });
              wx.showToast({ title: '登录成功', icon: 'success' });
            }).catch(err => {
              console.error('查询用户失败:', err);
              wx.hideLoading();
              this.setData({ loading: false });
              wx.showToast({ title: '登录失败，请重试', icon: 'none' });
            });
          },
          fail: err => {
            console.error('获取openid失败:', err);
            wx.hideLoading();
            this.setData({ loading: false });
            wx.showToast({ title: '登录失败，请重试', icon: 'none' });
          }
        });
      },
      fail: err => {
        console.error('用户授权失败:', err);
        wx.hideLoading();
        this.setData({ loading: false });
        wx.showToast({ title: '授权失败', icon: 'none' });
      }
    });
  },

  // 退出登录
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

  // 点击主题卡片
  onThemeTap(e) {
    if (this.data.loading) return;
    
    const themeId = e.currentTarget.dataset.themeId;
    
    if (themeId === 'douban_movies') {
      // 跳转到豆瓣电影250标记页面（原来的首页）
      wx.navigateTo({
        url: '/pages/index/index'
      });
    } else {
      // 其他主题暂时显示开发中提示
      wx.showToast({
        title: '该主题正在开发中',
        icon: 'none',
        duration: 2000
      });
    }
  },

  // 格式化用户数量显示
  formatUserCount(count) {
    if (count >= 1000) {
      return (count / 1000).toFixed(1) + 'k';
    }
    return count.toString();
  },

});
