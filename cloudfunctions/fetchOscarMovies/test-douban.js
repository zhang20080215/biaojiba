const axios = require('axios');
const cheerio = require('cheerio');

async function testDouban() {
    const movieTitle = 'Oppenheimer';
    const year = '2024'; // Wait, Douban might list it as 2023 because it came out in 2023. Oppenheimer Oscar was 2024.
    const searchUrl = `https://m.douban.com/search/?query=${encodeURIComponent(movieTitle)}`;
    const res = await axios.get(searchUrl, {
        headers: {
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.3 Mobile/15E148 Safari/604.1',
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
        const titleText = firstResult.find('.subject-title').text().trim();
        console.log("Title text from .subject-title:", titleText);
        console.log("First result HTML:", firstResult.html());
    } else {
        console.log("No movie found");
    }
}

testDouban().catch(console.error);
