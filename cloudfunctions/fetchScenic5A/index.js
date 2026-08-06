// cloudfunctions/fetchScenic5A/index.js
// 全国5A旅游景区灌库函数：抓取百度百科 starmap collectinfo 分页接口（国家AAAAA级旅游景区词条聚合），
// 解析 名称/省份/城市/封面，封面转存云存储（规避 iOS webp 白屏 + 防盗链），upsert 到 scenic_5a 集合。
//
// 与 enrichThemeMovies 不同：无豆瓣匹配（数据源本身就是结构化的），直接解析 API JSON。
// 沿用 enrichThemeMovies 的「超时分批 + startFrom 续跑 + autoContinue 自动接力」写法（封面下载慢）。
//
// 参数：{ forceRefresh=false, startFrom=0, autoContinue=false, spotList }
//   - forceRefresh：已有云存储封面也重新下载
//   - startFrom / autoContinue：断点续跑（封面下载耗时，单次容器有时限）
//   - spotList：可选，直接传入已解析的景区数组作种子（服务端抓取被百度限制时的兜底）
const cloud = require('wx-server-sdk');
const axios = require('axios');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const collection = db.collection('scenic_5a');
const MAX_LIMIT = 100;

const THEME = 'scenic5a';
const LEMMA_ID = '3575094';
const REL_ID = 'b9ad24c5286df4c5d50e582c';
const PAGE_SIZE = 50;
const TOTAL_PAGES = 8; // 359 条，rn=50 → 8 页
const MIN_ACCEPT = 300; // 抓取结果少于此值视为异常，放弃写库（防止把好数据覆盖坏）

// 直辖市：location 只显示省级，不重复出现「北京·北京市」
const MUNICIPALITIES = ['北京', '上海', '天津', '重庆'];

// ── 抓取一页 collectinfo ──
async function fetchPage(pn) {
    const url = `https://baike.baidu.com/starmap/api/collectinfo?lemmaId=${LEMMA_ID}&encodeRelId=${REL_ID}&pn=${pn}&rn=${PAGE_SIZE}&productId=1`;
    const res = await axios.get(url, {
        timeout: 12000,
        responseType: 'json',
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
            'Referer': 'https://baike.baidu.com/',
            'Accept': 'application/json, text/plain, */*'
        }
    });
    const j = res && res.data;
    if (!j || j.errno !== 0 || !j.data || !Array.isArray(j.data.list)) return [];
    return j.data.list;
}

// ── 解析省份：desc "所处位置：浙江" / "所属地区：浙江" → 首个省份短名（跨省"山西、陕西"取首个）──
function parseProvince(desc) {
    const raw = String(desc || '').replace(/所[处属](位置|地区)\s*[:：]\s*/, '').trim();
    if (!raw) return '';
    return raw.split(/[、,，]/)[0].trim();
}

// ── 解析城市：lemmaDesc "浙江省舟山市的国家5A级旅游景区" → 城市短名（去"市/自治州"后缀）──
// 先剥掉开头的省/自治区/特别行政区前缀，再取紧跟的市级名，避免把省名一起圈进去。
// 覆盖率实测 354/359；边缘条目（布达拉宫/兵团等）解析不到时返回 ''。
function parseCity(lemmaDesc) {
    if (!lemmaDesc) return '';
    let head = '';
    const deIdx = lemmaDesc.indexOf('的');
    if (deIdx > 0 && deIdx <= 14) {
        head = lemmaDesc.slice(0, deIdx);
    } else {
        const m0 = lemmaDesc.match(/位于([^，。、；]{2,16})/);
        head = m0 ? m0[1] : '';
    }
    if (!head) return '';
    // 剥掉省级前缀（含"新疆维吾尔自治区"等较长名，取 2~7 字 + 后缀）
    head = head.replace(/^[一-龥]{2,7}(?:省|自治区|特别行政区)/, '');
    const cm = head.match(/^([一-龥]{2,10}?(?:市|自治州|地区|盟))/);
    if (!cm) return '';
    return cm[1].replace(/(市|自治州|地区|盟)$/, '').trim();
}

// ── 组装展示用地理位置字符串 ──
function buildLocation(province, city) {
    if (!province) return city || '';
    if (MUNICIPALITIES.includes(province)) return province; // 直辖市不重复
    if (city && city !== province) return `${province} · ${city}`;
    return province;
}

// ── 把源封面 URL 强制成 jpg（f_auto 会给 iOS webp，image 组件真机白屏）──
function forceJpg(coverPic) {
    if (!coverPic) return '';
    let u = coverPic.replace(/f_auto/g, 'f_jpg');
    if (!/x-bce-process=/.test(u)) {
        u += (u.indexOf('?') >= 0 ? '&' : '?') + 'x-bce-process=image/format,f_jpg';
    }
    return u;
}

// ── 下载封面并上传云存储，失败回退源 URL ──
async function mirrorCover(coverUrl, lemmaId) {
    try {
        const response = await axios({
            url: coverUrl,
            responseType: 'arraybuffer',
            timeout: 15000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Referer': 'https://baike.baidu.com/'
            }
        });
        // 路径统一放 `{theme}_covers/`，与 enrichThemeMovies 一致——imageCacheManager.getThumbnailUrl
        // 按 `_covers/` 特征识别为「已转存封面」，直接返回不再叠 imageMogr2（否则 <image> 会 500）
        const uploadResult = await cloud.uploadFile({
            cloudPath: `scenic5a_covers/${lemmaId}.jpg`,
            fileContent: Buffer.from(response.data)
        });
        return uploadResult.fileID;
    } catch (e) {
        console.warn(`封面转存失败 lemmaId=${lemmaId}，回退源URL:`, e.message);
        return coverUrl;
    }
}

