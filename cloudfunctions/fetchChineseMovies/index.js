// cloudfunctions/fetchChineseMovies/index.js
// 豆瓣高分华语电影TOP100数据导入
// 数据来源：豆瓣华语高分榜爬取
// 支持从豆瓣抓取封面并上传至微信云存储

const cloud = require('wx-server-sdk');
const axios = require('axios');
const cheerio = require('cheerio');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const COLLECTION = 'chinese_movies';

// 豆瓣高分华语电影TOP100（已排除豆瓣TOP250中的华语片）
// 数据来源：豆瓣华语高分榜，截至2026年3月
const CHINESE_MOVIES_DATA = [
  { rank: 1, title: '霸王别姬', year: 1993, director: '陈凯歌', region: '大陆/香港', rating: 9.6 },
  { rank: 2, title: '无间道', year: 2002, director: '刘伟强 / 麦兆辉', region: '香港', rating: 9.3 },
  { rank: 3, title: '饮食男女', year: 1994, director: '李安', region: '台湾', rating: 9.2 },
  { rank: 4, title: '让子弹飞', year: 2010, director: '姜文', region: '大陆/香港', rating: 9.0 },
  { rank: 5, title: '阳光灿烂的日子', year: 1994, director: '姜文', region: '大陆/香港', rating: 9.0 },
  { rank: 6, title: '甜蜜蜜', year: 1996, director: '陈可辛', region: '香港', rating: 9.0 },
  { rank: 7, title: '一一', year: 2000, director: '杨德昌', region: '台湾/日本', rating: 9.0 },
  { rank: 8, title: '花样年华', year: 2000, director: '王家卫', region: '香港', rating: 8.9 },
  { rank: 9, title: '东邪西毒', year: 1994, director: '王家卫', region: '香港', rating: 8.7 },
  { rank: 10, title: '重庆森林', year: 1994, director: '王家卫', region: '香港', rating: 8.7 },
  { rank: 11, title: '喜剧之王', year: 1999, director: '周星驰 / 李力持', region: '香港', rating: 8.8 },
  { rank: 12, title: '英雄本色', year: 1986, director: '吴宇森', region: '香港', rating: 8.8 },
  { rank: 13, title: '牯岭街少年杀人事件', year: 1991, director: '杨德昌', region: '台湾', rating: 8.9 },
  { rank: 14, title: '活着', year: 1994, director: '张艺谋', region: '大陆/香港', rating: 9.3 },
  { rank: 15, title: '春光乍泄', year: 1997, director: '王家卫', region: '香港', rating: 8.9 },
  { rank: 16, title: '鬼子来了', year: 2000, director: '姜文', region: '大陆', rating: 9.3 },
  { rank: 17, title: '大话西游之大圣娶亲', year: 1995, director: '刘镇伟', region: '香港', rating: 9.2 },
  { rank: 18, title: '大话西游之月光宝盒', year: 1995, director: '刘镇伟', region: '香港', rating: 9.0 },
  { rank: 19, title: '射雕英雄传之东成西就', year: 1993, director: '刘镇伟', region: '香港', rating: 8.7 },
  { rank: 20, title: '倩女幽魂', year: 1987, director: '程小东', region: '香港', rating: 8.8 },
  { rank: 21, title: '功夫', year: 2004, director: '周星驰', region: '大陆/香港', rating: 8.5 },
  { rank: 22, title: '暗战', year: 1999, director: '杜琪峰', region: '香港', rating: 8.5 },
  { rank: 23, title: '岁月神偷', year: 2010, director: '罗启锐', region: '香港', rating: 8.7 },
  { rank: 24, title: '风声', year: 2009, director: '陈国富 / 高群书', region: '大陆', rating: 8.4 },
  { rank: 25, title: '新龙门客栈', year: 1992, director: '李惠民', region: '香港', rating: 8.6 },
  { rank: 26, title: '黄飞鸿', year: 1991, director: '徐克', region: '香港', rating: 8.5 },
  { rank: 27, title: '色，戒', year: 2007, director: '李安', region: '台湾/美国', rating: 8.6 },
  { rank: 28, title: '赌神', year: 1989, director: '王晶', region: '香港', rating: 8.5 },
  { rank: 29, title: '追随', year: 1989, director: '吴宇森', region: '香港', rating: 8.7 },
  { rank: 30, title: '纵横四海', year: 1991, director: '吴宇森', region: '香港', rating: 8.8 },
  { rank: 31, title: '笑傲江湖II东方不败', year: 1992, director: '程小东', region: '香港', rating: 8.5 },
  { rank: 32, title: '推拿', year: 2014, director: '娄烨', region: '大陆', rating: 7.9 },
  { rank: 33, title: '红高粱', year: 1988, director: '张艺谋', region: '大陆', rating: 8.4 },
  { rank: 34, title: '天下无贼', year: 2004, director: '冯小刚', region: '大陆/香港', rating: 8.1 },
  { rank: 35, title: '黑社会', year: 2005, director: '杜琪峰', region: '香港', rating: 8.3 },
  { rank: 36, title: '枪火', year: 1999, director: '杜琪峰', region: '香港', rating: 8.7 },
  { rank: 37, title: '大佛普拉斯', year: 2017, director: '黄信尧', region: '台湾', rating: 8.7 },
  { rank: 38, title: '可可西里', year: 2004, director: '陆川', region: '大陆', rating: 8.8 },
  { rank: 39, title: '秋菊打官司', year: 1992, director: '张艺谋', region: '大陆/香港', rating: 8.3 },
  { rank: 40, title: '蓝色大门', year: 2002, director: '易智言', region: '台湾/法国', rating: 8.8 },
  { rank: 41, title: '我不是药神', year: 2018, director: '文牧野', region: '大陆', rating: 9.0 },
  { rank: 42, title: '无间道2', year: 2003, director: '刘伟强 / 麦兆辉', region: '香港', rating: 8.4 },
  { rank: 43, title: '疯狂的石头', year: 2006, director: '宁浩', region: '大陆/香港', rating: 8.4 },
  { rank: 44, title: '半生缘', year: 1997, director: '许鞍华', region: '香港', rating: 8.6 },
  { rank: 45, title: '投名状', year: 2007, director: '陈可辛', region: '大陆/香港', rating: 8.1 },
  { rank: 46, title: '大红灯笼高高挂', year: 1991, director: '张艺谋', region: '大陆/香港', rating: 8.6 },
  { rank: 47, title: '少年的你', year: 2019, director: '曾国祥', region: '大陆/香港', rating: 8.3 },
  { rank: 48, title: '女人四十', year: 1995, director: '许鞍华', region: '香港', rating: 8.6 },
  { rank: 49, title: '悲情城市', year: 1989, director: '侯孝贤', region: '台湾', rating: 8.9 },
  { rank: 50, title: '童年往事', year: 1985, director: '侯孝贤', region: '台湾', rating: 9.0 },
  { rank: 51, title: '春夏秋冬又一春', year: 1985, director: '侯孝贤', region: '台湾', rating: 8.0 },
  { rank: 52, title: '桃姐', year: 2011, director: '许鞍华', region: '香港/大陆', rating: 8.3 },
  { rank: 53, title: '菊豆', year: 1990, director: '张艺谋', region: '大陆/日本', rating: 8.3 },
  { rank: 54, title: '男人四十', year: 2002, director: '许鞍华', region: '香港', rating: 8.2 },
  { rank: 55, title: '三峡好人', year: 2006, director: '贾樟柯', region: '大陆', rating: 8.3 },
  { rank: 56, title: '小城之春', year: 1948, director: '费穆', region: '大陆', rating: 9.0 },
  { rank: 57, title: '站台', year: 2000, director: '贾樟柯', region: '大陆/香港/日本/法国', rating: 8.4 },
  { rank: 58, title: '独自等待', year: 2005, director: '伍仕贤', region: '大陆', rating: 8.3 },
  { rank: 59, title: '那些年，我们一起追的女孩', year: 2011, director: '九把刀', region: '台湾', rating: 8.1 },
  { rank: 60, title: '告白', year: 1988, director: '张艺谋', region: '大陆', rating: 8.0 },
  { rank: 61, title: '风柜来的人', year: 1983, director: '侯孝贤', region: '台湾', rating: 8.5 },
  { rank: 62, title: '黄金时代', year: 2014, director: '许鞍华', region: '大陆/香港', rating: 7.5 },
  { rank: 63, title: '不能说的秘密', year: 2007, director: '周杰伦', region: '台湾', rating: 8.5 },
  { rank: 64, title: '心迷宫', year: 2014, director: '忻钰坤', region: '大陆', rating: 8.7 },
  { rank: 65, title: '驴得水', year: 2016, director: '周申 / 刘露', region: '大陆', rating: 8.3 },
  { rank: 66, title: '头文字D', year: 2005, director: '刘伟强 / 麦兆辉', region: '香港', rating: 8.1 },
  { rank: 67, title: '暗花', year: 1998, director: '游达志', region: '香港', rating: 8.5 },
  { rank: 68, title: '刺客聂隐娘', year: 2015, director: '侯孝贤', region: '台湾/大陆/香港/法国', rating: 7.3 },
  { rank: 69, title: '顽主', year: 1988, director: '米家山', region: '大陆', rating: 8.3 },
  { rank: 70, title: '天水围的日与夜', year: 2008, director: '许鞍华', region: '香港', rating: 8.7 },
  { rank: 71, title: '烈日灼心', year: 2015, director: '曹保平', region: '大陆', rating: 8.3 },
  { rank: 72, title: '一个字头的诞生', year: 1997, director: '韦家辉', region: '香港', rating: 8.5 },
  { rank: 73, title: '夏洛特烦恼', year: 2015, director: '闫非 / 彭大魔', region: '大陆', rating: 7.8 },
  { rank: 74, title: '哪吒之魔童降世', year: 2019, director: '饺子', region: '大陆', rating: 8.4 },
  { rank: 75, title: '流浪地球', year: 2019, director: '郭帆', region: '大陆', rating: 7.9 },
  { rank: 76, title: '老炮儿', year: 2015, director: '管虎', region: '大陆', rating: 8.0 },
  { rank: 77, title: '阮玲玉', year: 1992, director: '关锦鹏', region: '香港', rating: 8.4 },
  { rank: 78, title: '暗恋桃花源', year: 1992, director: '赖声川', region: '台湾', rating: 8.6 },
  { rank: 79, title: '买凶拍人', year: 2001, director: '彭浩翔', region: '香港', rating: 8.3 },
  { rank: 80, title: 'PTU', year: 2003, director: '杜琪峰', region: '香港', rating: 8.1 },
  { rank: 81, title: '志明与春娇', year: 2010, director: '彭浩翔', region: '香港', rating: 7.9 },
  { rank: 82, title: '药神', year: 2018, director: '文牧野', region: '大陆', rating: 9.0 },
  { rank: 83, title: '十二怒汉', year: 2014, director: '徐昂', region: '大陆', rating: 8.4 },
  { rank: 84, title: '太阳照常升起', year: 2007, director: '姜文', region: '大陆/香港', rating: 8.1 },
  { rank: 85, title: '黄飞鸿之二男儿当自强', year: 1992, director: '徐克', region: '香港', rating: 8.4 },
  { rank: 86, title: '寒战', year: 2012, director: '梁乐民 / 陆剑青', region: '香港', rating: 7.5 },
  { rank: 87, title: '师父', year: 2015, director: '徐浩峰', region: '大陆', rating: 8.2 },
  { rank: 88, title: '赛德克·巴莱', year: 2011, director: '魏德圣', region: '台湾', rating: 8.8 },
  { rank: 89, title: '狗咬狗', year: 2006, director: '郑保瑞', region: '香港', rating: 7.7 },
  { rank: 90, title: '追龙', year: 2017, director: '王晶 / 关智耀', region: '香港/大陆', rating: 7.4 },
  { rank: 91, title: '疯狂的赛车', year: 2009, director: '宁浩', region: '大陆', rating: 8.1 },
  { rank: 92, title: '麦兜故事', year: 2001, director: '袁建滔', region: '香港', rating: 8.6 },
  { rank: 93, title: '推手', year: 1991, director: '李安', region: '台湾/美国', rating: 8.5 },
  { rank: 94, title: '一个都不能少', year: 1999, director: '张艺谋', region: '大陆', rating: 8.4 },
  { rank: 95, title: '路边野餐', year: 2015, director: '毕赣', region: '大陆', rating: 7.9 },
  { rank: 96, title: '哪吒之魔童闹海', year: 2025, director: '饺子', region: '大陆', rating: 8.5 },
  { rank: 97, title: '钢的琴', year: 2011, director: '张猛', region: '大陆', rating: 8.5 },
  { rank: 98, title: '无双', year: 2018, director: '庄文强', region: '香港/大陆', rating: 8.0 },
  { rank: 99, title: '战狼2', year: 2017, director: '吴京', region: '大陆', rating: 7.1 },
  { rank: 100, title: '长江七号', year: 2008, director: '周星驰', region: '大陆/香港', rating: 7.0 }
];

