/**
 * 每日打卡主题配置中心 —— 添加新主题的「单一事实源」
 *
 * 新增主题流程：
 *   1) 在下方 THEMES 中追加一个键（如 'milktea'），按 ThemeConfig 字段填写
 *   2) 在 pages/category/category.js 的 themes 数组里加一张卡片，url 用 /pages/daily/index/index?theme=<id>
 *   3) 部署一次：无需新页面、无需新云函数、无需新集合
 *
 * 字段说明见每个字段的注释；视觉/单位/文案/海报均由配置驱动。
 */

/**
 * 设计调色板（共享给主页 / 统计 / 海报）
 * 来自 Claude Design 「Water Tracker」交付的极简米白 + 粗黑描边视觉体系
 */
const DESIGN_TOKENS = {
  bg:         '#FAF6EB',
  cardBg:     '#FFFFFF',
  ink:        '#1A1A1A',
  inkSoft:    '#6B6356',
  inkFaint:   '#A89E8C',
  hairline:   '#E8E0CC',
  yellow:     '#F5C518',
  blue:       '#2A8BC4',
  blueDeep:   '#1F6A99',
  waterLight: '#B8E0F2',
  pink:       '#F6A5B8',
  cheek:      '#FBD9C4'
};

/** accent 主色调（瓶盖 + 强调）—— 用户/主题可在此三选一 */
const ACCENT_HEX = {
  yellow: DESIGN_TOKENS.yellow,
  blue:   DESIGN_TOKENS.blue,
  pink:   DESIGN_TOKENS.pink
};

/**
 * @typedef {Object} ThemeConfig
 * @property {string} id              主题 id（路径与 URL 参数都用它）
 * @property {string} title           展示名
 * @property {string} description     副标题/卡片描述
 *
 * @property {string} unit            单位（'ml' | '杯' | '步' | ...）
 * @property {string} unitLabel       单位长名（'毫升'）
 * @property {number} defaultGoal     默认每日目标
 * @property {[number, number]} goalRange    目标可选区间
 * @property {number} goalStep        目标 slider 步进
 * @property {number[]} defaultPresets       快捷量预设
 * @property {[number, number]} presetRange  快捷量可选区间（设置抽屉用）
 * @property {number} presetStep      快捷量步进
 * @property {boolean} inverseGoal    true=目标为上限（如奶茶/糖，超过=告警）；false=目标为下限（如喝水）
 *
 * @property {string} navBg           导航栏背景
 * @property {string} navTextStyle    'white' | 'black'
 * @property {string[]} pageGradient  主页背景渐变（2~3 色，新设计用纯米白）
 * @property {string[]} coverGradient category 封面卡片渐变
 * @property {string} coverEmoji      封面 emoji
 * @property {string} tag             卡片右上角 tag 文案（一般为「每日」）
 *
 * @property {'cup'|'bottle'|'ring'} progressVisual  中央可视化模式
 * @property {string} mainColor       主色（数字/描边）
 * @property {string} subColor        次色
 * @property {string} accentColor     强调色（瓶盖/达标）
 * @property {string} textColor       深色文字
 * @property {'yellow'|'blue'|'pink'} accent  对应 ACCENT_HEX 的键名
 *
 * @property {function} presetIcon    (value)=>emoji，按预设量渲染图标
 *
 * @property {function} cheerFor      (progress, total, goal)=>string，进度文案
 * @property {function} cheerForWeek  (progress, achievedDays, totalDays)=>string
 * @property {function} cheerForMonth (achievedDays, totalDays)=>string
 * @property {function} formatTotal   (totalValue)=>string，总量呈现（L 换算）
 */

