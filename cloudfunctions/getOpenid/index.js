// 云函数：getOpenid
const cloud = require('wx-server-sdk');

cloud.init({
  env: 'cloud1-3gn3wryx716919c6'  // 使用固定的环境ID
});

exports.main = async (event, context) => {
  try {
    const wxContext = cloud.getWXContext();
    console.log('wxContext:', wxContext); // 添加日志
    return {
      openid: wxContext.OPENID,
      appid: wxContext.APPID,
      unionid: wxContext.UNIONID,
    };
  } catch (err) {
    console.error('获取用户信息失败：', err);
    return {
      error: err.message || '获取用户信息失败'
    };
  }
};
