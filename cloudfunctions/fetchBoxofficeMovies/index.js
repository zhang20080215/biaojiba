// cloudfunctions/fetchBoxofficeMovies/index.js
// 全球电影票房榜数据导入 - 硬编码全球票房TOP100电影数据

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const COLLECTION = 'boxoffice_movies';

// 全球电影票房榜TOP100（数据来源：Box Office Mojo，截至2025年）
// 票房单位：美元
const BOXOFFICE_DATA = [
  { rank: 1, title: '阿凡达', originalTitle: 'Avatar', year: 2009, country: '美国', boxOffice: 2923706026, director: 'James Cameron' },
  { rank: 2, title: '复仇者联盟4：终局之战', originalTitle: 'Avengers: Endgame', year: 2019, country: '美国', boxOffice: 2799439100, director: 'Anthony Russo' },
  { rank: 3, title: '阿凡达：水之道', originalTitle: 'Avatar: The Way of Water', year: 2022, country: '美国', boxOffice: 2320250281, director: 'James Cameron' },
  { rank: 4, title: '泰坦尼克号', originalTitle: 'Titanic', year: 1997, country: '美国', boxOffice: 2264743305, director: 'James Cameron' },
  { rank: 5, title: '星球大战7：原力觉醒', originalTitle: 'Star Wars: The Force Awakens', year: 2015, country: '美国', boxOffice: 2071310218, director: 'J.J. Abrams' },
  { rank: 6, title: '复仇者联盟3：无限战争', originalTitle: 'Avengers: Infinity War', year: 2018, country: '美国', boxOffice: 2052415039, director: 'Anthony Russo' },
  { rank: 7, title: '蜘蛛侠：英雄无归', originalTitle: 'Spider-Man: No Way Home', year: 2021, country: '美国', boxOffice: 1921847111, director: 'Jon Watts' },
  { rank: 8, title: '头脑特工队2', originalTitle: 'Inside Out 2', year: 2024, country: '美国', boxOffice: 1698640000, director: 'Kelsey Mann' },
  { rank: 9, title: '侏罗纪世界', originalTitle: 'Jurassic World', year: 2015, country: '美国', boxOffice: 1671537444, director: 'Colin Trevorrow' },
  { rank: 10, title: '狮子王', originalTitle: 'The Lion King', year: 2019, country: '美国', boxOffice: 1663075401, director: 'Jon Favreau' },
  { rank: 11, title: '复仇者联盟', originalTitle: 'The Avengers', year: 2012, country: '美国', boxOffice: 1520538536, director: 'Joss Whedon' },
  { rank: 12, title: '速度与激情7', originalTitle: 'Furious 7', year: 2015, country: '美国', boxOffice: 1515341399, director: 'James Wan' },
  { rank: 13, title: '冰雪奇缘2', originalTitle: 'Frozen II', year: 2019, country: '美国', boxOffice: 1453683476, director: 'Chris Buck' },
  { rank: 14, title: '超级马力欧兄弟大电影', originalTitle: 'The Super Mario Bros. Movie', year: 2023, country: '美国/日本', boxOffice: 1361992475, director: 'Aaron Horvath' },
  { rank: 15, title: '复仇者联盟2：奥创纪元', originalTitle: 'Avengers: Age of Ultron', year: 2015, country: '美国', boxOffice: 1405403694, director: 'Joss Whedon' },
  { rank: 16, title: '黑豹', originalTitle: 'Black Panther', year: 2018, country: '美国', boxOffice: 1349926083, director: 'Ryan Coogler' },
  { rank: 17, title: '哈利·波特与死亡圣器（下）', originalTitle: 'Harry Potter and the Deathly Hallows Part 2', year: 2011, country: '英国/美国', boxOffice: 1342359942, director: 'David Yates' },
  { rank: 18, title: '星球大战8：最后的绝地武士', originalTitle: 'Star Wars: The Last Jedi', year: 2017, country: '美国', boxOffice: 1334407706, director: 'Rian Johnson' },
  { rank: 19, title: '侏罗纪世界2：殒落国度', originalTitle: 'Jurassic World: Fallen Kingdom', year: 2018, country: '美国', boxOffice: 1310466296, director: 'J.A. Bayona' },
  { rank: 20, title: '冰雪奇缘', originalTitle: 'Frozen', year: 2013, country: '美国', boxOffice: 1284540518, director: 'Chris Buck' },
  { rank: 21, title: '美女与野兽', originalTitle: 'Beauty and the Beast', year: 2017, country: '美国', boxOffice: 1266115964, director: 'Bill Condon' },
  { rank: 22, title: '超人总动员2', originalTitle: 'Incredibles 2', year: 2018, country: '美国', boxOffice: 1243225667, director: 'Brad Bird' },
  { rank: 23, title: '速度与激情8', originalTitle: 'The Fate of the Furious', year: 2017, country: '美国', boxOffice: 1236005118, director: 'F. Gary Gray' },
  { rank: 24, title: '钢铁侠3', originalTitle: 'Iron Man 3', year: 2013, country: '美国', boxOffice: 1214811252, director: 'Shane Black' },
  { rank: 25, title: '小黄人大眼萌', originalTitle: 'Minions', year: 2015, country: '美国', boxOffice: 1159444662, director: 'Kyle Balda' },
  { rank: 26, title: '美国队长3：内战', originalTitle: 'Captain America: Civil War', year: 2016, country: '美国', boxOffice: 1155046416, director: 'Anthony Russo' },
  { rank: 27, title: '海王', originalTitle: 'Aquaman', year: 2018, country: '美国', boxOffice: 1152014516, director: 'James Wan' },
  { rank: 28, title: '指环王3：王者无敌', originalTitle: 'The Lord of the Rings: The Return of the King', year: 2003, country: '新西兰/美国', boxOffice: 1146030912, director: 'Peter Jackson' },
  { rank: 29, title: '蜘蛛侠：纵横宇宙', originalTitle: 'Spider-Man: Across the Spider-Verse', year: 2023, country: '美国', boxOffice: 690516655, director: 'Joaquim Dos Santos' },
  { rank: 30, title: '变形金刚3：月黑之时', originalTitle: 'Transformers: Dark of the Moon', year: 2011, country: '美国', boxOffice: 1123794079, director: 'Michael Bay' },
  { rank: 31, title: '007：大破天幕杀机', originalTitle: 'Skyfall', year: 2012, country: '英国/美国', boxOffice: 1142471295, director: 'Sam Mendes' },
  { rank: 32, title: '变形金刚4：绝迹重生', originalTitle: 'Transformers: Age of Extinction', year: 2014, country: '美国', boxOffice: 1104054072, director: 'Michael Bay' },
  { rank: 33, title: '黑暗骑士崛起', originalTitle: 'The Dark Knight Rises', year: 2012, country: '美国/英国', boxOffice: 1081169825, director: 'Christopher Nolan' },
  { rank: 34, title: '小丑', originalTitle: 'Joker', year: 2019, country: '美国', boxOffice: 1078958294, director: 'Todd Phillips' },
  { rank: 35, title: '星球大战9：天行者崛起', originalTitle: 'Star Wars: The Rise of Skywalker', year: 2019, country: '美国', boxOffice: 1077022372, director: 'J.J. Abrams' },
  { rank: 36, title: '玩具总动员4', originalTitle: 'Toy Story 4', year: 2019, country: '美国', boxOffice: 1073841394, director: 'Josh Cooley' },
  { rank: 37, title: '玩具总动员3', originalTitle: 'Toy Story 3', year: 2010, country: '美国', boxOffice: 1066969703, director: 'Lee Unkrich' },
  { rank: 38, title: '加勒比海盗2：聚魂棺', originalTitle: "Pirates of the Caribbean: Dead Man's Chest", year: 2006, country: '美国', boxOffice: 1066179725, director: 'Gore Verbinski' },
  { rank: 39, title: '壮志凌云2：独行侠', originalTitle: 'Top Gun: Maverick', year: 2022, country: '美国', boxOffice: 1495696292, director: 'Joseph Kosinski' },
  { rank: 40, title: '疯狂动物城', originalTitle: 'Zootopia', year: 2016, country: '美国', boxOffice: 1025521689, director: 'Byron Howard' },
  { rank: 41, title: '爱丽丝梦游仙境', originalTitle: 'Alice in Wonderland', year: 2010, country: '美国', boxOffice: 1025468216, director: 'Tim Burton' },
  { rank: 42, title: '哈利·波特与魔法石', originalTitle: "Harry Potter and the Philosopher's Stone", year: 2001, country: '英国/美国', boxOffice: 1024267516, director: 'Chris Columbus' },
  { rank: 43, title: '黑暗骑士', originalTitle: 'The Dark Knight', year: 2008, country: '美国/英国', boxOffice: 1006234167, director: 'Christopher Nolan' },
  { rank: 44, title: '寻梦环游记', originalTitle: 'Coco', year: 2017, country: '美国', boxOffice: 807827828, director: 'Lee Unkrich' },
  { rank: 45, title: '长津湖', originalTitle: 'The Battle at Lake Changjin', year: 2021, country: '中国', boxOffice: 913311562, director: '陈凯歌' },
  { rank: 46, title: '哪吒之魔童降世', originalTitle: "Ne Zha", year: 2019, country: '中国', boxOffice: 726264796, director: '饺子' },
  { rank: 47, title: '流浪地球2', originalTitle: 'The Wandering Earth 2', year: 2023, country: '中国', boxOffice: 604388614, director: '郭帆' },
  { rank: 48, title: '你好，李焕英', originalTitle: 'Hi, Mom', year: 2021, country: '中国', boxOffice: 822009764, director: '贾玲' },
  { rank: 49, title: '战狼2', originalTitle: 'Wolf Warrior 2', year: 2017, country: '中国', boxOffice: 870325439, director: '吴京' },
  { rank: 50, title: '满江红', originalTitle: 'Full River Red', year: 2023, country: '中国', boxOffice: 645445211, director: '张艺谋' },
  { rank: 51, title: '奥本海默', originalTitle: 'Oppenheimer', year: 2023, country: '美国/英国', boxOffice: 952000000, director: 'Christopher Nolan' },
  { rank: 52, title: '芭比', originalTitle: 'Barbie', year: 2023, country: '美国', boxOffice: 1441866244, director: 'Greta Gerwig' },
  { rank: 53, title: '银河护卫队3', originalTitle: 'Guardians of the Galaxy Vol. 3', year: 2023, country: '美国', boxOffice: 845555777, director: 'James Gunn' },
  { rank: 54, title: '饥饿游戏', originalTitle: 'The Hunger Games: Catching Fire', year: 2013, country: '美国', boxOffice: 865011746, director: 'Francis Lawrence' },
  { rank: 55, title: '加勒比海盗4：惊涛怪浪', originalTitle: 'Pirates of the Caribbean: On Stranger Tides', year: 2011, country: '美国', boxOffice: 1045713802, director: 'Rob Marshall' },
  { rank: 56, title: '神偷奶爸3', originalTitle: 'Despicable Me 3', year: 2017, country: '美国', boxOffice: 1034800131, director: 'Kyle Balda' },
  { rank: 57, title: '海底总动员2：多莉去哪儿', originalTitle: 'Finding Dory', year: 2016, country: '美国', boxOffice: 1028570889, director: 'Andrew Stanton' },
  { rank: 58, title: '指环王2：双塔奇兵', originalTitle: 'The Lord of the Rings: The Two Towers', year: 2002, country: '新西兰/美国', boxOffice: 947495095, director: 'Peter Jackson' },
  { rank: 59, title: '指环王1：护戒使者', originalTitle: 'The Lord of the Rings: The Fellowship of the Ring', year: 2001, country: '新西兰/美国', boxOffice: 898094742, director: 'Peter Jackson' },
  { rank: 60, title: '海底总动员', originalTitle: 'Finding Nemo', year: 2003, country: '美国', boxOffice: 940335536, director: 'Andrew Stanton' },
  { rank: 61, title: '怪物史瑞克2', originalTitle: 'Shrek 2', year: 2004, country: '美国', boxOffice: 928760770, director: 'Andrew Adamson' },
  { rank: 62, title: '哈利·波特与密室', originalTitle: 'Harry Potter and the Chamber of Secrets', year: 2002, country: '英国/美国', boxOffice: 879666127, director: 'Chris Columbus' },
  { rank: 63, title: '侏罗纪公园', originalTitle: 'Jurassic Park', year: 1993, country: '美国', boxOffice: 1046583960, director: 'Steven Spielberg' },
  { rank: 64, title: '蜘蛛侠：英雄远征', originalTitle: 'Spider-Man: Far from Home', year: 2019, country: '美国', boxOffice: 1131927996, director: 'Jon Watts' },
  { rank: 65, title: '雷神3：诸神黄昏', originalTitle: 'Thor: Ragnarok', year: 2017, country: '美国', boxOffice: 855301806, director: 'Taika Waititi' },
  { rank: 66, title: '蜘蛛侠：英雄归来', originalTitle: 'Spider-Man: Homecoming', year: 2017, country: '美国', boxOffice: 880166924, director: 'Jon Watts' },
  { rank: 67, title: '惊奇队长', originalTitle: 'Captain Marvel', year: 2019, country: '美国', boxOffice: 1128462088, director: 'Anna Boden' },
  { rank: 68, title: '盗梦空间', originalTitle: 'Inception', year: 2010, country: '美国/英国', boxOffice: 839030630, director: 'Christopher Nolan' },
  { rank: 69, title: '沙丘2', originalTitle: 'Dune: Part Two', year: 2024, country: '美国', boxOffice: 714444358, director: 'Denis Villeneuve' },
  { rank: 70, title: '疯狂动物城2', originalTitle: 'Zootopia 2', year: 2025, country: '美国', boxOffice: 650000000, director: 'Byron Howard' },
  { rank: 71, title: '神偷奶爸4', originalTitle: 'Despicable Me 4', year: 2024, country: '美国', boxOffice: 969167822, director: 'Chris Renaud' },
  { rank: 72, title: '死侍与金刚狼', originalTitle: 'Deadpool & Wolverine', year: 2024, country: '美国', boxOffice: 1338073645, director: 'Shawn Levy' },
  { rank: 73, title: '海洋奇缘2', originalTitle: 'Moana 2', year: 2024, country: '美国', boxOffice: 1000000000, director: 'David Derrick Jr.' },
  { rank: 74, title: '功夫熊猫4', originalTitle: 'Kung Fu Panda 4', year: 2024, country: '美国', boxOffice: 547700000, director: 'Mike Mitchell' },
  { rank: 75, title: '哥斯拉大战金刚2：帝国崛起', originalTitle: 'Godzilla x Kong: The New Empire', year: 2024, country: '美国', boxOffice: 571700000, director: 'Adam Wingard' },
  { rank: 76, title: '加勒比海盗3：世界的尽头', originalTitle: "Pirates of the Caribbean: At World's End", year: 2007, country: '美国', boxOffice: 963420425, director: 'Gore Verbinski' },
  { rank: 77, title: '哈利·波特与阿兹卡班的囚徒', originalTitle: 'Harry Potter and the Prisoner of Azkaban', year: 2004, country: '英国/美国', boxOffice: 796688549, director: 'Alfonso Cuarón' },
  { rank: 78, title: '哈利·波特与火焰杯', originalTitle: 'Harry Potter and the Goblet of Fire', year: 2005, country: '英国/美国', boxOffice: 896911078, director: 'Mike Newell' },
  { rank: 79, title: '哈利·波特与凤凰社', originalTitle: 'Harry Potter and the Order of the Phoenix', year: 2007, country: '英国/美国', boxOffice: 942119070, director: 'David Yates' },
  { rank: 80, title: '哈利·波特与混血王子', originalTitle: 'Harry Potter and the Half-Blood Prince', year: 2009, country: '英国/美国', boxOffice: 934416487, director: 'David Yates' },
  { rank: 81, title: '哈利·波特与死亡圣器（上）', originalTitle: 'Harry Potter and the Deathly Hallows Part 1', year: 2010, country: '英国/美国', boxOffice: 977070381, director: 'David Yates' },
  { rank: 82, title: '神偷奶爸2', originalTitle: 'Despicable Me 2', year: 2013, country: '美国', boxOffice: 970761885, director: 'Pierre Coffin' },
  { rank: 83, title: '霍比特人3：五军之战', originalTitle: 'The Hobbit: The Battle of the Five Armies', year: 2014, country: '新西兰/美国', boxOffice: 962201338, director: 'Peter Jackson' },
  { rank: 84, title: '霍比特人1：意外之旅', originalTitle: 'The Hobbit: An Unexpected Journey', year: 2012, country: '新西兰/美国', boxOffice: 1017003568, director: 'Peter Jackson' },
  { rank: 85, title: '霍比特人2：史矛革之战', originalTitle: 'The Hobbit: The Desolation of Smaug', year: 2013, country: '新西兰/美国', boxOffice: 958400000, director: 'Peter Jackson' },
  { rank: 86, title: '飞屋环游记', originalTitle: 'Up', year: 2009, country: '美国', boxOffice: 735099082, director: 'Pete Docter' },
  { rank: 87, title: '机器人总动员', originalTitle: 'WALL-E', year: 2008, country: '美国', boxOffice: 532092681, director: 'Andrew Stanton' },
  { rank: 88, title: '功夫熊猫', originalTitle: 'Kung Fu Panda', year: 2008, country: '美国', boxOffice: 631910531, director: 'Mark Osborne' },
  { rank: 89, title: '阿拉丁', originalTitle: 'Aladdin', year: 2019, country: '美国', boxOffice: 1054304000, director: 'Guy Ritchie' },
  { rank: 90, title: '星际穿越', originalTitle: 'Interstellar', year: 2014, country: '美国/英国', boxOffice: 773430673, director: 'Christopher Nolan' },
  { rank: 91, title: '怪兽电力公司', originalTitle: 'Monsters, Inc.', year: 2001, country: '美国', boxOffice: 577425734, director: 'Pete Docter' },
  { rank: 92, title: '料理鼠王', originalTitle: 'Ratatouille', year: 2007, country: '美国', boxOffice: 623726085, director: 'Brad Bird' },
  { rank: 93, title: '冰河世纪3', originalTitle: 'Ice Age: Dawn of the Dinosaurs', year: 2009, country: '美国', boxOffice: 886686817, director: 'Carlos Saldanha' },
  { rank: 94, title: '007：幽灵党', originalTitle: 'Spectre', year: 2015, country: '英国/美国', boxOffice: 880674609, director: 'Sam Mendes' },
  { rank: 95, title: '007：无暇赴死', originalTitle: 'No Time to Die', year: 2021, country: '英国/美国', boxOffice: 774153007, director: 'Cary Joji Fukunaga' },
  { rank: 96, title: '蝙蝠侠大战超人：正义黎明', originalTitle: 'Batman v Superman: Dawn of Justice', year: 2016, country: '美国', boxOffice: 873637528, director: 'Zack Snyder' },
  { rank: 97, title: '驯龙高手2', originalTitle: 'How to Train Your Dragon 2', year: 2014, country: '美国', boxOffice: 621537519, director: 'Dean DeBlois' },
  { rank: 98, title: '驯龙高手', originalTitle: 'How to Train Your Dragon', year: 2010, country: '美国', boxOffice: 494878759, director: 'Chris Sanders' },
  { rank: 99, title: '花木兰', originalTitle: 'Mulan', year: 2020, country: '美国', boxOffice: 70030163, director: 'Niki Caro' },
  { rank: 100, title: '哪吒2', originalTitle: 'Ne Zha 2', year: 2025, country: '中国', boxOffice: 1600000000, director: '饺子' }
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

exports.main = async (event, context) => {
    const { action } = event;

    try {
        if (action === 'seed') {
            // 导入数据到云数据库
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
                    cover: '',
                    originalCover: '',
                    coverUrl: '',
                    isTop250: true,
                    theme: 'boxoffice_movies',
                    updateTime: new Date()
                };

                // 检查是否已存在
                const existing = await db.collection(COLLECTION)
                    .where({ originalTitle: movie.originalTitle })
                    .get();

                if (existing.data.length > 0) {
                    await db.collection(COLLECTION).doc(existing.data[0]._id).update({ data: doc });
                    updated++;
                } else {
                    await db.collection(COLLECTION).add({ data: doc });
                    added++;
                }
            }

            return { success: true, added, updated, total: sortedData.length };
        }

        return { success: false, error: 'Unknown action. Use action: "seed" to import data.' };
    } catch (err) {
        console.error('fetchBoxofficeMovies error:', err);
        return { success: false, error: err.message };
    }
};