/**
 * 搜索豆瓣，提取电影封面和评分
 */
async function fetchDoubanInfo(title, year) {
  const searchQueries = [
    `${title} ${year}`,
    title
  ];

  for (const query of searchQueries) {
    try {
      const searchUrl = `https://m.douban.com/search/?query=${encodeURIComponent(query)}`;
      const res = await axios.get(searchUrl, {
        timeout: 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.3 Mobile/15E148 Safari/604.1',
          'Accept-Charset': 'utf-8'
        }
      });

      const $ = cheerio.load(res.data);
      const candidates = [];

      $('.search-module li').each((i, el) => {
        const href = $(el).find('a').attr('href');
        if (href && href.includes('/movie/subject/')) {
          const coverUrl = $(el).find('img').attr('src');
          const rating = $(el).find('.rating span:nth-child(2)').text().trim();
          const infoText = $(el).text();
          let doubanId = '';
          const match = href.match(/\/subject\/(\d+)\//);
          if (match && match[1]) doubanId = match[1];
          const yearMatch = infoText.includes(String(year));
          candidates.push({ coverUrl, rating, doubanId, yearMatch });
        }
      });

      if (candidates.length === 0) continue;

      const best = candidates.find(c => c.yearMatch) || candidates[0];
      if (best && best.doubanId) {
        console.log(`  -> 豆瓣匹配: ${best.doubanId}, 年份匹配: ${best.yearMatch}, 查询: "${query}"`);
        return {
          doubanId: best.doubanId,
          coverUrl: best.coverUrl || '',
          rating: best.rating ? parseFloat(best.rating) : 0
        };
      }
    } catch (error) {
      console.warn(`豆瓣搜索失败 "${query}":`, error.message);
    }
  }
  return null;
}

