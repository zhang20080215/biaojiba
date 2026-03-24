// Script to parse PDF text and generate growthData.js
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
const fs = require('fs');

// Age label to months mapping
function ageToMonths(ageStr) {
  ageStr = ageStr.trim();
  // "0月" ~ "11月"
  let m = ageStr.match(/^(\d+)\s*月$/);
  if (m) return parseInt(m[1]);
  // "X岁" (no month)
  m = ageStr.match(/^(\d+)\s*岁$/);
  if (m) return parseInt(m[1]) * 12;
  // "X岁 Y月"
  m = ageStr.match(/^(\d+)\s*岁\s*(\d+)\s*月$/);
  if (m) return parseInt(m[1]) * 12 + parseInt(m[2]);
  return null;
}

async function extractAllPages() {
  const data = new Uint8Array(fs.readFileSync('e38068f0a62d4a1eb1bd451414444ec1.pdf'));
  const doc = await pdfjsLib.getDocument({ data }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    // Get items with position info for better parsing
    const items = content.items.map(item => ({
      text: item.str,
      x: item.transform[4],
      y: item.transform[5]
    }));
    pages.push(items);
  }
  return pages;
}

// Parse a table from raw text that has age-based rows
function parseAgeTable(text) {
  const rows = [];
  // Match patterns like "0 月 2.4 2.7 3.1 3.5 3.9 4.3 4.7"
  // or "1 岁 1 月 7.5 8.3 9.2 10.3 11.4 12.7 14.1"
  const lines = text.split('\n');

  // Try regex on the full text
  // Age patterns: "X月", "X岁", "X岁Y月"
  const regex = /(\d+\s*月|\d+\s*岁(?:\s*\d+\s*月)?)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const ageStr = match[1].replace(/\s+/g, '');
    const months = ageToMonths(ageStr);
    if (months !== null) {
      rows.push({
        ageMonths: months,
        sd: [parseFloat(match[2]), parseFloat(match[3]), parseFloat(match[4]), parseFloat(match[5]), parseFloat(match[6]), parseFloat(match[7]), parseFloat(match[8])]
      });
    }
  }
  return rows;
}

// Parse height/length-based table
function parseCmTable(text) {
  const rows = [];
  // Match: "45 1.8 2.0 2.1 2.3 2.5 2.8 3.0"
  const regex = /\b(\d{2,3})\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const cm = parseInt(match[1]);
    if (cm >= 45 && cm <= 130) {
      rows.push({
        cm: cm,
        sd: [parseFloat(match[2]), parseFloat(match[3]), parseFloat(match[4]), parseFloat(match[5]), parseFloat(match[6]), parseFloat(match[7]), parseFloat(match[8])]
      });
    }
  }
  return rows;
}

