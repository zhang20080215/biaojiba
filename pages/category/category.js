Page({
  data: {
    userInfo: null,
    openid: '',
    loading: false,
    showAuthModal: false,
    tempAvatar: '',
    tempNickname: '',
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
        id: 'imdb_movies',
        title: 'IMDB电影TOP250',
        description: 'IMDB历史最高分250部电影',
        image: 'https://m.media-amazon.com/images/M/MV5BM2MyNjYxNmUtYTAwNi00MTYxLWJmNWYtYzZlODY3ZTk3OTFlXkEyXkFqcGdeQXVyNzkwMjQ5NzM@._V1_UX182_CR0,0,182,268_AL__QL50.jpg',
        userCount: 376,
        color: '#f5c518'
      },

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

  // 开始登录（获取openid并呼出弹窗）
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

  // 关闭授权弹窗
  onCancelAuth() {
    this.setData({ showAuthModal: false });
  },

  // 获取用户头像
  onChooseAvatar(e) {
    const { avatarUrl } = e.detail;
    this.setData({ tempAvatar: avatarUrl });
  },

  // 获取用户昵称
  onNicknameInput(e) {
    this.setData({ tempNickname: e.detail.value });
  },

  // 确认授权资料并保存
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
      // 如果头像是本地临时文件，需要上传到云存储
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

      // 注册或更新用户到数据库
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
      wx.navigateTo({ url: '/pages/douban/list/list' });
    } else if (themeId === 'imdb_movies') {
      wx.navigateTo({ url: '/pages/imdb/list/list' });
    } else {
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
