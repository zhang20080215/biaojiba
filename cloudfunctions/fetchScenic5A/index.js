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

// ── 简称提取（与 utils/scenicShortName.js 保持一致；灌库写入 shortName 字段）──
const SHORT_OVERRIDES = {
    '北京故宫博物院': '故宫', '文化和旅游部恭王府博物馆': '恭王府', '北京奥林匹克公园': '奥林匹克公园',
    '圆明园遗址公园': '圆明园', '北京（通州）大运河文化旅游景区': '大运河', '八达岭－慕田峪长城旅游区': '八达岭长城',
    '承德市承德避暑山庄及周围寺庙景区': '避暑山庄', '唐山市南湖·开滦旅游景区': '唐山南湖·开滦旅游区',
    '临汾市洪洞大槐树寻根祭祖园旅游景区': '洪洞大槐树', '长治市太行山大峡谷八泉峡景区': '八泉峡', '呼和浩特市老牛湾黄河大峡谷旅游区': '老牛湾黄河大峡谷',
    '伪满皇宫博物院': '伪满皇宫', '通化市高句丽文物古迹旅游景区': '高句丽文物古迹', '大连市老虎滩海洋公园－老虎滩极地馆': '老虎滩海洋公园',
    '东方明珠广播电视塔': '东方明珠', '中国共产党一大·二大·四大纪念馆景区': '中共一大纪念馆',
    '苏州市苏州园林（拙政园－留园－虎丘）': '拙政园-留园-虎丘', '无锡市中央电视台无锡影视基地三国水浒城景区': '三国水浒城',
    '镇江市金山·焦山·北固山风景区': '金山-焦山-北固山', '苏州市沙家浜－虞山尚湖旅游区': '沙家浜-虞山尚湖',
    '浙江杭州西溪国家湿地公园': '西溪湿地', '嘉兴市南湖旅游区': '嘉兴南湖', '金华市双龙风景旅游区': '金华双龙',
    '黄山市皖南古村落－西递宏村': '皖南古村落-西递宏村', '芜湖市方特旅游区': '芜湖方特',
    '马鞍山市长江采石矶文化生态旅游区': '长江采石矶', '福州市三坊七巷历史文化街区': '三坊七巷',
    '宁德市（白水洋·鸳鸯溪）旅游景区': '白水洋-鸳鸯溪', '三明市泰宁风景旅游区': '泰宁世界地质公园',
    '莆田市湄洲岛妈祖文化旅游区': '湄洲岛', '济宁市明故城三孔旅游区': '明故城三孔', '商丘市芒砀山汉文化旅游景区': '芒砀山',
    '南阳市西峡恐龙遗迹园－伏牛山－老界岭旅游区': '西峡恐龙园-伏牛山-老界岭', '咸宁市三国赤壁古战场景区': '赤壁古战场',
    '武汉市东湖生态旅游风景区': '武汉东湖', '武汉市木兰文化生态旅游区': '木兰文化旅游区',
    '恩施土家族苗族自治州神农溪纤夫文化旅游区': '神农溪', '深圳市华侨城旅游度假区': '深圳华侨城',
    '佛山市长鹿旅游休博园': '长鹿农庄', '阳江市海陵岛大角湾海上丝路旅游区': '海陵岛', '广州市长隆旅游度假区': '广州长隆',
    '南宁市青秀山风景名胜旅游区': '青秀山', '桂林市两江四湖·象山景区': '桂林两江四湖-象山', '桂林市乐满地度假世界': '桂林乐满地度假世界',
    '北海市涠洲岛南湾鳄鱼山景区': '涠洲岛南湾鳄鱼山', '保亭县海南槟榔谷黎苗文化旅游区': '槟榔谷', '桃花源旅游景区': '重庆桃花源',
    '广元市剑门蜀道剑门关旅游景区': '剑门关', '毕节市黔西县百里杜鹃景区': '百里杜鹃', '安顺市龙宫景区': '安顺龙宫',
    '阿坝藏族羌族自治州汶川特别旅游区': '汶川特别旅游区',
    '秦始皇帝陵博物院': '兵马俑', '青岛市奥帆海洋文化旅游区': '奥帆中心', '西安市城墙·碑林历史文化景区': '西安城墙',
    '大明宫国家遗址公园': '大明宫', '延安市延川黄河乾坤湾景区': '乾坤湾', '嘉峪关市嘉峪关文物景区': '嘉峪关',
    '临夏回族自治州炳灵寺世界文化遗产旅游区': '炳灵寺', '海东市互助土族故土园旅游区': '土族故土园', '银川市宁夏镇北堡西部影视城': '西部影视城',
    '吴忠市青铜峡黄河大峡谷旅游区': '青铜峡', '固原市六盘山红军长征旅游区': '六盘山', '中国科学院西双版纳热带植物园': '西双版纳植物园',
    '普达措国家公园': '普达措', '宝鸡市法门文化景区': '法门寺',
    '南充市朱德故里景区': '朱德故里'
};
const SHORT_SUFFIXES = [
    '生态文化旅游区', '生态旅游风景区', '文化旅游景区', '休闲旅游区', '生态旅游区',
    '旅游风景区', '旅游度假区', '文化旅游区', '风景名胜区', '风景旅游区', '风景名胜',
    '旅游景区', '风景廊道', '风光带', '旅游区', '度假区', '游览区', '博览区',
    '风景区', '名胜区', '风景', '景区', '公园', '旅游'
];
const SHORT_PREFIX_RE = /^[一-龥]{2,15}?(?:自治州|自治县|林区|地区|盟|市|州|县)/;
function shortStripSuffix(s) {
    let changed = true;
    while (changed) {
        changed = false;
        for (const suf of SHORT_SUFFIXES) {
            if (s.length > suf.length + 1 && s.slice(-suf.length) === suf) { s = s.slice(0, -suf.length); changed = true; break; }
        }
    }
    return s;
}
function scenicShortName(name) {
    const n = String(name || '').trim();
    if (!n) return '';
    if (SHORT_OVERRIDES[n]) return SHORT_OVERRIDES[n];
    let s = n.replace(/[（(].*$/, '');
    const m = s.match(SHORT_PREFIX_RE);
    if (m && s.length - m[0].length >= 2) s = s.slice(m[0].length);
    const seg = s.split(/[－\-·、／/]/)[0];
    if (seg.length >= 2) s = seg;
    s = shortStripSuffix(s).trim();
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
                shortName: scenicShortName(spot.name),
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
