// cloudfunctions/fetchOscarMovies/index.js
const cloud = require('wx-server-sdk');
const axios = require('axios');
const cheerio = require('cheerio');

cloud.init({
    env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const oscarCollection = db.collection('oscar_movies');

// 历届奥斯卡最佳影片完整列表（第1届~第98届）
// rank=届数, year=电影上映年份, title=英文原名, chineseTitle=中文名
// 中文名内置于列表中，无需依赖豆瓣搜索翻译；豆瓣仅用于获取封面和评分
const oscarList = [
    { rank: 98, year: "2025", title: "One Battle After Another", chineseTitle: "一战再战" },
    { rank: 97, year: "2024", title: "Anora", chineseTitle: "阿诺拉" },
    { rank: 96, year: "2023", title: "Oppenheimer", chineseTitle: "奥本海默" },
    { rank: 95, year: "2022", title: "Everything Everywhere All at Once", chineseTitle: "瞬息全宇宙" },
    { rank: 94, year: "2021", title: "CODA", chineseTitle: "健听女孩" },
    { rank: 93, year: "2020", title: "Nomadland", chineseTitle: "无依之地" },
    { rank: 92, year: "2019", title: "Parasite", chineseTitle: "寄生虫" },
    { rank: 91, year: "2018", title: "Green Book", chineseTitle: "绿皮书" },
    { rank: 90, year: "2017", title: "The Shape of Water", chineseTitle: "水形物语" },
    { rank: 89, year: "2016", title: "Moonlight", chineseTitle: "月光男孩" },
    { rank: 88, year: "2015", title: "Spotlight", chineseTitle: "聚焦" },
    { rank: 87, year: "2014", title: "Birdman", chineseTitle: "鸟人" },
    { rank: 86, year: "2013", title: "12 Years a Slave", chineseTitle: "为奴十二年" },
    { rank: 85, year: "2012", title: "Argo", chineseTitle: "逃离德黑兰" },
    { rank: 84, year: "2011", title: "The Artist", chineseTitle: "艺术家" },
    { rank: 83, year: "2010", title: "The King's Speech", chineseTitle: "国王的演讲" },
    { rank: 82, year: "2009", title: "The Hurt Locker", chineseTitle: "拆弹部队" },
    { rank: 81, year: "2008", title: "Slumdog Millionaire", chineseTitle: "贫民窟的百万富翁" },
    { rank: 80, year: "2007", title: "No Country for Old Men", chineseTitle: "老无所依" },
    { rank: 79, year: "2006", title: "The Departed", chineseTitle: "无间行者" },
    { rank: 78, year: "2005", title: "Crash", chineseTitle: "撞车" },
    { rank: 77, year: "2004", title: "Million Dollar Baby", chineseTitle: "百万美元宝贝" },
    { rank: 76, year: "2003", title: "The Lord of the Rings: The Return of the King", chineseTitle: "指环王：王者无敌" },
    { rank: 75, year: "2002", title: "Chicago", chineseTitle: "芝加哥" },
    { rank: 74, year: "2001", title: "A Beautiful Mind", chineseTitle: "美丽心灵" },
    { rank: 73, year: "2000", title: "Gladiator", chineseTitle: "角斗士" },
    { rank: 72, year: "1999", title: "American Beauty", chineseTitle: "美国丽人" },
    { rank: 71, year: "1998", title: "Shakespeare in Love", chineseTitle: "莎翁情史" },
    { rank: 70, year: "1997", title: "Titanic", chineseTitle: "泰坦尼克号" },
    { rank: 69, year: "1996", title: "The English Patient", chineseTitle: "英国病人" },
    { rank: 68, year: "1995", title: "Braveheart", chineseTitle: "勇敢的心" },
    { rank: 67, year: "1994", title: "Forrest Gump", chineseTitle: "阿甘正传" },
    { rank: 66, year: "1993", title: "Schindler's List", chineseTitle: "辛德勒的名单" },
    { rank: 65, year: "1992", title: "Unforgiven", chineseTitle: "不可饶恕" },
    { rank: 64, year: "1991", title: "The Silence of the Lambs", chineseTitle: "沉默的羔羊" },
    { rank: 63, year: "1990", title: "Dances with Wolves", chineseTitle: "与狼共舞" },
    { rank: 62, year: "1989", title: "Driving Miss Daisy", chineseTitle: "为黛西小姐开车" },
    { rank: 61, year: "1988", title: "Rain Man", chineseTitle: "雨人" },
    { rank: 60, year: "1987", title: "The Last Emperor", chineseTitle: "末代皇帝" },
    { rank: 59, year: "1986", title: "Platoon", chineseTitle: "野战排" },
    { rank: 58, year: "1985", title: "Out of Africa", chineseTitle: "走出非洲" },
    { rank: 57, year: "1984", title: "Amadeus", chineseTitle: "莫扎特传" },
    { rank: 56, year: "1983", title: "Terms of Endearment", chineseTitle: "母女情深" },
    { rank: 55, year: "1982", title: "Gandhi", chineseTitle: "甘地传" },
    { rank: 54, year: "1981", title: "Chariots of Fire", chineseTitle: "烈火战车" },
    { rank: 53, year: "1980", title: "Ordinary People", chineseTitle: "普通人" },
    { rank: 52, year: "1979", title: "Kramer vs. Kramer", chineseTitle: "克莱默夫妇" },
    { rank: 51, year: "1978", title: "The Deer Hunter", chineseTitle: "猎鹿人" },
    { rank: 50, year: "1977", title: "Annie Hall", chineseTitle: "安妮·霍尔" },
    { rank: 49, year: "1976", title: "Rocky", chineseTitle: "洛奇" },
    { rank: 48, year: "1975", title: "One Flew Over the Cuckoo's Nest", chineseTitle: "飞越疯人院" },
    { rank: 47, year: "1974", title: "The Godfather Part II", chineseTitle: "教父2" },
    { rank: 46, year: "1973", title: "The Sting", chineseTitle: "骗中骗" },
    { rank: 45, year: "1972", title: "The Godfather", chineseTitle: "教父" },
    { rank: 44, year: "1971", title: "The French Connection", chineseTitle: "法国贩毒网" },
    { rank: 43, year: "1970", title: "Patton", chineseTitle: "巴顿将军" },
    { rank: 42, year: "1969", title: "Midnight Cowboy", chineseTitle: "午夜牛郎" },
    { rank: 41, year: "1968", title: "Oliver!", chineseTitle: "雾都孤儿" },
    { rank: 40, year: "1967", title: "In the Heat of the Night", chineseTitle: "炎热的夜晚" },
    { rank: 39, year: "1966", title: "A Man for All Seasons", chineseTitle: "良相佐国" },
    { rank: 38, year: "1965", title: "The Sound of Music", chineseTitle: "音乐之声" },
    { rank: 37, year: "1964", title: "My Fair Lady", chineseTitle: "窈窕淑女" },
    { rank: 36, year: "1963", title: "Tom Jones", chineseTitle: "汤姆·琼斯" },
    { rank: 35, year: "1962", title: "Lawrence of Arabia", chineseTitle: "阿拉伯的劳伦斯" },
    { rank: 34, year: "1961", title: "West Side Story", chineseTitle: "西区故事" },
    { rank: 33, year: "1960", title: "The Apartment", chineseTitle: "公寓" },
    { rank: 32, year: "1959", title: "Ben-Hur", chineseTitle: "宾虚" },
    { rank: 31, year: "1958", title: "Gigi", chineseTitle: "琪琪" },
    { rank: 30, year: "1957", title: "The Bridge on the River Kwai", chineseTitle: "桂河大桥" },
    { rank: 29, year: "1956", title: "Around the World in 80 Days", chineseTitle: "环游世界八十天" },
    { rank: 28, year: "1955", title: "Marty", chineseTitle: "马蒂" },
    { rank: 27, year: "1954", title: "On the Waterfront", chineseTitle: "码头风云" },
    { rank: 26, year: "1953", title: "From Here to Eternity", chineseTitle: "乱世忠魂" },
    { rank: 25, year: "1952", title: "The Greatest Show on Earth", chineseTitle: "戏王之王" },
    { rank: 24, year: "1951", title: "An American in Paris", chineseTitle: "一个美国人在巴黎" },
    { rank: 23, year: "1950", title: "All About Eve", chineseTitle: "彗星美人" },
    { rank: 22, year: "1949", title: "All the King's Men", chineseTitle: "当代奸雄" },
    { rank: 21, year: "1948", title: "Hamlet", chineseTitle: "哈姆雷特" },
    { rank: 20, year: "1947", title: "Gentleman's Agreement", chineseTitle: "君子协定" },
    { rank: 19, year: "1946", title: "The Best Years of Our Lives", chineseTitle: "黄金时代" },
    { rank: 18, year: "1945", title: "The Lost Weekend", chineseTitle: "失去的周末" },
    { rank: 17, year: "1944", title: "Going My Way", chineseTitle: "与我同行" },
    { rank: 16, year: "1942", title: "Casablanca", chineseTitle: "卡萨布兰卡" },
    { rank: 15, year: "1942", title: "Mrs. Miniver", chineseTitle: "忠勇之家" },
    { rank: 14, year: "1941", title: "How Green Was My Valley", chineseTitle: "青山翠谷" },
    { rank: 13, year: "1940", title: "Rebecca", chineseTitle: "蝴蝶梦" },
    { rank: 12, year: "1939", title: "Gone with the Wind", chineseTitle: "乱世佳人" },
    { rank: 11, year: "1938", title: "You Can't Take It with You", chineseTitle: "浮生若梦" },
    { rank: 10, year: "1937", title: "The Life of Emile Zola", chineseTitle: "左拉传" },
    { rank: 9, year: "1936", title: "The Great Ziegfeld", chineseTitle: "歌舞大王齐格菲" },
    { rank: 8, year: "1935", title: "Mutiny on the Bounty", chineseTitle: "叛舰喋血记" },
    { rank: 7, year: "1934", title: "It Happened One Night", chineseTitle: "一夜风流" },
    { rank: 6, year: "1933", title: "Cavalcade", chineseTitle: "乱世春秋" },
    { rank: 5, year: "1932", title: "Grand Hotel", chineseTitle: "大饭店" },
    { rank: 4, year: "1931", title: "Cimarron", chineseTitle: "壮志千秋" },
    { rank: 3, year: "1930", title: "All Quiet on the Western Front", chineseTitle: "西线无战事" },
    { rank: 2, year: "1929", title: "The Broadway Melody", chineseTitle: "百老汇旋律" },
    { rank: 1, year: "1927", title: "Wings", chineseTitle: "翼" }
];

/**
 * 搜索豆瓣提取封面和评分
 * 搜索策略：依次尝试 "中文名 年份"、"中文名"、"英文名 年份"
 * 匹配时优先选年份吻合的结果，避免同名电影误匹配
 */
async function fetchDoubanInfo(movieTitle, chineseTitle, year) {
    // 多轮搜索策略：带年份的更精确，纯名称做兜底
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

            // 收集所有电影类型的搜索结果
            const candidates = [];
            $('.search-module li').each((i, el) => {
                const href = $(el).find('a').attr('href');
                if (href && href.includes('/movie/subject/')) {
                    const subjectUrl = href;
                    const coverUrl = $(el).find('img').attr('src');
                    const rating = $(el).find('.rating span:nth-child(2)').text().trim();
                    const infoText = $(el).text(); // 包含年份等信息

                    let doubanId = '';
                    const match = subjectUrl.match(/\/subject\/(\d+)\//);
                    if (match && match[1]) doubanId = match[1];

                    // 检查搜索结果文本中是否包含目标年份
                    const yearMatch = infoText.includes(year);

                    candidates.push({ subjectUrl, coverUrl, rating, doubanId, yearMatch });
                }
            });

            if (candidates.length === 0) continue;

            // 优先选年份匹配的结果，否则取第一个
            const best = candidates.find(c => c.yearMatch) || candidates[0];

            if (best && best.doubanId) {
                console.log(`  -> Matched douban ID: ${best.doubanId}, year match: ${best.yearMatch}, query: "${query}"`);
                return {
                    _id: `oscar_${best.doubanId}`,
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
    // forceRefresh: true 强制重新抓取封面（修复错误封面时使用）
    // startFrom: 从指定届数开始（用于断点续传，如 startFrom:70 表示从第70届开始往下）
    const forceRefresh = (event && event.forceRefresh) || false;
    const startFrom = (event && event.startFrom) || 0;

    try {
        console.log(`Starting Oscar scraping... (forceRefresh=${forceRefresh}, startFrom=${startFrom})`);

        // 获取已存在的记录，避免重复抓取
        const existingRes = await oscarCollection.limit(1000).get();
        const existingMap = {};
        existingRes.data.forEach(m => existingMap[m._id] = m);

        let moviesToAdd = [];
        let moviesToUpdate = [];
        let processedCount = 0;
        let stoppedEarly = false;

        // 按照倒序抓取（从最新的一届开始往下）
        let sortedList = oscarList.sort((a, b) => b.rank - a.rank);

        // 如果指定了 startFrom，跳到对应位置
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
            let existingRecord = null;

            // 检查库里是否已经有这个 rank 的电影了
            const foundInDb = existingRes.data.find(m => m.rank === movieTarget.rank);

            if (!forceRefresh && foundInDb && foundInDb.cover && foundInDb.cover.startsWith('cloud://') &&
                foundInDb.title === movieTarget.chineseTitle) {
                // 已经成功抓取且中文名一致的，跳过（非强制刷新模式）
                processedCount++;
                continue;
            }

            console.log(`Fetching douban data for: ${movieTarget.chineseTitle} / ${movieTarget.title} (${movieTarget.year})`);

            const doubanInfo = await fetchDoubanInfo(movieTarget.title, movieTarget.chineseTitle, movieTarget.year);
            if (doubanInfo) {
                finalMovieData = {
                    _id: doubanInfo._id,
                    rank: movieTarget.rank,
                    year: movieTarget.year,
                    title: movieTarget.chineseTitle, // 使用内置中文名，不依赖豆瓣解析
                    originalTitle: movieTarget.title,
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

                    // 非强制模式下，如果已经有合法封面，就不覆盖
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
            // 防止请求豆瓣太快被封
            await new Promise(r => setTimeout(r, 800));
        }

        // 记录最后处理到的届数，供下次断点续传
        const lastProcessedRank = sortedList[Math.min(processedCount, sortedList.length) - 1];
        const nextStartFrom = lastProcessedRank ? lastProcessedRank.rank - 1 : 0;

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
            stoppedEarly,
            nextStartFrom: stoppedEarly ? nextStartFrom : 0,
            hint: stoppedEarly ? `下次请传入 { "forceRefresh": true, "startFrom": ${nextStartFrom} } 继续` : '全部处理完成'
        };

    } catch (err) {
        console.error('Oscar scraping failed:', err);
        return { success: false, error: err.message };
    }
};
