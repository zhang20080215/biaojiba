const cloud = require('wx-server-sdk');
const axios = require('axios');
const cheerio = require('cheerio');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const imdbCollection = db.collection('imdb_movies');

/**
 * 调用豆瓣移动版搜索，直接根据 IMDb ID 精准抓取官方中文译名
 */
async function translateTitle(imdbId, fallbackTitle) {
  try {
    const res = await axios.get(`https://m.douban.com/search/?query=${imdbId}&type=movie`, {
      timeout: 5000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.3 Mobile/15E148 Safari/604.1'
      }
    });

    const $ = cheerio.load(res.data);
    const zhTitle = $('.subject-title').first().text().trim();
    if (zhTitle) {
      return zhTitle;
    }

    return fallbackTitle;
  } catch (e) {
    console.warn(`Translation failed for ${imdbId}, keeping original:`, e.message);
    return fallbackTitle; // fallback to English
  }
}

/**
 * 下载图片并上传到云存储
 */
async function downloadAndUploadImage(imageUrl, movieId, existingImageMap, retryCount = 0) {
  try {
    // 1. 优先从预加载的 Map 中查找
    if (existingImageMap && existingImageMap[movieId]) {
      return existingImageMap[movieId];
    }

    // 2. 如果不存在，则下载图片
    const response = await axios({
      url: imageUrl,
      responseType: 'arraybuffer',
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/91.0'
      }
    });

    // 生成文件名
    const fileName = `imdb_covers/${movieId}_${Date.now()}.jpg`;

    // 上传到云存储
    const uploadResult = await cloud.uploadFile({
      cloudPath: fileName,
      fileContent: response.data
    });

    const cdnUrl = `https://${uploadResult.fileID}`;

    // 保存图片信息
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
    console.error(`下载或上传图片失败 (重试${retryCount}次, ID: ${movieId}):`, error.message);
    if (retryCount < 2) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      return downloadAndUploadImage(imageUrl, movieId, retryCount + 1);
    }
    return {
      fileID: '',
      cdnUrl: imageUrl,
      originalUrl: imageUrl,
      isFallback: true
    };
  }
}

/**
 * 检查数据库中是否已存在该电影的封面信息
 */
async function checkExistingImage(movieId) {
  try {
    const result = await db.collection('movie_images').where({
      movieId: movieId
    }).get();
    if (result.data.length > 0) {
      return result.data[0];
    }
  } catch (error) {
    console.error('检查已存在图片失败:', error.message);
  }
  return null;
}

/**
 * 保存图片对应关系
 */
async function saveImageInfo(movieId, imageInfo) {
  try {
    await db.collection('movie_images').add({
      data: {
        movieId: movieId,
        ...imageInfo
      }
    });
  } catch (error) {
    console.error('保存图片信息失败:', error.message);
  }
}

