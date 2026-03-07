const axios = require('axios');

async function testYoudao() {
    try {
        const text = "The Godfather";
        const res = await axios.get(`http://fanyi.youdao.com/translate?&doctype=json&type=AUTO&i=${encodeURIComponent(text)}`);
        console.log(JSON.stringify(res.data, null, 2));
    } catch (e) {
        console.error(e.message);
    }
}

testYoudao();
