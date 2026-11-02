// 海报版式注册表：每类海报有哪些版式、默认哪个、显示名。
// 版式模块统一接口（layouts/*.js）：
//   supports(kind) → bool
//   measure(model) → { width, height }      画布尺寸（宽恒为 1080 的整数倍缩放，见 tokens.DESIGN_W）
//   draw(ctx, model, covers, env)            covers = key → image 节点 | null；env = { s, fontsReady, tints }
// 'classic' 没有模块：页面看到 classic 就走原来的绘制代码（moviePosterDrawer / 豆瓣页自带的绘制）。
//
// 版式是一个个加进来的（每个都要先过 1080 精修稿的设计门）：ORDER 里列的是规划好的全部版式，
// available(kind) 只返回已经有模块的 + classic，页面拿它渲染选项，没做完的版式不会露出来。

const ORDER = {
  single: ['ticket', 'magazine', 'polaroid', 'receipt', 'classic'],
  range: ['agenda', 'magazine', 'polaroid', 'film', 'ticket', 'receipt', 'classic'],
  ranking: ['magazine', 'film', 'receipt', 'classic']
};

const NAMES = {
  ticket: '票根',
  magazine: '杂志',
  polaroid: '拍立得',
  receipt: '小票',
  agenda: '清单',
  film: '胶片',
  classic: '经典'
};

// 已实现的版式模块。新版式写完后在这里登记一行。
const MODULES = {
  ticket: require('./layouts/ticket.js'),
  magazine: require('./layouts/magazine.js'),
  polaroid: require('./layouts/polaroid.js'),
  receipt: require('./layouts/receipt.js')
};

/** kind 下可选的版式 id（按 ORDER 顺序，只含已实现的 + classic） */
function available(kind) {
  return (ORDER[kind] || []).filter(id => id === 'classic' || (MODULES[id] && MODULES[id].supports(kind)));
}

/**
 * 默认版式。variant：range 用 'month' | 'year'，ranking 用 'poster' | 'text'（列表页的两个入口）。
 * 规划的默认还没实现时，退到 available 的第一个。
 */
function defaultFor(kind, variant) {
  const want = kind === 'single' ? 'ticket'
    : kind === 'range' ? (variant === 'year' ? 'magazine' : 'agenda')
      : (variant === 'text' ? 'receipt' : 'magazine');
  const list = available(kind);
  return list.indexOf(want) >= 0 ? want : list[0];
}

/** 校验一个（来自 storage 的）版式 id：可用就原样返回，否则返回 fallback */
function resolve(kind, id, fallback) {
  return available(kind).indexOf(id) >= 0 ? id : fallback;
}

function get(id) {
  return MODULES[id] || null;
}

/** 渲染选项用：[{ id, name }] */
function options(kind) {
  return available(kind).map(id => ({ id, name: NAMES[id] || id }));
}

module.exports = { ORDER, NAMES, MODULES, available, defaultFor, resolve, get, options };
