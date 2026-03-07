const axios = require('axios');

async function testDouban() {
    const titles = ["Amélie", "Le Fabuleux Destin d'Amélie Poulain", "Amelie", "tt0211915"];
    for (let text of titles) {
        try {
            const res = await axios.get(`https://movie.douban.com/j/subject_suggest?q=${encodeURIComponent(text)}`, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
                }
            });
            console.log(`\nQuery: ${text}`);
            if (res.data && res.data.length > 0) {
                console.log(res.data[0].title);
            } else {
                console.log('No result found.');
            }
        } catch (e) {
            console.error(e.message);
        }
    }
}

testDouban();
