const axios = require('axios');
const fs = require('fs');
async function test() {
    const doubanData = await axios.get('https://m.douban.com/search/?query=' + encodeURIComponent('Oppenheimer') + '&type=movie', {
        headers: {
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 13_2_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.3 Mobile/15E148 Safari/604.1'
        }
    });
    fs.writeFileSync('test.html', doubanData.data);
}
test();
