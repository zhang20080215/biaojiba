/**
 * 每日运动 · 自定义线性图标（单一数据源）
 *
 * 每个图标用 24×24 网格的「折线 / 圆 / 实心点」描述，纯几何线条（无 emoji）。
 * 同一份几何同时支持两种渲染：
 *   - svgUri(key) → data:image/svg+xml 数据 URI，给 WXML 用 background-image 渲染
 *   - drawIcon(ctx, key, x, y, size) → 在 Canvas 2D 上按线条绘制（海报用）
 *
 * 通过 keyForType(typeName) 把具体动作映射到一个「器械/动作」线性图标（按器械归类，
 * 同类动作共用一个图标，简洁统一）。新增动作时在 TYPE_ICON 里加一行即可。
 */

const ICON_COLOR = '#222B45';

// key → { lines:[折线(点数组)], circles:[[cx,cy,r]描边], dots:[[cx,cy,r]填充] }
const ICONS = {
  // 有氧 · 动作
  run: {
    circles: [[16, 5, 2.1]],
    lines: [[[16, 7.2], [11.5, 13]], [[15, 9], [19, 10.5]], [[15, 9.3], [12, 7.6]], [[11.5, 13], [15, 16], [14, 21]], [[11.5, 13], [8, 17.5], [9.5, 21]]]
  },
  walk: {
    circles: [[12, 5, 2]],
    lines: [[[12, 7], [12.5, 14]], [[12, 9], [14.5, 12]], [[12, 9], [9.5, 11.5]], [[12.5, 14], [15, 20]], [[12.5, 14], [9.5, 17], [9, 21]]]
  },
  jumpingjack: {
    circles: [[12, 4, 2]],
    lines: [[[12, 6], [12, 13]], [[12, 8], [7, 5]], [[12, 8], [17, 5]], [[12, 13], [8, 20]], [[12, 13], [16, 20]]]
  },
  rowing: {
    circles: [[5.5, 12, 3]],
    lines: [[[3, 18.5], [21, 18.5]], [[5.5, 12], [12, 15.5]], [[12, 15.5], [16.5, 15.5]], [[11.5, 13.5], [11.5, 17.5]]]
  },
  bike: {
    circles: [[6, 16, 4.3], [18, 16, 4.3]],
    lines: [[[6, 16], [10, 9]], [[10, 9], [16, 9]], [[16, 9], [18, 16]], [[10, 9], [12, 16]], [[8, 8.5], [11, 8.5]], [[16, 9], [18.5, 7]]]
  },
  swim: {
    circles: [[6.5, 7, 2]],
    lines: [[[8.5, 8.5], [13, 11.5], [17, 8.5]], [[3, 18], [5.5, 16], [8, 18], [10.5, 16], [13, 18], [15.5, 16], [18, 18], [20.5, 16]]]
  },
  rope: {
    lines: [[[6, 5], [3, 12], [6, 19], [12, 21], [18, 19], [21, 12], [18, 5]]],
    dots: [[6, 5, 1.3], [18, 5, 1.3]]
  },
  stairs: {
    lines: [[[3, 20], [3, 16], [8, 16], [8, 12], [13, 12], [13, 8], [18, 8], [18, 4], [21, 4]]]
  },
  peak: { lines: [[[3, 19], [9, 8], [13, 14], [17, 6], [21, 19]]] },
  ski: { lines: [[[4, 20], [16, 6]], [[8, 21], [20, 7]], [[14, 6], [17.5, 6]]] },
  glove: {
    circles: [[11, 10, 5.6], [17, 12, 2.4]],
    lines: [[[7, 16.5], [15.5, 16.5]]]
  },
  // 力量 · 器械
  dumbbell: {
    lines: [[[8.5, 12], [15.5, 12]], [[6, 9], [6, 15]], [[8.5, 7.5], [8.5, 16.5]], [[15.5, 7.5], [15.5, 16.5]], [[18, 9], [18, 15]]]
  },
  barbell: {
    lines: [[[2, 12], [22, 12]], [[5, 8], [5, 16]], [[7, 7], [7, 17]], [[17, 7], [17, 17]], [[19, 8], [19, 16]]]
  },
  kettlebell: {
    circles: [[12, 14, 5]],
    lines: [[[9, 8], [10, 5], [14, 5], [15, 8]]]
  },
  cable: {
    lines: [[[4, 4], [20, 4]], [[8, 4], [10, 11]], [[16, 4], [14, 11]], [[9, 11], [15, 11]], [[12, 11], [12, 18]]]
  },
  legs: {
    lines: [[[5, 5], [5, 15]], [[5, 15], [10, 15]], [[10, 15], [15, 11]], [[15, 11], [20, 14]], [[20, 8], [20, 17]]]
  },
  glute: {
    lines: [[[3, 19], [21, 19]], [[5, 19], [9, 11], [15, 11], [19, 19]]]
  },
  abs: {
    lines: [[[8, 7], [16, 7]], [[8, 17], [16, 17]], [[8, 7], [8, 17]], [[16, 7], [16, 17]], [[12, 7], [12, 17]], [[8, 10.5], [16, 10.5]], [[8, 13.5], [16, 13.5]]]
  },
  plank: {
    circles: [[20.2, 8, 1.6]],
    lines: [[[3, 19], [21, 19]], [[6, 19], [6, 15]], [[6, 15], [9, 15]], [[6, 15], [19, 9]]]
  },
  // 拉伸·柔韧（各动作不同图标）
  yoga: {
    circles: [[12, 5, 2]],
    lines: [[[12, 7], [12, 12]], [[12, 12], [7, 16], [17, 16], [12, 12]], [[12, 9], [8, 12]], [[12, 9], [16, 12]]]
  },
  mat: {
    circles: [[6, 8, 1.8]],
    lines: [[[7, 9.5], [11, 14]], [[11, 14], [18, 9]], [[8, 11], [14, 11.5]], [[4, 18], [20, 18]]]
  },
  taichi: {
    circles: [[12, 5, 2]],
    lines: [[[12, 7], [12, 13]], [[7, 12], [9, 10], [12, 9.5], [15, 10], [17, 12]], [[12, 13], [8, 20]], [[12, 13], [16, 20]]]
  },
  armsup: {
    circles: [[12, 5, 2]],
    lines: [[[12, 7], [12, 14]], [[11.5, 8.5], [10.5, 3]], [[12.5, 8.5], [13.5, 3]], [[12, 14], [9.5, 20]], [[12, 14], [14.5, 20]]]
  },
  foamroller: {
    circles: [[6.5, 14, 3.2], [17.5, 14, 3.2]],
    lines: [[[6.5, 10.8], [17.5, 10.8]], [[6.5, 17.2], [17.5, 17.2]]]
  },
  stretch: {
    circles: [[8, 6, 2]],
    lines: [[[8, 8], [11, 13]], [[9, 9], [15, 11]], [[11, 13], [18, 15]], [[11, 13], [6, 18]]]
  }
};

