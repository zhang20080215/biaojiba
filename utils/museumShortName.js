// utils/museumShortName.js —— 国家一级博物馆「简称」提取
// 博物馆名普遍已经简洁（多为 5~9 字），主要清理 = 去掉括号补充（并列馆名/别称），
// 外加一张小的人工修正表 OVERRIDES（几个人尽皆知的超短俗称）。
// 与 cloudfunctions/fetchMuseums 内联的同名逻辑保持一致（灌库时把简称写进 shortName 字段）。

// 人工修正表（键 = 数据源全名，值 = 简称）。命中则直接返回。
var OVERRIDES = {
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
    var n = String(name || '').trim();
    if (!n) return '';
    if (OVERRIDES[n]) return OVERRIDES[n];
    // 去掉结尾括号补充说明（全/半角），保留主名
    var s = n.replace(/[（(][^）)]*[）)]\s*$/, '').trim();
    return (s && s.length >= 2) ? s : n;   // 提取过短则回退全名
}

module.exports = { museumShortName: museumShortName };
