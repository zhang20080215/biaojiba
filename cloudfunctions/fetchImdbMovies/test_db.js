const cloud = require('wx-server-sdk');

cloud.init({ env: 'cloud1-3gn3wryx716919c6' });
const db = cloud.database();
const _ = db.command;

async function checkEnglishTitles() {
    try {
        const res = await db.collection('imdb_movies').where({
            isTop250: _.neq(false)
        }).limit(300).get();

        const movies = res.data;
        console.log(`Total active movies: ${movies.length}`);

        // Find titles that don't have Chinese characters
        const englishTitles = movies.filter(m => !/[一-龥]/.test(m.title));
        console.log(`Movies without Chinese characters: ${englishTitles.length}`);

        englishTitles.forEach(m => {
            console.log(`ID: ${m._id}, Title: ${m.title}, OriginalTitle: ${m.originalTitle}, Rank: ${m.rank}`);
        });
    } catch (e) {
        console.error(e.message);
    }
}

checkEnglishTitles();