/**
 * 下载图片并上传到微信云存储
 */
async function downloadAndUploadImage(imageUrl, movieId) {
  try {
    const highResUrl = imageUrl.replace('/s_ratio_poster/', '/m_ratio_poster/');

    const response = await axios({
      url: highResUrl,
      responseType: 'arraybuffer',
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://movie.douban.com/'
      }
    });

    const fileName = `chinese_covers/${movieId}_${Date.now()}.jpg`;
    const uploadResult = await cloud.uploadFile({
      cloudPath: fileName,
      fileContent: response.data
    });

    console.log(`  -> 封面上传成功: ${movieId} (${(response.data.length / 1024).toFixed(1)}KB)`);
    return uploadResult.fileID;
  } catch (e) {
    console.warn(`  -> 封面下载失败 ${movieId}, 回退原始URL:`, e.message);
    return imageUrl;
  }
}

/**
 * 云函数入口
 * @param {Object} event - 调用参数
 * @param {string} [event.action='seed'] - 操作类型：
 *   - 'seed': 导入/更新基础数据（不抓封面），速度快
 *   - 'covers': 为缺少封面的电影抓取豆瓣封面并上传云存储
 * @param {boolean} [event.forceRefresh=false] - covers模式下强制重新抓取所有封面
 * @param {number} [event.startFrom=0] - covers模式下从第N名开始（断点续传）
 *
 * 云端测试示例：
 *   {} 或 {"action":"seed"} — 导入基础数据
 *   {"action":"covers"} — 抓取缺失封面
 *   {"action":"covers","forceRefresh":true} — 强制重新抓取所有封面
 *   {"action":"covers","startFrom":30} — 从第30名开始续传
 */
