/**
 * 健身训练类型配置
 * [不打包] 当前未使用，已通过 project.config.json packOptions 排除打包
 */

const categories = [
  {
    id: 'cardio',
    name: '有氧运动',
    icon: '🏃',
    types: [
      { name: '跑步', icon: '🏃' },
      { name: '快走', icon: '🚶' },
      { name: '骑行', icon: '🚴' },
      { name: '动感单车', icon: '🚲' },
      { name: '游泳', icon: '🏊' },
      { name: '跳绳', icon: '⏭' },
      { name: '爬楼梯', icon: '🪜' },
      { name: '登山', icon: '⛰' },
      { name: '椭圆机', icon: '🔄' },
      { name: '划船机', icon: '🚣' },
      { name: '开合跳', icon: '⭐' },
      { name: '有氧操', icon: '💃' },
      { name: '拳击', icon: '🥊' },
      { name: '跑步机', icon: '🏃‍♂️' }
    ]
  },
  {
    id: 'strength',
    name: '力量训练',
    icon: '🏋️',
    types: [
      { name: '哈克深蹲', icon: '🦵' },
      { name: '杠铃深蹲', icon: '🏋️' },
      { name: '壶铃摇摆', icon: '💪' },
      { name: '硬拉', icon: '🏋️‍♂️' },
      { name: '卧推', icon: '🛏' },
      { name: '肩推', icon: '🙆' },
      { name: '引体向上', icon: '🧗' },
      { name: '俯卧撑', icon: '💪' },
      { name: '高位下拉', icon: '⬇' },
      { name: '坐姿划船', icon: '🚣' },
      { name: '腿举', icon: '🦵' },
      { name: '腿弯举', icon: '🦿' },
      { name: '腿屈伸', icon: '🦵' },
      { name: '弯举', icon: '💪' },
      { name: '三头臂屈伸', icon: '💪' },
      { name: '飞鸟', icon: '🦅' },
      { name: '龙门架夹胸', icon: '🏋️' },
      { name: '坐姿推胸', icon: '🏋️' },
      { name: '提踵', icon: '🦶' },
      { name: '平板支撑', icon: '🧘' }
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
  '游泳': 'm'
};

// 平板支撑：力量训练但只记录时长
const durationOnlyStrength = ['平板支撑'];

function getFieldConfig(typeName) {
  // 查找属于哪个大类
  const cardioCategory = categories.find(c => c.id === 'cardio');
  const isCardio = cardioCategory.types.some(t => t.name === typeName);

  if (isCardio) {
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
