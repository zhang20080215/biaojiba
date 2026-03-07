const axios = require('axios');
const cheerio = require('cheerio');

async function testFetch() {
    try {
        const res = await axios.get('https://www.imdb.com/chart/top/?hl=zh-cn', {
            timeout: 20000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
                'Cookie': 'lc-main=zh_CN;'
            }
        });

        const $ = cheerio.load(res.data);

        // Look for Chinese names in the HTML directly
        const items = $('.ipc-title__text');
        console.log(`Found ${items.length} titles in HTML`);
        for (let i = 0; i < 10; i++) {
            console.log(items.eq(i).text());
        }

    } catch (e) {
        console.error(e.message);
    }
}

testFetch();
