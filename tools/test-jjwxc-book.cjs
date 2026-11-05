// node --test tools/test-jjwxc-book.cjs
// 依赖 cloudfunctions/jjwxcBook/node_modules（先在该目录 npm install）。
// 样本页在 tools/fixtures/jjwxc/：2026-11-03 从 jjwxc.net 存下来后去掉脚本、章节行只留 3 行的精简版（已转 UTF-8）。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const parse = require(path.join(root, 'cloudfunctions', 'jjwxcBook', 'parse.js'));
const fx = name => fs.readFileSync(path.join(__dirname, 'fixtures', 'jjwxc', name), 'utf8');

test('GBK 百分号编码', () => {
  assert.strictEqual(parse.encodeGbkQuery('天官赐福'), '%CC%EC%B9%D9%B4%CD%B8%A3');
  assert.strictEqual(parse.encodeGbkQuery('abc 12'), 'abc%2012');
});

test('gb18030 解码', () => {
  const iconv = require(path.join(root, 'cloudfunctions', 'jjwxcBook', 'node_modules', 'iconv-lite'));
  assert.strictEqual(parse.decodeBody(iconv.encode('晋江文学城', 'gbk')), '晋江文学城');
});

test('搜索页：解析候选，不带简介', () => {
  const list = parse.parseSearch(fx('search.html'));
  // 样本页前 3 条里第 2 条（10256636）是「随笔」，被过滤
  assert.deepStrictEqual(list.map(x => x.novelId), ['3200611', '9893361']);
  const first = list[0];
  assert.strictEqual(first.novelId, '3200611');
  assert.strictEqual(first.doubanId, 'jj_3200611');
  assert.strictEqual(first.source, 'jjwxc');
  assert.strictEqual(first.title, '天官赐福');
  assert.strictEqual(first.author, '墨香铜臭');
  assert.strictEqual(first.finished, true);
  assert.strictEqual(first.serialText, '完结');
  assert.ok(first.novelType.startsWith('原创-纯爱'));
  assert.strictEqual(first.posterUrl, '');
  assert.ok(!('intro' in first));
  assert.strictEqual(new Set(list.map(x => x.novelId)).size, list.length);
});

test('搜索页：滤掉评论 / 随笔 / 诗歌，保留原创与同人', () => {
  assert.strictEqual(parse.isNonNovel('评论'), true);
  assert.strictEqual(parse.isNonNovel('随笔'), true);
  assert.strictEqual(parse.isNonNovel('诗歌'), true);
  assert.strictEqual(parse.isNonNovel('原创-纯爱-架空历史-爱情'), false);
  assert.strictEqual(parse.isNonNovel('衍生-纯爱-架空历史-其他衍生'), false);
  assert.strictEqual(parse.isNonNovel(''), false);

  const block = (id, title, type) =>
    `<div><h3 class="title"><a href="http://www.jjwxc.net/onebook.php?novelid=${id}">${title}</a></h3>` +
    `<div class="info">作者： <a>某人</a> ┃ 进度：<font>连载</font> ┃ 文章类型：${type} ┃ 主角：甲</div></div>`;
  const html = '<html><body>' + block(1, '天官赐福', '原创-纯爱-架空历史-爱情') + block(2, '评《天官赐福》', '评论') +
    block(3, '天官赐福同人', '衍生-纯爱-架空历史-其他衍生') + block(4, '《天官赐福》感想', '随笔') +
    block(5, '天官赐福·双生', '诗歌') + '</body></html>';
  assert.deepStrictEqual(parse.parseSearch(html).map(x => x.novelId), ['1', '3']);
});

test('搜索页：共找到 N 篇 / 空结果 / 被拦', () => {
  assert.ok(parse.searchTotal(fx('search.html')) > 0);
  const empty = fx('search-empty.html');
  assert.strictEqual(parse.searchTotal(empty), 0);
  assert.deepStrictEqual(parse.parseSearch(empty), []);
  assert.strictEqual(parse.searchTotal(fx('detail-blocked.html')), null);
});

test('详情页：字数 / 章节 / 收藏 / 封面 / 简介', () => {
  const d = parse.parseDetail(fx('detail.html'));
  assert.ok(d);
  assert.strictEqual(d.title, '天官赐福');
  assert.strictEqual(d.author, '墨香铜臭');
  assert.strictEqual(d.finished, true);
  assert.strictEqual(d.wordCount, 1093267);   // 取全文字数，而不是章节行里的 2439
  assert.strictEqual(d.chapterCount, 3);      // 样本只留了 3 行章节
  assert.strictEqual(d.collectedCount, 3410213);
  assert.strictEqual(d.scoreCount, 77280264192);
  assert.ok(d.novelType.startsWith('原创-纯爱'));
  assert.match(d.coverUrl, /^https:\/\/.+\.jpg$/);
  assert.ok(d.intro.includes('为你，所向披靡'));
  assert.ok(!/<br|<div/i.test(d.intro));
  assert.ok(d.intro.length <= 2000);
  assert.strictEqual(d.lastUpdate, '2026-09-23 02:12:58');
});

