const axios = require('axios');
const cheerio = require('cheerio');

async function test() {
    try {
        const res = await axios.get('https://www.imdb.com/chart/top/?ref_=hm_nv_menu&hl=zh-cn', {
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

        console.log('Total movies:', edges.length);
        for (let i = 0; i < 3; i++) {
            const node = edges[i].node;
            console.log(`Movie ${i + 1}: ${node.titleText.text}`);
            console.log('Primary Image:', node.primaryImage.url);
        }
    } catch (e) {
        console.error(e.message);
    }
}
test();
