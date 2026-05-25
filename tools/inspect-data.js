// 检查 data-raw/ 下所有 xlsx / csv 文件的结构（sheet 名 + 列头 + 前 3 行示例）
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');

const DATA_DIR = path.resolve(__dirname, '..', 'data-raw');
const files = fs.readdirSync(DATA_DIR)
  .filter(f => /\.(xlsx|csv)$/i.test(f));

console.log('=== 共发现', files.length, '个数据文件 ===\n');

for (const f of files) {
  const fp = path.join(DATA_DIR, f);
  console.log('───────────────────────────────────────');
  console.log('📄', f);
  try {
    const wb = XLSX.readFile(fp, { cellDates: true, raw: false });
    for (const sheetName of wb.SheetNames) {
      const ws = wb.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false });
      console.log(`  📋 Sheet「${sheetName}」: ${rows.length} 行`);
      if (rows.length > 0) {
        console.log('     列头:', Object.keys(rows[0]).join(' | '));
        console.log('     前 3 行示例:');
        rows.slice(0, 3).forEach((r, i) => console.log(`       [${i}]`, JSON.stringify(r)));
      }
    }
  } catch (err) {
    console.error('  ❌ 读取失败:', err.message);
  }
  console.log('');
}