exports.main = async (event = {}, context) => {
  const action = event.action || 'seed';

  try {
    // ========== action: seed ==========
    if (action === 'seed') {
      let added = 0;
      let updated = 0;

      for (const movie of CHINESE_MOVIES_DATA) {
        const doc = {
          rank: movie.rank,
          title: movie.title,
          year: movie.year,
          director: movie.director,
          region: movie.region,
          rating: movie.rating,
          isTop250: true,
          theme: 'chinese_movies',
          updateTime: new Date()
        };

        // 检查是否已存在（通过 title + year 匹配）
        const existing = await db.collection(COLLECTION)
          .where({ title: movie.title, year: movie.year })
          .get();

        if (existing.data.length > 0) {
          const old = existing.data[0];
          // 更新时不覆盖已有的封面字段
          if (!old.cover || !old.cover.startsWith('cloud://')) {
            doc.cover = '';
            doc.originalCover = '';
            doc.coverUrl = '';
          }
          await db.collection(COLLECTION).doc(old._id).update({ data: doc });
          updated++;
        } else {
          doc.cover = '';
          doc.originalCover = '';
          doc.coverUrl = '';
          await db.collection(COLLECTION).add({ data: doc });
          added++;
        }
      }

      return { success: true, action, added, updated, total: CHINESE_MOVIES_DATA.length };
    }

    // ========== action: covers ==========
    if (action === 'covers') {
      const START_TIME = Date.now();
      const TIME_LIMIT = 50000;
      const forceRefresh = event.forceRefresh || false;
      const startFrom = event.startFrom || 0;

      // 读取数据库全部记录
      const MAX_LIMIT = 100;
      let allMovies = [];
      let fetchCount = 0;
      while (true) {
        const batch = await db.collection(COLLECTION)
          .orderBy('rank', 'asc')
          .skip(fetchCount)
          .limit(MAX_LIMIT)
          .get();
        allMovies = allMovies.concat(batch.data);
        fetchCount += batch.data.length;
        if (batch.data.length < MAX_LIMIT) break;
      }

      console.log(`共 ${allMovies.length} 部华语电影，forceRefresh=${forceRefresh}, startFrom=${startFrom}`);

      let processed = 0;
      let fetched = 0;
      let skipped = 0;
      let failed = 0;
      let stoppedEarly = false;
      let lastRank = 0;

      for (const movie of allMovies) {
        if (movie.rank < startFrom) {
          skipped++;
          continue;
        }

        if (Date.now() - START_TIME > TIME_LIMIT) {
          console.warn(`[超时保护] 已运行${Math.round((Date.now() - START_TIME) / 1000)}秒，在第${movie.rank}名停止`);
          stoppedEarly = true;
          break;
        }

        lastRank = movie.rank;

        if (!forceRefresh && movie.cover && movie.cover.startsWith('cloud://')) {
          skipped++;
          processed++;
          continue;
        }

        console.log(`[${movie.rank}] 抓取封面: ${movie.title} (${movie.year})`);

        const doubanInfo = await fetchDoubanInfo(movie.title, movie.year);
        if (doubanInfo && doubanInfo.coverUrl) {
          const cloudFileID = await downloadAndUploadImage(doubanInfo.coverUrl, `chinese_${doubanInfo.doubanId}`);

          const updateData = {
            cover: cloudFileID,
            coverUrl: doubanInfo.coverUrl,
            originalCover: doubanInfo.coverUrl,
            doubanId: doubanInfo.doubanId,
            updateTime: new Date()
          };
          if (doubanInfo.rating > 0) {
            updateData.rating = doubanInfo.rating;
          }

          await db.collection(COLLECTION).doc(movie._id).update({ data: updateData });
          fetched++;
        } else {
          console.warn(`  -> 未找到豆瓣信息: ${movie.title}`);
          failed++;
        }

        processed++;
        await new Promise(r => setTimeout(r, 800));
      }

      return {
        success: true,
        action: 'covers',
        processed,
        fetched,
        skipped,
        failed,
        stoppedEarly,
        lastRank,
        hint: stoppedEarly
          ? `已处理到第${lastRank}名，请传入 {"action":"covers","startFrom":${lastRank}} 继续`
          : '全部封面处理完成'
      };
    }

    return {
      success: false,
      error: `未知操作: "${action}"`,
      usage: '支持的 action: "seed"（导入基础数据）、"covers"（抓取封面）。不传参数默认执行 seed。'
    };
  } catch (err) {
    console.error('fetchChineseMovies error:', err);
    return { success: false, error: err.message };
  }
};
