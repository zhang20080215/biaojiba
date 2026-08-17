// utils/chinaProvinceGrid.js
// 中国 34 省级行政区「像素网格拼图地图」的单一数据源 —— 省份 / 城市两个旅游主题的
// 分享海报共享。每个省被抽象成粗网格上的一块单元格（格子数≈按 sqrt(面积) 压缩后的相对大小、
// 位置按地理方位），彼此拼合、无缝铺满一个 16×12 的矩形。相邻异省单元之间描横/竖发丝线即成
// 「只有横线竖线」的正交拼图缝；同省单元合并后即省份的正交轮廓（L 形/阶梯形）。
//
// 该网格由 scratchpad/gen.js「地理种子 + 按面积配额区域生长」算法产出，并经 gridcheck.js
// 校验：行等长、每省 4-连通、无空洞、34 省齐全。若要微调某省形状，直接改 GRID 里对应字符即可
// （改后请保持每行 16 字符、每省连通）。
//
// 用法：
//   const G = require('../../utils/chinaProvinceGrid.js');
//   G.PROVINCES   —— 34 省元数据数组（含 code/name/short/region/area/capital/char）
//   G.COLS/G.ROWS —— 网格列/行数（16 / 12）
//   G.forEachCell(cb) —— 遍历每个单元格 cb(col,row,short,code)
//   G.geometry()  —— { [code]: { cells:[[c,r]...], cx, cy, count } } 用于海报标注/上色
//   G.REGION_ORDER —— 七大地理分区展示顺序

// 单字符图例 → 省简称（与 gen.js 一致）
var CHAR_TO_SHORT = {
  X: '新疆', Z: '西藏', Q: '青海', G: '甘肃', M: '内蒙古', N: '宁夏', S: '陕西',
  J: '山西', H: '河北', B: '北京', T: '天津', L: '辽宁', '1': '吉林', '2': '黑龙江',
  D: '山东', Y: '河南', U: '江苏', A: '安徽', '3': '上海', E: '浙江', '4': '湖北',
  C: '重庆', W: '四川', '5': '贵州', '6': '云南', '7': '广西', '8': '广东', '9': '湖南',
  '0': '江西', F: '福建', I: '海南', V: '台湾', K: '香港', O: '澳门'
};

// 网格（16 行 × 12 列，3:4 竖版，填满竖版海报），字符见 CHAR_TO_SHORT。
// gen.js（W=12,H=16）产出、gridcheck.js 校验通过（无缝铺满、每省 4-连通、34 省齐全）。
var GRID = [
  'XXXXMMMMM222',
  'XXXXMMMMM222',
  'XXXXGMMMM111',
  'XXXXGGJHLLL1',
  'XXQGGGJHBTL1',
  'QQQQGNJHDDLL',
  'ZQQQQSSYDDUU',
  'ZZZWQSYYAUUU',
  'ZZZWWC4AAU3E',
  'ZZZWWC44AEEE',
  'ZZZW55990EEE',
  '6Z6655900FVE',
  '66665798FFVE',
  '666677788888',
  '6666777OK888',
  '666677II8888'
];
var COLS = GRID[0].length;   // 12
var ROWS = GRID.length;      // 16

var REGION_ORDER = ['华北', '东北', '华东', '华中', '华南', '西南', '西北'];

