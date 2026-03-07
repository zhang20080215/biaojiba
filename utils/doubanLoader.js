// utils/doubanLoader.js - 豆瓣电影数据加载
const DataLoader = require('./dataLoader');

/**
 * 加载豆瓣电影数据
 * 集合名：movies
 */
async function loadMovies(db) {
    const _ = db.command;
    const movies = await DataLoader.loadCollection(db, 'movies', {
        where: { isTop250: _.neq(false) },
        orderBy: { field: 'rank', order: 'asc' }
    });
    return movies.map(m => ({ ...m, _id: String(m._id) }));
}

module.exports = {
    loadMovies
};
