const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');

async function checkAmelie() {
    try {
        const res = await axios.get('https://www.imdb.com/chart/top/?hl=zh-cn', {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Cookie': 'lc-main=zh_CN;'
            }
        });

        const $ = cheerio.load(res.data);
        const nextDataScript = $('script#__NEXT_DATA__').html();
        const nextData = JSON.parse(nextDataScript);
        const edges = nextData.props.pageProps.pageData.chartTitles.edges;

        // Find Amelie
        const amelie = edges.find(e => {
            const text = e.node.titleText.text.toLowerCase();
            return text.includes('fabuleux');
        });

        if (amelie) {
            fs.writeFileSync('amelie.json', JSON.stringify(amelie.node, null, 2));
            console.log('Saved to amelie.json');
        }
    } catch (e) {
        console.error(e.message);
    }
}

checkAmelie();
