// pages/genericList 的主题配置表 —— 走 enrichThemeMovies/generic_theme_movies 流水线的新主题，
// 或者迁移过来的老主题，不用再复制一份 list/share 页面目录，只需在这里加一行配置。
//
// 字段说明：
//   showEdition   — 是否显示"第X届 · 年份[ · 导演 · 国家]"信息行（false 则标题前缀 rank）
//   editionField  — 届数取 item 的哪个字段：'edition'（独立字段，如金棕榈/原创剧本）
//                   或 'rank'（rank 本身就是届数，如奥斯卡最佳摄影/动画长篇，此时列表本就按届数排序）
//   firstDirectorOnly— 导演只显示第一个（剧集条目常挂 4~8 位导演，整串会把信息行撑爆）
//   orderDirection— 传给云函数的 rank 排序方向：新到旧编号的主题用 'asc'（rank 1=最新）；
//                   rank 本身是历史届数（逐年递增）的主题要 'desc' 才能新到旧展示
//   导演/国家 chip 是否显示由数据本身决定（item.director / item.countryTags 有值才渲染），不用单独开关
//   ratingLabel   — 评分前缀，默认「豆瓣」；IMDb 榜的 rating 是 IMDb 分，写 'IMDB'
//   extraChips    — 评分后追加的小胶囊，按顺序取：'year'（年份）/ 'boxOffice'（全球票房，movieFormat.formatBoxOffice）
//   useCache      — 走 24h 本地缓存、进页面不强制刷新（老主题榜单几乎不变；通用主题 listVersion 恒为 null 才要每次强拉）
const THEME_CONFIG = {
  // ── 用户自建影单（custom_lists，走 customList，页面带 ?listId=）──
  // title 只是兜底，进页面后换成清单自己的标题；custom 打开「编辑清单」入口与空态
  customMovie: {
    title: '我的影单',
    slogan: '亲手挑的片，一部部看完它',
    brandPrimary: '#526631',
    brandSoft: '#7F9459',
    shadowRgb: '82, 102, 49',
    showEdition: false,
    orderDirection: 'asc',
    extraChips: ['year'],
    custom: true,
  },
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
  oscarDirector: {
    title: '历届奥斯卡最佳导演',
    slogan: '标记你看过的经典，生成专属观影海报',
    brandPrimary: '#2F6B4F',
    brandSoft: '#5C9B7E',
    shadowRgb: '47, 107, 79',
    showEdition: true,
    editionField: 'edition',
    orderDirection: 'asc',
  },
  oscarVFX: {
    title: '历届奥斯卡最佳视觉效果',
    slogan: '标记你看过的经典，生成专属观影海报',
    brandPrimary: '#1E7A99',
    brandSoft: '#4FB3CC',
    shadowRgb: '30, 122, 153',
    showEdition: true,
    editionField: 'edition',
    orderDirection: 'asc',
  },
  oscarActor: {
    title: '历届奥斯卡最佳男主角',
    slogan: '标记你看过的经典，生成专属观影海报',
    brandPrimary: '#A6763C',
    brandSoft: '#C99B5E',
    shadowRgb: '166, 118, 60',
    showEdition: true,
    editionField: 'edition',
    orderDirection: 'asc',
  },
  oscarActress: {
    title: '历届奥斯卡最佳女主角',
    slogan: '标记你看过的经典，生成专属观影海报',
    brandPrimary: '#B0476E',
    brandSoft: '#D07AA0',
    shadowRgb: '176, 71, 110',
    showEdition: true,
    editionField: 'edition',
    orderDirection: 'asc',
  },
  arthouse: {
    title: '文艺电影必修课',
    slogan: '标记你看过的文艺电影，生成专属观影海报。',
    brandPrimary: '#2E3A59',
    brandSoft: '#5E6E96',
    shadowRgb: '46, 58, 89',
    showEdition: false,
    orderDirection: 'asc',
  },
  // ── BFI《视与听》影史最伟大电影（影评人票选，十年一评，现行 2022 年版）──
  // 官方名次到 250 为止但含大量并列，实际 264 部；rank 是拍平后的 1..264 顺序号，
  // 官方名次留在 officialRank 字段（当前不展示）。详见 tools/sightsound-seed/README.md
  sightsound: {
    title: '视与听影史TOP250',
    slogan: '标记你看过的影史经典，生成专属观影海报',
    brandPrimary: '#6E2639',
    brandSoft: '#A05066',
    shadowRgb: '110, 38, 57',
    showEdition: false,
    orderDirection: 'asc',
  },
  // ── 豆瓣「选剧集」9 分以上（movie.douban.com/tv/ 评分区间 9~10，按豆瓣评分降序取 TOP250）──
  doubanTvCn: {
    // 评分门槛是 8 分（9 分以上全量仅 168 条凑不满 250），所以标题不写「9分」
    title: '豆瓣高分华语剧集',
    slogan: '标记你追过的华语高分剧集，生成专属追剧海报',
    brandPrimary: '#C0453E',
    brandSoft: '#DA7A72',
    shadowRgb: '192, 69, 62',
    showEdition: false,
    firstDirectorOnly: true,
    orderDirection: 'asc',
  },
  doubanTvForeign: {
    title: '豆瓣9分国外剧集',
    slogan: '标记你追过的海外高分剧集，生成专属追剧海报',
    brandPrimary: '#2F5D8C',
    brandSoft: '#6A93BF',
    shadowRgb: '47, 93, 140',
    showEdition: false,
    firstDirectorOnly: true,
    orderDirection: 'asc',
  },
  bangumi250: {
    title: 'Bangumi 动画 Top 250',
    slogan: '标记你看过的经典动画，生成专属追番海报',
    brandPrimary: '#D65B88',
    brandSoft: '#E99EB9',
    shadowRgb: '214, 91, 136',
    showEdition: false,
    firstDirectorOnly: true,
    orderDirection: 'asc',
    showBangumiRating: true,
  },
  doubanTvAnime: {
    title: '豆瓣9分动画',
    slogan: '标记你追过的高分动画，生成专属追番海报',
    brandPrimary: '#7C4DBE',
    brandSoft: '#A98AD9',
    shadowRgb: '124, 77, 190',
    showEdition: false,
    firstDirectorOnly: true,
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
  // ── 老主题迁移（oscarCinematography 已在通用流水线；oscarAnime / imdb / oscar / boxoffice 仍是各自独立集合，
  //    走 getMoviesData 老路径——loadMoviesData 已按 GENERIC_THEMES 自动路由，页面层无需关心。
  //    imdb / oscar / boxoffice 三个 2026-09 从各自独立页面目录并入，原目录只剩重定向桩） ──
  imdb: {
    title: 'IMDB电影TOP250',
    slogan: '标记你看过的全球佳片，生成专属观影海报',
    brandPrimary: '#A48418',
    brandSoft: '#E0BA40',
    shadowRgb: '164, 132, 24',
    showEdition: false,
    orderDirection: 'asc',
    ratingLabel: 'IMDB',
    extraChips: ['year'],
    useCache: true,
  },
  oscar: {
    title: '历届奥斯卡最佳影片',
    slogan: '标记你看过的经典，生成专属观影海报',
    brandPrimary: '#9A742E',
    brandSoft: '#CAAA60',
    shadowRgb: '154, 116, 46',
    showEdition: true,
    editionField: 'rank', // rank 本身即届数
    orderDirection: 'desc', // getMoviesData 对 oscar 强制服务端 desc，这里传值仅为语义一致
  },
  boxoffice: {
    title: '全球电影票房榜',
    slogan: '标记你看过的票房传奇，生成专属观影海报',
    brandPrimary: '#9A362E',
    brandSoft: '#C85E52',
    shadowRgb: '154, 54, 46',
    showEdition: false,
    orderDirection: 'asc',
    extraChips: ['boxOffice', 'year'],
    useCache: true,
  },
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
  firstDirectorOnly: false,
  orderDirection: 'asc',
};

var themeRegistry = require('./themeRegistry.js');

function getThemeConfig(theme) {
  let cfg = THEME_CONFIG[theme];
  if (!cfg) {
    // 未硬编码：可能是走云端注册表新增的通用影单主题（不用发版）。
    // 读本地注册表缓存（分类页已写入）——注册文档字段名与本表一致，可直接展开。
    var reg = themeRegistry.find(theme);
    if (reg && reg.type !== 'book') cfg = reg;
  }
  cfg = cfg || DEFAULT_CONFIG;
  return { editionField: 'edition', orderDirection: 'asc', firstDirectorOnly: false, ratingLabel: '豆瓣', extraChips: [], useCache: false, ...cfg };
}

module.exports = { THEME_CONFIG, getThemeConfig };
