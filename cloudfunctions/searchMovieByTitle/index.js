// 入参: { keyword: string }
// 调豆瓣 j/subject_suggest 拿候选列表，只保留 type=movie 的项
// 返回: { success, candidates: [{doubanId, title, year, posterUrl, subtype, director, url}] }
//
// 注：subject_suggest 的 sub_title 经常不带导演（仅"年/国/类"3 段），
// 之前尝试用 rexxar 详情补 director，但代价是搜索 +1.5~2s，已去掉。
// 现在只用 sub_title 第 4 段解析 director，解析不出来就空，候选卡只显示标题+年份。
// 用户点"查询评分"后进 detail 页能拿到完整 director。

const cloud = require('wx-server-sdk');
const axios = require('axios');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const COMMON_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/91.0',
  'Referer': 'https://movie.douban.com/'
};

function pickDirectorFromSubTitle(subTitle) {
  if (!subTitle) return '';
  const parts = String(subTitle).split('/').map(s => s.trim()).filter(Boolean);
  if (parts.length < 4) return '';
  const candidate = parts[3];
  if (/^\d{4}$/.test(candidate)) return '';
  return candidate;
}

exports.main = async (event, context) => {
  const keyword = (event && event.keyword || '').trim();
  if (!keyword) {
    return { success: false, error: 'EMPTY_KEYWORD' };
  }

  try {
    const url = `https://movie.douban.com/j/subject_suggest?q=${encodeURIComponent(keyword)}`;
    const res = await axios.get(url, {
      headers: COMMON_HEADERS,
      timeout: 10000,
      responseType: 'json'
    });

    const raw = Array.isArray(res.data) ? res.data : [];
    const candidates = raw
      .filter(item => item && item.type === 'movie' && item.id)
      .map(item => ({
        doubanId: String(item.id),
        title: item.title || '',
        year: item.year || '',
        posterUrl: item.img || '',
        subtype: item.sub_title || '',
        director: pickDirectorFromSubTitle(item.sub_title),
        url: item.url || `https://movie.douban.com/subject/${item.id}/`
      }));

    return { success: true, candidates, keyword };
  } catch (err) {
    console.error('searchMovieByTitle 失败:', err && err.message);
    return {
      success: false,
      error: err && err.message,
      code: err && err.code,
      keyword
    };
  }
};
