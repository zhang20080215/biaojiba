// 晋江文学城页面解析 + GBK 编码（纯函数，不碰网络 / 云 SDK，tools/test-jjwxc-book.cjs 直接测）。
// 晋江页面是 gb18030：搜索关键词要 GBK 百分号编码，返回体要按 gb18030 解码。

const cheerio = require('cheerio');
const iconv = require('iconv-lite');

const INTRO_MAX = 2000;

// 'abc天官' → '%CC%EC...'，ASCII 字母数字原样保留
function encodeGbkQuery(str) {
  const buf = iconv.encode(String(str || ''), 'gbk');
  let out = '';
  for (const b of buf) {
    const ch = String.fromCharCode(b);
    out += /[A-Za-z0-9\-_.~]/.test(ch) ? ch : '%' + b.toString(16).toUpperCase().padStart(2, '0');
  }
  return out;
}

function decodeBody(buf) {
  return iconv.decode(Buffer.from(buf), 'gb18030');
}

function toInt(s) {
  const n = parseInt(String(s || '').replace(/[^\d]/g, ''), 10);
  return Number.isFinite(n) ? n : 0;
}

function absUrl(u) {
  const s = String(u || '').trim();
  if (!s) return '';
  if (s.startsWith('//')) return 'https:' + s;
  return /^https?:\/\//i.test(s) ? s : '';
}

// 搜索页「共找到 N 篇文章」；没有这句说明拿到的不是正常搜索页（被拦 / 改版）
function searchTotal(html) {
  const m = String(html || '').replace(/<[^>]+>/g, '').match(/共找到\s*(\d+)\s*篇文章/);
  return m ? Number(m[1]) : null;
}

// .info 形如「作者： 墨香铜臭 ┃ 进度：完结 ┃ 文章类型：原创-纯爱-… ┃ 主角：… ┃ 其它：…」
function parseInfo(text) {
  const out = {};
  String(text || '').replace(/\s+/g, ' ').split('┃').forEach(seg => {
    const m = seg.trim().match(/^(作者|进度|文章类型|主角|配角|其它|其他)\s*[：:]\s*(.*)$/);
    if (m) out[m[1] === '其他' ? '其它' : m[1]] = m[2].trim();
  });
  return out;
}

// 晋江「文章类型」以 原创-/衍生- 开头的是小说；评论、随笔、诗歌是书评/杂文，不是能"读到第几章"的书，
// 搜热门书名时能占到三成（《评《天官赐福》》《天官赐福书评》…），候选里直接滤掉。同人（衍生）保留。
const NON_NOVEL_TYPES = /^(评论|随笔|诗歌)/;
function isNonNovel(novelType) {
  return NON_NOVEL_TYPES.test(String(novelType || '').trim());
}

// 搜索结果 → candidates（不含简介：简介只在详情里取、只入库不外发）
function parseSearch(html) {
  const $ = cheerio.load(html);
  const out = [];
  const seen = new Set();
  $('h3.title').each((i, el) => {
    const $h = $(el);
    const a = $h.find('a[href*="onebook.php?novelid="]').first();
    const idm = (a.attr('href') || '').match(/novelid=(\d+)/);
    if (!idm || seen.has(idm[1])) return;
    const title = a.text().replace(/\s+/g, ' ').trim();
    if (!title) return;
    seen.add(idm[1]);
    const info = parseInfo($h.siblings('.info').first().text());
    if (isNonNovel(info['文章类型'])) return;
    const serialText = info['进度'] || '';
    out.push({
      novelId: idm[1],
      doubanId: 'jj_' + idm[1],
      source: 'jjwxc',
      title,
      author: info['作者'] || '',
      serialText,
      finished: /完结/.test(serialText),
      novelType: info['文章类型'] || '',
      posterUrl: ''
    });
  });
  return out;
}

// 简介：<br> 换成换行后取纯文本（cheerio 0.22 的 .html() 会把中文转成数字实体，所以不走 html）
function cleanIntro(text) {
  const t = String(text || '')
    .replace(/　/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return t.length > INTRO_MAX ? t.slice(0, INTRO_MAX) : t;
}

function introText($) {
  const $i = $('#novelintro').first();
  $i.find('br').replaceWith('\n');
  return $i.text();
}

// 详情页 → 书籍字段；缺 articleSection（被拦 / 已删 / 空页）返回 null
function parseDetail(html) {
  const $ = cheerio.load(html);
  const title = $('[itemprop="articleSection"]').first().text().trim();
  if (!title) return null;
  const serialText = $('[itemprop="updataStatus"]').first().text().replace(/\s+/g, ' ').trim();
  const updm = String(html).match(/最新更新[:：]\s*(\d{4}-\d{2}-\d{2}[ \d:]*)/);
  const cover = $('img.noveldefaultimage').first().attr('src');
  return {
    title,
    author: $('[itemprop="author"]').first().text().trim(),
    novelType: $('[itemprop="genre"]').first().text().replace(/\s+/g, ' ').trim(),
    serialText,
    finished: /完结/.test(serialText),
    wordCount: toInt($('.rightul [itemprop="wordCount"]').first().text()),
    // 最新章那行是 itemprop="chapter newestChapter"，精确匹配会少算一章
    chapterCount: $('tr[itemprop~="chapter"]').length,
    collectedCount: toInt($('[itemprop="collectedCount"]').first().text()),
    scoreCount: toInt($('[itemprop="scoreCount"]').first().text()),
    intro: cleanIntro(introText($)),
    coverUrl: absUrl(cover),
    lastUpdate: updm ? updm[1].trim() : ''
  };
}

module.exports = { isNonNovel, encodeGbkQuery, decodeBody, searchTotal, parseSearch, parseDetail, parseInfo, cleanIntro };
