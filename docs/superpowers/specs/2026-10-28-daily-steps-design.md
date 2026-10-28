# 每日步数 + 每日主题公共层 设计

2026-10-28 · 分支 `feature/daily-steps`

## 目标
1. 新增每日主题「每日步数」（`steps`），数据来自微信运动自动同步。
2. 以它为第一个使用者，搭一层每日主题公共层，后续主题少复制代码、自动兼容四套全站主题色。
3. 每日电影 / 读书 / 运动 / 喝水本期**不动**；统计页合并放二期。

## 主题分类
- **数值型（metric）**：每天一个数 + 每日目标（步数，以后的睡眠、体重、冥想……）。一份配置驱动 `pages/daily/metric/*`，不建新页面。
- **条目型（entry）**：每天若干条富记录（电影、读书、运动）。首页/录入页各自写，统计/年度/组件走公共层（二期）。

> 与讨论稿的差异：数值型的统计页放在 `pages/daily/metric/stats`，而不是改喝水在用的 `pages/daily/stats`。喝水的统计页是「水杯」专用视觉，硬改风险大于收益，等二期把喝水迁到数值型页面集时一起退役。

## 公共层
| 位置 | 作用 |
|---|---|
| `utils/daily/date.js` | 北京时区日期计算、周一开头的周/月区间、导航栏尺寸（替代三份 common.js 的重复，本期只新代码用） |
| `utils/daily/palette.js` | 四套全站主题色的 JS 镜像（粉/暖金/橄榄绿/暖沙）+ 热力 5 档梯度；`tools/test-daily-metric.cjs` 逐项比对 `styles/theme.wxss` |
| `utils/daily/metric.js` | 纯函数：热力分档、区间汇总（日均/达标/最高/最长连续）、累计目标进度、月历/年历格子、数字格式 |
| `utils/daily/ring.js` | 进度环 SVG data URI |
| `utils/dailyThemes.js` | 主题配置新增 `kind` / `source` / `vocab` / `deadlineGoal` 字段 |
| `components/daily/*` | `daily-nav`、`month-heatmap`、`year-heatmap`、`deadline-goal-card`、`deadline-goal-sheet`；颜色只用 CSS 变量或 palette，四套主题色自动兼容 |
| `utils/metricPosterDrawer.js` | 数值型海报绘制器，`withVocab` 换词表即换主题 |

## 后端（`syncDailyLog`，不新增云函数/集合）
- `syncSource {theme, source:'werun', weRunData: CloudID}`：解密出最近 30 天步数，按日期 upsert 到 `DailyLogs`（`total_value` = 当天步数，`entries: []`）。只写有变化的天；列表开头连续的 0 步（用户开通微信运动之前）不写，避免把「无数据」变成「0 步」。
- `getMetricOverview {theme, date}`：今日数据 + 设置（含累计目标）+ 累计目标区间内已走总量（聚合求和，跨度可超过 `getRange` 的 100 天上限）。
- `setDeadlineGoal {theme, target, startDate, endDate}` / `endDeadlineGoal {theme, status, walked}`：同时只有一个进行中的目标，结束的归档到 `pastGoals`（最多 20 条）。
- `getRange` 补零的日子加 `missing: true`；前端同时以「没有 `_id`」判定无数据，兼容旧版云函数。
- `THEME_DEFAULTS.steps = { unit:'步', daily_goal: 8000 }`。

## 页面（`pages/daily/metric/*?theme=steps`）
- **index**：今日卡（大数字 + 进度环 + 同步时间，下拉重新同步）→ 累计目标卡 → 月历热力图（可翻月、点日看步数）→ 入口（统计/年度/海报）。每日目标、累计目标都用半屏面板设置。
- **stats**：周 / 月 / 年；柱状图 + KPI（日均、达标天数、最高一天、最长连续达标、累计 + 约合公里）。
- **year**：12 行 × 按日格子，年度总数、达标天数、日均。
- **share**：1080×1440，版式「单日 / 月度」，四套主题色可切（默认跟随全站主题，本地记住），`rewardedSaveGate` 把关，署名「标记吧 · 每日步数」。

## 规则
- 热力 5 档：0 步 / <25% / <50% / <100% / 达标；没有数据的日子画虚线框。
- 「无数据」的日子不计入日均、达标率分母，也**不打断**连续达标。
- 累计目标：开始日最早往前 `backfillDays`（步数 = 30，微信运动只给 30 天）；截止日 ≥ 今天，跨度 ≤ 366 天；进度 = 区间已走 / 目标，剩余天数含今天，日均还需 = ⌈剩余 / 剩余天数⌉。
- 同步频率：进页面同步一次；`onShow` 距上次同步 > 5 分钟才再同步。
- 拒绝授权：显示说明卡 + 「去开启」（`wx.openSetting`），历史数据照常展示。
- 同步失败：保留已有数据，顶部提示，不弹模态框。

## 上线前（需人工）
- 小程序后台「用户隐私保护指引」声明「微信运动步数」。
- 部署 `syncDailyLog`，核线上超时（应为 60s）。
- 真机验证：真实步数、拒绝后再开启、隐私弹窗、四套主题色。

## 测试
`node --test tools/test-daily-metric.cjs`：日期工具、热力分档、汇总与连续达标、累计目标进度、色板与 `theme.wxss` 一致、微信运动数据解析。
