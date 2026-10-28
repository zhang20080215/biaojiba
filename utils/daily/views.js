/**
 * 每日主题公共层 · 各度量的展示文案（统计页 / 年度页 / 海报 / 日详情）
 *
 * 页面只调这里，不写 if (睡眠)：步数（count）和睡眠（bedtime）在「显示什么数、KPI 是哪几项、海报写什么」上
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

    year(s, docs, theme) {
      const v = theme.vocab;
      return {
        heroCap: '年度累计',
        heroNum: M.formatNum(s.total),
        heroUnit: theme.unit,
        heroSub: eqText(theme, s.total),
        kpi: [
          { label: v.avgLabel, value: M.formatNum(s.avg), unit: theme.unit },
          { label: '达标天数', value: s.achieved, unit: `/ ${s.dataDays} 天` },
          { label: '最长连续达标', value: s.longestStreak, unit: '天' },
          { label: v.bestLabel, value: s.best ? M.formatShort(s.best.value) : '—', unit: s.best ? `${theme.unit} · ${D.formatDateCN(s.best.date)}` : '' }
        ]
      };
    },

    posterDay(doc, goal, theme, title) {
      const value = Number(doc.total_value) || 0;
      const ratio = goal > 0 ? value / goal : 0;
      return {
        layout: 'day',
        title,
        cap: theme.vocab.todayCap,
        bigText: M.formatNum(value),
        bigUnit: theme.unit,
        ratio,
        statusText: `完成 ${Math.round(ratio * 100)}%`,
        subLine: `每日目标 ${M.formatNum(goal)} ${theme.unit}${eqText(theme, value) ? ' · ' + eqText(theme, value) : ''}`,
        cheer: theme.cheerFor ? theme.cheerFor(ratio, value, goal) : ''
      };
    },

    posterMonth(s, cells, docs, theme, title) {
      const v = theme.vocab;
      return {
        layout: 'month',
        title,
        subtitle: `${v.noun}月报`,
        cells,
        tiles: [
          { label: v.totalLabel, value: M.formatShort(s.total), sub: eqText(theme, s.total) || theme.unit },
          { label: v.avgLabel, value: M.formatNum(s.avg), sub: theme.unit },
          { label: '达标天数', value: String(s.achieved), sub: `/ ${s.dataDays} 天` }
        ]
      };
    }
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

    year(s, docs, theme) {
      const x = sleepExtras(docs);
      return {
        heroCap: '年度早睡',
        heroNum: String(s.achieved),
        heroUnit: '天',
        heroSub: s.dataDays ? `共记录 ${s.dataDays} 晚` : '',
        kpi: [
          { label: theme.vocab.avgLabel, value: s.dataDays ? T.offsetToClock(s.avg) : '—', unit: '' },
          { label: '平均睡眠', value: x.avgDuration, unit: '' },
          { label: '最长连续早睡', value: s.longestStreak, unit: '天' },
          { label: theme.vocab.bestLabel, value: s.best ? T.offsetToClock(s.best.value) : '—', unit: s.best ? D.formatDateCN(s.best.date) : '' }
        ]
      };
    },

    posterDay(doc, goal, theme, title) {
      const meta = doc.meta || {};
      const late = Number(meta.bedOffset) - goal;
      // 环表示「离目标有多近」：准时是满圈，每晚 1 分钟少一点，晚 2 小时以上只剩一小截
      const ratio = late <= 0 ? 1 : Math.max(0.08, 1 - late / 120);
      return {
        layout: 'day',
        title,
        cap: theme.vocab.todayCap,
        bigText: meta.bedTime,
        bigUnit: '入睡',
        ratio,
        statusText: late <= 0 ? '早睡达标' : `比目标晚 ${T.formatDuration(late)}`,
        subLine: `目标 ${T.offsetToClock(goal)} 前入睡${meta.wakeTime ? ` · ${meta.wakeTime} 起床 · 睡了 ${T.formatDuration(meta.duration)}` : ''}`,
        cheer: theme.cheerFor ? theme.cheerFor(late) : ''
      };
    },

    posterMonth(s, cells, docs, theme, title) {
      const x = sleepExtras(docs);
      return {
        layout: 'month',
        title,
        subtitle: `${theme.vocab.noun}月报`,
        cells,
        tiles: [
          { label: '早睡天数', value: String(s.achieved), sub: `/ ${s.dataDays} 晚` },
          { label: theme.vocab.avgLabel, value: s.dataDays ? T.offsetToClock(s.avg) : '—', sub: '' },
          { label: '平均睡眠', value: x.avgDuration, sub: `平均 ${x.avgWake} 起床` }
        ]
      };
    }
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
