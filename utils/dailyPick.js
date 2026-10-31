// 每日选片：纯逻辑（取片池、抽转盘候选、转盘停在哪、今日结果），不碰 wx / 数据库。
// 页面 pages/pick/index 用，tools/test-daily-pick.cjs 测。
//
// 玩法：选一个电影类榜单（或自建影单），范围选「未看」或「全部」，片池里有多少部转盘上就有多少格，
// 转完停在其中一部。不限次数；今天最后一次转出的片记成「今日选片」，回到页面先看到它。

const SLOTS = 8;                 // 转盘图还没画好时占位用的格数
const TURNS = 5;                 // 每次至少转几整圈，太少没有「转」的感觉
const CN_TZ_OFFSET_MS = 8 * 3600000;

/** 北京时间的 'YYYY-MM-DD' */
function cnToday(now) {
  return new Date((now == null ? Date.now() : now) + CN_TZ_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * 片池：scope 'unwatched' 只要还没标「看过」的（想看的也算未看），'all' 要全部。
 * 没有片名的脏条目不进池
 */
function poolOf(movies, statusMap, scope) {
  const st = statusMap || {};
  return (movies || []).filter(m => m && m._id != null && (m.title || m.name)
    && (scope === 'all' || st[m._id] !== 'watched'));
}

/** 转盘上的短名：按字符截，超出的用「…」，emoji 不会被切成半个 */
function shortTitle(title, max) {
  const chars = Array.from(String(title || ''));
  const m = max || 6;
  return chars.length <= m ? chars.join('') : chars.slice(0, m - 1).join('') + '…';
}

/**
 * 转到第 index 格要把转盘转到多少度（顺时针，累计值，只增不减，CSS transition 才会往前转）。
 * 第 i 格占 [i·360/n, (i+1)·360/n)，0° 在正上方，指针固定在正上方：
 * 转盘转了 θ 度后，指针指着转盘上的 (360 − θ) mod 360 度。
 * 落点在格子中间附近随机偏一点（不超过格宽的 ±30%），不会每次都停在正中、也不会压线
 */
function spinTo(current, index, n, rnd) {
  const r = rnd || Math.random;
  const seg = 360 / n;
  const center = index * seg + seg / 2 + (r() - 0.5) * seg * 0.6;
  const want = ((360 - center) % 360 + 360) % 360;      // 停下时 θ mod 360 应该等于它
  const now = ((current % 360) + 360) % 360;
  return current + TURNS * 360 + ((want - now) % 360 + 360) % 360;
}

/** 转盘转到 rotation 度时，指针指着第几格（测试和兜底用） */
function indexAt(rotation, n) {
  const angle = ((360 - rotation % 360) % 360 + 360) % 360;
  return Math.floor(angle / (360 / n)) % n;
}

/**
 * 转盘上字的排法（单位与 R 相同）：每格一部片，字一个个竖着排，从外沿往圆心走。
 * 字号按格子在 0.72R 处的宽度给（上限 maxFont），格子越多字越小、小到看不清也照画；
 * 往里走格子越来越窄，排到格宽小于字号的地方（rMin）就停，再往里是中心钮。
 * 片多时（几百部）字只占外圈一窄条，里面一圈是纯色放射条纹。
 */
function wheelLabelLayout(n, R, maxFont) {
  const k = 2 * Math.PI / Math.max(n, 1);                    // 半径 r 处格宽 = k·r
  const font = Math.min(maxFont, k * 0.72 * R * 0.9);
  const rOuter = R * 0.94;
  const rMin = Math.max(R * 0.29, font / k / 0.95);          // 0.29R：中心钮半径 0.246R 外再留点
  const line = font * 1.05;
  const maxChars = Math.max(1, Math.floor((rOuter - rMin) / line));
  return { font, line, rOuter, rMin, maxChars };
}

/**
 * 在 size×size 的 2d ctx 上画整张转盘：n = titles.length 格，0° 在正上方顺时针排（与 spinTo 一致）。
 * colors: { accent, tint, mid }，n 为奇数时最后一格用 mid，免得首尾两格同色连成一块
 */
function drawWheel(ctx, size, titles, colors) {
  const n = titles.length;
  const R = size / 2;
  const seg = 2 * Math.PI / n;
  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.translate(R, R);
  // 先整盘铺深色，只补浅色格，格与格之间不会出现抗锯齿细缝
  ctx.fillStyle = colors.accent;
  ctx.beginPath(); ctx.arc(0, 0, R, 0, 2 * Math.PI); ctx.fill();
  const fillOf = i => (n % 2 && i === n - 1 && n > 1) ? colors.mid : (i % 2 ? colors.tint : colors.accent);
  for (let i = 0; i < n; i++) {
    const c = fillOf(i);
    if (c === colors.accent) continue;
    ctx.fillStyle = c;
    ctx.beginPath(); ctx.moveTo(0, 0);
    ctx.arc(0, 0, R, -Math.PI / 2 + i * seg, -Math.PI / 2 + (i + 1) * seg);
    ctx.closePath(); ctx.fill();
  }
  const L = wheelLabelLayout(n, R, size * 0.045);
  ctx.font = `bold ${L.font.toFixed(2)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 0; i < n; i++) {
    const chars = Array.from(shortTitle(titles[i], L.maxChars));
    ctx.save();
    ctx.rotate((i + 0.5) * seg);                             // 转到格子中线，此时「上」朝外
    ctx.fillStyle = fillOf(i) === colors.tint ? colors.accent : '#FFFFFF';
    chars.forEach((ch, j) => ctx.fillText(ch, 0, -(L.rOuter - L.line * (j + 0.5))));
    ctx.restore();
  }
  ctx.restore();
}

/** 转盘背景：n 格，深浅两色交替（accent / tint 传 CSS 颜色或 var(...)） */
function wheelBackground(n, accent, tint) {
  const seg = 360 / n;
  const stops = [];
  for (let i = 0; i < n; i++) stops.push(`${i % 2 ? tint : accent} ${(i * seg).toFixed(2)}deg ${((i + 1) * seg).toFixed(2)}deg`);
  return `conic-gradient(${stops.join(', ')})`;
}

/** 'YYYY-MM-DD' → '10月31日 · 周五'（日期本身已是北京日期，按 UTC 取星期） */
function dateLabel(date) {
  const p = String(date || '').split('-').map(Number);
  if (p.length !== 3 || !p[1]) return '';
  const wd = '日一二三四五六'[new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay()];
  return `${p[1]}月${p[2]}日 · 周${wd}`;
}

/** 导演 / 国家字段有的是数组、有的是「、」「/」拼的串：只留前 n 个 */
function firstNames(v, n) {
  const list = Array.isArray(v) ? v : String(v || '').split(/[、/,，]/);
  return list.map(s => String(s && s.name || s).trim()).filter(Boolean).slice(0, n).join(' / ');
}

/** 存成「今日选片」的快照：只留展示要用的字段 */
function snapshot(m, source) {
  return {
    _id: String(m._id),
    title: m.title || m.name || '',
    year: m.year || '',
    director: firstNames(m.director || m.directors, 2),
    country: firstNames(m.country || m.countries, 1),
    cover: m.cover || m.originalCover || m.coverUrl || '',
    rating: Number(m.rating) || 0,
    theme: source.theme,
    listId: source.listId || '',
    sourceTitle: source.title || '',
    ratingLabel: source.theme === 'imdb' ? 'IMDb' : '豆瓣'
  };
}

/** 存着的今日选片还是不是今天的 */
function todayPick(record, today) {
  return record && record.date === today && record.movie ? record : null;
}

module.exports = { SLOTS, TURNS, cnToday, dateLabel, poolOf, shortTitle, spinTo, indexAt, wheelLabelLayout, drawWheel, wheelBackground, snapshot, todayPick };
