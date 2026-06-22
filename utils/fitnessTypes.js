/**
 * 运动训练类型配置 —— 「每日运动」录入页(pages/daily/sport/add)消费
 *
 * 结构：每个大类带 groups（分组）；组内 types 为具体项目。
 *   - cardio       有氧运动：单组(无身体部位标签)，记时长，部分项目记距离(distanceTypes)
 *   - strength     力量训练：按**身体部位**分组(胸/背/腿/肩/手臂/臀/核心)，记组数×次数(+可选重量)；
 *                  平板支撑等只记时长(durationOnlyStrength)
 *   - flexibility  拉伸·柔韧：单组，瑜伽/普拉提等只记时长
 *
 * 兼容：大类仍以 id 区分字段逻辑（findCategoryId 在 groups 内查 type）。
 */

const categories = [
  {
    id: 'cardio',
    name: '有氧',
    icon: '🏃',
    groups: [
      {
        part: '',
        types: [
          { name: '跑步', icon: '🏃' },
          { name: '快走', icon: '🚶' },
          { name: '骑行', icon: '🚴' },
          { name: '动感单车', icon: '🚲' },
          { name: '游泳', icon: '🏊' },
          { name: '跳绳', icon: '🤸' },
          { name: '爬楼梯', icon: '👣' },
          { name: '登山', icon: '⛰' },
          { name: '椭圆机', icon: '🏃' },
          { name: '划船机', icon: '🚣' },
          { name: '开合跳', icon: '🤸' },
          { name: '有氧操', icon: '💃' },
          { name: '拳击', icon: '🥊' },
          { name: '跑步机', icon: '🏃' },
          { name: '波比跳', icon: '🤸' },
          { name: '高抬腿', icon: '🏃' },
          { name: '战绳', icon: '🪢' },
          { name: '滑雪', icon: '🎿' }
        ]
      }
    ]
  },
  {
    id: 'strength',
    name: '力量',
    icon: '🏋️',
    groups: [
      {
        part: '胸',
        types: [
          { name: '杠铃卧推', icon: '🏋️' },
          { name: '上斜卧推', icon: '🏋️' },
          { name: '哑铃卧推', icon: '🏋️' },
          { name: '坐姿推胸', icon: '💪' },
          { name: '龙门架夹胸', icon: '🏋️' },
          { name: '蝴蝶机夹胸', icon: '💪' },
          { name: '双杠臂屈伸', icon: '🤸' },
          { name: '俯卧撑', icon: '💪' }
        ]
      },
      {
        part: '背',
        types: [
          { name: '引体向上', icon: '💪' },
          { name: '高位下拉', icon: '🏋️' },
          { name: '坐姿划船', icon: '🚣' },
          { name: '杠铃划船', icon: '🏋️' },
          { name: '单臂划船', icon: '💪' },
          { name: '硬拉', icon: '🏋️' },
          { name: '直臂下压', icon: '💪' },
          { name: '面拉', icon: '🤝' }
        ]
      },
      {
        part: '腿',
        types: [
          { name: '杠铃深蹲', icon: '🏋️' },
          { name: '哈克深蹲', icon: '🦵' },
          { name: '腿举', icon: '🦵' },
          { name: '腿屈伸', icon: '🦵' },
          { name: '腿弯举', icon: '🦿' },
          { name: '箭步蹲', icon: '🚶' },
          { name: '保加利亚深蹲', icon: '🦵' },
          { name: '提踵', icon: '🦶' }
        ]
      },
      {
        part: '肩',
        types: [
          { name: '杠铃肩推', icon: '🙆' },
          { name: '哑铃肩推', icon: '🙆' },
          { name: '侧平举', icon: '➡' },
          { name: '前平举', icon: '⬆' },
          { name: '俯身飞鸟', icon: '🦅' },
          { name: '阿诺德推举', icon: '💪' }
        ]
      },
      {
        part: '手臂',
        types: [
          { name: '杠铃弯举', icon: '💪' },
          { name: '哑铃弯举', icon: '💪' },
          { name: '锤式弯举', icon: '🔨' },
          { name: '三头臂屈伸', icon: '💪' },
          { name: '窄距卧推', icon: '🛏' },
          { name: '绳索下压', icon: '🪢' }
        ]
      },
      {
        part: '臀',
        types: [
          { name: '臀桥', icon: '🏋️' },
          { name: '臀推', icon: '🏋️' },
          { name: '罗马尼亚硬拉', icon: '🏋️‍♂️' },
          { name: '壶铃摇摆', icon: '🏋️' }
        ]
      },
      {
        part: '核心',
        types: [
          { name: '卷腹', icon: '💪' },
          { name: '俄罗斯转体', icon: '🌀' },
          { name: '悬垂举腿', icon: '🦵' },
          { name: '登山者', icon: '⛰' },
          { name: '平板支撑', icon: '💪' }
        ]
      }
    ]
  },
  {
    id: 'flexibility',
    name: '拉伸·柔韧',
    icon: '🧘',
    groups: [
      {
        part: '',
        types: [
          { name: '瑜伽', icon: '🧘' },
          { name: '普拉提', icon: '🤸‍♀️' },
          { name: '拉伸放松', icon: '🙆‍♀️' },
          { name: '太极', icon: '🥋' },
          { name: '八段锦', icon: '🧎' },
          { name: '泡沫轴放松', icon: '🧴' }
        ]
      }
    ]
  }
];

// 需要记录距离的有氧项目
const distanceTypes = {
  '跑步': 'km',
  '快走': 'km',
  '骑行': 'km',
  '动感单车': 'km',
  '跑步机': 'km',
  '滑雪': 'km',
  '游泳': 'm'
};

// 平板支撑：力量训练但只记录时长
const durationOnlyStrength = ['平板支撑'];

function findCategoryId(typeName) {
  const cat = categories.find(c =>
    (c.groups || []).some(g => (g.types || []).some(t => t.name === typeName))
  );
  return cat ? cat.id : null;
}

function getFieldConfig(typeName) {
  const categoryId = findCategoryId(typeName);

  // 拉伸·柔韧：只记时长
  if (categoryId === 'flexibility') {
    return {
      showDuration: true,
      showDistance: false,
      showStrength: false
    };
  }

  // 有氧：时长 +（部分项目）距离
  if (categoryId === 'cardio') {
    const unit = distanceTypes[typeName];
    return {
      showDuration: true,
      showDistance: !!unit,
      distanceUnit: unit || 'km',
      showStrength: false
    };
  }

  // 力量训练
  if (durationOnlyStrength.includes(typeName)) {
    return {
      showDuration: true,
      showDistance: false,
      showStrength: false
    };
  }

  return {
    showDuration: false,
    showDistance: false,
    showStrength: true
  };
}

module.exports = {
  categories,
  getFieldConfig
};
