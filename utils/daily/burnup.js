/**
 * 每日主题公共层 · 截止日期累计目标的进度图（统计页「目标」页签）
 *
 * 横轴是目标的整个区间：点 k = 第 k 天结束时（k=0 是开始那一刻，累计 0；k=N 是截止日结束）。
 * 三条线：实际累计（到今天为止）、理想进度（0 → target 的直线）、预测（按目前日均从今天往后延）。
 * mode = sum 累计数值（步数）/ days 累计达标天数（早睡），算法一样，只是「每天加多少」不同。
 * 和首页的累计目标卡同一个口径（metric.goalProgress），只是这里按天展开成一条线。
 */
const D = require('./date.js');
const M = require('./metric.js');

/**
 * @param goal     { target, startDate, endDate }
 * @param dayMap   { 'YYYY-MM-DD': value }（metric.toDayMap，只有有数据的日子）
 * @param dailyGoal 每日目标（days 模式按它判达标）
 * @param today    今天（主题口径，睡眠是「今晚」）
 * @param mode     'sum' | 'days'
 * @param measure  度量（days 模式判达标用）
 */
function buildBurnup(goal, dayMap, dailyGoal, today, mode, measure) {
  if (!goal || !goal.startDate || !goal.endDate) return null;
  const ms = M.measureOf(measure);
  const target = Number(goal.target) || 0;
  const span = D.daysBetween(goal.startDate, goal.endDate) + 1;
  const last = today < goal.endDate ? today : goal.endDate;
  const elapsed = today < goal.startDate ? 0 : D.daysBetween(goal.startDate, last) + 1;

  // points[k] = { k, date（这一天，k=0 时为空）, add（这一天加了多少，无数据为 null）, cum }
  const points = [{ k: 0, date: '', add: null, cum: 0 }];
  let cum = 0;
  for (let k = 1; k <= elapsed; k++) {
    const date = D.addDays(goal.startDate, k - 1);
    let add = null;
    if (date in dayMap) {
      add = mode === 'days' ? (ms.achieved(dayMap[date], dailyGoal) ? 1 : 0) : dayMap[date];
      cum += add;
    }
    points.push({ k, date, add, cum });
  }

  const walked = cum;
  const p = M.goalProgress(goal, walked, today, mode);
  const idealAt = k => (span > 0 ? target * k / span : 0);
  const pace = elapsed > 0 ? walked / elapsed : 0;           // 目前每天平均（days 模式是达标率）
  const remaining = Math.max(0, target - walked);

  // 预测：按目前日均往后延；能在截止前到，就停在到达那天
  let finishK = null;
  if (p.status !== 'done' && pace > 0 && remaining > 0) {
    const k = elapsed + Math.ceil(remaining / pace);
    if (k <= span) finishK = k;
  }
  const projEndK = finishK || span;
  const projected = finishK ? target : Math.round(walked + pace * (span - elapsed));

  return {
    target,
    mode,
    startDate: goal.startDate,
    endDate: goal.endDate,
    span,
    elapsed,
    points,
    walked,
    ideal: idealAt(elapsed),
    diff: walked - idealAt(elapsed),
    pace,
    projected,
    projEndK,
    finishDate: finishK ? D.addDays(goal.startDate, finishK - 1) : '',
    status: p.status,
    pct: p.pct,
    remaining: p.remaining,
    daysLeft: p.daysLeft,
    perDayNeeded: p.perDayNeeded,
    feasible: p.feasible,
    idealAt
  };
}

// 数值怎么写：步数大数缩写，天数原样
function fmtOf(b) {
  return v => (b.mode === 'days' ? String(Math.round(v)) : M.formatShort(Math.round(v)));
}

/**
 * 统计页表头 + 汇总（纯函数）
 * @param b     buildBurnup 的结果
 * @param theme dailyThemes 配置（读 deadlineGoal.unit / verb）
 * @param sel   选中的点 k（没选传 -1 / null，看整体）
 * @returns { cap, big, bigUnit, change, tone: up|down|'', ohlc:[{k,v}], sumTitle, kpi }
 *   tone：up = 比理想进度快（页面用红，和涨跌同一套「红 = 好」），down = 落后
 */