// 动作名 → 图标 key（有氧动作分细、拉伸各异、力量按器械归类）
const TYPE_ICON = {
  // 有氧
  '跑步': 'run', '快走': 'walk', '骑行': 'bike', '动感单车': 'bike', '游泳': 'swim',
  '跳绳': 'rope', '爬楼梯': 'stairs', '登山': 'peak', '椭圆机': 'run', '划船机': 'rowing',
  '开合跳': 'jumpingjack', '有氧操': 'run', '拳击': 'glove', '跑步机': 'run', '波比跳': 'jumpingjack',
  '高抬腿': 'run', '战绳': 'rope', '滑雪': 'ski',
  // 胸
  '杠铃卧推': 'barbell', '上斜卧推': 'barbell', '哑铃卧推': 'dumbbell', '坐姿推胸': 'cable',
  '龙门架夹胸': 'cable', '蝴蝶机夹胸': 'cable', '双杠臂屈伸': 'dumbbell', '俯卧撑': 'dumbbell',
  // 背
  '引体向上': 'cable', '高位下拉': 'cable', '坐姿划船': 'cable', '杠铃划船': 'barbell',
  '单臂划船': 'dumbbell', '硬拉': 'barbell', '直臂下压': 'cable', '面拉': 'cable',
  // 腿
  '杠铃深蹲': 'barbell', '哈克深蹲': 'legs', '腿举': 'legs', '腿屈伸': 'legs', '腿弯举': 'legs',
  '箭步蹲': 'legs', '保加利亚深蹲': 'legs', '提踵': 'legs',
  // 肩
  '杠铃肩推': 'barbell', '哑铃肩推': 'dumbbell', '侧平举': 'dumbbell', '前平举': 'dumbbell',
  '俯身飞鸟': 'dumbbell', '阿诺德推举': 'dumbbell',
  // 手臂
  '杠铃弯举': 'barbell', '哑铃弯举': 'dumbbell', '锤式弯举': 'dumbbell', '三头臂屈伸': 'dumbbell',
  '窄距卧推': 'barbell', '绳索下压': 'cable',
  // 臀
  '臀桥': 'glute', '臀推': 'glute', '罗马尼亚硬拉': 'barbell', '壶铃摇摆': 'kettlebell',
  // 核心
  '卷腹': 'abs', '俄罗斯转体': 'abs', '悬垂举腿': 'abs', '登山者': 'abs', '平板支撑': 'plank',
  // 柔韧（各动作不同图标）
  '瑜伽': 'yoga', '普拉提': 'mat', '拉伸放松': 'stretch', '太极': 'taichi',
  '八段锦': 'armsup', '泡沫轴放松': 'foamroller'
};