// ── 抓取并解析全量景区（不含封面转存），返回按源顺序的数组 ──
async function scrapeAllSpots() {
    const pages = await Promise.all(
        Array.from({ length: TOTAL_PAGES }, (_, i) => fetchPage(i + 1).catch(() => []))
    );
    let raw = [];
    pages.forEach(list => { raw = raw.concat(list); });

    const spots = [];
    const seen = new Set();
    raw.forEach((item, idx) => {
        const lemmaId = item.lemmaId != null ? String(item.lemmaId) : '';
        const name = (item.lemmaTitle || '').trim();
        if (!name || !lemmaId || seen.has(lemmaId)) return;
        seen.add(lemmaId);
        const province = parseProvince(item.desc);
        const city = parseCity(item.lemmaDesc);
        spots.push({
            lemmaId,
            rank: spots.length + 1,
            name,
            province,
            city,
            location: buildLocation(province, city),
            originalCover: forceJpg(item.coverPic || ''),
            summary: (item.summary || '').slice(0, 300)
        });
    });
    return spots;
}

async function fetchExisting() {
    const map = {};
    let offset = 0;
    while (true) {
        const res = await collection.skip(offset).limit(MAX_LIMIT).get();
        res.data.forEach(d => { map[d._id] = d; });
        if (res.data.length < MAX_LIMIT) break;
        offset += MAX_LIMIT;
    }
    return map;
}

exports.main = async (event) => {
    const START_TIME = Date.now();
    const TIME_LIMIT = 45000;

    const {
        forceRefresh = false,
        startFrom = 0,
        autoContinue = false,
        spotList
    } = event || {};

    try {
        // 数据来源：优先用传入的 spotList（兜底），否则服务端抓取
        let spots;
        if (Array.isArray(spotList) && spotList.length > 0) {
            spots = spotList;
        } else {
            spots = await scrapeAllSpots();
        }

        if (spots.length < MIN_ACCEPT) {
            return { success: false, error: `抓取到 ${spots.length} 条，少于下限 ${MIN_ACCEPT}，放弃写库`, count: spots.length };
        }

        const existing = await fetchExisting();
        const pending = spots.slice(startFrom);

        let processed = 0;
        let stoppedEarly = false;
        const toAdd = [];
        const toUpdate = [];

        for (let i = 0; i < pending.length; i++) {
            if (Date.now() - START_TIME > TIME_LIMIT) {
                stoppedEarly = true;
                break;
            }
            const spot = pending[i];
            const _id = `${THEME}_${spot.lemmaId}`;
            const prev = existing[_id];

            const base = {
                theme: THEME,
                rank: spot.rank,
                name: spot.name,
                province: spot.province,
                city: spot.city,
                location: spot.location,
                originalCover: spot.originalCover,
                summary: spot.summary,
                lemmaId: spot.lemmaId,
                updateTime: db.serverDate()
            };

            // 封面：已转存云存储且非强制刷新 → 沿用；否则重新转存
            let cover;
            if (!forceRefresh && prev && prev.cover && String(prev.cover).startsWith('cloud://')) {
                cover = prev.cover;
            } else if (spot.originalCover) {
                cover = await mirrorCover(spot.originalCover, spot.lemmaId);
            } else {
                cover = (prev && prev.cover) || '';
            }
            base.cover = cover;

            if (prev) {
                toUpdate.push({ _id, data: base });
            } else {
                toAdd.push({ _id, ...base, createTime: db.serverDate() });
            }
            processed++;
        }

        for (const u of toUpdate) {
            await collection.doc(u._id).update({ data: u.data }).catch(console.error);
        }
        for (let i = 0; i < toAdd.length; i += 20) {
            const batch = toAdd.slice(i, i + 20);
            await Promise.all(batch.map(d => {
                const { _id, ...data } = d;
                return collection.add({ data: { _id, ...data } });
            })).catch(console.error);
        }

        const nextStartFrom = startFrom + processed;

        // 自动接力（fire-and-forget，不能 await，否则嵌套等待必超时）
        let autoChained = false;
        if (stoppedEarly && autoContinue && processed > 0) {
            try {
                cloud.callFunction({
                    name: 'fetchScenic5A',
                    data: { forceRefresh, startFrom: nextStartFrom, autoContinue: true }
                }).catch(e => console.error('自动接力触发失败:', e && e.message));
                await new Promise(r => setTimeout(r, 1200));
                autoChained = true;
            } catch (e) {
                console.error('自动接力异常:', e && e.message);
            }
        }

        return {
            success: true,
            total: spots.length,
            processed,
            added: toAdd.length,
            updated: toUpdate.length,
            stoppedEarly,
            autoChained,
            nextStartFrom: stoppedEarly ? nextStartFrom : 0,
            hint: !stoppedEarly
                ? '全部处理完成'
                : autoChained
                    ? `已自动接力，从 ${nextStartFrom} 继续（几分钟后用 getScenicSpots 查条数确认）`
                    : `未处理完，下次传入 { "startFrom": ${nextStartFrom} } 继续（或加 autoContinue:true 一键跑完）`
        };
    } catch (err) {
        console.error('[fetchScenic5A] 执行失败:', err);
        return { success: false, error: err.message };
    }
};
