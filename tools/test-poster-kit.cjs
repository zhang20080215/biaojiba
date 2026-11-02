// node --test tools/test-poster-kit.cjs
// 海报基础模块里能离开真机测的部分：裁切、伪随机、条形码、票根路径、提亮、平均色、版式注册表。
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const dir = path.join(__dirname, '..', 'utils', 'poster');
const kit = require(path.join(dir, 'kit.js'));
const tint = require(path.join(dir, 'tint.js'));
const reg = require(path.join(dir, 'index.js'));
const tokens = require(path.join(dir, 'tokens.js'));

// 记录调用的假 ctx
function fakeCtx() {
  const calls = [];
  const ctx = new Proxy({ calls }, {
    get(t, k) {
      if (k in t) return t[k];
      return (...args) => { calls.push([k, ...args]); return { width: 10 }; };
    },
    set(t, k, v) { t[k] = v; return true; }
  });
  return ctx;
}

test('coverCrop：竖封面裁进横框取中间，focusY 控制上下', () => {
  assert.deepStrictEqual(kit.coverCrop(1000, 1500, 200, 100), [0, 500, 1000, 500]);
  assert.deepStrictEqual(kit.coverCrop(1000, 1500, 200, 100, 0), [0, 0, 1000, 500]);
  assert.deepStrictEqual(kit.coverCrop(1000, 1500, 100, 300), [250, 0, 500, 1500]);
});

test('seeded：同一 seed 序列相同，不同 seed 不同', () => {
  const a = kit.seeded('2026-10-18'), b = kit.seeded('2026-10-18'), c = kit.seeded('2026-10-19');
  const sa = [a(), a(), a()], sb = [b(), b(), b()], sc = [c(), c(), c()];
  assert.deepStrictEqual(sa, sb);
  assert.notDeepStrictEqual(sa, sc);
  sa.forEach(v => assert.ok(v >= 0 && v < 1));
});

test('barcode：同一 seed 画出一样的条，返回总宽', () => {
  const c1 = fakeCtx(), c2 = fakeCtx();
  const w1 = kit.barcode(c1, 0, 0, 60, 'x', 3, 19);
  const w2 = kit.barcode(c2, 0, 0, 60, 'x', 3, 19);
  assert.strictEqual(w1, w2);
  assert.deepStrictEqual(c1.calls, c2.calls);
  assert.strictEqual(c1.calls.filter(c => c[0] === 'fillRect').length, 19);
});

test('ticketPath：两侧各一段向内的半圆（逆时针），路径闭合', () => {
  const c = fakeCtx();
  kit.ticketPath(c, 0, 0, 800, 1200, 36, 1000, 26);
  const arcs = c.calls.filter(x => x[0] === 'arc');
  assert.strictEqual(arcs.length, 2);
  assert.deepStrictEqual(arcs[0].slice(1), [800, 1000, 26, -Math.PI / 2, Math.PI / 2, true]);
  assert.deepStrictEqual(arcs[1].slice(1), [0, 1000, 26, Math.PI / 2, -Math.PI / 2, true]);
  assert.strictEqual(c.calls[c.calls.length - 1][0], 'closePath');
});

test('receiptPath：上下锯齿数 = 宽 / 齿宽', () => {
  const c = fakeCtx();
  kit.receiptPath(c, 0, 0, 100, 300, 10);
  // 每个齿 2 个 lineTo，上下各 10 齿，外加两条直边
  assert.strictEqual(c.calls.filter(x => x[0] === 'lineTo').length, 10 * 2 * 2 + 1);
});

test('brighten：暗色提亮到目标亮度，亮色原样', () => {
  assert.strictEqual(tint.brighten({ r: 250, g: 250, b: 250 }, 0.7), 'rgb(250,250,250)');
  const out = tint.brighten({ r: 60, g: 30, b: 20 }, 0.7);
  const [r, g, b] = out.match(/\d+/g).map(Number);
  const l = (Math.max(r, g, b) + Math.min(r, g, b)) / 2 / 255;
  assert.ok(Math.abs(l - 0.7) < 0.02, '亮度 ≈ 0.7，实际 ' + l);
  assert.ok(r > g && g > b, '色相不变');
  assert.strictEqual(tint.brighten(null), null);
});

