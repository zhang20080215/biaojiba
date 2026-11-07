// node --test tools/test-poster-range.cjs
// 范围海报：model 的新字段、票夹和小票的数量上限 / 尺寸，以及各种缺数据组合下 draw 不抛错。
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const dir = path.join(__dirname, '..', 'utils', 'poster');
const M = require(path.join(dir, 'model.js'));
const reg = require(path.join(dir, 'index.js'));
const tickets = require(path.join(dir, 'layouts', 'rangeTickets.js'));
const statement = require(path.join(dir, 'layouts', 'rangeStatement.js'));

const RANGE_IDS = ['tickets', 'statement'];

function entry(i, extra) {
  const day = String(1 + (i % 28)).padStart(2, '0');
  const month = String(1 + Math.floor(i / 28) % 12).padStart(2, '0');
  return Object.assign({ date: `2026-${month}-${day}`, ts: i + 1, title: `片${i}`, year: '2000', director: `导演${i}`, rating: 1 + (i % 5) }, extra || {});
}
const entries = n => Array.from({ length: n }, (_, i) => entry(i));
const yearModel = (list, extra) => M.fromDailyRange(list, Object.assign({ mode: 'year', year: 2026 }, extra || {}));
const monthModel = (list, extra) => M.fromDailyRange(list, Object.assign({ mode: 'month', year: 2026, month: 10 }, extra || {}));

// 假 ctx：什么都不画，只保证调用不抛错；字宽 = 字数 × 字号
function fakeCtx() {
  const state = { font: '10px x' };
  return new Proxy(state, {
    get(t, k) {
      if (k === 'measureText') return s => ({ width: Array.from(String(s)).length * parseInt(/(\d+)px/.exec(t.font)[1], 10) });
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop() {} });
      if (k in t) return t[k];
      return () => {};
    },
    set(t, k, v) { t[k] = v; return true; }
  });
}

test('fromDailyRange：标题件、起止日期，不出现「年度」', () => {
  assert.strictEqual(monthModel(entries(3)).ymDot, '2026.10');
  const y = yearModel(entries(40));
  assert.strictEqual(y.ymDot, '2026');
  assert.strictEqual(y.spanText, '2026.01.01 — 02.12');
  assert.ok(!JSON.stringify([y.periodSub, y.title]).includes('年度'));
});

test('topPicks：星级高的优先、同分取早的，选完按时间排；不够就原样', () => {
  const films = [{ key: 'a', rating: 3 }, { key: 'b', rating: 5 }, { key: 'c', rating: 5 }, { key: 'd', rating: 4 }];
  assert.deepStrictEqual(M.topPicks(films, 3).map(f => f.key), ['b', 'c', 'd']);
  assert.strictEqual(M.topPicks(films, 9), films);
});

test('注册表：范围版式的顺序和默认值', () => {
  assert.deepStrictEqual(reg.available('range'), RANGE_IDS.concat('classic'));
  assert.strictEqual(reg.defaultFor('range', 'month'), 'tickets');
  assert.strictEqual(reg.defaultFor('range', 'year'), 'tickets');
  assert.strictEqual(reg.resolve('range', 'agenda', ''), '', '存过的旧 id 不认');
});

test('月度 12 部：两个版式都正好 3:4（不靠长图）', () => {
  const m = monthModel(entries(12));
  RANGE_IDS.forEach(id => {
    assert.deepStrictEqual(reg.get(id).measure(m), { width: 1080, height: 1440 }, id);
  });
});

test('数量上限：放不下时挑片，长图高度不超过 6000', () => {
  const m = yearModel(entries(300));
  assert.strictEqual(tickets.coverFilms(m).length, tickets.MAX_TICKETS);
  assert.deepStrictEqual(statement.coverFilms(m), [], '小票是纯色底，不要封面');
  assert.strictEqual(statement.layout(m).more, 300 - statement.MAX_ROWS);
  RANGE_IDS.forEach(id => {
    const h = reg.get(id).measure(m).height;
    assert.ok(h <= 6000, `${id} 高 ${h}`);
  });
});

test('各种数据组合 draw 都不抛错', () => {
  const cases = {
    '1 部': monthModel(entries(1)),
    '2 部': monthModel(entries(2)),
    '3 部': monthModel(entries(3)),
    '9 部': monthModel(entries(9)),
    '12 部': monthModel(entries(12)),
    '300 部': yearModel(entries(300)),
    '全未评分': monthModel(entries(5).map(e => Object.assign(e, { rating: 0 }))),
    '无片名': monthModel(entries(4).map(e => Object.assign(e, { title: '', director: '', year: '' }))),
    '自定义标题': monthModel(entries(5), { customTitle: '这是一个足足有二十个字的自定义海报标题呀' })
  };
  Object.keys(cases).forEach(name => {
    RANGE_IDS.forEach(id => {
      assert.doesNotThrow(() => reg.get(id).draw(fakeCtx(), cases[name], {}, { s: 1 }), `${id} / ${name}`);
    });
  });
});

