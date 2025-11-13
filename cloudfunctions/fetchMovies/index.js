const cloud = require('wx-server-sdk');
const axios = require('axios');
const cheerio = require('cheerio'); // 用来解析网页内容

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const moviesCollection = db.collection('movies');

// 下载图片并上传到云存储
async function downloadAndUploadImage(imageUrl, movieId, retryCount = 0) {
  try {
    // 检查是否已存在该电影的图片
    const existingImage = await checkExistingImage(movieId);
    if (existingImage) {
      return existingImage;
    }

    // 下载图片
    const response = await axios({
      url: imageUrl,
      responseType: 'arraybuffer',
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/91.0'
      }
    });

    // 压缩图片
    const optimizedBuffer = await optimizeImage(response.data);

    // 生成文件名（使用电影ID确保唯一性）
    const fileName = `movie_covers/${movieId}_${Date.now()}.jpg`;

    // 上传到云存储
    const uploadResult = await cloud.uploadFile({
      cloudPath: fileName,
      fileContent: optimizedBuffer
    });

    // 生成CDN链接（永久有效）
    const cdnUrl = `https://${uploadResult.fileID}`;

    // 保存图片信息到数据库
    await saveImageInfo(movieId, {
      fileID: uploadResult.fileID,
      cdnUrl: cdnUrl,
      originalUrl: imageUrl,
      uploadTime: new Date()
    });

    return {
      fileID: uploadResult.fileID,
      cdnUrl: cdnUrl,
      originalUrl: imageUrl
    };
  } catch (error) {
    console.error(`下载或上传图片失败 (重试${retryCount}次):`, error);
    
    // 重试机制
    if (retryCount < 2) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      return downloadAndUploadImage(imageUrl, movieId, retryCount + 1);
    }
    
    // 返回原始URL作为降级方案
    return {
      fileID: '',
      cdnUrl: imageUrl,
      originalUrl: imageUrl,
      isFallback: true
    };
  }
}

// 检查是否已存在图片
async function checkExistingImage(movieId) {
  try {
    const result = await db.collection('movie_images').where({
      movieId: movieId
    }).get();
    
    if (result.data.length > 0) {
      return result.data[0];
    }
    return null;
  } catch (error) {
    console.error('检查已存在图片失败:', error);
    return null;
  }
}

// 保存图片信息
async function saveImageInfo(movieId, imageInfo) {
  try {
    await db.collection('movie_images').add({
      data: {
        movieId: movieId,
        ...imageInfo
      }
    });
  } catch (error) {
    console.error('保存图片信息失败:', error);
  }
}

// 图片压缩和优化
async function optimizeImage(imageBuffer) {
  try {
    const sharp = require('sharp');
    
    // 压缩图片：调整尺寸为300x450，质量80%
    const optimizedBuffer = await sharp(imageBuffer)
      .resize(300, 450, { 
        fit: 'cover',
        position: 'center'
      })
      .jpeg({ 
        quality: 80,
        progressive: true
      })
      .toBuffer();
    
    console.log(`图片压缩完成: ${imageBuffer.length} -> ${optimizedBuffer.length} bytes`);
    return optimizedBuffer;
  } catch (error) {
    console.error('图片压缩失败:', error);
    // 压缩失败时返回原图
    return imageBuffer;
  }
}

exports.main = async (event, context) => {
  try {
    let movieList = [];

    // 抓取豆瓣TOP250的电影数据
    for (let start = 0; start < 250; start += 25) {
      const res = await axios.get(`https://movie.douban.com/top250?start=${start}`);
      const $ = cheerio.load(res.data);

      // 解析电影数据
      for (const element of $('.item').get()) {
        const $element = $(element);
        const rank = start + $('.item').index(element) + 1; // 排名从1开始
        const title = $element.find('.title').first().text();
        const rating = $element.find('.rating_num').text();
        const coverUrl = $element.find('img').attr('src');
        const year = $element.find('.year').text().replace(/[^0-9]/g, '');
        const category = $element.find('.genre').text().trim();
        const description = $element.find('.inq').text().trim() || 'No description available';

        // 生成电影ID
        const movieId = `movie_${rank}_${Date.now()}`;
        
        // 下载并上传图片
        const imageInfo = await downloadAndUploadImage(coverUrl, movieId);
        
        movieList.push({
          _id: movieId,
          rank,
          title,
          rating: parseFloat(rating),
          cover: imageInfo ? imageInfo.cdnUrl : coverUrl, // 使用CDN链接
          originalCover: coverUrl, // 保存原始URL作为降级方案
          year,
          category,
          description,
          createTime: db.serverDate()
        });

        // 每抓取一部电影就暂停一下，避免请求过于频繁
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    // 将抓取的数据批量插入到数据库
    const batch = moviesCollection.batch();
    movieList.forEach(movie => {
      batch.add({
        data: movie
      });
    });

    await batch.commit(); // 提交批量操作
    return { 
      success: true, 
      total: movieList.length,
      message: '电影数据抓取并存储成功'
    };
  } catch (error) {
    console.error('抓取电影数据失败:', error);
    return { 
      success: false, 
      error: error.message,
      message: '电影数据抓取失败'
    };
  }
};
