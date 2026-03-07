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
        const nextDataScript = $('script#__NEXT_DATA__').html();
        const nextData = JSON.parse(nextDataScript);
        const edges = nextData.props.pageProps.pageData.chartTitles.edges;

        console.log(`Found ${edges.length} movies`);
        const firstMovie = edges[0].node;

        const fs = require('fs');
        fs.writeFileSync('first_movie.json', JSON.stringify(firstMovie, null, 2));
        console.log('Saved to first_movie.json');

    } catch (e) {
        console.error(e.message);
    }
}

testFetch();
