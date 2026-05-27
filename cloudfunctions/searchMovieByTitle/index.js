// 入参: { keyword: string }
// 调豆瓣 j/subject_suggest 拿候选列表，只保留 type=movie 的项
// 返回: { success, candidates: [{doubanId, title, year, posterUrl, subtype, url}] }

const cloud = require('wx-server-sdk');
const axios = require('axios');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const COMMON_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/91.0',
  'Referer': 'https://movie.douban.com/'
};

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