test('averageOf：平均色与亮度；getImageData 抛错返回 null', () => {
  const data = [255, 0, 0, 255, 0, 0, 255, 255];
  const avg = tint.averageOf({ getImageData: () => ({ data }) }, 2, 1);
  assert.deepStrictEqual([avg.r, avg.g, avg.b], [128, 0, 128]);
  assert.ok(avg.lum > 0 && avg.lum < 1);
  assert.strictEqual(tint.averageOf({ getImageData: () => { throw new Error('x'); } }, 1, 1), null);
});

test('版式注册表：没有模块时只剩经典；登记模块后按规划顺序出现、默认值生效', () => {
  const saved = Object.assign({}, reg.MODULES);
  Object.keys(reg.MODULES).forEach(k => delete reg.MODULES[k]);
  try {
    registryCases();
  } finally {
    Object.keys(reg.MODULES).forEach(k => delete reg.MODULES[k]);
    Object.assign(reg.MODULES, saved);
  }
});

test('已登记的版式都实现了 supports / measure / draw，且 measure 在空数据下也给出尺寸', () => {
  const model = require(path.join(dir, 'model.js'));
  const empty = { single: model.fromDailySingle({}), range: model.fromDailyRange([], { mode: 'month', year: 2026, month: 1 }), ranking: model.fromRanking([], {}) };
  Object.keys(reg.MODULES).forEach(id => {
    const m = reg.MODULES[id];
    ['supports', 'measure', 'draw'].forEach(fn => assert.strictEqual(typeof m[fn], 'function', `${id}.${fn}`));
    Object.keys(empty).filter(k => m.supports(k)).forEach(k => {
      const size = m.measure(empty[k]);
      assert.ok(size.width === 1080 && size.height >= 1440, `${id}/${k} 尺寸 ${JSON.stringify(size)}`);
    });
  });
});

function registryCases() {
  assert.deepStrictEqual(reg.available('single'), ['classic']);
  assert.strictEqual(reg.defaultFor('single'), 'classic');
  assert.strictEqual(reg.resolve('single', 'ticket', 'classic'), 'classic');

  const fake = (kinds) => ({ supports: k => kinds.indexOf(k) >= 0 });
  reg.MODULES.ticket = fake(['single', 'range']);
  reg.MODULES.magazine = fake(['single', 'range', 'ranking']);
  try {
    assert.deepStrictEqual(reg.available('single'), ['ticket', 'magazine', 'classic']);
    assert.deepStrictEqual(reg.available('range'), ['magazine', 'ticket', 'classic']);
    assert.strictEqual(reg.defaultFor('single'), 'ticket');
    assert.strictEqual(reg.defaultFor('range', 'month'), 'magazine', '清单还没做，退到第一个可用的');
    assert.strictEqual(reg.defaultFor('range', 'year'), 'magazine');
    assert.strictEqual(reg.defaultFor('ranking', 'text'), 'magazine');
    assert.strictEqual(reg.resolve('single', 'magazine', 'ticket'), 'magazine');
    assert.strictEqual(reg.resolve('single', 'film', 'ticket'), 'ticket');
    assert.deepStrictEqual(reg.options('ranking'), [{ id: 'magazine', name: '杂志' }, { id: 'classic', name: '经典' }]);
  } finally {
    delete reg.MODULES.ticket;
    delete reg.MODULES.magazine;
  }
}

test('tokens：字体串；Inter 没加载时不出现 PosterNum', () => {
  assert.strictEqual(tokens.cn(700, 33.6), '700 34px "PingFang SC", "Noto Sans SC", "Microsoft YaHei", sans-serif');
  assert.ok(tokens.num(800, 300, true).indexOf('"PosterNum"') > 0);
  assert.ok(tokens.num(800, 300, false).indexOf('PosterNum') < 0);
});
