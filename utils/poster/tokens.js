// 海报设计令牌：颜色 / 字号 / 间距 / 圆角，全部按 1080 宽的设计坐标。
// 视觉基准是 docs/superpowers/mockups/refined.html —— 这里的值和那份精修稿的 CSS 一一对应，改这里要同步改精修稿。
// 原则（设计文档第 2 节）：底色只用白 / 浅灰 / 封面取色模糊底；字只用黑灰；全图只有一个强调色。

const DESIGN_W = 1080;
const DESIGN_H = 1440;   // 3:4，小红书首图比例

const COLOR = {
  ink: '#16181D',        // 主文字
  ink2: '#6B7079',       // 次要文字
  ink3: '#A3A8B0',       // 弱文字 / 署名
  line: '#E6E8EC',       // 发丝线
  paper: '#FFFFFF',
  mist: '#F4F5F7',       // 浅灰底（日程清单）
  acc: '#FF5B3A',        // 唯一强调色：星级、百分比、想看
  starOff: '#E3E5E9',    // 空星
  film: '#16171A',       // 胶片
  placeholder: '#ECEEF1' // 无封面占位
};

// 字号阶梯（设计坐标 px）
const TYPE = {
  hero: 300,   // 主数字（榜单已看数）
  h1: 96,
  h2: 72,
  h3: 64,
  t1: 34,
  t2: 28,
  t3: 22,
  t4: 20
};

const SPACE = {
  margin: 72,        // 页边距
  marginTight: 64,   // 列表类版式的窄页边距
  cardRadius: 22,
  coverRadius: 8
};

// 字体：数字 / 拉丁走 Inter（fonts.js 加载成功后），中文走系统字体。
// 小程序 canvas 的 font 字符串里写多个 family 时，找不到的会自动跳过。
const NUM_FAMILY = 'PosterNum';
const SYS_NUM = '"Helvetica Neue", Helvetica, Arial, sans-serif';
const CN = '"PingFang SC", "Noto Sans SC", "Microsoft YaHei", sans-serif';

/** 中文字体串：font(weight, size) */
function cn(weight, size) {
  return `${weight} ${Math.round(size)}px ${CN}`;
}

/** 数字字体串；fontsReady=false 时只用系统字体 */
function num(weight, size, fontsReady) {
  const fam = fontsReady ? `"${NUM_FAMILY}", ${SYS_NUM}` : SYS_NUM;
  return `${weight} ${Math.round(size)}px ${fam}`;
}

// 等宽：小票版式的编号 / 日期 / 评分行。中文字形找不到等宽字体时按字回退到系统中文字体
const MONO = 'Menlo, "SF Mono", "Courier New", monospace';

/** 等宽字体串（小票） */
function mono(weight, size) {
  return `${weight} ${Math.round(size)}px ${MONO}, ${CN}`;
}

module.exports = { DESIGN_W, DESIGN_H, COLOR, TYPE, SPACE, NUM_FAMILY, cn, num, mono };
