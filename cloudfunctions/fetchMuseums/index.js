// cloudfunctions/fetchMuseums/index.js
// 中国国家一级博物馆灌库函数：抓取百度百科 starmap（词条「国家一级博物馆」lemmaId=1372604）分省合集，
// 解析 名称/批次/城市/封面，封面转存云存储（规避 iOS webp 白屏 + 防盗链），upsert 到 museum_grade1 集合。
//
// 与 fetchScenic5A 的差异：博物馆按「省份」分成 31 个子合集（每省一个 encodeRelId），需先遍历省份再逐省抓馆。
// 省份容器节点（fb156…）在无 token 的服务端请求下会返回反爬乱数据，但**各省 relId 的 collectinfo 服务端可正常读取**，
// 因此把 31 个省份 relId 硬编码在此（这些是持久 collect id，从 baike 前端 token 接口一次性取得、稳定不变）。
//
// 参数：{ forceRefresh=false, startFrom=0, autoContinue=false, museumList }
//   - forceRefresh：已有云存储封面也重新下载
//   - startFrom / autoContinue：断点续跑（封面下载耗时，单次容器有时限；startFrom 为扁平索引）
//   - museumList：可选，直接传入已解析的博物馆数组作种子（服务端抓取被百度限制时的兜底）
const cloud = require('wx-server-sdk');
const axios = require('axios');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const collection = db.collection('museum_grade1');
const MAX_LIMIT = 100;

const THEME = 'museum';
const LEMMA_ID = '1372604';
const PAGE_SIZE = 50;
const MIN_ACCEPT = 300; // 抓取结果少于此值视为异常，放弃写库（防止把好数据覆盖坏）

// 直辖市：location 只显示省级，不重复「北京·北京市」
const MUNICIPALITIES = ['北京', '上海', '天津', '重庆'];

// 省份合集 relId（顺序即展示顺序，地理向；与前端 PROVINCE_ORDER 对齐）。
// provinceFull=数据源省名，province=短名（用于列表省份筛选/位置显示）。
const PROVINCE_RELS = [
    ['北京市', '北京', '7a442b409ecf0dc8e0b3fb2a'],
    ['天津市', '天津', '3401e8c265c5e1b3b6e8fa2a'],
    ['河北省', '河北', 'f78312c88abeb7e8f8fbf92a'],
    ['山西省', '山西', '0d89feb3dde5f9fb564ef82a'],
    ['内蒙古自治区', '内蒙古', 'd59481c07329618f9b31e61a'],
    ['辽宁省', '辽宁', 'e1f2a8e894f6574ecabbff2a'],
    ['吉林省', '吉林', 'b7a9e6fb3b43cbbb99f1fe2a'],
    ['黑龙江省', '黑龙江', 'f9ba484ea4b698f19f8afd2a'],
    ['上海市', '上海', '570fd4bbf6fc9e8aeae3fc2a'],
    ['江苏省', '江苏', 'cbfa87f1ef87ebe383e2e32a'],
    ['浙江省', '浙江', '98b0818a9bee82e2d4d5e22a'],
    ['安徽省', '安徽', '9e811c1416b29e312b92e51a'],
    ['福建省', '福建', '9ecbf4e3f1efd5d59fc0e12a'],
    ['江西省', '江西', 'eba29de2a7d89ec00214e02a'],
    ['山东省', '山东', '82a3cad5ebcd0314648fe72a'],
    ['河南省', '河南', 'd59481c07719658f9b31e62a'],
    ['湖北省', '湖北', '9e811c1412829a312b92e52a'],
    ['湖南省', '湖南', '03557a8fec3c2a9226d3e42a'],
    ['广东省', '广东', '65ce8531539f27d32f3eeb2a'],
    ['广西壮族自治区', '广西', '65ce85315faf23d32f3eeb1a'],
    ['海南省', '海南', '71260de17c2d54fc91d313e9'],
    ['四川省', '四川', '9a7035925fde2e3e51cdea2a'],
    ['贵州省', '贵州', '03557a8fe80c2e9226d3e41a'],
    ['云南省', '云南', 'f483ebd1586776d63610c6ec'],
    ['重庆市', '重庆', '2ad338d3553350cdacfbe92a'],
    ['西藏自治区', '西藏', '12a0536176b081d3133412e9'],
    ['陕西省', '陕西', '2792313e2ac0adfb6810e82a'],
    ['甘肃省', '甘肃', '2e7f4fcdd0f669101416ef2a'],
    ['宁夏回族自治区', '宁夏', 'df6178d6be57d8bcb21dc4ec'],
    ['青海省', '青海', '4c205afca29f0334abb511e9'],
    ['新疆维吾尔自治区', '新疆', '6797281041fba21d5963cbec']
];

