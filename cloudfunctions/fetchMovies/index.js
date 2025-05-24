const cloud = require('wx-server-sdk');
const axios = require('axios');
const cheerio = require('cheerio'); // 用来解析网页内容
cloud.init();

const db = cloud.database();
const moviesCollection = db.collection('movies');

exports.main = async (event, context) => {
  try {
    let movieList = [];

    // 抓取豆瓣TOP250的电影数据
    for (let start = 0; start < 250; start += 25) {
      const res = await axios.get(`https://movie.douban.com/top250?start=${start}`);
      const $ = cheerio.load(res.data);

      // 解析电影数据
      $('.item').each((index, element) => {
        const rank = start + index + 1; // 排名从1开始
        const title = $(element).find('.title').first().text();
        const rating = $(element).find('.rating_num').text();
        const cover = $(element).find('img').attr('src');
        const year = $(element).find('.year').text().replace(/[^0-9]/g, '');
        const category = $(element).find('.genre').text().trim();
        const description = $(element).find('.inq').text().trim() || 'No description available';

        movieList.push({
          rank,
          title,
          rating: parseFloat(rating),
          cover,
          year,
          category,
          description
        });
      });
    }

    // 将抓取的数据批量插入到数据库
    const batch = moviesCollection.batch();
    movieList.forEach(movie => {
      batch.add({
        data: movie
      });
    });

    await batch.commit(); // 提交批量操作
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
};
