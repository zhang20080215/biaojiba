const cloud = require('wx-server-sdk');
const axios = require('axios');
const cheerio = require('cheerio'); // 用来解析网页内容

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const moviesCollection = db.collection('movies');
const metaCollection = db.collection('metaInfo');
const pushEventsCollection = db.collection('push_events');
const rankHistoryCollection = db.collection('rank_history');

// 抓取到的电影数量低于此值视为豆瓣异常（反爬 / 部分页面 5xx），本次拒写
const MIN_ACCEPT_COUNT = 240;
const VERSION_DOC_ID = 'top250_douban_version';
const ROLLBACK_DOC_ID = 'top250_douban_last_softdelete';

// 找出"看上去是同一部电影但 _id 漂移"的可疑配对：title 完全相等且 _id 不同
function detectDrift(softDeleteCandidates, freshList) {
  const suspect = [];
  const freshByTitle = new Map();
  for (const fresh of freshList) {
    const t = String(fresh.title || '');
    if (t) freshByTitle.set(t, fresh);
  }
  for (const old of softDeleteCandidates) {
    const oldTitle = String(old.title || '');
    if (!oldTitle) continue;
    const fresh = freshByTitle.get(oldTitle);
    if (fresh && fresh._id !== old._id) {
      suspect.push({
        oldId: old._id,
        oldTitle,
        oldYear: String(old.year || ''),
        candidateNewId: fresh._id,
        candidateTitle: fresh.title,
        candidateYear: fresh.year,
        matchedBy: 'title-equal'
      });
    }
  }
  return suspect;
}

async function upsertMetaDoc(docId, data) {
  // 优先 set（云开发 doc().set() 语义是 upsert）；某些版本/场景下 set 不稳，fallback 到 add → update
  try {
    await metaCollection.doc(docId).set({ data });
    console.log(`[upsertMetaDoc] set 成功 ${docId}`);
    return;
  } catch (e1) {
    console.warn(`[upsertMetaDoc] set 失败 ${docId}:`, e1 && e1.message);
  }
  try {
    await metaCollection.add({ data: { _id: docId, ...data } });
    console.log(`[upsertMetaDoc] add 成功 ${docId}`);
    return;
  } catch (e2) {
    console.warn(`[upsertMetaDoc] add 失败 ${docId}:`, e2 && e2.message);
  }
  try {
    await metaCollection.doc(docId).update({ data });
    console.log(`[upsertMetaDoc] update 成功 ${docId}`);
    return;
  } catch (e3) {
    console.error(`[upsertMetaDoc] 三种写法全部失败 ${docId}:`, e3 && e3.message);
  }
}

async function readMetaDoc(docId) {
  try {
    const res = await metaCollection.doc(docId).get();
    return res && res.data ? res.data : null;
  } catch (e) {
    return null;
  }
}

async function upsertRankSnapshot(docId, data) {
  try {
    await rankHistoryCollection.doc(docId).set({ data });
    console.log(`[upsertRankSnapshot] set 成功 ${docId}`);
    return;
  } catch (e1) {
    console.warn(`[upsertRankSnapshot] set 失败 ${docId}:`, e1 && e1.message);
  }
  try {
    await rankHistoryCollection.add({ data: { _id: docId, ...data } });
    console.log(`[upsertRankSnapshot] add 成功 ${docId}`);
    return;
  } catch (e2) {
    console.warn(`[upsertRankSnapshot] add 失败 ${docId}:`, e2 && e2.message);
  }
  try {
    await rankHistoryCollection.doc(docId).update({ data });
    console.log(`[upsertRankSnapshot] update 成功 ${docId}`);
    return;
  } catch (e3) {
    console.error(`[upsertRankSnapshot] 三种写法全部失败 ${docId}:`, e3 && e3.message);
  }
}