test('详情页：被拦 / 空页返回 null', () => {
  assert.strictEqual(parse.parseDetail(fx('detail-blocked.html')), null);
  assert.strictEqual(parse.parseDetail(''), null);
});

test('cleanIntro 截断到 2000 字', () => {
  assert.strictEqual(parse.cleanIntro('字'.repeat(3000)).length, 2000);
});

// ---- 每日读书前端：进度单位 ----
function loadReadCommon() {
  global.wx = { getWindowInfo: () => ({}), getSystemInfoSync: () => ({}), getStorageSync: () => '' };
  return require(path.join(root, 'pages', 'daily', 'read', 'common.js'));
}

test('进度单位：晋江书「章」，豆瓣老记录默认「页」', () => {
  const { normalizeBookEntry } = loadReadCommon();
  const jj = normalizeBookEntry({ ts: 1, meta: {
    doubanId: 'jj_3200611', source: 'jjwxc', title: '天官赐福', totalPages: 252, currentPage: 12, progressUnit: '章', readDays: 3
  } }, '2026-11-03');
  assert.strictEqual(jj.progressLabel, '已读 12/252 章');
  assert.strictEqual(jj.progressLine, '已读 12/252 章 · 已读 3 天');
  assert.strictEqual(jj.progressPct, 5);
  assert.strictEqual(jj.source, 'jjwxc');
  assert.strictEqual(jj.doubanId, 'jj_3200611');
  assert.deepStrictEqual(jj.platformRatings, []);   // 晋江没有评分快照

  const old = normalizeBookEntry({ ts: 2, meta: { doubanId: '1044547', title: '射雕英雄传', totalPages: 362, currentPage: 120 } }, '2026-11-03');
  assert.strictEqual(old.progressLabel, '已读 120/362 页');
  assert.strictEqual(old.source, '');

  const noTotal = normalizeBookEntry({ ts: 3, meta: { doubanId: 'jj_1', progressUnit: '章', currentPage: 5 } }, '2026-11-03');
  assert.strictEqual(noTotal.progressLabel, '已读 5 章');
});

test('继续阅读：连载中的晋江书读到最新章也留着，完结 / 豆瓣 / 太久没动静的不留', () => {
  const { isWaitingUpdate, WAIT_UPDATE_DAYS } = loadReadCommon();
  const now = Date.UTC(2026, 10, 3);
  const day = 86400000;
  const jj = { doubanId: 'jj_1', source: 'jjwxc', finished: false };
  assert.strictEqual(isWaitingUpdate(jj, 180, 180, now - 3 * day, now), true);
  assert.strictEqual(isWaitingUpdate(jj, 120, 180, now, now), false);               // 没读到最新：走原来的「未读完」，不算等更新
  assert.strictEqual(isWaitingUpdate({ ...jj, finished: true }, 180, 180, now, now), false);   // 记录时已完结
  assert.strictEqual(isWaitingUpdate({ doubanId: '1044547' }, 362, 362, now, now), false);      // 豆瓣书读完就是读完
  assert.strictEqual(isWaitingUpdate(jj, 180, 180, now - (WAIT_UPDATE_DAYS + 1) * day, now), false);
  assert.strictEqual(isWaitingUpdate(jj, 180, 180, now - WAIT_UPDATE_DAYS * day, now), true);
  assert.strictEqual(isWaitingUpdate(jj, 0, 180, now, now), false);                 // 还没读过
  assert.strictEqual(isWaitingUpdate({ doubanId: 'jj_2' }, 5, 5, now, now), true);  // 只靠 jj_ 前缀也认（老记录没 source）
});

test('suggestReadDays 对 jj_ id 照常归并', () => {
  const { suggestReadDays } = loadReadCommon();
  const days = [{ date: '2026-11-01', entries: [{ ts: 1, meta: { doubanId: 'jj_9', readDays: 2 } }] }];
  assert.strictEqual(suggestReadDays(days, 'jj_9', '2026-11-02'), 3);
  assert.strictEqual(suggestReadDays(days, 'jj_9', '2026-11-01'), 2);
  assert.strictEqual(suggestReadDays(days, 'jj_other', '2026-11-02'), 1);
});
