const axios = require('axios');
const cheerio = require('cheerio');

async function checkImdbEnglish() {
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

        // Find Amelie and other foreign movies
        const foreignMovies = edges.filter(e => {
            const text = e.node.titleText.text.toLowerCase();
            return text.includes('amelie') || text.includes('fabuleux') || text.includes('spirited') || text.includes('sen to');
        });

        foreignMovies.forEach(e => {
            console.log('ID:', e.node.id);
            console.log('TitleText:', e.node.titleText.text);
            if (e.node.originalTitleText) {
                console.log('OriginalTitleText:', e.node.originalTitleText.text);
            }
        });
    } catch (e) {
        console.error(e.message);
    }
}

checkImdbEnglish();
