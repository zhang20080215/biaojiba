// cloudfunctions/fetchBoxofficeMovies/index.js
// 全球电影票房榜数据导入 - 硬编码全球票房TOP100电影数据
// 支持从豆瓣抓取封面并上传至微信云存储

const cloud = require('wx-server-sdk');
const axios = require('axios');
const cheerio = require('cheerio');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const COLLECTION = 'boxoffice_movies';

// 全球电影票房榜TOP100（数据来源：Box Office Mojo，截至2026年3月）
// 票房单位：美元（未经通胀调整）
const BOXOFFICE_DATA = [
  { rank: 1, title: '阿凡达', originalTitle: 'Avatar', year: 2009, country: '美国', boxOffice: 2923710708, director: 'James Cameron' },
  { rank: 2, title: '复仇者联盟4：终局之战', originalTitle: 'Avengers: Endgame', year: 2019, country: '美国', boxOffice: 2799439100, director: 'Anthony Russo' },
  { rank: 3, title: '阿凡达：水之道', originalTitle: 'Avatar: The Way of Water', year: 2022, country: '美国', boxOffice: 2334484620, director: 'James Cameron' },
  { rank: 4, title: '泰坦尼克号', originalTitle: 'Titanic', year: 1997, country: '美国', boxOffice: 2264812968, director: 'James Cameron' },
  { rank: 5, title: '哪吒之魔童闹海', originalTitle: 'Ne Zha 2', year: 2025, country: '中国', boxOffice: 2260176370, director: '饺子' },
  { rank: 6, title: '星球大战7：原力觉醒', originalTitle: 'Star Wars: The Force Awakens', year: 2015, country: '美国', boxOffice: 2071310218, director: 'J.J. Abrams' },
  { rank: 7, title: '复仇者联盟3：无限战争', originalTitle: 'Avengers: Infinity War', year: 2018, country: '美国', boxOffice: 2052415039, director: 'Anthony Russo' },
  { rank: 8, title: '蜘蛛侠：英雄无归', originalTitle: 'Spider-Man: No Way Home', year: 2021, country: '美国', boxOffice: 1921426073, director: 'Jon Watts' },
  { rank: 9, title: '疯狂动物城2', originalTitle: 'Zootopia 2', year: 2025, country: '美国', boxOffice: 1866578288, director: 'Byron Howard' },
  { rank: 10, title: '头脑特工队2', originalTitle: 'Inside Out 2', year: 2024, country: '美国', boxOffice: 1698863816, director: 'Kelsey Mann' },
  { rank: 11, title: '侏罗纪世界', originalTitle: 'Jurassic World', year: 2015, country: '美国', boxOffice: 1671537444, director: 'Colin Trevorrow' },
  { rank: 12, title: '狮子王', originalTitle: 'The Lion King', year: 2019, country: '美国', boxOffice: 1662020819, director: 'Jon Favreau' },
  { rank: 13, title: '复仇者联盟', originalTitle: 'The Avengers', year: 2012, country: '美国', boxOffice: 1520538536, director: 'Joss Whedon' },
  { rank: 14, title: '速度与激情7', originalTitle: 'Furious 7', year: 2015, country: '美国', boxOffice: 1515342457, director: 'James Wan' },
  { rank: 15, title: '壮志凌云2：独行侠', originalTitle: 'Top Gun: Maverick', year: 2022, country: '美国', boxOffice: 1503997086, director: 'Joseph Kosinski' },
  { rank: 16, title: '阿凡达：火与灰', originalTitle: 'Avatar: Fire and Ash', year: 2025, country: '美国', boxOffice: 1485605263, director: 'James Cameron' },
  { rank: 17, title: '冰雪奇缘2', originalTitle: 'Frozen II', year: 2019, country: '美国', boxOffice: 1453683476, director: 'Chris Buck' },
  { rank: 18, title: '芭比', originalTitle: 'Barbie', year: 2023, country: '美国', boxOffice: 1447138421, director: 'Greta Gerwig' },
  { rank: 19, title: '复仇者联盟2：奥创纪元', originalTitle: 'Avengers: Age of Ultron', year: 2015, country: '美国', boxOffice: 1405018048, director: 'Joss Whedon' },
  { rank: 20, title: '超级马力欧兄弟大电影', originalTitle: 'The Super Mario Bros. Movie', year: 2023, country: '美国/日本', boxOffice: 1360879735, director: 'Aaron Horvath' },
  { rank: 21, title: '黑豹', originalTitle: 'Black Panther', year: 2018, country: '美国', boxOffice: 1349926083, director: 'Ryan Coogler' },
  { rank: 22, title: '哈利·波特与死亡圣器（下）', originalTitle: 'Harry Potter and the Deathly Hallows: Part 2', year: 2011, country: '英国/美国', boxOffice: 1342942050, director: 'David Yates' },
  { rank: 23, title: '死侍与金刚狼', originalTitle: 'Deadpool & Wolverine', year: 2024, country: '美国', boxOffice: 1338073645, director: 'Shawn Levy' },
  { rank: 24, title: '星球大战8：最后的绝地武士', originalTitle: 'Star Wars: The Last Jedi', year: 2017, country: '美国', boxOffice: 1334407706, director: 'Rian Johnson' },
  { rank: 25, title: '冰雪奇缘', originalTitle: 'Frozen', year: 2013, country: '美国', boxOffice: 1312075093, director: 'Chris Buck' },
  { rank: 26, title: '侏罗纪世界2：殒落国度', originalTitle: 'Jurassic World: Fallen Kingdom', year: 2018, country: '美国', boxOffice: 1308566455, director: 'J.A. Bayona' },
  { rank: 27, title: '美女与野兽', originalTitle: 'Beauty and the Beast', year: 2017, country: '美国', boxOffice: 1266115964, director: 'Bill Condon' },
  { rank: 28, title: '超人总动员2', originalTitle: 'Incredibles 2', year: 2018, country: '美国', boxOffice: 1243225667, director: 'Brad Bird' },
  { rank: 29, title: '速度与激情8', originalTitle: 'The Fate of the Furious', year: 2017, country: '美国', boxOffice: 1236009236, director: 'F. Gary Gray' },
  { rank: 30, title: '钢铁侠3', originalTitle: 'Iron Man 3', year: 2013, country: '美国', boxOffice: 1215577205, director: 'Shane Black' },
  { rank: 31, title: '小黄人大眼萌', originalTitle: 'Minions', year: 2015, country: '美国', boxOffice: 1159457503, director: 'Kyle Balda' },
  { rank: 32, title: '美国队长3：内战', originalTitle: 'Captain America: Civil War', year: 2016, country: '美国', boxOffice: 1155046416, director: 'Anthony Russo' },
  { rank: 33, title: '海王', originalTitle: 'Aquaman', year: 2018, country: '美国', boxOffice: 1152028393, director: 'James Wan' },
  { rank: 34, title: '指环王3：王者无敌', originalTitle: 'The Lord of the Rings: The Return of the King', year: 2003, country: '新西兰/美国', boxOffice: 1149019383, director: 'Peter Jackson' },
  { rank: 35, title: '蜘蛛侠：英雄远征', originalTitle: 'Spider-Man: Far from Home', year: 2019, country: '美国', boxOffice: 1132723226, director: 'Jon Watts' },
  { rank: 36, title: '惊奇队长', originalTitle: 'Captain Marvel', year: 2019, country: '美国', boxOffice: 1131416446, director: 'Anna Boden' },
  { rank: 37, title: '变形金刚3：月黑之时', originalTitle: 'Transformers: Dark of the Moon', year: 2011, country: '美国', boxOffice: 1123794079, director: 'Michael Bay' },
  { rank: 38, title: '007：大破天幕杀机', originalTitle: 'Skyfall', year: 2012, country: '英国/美国', boxOffice: 1108594137, director: 'Sam Mendes' },
  { rank: 39, title: '变形金刚4：绝迹重生', originalTitle: 'Transformers: Age of Extinction', year: 2014, country: '美国', boxOffice: 1105261713, director: 'Michael Bay' },
  { rank: 40, title: '侏罗纪公园', originalTitle: 'Jurassic Park', year: 1993, country: '美国', boxOffice: 1103110411, director: 'Steven Spielberg' },
  { rank: 41, title: '黑暗骑士崛起', originalTitle: 'The Dark Knight Rises', year: 2012, country: '美国/英国', boxOffice: 1085429532, director: 'Christopher Nolan' },
  { rank: 42, title: '小丑', originalTitle: 'Joker', year: 2019, country: '美国', boxOffice: 1078958629, director: 'Todd Phillips' },
  { rank: 43, title: '星球大战9：天行者崛起', originalTitle: 'Star Wars: The Rise of Skywalker', year: 2019, country: '美国', boxOffice: 1077022372, director: 'J.J. Abrams' },
  { rank: 44, title: '玩具总动员4', originalTitle: 'Toy Story 4', year: 2019, country: '美国', boxOffice: 1073841394, director: 'Josh Cooley' },
  { rank: 45, title: '玩具总动员3', originalTitle: 'Toy Story 3', year: 2010, country: '美国', boxOffice: 1067316101, director: 'Lee Unkrich' },
  { rank: 46, title: '加勒比海盗2：聚魂棺', originalTitle: "Pirates of the Caribbean: Dead Man's Chest", year: 2006, country: '美国', boxOffice: 1066179747, director: 'Gore Verbinski' },
  { rank: 47, title: '海洋奇缘2', originalTitle: 'Moana 2', year: 2024, country: '美国', boxOffice: 1059242164, director: 'David Derrick Jr.' },
  { rank: 48, title: '侠盗一号：星球大战外传', originalTitle: 'Rogue One: A Star Wars Story', year: 2016, country: '美国', boxOffice: 1058684742, director: 'Gareth Edwards' },
  { rank: 49, title: '阿拉丁', originalTitle: 'Aladdin', year: 2019, country: '美国', boxOffice: 1054304000, director: 'Guy Ritchie' },
  { rank: 50, title: '加勒比海盗4：惊涛怪浪', originalTitle: 'Pirates of the Caribbean: On Stranger Tides', year: 2011, country: '美国', boxOffice: 1046721266, director: 'Rob Marshall' },
  { rank: 51, title: '星球大战1：幽灵的威胁', originalTitle: 'Star Wars: The Phantom Menace', year: 1999, country: '美国', boxOffice: 1046515409, director: 'George Lucas' },
  { rank: 52, title: '星际宝贝', originalTitle: 'Lilo & Stitch', year: 2025, country: '美国', boxOffice: 1038027526, director: 'Dean Fleischer Camp' },
  { rank: 53, title: '神偷奶爸3', originalTitle: 'Despicable Me 3', year: 2017, country: '美国', boxOffice: 1034800131, director: 'Kyle Balda' },
  { rank: 54, title: '哈利·波特与魔法石', originalTitle: "Harry Potter and the Sorcerer's Stone", year: 2001, country: '英国/美国', boxOffice: 1029374615, director: 'Chris Columbus' },
  { rank: 55, title: '海底总动员2：多莉去哪儿', originalTitle: 'Finding Dory', year: 2016, country: '美国', boxOffice: 1029266989, director: 'Andrew Stanton' },
  { rank: 56, title: '疯狂动物城', originalTitle: 'Zootopia', year: 2016, country: '美国', boxOffice: 1025521689, director: 'Byron Howard' },
  { rank: 57, title: '爱丽丝梦游仙境', originalTitle: 'Alice in Wonderland', year: 2010, country: '美国', boxOffice: 1025468216, director: 'Tim Burton' },
  { rank: 58, title: '霍比特人1：意外之旅', originalTitle: 'The Hobbit: An Unexpected Journey', year: 2012, country: '新西兰/美国', boxOffice: 1017453991, director: 'Peter Jackson' },
  { rank: 59, title: '黑暗骑士', originalTitle: 'The Dark Knight', year: 2008, country: '美国/英国', boxOffice: 1008477382, director: 'Christopher Nolan' },
  { rank: 60, title: '侏罗纪世界3：统治', originalTitle: 'Jurassic World Dominion', year: 2022, country: '美国', boxOffice: 1001978080, director: 'Colin Trevorrow' },
  { rank: 61, title: '狮子王', originalTitle: 'The Lion King', year: 1994, country: '美国', boxOffice: 979161632, director: 'Roger Allers' },
  { rank: 62, title: '奥本海默', originalTitle: 'Oppenheimer', year: 2023, country: '美国/英国', boxOffice: 975811333, director: 'Christopher Nolan' },
  { rank: 63, title: '神偷奶爸4', originalTitle: 'Despicable Me 4', year: 2024, country: '美国', boxOffice: 972021410, director: 'Chris Renaud' },
  { rank: 64, title: '神偷奶爸2', originalTitle: 'Despicable Me 2', year: 2013, country: '美国', boxOffice: 970766005, director: 'Pierre Coffin' },
  { rank: 65, title: '奇幻森林', originalTitle: 'The Jungle Book', year: 2016, country: '美国', boxOffice: 967724775, director: 'Jon Favreau' },
  { rank: 66, title: '霍比特人3：五军之战', originalTitle: 'The Hobbit: The Battle of the Five Armies', year: 2014, country: '新西兰/美国', boxOffice: 962749443, director: 'Peter Jackson' },
  { rank: 67, title: '勇敢者游戏：决战丛林', originalTitle: 'Jumanji: Welcome to the Jungle', year: 2017, country: '美国', boxOffice: 962544585, director: 'Jake Kasdan' },
  { rank: 68, title: '加勒比海盗3：世界的尽头', originalTitle: "Pirates of the Caribbean: At World's End", year: 2007, country: '美国', boxOffice: 961691209, director: 'Gore Verbinski' },
  { rank: 69, title: 'Minecraft大电影', originalTitle: 'A Minecraft Movie', year: 2025, country: '美国', boxOffice: 961187780, director: 'Jared Hess' },
  { rank: 70, title: '哈利·波特与死亡圣器（上）', originalTitle: 'Harry Potter and the Deathly Hallows: Part 1', year: 2010, country: '英国/美国', boxOffice: 960858478, director: 'David Yates' },
  { rank: 71, title: '霍比特人2：史矛革之战', originalTitle: 'The Hobbit: The Desolation of Smaug', year: 2013, country: '新西兰/美国', boxOffice: 959079095, director: 'Peter Jackson' },
  { rank: 72, title: '奇异博士2：疯狂多元宇宙', originalTitle: 'Doctor Strange in the Multiverse of Madness', year: 2022, country: '美国', boxOffice: 955775804, director: 'Sam Raimi' },
  { rank: 73, title: '指环王2：双塔奇兵', originalTitle: 'The Lord of the Rings: The Two Towers', year: 2002, country: '新西兰/美国', boxOffice: 944793714, director: 'Peter Jackson' },
  { rank: 74, title: '哈利·波特与凤凰社', originalTitle: 'Harry Potter and the Order of the Phoenix', year: 2007, country: '英国/美国', boxOffice: 942872838, director: 'David Yates' },
  { rank: 75, title: '海底总动员', originalTitle: 'Finding Nemo', year: 2003, country: '美国', boxOffice: 941637960, director: 'Andrew Stanton' },
  { rank: 76, title: '哈利·波特与混血王子', originalTitle: 'Harry Potter and the Half-Blood Prince', year: 2009, country: '英国/美国', boxOffice: 941056063, director: 'David Yates' },
  { rank: 77, title: '小黄人大眼萌2：格鲁的崛起', originalTitle: 'Minions: The Rise of Gru', year: 2022, country: '美国', boxOffice: 940482695, director: 'Kyle Balda' },
  { rank: 78, title: '怪物史瑞克2', originalTitle: 'Shrek 2', year: 2004, country: '美国', boxOffice: 932542462, director: 'Andrew Adamson' },
  { rank: 79, title: '波西米亚狂想曲', originalTitle: 'Bohemian Rhapsody', year: 2018, country: '英国/美国', boxOffice: 910813521, director: 'Bryan Singer' },
  { rank: 80, title: '星球大战3：西斯的复仇', originalTitle: 'Star Wars: Revenge of the Sith', year: 2005, country: '美国', boxOffice: 905595947, director: 'George Lucas' },
  { rank: 81, title: '长津湖', originalTitle: 'The Battle at Lake Changjin', year: 2021, country: '中国', boxOffice: 902548476, director: '陈凯歌' },
  { rank: 82, title: '哈利·波特与火焰杯', originalTitle: 'Harry Potter and the Goblet of Fire', year: 2005, country: '英国/美国', boxOffice: 900435886, director: 'Mike Newell' },
  { rank: 83, title: '指环王1：护戒使者', originalTitle: 'The Lord of the Rings: The Fellowship of the Ring', year: 2001, country: '新西兰/美国', boxOffice: 897053275, director: 'Peter Jackson' },
  { rank: 84, title: '蜘蛛侠3', originalTitle: 'Spider-Man 3', year: 2007, country: '美国', boxOffice: 887415130, director: 'Sam Raimi' },
  { rank: 85, title: '冰河世纪3：恐龙的黎明', originalTitle: 'Ice Age: Dawn of the Dinosaurs', year: 2009, country: '美国', boxOffice: 886686817, director: 'Carlos Saldanha' },
  { rank: 86, title: '哈利·波特与密室', originalTitle: 'Harry Potter and the Chamber of Secrets', year: 2002, country: '英国/美国', boxOffice: 883386103, director: 'Chris Columbus' },
  { rank: 87, title: '蜘蛛侠：英雄归来', originalTitle: 'Spider-Man: Homecoming', year: 2017, country: '美国', boxOffice: 880978185, director: 'Jon Watts' },
  { rank: 88, title: '007：幽灵党', originalTitle: 'Spectre', year: 2015, country: '英国/美国', boxOffice: 880707597, director: 'Sam Mendes' },
  { rank: 89, title: '冰河世纪4：大陆漂移', originalTitle: 'Ice Age: Continental Drift', year: 2012, country: '美国', boxOffice: 877244782, director: 'Steve Martino' },
  { rank: 90, title: '爱宠大机密', originalTitle: 'The Secret Life of Pets', year: 2016, country: '美国', boxOffice: 875698161, director: 'Chris Renaud' },
  { rank: 91, title: '蝙蝠侠大战超人：正义黎明', originalTitle: 'Batman v Superman: Dawn of Justice', year: 2016, country: '美国', boxOffice: 874362803, director: 'Zack Snyder' },
  { rank: 92, title: '战狼2', originalTitle: 'Wolf Warrior 2', year: 2017, country: '中国', boxOffice: 870325439, director: '吴京' },
  { rank: 93, title: '侏罗纪世界4：重生', originalTitle: 'Jurassic World Rebirth', year: 2025, country: '美国', boxOffice: 869146189, director: 'Gareth Edwards' },
  { rank: 94, title: '暮光之城4：破晓（下）', originalTitle: 'The Twilight Saga: Breaking Dawn - Part 2', year: 2012, country: '美国', boxOffice: 868590075, director: 'Bill Condon' },
  { rank: 95, title: '饥饿游戏2：星火燎原', originalTitle: 'The Hunger Games: Catching Fire', year: 2013, country: '美国', boxOffice: 865011746, director: 'Francis Lawrence' },
  { rank: 96, title: '银河护卫队2', originalTitle: 'Guardians of the Galaxy Vol. 2', year: 2017, country: '美国', boxOffice: 863764214, director: 'James Gunn' },
  { rank: 97, title: '黑豹2：永远的瓦坎达', originalTitle: 'Black Panther: Wakanda Forever', year: 2022, country: '美国', boxOffice: 859208836, director: 'Ryan Coogler' },
  { rank: 98, title: '头脑特工队', originalTitle: 'Inside Out', year: 2015, country: '美国', boxOffice: 859076401, director: 'Pete Docter' },
  { rank: 99, title: '毒液：致命守护者', originalTitle: 'Venom', year: 2018, country: '美国', boxOffice: 856085161, director: 'Ruben Fleischer' },
  { rank: 100, title: '雷神3：诸神黄昏', originalTitle: 'Thor: Ragnarok', year: 2017, country: '美国', boxOffice: 855301806, director: 'Taika Waititi' }
];

