/**
 * 每日主题公共层 · 各度量的展示文案（统计页 / 海报 / 日详情）
 *
 * 页面只调这里，不写 if (睡眠)：步数（count）和睡眠（bedtime）在「显示什么数、KPI 是哪几项」上
 * 的差别全收在这一个文件里。加一种新度量 = 这里加一组 + metric.MEASURES 加一个。
 *
 * 入参约定：s = metric.summarize(...) 的结果；docs = 区间内有数据的文档（{date: doc}）；theme = dailyThemes 配置
 */
const M = require('./metric.js');
const D = require('./date.js');
const T = require('./clock.js');

function avgOf(list) {
  return list.length ? list.reduce((a, b) => a + b, 0) / list.length : null;
}

// 睡眠的附加统计：平均起床时刻、平均时长（只算填了起床时间的晚上）
function sleepExtras(docs) {
  const wakes = [], durations = [];
  Object.keys(docs).forEach(k => {
    const meta = docs[k].meta || {};
    const w = T.minutesOf(meta.wakeTime);
    if (w != null) wakes.push(w);
    if (Number(meta.duration) > 0) durations.push(Number(meta.duration));
  });
  const aw = avgOf(wakes), ad = avgOf(durations);
  return { avgWake: aw == null ? '—' : T.clockOf(aw), avgDuration: ad == null ? '—' : T.formatDuration(ad), nights: Object.keys(docs).length };
}

function eqText(theme, total) {
  const eq = theme.vocab.equivalent;
  return eq && total > 0 ? `${eq.label} ${M.equivalentOf(total, eq)} ${eq.unit}` : '';
}

const VIEWS = {
  count: {
    goalText: (goal, theme) => `${M.formatNum(goal)} ${theme.unit}`,
    dayText: (doc, theme) => `${M.formatNum(doc.total_value)} ${theme.unit}`,
    barValueOf: doc => Number(doc.total_value) || 0,
    showGoalLine: true,
    chartNote: '',

    stats(s, docs, theme, goal, cap) {
      const v = theme.vocab;
      return {
        headlineCap: (cap || '') + v.avgLabel,
        headline: M.formatNum(s.avg),
        headlineUnit: theme.unit,
        headlineSub: `累计 ${M.formatNum(s.total)} ${theme.unit} · 有数据 ${s.dataDays} 天`,
        kpi: [
          { label: '达标天数', value: s.achieved, unit: `/ ${s.dataDays} 天`, sub: `每日目标 ${M.formatNum(goal)} ${theme.unit}` },
          { label: v.bestLabel, value: s.best ? M.formatShort(s.best.value) : '—', unit: theme.unit, sub: s.best ? D.formatDateCN(s.best.date) : '' },
          { label: '最长连续达标', value: s.longestStreak, unit: '天', sub: '' },
          { label: v.totalLabel, value: M.formatShort(s.total), unit: theme.unit, sub: eqText(theme, s.total) }
        ]
      };
    },

  },

  bedtime: {
    goalText: goal => `${T.offsetToClock(goal)} 前入睡`,
    dayText(doc) {
      const meta = doc.meta || {};
      const parts = [`${meta.bedTime} 入睡`];
      if (meta.wakeTime) parts.push(`${meta.wakeTime} 起床`, `睡了 ${T.formatDuration(meta.duration)}`);
      return parts.join(' · ');
    },
    // 柱子高度 = 睡眠时长，颜色 = 入睡早晚的热力档
    barValueOf: doc => Number(doc.meta && doc.meta.duration) || 0,
    showGoalLine: false,
    chartNote: '柱高为睡眠时长，颜色越深睡得越早',

    stats(s, docs, theme, goal, cap) {
      const x = sleepExtras(docs);
      return {
        headlineCap: (cap || '') + theme.vocab.avgLabel,
        headline: s.dataDays ? T.offsetToClock(s.avg) : '—',
        headlineUnit: '',
        headlineSub: `早睡 ${s.achieved} / ${s.dataDays} 晚 · 平均睡 ${x.avgDuration}`,
        kpi: [
          { label: '早睡天数', value: s.achieved, unit: `/ ${s.dataDays} 晚`, sub: `目标 ${T.offsetToClock(goal)} 前入睡` },
          { label: theme.vocab.bestLabel, value: s.best ? T.offsetToClock(s.best.value) : '—', unit: '', sub: s.best ? D.formatDateCN(s.best.date) : '' },
          { label: '最长连续早睡', value: s.longestStreak, unit: '天', sub: '' },
          { label: '平均起床', value: x.avgWake, unit: '', sub: `平均睡 ${x.avgDuration}` }
        ]
      };
    },

  }
};

function viewOf(theme) {
  return VIEWS[theme.measure] || VIEWS.count;
}

/**
 * 睡眠首页卡片的状态（纯函数，方便测）
 * @param doc  这一晚的文档（没有记录传 null）
 * @param goal 目标入睡 bedOffset
 * @param now  毫秒时间戳
 */
function sleepCard(doc, goal, now) {
  const night = T.nightOf(now);
  const nowMin = T.minutesOf(T.nowClock(now));
  const isTonight = night === D.todayStr(now);
  const meta = (doc && doc.meta) || null;
  const card = { night, nightLabel: isTonight ? '今晚' : '昨晚', goalClock: T.offsetToClock(goal), recorded: !!(meta && meta.bedTime) };
  if (card.recorded) {
    const late = Number(meta.bedOffset) - goal;
    Object.assign(card, {
      bedTime: meta.bedTime,
      wakeTime: meta.wakeTime || '',
      achieved: late <= 0,
      statusText: late <= 0 ? '早睡达标' : `比目标晚 ${T.formatDuration(late)}`,
      durationText: meta.wakeTime ? `睡了 ${T.formatDuration(meta.duration)}` : '',
      // 起床按钮只在早上出现，免得睡前误点
      showWake: !meta.wakeTime && nowMin >= 180 && nowMin < 720,
      wakeHint: !meta.wakeTime && !(nowMin >= 180 && nowMin < 720) ? '明早起床后点「我起床了」' : ''
    });
    return card;
  }
  // 还没记录：晚上（18 点 ~ 次日 4 点）给「我去睡了」，白天只给补记
  const evening = nowMin >= 1080 || nowMin < 240;
  const left = goal - T.clockToOffset(T.nowClock(now));
  Object.assign(card, {
    showSleep: evening,
    countdownText: !isTonight && !evening ? '昨晚还没有记录' : left > 0 ? `距离目标入睡还有 ${T.formatDuration(left)}` : `已经超过目标 ${T.formatDuration(-left)}，快去睡吧`
  });
  return card;
}

module.exports = { VIEWS, viewOf, sleepExtras, sleepCard };