test('inkEdge：字心保持实色，远处保持透明，边缘外扩时用字的颜色', () => {
  const kit = require(path.join(dir, 'kit.js'));
  const w = 30, h = 30, data = new Uint8ClampedArray(w * h * 4);
  for (let y = 10; y < 20; y++) {
    for (let x = 10; x < 20; x++) {
      const q = (y * w + x) * 4;
      data[q] = 200; data[q + 1] = 40; data[q + 2] = 90; data[q + 3] = 255;
    }
  }
  const before = data.slice();
  let put = 0;
  const ctx = { getImageData: () => ({ data }), putImageData() { put++; } };
  assert.strictEqual(kit.inkEdge(ctx, 0, 0, w, h, 's', { radius: 2, strength: 0.6, threshold: 0.36 }), true);
  assert.strictEqual(put, 1);
  const at = (x, y, c) => data[(y * w + x) * 4 + c];
  assert.strictEqual(at(15, 15, 3), 255, '字心');
  assert.strictEqual(at(0, 0, 3), 0, '远处');
  let changed = 0, grown = 0;
  for (let q = 3; q < data.length; q += 4) {
    if (data[q] !== before[q]) changed++;
    if (data[q] > 0 && !before[q]) {
      grown++;
      assert.ok(Math.abs(data[q - 3] - 200) <= 1 && Math.abs(data[q - 2] - 40) <= 1, '外扩的像素用字的颜色');
    }
  }
  assert.ok(changed > 20, `边缘要真的变，实际变了 ${changed} 个像素`);
  assert.ok(grown > 0, '字要往外长');
  assert.strictEqual(kit.inkEdge({ getImageData() { throw new Error('x'); } }, 0, 0, 1, 1, 's'), false, '不支持时不报错');
});

test('小票每套配色都画得出，分享页的选项和配色表对得上', () => {
  const m = monthModel(entries(12));
  assert.strictEqual(statement.PALETTE_LIST.length, Object.keys(statement.PALETTE).length);
  assert.ok(statement.PALETTE[statement.DEFAULT_PALETTE]);
  statement.PALETTE_LIST.forEach(p => {
    assert.doesNotThrow(() => tickets.draw(fakeCtx(), m, {}, { s: 1, palette: p.id }), `票夹 ${p.id}`);
    assert.ok(p.swatch.indexOf('linear-gradient') === 0, p.id);
    [false, true].forEach(inked => {
      assert.doesNotThrow(() => statement.draw(fakeCtx(), m, {}, { s: 1, palette: p.id, inked }), `${p.id} 油墨${inked}`);
    });
    assert.ok(/^rgb\(/.test(statement.PALETTE[p.id].softSolid), '油墨字的浅色要不透明');
  });
  assert.doesNotThrow(() => statement.draw(fakeCtx(), m, {}, { s: 1, palette: '不存在' }), '存过的旧配色退回默认');
});

test('经典：四种排法、五套配色、电影和读书都画得出，整体版式固定 3:4', () => {
  const Movie = require(path.join(__dirname, '..', 'utils', 'moviePosterDrawer.js'));
  const Book = require(path.join(__dirname, '..', 'utils', 'bookPosterDrawer.js'));
  const list = n => entries(n).map((e, i) => Object.assign(e, { key: `k${i}`, dateLabel: '10月1日' }));
  assert.deepStrictEqual(Movie.THEMES.map(t => t.id), statement.PALETTE_LIST.map(t => t.id));
  [2, 3, 4, 12, 13, 31, 60, 97, 300].forEach(n => {
    const size = Movie.computeSize(n);
    assert.strictEqual(Math.round(size.height / size.width * 3), 4, `${n} 部`);
    [Movie, Book].forEach(D => ['whole', 'month', 'rating', 'calendar'].forEach(layout => {
      const movies = list(n);
      const s = layout === 'whole' ? D.computeSize(n) : D.computeLayoutSize(layout, movies);
      Movie.THEMES.forEach(t => {
        assert.doesNotThrow(() => new D({}, fakeCtx(), s.width, s.height).draw({ movies, periodLead: '2026年10月', totalCount: n }, {}, t.id, layout), `${layout} ${n} ${t.id}`);
      });
    }));
  });
  assert.strictEqual(Movie.computeSize(12).cols, 4, '12 部排 4×3，不能 6×2 留一大片空');
  assert.doesNotThrow(() => new Movie({}, fakeCtx(), 1242, 1660).draw({ movies: [], periodLead: '2026年10月' }, {}, '老配色id', 'whole'), '空态 + 存过的旧配色');
  const oct = list(12).map((e, i) => Object.assign(e, { date: `2026-10-${String(i + 1).padStart(2, '0')}` }));
  assert.strictEqual(Movie.computeLayoutSize('calendar', oct).height, 2080, '5 行的月份日历正好 3:4');
});

test('油墨字只有小票有：票夹传了 inked 也不压字', () => {
  const m = monthModel(entries(12));
  let reads = 0;
  const spy = () => { const c = fakeCtx(); c.getImageData = () => { reads++; throw new Error('x'); }; return c; };
  tickets.draw(spy(), m, {}, { s: 1, inked: true });
  assert.strictEqual(reads, 0);
});

test('票夹：固定 3:4，放得下，张数越多票越小，3 部以内不铺满', () => {
  [1, 2, 3, 12, 20, 31, 60].forEach(n => {
    const g = tickets.geometry(n, 1040);
    assert.ok(g.gridW <= 936, `${n} 张宽 ${g.gridW}`);
    assert.ok(g.gridH <= 1040, `${n} 张高 ${g.gridH}`);
    assert.ok(g.cols * g.rows >= n);
  });
  assert.ok(tickets.geometry(3, 1040).w > tickets.geometry(12, 1040).w);
  assert.ok(tickets.geometry(12, 1040).w > tickets.geometry(31, 1040).w);
  assert.deepStrictEqual(tickets.measure(), { width: 1080, height: 1440 });
});