const THEMES = {
  water: {
    id: 'water',
    title: '每日喝水',
    description: '记录每日饮水量，养成健康习惯',

    unit: 'ml',
    unitLabel: '毫升',
    defaultGoal: 2000,
    goalRange: [500, 5000],
    goalStep: 100,
    defaultPresets: [100, 200, 350],
    presetRange: [50, 1000],
    presetStep: 50,
    inverseGoal: false,

    navBg: DESIGN_TOKENS.bg,
    navTextStyle: 'black',
    pageGradient: [DESIGN_TOKENS.bg, DESIGN_TOKENS.bg],
    coverGradient: [DESIGN_TOKENS.bg, DESIGN_TOKENS.bg],
    coverEmoji: '💧',
    tag: '每日',

    progressVisual: 'bottle',
    mainColor: DESIGN_TOKENS.ink,
    subColor: DESIGN_TOKENS.inkSoft,
    accentColor: DESIGN_TOKENS.yellow,
    textColor: DESIGN_TOKENS.ink,
    accent: 'yellow',

    presetIcon: v => v < 200 ? '🥃' : v < 350 ? '🥤' : '🧋',

    cheerFor: (progress, total) => {
      if (progress >= 1) return '今日已达标，继续保持！';
      if (progress >= 0.75) return '快到啦，再喝一杯就达成 💪';
      if (progress >= 0.5) return '已经过半，继续保持 💧';
      if (progress >= 0.25) return '不错的开始，节奏稳一点';
      if (total > 0) return '已经记录，多喝几杯吧';
      return '今天还没喝水，先来一杯吧';
    },
    cheerForWeek: (progress, achieved, total) =>
      `${total} 天里达标 ${achieved} 天，水当伴！`,
    cheerForMonth: (achieved, total) =>
      `${total} 天里达标 ${achieved} 天，习惯养成中`,
    formatTotal: v => `${(v / 1000).toFixed(1)} L`
  }

  // ============================================================
  // 新增主题示例（仅供参考，本次不上线）：
  //
  // milktea: {
  //   id: 'milktea', title: '每日奶茶', description: '克制不超量，记录小确幸',
  //   unit: '杯', unitLabel: '杯', defaultGoal: 1, goalRange: [0, 5], goalStep: 1,
  //   defaultPresets: [1], customMax: 3, customStep: 1, inverseGoal: true,
  //   navBg: '#8D6E63', navTextStyle: 'white',
  //   pageGradient: ['#FFE0B2', '#FFCCBC', '#FFD54F'],
  //   coverGradient: ['#FFAB91', '#8D6E63', '#FFD54F'],
  //   coverEmoji: '🧋', tag: '每日',
  //   progressVisual: 'tea-cup',
  //   mainColor: '#8D6E63', subColor: '#5D4037', accentColor: '#FFB300', textColor: '#3E2723',
  //   presetIcon: () => '🧋', entryIcon: () => '🧋',
  //   cheerFor: (progress, total, goal) => {
  //     if (total === 0) return '今天还没喝，控住了 👏';
  //     if (progress <= 1) return '在控制内，享受小确幸 🥤';
  //     if (progress <= 1.5) return '有点超了，明天少一杯 ⚠️';
  //     return '今日已严重超量 🥲';
  //   },
  //   ...
  // }
};

/**
 * 通过 id 获取配置；缺省返回 'water'，避免空指针
 */
function getTheme(id) {
  if (id && THEMES[id]) return THEMES[id];
  return THEMES.water;
}

/**
 * 主页背景 CSS 字符串
 */
function pageBackground(theme) {
  const colors = theme.pageGradient;
  return `linear-gradient(180deg, ${colors[0]} 0%, ${colors[1] || colors[0]} ${colors.length === 3 ? '35%' : '100%'}${colors[2] ? ', ' + colors[2] + ' 100%' : ''})`;
}

/**
 * 计算进度（百分比 + 文案）
 *  - 正向目标（喝水）：达成是 1.0 → 100%
 *  - 反向目标（奶茶）：未超是 0~1.0 → 100% 表示已喝满 1 杯（边界），>1 表示超量
 */
function computeProgress(total, goal, inverse) {
  if (!goal || goal <= 0) return { ratio: 0, pct: 0, exceeded: false };
  const ratio = total / goal;
  const pct = Math.round(Math.min(2, ratio) * 100);   // 最多显示 200%
  return { ratio, pct, exceeded: inverse && ratio > 1 };
}

module.exports = {
  THEMES,
  DESIGN_TOKENS,
  ACCENT_HEX,
  getTheme,
  pageBackground,
  computeProgress
};