// 34 省元数据。short=简称（海报/列表标题、与 CHAR_TO_SHORT 对应）；code=ASCII 稳定键（_id 用）；
// name=完整行政区名；region=七大分区；area=面积(万 km²)；capital=省会/首府。
// _id = 'province_' + code。rank 由 seed 云函数按本数组顺序 1..34 赋值。
var PROVINCES = [
  // 华北
  { char: 'B', code: 'BJ',  name: '北京市',           short: '北京',   region: '华北', area: 1.64,  capital: '北京' },
  { char: 'T', code: 'TJ',  name: '天津市',           short: '天津',   region: '华北', area: 1.19,  capital: '天津' },
  { char: 'H', code: 'HEB', name: '河北省',           short: '河北',   region: '华北', area: 18.88, capital: '石家庄' },
  { char: 'J', code: 'SX',  name: '山西省',           short: '山西',   region: '华北', area: 15.67, capital: '太原' },
  { char: 'M', code: 'NMG', name: '内蒙古自治区',     short: '内蒙古', region: '华北', area: 118.3, capital: '呼和浩特' },
  // 东北
  { char: 'L', code: 'LN',  name: '辽宁省',           short: '辽宁',   region: '东北', area: 14.86, capital: '沈阳' },
  { char: '1', code: 'JL',  name: '吉林省',           short: '吉林',   region: '东北', area: 18.74, capital: '长春' },
  { char: '2', code: 'HLJ', name: '黑龙江省',         short: '黑龙江', region: '东北', area: 47.30, capital: '哈尔滨' },
  // 华东
  { char: '3', code: 'SH',  name: '上海市',           short: '上海',   region: '华东', area: 0.63,  capital: '上海' },
  { char: 'U', code: 'JS',  name: '江苏省',           short: '江苏',   region: '华东', area: 10.72, capital: '南京' },
  { char: 'E', code: 'ZJ',  name: '浙江省',           short: '浙江',   region: '华东', area: 10.55, capital: '杭州' },
  { char: 'A', code: 'AH',  name: '安徽省',           short: '安徽',   region: '华东', area: 14.01, capital: '合肥' },
  { char: 'F', code: 'FJ',  name: '福建省',           short: '福建',   region: '华东', area: 12.40, capital: '福州' },
  { char: '0', code: 'JX',  name: '江西省',           short: '江西',   region: '华东', area: 16.69, capital: '南昌' },
  { char: 'D', code: 'SD',  name: '山东省',           short: '山东',   region: '华东', area: 15.71, capital: '济南' },
  { char: 'V', code: 'TW',  name: '台湾省',           short: '台湾',   region: '华东', area: 3.60,  capital: '台北' },
  // 华中
  { char: 'Y', code: 'HEN', name: '河南省',           short: '河南',   region: '华中', area: 16.70, capital: '郑州' },
  { char: '4', code: 'HUB', name: '湖北省',           short: '湖北',   region: '华中', area: 18.59, capital: '武汉' },
  { char: '9', code: 'HUN', name: '湖南省',           short: '湖南',   region: '华中', area: 21.18, capital: '长沙' },
  // 华南
  { char: '8', code: 'GD',  name: '广东省',           short: '广东',   region: '华南', area: 17.97, capital: '广州' },
  { char: '7', code: 'GX',  name: '广西壮族自治区',   short: '广西',   region: '华南', area: 23.76, capital: '南宁' },
  { char: 'I', code: 'HAIN',name: '海南省',           short: '海南',   region: '华南', area: 3.54,  capital: '海口' },
  { char: 'K', code: 'HK',  name: '香港特别行政区',   short: '香港',   region: '华南', area: 0.11,  capital: '香港' },
  { char: 'O', code: 'MO',  name: '澳门特别行政区',   short: '澳门',   region: '华南', area: 0.03,  capital: '澳门' },
  // 西南
  { char: 'C', code: 'CQ',  name: '重庆市',           short: '重庆',   region: '西南', area: 8.24,  capital: '重庆' },
  { char: 'W', code: 'SC',  name: '四川省',           short: '四川',   region: '西南', area: 48.60, capital: '成都' },
  { char: '5', code: 'GZ',  name: '贵州省',           short: '贵州',   region: '西南', area: 17.62, capital: '贵阳' },
  { char: '6', code: 'YN',  name: '云南省',           short: '云南',   region: '西南', area: 38.33, capital: '昆明' },
  { char: 'Z', code: 'XZ',  name: '西藏自治区',       short: '西藏',   region: '西南', area: 122.8, capital: '拉萨' },
  // 西北
  { char: 'S', code: 'SAX', name: '陕西省',           short: '陕西',   region: '西北', area: 20.56, capital: '西安' },
  { char: 'G', code: 'GS',  name: '甘肃省',           short: '甘肃',   region: '西北', area: 42.59, capital: '兰州' },
  { char: 'Q', code: 'QH',  name: '青海省',           short: '青海',   region: '西北', area: 72.23, capital: '西宁' },
  { char: 'N', code: 'NX',  name: '宁夏回族自治区',   short: '宁夏',   region: '西北', area: 6.64,  capital: '银川' },
  { char: 'X', code: 'XJ',  name: '新疆维吾尔自治区', short: '新疆',   region: '西北', area: 166.0, capital: '乌鲁木齐' }
];

// 索引：char → 省对象；short → 省对象；code → 省对象
var BY_CHAR = {}, BY_SHORT = {}, BY_CODE = {};
PROVINCES.forEach(function (p) { BY_CHAR[p.char] = p; BY_SHORT[p.short] = p; BY_CODE[p.code] = p; });

// 遍历每个单元格：cb(col, row, short, code)
function forEachCell(cb) {
  for (var r = 0; r < ROWS; r++) {
    for (var c = 0; c < COLS; c++) {
      var ch = GRID[r][c];
      var p = BY_CHAR[ch];
      if (p) cb(c, r, p.short, p.code);
    }
  }
}

// 每省几何：单元格列表 + 质心（用于海报标注/上色），按 code 索引。惰性计算一次。
var _geom = null;
function geometry() {
  if (_geom) return _geom;
  var g = {};
  forEachCell(function (c, r, short, code) {
    if (!g[code]) g[code] = { cells: [], cx: 0, cy: 0, count: 0, short: short };
    g[code].cells.push([c, r]);
  });
  Object.keys(g).forEach(function (code) {
    var o = g[code];
    var sx = 0, sy = 0;
    o.cells.forEach(function (cell) { sx += cell[0]; sy += cell[1]; });
    o.count = o.cells.length;
    o.cx = sx / o.count;
    o.cy = sy / o.count;
    // 让质心尽量落在本省实际单元上（避免凹形省质心跑到别省格子里）
    var best = o.cells[0], bestD = Infinity;
    o.cells.forEach(function (cell) {
      var d = (cell[0] - o.cx) * (cell[0] - o.cx) + (cell[1] - o.cy) * (cell[1] - o.cy);
      if (d < bestD) { bestD = d; best = cell; }
    });
    o.labelCell = best;
  });
  _geom = g;
  return g;
}

module.exports = {
  GRID: GRID,
  COLS: COLS,
  ROWS: ROWS,
  PROVINCES: PROVINCES,
  REGION_ORDER: REGION_ORDER,
  CHAR_TO_SHORT: CHAR_TO_SHORT,
  byChar: function (ch) { return BY_CHAR[ch]; },
  byShort: function (s) { return BY_SHORT[s]; },
  byCode: function (c) { return BY_CODE[c]; },
  forEachCell: forEachCell,
  geometry: geometry
};