function goalView(b, theme, sel) {
  const g = theme.deadlineGoal || {};
  const unit = g.unit || theme.unit || '';
  const verb = g.verb || '完成';
  const days = b.mode === 'days';
  const fmt = fmtOf(b);
  const title = `${D.formatDateCN(b.endDate)}前${verb}满 ${fmt(b.target)}${unit}`;
  const gap = d => (Math.abs(d) < 0.5 ? '' : fmt(Math.abs(d)) + (days ? ' 天' : ''));
  const vsIdeal = d => (gap(d) ? `${d > 0 ? '领先' : '落后'}理想进度 ${gap(d)}` : '正好跟上理想进度');

  const kpi = [
    { label: '已完成', value: String(b.pct), unit: '%', sub: `${D.formatDateCN(b.startDate)} - ${D.formatDateCN(b.endDate)}` },
    { label: '剩余天数', value: String(b.daysLeft), unit: '天', sub: `共 ${b.span} 天` },
    days
      ? { label: '达标率', value: String(Math.round(b.pace * 100)), unit: '%', sub: `理想 ${Math.round(b.target / b.span * 100)}%` }
      : { label: '目前日均', value: M.formatNum(b.pace), unit, sub: `理想日均 ${M.formatNum(b.target / b.span)}` },
    days
      ? { label: '还差', value: String(b.remaining), unit: '天', sub: b.feasible ? `剩 ${b.daysLeft} 天` : '剩下的天数不够了' }
      : { label: '每天还需', value: M.formatNum(b.perDayNeeded), unit, sub: `还差 ${M.formatShort(b.remaining)}` }
  ];

  const pt = sel != null && sel > 0 ? b.points[sel] : null;
  if (pt) {
    const d = pt.cum - b.idealAt(pt.k);
    return {
      cap: `${D.formatDateCN(pt.date)} · 累计`,
      big: M.formatNum(pt.cum),
      bigUnit: unit,
      change: vsIdeal(d),
      tone: gap(d) ? (d > 0 ? 'up' : 'down') : '',
      ohlc: [
        { k: '当天', v: pt.add == null ? '无数据' : days ? (pt.add ? '达标' : '没达标') : M.formatNum(pt.add) },
        { k: '理想', v: fmt(b.idealAt(pt.k)) }
      ],
      sumTitle: title,
      kpi
    };
  }

  let change, tone, ohlc;
  if (b.status === 'done') {
    change = '已达成目标';
    tone = 'up';
    ohlc = [{ k: '用时', v: `${b.elapsed} 天` }, { k: '共', v: `${b.span} 天` }];
  } else if (b.status === 'expired') {
    change = `已到截止日，差 ${gap(b.target - b.walked) || 0}`;
    tone = 'down';
    ohlc = [{ k: '完成', v: `${b.pct}%` }];
  } else {
    change = vsIdeal(b.diff);
    tone = gap(b.diff) ? (b.diff > 0 ? 'up' : 'down') : '';
    // 还一点没走（没有速度可言）就不预测，改说还剩几天
    ohlc = [b.finishDate
      ? { k: '预计', v: `${D.formatDateCN(b.finishDate)}达成` }
      : b.pace > 0 ? { k: '预计截止时', v: fmt(b.projected) + (days ? ' 天' : '') } : { k: '剩', v: `${b.daysLeft} 天` }];
    ohlc.push(days ? { k: '还差', v: `${b.remaining} 天` } : { k: '每天还需', v: M.formatNum(b.perDayNeeded) });
  }
  return { cap: `${title} · 已${verb}`, big: M.formatNum(b.walked), bigUnit: unit, change, tone, ohlc, sumTitle: title, kpi };
}

module.exports = { buildBurnup, goalView };