// ── 抓取某省合集一页 collectinfo ──
async function fetchPage(relId, pn) {
    const url = `https://baike.baidu.com/starmap/api/collectinfo?lemmaId=${LEMMA_ID}&encodeRelId=${relId}&pn=${pn}&rn=${PAGE_SIZE}&productId=1`;
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
    if (!j || j.errno !== 0 || !j.data) return { list: [], total: 0 };
    return { list: Array.isArray(j.data.list) ? j.data.list : [], total: j.data.total || 0 };
}

// ── 抓取一个省份的全部博物馆（分页兜底，虽然目前每省 ≤ 50）──
async function fetchProvince(relId) {
    let pn = 1, got = 0, total = Infinity;
    const items = [];
    while (got < total) {
        let page;
        try { page = await fetchPage(relId, pn); } catch (e) { break; }
        total = page.total;
        if (!page.list.length) break;
        page.list.forEach(it => { if (it && it.lemmaTitle) items.push(it); });
        got += page.list.length;
        pn++;
        if (pn > 10) break; // 安全阀
    }
    return items;
}

// ── 解析批次：desc "批次：第一批" → "第一批" ──
function parseBatch(desc) {
    const m = String(desc || '').match(/第[一二三四五六七八九十]+批/);
    return m ? m[0] : '';
}

// ── 解析城市：优先从 lemmaDesc（"浙江省宁波市…"）取市级名，取不到再从馆名（"临汾市博物馆"）兜底。──
// 很多条目 lemmaDesc 只是「国家一级博物馆」无地理信息，此时靠馆名前缀兜底；仍取不到返回 ''（列表用省份兜底）。
function cityFromDesc(lemmaDesc) {
    if (!lemmaDesc) return '';
    let head = String(lemmaDesc).replace(/^(中华人民共和国|中国)/, '');
    head = head.replace(/^[一-龥]{2,7}(?:省|自治区|特别行政区)/, ''); // 剥省级前缀
    const cm = head.match(/^([一-龥]{2,10}?(?:市|自治州|地区|盟))/);
    return cm ? cm[1].replace(/(市|自治州|地区|盟)$/, '').trim() : '';
}
// 馆名兜底：仅当馆名以「X市/X县/X自治州」明确开头时取（避免「四川大学…」「中国海盐…」误伤）
function cityFromName(name) {
    const m = String(name || '').match(/^([一-龥]{2,5}?)(?:市|县|自治州)/);
    return m ? m[1].trim() : '';
}
function parseCity(lemmaDesc, name, provinceShort) {
    if (MUNICIPALITIES.includes(provinceShort)) return ''; // 直辖市 location 只显示省级
    return cityFromDesc(lemmaDesc) || cityFromName(name);
}

// ── 组装展示用地理位置字符串 ──
function buildLocation(provinceShort, city) {
    if (!provinceShort) return city || '';
    if (MUNICIPALITIES.includes(provinceShort)) return provinceShort; // 直辖市不重复
    if (city && city !== provinceShort) return `${provinceShort} · ${city}`;
    return provinceShort;
}

// ── 简称提取（与 utils/museumShortName.js 保持一致；灌库写入 shortName 字段）──
// 博物馆名普遍简洁，简称主要 = 去括号补充（「山东博物馆（山东省文物鉴定中心）」→「山东博物馆」）。
const SHORT_OVERRIDES = {
    '北京故宫博物院': '故宫',
    '秦始皇帝陵博物院': '兵马俑',
    '中国人民革命军事博物馆': '军事博物馆',
    '中国人民抗日战争纪念馆': '抗战纪念馆',
    '中国共产党第一次全国代表大会纪念馆': '中共一大纪念馆',
    '侵华日军南京大屠杀遇难同胞纪念馆': '南京大屠杀纪念馆',
    '侵华日军第七三一部队罪证陈列馆': '731罪证陈列馆',
    '文化和旅游部恭王府博物馆': '恭王府博物馆'
};
function museumShortName(name) {
    const n = String(name || '').trim();
    if (!n) return '';
    if (SHORT_OVERRIDES[n]) return SHORT_OVERRIDES[n];
    // 去掉括号补充说明（全/半角），保留主名
    let s = n.replace(/[（(][^）)]*[）)]\s*$/, '').trim();
    return (s && s.length >= 2) ? s : n;
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
        // 路径统一放 `{theme}_covers/`，与 fetchScenic5A 一致——imageCacheManager.getThumbnailUrl
        // 按 `_covers/` 特征识别为「已转存封面」，直接返回不再叠 imageMogr2（否则 <image> 会 500）
        const uploadResult = await cloud.uploadFile({
            cloudPath: `museum_covers/${lemmaId}.jpg`,
            fileContent: Buffer.from(response.data)
        });
        return uploadResult.fileID;
    } catch (e) {
        console.warn(`封面转存失败 lemmaId=${lemmaId}，回退源URL:`, e.message);
        return coverUrl;
    }
}

