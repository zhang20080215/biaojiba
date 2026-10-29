/**
 * 每日主题公共层 · 数值型首页（pages/daily/metric/index）的视图模型，纯函数便于测试
 *
 * 首页学每日喝水：一屏一个焦点 —— 日期（‹ › 翻天）、主角插画、超大数字、一行说明、细进度条，
 * 再加一行累计目标和底部三张卡。这里把「某一天的文档」算成这些要显示的字段。
 */
const M = require('./metric.js');
const D = require('./date.js');
const T = require('./clock.js');
const V = require('./views.js');

/**
 * 连续达标天数：从 date 往前数（date 是今天且还没达标时从昨天数起，今天还没过完），
 * 无数据的日子跳过、不打断，最早数到 from。
 */
function streakAt(map, date, goal, today, from, measure) {
  const ms = M.measureOf(measure);
  let d = date;
  if (d === today && d in map && !ms.achieved(map[d], goal)) d = D.addDays(d, -1);
  if (d === today && !(d in map)) d = D.addDays(d, -1);
  let n = 0;
  for (; d >= from; d = D.addDays(d, -1)) {
    if (!(d in map)) continue;
    if (!ms.achieved(map[d], goal)) break;
    n++;
  }
  return n;
}

// 日期主标题：步数 今天/昨天/10月26日；睡眠 今晚/昨晚/10月26日晚
function dateTitle(viewDate, today, measure) {
  const night = measure === 'bedtime';
  if (viewDate === today) return night ? '今晚' : '今天';
  if (viewDate === D.addDays(today, -1)) return night ? '昨晚' : '昨天';
  return D.formatDateCN(viewDate) + (night ? '晚' : '');
}

/**
 * 步数首页
 * @param docs  { date: doc }（已加载窗口内有数据的日子）
 * @param from  已加载窗口的起点（连续达标最多往前数到这里）
 */
function stepsHome(docs, viewDate, today, goal, theme, from) {
  const doc = docs[viewDate];
  const value = doc ? Number(doc.total_value) || 0 : 0;
  const ratio = goal > 0 ? value / goal : 0;
  const map = M.toDayMap(Object.values(docs));
  const w = D.weekRange(viewDate, 0);
  const s = M.summarize(map, w.from, w.to, goal, today);
  const eq = theme.vocab.equivalent;
  return {
    missing: !doc,
    ratio,
    bigText: doc ? M.formatNum(value) : '—',
    bigUnit: theme.unit,
    subText: !doc ? '这一天没有数据'
      : value >= goal ? `目标 ${M.formatNum(goal)} · 已达标` : `目标 ${M.formatNum(goal)} · 还差 ${M.formatNum(goal - value)}`,
    pct: Math.min(100, Math.round(ratio * 100)),
    extraText: '',
    cards: [
      { key: 'eq', icon: 'route', value: doc && eq ? M.equivalentOf(value, eq) : '—', label: eq ? eq.unit : '' },
      { key: 'week', icon: 'chart', value: s.dataDays ? M.formatNum(s.avg) : '—', label: '本周日均' },
      { key: 'streak', icon: 'flame', value: `${streakAt(map, viewDate, goal, today, from)} 天`, label: '连续达标' }
    ]
  };
}

/**
 * 睡眠首页
 * @param now 毫秒时间戳（决定「我去睡了 / 我起床了」能不能点）
 */
function sleepHome(docs, viewDate, today, goal, now) {
  const doc = docs[viewDate] || null;
  const meta = (doc && doc.meta) || null;
  const current = viewDate === today;
  const card = current ? V.sleepCard(doc, goal, now) : null;
  const recorded = !!(meta && meta.bedTime);
  let late = 0, subText, extraText = '';
  if (recorded) {
    late = Number(meta.bedOffset) - goal;
    subText = `目标 ${T.offsetToClock(goal)} 前 · ${late <= 0 ? '早睡达标' : '晚了 ' + T.formatDuration(late)}`;
    if (meta.wakeTime) extraText = `${meta.wakeTime} 起床 · 睡了 ${T.formatDuration(meta.duration)}`;
    else if (card && card.wakeHint) extraText = card.wakeHint;
  } else {
    subText = current ? card.countdownText : '这一晚没有记录';
  }
  return {
    missing: !recorded,
    mood: !recorded ? 'pending' : late <= 0 ? 'ok' : 'late',
    bigText: recorded ? meta.bedTime : '--:--',
    bigUnit: recorded ? '入睡' : '',
    subText,
    extraText,
    pct: 0,
    cards: [
      { key: 'sleep', icon: 'moon', value: '我去睡了', label: '记下现在', disabled: !(card && card.showSleep) },
      { key: 'wake', icon: 'sun', value: '我起床了', label: '算出时长', disabled: !(card && card.showWake) },
      { key: 'edit', icon: 'pencil', value: recorded ? '修改' : '补记', label: '选时间', disabled: false }
    ]
  };
}

// 首页那一行累计目标
function goalLine(goal, walked, today, cfg) {
  if (!goal) return { text: '设一个累计目标', status: 'none' };
  const p = M.goalProgress(goal, walked, today, cfg.mode);
  if (p.status === 'done') return { text: '累计目标已达成 · 再设一个', status: 'done' };
  if (p.status === 'expired') return { text: `累计目标到期，完成了 ${p.pct}% · 再设一个`, status: 'expired' };
  return { text: `${D.formatDateCN(goal.endDate)}前${cfg.verb}满 ${M.formatShort(p.target)}${cfg.unit} · 已完成 ${p.pct}%`, status: 'active' };
}

module.exports = { streakAt, dateTitle, stepsHome, sleepHome, goalLine };
