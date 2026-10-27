// pages/genericBookList 的主题配置表 —— 走 enrichThemeBooks/generic_theme_books 流水线的新读书主题，
// 不用再复制一份 list/share 页面目录，只需在这里加一行配置。镜像 utils/genericThemeConfig.js（电影版），
// 差异：多一个 source 字段（写 BookMarks 时用，见 pages/genericBookList/list/list.js）。
//
// 字段说明：
//   showEdition   — 是否显示"第X届 · 年份[ · 作者]"信息行（false 则标题前缀 rank）
//   showYear      — 无"届"概念、按年份评选的奖项（如纽伯瑞金奖）：只显示"年份 · 作者"，
//                   与 showEdition 二选一（showEdition 为 true 时优先）
//   editionField  — 届数取 item 的哪个字段：'edition'（独立字段，茅盾文学奖等按届评选的奖项用这个）
//                   或 'rank'（rank 本身就是届数）
//   orderDirection— 传给云函数的 rank 排序方向：新到旧编号的主题用 'asc'（rank 1=最新）；
//                   rank 本身是历史届数（逐年递增）的主题要 'desc' 才能新到旧展示
//   source        — 写入 BookMarks 的 source 值，每个通用读书主题一个专属值，纯审计/统计用途
//                   （douban_books / weread_books 两个老主题的值必须是 'douban' / 'weread'——
//                   getMoviesData 读标记时按这两个值过滤，写别的老标记就读不出来）
//   simplifyTitle — 海报上书名去括注（utils/bookFormat.simplifyTitle），豆瓣读书的书名版本括注多才开
//   useCache      — 走 24h 本地缓存、进页面不强制刷新（老主题数据几乎不变；通用书单 listVersion 恒为 null
//                   才需要每次进页面强拉）
//   作者 chip 是否显示由数据本身决定（item.author 有值才渲染），不用单独开关
const THEME_CONFIG = {
  // ── 老主题（专属集合 douban_books / weread_books，走 getMoviesData；2026-09 从各自独立页面目录并入）──
  douban_books: {
    title: '豆瓣读书TOP250',
    slogan: '标记你读过的经典，生成专属书单海报',
    brandPrimary: '#58743C',
    brandSoft: '#849E62',
    shadowRgb: '88, 116, 60',
    showEdition: false,
    orderDirection: 'asc',
    source: 'douban',
    simplifyTitle: true,
    useCache: true,
  },
  weread_books: {
    title: '微信读书TOP200总榜',
    slogan: '微信读书全平台热榜，记录你的阅读旅程',
    brandPrimary: '#266C98',
    brandSoft: '#4E9EC4',
    shadowRgb: '38, 108, 152',
    showEdition: false,
    orderDirection: 'asc',
    source: 'weread',
    useCache: true,
  },
  // ── 走 enrichThemeBooks / generic_theme_books 通用流水线 ──
  maodun: {
    title: '历届茅盾文学奖',
    slogan: '标记你读过的经典，生成专属书单海报',
    brandPrimary: '#8B2E2E',
    brandSoft: '#B5605C',
    shadowRgb: '139, 46, 46',
    showEdition: true,
    editionField: 'edition',
    orderDirection: 'asc',
    source: 'maodun',
  },
  newbery: {
    title: '纽伯瑞儿童文学金奖',
    slogan: '标记你读过的经典，生成专属书单海报',
    brandPrimary: '#B8860B',
    brandSoft: '#D4A94A',
    shadowRgb: '184, 134, 11',
    showEdition: false,
    showYear: true,
    orderDirection: 'asc',
    source: 'newbery',
  },
  // ── 用户自建书单（custom_lists，走 customList，页面带 ?listId=）──
  // title 只是兜底，进页面后换成清单自己的标题。source 也只是兜底：
  // 从豆瓣读书/微信读书等榜单加进来的书，标记时沿用条目自带的 markSource，老页面才读得到。
  customBook: {
    title: '我的书单',
    slogan: '亲手挑的书，一本本读完它',
    brandPrimary: '#8A5A3C',
    brandSoft: '#B5835F',
    shadowRgb: '138, 90, 60',
    showEdition: false,
    showYear: true,
    orderDirection: 'asc',
    source: 'custom',
    custom: true,
  },
};

const DEFAULT_CONFIG = {
  title: '主题书单',
  slogan: '标记你读过的经典，生成专属书单海报',
  brandPrimary: '#3B4252',
  brandSoft: '#5C6B7A',
  shadowRgb: '59, 66, 82',
  showEdition: false,
  showYear: false,
  editionField: 'edition',
  orderDirection: 'asc',
  source: 'generic',
};

var themeRegistry = require('./themeRegistry.js');

function getThemeConfig(theme) {
  let cfg = THEME_CONFIG[theme];
  if (!cfg) {
    // 未硬编码：可能是走云端注册表新增的通用书单主题（不用发版）。
    // 读本地注册表缓存（分类页已写入）——注册文档字段名与本表一致，可直接展开。
    var reg = themeRegistry.find(theme);
    if (reg && reg.type === 'book') cfg = reg;
  }
  cfg = cfg || DEFAULT_CONFIG;
  return { editionField: 'edition', orderDirection: 'asc', source: 'generic', showYear: false, simplifyTitle: false, useCache: false, ...cfg };
}

module.exports = { THEME_CONFIG, getThemeConfig };
