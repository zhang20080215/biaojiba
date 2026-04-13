const DataLoader = require('./dataLoader');

function normalizeDateValue(value) {
    if (!value) return '';
    if (typeof value === 'object' && value.toDate) {
        return value.toDate().toISOString().slice(0, 10);
    }
    if (typeof value === 'object' && value instanceof Date) {
        return value.toISOString().slice(0, 10);
    }
    return String(value).replace(/\./g, '-').replace(/\//g, '-').slice(0, 10);
}

async function loadMovies(db) {
    const _ = db.command;
    const movies = await DataLoader.loadCollection(db, 'annual_movies', {
        where: { isTop250: _.neq(false) }
    });

    return movies
        .map((movie) => ({ ...movie, _id: String(movie._id) }))
        .sort((a, b) => {
            const dateA = normalizeDateValue(a.releaseDate);
            const dateB = normalizeDateValue(b.releaseDate);
            if (dateA && dateB && dateA !== dateB) return dateA.localeCompare(dateB);
            if (dateA && !dateB) return -1;
            if (!dateA && dateB) return 1;
            return String(a.title || '').localeCompare(String(b.title || ''));
        });
}

module.exports = {
    loadMovies
};
