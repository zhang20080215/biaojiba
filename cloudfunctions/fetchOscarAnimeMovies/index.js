// cloudfunctions/fetchOscarAnimeMovies/index.js
// 奥斯卡最佳动画长篇（Best Animated Feature，自第74届起设立）每届获奖动画
// 结构完全沿用 fetchOscarMovies：rank=届数, year=电影上映年份, title=中文名, originalTitle=英文原名
// 中文名内置，豆瓣仅用于获取封面和评分。
const cloud = require('wx-server-sdk');
const axios = require('axios');
const cheerio = require('cheerio');

cloud.init({
    env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const oscarCollection = db.collection('oscar_anime_movies');

// 历届奥斯卡最佳动画长篇获奖名单（第74届~第98届）
// year = 电影上映年份（= 颁奖届年份 - 1），与 oscar 最佳影片主题保持一致
const oscarList = [
    { rank: 98, year: "2025", title: "Kpop 猎魔女团", originalTitle: "KPop Demon Hunters" },
    { rank: 97, year: "2024", title: "猫猫的奇幻漂流", originalTitle: "Flow" },
    { rank: 96, year: "2023", title: "你想活出怎样的人生", originalTitle: "The Boy and the Heron" },
    { rank: 95, year: "2022", title: "吉尔莫·德尔·托罗的匹诺曹", originalTitle: "Guillermo del Toro's Pinocchio" },
    { rank: 94, year: "2021", title: "魔法满屋", originalTitle: "Encanto" },
    { rank: 93, year: "2020", title: "心灵奇旅", originalTitle: "Soul" },
    { rank: 92, year: "2019", title: "玩具总动员4", originalTitle: "Toy Story 4" },
    { rank: 91, year: "2018", title: "蜘蛛侠：平行宇宙", originalTitle: "Spider-Man: Into the Spider-Verse" },
    { rank: 90, year: "2017", title: "寻梦环游记", originalTitle: "Coco" },
    { rank: 89, year: "2016", title: "疯狂动物城", originalTitle: "Zootopia" },
    { rank: 88, year: "2015", title: "头脑特工队", originalTitle: "Inside Out" },
    { rank: 87, year: "2014", title: "超能陆战队", originalTitle: "Big Hero 6" },
    { rank: 86, year: "2013", title: "冰雪奇缘", originalTitle: "Frozen" },
    { rank: 85, year: "2012", title: "勇敢传说", originalTitle: "Brave" },
    { rank: 84, year: "2011", title: "兰戈", originalTitle: "Rango" },
    { rank: 83, year: "2010", title: "玩具总动员3", originalTitle: "Toy Story 3" },
    { rank: 82, year: "2009", title: "飞屋环游记", originalTitle: "Up" },
    { rank: 81, year: "2008", title: "机器人总动员", originalTitle: "WALL-E" },
    { rank: 80, year: "2007", title: "美食总动员", originalTitle: "Ratatouille" },
    { rank: 79, year: "2006", title: "快乐的大脚", originalTitle: "Happy Feet" },
    { rank: 78, year: "2005", title: "超级无敌掌门狗：人兔的诅咒", originalTitle: "Wallace & Gromit: The Curse of the Were-Rabbit" },
    { rank: 77, year: "2004", title: "超人总动员", originalTitle: "The Incredibles" },
    { rank: 76, year: "2003", title: "海底总动员", originalTitle: "Finding Nemo" },
    { rank: 75, year: "2002", title: "千与千寻", originalTitle: "Spirited Away" },
    { rank: 74, year: "2001", title: "怪物史莱克", originalTitle: "Shrek" }
];

/**
 * 搜索豆瓣提取封面和评分
 * 搜索策略：依次尝试 "中文名 年份"、"中文名"、"英文名 年份"
 * 匹配时优先选年份吻合的结果，避免同名电影误匹配
 */
async function fetchDoubanInfo(movieTitle, chineseTitle, year) {
    const searchQueries = [
        chineseTitle ? `${chineseTitle} ${year}` : null,
        chineseTitle,
        `${movieTitle} ${year}`,
        movieTitle
    ].filter(Boolean);

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
                    const subjectUrl = href;
                    const coverUrl = $(el).find('img').attr('src');
                    const rating = $(el).find('.rating span:nth-child(2)').text().trim();
                    const infoText = $(el).text();

                    let doubanId = '';
                    const match = subjectUrl.match(/\/subject\/(\d+)\//);
                    if (match && match[1]) doubanId = match[1];

                    const yearMatch = infoText.includes(year);

                    candidates.push({ subjectUrl, coverUrl, rating, doubanId, yearMatch });
                }
            });

            if (candidates.length === 0) continue;

            const best = candidates.find(c => c.yearMatch) || candidates[0];

            if (best && best.doubanId) {
                console.log(`  -> Matched douban ID: ${best.doubanId}, year match: ${best.yearMatch}, query: "${query}"`);
                return {
                    doubanId: best.doubanId,
                    coverUrl: best.coverUrl || '',
                    rating: best.rating ? parseFloat(best.rating) : 0
                };
            }
        } catch (error) {
            console.error(`Fetch douban info failed for "${query}":`, error.message);
        }
    }
    return null;
}

/**
 * 下载图片并上传
 */
async function downloadAndUploadImage(imageUrl, movieId) {
    try {
        const highResBufferUrl = imageUrl.replace('/s_ratio_poster/', '/m_ratio_poster/');

        const response = await axios({
            url: highResBufferUrl,
            responseType: 'arraybuffer',
            timeout: 15000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Referer': 'https://movie.douban.com/'
            }
        });

        const fileName = `oscar_anime_covers/${movieId}_${Date.now()}.jpg`;
        const uploadResult = await cloud.uploadFile({
            cloudPath: fileName,
            fileContent: response.data
        });

        return uploadResult.fileID;

    } catch (e) {
        console.warn(`Image download failed for ${movieId}, fallback to original url`, e.message);
        return imageUrl;
    }
}

