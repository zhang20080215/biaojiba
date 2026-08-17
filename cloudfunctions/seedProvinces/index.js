// cloudfunctions/seedProvinces/index.js
// 全国旅游省份种子灌库：把内置的 34 省级行政区数组 upsert 进 travel_provinces。
// 数据是固定小名单（无爬取、无封面），可重复跑（幂等 upsert）。rank 按数组顺序 1..34。
// _id = 'province_' + code。字段与 utils/chinaProvinceGrid.js 的 PROVINCES 保持一致。
// 前端简称/网格靠 utils/chinaProvinceGrid.js（按 short 匹配），DB 仅存名单 + 标记所需字段。
//
// 参数：{ apply=true }  —— apply=false 时仅试跑返回将写入的条数，不落库。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const COLLECTION = 'travel_provinces';
const THEME = 'province';
const MIN_ACCEPT = 34;

// 34 省级行政区（含港澳台）。short=简称；code=ASCII 稳定键（_id 用）；region=七大分区。
const PROVINCES = [
  { code: 'BJ',  name: '北京市',           short: '北京',   region: '华北', area: 1.64,  capital: '北京' },
  { code: 'TJ',  name: '天津市',           short: '天津',   region: '华北', area: 1.19,  capital: '天津' },
  { code: 'HEB', name: '河北省',           short: '河北',   region: '华北', area: 18.88, capital: '石家庄' },
  { code: 'SX',  name: '山西省',           short: '山西',   region: '华北', area: 15.67, capital: '太原' },
  { code: 'NMG', name: '内蒙古自治区',     short: '内蒙古', region: '华北', area: 118.3, capital: '呼和浩特' },
  { code: 'LN',  name: '辽宁省',           short: '辽宁',   region: '东北', area: 14.86, capital: '沈阳' },
  { code: 'JL',  name: '吉林省',           short: '吉林',   region: '东北', area: 18.74, capital: '长春' },
  { code: 'HLJ', name: '黑龙江省',         short: '黑龙江', region: '东北', area: 47.30, capital: '哈尔滨' },
  { code: 'SH',  name: '上海市',           short: '上海',   region: '华东', area: 0.63,  capital: '上海' },
  { code: 'JS',  name: '江苏省',           short: '江苏',   region: '华东', area: 10.72, capital: '南京' },
  { code: 'ZJ',  name: '浙江省',           short: '浙江',   region: '华东', area: 10.55, capital: '杭州' },
  { code: 'AH',  name: '安徽省',           short: '安徽',   region: '华东', area: 14.01, capital: '合肥' },
  { code: 'FJ',  name: '福建省',           short: '福建',   region: '华东', area: 12.40, capital: '福州' },
  { code: 'JX',  name: '江西省',           short: '江西',   region: '华东', area: 16.69, capital: '南昌' },
  { code: 'SD',  name: '山东省',           short: '山东',   region: '华东', area: 15.71, capital: '济南' },
  { code: 'TW',  name: '台湾省',           short: '台湾',   region: '华东', area: 3.60,  capital: '台北' },
  { code: 'HEN', name: '河南省',           short: '河南',   region: '华中', area: 16.70, capital: '郑州' },
  { code: 'HUB', name: '湖北省',           short: '湖北',   region: '华中', area: 18.59, capital: '武汉' },
  { code: 'HUN', name: '湖南省',           short: '湖南',   region: '华中', area: 21.18, capital: '长沙' },
  { code: 'GD',  name: '广东省',           short: '广东',   region: '华南', area: 17.97, capital: '广州' },
  { code: 'GX',  name: '广西壮族自治区',   short: '广西',   region: '华南', area: 23.76, capital: '南宁' },
  { code: 'HAIN',name: '海南省',           short: '海南',   region: '华南', area: 3.54,  capital: '海口' },
  { code: 'HK',  name: '香港特别行政区',   short: '香港',   region: '华南', area: 0.11,  capital: '香港' },
  { code: 'MO',  name: '澳门特别行政区',   short: '澳门',   region: '华南', area: 0.03,  capital: '澳门' },
  { code: 'CQ',  name: '重庆市',           short: '重庆',   region: '西南', area: 8.24,  capital: '重庆' },
  { code: 'SC',  name: '四川省',           short: '四川',   region: '西南', area: 48.60, capital: '成都' },
  { code: 'GZ',  name: '贵州省',           short: '贵州',   region: '西南', area: 17.62, capital: '贵阳' },
  { code: 'YN',  name: '云南省',           short: '云南',   region: '西南', area: 38.33, capital: '昆明' },
  { code: 'XZ',  name: '西藏自治区',       short: '西藏',   region: '西南', area: 122.8, capital: '拉萨' },
  { code: 'SAX', name: '陕西省',           short: '陕西',   region: '西北', area: 20.56, capital: '西安' },
  { code: 'GS',  name: '甘肃省',           short: '甘肃',   region: '西北', area: 42.59, capital: '兰州' },
  { code: 'QH',  name: '青海省',           short: '青海',   region: '西北', area: 72.23, capital: '西宁' },
  { code: 'NX',  name: '宁夏回族自治区',   short: '宁夏',   region: '西北', area: 6.64,  capital: '银川' },
  { code: 'XJ',  name: '新疆维吾尔自治区', short: '新疆',   region: '西北', area: 166.0, capital: '乌鲁木齐' }
];

async function ensureCollection() {
  try { await db.createCollection(COLLECTION); } catch (e) { /* already exists */ }
}

exports.main = async (event) => {
  const { apply = true } = event || {};
  if (PROVINCES.length < MIN_ACCEPT) {
    return { success: false, error: `province list too short: ${PROVINCES.length} < ${MIN_ACCEPT}` };
  }
  if (!apply) {
    return { success: true, dryRun: true, count: PROVINCES.length };
  }

  await ensureCollection();
  const col = db.collection(COLLECTION);
  const now = new Date();
  let written = 0, failed = 0;

  // 用 doc(_id).set() 幂等 upsert：不存在则创建、存在则覆盖。
  // （微信云 doc().update() 对不存在的文档不会创建，会静默 updated:0，故不能用。）
  // 分批并发写入，避免串行累计超时。
  const BATCH = 25;
  for (let i = 0; i < PROVINCES.length; i += BATCH) {
    const slice = PROVINCES.slice(i, i + BATCH);
    const results = await Promise.all(slice.map((p, j) => {
      const idx = i + j;
      const _id = `${THEME}_${p.code}`;
      const doc = { theme: THEME, rank: idx + 1, code: p.code, name: p.name, shortName: p.short, region: p.region, area: p.area, capital: p.capital, updateTime: now };
      return col.doc(_id).set({ data: doc }).then(() => true).catch(e => { console.error('seed province fail', _id, e); return false; });
    }));
    results.forEach(ok => { if (ok) written++; else failed++; });
  }

  return { success: failed === 0, total: PROVINCES.length, written, failed };
};
