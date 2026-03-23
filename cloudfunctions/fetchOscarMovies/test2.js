const axios = require('axios');
async function test() {
    try {
        const highResBufferUrl = 'https://img2.doubanio.com/view/photo/m_ratio_poster/public/p2876555451.jpg';
        console.log('Testing m_ratio_poster...');
        const response = await axios({
            url: highResBufferUrl,
            responseType: 'arraybuffer',
            timeout: 10000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });
        console.log('Success, size:', response.data.length);
    } catch (e) {
        console.error('m_ratio_poster Failed:', e.message);
    }

    try {
        const url = 'https://img2.doubanio.com/view/photo/s_ratio_poster/public/p2876555451.jpg';
        console.log('\nTesting s_ratio_poster...');
        const response = await axios({
            url: url,
            responseType: 'arraybuffer',
            timeout: 10000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });
        console.log('Success, size:', response.data.length);
    } catch (e) {
        console.error('s_ratio_poster Failed:', e.message);
    }
}
test();
