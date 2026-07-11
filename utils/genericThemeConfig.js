// pages/genericList 的主题配置表 —— 走 enrichThemeMovies/generic_theme_movies 流水线的新主题，
// 或者迁移过来的老主题，不用再复制一份 list/share 页面目录，只需在这里加一行配置。
//
// 字段说明：
//   showEdition   — 是否显示"第X届 · 年份[ · 导演 · 国家]"信息行（false 则标题前缀 rank）
//   editionField  — 届数取 item 的哪个字段：'edition'（独立字段，如金棕榈/原创剧本）
//                   或 'rank'（rank 本身就是届数，如奥斯卡最佳摄影/动画长篇，此时列表本就按届数排序）
//   orderDirection— 传给云函数的 rank 排序方向：新到旧编号的主题用 'asc'（rank 1=最新）；
//                   rank 本身是历史届数（逐年递增）的主题要 'desc' 才能新到旧展示
//   导演/国家 chip 是否显示由数据本身决定（item.director / item.countryTags 有值才渲染），不用单独开关
const THEME_CONFIG = {
  // ── 走 generic_theme_movies 通用流水线 ──
  rtHorror: {
    title: '史上最佳恐怖电影',
    slogan: '标记你看过的经典，生成专属观影海报',
    brandPrimary: '#8E2A2A',
    brandSoft: '#B5514C',
    shadowRgb: '142, 42, 42',
    showEdition: false,
    orderDirection: 'asc',
  },
  rtWar: {
    title: '史上最佳战争电影',
    slogan: '标记你看过的经典，生成专属观影海报',
    brandPrimary: '#3E5C6E',
    brandSoft: '#6E89A0',
    shadowRgb: '62, 92, 110',
    showEdition: false,
    orderDirection: 'asc',
  },
  rtAnimation: {
    title: '史上最佳动画电影',
    slogan: '标记你看过的经典，生成专属观影海报',
    brandPrimary: '#E8862E',
    brandSoft: '#F2B073',
    shadowRgb: '232, 134, 46',
    showEdition: false,
    orderDirection: 'asc',
  },
  rtAction: {
    title: '史上最佳动作电影',
    slogan: '标记你的肾上腺素时刻，生成专属观影海报',
    brandPrimary: '#3B4252',
    brandSoft: '#5C6B7A',
    shadowRgb: '59, 66, 82',
    showEdition: false,
    orderDirection: 'asc',
  },
  palmeDor: {
    title: '历届金棕榈奖',
    slogan: '标记你看过的经典，生成专属观影海报',
    brandPrimary: '#A8842B',
    brandSoft: '#D4B45C',
    shadowRgb: '168, 132, 43',
    showEdition: true,
    editionField: 'edition',
    orderDirection: 'asc',
  },
  oscarScreenplay: {
    title: '历届奥斯卡最佳原创剧本',
    slogan: '标记你看过的经典，生成专属观影海报',
    brandPrimary: '#6B4C7A',
    brandSoft: '#9B7BB0',
    shadowRgb: '107, 76, 122',
    showEdition: true,
    editionField: 'edition',
    orderDirection: 'asc',
  },
  oscarForeign: {
    title: '历届奥斯卡最佳外语片',
    slogan: '标记你看过的经典，生成专属观影海报',
    brandPrimary: '#7A3B4A',
    brandSoft: '#A85C6E',
    shadowRgb: '122, 59, 74',
    showEdition: true,
    editionField: 'edition',
    orderDirection: 'asc',
  },
  letterboxd500: {
    title: 'Letterboxd Top 500',
    slogan: '标记你看过的经典，生成专属观影海报',
    brandPrimary: '#E67300',
    brandSoft: '#FF9933',
    shadowRgb: '230, 150, 64',
    showEdition: false,
    orderDirection: 'asc',
  },
  // ── 老主题迁移（oscarCinematography 已在通用流水线；oscarAnime 仍是独立集合 oscar_anime_movies，
  //    走 getMoviesData 老路径——loadMoviesData 已按 GENERIC_THEMES 自动路由，页面层无需关心） ──
  oscarCinematography: {
    title: '历届奥斯卡最佳摄影奖',
    slogan: '标记你看过的经典，生成专属观影海报',
    brandPrimary: '#303C52',
    brandSoft: '#5A6E8A',
    shadowRgb: '48, 60, 82',
    showEdition: true,
    editionField: 'rank', // rank 本身即届数
    orderDirection: 'desc', // 新一届往旧排序
  },
  oscarAnime: {
    title: '历届奥斯卡最佳动画长篇',
    slogan: '标记你看过的经典，生成专属观影海报',
    brandPrimary: '#2C867C',
    brandSoft: '#60BAB0',
    shadowRgb: '44, 134, 124',
    showEdition: true,
    editionField: 'rank',
    orderDirection: 'desc', // getMoviesData 对 oscarAnime 强制服务端 desc，这里传值仅为语义一致
  },
};

const DEFAULT_CONFIG = {
  title: '主题片单',
  slogan: '标记你看过的经典，生成专属观影海报',
  brandPrimary: '#3B4252',
  brandSoft: '#5C6B7A',
  shadowRgb: '59, 66, 82',
  showEdition: false,
  editionField: 'edition',
  orderDirection: 'asc',
};

function getThemeConfig(theme) {
  const cfg = THEME_CONFIG[theme] || DEFAULT_CONFIG;
  return { editionField: 'edition', orderDirection: 'asc', ...cfg };
}

module.exports = { THEME_CONFIG, getThemeConfig };