exports.main = async (event, context) => {
    const _ = db.command;
    const START_TIME = Date.now();
    const TIME_LIMIT = 45000;
    const forceRefresh = (event && event.forceRefresh) || false;
    const startFrom = (event && event.startFrom) || 0;

    try {
        console.log(`Starting Oscar Animation scraping... (forceRefresh=${forceRefresh}, startFrom=${startFrom})`);

        const existingRes = await oscarCollection.limit(1000).get();
        const existingMap = {};
        existingRes.data.forEach(m => existingMap[m._id] = m);

        let moviesToAdd = [];
        let moviesToUpdate = [];
        let processedCount = 0;
        let stoppedEarly = false;
        // 记录本轮已用过的 doubanId → rank，用于发现「两部不同电影匹配到同一个豆瓣条目」的误匹配
        const seenDoubanIds = {};

        let sortedList = oscarList.sort((a, b) => b.rank - a.rank);

        if (startFrom > 0) {
            sortedList = sortedList.filter(m => m.rank <= startFrom);
            console.log(`Resuming from rank ${startFrom}, ${sortedList.length} movies remaining`);
        }

        for (let i = 0; i < sortedList.length; i++) {
            if (Date.now() - START_TIME > TIME_LIMIT) {
                console.warn(`[Timeout] Execution time > 45s. Stopping safely at index ${i}.`);
                stoppedEarly = true;
                break;
            }

            const movieTarget = sortedList[i];
            let finalMovieData = null;

            const foundInDb = existingRes.data.find(m => m.rank === movieTarget.rank);

            if (!forceRefresh && foundInDb && foundInDb.cover && foundInDb.cover.startsWith('cloud://') &&
                foundInDb.title === movieTarget.title) {
                processedCount++;
                continue;
            }

            console.log(`Fetching douban data for: ${movieTarget.title} / ${movieTarget.originalTitle} (${movieTarget.year})`);

            const doubanInfo = await fetchDoubanInfo(movieTarget.originalTitle, movieTarget.title, movieTarget.year);
            if (doubanInfo) {
                // 误匹配预警：同一 doubanId 被两个不同届数命中，说明其中一部抓错了封面/评分
                if (seenDoubanIds[doubanInfo.doubanId] != null) {
                    console.warn(`[误匹配] 第${movieTarget.rank}届「${movieTarget.title}」与第${seenDoubanIds[doubanInfo.doubanId]}届 都匹配到豆瓣条目 ${doubanInfo.doubanId}，请人工核对封面`);
                } else {
                    seenDoubanIds[doubanInfo.doubanId] = movieTarget.rank;
                }
                // _id 用「届数」生成（74~98 唯一），保证不会因豆瓣条目重复而 _id 冲突，且重复运行幂等
                finalMovieData = {
                    _id: `oscar_anime_${movieTarget.rank}`,
                    rank: movieTarget.rank,
                    year: movieTarget.year,
                    title: movieTarget.title,
                    originalTitle: movieTarget.originalTitle,
                    doubanId: doubanInfo.doubanId,
                    coverUrl: doubanInfo.coverUrl,
                    rating: doubanInfo.rating,
                    description: `The ${movieTarget.rank}th Academy Award for Best Animated Feature`,
                    isTop250: true,
                    category: '奥斯卡动画',
                    theme: 'oscar_anime_movies',
                    updateTime: db.serverDate()
                };

                if (finalMovieData.coverUrl) {
                    finalMovieData.cover = await downloadAndUploadImage(finalMovieData.coverUrl, finalMovieData._id);
                } else {
                    finalMovieData.cover = '';
                }

                if (existingMap[finalMovieData._id] || foundInDb) {
                    const updateId = foundInDb ? foundInDb._id : finalMovieData._id;
                    delete finalMovieData._id;

                    if (!forceRefresh && foundInDb && foundInDb.cover && foundInDb.cover.startsWith('cloud://')) {
                        delete finalMovieData.cover;
                    }

                    moviesToUpdate.push({ _id: updateId, data: finalMovieData });
                } else {
                    finalMovieData.createTime = db.serverDate();
                    moviesToAdd.push(finalMovieData);
                }
            }
            processedCount++;
            await new Promise(r => setTimeout(r, 800));
        }

        const lastProcessedRank = sortedList[Math.min(processedCount, sortedList.length) - 1];
        const nextStartFrom = lastProcessedRank ? lastProcessedRank.rank - 1 : 0;

        for (let update of moviesToUpdate) {
            await oscarCollection.doc(update._id).update({ data: update.data }).catch(console.error);
        }

        for (let i = 0; i < moviesToAdd.length; i += 20) {
            const batch = moviesToAdd.slice(i, i + 20);
            await Promise.all(batch.map(m => oscarCollection.add({ data: m }))).catch(console.error);
        }

        return {
            success: true,
            processed: processedCount,
            added: moviesToAdd.length,
            updated: moviesToUpdate.length,
            stoppedEarly,
            nextStartFrom: stoppedEarly ? nextStartFrom : 0,
            hint: stoppedEarly ? `下次请传入 { "forceRefresh": true, "startFrom": ${nextStartFrom} } 继续` : '全部处理完成'
        };

    } catch (err) {
        console.error('Oscar Animation scraping failed:', err);
        return { success: false, error: err.message };
    }
};
