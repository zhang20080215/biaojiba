// 儿童生长评估计算引擎
// 基于 WS/T 423-2022《7岁以下儿童生长标准》
const growthData = require('./growthData.js');

/**
 * 标准正态分布CDF (Abramowitz & Stegun 26.2.17)
 * 精度约 ±7.5×10⁻⁸
 */
function normalCDF(z) {
  if (z < -6) return 0;
  if (z > 6) return 1;
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return 0.5 * (1.0 + sign * y);
}

/**
 * 在SD表中查找数据行
 * @param {Array} table - [[key, -3SD, -2SD, -1SD, median, +1SD, +2SD, +3SD], ...]
 * @param {number} key - 月龄或身高cm
 * @returns {Array|null} - 匹配的行 [key, -3SD, ..., +3SD]
 */
function findRow(table, key) {
  // 精确匹配
  const exact = table.find(row => row[0] === key);
  if (exact) return exact;

  // 最近匹配
  let closest = null, minDist = Infinity;
  for (const row of table) {
    const dist = Math.abs(row[0] - key);
    if (dist < minDist) {
      minDist = dist;
      closest = row;
    }
  }
  return closest;
}

/**
 * 在两行之间插值得到SD值
 * @param {Array} table
 * @param {number} key - 可能是非整数的月龄或身高
 * @returns {object} - { '-3SD', '-2SD', '-1SD', median, '+1SD', '+2SD', '+3SD' }
 */
function interpolateRow(table, key) {
  // Find bounding rows
  let lower = null, upper = null;
  for (let i = 0; i < table.length - 1; i++) {
    if (table[i][0] <= key && table[i + 1][0] >= key) {
      lower = table[i];
      upper = table[i + 1];
      break;
    }
  }

  if (!lower || !upper || lower[0] === upper[0]) {
    const row = findRow(table, Math.round(key));
    if (!row) return null;
    return rowToObj(row);
  }

  const ratio = (key - lower[0]) / (upper[0] - lower[0]);
  const interpolated = [0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < 7; i++) {
    interpolated[i] = lower[i + 1] + ratio * (upper[i + 1] - lower[i + 1]);
  }
  return {
    '-3SD': interpolated[0], '-2SD': interpolated[1], '-1SD': interpolated[2],
    median: interpolated[3],
    '+1SD': interpolated[4], '+2SD': interpolated[5], '+3SD': interpolated[6]
  };
}

function rowToObj(row) {
  return {
    '-3SD': row[1], '-2SD': row[2], '-1SD': row[3],
    median: row[4],
    '+1SD': row[5], '+2SD': row[6], '+3SD': row[7]
  };
}

/**
 * 计算Z-score（SD表线性插值）
 * @param {number} value - 测量值
 * @param {object} sdRow - { '-3SD', '-2SD', '-1SD', median, '+1SD', '+2SD', '+3SD' }
 * @returns {number} Z-score
 */
function calcZScore(value, sdRow) {
  const points = [
    { z: -3, v: sdRow['-3SD'] },
    { z: -2, v: sdRow['-2SD'] },
    { z: -1, v: sdRow['-1SD'] },
    { z: 0, v: sdRow.median },
    { z: 1, v: sdRow['+1SD'] },
    { z: 2, v: sdRow['+2SD'] },
    { z: 3, v: sdRow['+3SD'] }
  ];

  // 在区间内线性插值
  for (let i = 0; i < points.length - 1; i++) {
    if (value >= points[i].v && value <= points[i + 1].v) {
      const ratio = (value - points[i].v) / (points[i + 1].v - points[i].v);
      return points[i].z + ratio * (points[i + 1].z - points[i].z);
    }
  }

  // 超出±3SD范围，用边界斜率外推
  if (value < points[0].v) {
    const slope = (points[1].v - points[0].v) / (points[1].z - points[0].z);
    return points[0].z + (value - points[0].v) / slope;
  }
  if (value > points[6].v) {
    const slope = (points[6].v - points[5].v) / (points[6].z - points[5].z);
    return points[6].z + (value - points[6].v) / slope;
  }

  return 0; // fallback
}

/**
 * 百分位数等级评价
 */
function getLevel(zScore) {
  if (zScore >= 2) return '上';
  if (zScore >= 1) return '中上';
  if (zScore >= -1) return '中';
  if (zScore >= -2) return '中下';
  return '下';
}

/**
 * 等级对应颜色
 */
function getLevelColor(level) {
  const colors = {
    '上': '#e74c3c',
    '中上': '#f39c12',
    '中': '#27ae60',
    '中下': '#f39c12',
    '下': '#e74c3c'
  };
  return colors[level] || '#999';
}

/**
 * 营养状况评价（表3）
 * 基于Z-score判定
 */
