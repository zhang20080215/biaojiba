// node --test tools/test-poster-text.cjs
// 海报文字排版（utils/poster/text.js）：每个字宽 = 1（中英文一样），便于手算。
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const T = require(path.join(__dirname, '..', 'utils', 'poster', 'text.js'));

const m1 = s => Array.from(s).length;           // 每字宽 1
const mAt = size => s => Array.from(s).length * size / 10;

test('ellipsis：放得下原样返回，放不下以 … 结尾且不超宽', () => {
  assert.strictEqual(T.ellipsis('千与千寻', 4, m1), '千与千寻');
  assert.strictEqual(T.ellipsis('牯岭街少年杀人事件', 5, m1), '牯岭街少…');
  assert.ok(m1(T.ellipsis('牯岭街少年杀人事件', 5, m1)) <= 5);
  assert.strictEqual(T.ellipsis('', 5, m1), '');
  assert.strictEqual(T.ellipsis('abc', 0.5, m1), '…');
});

test('wrapLines：按字切行、不超过 maxLines、溢出时最后一行省略', () => {
  assert.deepStrictEqual(T.wrapLines('一二三四五六七', 3, 5, m1), ['一二三', '四五六', '七']);
  assert.deepStrictEqual(T.wrapLines('一二三四五六七', 3, 2, m1), ['一二三', '四五…']);
  assert.deepStrictEqual(T.wrapLines('一二三', 3, 1, m1), ['一二三']);
  assert.deepStrictEqual(T.wrapLines('一二三四', 3, 1, m1), ['一二…']);
  assert.deepStrictEqual(T.wrapLines('', 3, 2, m1), []);
  assert.deepStrictEqual(T.wrapLines(null, 3, 2, m1), []);
});

test('wrapLines：中英混排、多余空白合并，行首不留空格', () => {
  assert.deepStrictEqual(T.wrapLines('爱是  唯一 Love', 4, 3, m1), ['爱是 唯', '一 Lo', 've']);
  const lines = T.wrapLines('ab cd ef', 3, 5, m1);
  lines.forEach(l => assert.ok(m1(l) <= 3));
  lines.forEach(l => assert.notStrictEqual(l[0], ' '));
});

test('spacedWidth：字距只加在字与字之间', () => {
  assert.strictEqual(T.spacedWidth('MARKED', 2, m1), 6 + 2 * 5);
  assert.strictEqual(T.spacedWidth('', 2, m1), 0);
  assert.strictEqual(T.spacedWidth('A', 9, m1), 1);
});

test('drawSpaced：逐字落点正确，居中 / 右对齐以 x 为锚点，恢复 textAlign', () => {
  const calls = [];
  const ctx = { textAlign: 'center', measureText: s => ({ width: m1(s) * 10 }), fillText: (ch, x) => calls.push([ch, x]) };
  const w = T.drawSpaced(ctx, 'AB', 100, 0, 4, 'center');
  assert.strictEqual(w, 24);
  assert.deepStrictEqual(calls, [['A', 88], ['B', 102]]);
  assert.strictEqual(ctx.textAlign, 'center');
  calls.length = 0;
  T.drawSpaced(ctx, 'AB', 100, 0, 4, 'right');
  assert.deepStrictEqual(calls, [['A', 76], ['B', 90]]);
});

test('fitFontSize：取第一个不需要省略的字号，都不行取最小', () => {
  // 宽 10、2 行：字号 10 时一行 10 字，20 字刚好两行
  assert.strictEqual(T.fitFontSize('一二三四五六七八九十一二三四五六七八九十', 10, 2, [20, 15, 10], mAt), 10);
  assert.strictEqual(T.fitFontSize('千与千寻', 10, 1, [20, 15, 10], mAt), 20);
  assert.strictEqual(T.fitFontSize('一二三四五六七八九十一二三四五六七八九十一', 10, 2, [20, 15, 10], mAt), 10);
});

test('fitTitle：能一行放下就一行（取最大字号），否则均分两行、不留单字尾巴', () => {
  // 宽 9：字号 10 一行 9 字 → 「牯岭街少年杀人事件」字号 10 正好一行
  assert.deepStrictEqual(T.fitTitle('牯岭街少年杀人事件', 9, [20, 15, 10], mAt), { size: 10, lines: ['牯岭街少年杀人事件'] });
  // 宽 8：哪个字号都放不下一行 → 字号 20（一行 4 字）放不下两行，15（一行 5 字）可以，切成 5 / 4
  assert.deepStrictEqual(T.fitTitle('牯岭街少年杀人事件', 8, [20, 15, 10], mAt), { size: 15, lines: ['牯岭街少年', '杀人事件'] });
  assert.deepStrictEqual(T.fitTitle('千与千寻', 8, [20, 15, 10], mAt), { size: 20, lines: ['千与千寻'] });
  // 两行都放不下 → 最小字号按字切两行并省略
  const r = T.fitTitle('一二三四五六七八九十一二三四五', 4, [20, 10], mAt);
  assert.strictEqual(r.size, 10);
  assert.strictEqual(r.lines.length, 2);
  assert.ok(r.lines[1].endsWith('…'));
});

test('wrapLines：句末标点不放行首，挂在上一行末尾', () => {
  assert.deepStrictEqual(T.wrapLines('一二三。四五', 3, 3, m1), ['一二三。', '四五']);
  assert.deepStrictEqual(T.wrapLines('一二三」，四', 3, 3, m1), ['一二三」，', '四']);
});
