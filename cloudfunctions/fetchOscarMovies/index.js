// cloudfunctions/fetchOscarMovies/index.js
const cloud = require('wx-server-sdk');
const axios = require('axios');
const cheerio = require('cheerio');

cloud.init({
    env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const oscarCollection = db.collection('oscar_movies');

// 历届奥斯卡最佳影片列表（部分示例，可全量补充。届数/年份/原名）
// 我们使用 届数 作为 rank，同时记录 年份(获奖)、原名，然后自动去豆瓣查 中文名、封面 和 评分
const oscarList = [
    { rank: 96, year: "2024", title: "Oppenheimer" },
    { rank: 95, year: "2023", title: "Everything Everywhere All at Once" },
    { rank: 94, year: "2022", title: "CODA" },
    { rank: 93, year: "2021", title: "Nomadland" },
    { rank: 92, year: "2020", title: "Parasite" },
    { rank: 91, year: "2019", title: "Green Book" },
    { rank: 90, year: "2018", title: "The Shape of Water" },
    { rank: 89, year: "2017", title: "Moonlight" },
    { rank: 88, year: "2016", title: "Spotlight" },
    { rank: 87, year: "2015", title: "Birdman" },
    { rank: 86, year: "2014", title: "12 Years a Slave" },
    { rank: 85, year: "2013", title: "Argo" },
    { rank: 84, year: "2012", title: "The Artist" },
    { rank: 83, year: "2011", title: "The King's Speech" },
    { rank: 82, year: "2010", title: "The Hurt Locker" },
    { rank: 81, year: "2009", title: "Slumdog Millionaire" },
    { rank: 80, year: "2008", title: "No Country for Old Men" },
    { rank: 79, year: "2007", title: "The Departed" },
    { rank: 78, year: "2006", title: "Crash" },
    { rank: 77, year: "2005", title: "Million Dollar Baby" },
    { rank: 76, year: "2004", title: "The Lord of the Rings: The Return of the King" },
    { rank: 75, year: "2003", title: "Chicago" },
    { rank: 74, year: "2002", title: "A Beautiful Mind" },
    { rank: 73, year: "2001", title: "Gladiator" },
    { rank: 72, year: "2000", title: "American Beauty" },
    { rank: 71, year: "1999", title: "Shakespeare in Love" },
    { rank: 70, year: "1998", title: "Titanic" },
    { rank: 69, year: "1997", title: "The English Patient" },
    { rank: 68, year: "1996", title: "Braveheart" },
    { rank: 67, year: "1995", title: "Forrest Gump" },
    { rank: 66, year: "1994", title: "Schindler's List" },
    { rank: 65, year: "1993", title: "Unforgiven" },
    { rank: 64, year: "1992", title: "The Silence of the Lambs" },
    { rank: 63, year: "1991", title: "Dances with Wolves" },
    { rank: 62, year: "1990", title: "Driving Miss Daisy" },
    { rank: 61, year: "1989", title: "Rain Man" },
    { rank: 60, year: "1988", title: "The Last Emperor" },
    { rank: 59, year: "1987", title: "Platoon" },
    { rank: 58, year: "1986", title: "Out of Africa" },
    { rank: 57, year: "1985", title: "Amadeus" },
    { rank: 56, year: "1984", title: "Terms of Endearment" },
    { rank: 55, year: "1983", title: "Gandhi" },
    { rank: 54, year: "1982", title: "Chariots of Fire" },
    { rank: 53, year: "1981", title: "Ordinary People" },
    { rank: 52, year: "1980", title: "Kramer vs. Kramer" },
    { rank: 51, year: "1979", title: "The Deer Hunter" },
    { rank: 50, year: "1978", title: "Annie Hall" },
    { rank: 49, year: "1977", title: "Rocky" },
    { rank: 48, year: "1976", title: "One Flew Over the Cuckoo's Nest" },
    { rank: 47, year: "1975", title: "The Godfather Part II" },
    { rank: 46, year: "1974", title: "The Sting" },
    { rank: 45, year: "1973", title: "The Godfather" },
    { rank: 44, year: "1972", title: "The French Connection" },
    { rank: 43, year: "1971", title: "Patton" },
    { rank: 42, year: "1970", title: "Midnight Cowboy" },
    { rank: 41, year: "1969", title: "Oliver!" },
    { rank: 40, year: "1968", title: "In the Heat of the Night" },
    { rank: 39, year: "1967", title: "A Man for All Seasons" },
    { rank: 38, year: "1966", title: "The Sound of Music" },
    { rank: 37, year: "1965", title: "My Fair Lady" },
    { rank: 36, year: "1964", title: "Tom Jones" },
    { rank: 35, year: "1963", title: "Lawrence of Arabia" },
    { rank: 34, year: "1962", title: "West Side Story" },
    { rank: 33, year: "1961", title: "The Apartment" },
    { rank: 32, year: "1960", title: "Ben-Hur" },
    { rank: 31, year: "1959", title: "Gigi" },
    { rank: 30, year: "1958", title: "The Bridge on the River Kwai" },
    { rank: 29, year: "1957", title: "Around the World in 80 Days" },
    { rank: 28, year: "1956", title: "Marty" },
    { rank: 27, year: "1955", title: "On the Waterfront" },
    { rank: 26, year: "1954", title: "From Here to Eternity" },
    { rank: 25, year: "1953", title: "The Greatest Show on Earth" },
    { rank: 24, year: "1952", title: "An American in Paris" },
    { rank: 23, year: "1951", title: "All About Eve" },
    { rank: 22, year: "1950", title: "All the King's Men" },
    { rank: 21, year: "1949", title: "Hamlet" },
    { rank: 20, year: "1948", title: "Gentleman's Agreement" },
    { rank: 19, year: "1947", title: "The Best Years of Our Lives" },
    { rank: 18, year: "1946", title: "The Lost Weekend" },
    { rank: 17, year: "1945", title: "Going My Way" },
    { rank: 16, year: "1944", title: "Casablanca" },
    { rank: 15, year: "1943", title: "Mrs. Miniver" },
    { rank: 14, year: "1942", title: "How Green Was My Valley" },
    { rank: 13, year: "1941", title: "Rebecca" },
    { rank: 12, year: "1940", title: "Gone with the Wind" },
    { rank: 11, year: "1939", title: "You Can't Take It with You" },
    { rank: 10, year: "1938", title: "The Life of Emile Zola" },
    { rank: 9, year: "1937", title: "The Great Ziegfeld" },
    { rank: 8, year: "1936", title: "Mutiny on the Bounty" },
    { rank: 7, year: "1935", title: "It Happened One Night" },
    { rank: 6, year: "1934", title: "Cavalcade" },
    { rank: 5, year: "1932", title: "Grand Hotel" },
    { rank: 4, year: "1931", title: "Cimarron" },
    { rank: 3, year: "1930", title: "All Quiet on the Western Front" },
    { rank: 2, year: "1929", title: "The Broadway Melody" },
    { rank: 1, year: "1928", title: "Wings" }
];

/**
 * 搜索豆瓣提取中文名、封面、评分
 */
async function fetchDoubanInfo(movieTitle, year) {
    try {
        // 我们去掉 year，因为奥斯卡颁奖年份往往是电影上映的下一年，搜 year 容易搜不到
        const searchUrl = `https://m.douban.com/search/?query=${encodeURIComponent(movieTitle)}`;
        const res = await axios.get(searchUrl, {
            timeout: 10000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.3 Mobile/15E148 Safari/604.1',
                'Accept-Charset': 'utf-8'
            }
        });

        const $ = cheerio.load(res.data);

        let firstResult = null;
        $('.search-module li').each((i, el) => {
            const href = $(el).find('a').attr('href');
            if (href && href.includes('/movie/subject/') && !firstResult) {
                firstResult = $(el);
            }
        });

        if (firstResult) {
            const subjectUrl = firstResult.find('a').attr('href');
            const coverUrl = firstResult.find('img').attr('src');
            let zhTitle = firstResult.find('.subject-title').text().trim();
            const rating = firstResult.find('.rating span:nth-child(2)').text().trim(); // 比如 8.9

            // 从URL中提取 douban id, 如 /movie/subject/1292722/ -> 1292722
            let doubanId = `oscar_${movieTitle.replace(/\s+/g, '_')}`; // 默认 fallback
            if (subjectUrl) {
                const match = subjectUrl.match(/\/subject\/(\d+)\//);
                if (match && match[1]) {
                    doubanId = match[1];
                }
            }

            return {
                _id: `oscar_${doubanId}`, // 添加 oscar_ 前缀作为主键以防冲突
                doubanId: doubanId,
                title: zhTitle || movieTitle,
                originalTitle: movieTitle,
                coverUrl: coverUrl || '',
                rating: rating ? parseFloat(rating) : 0
            };
        }
    } catch (error) {
        console.error(`Fetch douban info failed for ${movieTitle}:`, error.message);
    }
    return null;
}

/**
 * 下载图片并上传
 */
async function downloadAndUploadImage(imageUrl, movieId) {
    try {
        // 拉取最佳质量大图 （s_ratio_poster -> m_ratio_poster）
        // 豆瓣通常m图比较稳定，大图有些没有权限访问。如果直接抓取的是 s_ratio_poster，我们可以升级为 m
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

        const fileName = `oscar_covers/${movieId}_${Date.now()}.jpg`;
        const uploadResult = await cloud.uploadFile({
            cloudPath: fileName,
            fileContent: response.data
        });

        return uploadResult.fileID;

    } catch (e) {
        console.warn(`Image download failed for ${movieId}, fallback to original url`, e.message);
        return imageUrl; // fallback
    }
}

exports.main = async (event, context) => {
    const _ = db.command;
    const START_TIME = Date.now();
    const TIME_LIMIT = 45000;

    try {
        console.log('Starting Oscar scraping...');

        // 获取已存在的记录，避免重复抓取
        const existingRes = await oscarCollection.limit(1000).get();
        const existingMap = {};
        existingRes.data.forEach(m => existingMap[m._id] = m);

        let moviesToAdd = [];
        let moviesToUpdate = [];
        let processedCount = 0;
        let stoppedEarly = false;

        // 我们按照倒序抓取（从最新的第96届开始往下）
        const sortedList = oscarList.sort((a, b) => b.rank - a.rank);

        for (let i = 0; i < sortedList.length; i++) {
            if (Date.now() - START_TIME > TIME_LIMIT) {
                console.warn(`[Timeout] Execution time > 45s. Stopping safely at index ${i}.`);
                stoppedEarly = true;
                break;
            }

            const movieTarget = sortedList[i];
            let finalMovieData = null;
            let existingRecord = null;

            // 检查库里是否已经有这个 rank 的电影了
            const foundInDb = existingRes.data.find(m => m.rank === movieTarget.rank);

            if (foundInDb && foundInDb.cover && foundInDb.cover.startsWith('cloud://')) {
                // 如果电影标题依然是英文原名，说明之前抓取中文名失败了，强制重试抓取！
                if (foundInDb.title === foundInDb.originalTitle) {
                    console.log(`[Fix Title] ${foundInDb.title} needs re-fetching for Chinese title.`);
                } else {
                    // 已经成功抓取且拥有中文名的，跳过
                    processedCount++;
                    continue;
                }
            }

            console.log(`Fetching douban data for: ${movieTarget.title} (${movieTarget.year})`);

            const doubanInfo = await fetchDoubanInfo(movieTarget.title, movieTarget.year);
            if (doubanInfo) {
                finalMovieData = {
                    _id: doubanInfo._id,
                    rank: movieTarget.rank,
                    year: movieTarget.year,
                    title: doubanInfo.title,
                    originalTitle: doubanInfo.originalTitle,
                    coverUrl: doubanInfo.coverUrl, // 豆瓣原始外链
                    rating: doubanInfo.rating,
                    description: `The ${movieTarget.rank}th Academy Award for Best Picture`,
                    isTop250: true, // 为了兼容其它组件的代码逻辑使用
                    category: '奥斯卡',
                    theme: 'oscar_movies',
                    updateTime: db.serverDate()
                };

                // 下载并存微信云存储
                if (finalMovieData.coverUrl) {
                    finalMovieData.cover = await downloadAndUploadImage(finalMovieData.coverUrl, finalMovieData._id);
                } else {
                    finalMovieData.cover = '';
                }

                if (existingMap[finalMovieData._id] || foundInDb) {
                    const updateId = foundInDb ? foundInDb._id : finalMovieData._id;
                    delete finalMovieData._id; // 不能更新_id字段

                    // 如果已经有合法封面，就不覆盖了（只更新标题）
                    if (foundInDb && foundInDb.cover && foundInDb.cover.startsWith('cloud://')) {
                        delete finalMovieData.cover;
                    }

                    moviesToUpdate.push({ _id: updateId, data: finalMovieData });
                } else {
                    finalMovieData.createTime = db.serverDate();
                    moviesToAdd.push(finalMovieData);
                }
            }
            processedCount++;
            // 防止请求豆瓣太快被封
            await new Promise(r => setTimeout(r, 800));
        }

        // 批量更新
        for (let update of moviesToUpdate) {
            await oscarCollection.doc(update._id).update({ data: update.data }).catch(console.error);
        }

        // 批量新增
        for (let i = 0; i < moviesToAdd.length; i += 20) {
            const batch = moviesToAdd.slice(i, i + 20);
            await Promise.all(batch.map(m => oscarCollection.add({ data: m }))).catch(console.error);
        }

        return {
            success: true,
            processed: processedCount,
            added: moviesToAdd.length,
            updated: moviesToUpdate.length,
            stoppedEarly
        };

    } catch (err) {
        console.error('Oscar scraping failed:', err);
        return { success: false, error: err.message };
    }
};