exports.main = async (event, context) => {
  const _ = db.command;
  const START_TIME = Date.now();
  const TIME_LIMIT = 45000; // 45 秒安全阈值，确保在微信云函数 60 秒硬限制前退出以便保存数据

  try {
    console.log('Starting IMDb Top 250 scraping...');

    // 1. 抓取 IMDb Top 250 页面 (带中文语言参数)
    const res = await axios.get('https://www.imdb.com/chart/top/?hl=zh-cn', {
      timeout: 20000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Cookie': 'lc-main=zh_CN;'
      }
    });

    const $ = cheerio.load(res.data);
    const nextDataScript = $('script#__NEXT_DATA__').html();
    if (!nextDataScript) {
      throw new Error('Could not find __NEXT_DATA__ script tag');
    }

    const nextData = JSON.parse(nextDataScript);
    const edges = nextData.props.pageProps.pageData.chartTitles.edges;
    if (!edges || !Array.isArray(edges)) {
      throw new Error('Could not find movie edges in __NEXT_DATA__');
    }

    console.log(`Successfully found ${edges.length} movies in __NEXT_DATA__`);

    // 2. 解析数据并分批处理照片
    let moviesToProcess = edges.map((edge, index) => {
      const node = edge.node;
      return {
        _id: node.id, // IMDb ID e.g., tt0111161
        rank: index + 1,
        title: node.titleText.text,
        rating: node.ratingsSummary ? node.ratingsSummary.aggregateRating : 0,
        year: node.releaseYear ? String(node.releaseYear.year) : '',
        coverUrl: node.primaryImage ? node.primaryImage.url : '',
        description: node.plot ? node.plot.plotText.plainText : 'No description available',
        category: ''
      };
    });

    // 3. 获取现有电影进行比对
    const MAX_LIMIT = 1000;
    const countRes = await imdbCollection.count();
    const totalCount = countRes.total;
    let allExistingMovies = [];
    for (let i = 0; i < totalCount; i += MAX_LIMIT) {
      const batch = await imdbCollection.skip(i).limit(MAX_LIMIT).get();
      allExistingMovies = allExistingMovies.concat(batch.data);
    }
    const existingMap = {};
    allExistingMovies.forEach(m => existingMap[m._id] = m);

    // 3.1 预加载所有已存在的图片映射，防止在循环中频繁查库导致超时
    console.log('Pre-loading movie image mappings...');
    const imageCountRes = await db.collection('movie_images').count();
    const totalImageCount = imageCountRes.total;
    let allImages = [];
    for (let i = 0; i < totalImageCount; i += MAX_LIMIT) {
      const batch = await db.collection('movie_images').skip(i).limit(MAX_LIMIT).get();
      allImages = allImages.concat(batch.data);
    }
    const movieImageMap = {};
    allImages.forEach(img => {
      movieImageMap[img.movieId] = img;
    });
    console.log(`Pre-loaded ${allImages.length} image mappings.`);

    // 4. 处理图片并准备新增/更新列表
    let moviesToAdd = [];
    let moviesToUpdate = [];
    let processedMovies = [];

    const CHUNK_SIZE = 5; // 保持适中并发，防止下载过快被封或内存溢出
    let stoppedEarly = false;
    for (let i = 0; i < moviesToProcess.length; i += CHUNK_SIZE) {
      if (Date.now() - START_TIME > TIME_LIMIT) {
        console.warn(`[Timeout Guard] Execution time exceeded 45s threshold. Stopping at index ${i} to safely save progress. Run the function again to continue.`);
        stoppedEarly = true;
        break;
      }

      console.log(`Processing chunk ${Math.floor(i / CHUNK_SIZE) + 1}/${Math.ceil(moviesToProcess.length / CHUNK_SIZE)}...`);
      const chunk = moviesToProcess.slice(i, i + CHUNK_SIZE);
      const chunkResults = await Promise.all(chunk.map(async (movie) => {
        // 下载并上传封面图
        let imageInfo = null;
        if (movie.coverUrl) {
          try {
            // 传入预加载的 Map
            imageInfo = await downloadAndUploadImage(movie.coverUrl, movie._id, movieImageMap);
          } catch (err) {
            console.error(`Image process failed for ${movie._id}:`, err.message);
          }
        }

        // 翻译标题 (通过 IMDb ID 精准搜索豆瓣)
        let finalTitle = movie.title;
        if (existingMap[movie._id] && /[一-龥]/.test(existingMap[movie._id].title)) {
          finalTitle = existingMap[movie._id].title;
        } else {
          finalTitle = await translateTitle(movie._id, movie.title);
        }

        const finalMovieData = {
          ...movie,
          title: finalTitle,
          originalTitle: movie.title,
          cover: imageInfo && imageInfo.fileID ? imageInfo.fileID : movie.coverUrl,
          coverUrl: imageInfo && imageInfo.cdnUrl ? imageInfo.cdnUrl : movie.coverUrl,
          originalCover: movie.coverUrl,
          isTop250: true,
          theme: 'imdb_movies',
          updateTime: db.serverDate()
        };

        if (existingMap[movie._id]) {
          const oldRecord = existingMap[movie._id];
          if (oldRecord.isTop250 === false) {
            finalMovieData.enterTop250Time = db.serverDate();
          }
          moviesToUpdate.push(finalMovieData);
        } else {
          finalMovieData.createTime = db.serverDate();
          finalMovieData.enterTop250Time = db.serverDate();
          moviesToAdd.push(finalMovieData);
        }
        return finalMovieData;
      }));
      processedMovies = processedMovies.concat(chunkResults);
      console.log(`Processed ${processedMovies.length}/${moviesToProcess.length} movies...`);
    }

    // 5. 软删除掉出榜单的电影
    const currentIdSet = new Set(moviesToProcess.map(m => m._id));
    const moviesToSoftDelete = allExistingMovies
      .filter(m => m.isTop250 !== false && !currentIdSet.has(m._id))
      .map(m => m._id);

    // 6. 数据库操作
    // 6.1 批量软删除
    if (moviesToSoftDelete.length > 0) {
      await imdbCollection.where({
        _id: _.in(moviesToSoftDelete)
      }).update({
        data: {
          isTop250: false,
          exitTop250Time: db.serverDate(),
          updateTime: db.serverDate()
        }
      });
      console.log(`Soft deleted ${moviesToSoftDelete.length} movies.`);
    }

    // 6.2 批量更新
    for (let movie of moviesToUpdate) {
      const { _id, ...updateData } = movie;
      await imdbCollection.doc(_id).update({
        data: updateData
      }).catch(err => console.error(`Update failed for ${_id}:`, err.message));
    }
    console.log(`Updated ${moviesToUpdate.length} movies.`);

    // 6.3 批量新增
    for (let i = 0; i < moviesToAdd.length; i += 20) {
      const batch = moviesToAdd.slice(i, i + 20);
      await Promise.all(batch.map(m => imdbCollection.add({ data: m })))
        .catch(err => console.error(`Bulk add failed at index ${i}:`, err.message));
    }
    console.log(`Added ${moviesToAdd.length} new movies.`);

    const message = stoppedEarly ?
      `IMDb sync paused at 45s limit to save progress! Total processed so far: ${processedMovies.length}. Please run the function again to sync the rest.` :
      `IMDb sync complete! Total: ${processedMovies.length}, Added: ${moviesToAdd.length}, Updated: ${moviesToUpdate.length}, Soft Deleted: ${moviesToSoftDelete.length}`;

    console.log(message);

    return {
      success: true,
      total: processedMovies.length,
      added: moviesToAdd.length,
      updated: moviesToUpdate.length,
      softDeleted: moviesToSoftDelete.length,
      stoppedEarly: stoppedEarly,
      message: message
    };

  } catch (error) {
    console.error('IMDb scraping failed:', error);
    return {
      success: false,
      error: error.message
    };
  }
};
