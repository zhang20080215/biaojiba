// 数值型每日主题的外部数据源（syncSource 动作用）。
// 每个 source 把解密后的原始数据转成 [{ date: 'YYYY-MM-DD', value }]，按日期升序。
// 纯函数，tools/test-daily-metric.cjs 直接 require 测。

// 北京时间日期：微信运动的 timestamp 是「当天 0 点」的秒级时间戳
function cnDate(sec) {
    return new Date(sec * 1000 + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

// 微信运动：event.weRunData 是前端传 wx.cloud.CloudID(cloudID) 后平台自动解密的结果，
// 形如 { cloudID, data: { stepInfoList: [{ timestamp, step }] } }，覆盖最近约 31 天。
// 列表开头连续的 0 步是「开通微信运动之前」，不是真走了 0 步，丢掉，免得把「无数据」写成 0。
function parseWeRun(weRunData) {
    const list = weRunData && weRunData.data && weRunData.data.stepInfoList;
    if (!Array.isArray(list)) return null;
    const byDate = {};
    list.forEach(it => {
        const ts = Number(it && it.timestamp);
        const step = Number(it && it.step);
        if (!(ts > 0) || !Number.isFinite(step) || step < 0) return;
        byDate[cnDate(ts)] = Math.round(step);
    });
    const rows = Object.keys(byDate).sort().map(date => ({ date, value: byDate[date] }));
    const first = rows.findIndex(r => r.value > 0);
    return first < 0 ? [] : rows.slice(first);
}

const SOURCES = {
    werun: { param: 'weRunData', parse: parseWeRun }
};

// 对比库里已有的文档，只挑出需要写的：新的日子 → add，值变了 → update，没变的跳过
function planWrites(rows, existingDocs) {
    const byDate = {};
    (existingDocs || []).forEach(d => { byDate[d.date] = d; });
    const adds = [], updates = [];
    rows.forEach(r => {
        const doc = byDate[r.date];
        if (!doc) adds.push(r);
        else if (Number(doc.total_value) !== r.value) updates.push({ _id: doc._id, date: r.date, value: r.value });
    });
    return { adds, updates };
}

module.exports = { SOURCES, parseWeRun, planWrites, cnDate };