/**
 * 格式化票房金额为可读文本
 */
function formatBoxOffice(amount) {
    if (amount >= 1000000000) {
        return '$' + (amount / 1000000000).toFixed(1) + '亿';
    } else if (amount >= 100000000) {
        return '$' + (amount / 100000000).toFixed(1) + '千万';
    } else if (amount >= 1000000) {
        return '$' + (amount / 1000000).toFixed(0) + '万';
    }
    return '$' + amount.toLocaleString();
}

/**
 * 搜索豆瓣，提取电影封面和评分
 * 搜索策略：依次尝试 "中文名 年份"、"中文名"、"英文名 年份"、"英文名"
 */
async function fetchDoubanInfo(chineseTitle, originalTitle, year) {
    const searchQueries = [
        `${chineseTitle} ${year}`,
        chineseTitle,
        `${originalTitle} ${year}`,
        originalTitle
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

            // 优先选年份匹配的结果
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
        // 升级为中图：s_ratio_poster(~100px) → m_ratio_poster(~200px)，兼顾加载速度与清晰度
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

        const fileName = `boxoffice_covers/${movieId}_${Date.now()}.jpg`;
        const uploadResult = await cloud.uploadFile({
            cloudPath: fileName,
            fileContent: response.data
        });

        console.log(`  -> 封面上传成功: ${movieId} (${(response.data.length / 1024).toFixed(1)}KB)`);
        return uploadResult.fileID;
    } catch (e) {
        console.warn(`  -> 封面下载失败 ${movieId}, 回退原始URL:`, e.message);
        return imageUrl; // fallback
    }
}

