// 单独排查 growth 主题的所有页面访问数据
const path = require('path');
const XLSX = require('xlsx');

const fp = path.resolve(__dirname, '..', 'data-raw', '(20260331-20260510)页面访问 数据明细表格_500000006.xlsx');
const wb = XLSX.readFile(fp, { raw: false });
const rows = XLSX.utils.sheet_to_json(wb.Sheets['数据'], { defval: '', raw: false });

const parseNum = v => Number(String(v).replace(/[%,]/g, '')) || 0;

// 取「全部场景」合计行
const total = rows.filter(r =>
  r['一级场景'] === '全部' && r['二级场景'] === '全部' && r['三级场景'] === '全部'
);

const growthPages = {};
total.forEach(r => {
  if (!r['页面路径'].includes('growth')) return;
  const p = r['页面路径'];
  if (!growthPages[p]) growthPages[p] = { visits: 0, opens: 0, stay: [], entry: 0, exit: 0 };
  growthPages[p].visits += parseNum(r['访问人数']);
  growthPages[p].opens += parseNum(r['打开次数']);
  growthPages[p].stay.push(parseNum(r['人均停留时长（秒）']));
  growthPages[p].entry += parseNum(r['入口页次数']);
  growthPages[p].exit += parseNum(r['退出页次数']);
});

console.log('Growth 主题所有页面（全期累计）:');
Object.entries(growthPages).forEach(([p, v]) => {
  const avgStay = (v.stay.reduce((a, b) => a + b, 0) / v.stay.length).toFixed(1);
  console.log(`  ${p.padEnd(35)} | UV ${String(v.visits).padStart(6)} | 打开 ${String(v.opens).padStart(6)} | 停留 ${avgStay}s | 入口 ${v.entry} | 退出 ${v.exit}`);
});

// 显示全部独立页面路径（看是否有遗漏路径）
console.log('\n全部页面路径（去重，按 UV 排序）：');
const allPages = {};
total.forEach(r => {
  const p = r['页面路径'];
  allPages[p] = (allPages[p] || 0) + parseNum(r['访问人数']);
});
Object.entries(allPages)
  .sort((a, b) => b[1] - a[1])
  .forEach(([p, v]) => console.log(`  ${String(v).padStart(7)} | ${p}`));
