const fitnessTypes = require('../../../utils/fitnessTypes.js');

Page({
  data: {
    userInfo: null,
    showAuthModal: false,
    tempAvatar: '',
    tempNickname: '',
    openid: '',
    // 训练类型
    categories: fitnessTypes.categories,
    activeCategory: 'cardio',
    selectedType: null,
    // 动态字段
    duration: '',
    distance: '',
    sets: '',
    reps: '',
    weight: '',
    // 日期
    date: '',
    // 字段配置
    showDistance: false,
    distanceUnit: 'km',
    showStrength: false,
    showDuration: true
  },

  onLoad() {
    wx.setNavigationBarTitle({ title: '健身打卡' });
    this.checkLoginStatus();
    const today = this.formatDate(new Date());
    this.setData({ date: today });
  },

  onShow() {
    this.checkLoginStatus();
  },

  onShareAppMessage() {
    return {
      title: '健身打卡 - 记录每次训练，生成专属打卡海报',
      path: '/pages/fitness/input/input'
    };
  },

  formatDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  },

  checkLoginStatus() {
    const userInfo = wx.getStorageSync('userInfo');
    if (userInfo) {
      this.setData({ userInfo, openid: userInfo._openid });
    }
  },

  // 切换大类
  onCategoryTap(e) {
    const cat = e.currentTarget.dataset.category;
    this.setData({
      activeCategory: cat,
      selectedType: null,
      showDistance: false,
      showStrength: false,
      showDuration: cat === 'cardio',
      distanceUnit: 'km',
      duration: '',
      distance: '',
      sets: '',
      reps: '',
      weight: ''
    });
  },

  // 选择子类型
  onTypeTap(e) {
    const type = e.currentTarget.dataset.type;
    const config = fitnessTypes.getFieldConfig(type);
    this.setData({
      selectedType: type,
      showDistance: config.showDistance,
      distanceUnit: config.distanceUnit || 'km',
      showStrength: config.showStrength,
      showDuration: config.showDuration,
      duration: '',
      distance: '',
      sets: '',
      reps: '',
      weight: ''
    });
  },

  onDateChange(e) {
    this.setData({ date: e.detail.value });
  },

  onDurationInput(e) { this.setData({ duration: e.detail.value }); },
  onDistanceInput(e) { this.setData({ distance: e.detail.value }); },
  onSetsInput(e) { this.setData({ sets: e.detail.value }); },
  onRepsInput(e) { this.setData({ reps: e.detail.value }); },
  onWeightInput(e) { this.setData({ weight: e.detail.value }); },

  onSubmit() {
    if (!this.data.userInfo) {
      this.startLogin();
      return;
    }

    const { selectedType, activeCategory, duration, distance, sets, reps, weight, date, showDistance, showStrength, showDuration, distanceUnit } = this.data;

    if (!selectedType) {
      wx.showToast({ title: '请选择训练类型', icon: 'none' });
      return;
    }

    // 有氧验证
    if (showDuration) {
      const d = parseFloat(duration);
      if (!duration || isNaN(d) || d <= 0 || d > 600) {
        wx.showToast({ title: '请输入有效时长(1-600分钟)', icon: 'none' });
        return;
      }
    }
    if (showDistance) {
      const dist = parseFloat(distance);
      if (!distance || isNaN(dist) || dist <= 0) {
        wx.showToast({ title: '请输入有效距离', icon: 'none' });
        return;
      }
    }
    // 力量验证
    if (showStrength) {
      const s = parseInt(sets);
      const r = parseInt(reps);
      if (!sets || isNaN(s) || s <= 0 || s > 50) {
        wx.showToast({ title: '请输入有效组数(1-50)', icon: 'none' });
        return;
      }
      if (!reps || isNaN(r) || r <= 0 || r > 200) {
        wx.showToast({ title: '请输入有效次数(1-200)', icon: 'none' });
        return;
      }
    }

    const record = {
      category: activeCategory,
      type: selectedType,
      date: date,
      duration: showDuration ? parseFloat(duration) : null,
      distance: showDistance ? parseFloat(distance) : null,
      distanceUnit: showDistance ? distanceUnit : null,
      sets: showStrength ? parseInt(sets) : null,
      reps: showStrength ? parseInt(reps) : null,
      weight: (showStrength && weight) ? parseFloat(weight) : null
    };

    this.saveRecord(record);
  },

  async saveRecord(record) {
    wx.showLoading({ title: '保存中...', mask: true });
    try {
      const db = wx.cloud.database();
      await db.collection('fitness_records').add({
        data: {
          openid: this.data.openid,
          ...record,
          created_at: new Date()
        }
      });
      wx.hideLoading();
      wx.showToast({ title: '打卡成功！', icon: 'success' });

      // 跳转到分享页
      const app = getApp();
      app.globalData = app.globalData || {};
      app.globalData.fitnessRecord = record;
      app.globalData.fitnessUserInfo = this.data.userInfo;
      setTimeout(() => {
        wx.navigateTo({ url: '/pages/fitness/share/share' });
      }, 800);
    } catch (err) {
      console.error('保存训练记录失败:', err);
      wx.hideLoading();
      wx.showToast({ title: '保存失败，请重试', icon: 'none' });
    }
  },

  goToHistory() {
    if (!this.data.userInfo) {
      this.startLogin();
      return;
    }
    wx.navigateTo({ url: '/pages/fitness/history/history' });
  },

  // ========== 登录相关 ==========
  startLogin() {
    wx.cloud.callFunction({
      name: 'getOpenid',
      success: ret => {
        const _openid = ret.result.openid;
        if (!_openid) {
          wx.showToast({ title: '获取openid失败', icon: 'none' });
          return;
        }
        this.setData({
          openid: _openid,
          showAuthModal: true,
          tempAvatar: '',
          tempNickname: ''
        });
      },
      fail: () => {
        wx.showToast({ title: '网络错误，请重试', icon: 'none' });
      }
    });
  },

  onCancelAuth() {
    this.setData({ showAuthModal: false });
  },

  onChooseAvatar(e) {
    this.setData({ tempAvatar: e.detail.avatarUrl });
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
        const uploadRes = await wx.cloud.uploadFile({ cloudPath, filePath: tempAvatar });
        finalAvatarUrl = uploadRes.fileID;
      }

      const userInfo = { _openid: openid, nickName: tempNickname, avatarUrl: finalAvatarUrl };
      const db = wx.cloud.database();
      const userRes = await db.collection('users').where({ openid }).get();
      if (userRes.data.length === 0) {
        await db.collection('users').add({
          data: { openid, nickname: userInfo.nickName, avatarUrl: userInfo.avatarUrl, created_at: new Date(), updated_at: new Date() }
        });
      } else {
        await db.collection('users').doc(userRes.data[0]._id).update({
          data: { nickname: userInfo.nickName, avatarUrl: userInfo.avatarUrl, updated_at: new Date() }
        });
      }

      wx.setStorageSync('userInfo', userInfo);
      this.setData({ userInfo, showAuthModal: false });
      wx.hideLoading();
      wx.showToast({ title: '登录成功', icon: 'success' });
    } catch (err) {
      console.error('保存用户信息失败:', err);
      wx.hideLoading();
      wx.showToast({ title: '保存失败，请重试', icon: 'none' });
    }
  }
});