async function main() {
  const data = new Uint8Array(fs.readFileSync('e38068f0a62d4a1eb1bd451414444ec1.pdf'));
  const doc = await pdfjsLib.getDocument({ data }).promise;

  // Extract all pages as plain text
  const allText = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const text = content.items.map(item => item.str).join(' ');
    allText.push({ page: i, text });
  }

  // SD tables are in Appendix B (pages 25-41 approximately)
  // We need to identify table boundaries by looking for table headers

  const fullText = allText.map(p => `\n[PAGE${p.page}]\n${p.text}`).join('');

  // Split by table markers
  // B.1: 男童年龄别体重 (page 25-26)
  // B.2: 女童年龄别体重 (page 26-27)
  // B.3: 男童年龄别身长/身高 (page 27-28)
  // B.4: 女童年龄别身长/身高 (page 28-30)
  // B.5: 男童身长别体重 (page 30-31)
  // B.6: 女童身长别体重 (page 31-33)
  // B.7: 男童身高别体重 (page 33-35)
  // B.8: 女童身高别体重 (page 35-36)
  // B.9: 男童年龄别BMI (page 36-38)
  // B.10: 女童年龄别BMI (page 38-39)
  // B.11: 男童年龄别头围 (page 39-40)
  // B.12: 女童年龄别头围 (page 40-41)

  function getTextBetweenPages(startPage, endPage) {
    return allText
      .filter(p => p.page >= startPage && p.page <= endPage)
      .map(p => p.text)
      .join(' ');
  }

  const result = {};

  // B.1: Weight for age, male (pages 25-26)
  result.weightForAge_male = parseAgeTable(getTextBetweenPages(25, 26));
  // B.2: Weight for age, female (pages 26-27)
  result.weightForAge_female = parseAgeTable(getTextBetweenPages(26, 27));

  // There's overlap - need to deduplicate by filtering
  // B.2 starts at page 26, but page 26 also has end of B.1
  // Let's be smarter - extract each table individually

  // Actually let me try a different approach - extract ALL age-based data from pages 25-41
  // and separate by table based on known value ranges and context

  // Better: parse page by page and use table headers to identify which table

  // Let me output raw parsed data per page range and manually verify

  console.log('=== B.1 男童年龄别体重 (pages 25-26) ===');
  let t = parseAgeTable(getTextBetweenPages(25, 26));
  // Remove duplicates that belong to B.2 (female starts with smaller values)
  // B.1 has 0月=2.4,2.7,3.1,3.5,...  B.2 has 0月=2.3,2.6,3.0,3.3,...
  // Keep only rows before the second occurrence of age 0
  let seen0 = 0;
  let b1 = [];
  for (const row of t) {
    if (row.ageMonths === 0) seen0++;
    if (seen0 > 1) break;
    b1.push(row);
  }
  result.weightForAge_male = b1;
  console.log(`Rows: ${b1.length}, first: age=${b1[0]?.ageMonths}, last: age=${b1[b1.length-1]?.ageMonths}`);

  // B.2: starts at second 0月 on page 26
  console.log('=== B.2 女童年龄别体重 (pages 26-27) ===');
  t = parseAgeTable(getTextBetweenPages(26, 27));
  // Find where female data starts (second set starting from 0)
  let b2Start = -1;
  seen0 = 0;
  for (let i = 0; i < t.length; i++) {
    if (t[i].ageMonths === 0) seen0++;
    if (seen0 === 2) { b2Start = i; break; }
  }
  if (b2Start === -1) {
    // Maybe it's at page 26-27 all female
    // The first 0月 on these pages is still B.1's tail, let's try differently
    // Female data: 0月 = 2.3, 2.6, 3.0, 3.3, ...
    b2Start = t.findIndex(r => r.ageMonths === 0 && r.sd[0] === 2.3);
    if (b2Start === -1) b2Start = 0;
  }
  let secondSeen0 = 0;
  let b2 = [];
  for (let i = b2Start; i < t.length; i++) {
    if (t[i].ageMonths === 0 && b2.length > 0) break; // hit next table
    b2.push(t[i]);
  }
  // Actually this approach is getting messy. Let me try a cleaner approach.
  // Parse each page individually and concatenate based on table context.

  // CLEANER APPROACH: Parse all pages, concatenate text, split by known table boundaries
  // Table B.x headers contain unique identifiers

  const sections = [];
  const tablePatterns = [
    { id: 'B1', name: 'weightForAge_male', regex: /表\s*B\.?1[\s\S]*?男童年龄别体重/, type: 'age', startAfter: '表   B.1' },
    { id: 'B2', name: 'weightForAge_female', regex: /表\s*B\.?2[\s\S]*?女童年龄别体重/, type: 'age' },
    { id: 'B3', name: 'heightForAge_male', regex: /表\s*B\.?3[\s\S]*?男童年龄别身长/, type: 'age' },
    { id: 'B4', name: 'heightForAge_female', regex: /表\s*B\.?4[\s\S]*?女童年龄别身长/, type: 'age' },
    { id: 'B5', name: 'weightForLength_male', regex: /表\s*B\.?5[\s\S]*?男童身长别体重/, type: 'cm' },
    { id: 'B6', name: 'weightForLength_female', regex: /表\s*B\.?6[\s\S]*?女童身长别体重/, type: 'cm' },
    { id: 'B7', name: 'weightForHeight_male', regex: /表\s*B\.?7[\s\S]*?男童身高别体重/, type: 'cm' },
    { id: 'B8', name: 'weightForHeight_female', regex: /表\s*B\.?8[\s\S]*?女童身高别体重/, type: 'cm' },
    { id: 'B9', name: 'bmiForAge_male', regex: /表\s*B\.?9[\s\S]*?男童年龄别.*?BMI/, type: 'age' },
    { id: 'B10', name: 'bmiForAge_female', regex: /表\s*B\.?10[\s\S]*?女童年龄别.*?BMI/, type: 'age' },
    { id: 'B11', name: 'headCircForAge_male', regex: /表\s*B\.?11[\s\S]*?男童年龄别.*?头围/, type: 'age' },
    { id: 'B12', name: 'headCircForAge_female', regex: /表\s*B\.?12[\s\S]*?女童年龄别.*?头围/, type: 'age' },
  ];

  // Page ranges for each SD table (from manual inspection)
  const tableConfig = [
    { id: 'B1', name: 'weightForAge_male', pages: [25, 26], type: 'age', firstVal: 2.4 },
    { id: 'B2', name: 'weightForAge_female', pages: [26, 27], type: 'age', firstVal: 2.3 },
    { id: 'B3', name: 'heightForAge_male', pages: [27, 28], type: 'age', firstVal: 45.4 },
    { id: 'B4', name: 'heightForAge_female', pages: [28, 30], type: 'age', firstVal: 44.7 },
    { id: 'B5', name: 'weightForLength_male', pages: [30, 31], type: 'cm', firstVal: 1.8 },
    { id: 'B6', name: 'weightForLength_female', pages: [31, 33], type: 'cm', firstVal: 1.8 },
    { id: 'B7', name: 'weightForHeight_male', pages: [33, 35], type: 'cm', firstVal: 7.9 },
    { id: 'B8', name: 'weightForHeight_female', pages: [35, 36], type: 'cm', firstVal: 7.7 },
    { id: 'B9', name: 'bmiForAge_male', pages: [36, 38], type: 'age', firstVal: 10.2 },
    { id: 'B10', name: 'bmiForAge_female', pages: [38, 39], type: 'age', firstVal: 10.0 },
    { id: 'B11', name: 'headCircForAge_male', pages: [39, 40], type: 'age', firstVal: 30.4 },
    { id: 'B12', name: 'headCircForAge_female', pages: [40, 41], type: 'age', firstVal: 30.1 },
  ];

  const finalData = {};

  for (const tc of tableConfig) {
    const text = getTextBetweenPages(tc.pages[0], tc.pages[1]);
    let allRows;
    if (tc.type === 'age') {
      allRows = parseAgeTable(text);
    } else {
      allRows = parseCmTable(text);
    }

    // Find our table's start by matching the first -3SD value
    let startIdx = allRows.findIndex(r => Math.abs(r.sd[0] - tc.firstVal) < 0.01);
    if (startIdx === -1) startIdx = 0;

    // Find end: detect when the key sequence breaks (drops significantly)
    let endIdx = allRows.length;
    for (let i = startIdx + 1; i < allRows.length; i++) {
      const key = tc.type === 'age' ? allRows[i].ageMonths : allRows[i].cm;
      const prevKey = tc.type === 'age' ? allRows[i-1].ageMonths : allRows[i-1].cm;
      // If key drops significantly, it's a new table
      if (key < prevKey - 2) {
        endIdx = i;
        break;
      }
    }

    const rows = allRows.slice(startIdx, endIdx);
    finalData[tc.name] = rows;

    const keyName = tc.type === 'age' ? 'ageMonths' : 'cm';
    console.log(`${tc.id} (${tc.name}): ${rows.length} rows`);
    if (rows.length > 0) {
      console.log(`  First: ${keyName}=${rows[0][keyName]}, sd=${rows[0].sd.join(',')}`);
      console.log(`  Last: ${keyName}=${rows[rows.length-1][keyName]}, sd=${rows[rows.length-1].sd.join(',')}`);
    }
  }

  // Generate the growthData.js content
  function formatRows(rows, keyName) {
    return rows.map(r => {
      const key = r[keyName];
      const [s3n, s2n, s1n, med, s1p, s2p, s3p] = r.sd;
      return `  [${key}, ${s3n}, ${s2n}, ${s1n}, ${med}, ${s1p}, ${s2p}, ${s3p}]`;
    }).join(',\n');
  }

  let js = `// Auto-generated from WS/T 423-2022 《7岁以下儿童生长标准》附录B
// Each row: [key, -3SD, -2SD, -1SD, median, +1SD, +2SD, +3SD]
// Age tables: key = months (0-81)
// Height/Length tables: key = cm (45-130)

module.exports = {
  // B.1 男童年龄别体重 (kg)
  weightForAge: {
    male: [\n${formatRows(finalData.weightForAge_male, 'ageMonths')}\n    ],
    female: [\n${formatRows(finalData.weightForAge_female, 'ageMonths')}\n    ]
  },
  // B.3/B.4 年龄别身长/身高 (cm)
  heightForAge: {
    male: [\n${formatRows(finalData.heightForAge_male, 'ageMonths')}\n    ],
    female: [\n${formatRows(finalData.heightForAge_female, 'ageMonths')}\n    ]
  },
  // B.5/B.6 身长别体重 0~2岁 (kg, key=cm)
  weightForLength: {
    male: [\n${formatRows(finalData.weightForLength_male, 'cm')}\n    ],
    female: [\n${formatRows(finalData.weightForLength_female, 'cm')}\n    ]
  },
  // B.7/B.8 身高别体重 2~7岁 (kg, key=cm)
  weightForHeight: {
    male: [\n${formatRows(finalData.weightForHeight_male, 'cm')}\n    ],
    female: [\n${formatRows(finalData.weightForHeight_female, 'cm')}\n    ]
  },
  // B.9/B.10 年龄别BMI (kg/m²)
  bmiForAge: {
    male: [\n${formatRows(finalData.bmiForAge_male, 'ageMonths')}\n    ],
    female: [\n${formatRows(finalData.bmiForAge_female, 'ageMonths')}\n    ]
  },
  // B.11/B.12 年龄别头围 0~3岁 (cm)
  headCircForAge: {
    male: [\n${formatRows(finalData.headCircForAge_male, 'ageMonths')}\n    ],
    female: [\n${formatRows(finalData.headCircForAge_female, 'ageMonths')}\n    ]
  }
};
`;

  fs.writeFileSync('../utils/growthData.js', js);
  console.log('\n✅ growthData.js generated successfully!');
}

main().catch(e => console.error(e));
