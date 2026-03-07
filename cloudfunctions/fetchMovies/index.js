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
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/91.0',
        'Referer': 'https://movie.douban.com/'
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

// 图片压缩和优化 (因云端Linux环境运行sharp易报错退出，直接放通)
async function optimizeImage(imageBuffer) {
  try {
    // 暂时注销本地压缩，如果需要在此处减小体积，建议在客户端请求缩略图
    // 或使用云开发自带的图片处理能力 (imageMogr2)
    return imageBuffer;
  } catch (error) {
    console.error('图片返回失败:', error);
    return imageBuffer;
  }
}

exports.main = async (event, context) => {
  const _ = db.command;
  const START_TIME = Date.now();
  const TIME_LIMIT = 45000; // 45 秒安全阈值
  try {
    let newMoviesList = [];
    let moviesToAdd = [];
    let moviesToUpdate = [];

    // 获取当前数据库中所有的已存电影（为了比对）
    const MAX_LIMIT = 1000;
    const countResult = await moviesCollection.count();
    const total = countResult.total;
    let allExistingMovies = [];

    for (let i = 0; i < total; i += MAX_LIMIT) {
      const promise = moviesCollection.skip(i).limit(MAX_LIMIT).get();
      const res = await promise;
      allExistingMovies = allExistingMovies.concat(res.data);
    }

    // 建立现有电影 map，使用 deterministic movieId 查找
    const existingMoviesMap = {};
    allExistingMovies.forEach(m => {
      existingMoviesMap[m._id] = m;
    });

    // 抓取豆瓣TOP250的电影数据（大幅优化并发，防止云函数超时）
    const fetchPromises = [];
    for (let start = 0; start < 250; start += 25) {
      fetchPromises.push(
        axios.get(`https://movie.douban.com/top250?start=${start}`, {
          timeout: 10000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/91.0',
            'Referer': 'https://movie.douban.com/'
          }
        }).then(res => {
          const $ = cheerio.load(res.data);
          const pageMovies = [];

          $('.item').each((index, element) => {
            const $element = $(element);
            const rank = start + index + 1; // 排名从1开始
            const title = $element.find('.title').first().text();
            const rating = $element.find('.rating_num').text();
            const coverUrl = $element.find('img').attr('src');

            // 在 Page 模式下，年份通常在 .bd p 文本的第一行最后
            const infoText = $element.find('.bd p').first().text();
            const yearMatch = infoText.match(/\d{4}/);
            const year = yearMatch ? yearMatch[0] : '';

            const category = ''; // 列表页较难精准抓取分类，保持为空
            const description = $element.find('.inq').text().trim() || 'No description available';

            // 生成确定性的电影ID
            const safeTitle = title.replace(/[\/\\:*?"<>|]/g, '_');
            const movieId = year ? `movie_${safeTitle}_${year}` : `movie_${safeTitle}`;

            pageMovies.push({
              _id: movieId, rank, title, rating: parseFloat(rating), coverUrl, originalCover: coverUrl, year, category, description
            });
          });
          return pageMovies;
        }).catch(err => {
          console.error(`抓取第 ${start} 页失败:`, err.message);
          return [];
        })
      );
    }

    // 等待 10 页全部抓取完毕
    const pagesResults = await Promise.all(fetchPromises);
    // 兼容较老版本的 Node.js 环境，不使用 .flat()
    const flattenedMovies = pagesResults.reduce((acc, val) => acc.concat(val), []);

    console.log(`网页抓取完成，共解析出 ${flattenedMovies.length} 部电影。开始处理图片...`);

    // 为了防止下载图片瞬间并发过大引发超时，我们将250张图片分批次处理
    const CHUNK_SIZE = 25;
    let stoppedEarly = false;
    for (let i = 0; i < flattenedMovies.length; i += CHUNK_SIZE) {
      if (Date.now() - START_TIME > TIME_LIMIT) {
        console.warn(`[Timeout Guard] fetchMovies exceeded 45s threshold. Stopping at index ${i} to safely save progress.`);
        stoppedEarly = true;
        break;
      }
      const chunk = flattenedMovies.slice(i, i + CHUNK_SIZE);
      const chunkPromises = chunk.map(async (rawMovie) => {
        const { coverUrl, _id, ...restProps } = rawMovie;
        // 下载并上传图片
        const imageInfo = await downloadAndUploadImage(coverUrl, _id);

        const movieData = {
          _id,
          ...restProps,
          cover: imageInfo && imageInfo.fileID ? imageInfo.fileID : coverUrl,
          coverUrl: imageInfo && imageInfo.cdnUrl ? imageInfo.cdnUrl : null,
          originalCover: coverUrl,
          isTop250: true, // 核心标记：当前在榜
          enterTop250Time: db.serverDate(), // 加入榜单的时间
          updateTime: db.serverDate()
        };

        newMoviesList.push(movieData);

        // 决定是新增还是更新
        if (existingMoviesMap[_id]) {
          const oldRecord = existingMoviesMap[_id];
          if (oldRecord.isTop250 === false) {
            movieData.isTop250 = true;
            movieData.enterTop250Time = db.serverDate();
          } else {
            delete movieData.enterTop250Time;
          }
          moviesToUpdate.push(movieData);
        } else {
          movieData.createTime = db.serverDate();
          moviesToAdd.push(movieData);
        }
      });
      // 等待这批图片处理完，再去处理下一批
      await Promise.all(chunkPromises);
    }

    console.log(`抓取完成: 共找到 ${newMoviesList.length} 部，其中 ${moviesToAdd.length} 部新增，${moviesToUpdate.length} 部需要更新。`);

    // 找出跌出 Top250 的老电影（即在 existingMoviesMap 中存在，但不在 newMoviesList 中）
    const newMoviesIdSet = new Set(newMoviesList.map(m => m._id));
    const moviesToSoftDeleteIds = allExistingMovies
      .filter(m => m.isTop250 !== false && !newMoviesIdSet.has(m._id))
      .map(m => m._id);

    console.log(`需要软删除掉榜电影: ${moviesToSoftDeleteIds.length} 部`);

    // ================= 执行数据库写入操作 =================

    // 1. 批量软删除（将 isTop250 设为 false）
    if (moviesToSoftDeleteIds.length > 0) {
      await moviesCollection.where({
        _id: _.in(moviesToSoftDeleteIds)
      }).update({
        data: {
          isTop250: false,
          exitTop250Time: db.serverDate(), // 记录跌出榜单的时间
          updateTime: db.serverDate()
        }
      });
    }

    // 2. 批量更新现有电影（更新最新排名、评分等）
    // 微信云开发一次 batch update 最好根据 id 一个个放进 batch 或者并发更新
    const updatePromises = moviesToUpdate.map(async movie => {
      const { _id, ...updateData } = movie; // 分离 _id
      return moviesCollection.doc(_id).update({
        data: updateData
      }).catch(err => console.error(`更新 ${_id} 失败`, err));
    });
    // 分块并发执行以防越界
    for (let i = 0; i < updatePromises.length; i += 20) {
      await Promise.all(updatePromises.slice(i, i + 20));
      await new Promise(r => setTimeout(r, 200));
    }

    // 3. 批量新增电影
    if (moviesToAdd.length > 0) {
      const BATCH_SIZE = 50;
      for (let i = 0; i < moviesToAdd.length; i += BATCH_SIZE) {
        const batchToAdd = moviesToAdd.slice(i, i + BATCH_SIZE);
        await Promise.all(batchToAdd.map(async movie => {
          return moviesCollection.add({ data: movie }).catch(err => console.error(`新增 ${movie._id} 失败`, err));
        }));
      }
    }

    const message = stoppedEarly ?
      `豆瓣同步已在 45秒 安全边界暂停以保存进度。请再次运行以同步剩余电影。` :
      '豆瓣电影TOP250数据同步完成';

    return {
      success: true,
      total: newMoviesList.length,
      added: moviesToAdd.length,
      updated: moviesToUpdate.length,
      softDeleted: moviesToSoftDeleteIds.length,
      stoppedEarly: stoppedEarly,
      message: message
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