// 读取最近一次快照（不含传入的 todayDocId，找历史最新一份做对比）
async function readPrevRankSnapshot(theme, todayDocId) {
  try {
    const _ = db.command;
    const res = await rankHistoryCollection
      .where({ theme, _id: _.neq(todayDocId) })
      .orderBy('date', 'desc')
      .limit(1)
      .get();
    return res.data && res.data.length > 0 ? res.data[0] : null;
  } catch (e) {
    return null;
  }
}

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
  // ───── 参数校验（外置于 try，让异常原样抛给调用方，禁止空参数 / 拼写错误静默走真跑） ─────
  if (!event || typeof event !== 'object') {
    throw new Error('fetchMovies 必须显式传参，禁止空参数执行。请显式传 { dryRun: true } 或 { realRun: true }');
  }
  // 微信云定时触发器会注入 TriggerName / Time 字段，识别为受信触发，自动按真跑执行
  const isTimerTriggered = typeof event.TriggerName === 'string' && event.TriggerName.length > 0;
  const ALLOWED_KEYS = new Set(['dryRun', 'realRun', 'TriggerName', 'Time']);
  const unknownKeys = Object.keys(event).filter(k => !ALLOWED_KEYS.has(k));
  if (unknownKeys.length > 0) {
    throw new Error(`fetchMovies 收到未知参数: ${unknownKeys.join(', ')}。仅接受 dryRun / realRun（大小写敏感）`);
  }
  if (!isTimerTriggered) {
    if (event.dryRun === true && event.realRun === true) {
      throw new Error('fetchMovies 参数冲突：dryRun 与 realRun 互斥');
    }
    if (event.dryRun !== true && event.realRun !== true) {
      throw new Error('fetchMovies 拒绝执行：必须显式传入 { dryRun: true } 或 { realRun: true }');
    }
  }
  const dryRun = event.dryRun === true && !isTimerTriggered;

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
            // _id 不带年份（与历史数据格式 `movie_{title}_` 对齐，避免 _id 漂移）；year 仍单独存字段
            const movieId = `movie_${safeTitle}_`;

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

    console.log(`网页抓取完成，共解析出 ${flattenedMovies.length} 部电影。`);

    // ───── 闸 0：抓取数量熔断 ─────
    if (flattenedMovies.length < MIN_ACCEPT_COUNT) {
      return {
        success: false,
        code: 'INSUFFICIENT_DATA',
        fetched: flattenedMovies.length,
        threshold: MIN_ACCEPT_COUNT,
        message: `抓取数量不足（${flattenedMovies.length} < ${MIN_ACCEPT_COUNT}），疑似豆瓣反爬，拒绝写入`
      };
    }

    // ───── 规划阶段：仅基于解析结果计算 add/update/softDelete（不下载图片、不写库） ─────
    const newMoviesIdSet = new Set(flattenedMovies.map(m => m._id));
    const willSoftDeleteFull = allExistingMovies.filter(m => m.isTop250 !== false && !newMoviesIdSet.has(m._id));

    const suspectedDrift = detectDrift(willSoftDeleteFull, flattenedMovies);

    // ───── dry-run 早返：发布前对账 ─────
    if (dryRun) {
      const planAdd = [];
      const planRejoin = [];
      const planRankChange = [];
      for (const fm of flattenedMovies) {
        const old = existingMoviesMap[fm._id];
        if (!old) {
          planAdd.push({ _id: fm._id, title: fm.title, year: fm.year, rank: fm.rank });
        } else if (old.isTop250 === false) {
          planRejoin.push({ _id: fm._id, title: fm.title, year: fm.year, rank: fm.rank });
        } else if (old.rank !== fm.rank) {
          planRankChange.push({ _id: fm._id, title: fm.title, year: fm.year, oldRank: old.rank, newRank: fm.rank });
        }
      }
      const existingInTop250 = allExistingMovies.filter(m => m.isTop250 !== false).length;
      return {
        success: true,
        dryRun: true,
        summary: {
          fetched: flattenedMovies.length,
          existingCount: allExistingMovies.length,
          existingInTop250,
          toAddCount: planAdd.length,
          toRejoinCount: planRejoin.length,
          toUpdateCount: planRankChange.length,
          toSoftDeleteCount: willSoftDeleteFull.length,
          suspectedDriftCount: suspectedDrift.length
        },
        toAdd: planAdd,
        toRejoin: planRejoin,
        toUpdate: planRankChange,
        toSoftDelete: willSoftDeleteFull.map(m => ({ _id: m._id, title: m.title, year: m.year, oldRank: m.rank })),
        suspectedDrift
      };
    }

    // ───── 闸 2：漂移阻断 ─────
    if (suspectedDrift.length > 0) {
      return {
        success: false,
        code: 'DRIFT_SUSPECTED',
        suspectedDrift,
        message: '检测到疑似 _id 漂移（同一部电影 title/year 变化导致），拒绝写入。请先归一化历史数据或调整 _id 生成规则。'
      };
    }

    console.log('开始处理图片...');

    // 为了防止下载图片瞬间并发过大引发超时，我们将250张图片分批次处理
    const CHUNK_SIZE = 25;
    let stoppedEarly = false;
    const newEntries = []; // 新增 / 回归项，用于事件落库
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
            newEntries.push({ _id, title: movieData.title, year: movieData.year, rank: movieData.rank, enterReason: 'rejoin' });
          } else {
            delete movieData.enterTop250Time;
          }
          moviesToUpdate.push(movieData);
        } else {
          movieData.createTime = db.serverDate();
          moviesToAdd.push(movieData);
          newEntries.push({ _id, title: movieData.title, year: movieData.year, rank: movieData.rank, enterReason: 'new' });
        }
      });
      // 等待这批图片处理完，再去处理下一批
      await Promise.all(chunkPromises);
    }

    console.log(`抓取完成: 共找到 ${newMoviesList.length} 部，其中 ${moviesToAdd.length} 部新增，${moviesToUpdate.length} 部需要更新。`);

    // 找出跌出 Top250 的老电影（基于已实际处理的 newMoviesList，避免 stoppedEarly 时误判）
    const processedIdSet = new Set(newMoviesList.map(m => m._id));
    const moviesToSoftDeleteIds = stoppedEarly
      ? []
      : allExistingMovies
          .filter(m => m.isTop250 !== false && !processedIdSet.has(m._id))
          .map(m => m._id);

    if (stoppedEarly) {
      console.log('stoppedEarly=true，跳过软删除步骤，避免误伤未处理的电影');
    } else {
      console.log(`需要软删除掉榜电影: ${moviesToSoftDeleteIds.length} 部`);
    }

    // ================= 执行数据库写入操作 =================

    // 0. 写回滚快照（覆盖式 upsert），即使本次软删除列表为空也写，保留 runAt
    await upsertMetaDoc(ROLLBACK_DOC_ID, {
      runAt: db.serverDate(),
      ids: moviesToSoftDeleteIds,
      stoppedEarly
    });

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

    // 4. 写新片入榜事件 → push_events 通用集合（stoppedEarly 时不写，避免数据不完整）
    if (!stoppedEarly && newEntries.length > 0) {
      try {
        const eventDate = new Date().toISOString().slice(0, 10);
        await pushEventsCollection.add({
          data: {
            topic: 'top250NewEntry',
            theme: 'douban',
            eventDate,
            payload: { entries: newEntries },
            pushedAt: null,
            createdAt: db.serverDate()
          }
        });
      } catch (e) {
        console.error('写 push_events (top250_new_entry) 失败（不影响主流程）:', e && e.message);
      }
    }

    // 5. 写版本号（前端缓存协调用，stoppedEarly 时不更新）
    if (!stoppedEarly) {
      try {
        const prev = await readMetaDoc(VERSION_DOC_ID);
        const newVersion = Date.now();
        await upsertMetaDoc(VERSION_DOC_ID, {
          version: newVersion,
          previousVersion: prev && prev.version ? prev.version : null,
          count: newMoviesList.length,
          updatedAt: db.serverDate()
        });
      } catch (e) {
        console.error('写 metaInfo 版本号失败（不影响主流程）:', e && e.message);
      }
    }

    // 6. 写每日排名快照 + 与上次快照对比生成排名变化事件（stoppedEarly 时跳过，避免不完整）
    let rankChangesCount = 0;
    if (!stoppedEarly) {
      try {
        const dateStr = new Date().toISOString().slice(0, 10);
        const todayDocId = `${dateStr}_douban`;

        const todayRanks = {};
        const titleById = {};
        for (const m of newMoviesList) {
          todayRanks[m._id] = m.rank;
          titleById[m._id] = m.title;
        }

        const prev = await readPrevRankSnapshot('douban', todayDocId);
        if (prev && prev.ranks) {
          const changes = [];
          for (const movieId in todayRanks) {
            const newRank = todayRanks[movieId];
            const oldRank = prev.ranks[movieId];
            if (oldRank != null && oldRank !== newRank) {
              changes.push({
                movieId,
                title: titleById[movieId],
                oldRank,
                newRank,
                delta: newRank - oldRank
              });
            }
          }
          rankChangesCount = changes.length;
          if (changes.length > 0) {
            await pushEventsCollection.add({
              data: {
                topic: 'top250RankChange',
                theme: 'douban',
                eventDate: dateStr,
                payload: { changes, prevSnapshotDate: prev.date },
                pushedAt: null,
                createdAt: db.serverDate()
              }
            });
          }
        }

        await upsertRankSnapshot(todayDocId, {
          date: dateStr,
          theme: 'douban',
          ranks: todayRanks,
          createdAt: db.serverDate()
        });
      } catch (e) {
        console.error('写排名快照 / 排名变化事件失败（不影响主流程）:', e && e.message);
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
      newEntries: newEntries.length,
      rankChanges: rankChangesCount,
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