// ── 遍历 31 省，抓取并解析全量博物馆（不含封面转存），返回按省序展开的扁平数组 ──
async function scrapeAllMuseums() {
    const museums = [];
    const seen = new Set();
    for (const [provinceFull, province, relId] of PROVINCE_RELS) {
        const items = await fetchProvince(relId);
        items.forEach(item => {
            const lemmaId = item.lemmaId != null ? String(item.lemmaId) : '';
            const name = (item.lemmaTitle || '').trim();
            if (!name || !lemmaId || seen.has(lemmaId)) return;
            seen.add(lemmaId);
            const city = parseCity(item.lemmaDesc, name, province);
            museums.push({
                lemmaId,
                rank: museums.length + 1,
                name,
                province,
                provinceFull,
                city,
                location: buildLocation(province, city),
                batch: parseBatch(item.desc),
                originalCover: forceJpg(item.coverPic || ''),
                summary: (item.summary || '').slice(0, 300)
            });
        });
    }
    return museums;
}

// 集合不存在则自动创建（首次灌库免去控制台手工建集合；已存在时忽略报错）
async function ensureCollection() {
    try {
        await db.createCollection('museum_grade1');
    } catch (e) {
        // 已存在会报错（errCode -501001 / already exist），静默忽略；其它错误也不阻断（后续读写会再暴露）
    }
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
        museumList
    } = event || {};

    try {
        await ensureCollection();

        // 数据来源：优先用传入的 museumList（兜底），否则服务端抓取
        let museums;
        if (Array.isArray(museumList) && museumList.length > 0) {
            museums = museumList;
        } else {
            museums = await scrapeAllMuseums();
        }

        if (museums.length < MIN_ACCEPT) {
            return { success: false, error: `抓取到 ${museums.length} 条，少于下限 ${MIN_ACCEPT}，放弃写库`, count: museums.length };
        }

        const existing = await fetchExisting();
        const pending = museums.slice(startFrom);

        let processed = 0;
        let stoppedEarly = false;
        const toAdd = [];
        const toUpdate = [];

        for (let i = 0; i < pending.length; i++) {
            if (Date.now() - START_TIME > TIME_LIMIT) {
                stoppedEarly = true;
                break;
            }
            const m = pending[i];
            const _id = `${THEME}_${m.lemmaId}`;
            const prev = existing[_id];

            const base = {
                theme: THEME,
                rank: m.rank,
                name: m.name,
                shortName: museumShortName(m.name),
                province: m.province,
                provinceFull: m.provinceFull,
                city: m.city,
                location: m.location,
                batch: m.batch,
                originalCover: m.originalCover,
                summary: m.summary,
                lemmaId: m.lemmaId,
                updateTime: db.serverDate()
            };

            // 封面：已转存云存储且非强制刷新 → 沿用；否则重新转存
            let cover;
            if (!forceRefresh && prev && prev.cover && String(prev.cover).startsWith('cloud://')) {
                cover = prev.cover;
            } else if (m.originalCover) {
                cover = await mirrorCover(m.originalCover, m.lemmaId);
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
                    name: 'fetchMuseums',
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
            total: museums.length,
            processed,
            added: toAdd.length,
            updated: toUpdate.length,
            stoppedEarly,
            autoChained,
            nextStartFrom: stoppedEarly ? nextStartFrom : 0,
            hint: !stoppedEarly
                ? '全部处理完成'
                : autoChained
                    ? `已自动接力，从 ${nextStartFrom} 继续（几分钟后用 getMuseums 查条数确认）`
                    : `未处理完，下次传入 { "startFrom": ${nextStartFrom} } 继续（或加 autoContinue:true 一键跑完）`
        };
    } catch (err) {
        console.error('[fetchMuseums] 执行失败:', err);
        return { success: false, error: err.message };
    }
};
