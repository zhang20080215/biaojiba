// utils/boxofficeLoader.js - 全球电影票房榜数据加载
const DataLoader = require('./dataLoader');

/**
 * 加载全球电影票房榜数据
 * 集合名：boxoffice_movies
 */
async function loadMovies(db) {
    const _ = db.command;
    const movies = await DataLoader.loadCollection(db, 'boxoffice_movies', {
        where: { isTop250: _.neq(false) },
        orderBy: { field: 'rank', order: 'asc' }
    });
    return movies.map(m => ({ ...m, _id: String(m._id) }));
}

module.exports = {
    loadMovies
};
