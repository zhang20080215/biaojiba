const axios = require('axios');

async function testTranslate() {
    try {
        const text = "The Shawshank Redemption";
        const res = await axios.get(`http://fanyi.youdao.com/translate?&doctype=json&type=AUTO&i=${encodeURIComponent(text)}`);
        console.log('Result:', res.data.translateResult[0][0].tgt);
    } catch (e) {
        console.error(e.message);
    }
}

testTranslate();
