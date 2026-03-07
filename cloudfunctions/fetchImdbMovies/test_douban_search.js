const axios = require('axios');
const cheerio = require('cheerio');

async function testDoubanMobileSearch() {
    try {
        const res = await axios.get(`https://m.douban.com/search/?query=tt0211915&type=movie`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.3 Mobile/15E148 Safari/604.1'
            }
        });

        // check if res.data contains Chinese title
        const html = res.data;
        console.log(html.substring(0, 1000));
        const $ = cheerio.load(html);
        const title = $('.subject-title').first().text();
        console.log('Title:', title);
    } catch (e) {
        console.error(e.message);
    }
}

testDoubanMobileSearch();
