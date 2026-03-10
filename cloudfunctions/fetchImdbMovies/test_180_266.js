const axios = require('axios');

async function checkUrl(url) {
    try {
        const res = await axios.head(url, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            timeout: 5000
        });
        console.log('OK:', url);
    } catch (e) {
        if (e.response) {
            console.log(`FAIL ${e.response.status}:`, url);
        } else {
            console.log('FAIL:', e.message, url);
        }
    }
}

async function test() {
    const base = 'https://m.media-amazon.com/images/M/MV5BMDAyY2FhYjctNDc5OS00MDNlLThiMGUtY2UxYWVkNGY2ZjljXkEyXkFqcGc@._V1';

    const urls = [
        `${base}_UX180_CR0,0,180,266_AL_.jpg`,
        `${base}_QL75_UX180_CR0,0,180,266_.jpg`,
        `${base}_UX180_.jpg`,
        `${base}_UY266_.jpg`
    ];

    for (const url of urls) {
        await checkUrl(url);
    }
}
test();
