// cloudfunctions/getMoviesData/index.js
// 鑱氬悎浜戝嚱鏁帮細涓€娆℃€у姞杞界數褰卞垪琛?+ 鐢ㄦ埛鏍囪锛屽噺灏戝鎴风 API 璋冪敤娆℃暟

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const MAX_LIMIT = 100; // 浜戝嚱鏁扮鍗曟鏈€澶氳 1000锛?00 鏉′竴鎵硅冻澶熷揩

/**
 * 鍒嗘壒璇诲彇闆嗗悎鏁版嵁锛堜簯鍑芥暟绔棤 20 鏉￠檺鍒讹紝浣嗗缓璁壒閲忓埌 100 浠ュ唴锛?
 */
async function readAll(collectionName, query) {
    const countRes = await query.count();
    const total = countRes.total;
    if (total === 0) return [];

    const batchTimes = Math.ceil(total / MAX_LIMIT);
    const tasks = [];
    for (let i = 0; i < batchTimes; i++) {
        tasks.push(query.skip(i * MAX_LIMIT).limit(MAX_LIMIT).get());
    }
    const results = await Promise.all(tasks);
    let data = [];
    results.forEach(r => { data = data.concat(r.data); });
    return data;
}

exports.main = async (event, context) => {
    const { theme, openid, marksOnly } = event;
    // theme: 'douban' | 'imdb'
    // marksOnly: 鍙繑鍥炴爣璁帮紝璺宠繃鐢靛奖鍒楄〃鏌ヨ锛堢紦瀛樺懡涓悗鐨勮交閲忓埛鏂帮級

    try {
        // 浠呭埛鏂版爣璁帮紝涓嶉噸鏂版媺鍙栫數褰卞垪琛?
        if (marksOnly) {
            const marks = openid
                ? await readAll('Marks', db.collection('Marks').where({ openid }))
                : [];
            return { success: true, movies: [], marks };
        }

        let collectionName = 'movies';
        let orderByField = 'rank';
        let orderDirection = 'asc';
        let whereCondition = {};

        if (theme === 'imdb') {
            collectionName = 'imdb_movies';
        } else if (theme === 'oscar') {
            collectionName = 'oscar_movies';
            orderDirection = 'desc'; // 濂ユ柉鍗＄敱鏈€鏂板線鏃ф帓搴忥紝姣斿 96灞? 95灞?..
        } else if (theme === 'boxoffice') {
            collectionName = 'boxoffice_movies';
        } else if (theme === 'chinese') {
            collectionName = 'chinese_movies';
        } else if (theme === 'annual') {
            collectionName = 'annual_movies';
            orderByField = 'updateTime';
            orderDirection = 'desc';
        } else if (theme === 'chinese_awards') {
            collectionName = 'chinese_award_movies';
            orderByField = 'awardYear';
            orderDirection = 'desc';
        }

        const _ = db.command;
        const topListCollections = new Set(['movies', 'imdb_movies', 'boxoffice_movies', 'chinese_movies']);
        if (topListCollections.has(collectionName)) {
            whereCondition = { isTop250: _.neq(false) };
        }

        // 骞跺彂鏌ヨ锛氱數褰卞垪琛?+ 鐢ㄦ埛鏍囪锛堝鏋滄湁 openid锛?
        const moviesQuery = db
            .collection(collectionName)
            .where(whereCondition)
            .orderBy(orderByField, orderDirection);

        const [moviesRaw, marks] = await Promise.all([
            readAll(collectionName, moviesQuery),
            openid
                ? readAll('Marks', db.collection('Marks').where({ openid }))
                : Promise.resolve([])
        ]);

        let movies = moviesRaw;
        if (theme === 'annual') {
            movies = [...moviesRaw].sort((a, b) => {
                const dateA = a.releaseDate ? String(a.releaseDate).slice(0, 10).replace(/\./g, '-').replace(/\//g, '-') : '';
                const dateB = b.releaseDate ? String(b.releaseDate).slice(0, 10).replace(/\./g, '-').replace(/\//g, '-') : '';
                if (dateA && dateB && dateA !== dateB) return dateA.localeCompare(dateB);
                if (dateA && !dateB) return -1;
                if (!dateA && dateB) return 1;
                return String(a.title || '').localeCompare(String(b.title || ''));
            });
        } else if (theme === 'chinese_awards') {
            const awardOrder = {
                jinma: 0,
                jinxiang: 1,
                jinji: 2,
                baihua: 3
            };

            movies = [...moviesRaw].sort((a, b) => {
                const yearDiff = Number(b.awardYear || 0) - Number(a.awardYear || 0);
                if (yearDiff !== 0) return yearDiff;

                const ceremonyA = Number(String(a.awardCeremony || '').replace(/\D/g, '')) || 0;
                const ceremonyB = Number(String(b.awardCeremony || '').replace(/\D/g, '')) || 0;
                if (ceremonyB !== ceremonyA) return ceremonyB - ceremonyA;

                const awardDiff = (awardOrder[String(a.awardKey || '').toLowerCase()] ?? 99) - (awardOrder[String(b.awardKey || '').toLowerCase()] ?? 99);
                if (awardDiff !== 0) return awardDiff;

                return String(a.title || '').localeCompare(String(b.title || ''));
            });
        }

        return { success: true, movies, marks };
    } catch (err) {
        console.error('getMoviesData 澶辫触:', err);
        return { success: false, error: err.message, movies: [], marks: [] };
    }
};