function evaluateNutrition(weightForAgeZ, heightForAgeZ, bmiForAgeZ) {
  const result = {
    weightStatus: '正常',
    heightStatus: '正常',
    bodyStatus: '正常'
  };

  // 年龄别体重
  if (weightForAgeZ < -3) result.weightStatus = '重度偏轻';
  else if (weightForAgeZ < -2) result.weightStatus = '偏轻';
  else if (weightForAgeZ < -1) result.weightStatus = '略偏轻';
  else if (weightForAgeZ >= 3) result.weightStatus = '明显偏重';
  else if (weightForAgeZ >= 2) result.weightStatus = '偏重';
  else if (weightForAgeZ >= 1) result.weightStatus = '略偏重';

  // 年龄别身长/身高
  if (heightForAgeZ < -3) result.heightStatus = '重度偏矮';
  else if (heightForAgeZ < -2) result.heightStatus = '偏矮';
  else if (heightForAgeZ < -1) result.heightStatus = '略偏矮';
  else if (heightForAgeZ >= 3) result.heightStatus = '明显偏高';
  else if (heightForAgeZ >= 2) result.heightStatus = '偏高';
  else if (heightForAgeZ >= 1) result.heightStatus = '略偏高';

  // BMI评价体型
  const bodyZ = bmiForAgeZ !== null ? bmiForAgeZ : 0;
  if (bodyZ !== null) {
    if (bodyZ >= 3) result.bodyStatus = '重度肥胖';
    else if (bodyZ >= 2) result.bodyStatus = '肥胖';
    else if (bodyZ >= 1) result.bodyStatus = '超重';
    else if (bodyZ < -3) result.bodyStatus = '重度消瘦';
    else if (bodyZ < -2) result.bodyStatus = '消瘦';
    else if (bodyZ < -1) result.bodyStatus = '偏瘦';
  }

  return result;
}

/**
 * 综合评估
 * @param {string} gender - 'male' | 'female'
 * @param {number} ageMonths - 月龄 (0~83)
 * @param {number} weight - 体重 kg
 * @param {number} height - 身高/身长 cm
 * @param {number|null} headCirc - 头围 cm (3岁以下)
 * @returns {object} 评估结果
 */
function evaluate(gender, ageMonths, weight, height, headCirc) {
  const results = {};

  // 1. 年龄别体重
  const waTable = growthData.weightForAge[gender];
  const waRow = interpolateRow(waTable, ageMonths);
  if (waRow) {
    const z = calcZScore(weight, waRow);
    const p = normalCDF(z) * 100;
    results.weightForAge = {
      name: '体重',
      value: weight,
      unit: 'kg',
      zScore: Math.round(z * 100) / 100,
      percentile: Math.round(p * 10) / 10,
      level: getLevel(z),
      color: getLevelColor(getLevel(z)),
      median: Math.round(waRow.median * 10) / 10
    };
  }

  // 2. 年龄别身长/身高
  const haTable = growthData.heightForAge[gender];
  const haRow = interpolateRow(haTable, ageMonths);
  if (haRow) {
    const z = calcZScore(height, haRow);
    const p = normalCDF(z) * 100;
    results.heightForAge = {
      name: ageMonths < 24 ? '身长' : '身高',
      value: height,
      unit: 'cm',
      zScore: Math.round(z * 100) / 100,
      percentile: Math.round(p * 10) / 10,
      level: getLevel(z),
      color: getLevelColor(getLevel(z)),
      median: Math.round(haRow.median * 10) / 10
    };
  }

  // 3. 年龄别BMI
  const bmi = weight / ((height / 100) * (height / 100));
  const bmiTable = growthData.bmiForAge[gender];
  const bmiRow = interpolateRow(bmiTable, ageMonths);
  let bmiZ = null;
  if (bmiRow) {
    const z = calcZScore(bmi, bmiRow);
    const p = normalCDF(z) * 100;
    bmiZ = z;
    results.bmiForAge = {
      name: 'BMI 体型',
      value: Math.round(bmi * 10) / 10,
      unit: 'kg/m²',
      zScore: Math.round(z * 100) / 100,
      percentile: Math.round(p * 10) / 10,
      level: getLevel(z),
      color: getLevelColor(getLevel(z)),
      median: Math.round(bmiRow.median * 10) / 10
    };
  }

  // 5. 年龄别头围 (0~3岁)
  if (headCirc && ageMonths <= 36) {
    const hcTable = growthData.headCircForAge[gender];
    const hcRow = interpolateRow(hcTable, ageMonths);
    if (hcRow) {
      const z = calcZScore(headCirc, hcRow);
      const p = normalCDF(z) * 100;
      results.headCircForAge = {
        name: '头围',
        value: headCirc,
        unit: 'cm',
        zScore: Math.round(z * 100) / 100,
        percentile: Math.round(p * 10) / 10,
        level: getLevel(z),
        color: getLevelColor(getLevel(z)),
        median: Math.round(hcRow.median * 10) / 10
      };
    }
  }

  // 6. 营养状况综合评价
  results.nutrition = evaluateNutrition(
    results.weightForAge?.zScore || 0,
    results.heightForAge?.zScore || 0,
    bmiZ
  );

  return results;
}

/**
 * 获取年龄描述文字
 */
function formatAge(ageMonths) {
  const years = Math.floor(ageMonths / 12);
  const months = ageMonths % 12;
  if (years === 0) return months + '月龄';
  if (months === 0) return years + '岁';
  return years + '岁' + months + '月';
}

module.exports = {
  evaluate,
  formatAge,
  normalCDF,
  calcZScore,
  getLevel,
  getLevelColor
};
