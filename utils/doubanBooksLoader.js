// utils/doubanBooksLoader.js — 豆瓣读书 TOP250 数据加载
//
// 优先调云函数 getMoviesData（theme: douban_books）；
// 集合为空 / 调用失败时 fallback 到内置 seed，保证页面在 fetchDoubanBooks
// 部署前也能跑通交互。

const SEED_BOOKS = [
    { _id: 'db_book_001', rank: 1,  title: '红楼梦',           author: '曹雪芹',                  rating: 9.6, cover: '', publisher: '人民文学出版社' },
    { _id: 'db_book_002', rank: 2,  title: '活着',             author: '余华',                    rating: 9.4, cover: '', publisher: '作家出版社' },
    { _id: 'db_book_003', rank: 3,  title: '百年孤独',         author: '加西亚·马尔克斯',         rating: 9.3, cover: '', publisher: '南海出版公司' },
    { _id: 'db_book_004', rank: 4,  title: '1984',             author: '乔治·奥威尔',             rating: 9.4, cover: '', publisher: '上海译文出版社' },
    { _id: 'db_book_005', rank: 5,  title: '三体',             author: '刘慈欣',                  rating: 9.0, cover: '', publisher: '重庆出版社' },
    { _id: 'db_book_006', rank: 6,  title: '小王子',           author: '圣埃克苏佩里',            rating: 9.1, cover: '', publisher: '人民文学出版社' },
    { _id: 'db_book_007', rank: 7,  title: '解忧杂货店',       author: '东野圭吾',                rating: 8.5, cover: '', publisher: '南海出版公司' },
    { _id: 'db_book_008', rank: 8,  title: '白夜行',           author: '东野圭吾',                rating: 9.1, cover: '', publisher: '南海出版公司' },
    { _id: 'db_book_009', rank: 9,  title: '飘',               author: '玛格丽特·米切尔',         rating: 9.3, cover: '', publisher: '译林出版社' },
    { _id: 'db_book_010', rank: 10, title: '追风筝的人',       author: '卡勒德·胡赛尼',           rating: 8.9, cover: '', publisher: '上海人民出版社' },
    { _id: 'db_book_011', rank: 11, title: '围城',             author: '钱锺书',                  rating: 9.0, cover: '', publisher: '人民文学出版社' },
    { _id: 'db_book_012', rank: 12, title: '挪威的森林',       author: '村上春树',                rating: 8.0, cover: '', publisher: '上海译文出版社' },
    { _id: 'db_book_013', rank: 13, title: '简爱',             author: '夏洛蒂·勃朗特',           rating: 8.7, cover: '', publisher: '上海译文出版社' },
    { _id: 'db_book_014', rank: 14, title: '安娜·卡列尼娜',    author: '列夫·托尔斯泰',           rating: 9.2, cover: '', publisher: '上海译文出版社' },
    { _id: 'db_book_015', rank: 15, title: '霍乱时期的爱情',   author: '加西亚·马尔克斯',         rating: 9.0, cover: '', publisher: '南海出版公司' },
    { _id: 'db_book_016', rank: 16, title: '人类简史',         author: '尤瓦尔·赫拉利',           rating: 9.0, cover: '', publisher: '中信出版社' },
    { _id: 'db_book_017', rank: 17, title: '苏菲的世界',       author: '乔斯坦·贾德',             rating: 8.9, cover: '', publisher: '作家出版社' },
    { _id: 'db_book_018', rank: 18, title: '局外人',           author: '加缪',                    rating: 9.1, cover: '', publisher: '上海译文出版社' },
    { _id: 'db_book_019', rank: 19, title: '杀死一只知更鸟',   author: '哈珀·李',                 rating: 9.3, cover: '', publisher: '译林出版社' },
    { _id: 'db_book_020', rank: 20, title: '不能承受的生命之轻', author: '米兰·昆德拉',           rating: 8.6, cover: '', publisher: '上海译文出版社' }
    // 余下 230 本待爬虫云函数 fetchDoubanBooks 上线后填充
];

function normalizeBook(book) {
    const cover = book.cover || book.coverUrl || book.originalCover || '';
    return {
        ...book,
        _id: String(book._id),
        cover,
        thumbCover: book.thumbCover || cover,
        originalCover: book.originalCover || cover
    };
}

async function loadFromCloud() {
    if (typeof wx === 'undefined' || !wx.cloud) return null;
    try {
        const res = await wx.cloud.callFunction({
            name: 'getMoviesData',
            data: { theme: 'douban_books' }
        });
        const result = res && res.result;
        if (!result || !result.success) return null;
        const books = Array.isArray(result.movies) ? result.movies : [];
        if (books.length === 0) return null;
        return books.map(normalizeBook);
    } catch (e) {
        console.warn('[doubanBooksLoader] 云函数调用失败，使用 seed 兜底:', e);
        return null;
    }
}

async function loadBooks() {
    const cloudBooks = await loadFromCloud();
    if (cloudBooks && cloudBooks.length > 0) return cloudBooks;
    return SEED_BOOKS.map(normalizeBook);
}

module.exports = {
    loadBooks
};
