// pages/scenic/{list,share} 的主题配置表 —— 旅行线「按省份分组打卡」的两个主题
// （全国5A旅游景区 / 中国国家一级博物馆）共用这一套页面，靠 ?theme= 区分。
// 2026-09 前博物馆是 pages/museum/ 一份逐行克隆（667 行只差 57 行），现在收进这张表；
// 差异只有文案、配色、简称函数、列表徽标和海报署名，数据/标记链路完全一样：
//   数据：utils/dataLoader.js 按 theme 路由到 getScenicSpots / getMuseums
//   标记：Marks 集合，去过/参观过 = watched、想去 = wish（_id 都是主题前缀，互不冲突）
// 省份/城市两个主题（pages/province、pages/city）差异更大（无 spot 列表、海报是地图），不在此表。
var scenicShortName = require('./scenicShortName.js').scenicShortName;
var museumShortName = require('./museumShortName.js').museumShortName;

var THEME_CONFIG = {
  scenic5a: {
    title: '全国5A旅游景区',
    slogan: '打卡你走过的山河，攒成专属旅行足迹',
    brandPrimary: '#2E8B72',
    brandSoft: '#5FB89C',
    shadowRgb: '46, 139, 114',
    shortName: scenicShortName,
    noun: '景区',                 // 「请选择景区」「上拉加载更多景区…」等文案里的名词
    visitedLabel: '去过',         // watched 状态的展示词
    badgeText: '5A景区',          // 列表徽标：固定文案（badgeField 为空时用）
    badgeField: '',
    searchPlaceholder: '搜索景区名 / 省份',
    generateBtnText: '生成旅行足迹',
    emptyVisitedTip: '先打卡去过的景区吧',
    shareTitle: '全国5A旅游景区 - 打卡你走过的山河',
    // 海报预览页
    posterTitle: '全国5A景区旅行打卡',
    listStyleLabel: '景区清单',
    posterShareTitle: '我的5A旅游景区打卡足迹',
    posterEmptyTip: '先去打卡去过的5A景区吧',
    tileEmptyText: '暂无 5A',     // 足迹地图里没有条目的省份瓦片文字
    nicknameFallback: '旅行者',
    storageKey: 'scenicShareTheme',
    listPath: '/pages/scenic/list/list?theme=scenic5a',
    sharePath: '/pages/scenic/share/share?theme=scenic5a'
  },
  museum: {
    title: '中国国家一级博物馆',
    slogan: '打卡你走过的博物馆，收藏一整部文明史',
    brandPrimary: '#8C6239',
    brandSoft: '#B98E56',
    shadowRgb: '140, 98, 57',
    shortName: museumShortName,
    noun: '博物馆',
    visitedLabel: '参观过',
    badgeText: '国家一级',
    badgeField: 'batch',          // 列表徽标取条目的批次字段（第一批/第二批…），没有则退到 badgeText
    searchPlaceholder: '搜索博物馆名 / 省份',
    generateBtnText: '生成参观足迹',
    emptyVisitedTip: '先打卡参观过的博物馆吧',
    shareTitle: '中国国家一级博物馆 - 打卡你走过的博物馆',
    posterTitle: '国家一级博物馆打卡',
    listStyleLabel: '博物馆清单',
    posterShareTitle: '我的国家一级博物馆打卡足迹',
    posterEmptyTip: '先去打卡参观过的博物馆吧',
    tileEmptyText: '暂无',
    nicknameFallback: '博物馆爱好者',
    storageKey: 'museumShareTheme',
    listPath: '/pages/scenic/list/list?theme=museum',
    sharePath: '/pages/scenic/share/share?theme=museum'
  }
};

// 未知/缺省 theme 一律当 5A 景区（老分享卡片/搜索直达没带 ?theme= 的都是它）
function getTravelTheme(theme) {
  var key = THEME_CONFIG[theme] ? theme : 'scenic5a';
  return { key: key, cfg: THEME_CONFIG[key] };
}

module.exports = { THEME_CONFIG, getTravelTheme };