const CATEGORY_ICON = { cardio: 'run', strength: 'dumbbell', flexibility: 'yoga' };

function keyForType(typeName) {
  return TYPE_ICON[typeName] || 'dumbbell';
}

function keyForCategory(catId) {
  return CATEGORY_ICON[catId] || 'dumbbell';
}

// 生成 SVG data URI（WXML background-image 用）
function svgUri(key, color, strokeWidth) {
  const ic = ICONS[key] || ICONS.dumbbell;
  const c = color || ICON_COLOR;
  const w = strokeWidth || 2;
  let body = '';
  (ic.lines || []).forEach(pts => {
    const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0] + ' ' + p[1]).join(' ');
    body += `<path d="${d}" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
  });
  (ic.circles || []).forEach(cc => {
    body += `<circle cx="${cc[0]}" cy="${cc[1]}" r="${cc[2]}" fill="none" stroke="${c}" stroke-width="${w}"/>`;
  });
  (ic.dots || []).forEach(cc => {
    body += `<circle cx="${cc[0]}" cy="${cc[1]}" r="${cc[2]}" fill="${c}"/>`;
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${body}</svg>`;
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

function uriForType(typeName, color, strokeWidth) {
  return svgUri(keyForType(typeName), color, strokeWidth);
}
function uriForCategory(catId, color, strokeWidth) {
  return svgUri(keyForCategory(catId), color, strokeWidth);
}

// Canvas 2D 绘制（海报用）：把 24 网格缩放到 (x,y,size)
function drawIcon(ctx, key, x, y, size, color, strokeWidth) {
  const ic = ICONS[key] || ICONS.dumbbell;
  const u = size / 24;
  const X = v => x + v * u;
  const Y = v => y + v * u;
  ctx.strokeStyle = color || ICON_COLOR;
  ctx.fillStyle = color || ICON_COLOR;
  ctx.lineWidth = (strokeWidth || 2) * u;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  (ic.lines || []).forEach(pts => {
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(X(p[0]), Y(p[1])) : ctx.moveTo(X(p[0]), Y(p[1]))));
    ctx.stroke();
  });
  (ic.circles || []).forEach(cc => {
    ctx.beginPath();
    ctx.arc(X(cc[0]), Y(cc[1]), cc[2] * u, 0, Math.PI * 2);
    ctx.stroke();
  });
  (ic.dots || []).forEach(cc => {
    ctx.beginPath();
    ctx.arc(X(cc[0]), Y(cc[1]), cc[2] * u, 0, Math.PI * 2);
    ctx.fill();
  });
}

module.exports = {
  ICON_COLOR,
  keyForType,
  keyForCategory,
  svgUri,
  uriForType,
  uriForCategory,
  drawIcon
};