/**
 * 云函数入口
 * @param {Object} event - 调用参数
 * @param {string} [event.action='seed'] - 操作类型：
 *   - 'seed': 仅导入/更新基础数据（不抓封面），速度快
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

            // 按票房重新排序
            const sortedData = [...BOXOFFICE_DATA].sort((a, b) => b.boxOffice - a.boxOffice);
            sortedData.forEach((m, i) => { m.rank = i + 1; });

            for (const movie of sortedData) {
                const boxOfficeText = formatBoxOffice(movie.boxOffice);
                const doc = {
                    rank: movie.rank,
                    title: movie.title,
                    originalTitle: movie.originalTitle,
                    year: movie.year,
                    country: movie.country,
                    boxOffice: movie.boxOffice,
                    boxOfficeText: boxOfficeText,
                    director: movie.director,
                    isTop250: true,
                    theme: 'boxoffice_movies',
                    updateTime: new Date()
                };

                // 检查是否已存在
                const existing = await db.collection(COLLECTION)
                    .where({ originalTitle: movie.originalTitle, year: movie.year })
                    .get();

                if (existing.data.length > 0) {
                    // 更新时不覆盖已有的封面字段
                    const old = existing.data[0];
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

            // 清理无效数据
            const validTitles = sortedData.map(m => m.originalTitle);
            let deleted = 0;
            const MAX_LIMIT = 100;
            let allDocs = [];
            let fetchCount = 0;
            while (true) {
                const batch = await db.collection(COLLECTION).skip(fetchCount).limit(MAX_LIMIT).get();
                allDocs = allDocs.concat(batch.data);
                fetchCount += batch.data.length;
                if (batch.data.length < MAX_LIMIT) break;
            }
            for (const doc of allDocs) {
                if (!validTitles.includes(doc.originalTitle)) {
                    await db.collection(COLLECTION).doc(doc._id).remove();
                    deleted++;
                    console.log(`已删除无效记录: ${doc.title} (${doc.originalTitle})`);
                }
            }

            return { success: true, action, added, updated, deleted, total: sortedData.length };
        }

        // ========== action: covers ==========
        if (action === 'covers') {
            const START_TIME = Date.now();
            const TIME_LIMIT = 50000; // 50秒安全阈值（配置了600秒超时）
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

            console.log(`共 ${allMovies.length} 部电影，forceRefresh=${forceRefresh}, startFrom=${startFrom}`);

            // 从 startFrom 开始处理
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

                // 超时保护
                if (Date.now() - START_TIME > TIME_LIMIT) {
                    console.warn(`[超时保护] 已运行${Math.round((Date.now() - START_TIME) / 1000)}秒，在第${movie.rank}名停止`);
                    stoppedEarly = true;
                    break;
                }

                lastRank = movie.rank;

                // 已有有效封面且非强制刷新，跳过
                if (!forceRefresh && movie.cover && movie.cover.startsWith('cloud://')) {
                    skipped++;
                    processed++;
                    continue;
                }

                console.log(`[${movie.rank}] 抓取封面: ${movie.title} (${movie.originalTitle}, ${movie.year})`);

                const doubanInfo = await fetchDoubanInfo(movie.title, movie.originalTitle, movie.year);
                if (doubanInfo && doubanInfo.coverUrl) {
                    const cloudFileID = await downloadAndUploadImage(doubanInfo.coverUrl, `boxoffice_${doubanInfo.doubanId}`);

                    const updateData = {
                        cover: cloudFileID,
                        coverUrl: doubanInfo.coverUrl,
                        originalCover: doubanInfo.coverUrl,
                        updateTime: new Date()
                    };
                    // 如果豆瓣有评分，也存上
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
                // 防止请求豆瓣太快被封
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
        console.error('fetchBoxofficeMovies error:', err);
        return { success: false, error: err.message };
    }
};
