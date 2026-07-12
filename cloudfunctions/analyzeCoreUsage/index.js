// Read-only core usage analysis for every home-page feature.
// Input: { days?: number } (default 30, range 1..365)
// Output contains aggregate counts only; no openid is returned.

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
// Server-side cloud functions support a larger page than mini-program clients.
// Keeping this at 1000 cuts a 100k-row collection from ~1000 round trips to ~100.
const PAGE_SIZE = 1000;

const MARK_THEMES = [
  { id: 'douban_movies', title: '豆瓣电影 TOP250', collection: 'movies', topFiltered: true },
  { id: 'imdb_movies', title: 'IMDB电影 TOP250', collection: 'imdb_movies', topFiltered: true },
  { id: 'oscar_movies', title: '历届奥斯卡最佳影片', collection: 'oscar_movies' },
  { id: 'oscar_anime_movies', title: '历届奥斯卡最佳动画长篇', collection: 'oscar_anime_movies' },
  { id: 'boxoffice_movies', title: '全球电影票房榜', collection: 'boxoffice_movies', topFiltered: true },
  { id: 'oscar_cinematography_movies', title: '历届奥斯卡最佳摄影奖', collection: 'generic_theme_movies', theme: 'oscarCinematography' },
  { id: 'rt_horror_movies', title: '史上最佳恐怖电影', collection: 'generic_theme_movies', theme: 'rtHorror' },
  { id: 'rt_war_movies', title: '史上最佳战争电影', collection: 'generic_theme_movies', theme: 'rtWar' },
  { id: 'rt_animation_movies', title: '史上最佳动画电影', collection: 'generic_theme_movies', theme: 'rtAnimation' },
  { id: 'palme_dor_movies', title: '历届金棕榈奖', collection: 'generic_theme_movies', theme: 'palmeDor' },
  { id: 'oscar_screenplay_movies', title: '历届奥斯卡最佳原创剧本', collection: 'generic_theme_movies', theme: 'oscarScreenplay' },
  { id: 'oscar_foreign_movies', title: '历届奥斯卡最佳外语片', collection: 'generic_theme_movies', theme: 'oscarForeign' },
  { id: 'rt_action_movies', title: '史上最佳动作电影', collection: 'generic_theme_movies', theme: 'rtAction' },
  { id: 'letterboxd500_movies', title: 'Letterboxd Top 500', collection: 'generic_theme_movies', theme: 'letterboxd500' },
  { id: 'douban_books', title: '豆瓣读书 TOP250', collection: 'douban_books', kind: 'book', source: 'douban', topFiltered: true },
  { id: 'weread_books', title: '微信读书 TOP200 总榜', collection: 'weread_books', kind: 'book', source: 'weread', topFiltered: true }
];

const DAILY_THEMES = [
  { id: 'daily_water', theme: 'water', title: '每日喝水' },
  { id: 'daily_movie', theme: 'movie', title: '每日电影' },
  { id: 'daily_read', theme: 'read', title: '每日读书' },
  { id: 'daily_sport', theme: 'sport', title: '每日运动' }
];

function dateMs(value) {
  if (!value) return NaN;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string' || typeof value === 'number') return new Date(value).getTime();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  if (typeof value.$date === 'number') return value.$date;
  return NaN;
}

async function scanCollection(collection, fields, visitor, where) {
  let lastId = null;
  let scanned = 0;
  while (true) {
    const condition = lastId
      ? (where ? _.and([where, { _id: _.gt(lastId) }]) : { _id: _.gt(lastId) })
      : where;
    let query = db.collection(collection);
    if (condition) query = query.where(condition);
    const res = await query.orderBy('_id', 'asc').limit(PAGE_SIZE).field(fields).get();
    if (!res.data.length) break;
    for (const row of res.data) visitor(row);
    scanned += res.data.length;
    lastId = res.data[res.data.length - 1]._id;
    if (res.data.length < PAGE_SIZE) break;
  }
  return scanned;
}

async function loadThemeMembership() {
  const movieMembership = new Map();
  const bookMembership = new Map();
  const contentCounts = {};

  MARK_THEMES.forEach(cfg => { contentCounts[cfg.id] = 0; });

  // generic_theme_movies contains nine themes. Scan it once rather than once
  // per theme; all other collections also appear only once in the home config.
  const configsByCollection = new Map();
  for (const cfg of MARK_THEMES) {
    const configs = configsByCollection.get(cfg.collection) || [];
    configs.push(cfg);
    configsByCollection.set(cfg.collection, configs);
  }

  await Promise.all([...configsByCollection.entries()].map(async ([collection, configs]) => {
    await scanCollection(
      collection,
      { _id: true, theme: true, isTop250: true },
      row => {
        for (const cfg of configs) {
          if (cfg.theme && row.theme !== cfg.theme) continue;
          if (cfg.topFiltered && row.isTop250 === false) continue;
          contentCounts[cfg.id]++;
          const target = cfg.kind === 'book' ? bookMembership : movieMembership;
          const memberships = target.get(row._id) || [];
          memberships.push(cfg.id);
          target.set(row._id, memberships);
        }
      }
    );
  }));
  return { movieMembership, bookMembership, contentCounts };
}

function emptyMarkStats(cfg) {
  return {
    id: cfg.id,
    title: cfg.title,
    type: 'mark_theme',
    totalUsers: new Set(),
    totalActions: 0,
    recentUsers: new Set(),
    recentActions: 0
  };
}

async function analyzeMarkThemes(cutoffMs, membership) {
  const stats = new Map(MARK_THEMES.map(cfg => [cfg.id, emptyMarkStats(cfg)]));
  const allocate = (row, themeIds) => {
    if (!row.openid || !themeIds) return;
    const recent = dateMs(row.marked_at) >= cutoffMs;
    for (const themeId of themeIds) {
      const s = stats.get(themeId);
      s.totalActions++;
      s.totalUsers.add(row.openid);
      if (recent) {
        s.recentActions++;
        s.recentUsers.add(row.openid);
      }
    }
  };

  const themeSource = new Map(MARK_THEMES.map(t => [t.id, t.source]));
  const [marksScanned, bookMarksScanned] = await Promise.all([
    scanCollection('Marks', { _id: true, movieId: true, openid: true, marked_at: true }, row => {
      allocate(row, membership.movieMembership.get(row.movieId));
    }),
    scanCollection('BookMarks', { _id: true, bookId: true, openid: true, source: true, marked_at: true }, row => {
      const ids = membership.bookMembership.get(row.bookId);
      if (!ids) return;
      const effectiveSource = row.source === 'weread' ? 'weread' : 'douban';
      allocate(row, ids.filter(id => themeSource.get(id) === effectiveSource));
    })
  ]);

  const rows = MARK_THEMES.map(cfg => {
    const s = stats.get(cfg.id);
    return {
      id: s.id,
      title: s.title,
      type: s.type,
      contentItems: membership.contentCounts[cfg.id],
      totalUsers: s.totalUsers.size,
      totalActions: s.totalActions,
      avgActionsPerUser: s.totalUsers.size ? Number((s.totalActions / s.totalUsers.size).toFixed(2)) : 0,
      recentUsers: s.recentUsers.size,
      recentActions: s.recentActions
    };
  });
  return { rows, scanned: { Marks: marksScanned, BookMarks: bookMarksScanned } };
}

async function analyzeSimpleFeature(cfg, cutoffMs) {
  const allUsers = new Set();
  const recentUsers = new Set();
  let totalActions = 0;
  let recentActions = 0;
  const scanned = await scanCollection(cfg.collection, { _id: true, openid: true, [cfg.dateField]: true }, row => {
    if (!row.openid) return;
    totalActions++;
    allUsers.add(row.openid);
    if (dateMs(row[cfg.dateField]) >= cutoffMs) {
      recentActions++;
      recentUsers.add(row.openid);
    }
  });
  return {
    id: cfg.id,
    title: cfg.title,
    type: cfg.type,
    totalUsers: allUsers.size,
    totalActions,
    recentUsers: recentUsers.size,
    recentActions,
    actionLabel: cfg.actionLabel,
    scanned
  };
}

function isoDayMs(day) {
  return new Date(`${day}T00:00:00.000Z`).getTime();
}

function dayDiff(from, to) {
  return Math.round((isoDayMs(to) - isoDayMs(from)) / 86400000);
}

function rate(count, eligible) {
  return eligible ? Number((count / eligible * 100).toFixed(1)) : 0;
}

function longestStreak(sortedDates) {
  if (!sortedDates.length) return 0;
  let longest = 1;
  let current = 1;
  for (let i = 1; i < sortedDates.length; i++) {
    if (dayDiff(sortedDates[i - 1], sortedDates[i]) === 1) current++;
    else current = 1;
    if (current > longest) longest = current;
  }
  return longest;
}

function trailingStreak(sortedDates) {
  if (!sortedDates.length) return 0;
  let streak = 1;
  for (let i = sortedDates.length - 1; i > 0; i--) {
    if (dayDiff(sortedDates[i - 1], sortedDates[i]) !== 1) break;
    streak++;
  }
  return streak;
}

function calendarWeekStart(day) {
  const date = new Date(`${day}T00:00:00.000Z`);
  const mondayOffset = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - mondayOffset);
  return date.toISOString().slice(0, 10);
}

function addDays(day, amount) {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function hongKongDay(value) {
  const ms = dateMs(value);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms + 8 * 3600000).toISOString().slice(0, 10);
}

async function analyzeDailyThemes(cutoffDate, snapshotDate) {
  const stats = new Map(DAILY_THEMES.map(cfg => [cfg.theme, {
    ...cfg, recordDates: new Map(), activityDays: new Map(), values: new Map(),
    recordDateDays: 0
  }]));
  const waterGoals = new Map();
  const [scanned, settingsScanned] = await Promise.all([
    scanCollection('DailyLogs', { _id: true, openid: true, theme: true, date: true, total_value: true, entries: true, created_at: true }, row => {
    const s = stats.get(row.theme);
    if (!s || !row.openid || !row.date) return;
    s.recordDateDays++;
    const dates = s.recordDates.get(row.openid) || new Set();
    dates.add(row.date);
    s.recordDates.set(row.openid, dates);
    if (typeof row.total_value === 'number') s.values.set(`${row.openid}|${row.date}`, row.total_value);

    const activity = s.activityDays.get(row.openid) || new Set();
    const entries = Array.isArray(row.entries) ? row.entries : [];
    for (const entry of entries) {
      const createdDay = hongKongDay(entry && entry.ts);
      if (createdDay) activity.add(createdDay);
    }
    // Backward compatibility for old documents without entry timestamps.
    if (!entries.some(entry => hongKongDay(entry && entry.ts))) {
      const fallbackDay = hongKongDay(row.created_at);
      if (fallbackDay) activity.add(fallbackDay);
    }
    if (activity.size) s.activityDays.set(row.openid, activity);
    }),
    scanCollection('DailySettings', { _id: true, openid: true, theme: true, daily_goal: true }, row => {
      if (row.theme === 'water' && row.openid && Number(row.daily_goal) > 0) {
        waterGoals.set(row.openid, Number(row.daily_goal));
      }
    })
  ]);

  const dayDistribution = userDays => {
    const counts = new Map();
    for (const dates of userDays.values()) {
      counts.set(dates.size, (counts.get(dates.size) || 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => a[0] - b[0]);
  };
  return {
    scanned,
    settingsScanned,
    rows: DAILY_THEMES.map(cfg => {
      const s = stats.get(cfg.theme);
      const totalActivityDays = [...s.activityDays.values()].reduce((sum, dates) => sum + dates.size, 0);
      const recentActivityDays = new Map();
      for (const [openid, dates] of s.activityDays.entries()) {
        const recent = new Set([...dates].filter(day => day >= cutoffDate));
        if (recent.size) recentActivityDays.set(openid, recent);
      }
      const recentDays = [...recentActivityDays.values()].reduce((sum, dates) => sum + dates.size, 0);
      const repeatUsers = [...s.activityDays.values()].filter(dates => dates.size >= 2).length;
      const retention = {
        d1Eligible: 0, d1Users: 0,
        d7Eligible: 0, d7Users: 0,
        d30Eligible: 0, d30Users: 0
      };
      const streakCounts = new Map();
      let streak2 = 0, streak3 = 0, streak7 = 0, streak14 = 0, currentStreakUsers = 0;
      const firstDates = new Map();
      for (const [openid, dateSet] of s.activityDays.entries()) {
        const dates = [...dateSet].sort();
        const first = dates[0];
        firstDates.set(openid, first);
        const offsets = dates.slice(1).map(day => dayDiff(first, day));
        const age = dayDiff(first, snapshotDate);
        if (age >= 1) {
          retention.d1Eligible++;
          if (offsets.includes(1)) retention.d1Users++;
        }
        if (age >= 7) {
          retention.d7Eligible++;
          if (offsets.some(x => x >= 1 && x <= 7)) retention.d7Users++;
        }
        if (age >= 30) {
          retention.d30Eligible++;
          if (offsets.some(x => x >= 1 && x <= 30)) retention.d30Users++;
        }
        const longest = longestStreak(dates);
        streakCounts.set(longest, (streakCounts.get(longest) || 0) + 1);
        if (longest >= 2) streak2++;
        if (longest >= 3) streak3++;
        if (longest >= 7) streak7++;
        if (longest >= 14) streak14++;
        const last = dates[dates.length - 1];
        if (dayDiff(last, snapshotDate) <= 1 && trailingStreak(dates) >= 2) currentStreakUsers++;
      }

      const currentWeek = calendarWeekStart(snapshotDate);
      const weeks = [];
      for (let i = 7; i >= 0; i--) {
        const start = addDays(currentWeek, -7 * i);
        weeks.push({ start, end: addDays(start, 6), newUsers: 0, activeUsers: new Set(), recordDays: 0 });
      }
      for (const [openid, dates] of s.activityDays.entries()) {
        const first = firstDates.get(openid);
        for (const week of weeks) {
          if (first >= week.start && first <= week.end) week.newUsers++;
          for (const day of dates) {
            if (day >= week.start && day <= week.end) {
              week.activeUsers.add(openid);
              week.recordDays++;
            }
          }
        }
      }

      let goalKnownDays = 0;
      let goalAchievedDays = 0;
      if (cfg.theme === 'water') {
        for (const [openid, dates] of s.recordDates.entries()) {
          const goal = waterGoals.get(openid);
          if (!goal) continue;
          for (const day of dates) {
            const value = s.values.get(`${openid}|${day}`);
            if (typeof value !== 'number') continue;
            goalKnownDays++;
            if (value >= goal) goalAchievedDays++;
          }
        }
      }
      return {
        id: cfg.id,
        title: cfg.title,
        type: 'daily_theme',
        totalUsers: s.activityDays.size,
        totalDays: totalActivityDays,
        recentUsers: recentActivityDays.size,
        recentDays,
        repeatUsers,
        repeatRate: s.activityDays.size ? Number((repeatUsers / s.activityDays.size * 100).toFixed(1)) : 0,
        avgActiveDaysPerUser: s.activityDays.size ? Number((totalActivityDays / s.activityDays.size).toFixed(2)) : 0,
        dayDistribution: dayDistribution(s.activityDays),
        recentDayDistribution: dayDistribution(recentActivityDays),
        recordDateDays: s.recordDateDays,
        recordDateDistribution: dayDistribution(s.recordDates),
        retention: {
          d1: [retention.d1Eligible, retention.d1Users, rate(retention.d1Users, retention.d1Eligible)],
          d7: [retention.d7Eligible, retention.d7Users, rate(retention.d7Users, retention.d7Eligible)],
          d30: [retention.d30Eligible, retention.d30Users, rate(retention.d30Users, retention.d30Eligible)]
        },
        streaks: {
          distribution: [...streakCounts.entries()].sort((a, b) => a[0] - b[0]),
          thresholds: [streak2, streak3, streak7, streak14],
          currentUsers: currentStreakUsers
        },
        weekly: weeks.map(w => [w.start, w.end, w.newUsers, w.activeUsers.size, w.recordDays]),
        goal: cfg.theme === 'water'
          ? [goalKnownDays, goalAchievedDays, rate(goalAchievedDays, goalKnownDays)]
          : null
      };
    })
  };
}

function chunks(values, size) {
  const result = [];
  for (let i = 0; i < values.length; i += size) result.push(values.slice(i, i + size));
  return result;
}

async function analyzeOneMarkTheme(cfg, cutoffMs) {
  const ids = [];
  await scanCollection(
    cfg.collection,
    { _id: true, theme: true, isTop250: true },
    row => {
      if (cfg.theme && row.theme !== cfg.theme) return;
      if (cfg.topFiltered && row.isTop250 === false) return;
      ids.push(row._id);
    }
  );

  const users = new Set();
  const recentUsers = new Set();
  let totalActions = 0;
  let recentActions = 0;
  let scanned = 0;
  const collection = cfg.kind === 'book' ? 'BookMarks' : 'Marks';
  const idField = cfg.kind === 'book' ? 'bookId' : 'movieId';
  const fields = { _id: true, openid: true, marked_at: true, source: true };

  // Database _.in accepts a limited number of values. Query content chunks in
  // small concurrent waves instead of scanning the complete Marks collection.
  const idChunks = chunks(ids, 100);
  for (const wave of chunks(idChunks, 3)) {
    const counts = await Promise.all(wave.map(idChunk => scanCollection(
      collection,
      { ...fields, [idField]: true },
      row => {
        if (!row.openid) return;
        if (cfg.kind === 'book') {
          const effectiveSource = row.source === 'weread' ? 'weread' : 'douban';
          if (effectiveSource !== cfg.source) return;
        }
        totalActions++;
        users.add(row.openid);
        if (dateMs(row.marked_at) >= cutoffMs) {
          recentActions++;
          recentUsers.add(row.openid);
        }
      },
      { [idField]: _.in(idChunk) }
    )));
    scanned += counts.reduce((sum, count) => sum + count, 0);
  }

  return {
    id: cfg.id,
    title: cfg.title,
    type: 'mark_theme',
    contentItems: ids.length,
    totalUsers: users.size,
    totalActions,
    avgActionsPerUser: users.size ? Number((totalActions / users.size).toFixed(2)) : 0,
    recentUsers: recentUsers.size,
    recentActions,
    scanned
  };
}

function compactFeature(row) {
  return [row.id, row.totalUsers, row.totalActions,
    row.avgActionsPerUser == null ? null : row.avgActionsPerUser,
    row.recentUsers, row.recentActions];
}

function compactDaily(row) {
  return [row.id, row.totalUsers, row.totalDays, row.recentUsers,
    row.recentDays, row.repeatRate, row.avgActiveDaysPerUser,
    row.dayDistribution, row.recentDayDistribution,
    row.retention, row.streaks, row.weekly, row.goal,
    row.recordDateDays, row.recordDateDistribution];
}

exports.main = async event => {
  const startedAt = Date.now();
  try {
    const requestedDays = Number(event && event.days) || 30;
    const days = Math.max(1, Math.min(365, Math.floor(requestedDays)));
    const snapshot = new Date();
    const cutoff = new Date(snapshot.getTime() - days * 86400000);
    const snapshotDate = hongKongDay(snapshot);
    // Inclusive Hong Kong calendar-day window, e.g. today plus previous 29
    // dates for days=30.
    const cutoffDate = addDays(snapshotDate, -(days - 1));

    const action = event && event.action;
    if (!action) {
      return {
        ok: 0,
        error: 'Full scan is disabled by the 60s cloud-function limit. Use action=themes/daily/extras.',
        calls: [
          { action: 'themes', ids: MARK_THEMES.slice(0, 3).map(x => x.id) },
          { action: 'daily' },
          { action: 'extras' }
        ],
        themeIds: MARK_THEMES.map(x => x.id),
        maxThemeIdsPerCall: 3
      };
    }

    if (action === 'themes') {
      const requested = Array.isArray(event.ids) ? event.ids : [];
      if (!requested.length || requested.length > 3) {
        return { ok: 0, error: 'action=themes requires 1..3 ids', maxThemeIdsPerCall: 3 };
      }
      const configs = requested.map(id => MARK_THEMES.find(x => x.id === id));
      if (configs.some(x => !x)) return { ok: 0, error: 'Unknown theme id' };
      const rows = await Promise.all(configs.map(cfg => analyzeOneMarkTheme(cfg, cutoff.getTime())));
      return { ok: 1, part: 'themes', m: [snapshot.toISOString(), days, cutoffDate], f: rows.map(compactFeature), ms: Date.now() - startedAt };
    }

    if (action === 'daily') {
      const dailyOnly = await analyzeDailyThemes(cutoffDate, snapshotDate);
      return { ok: 1, part: 'daily', m: [snapshot.toISOString(), days, cutoffDate], d: dailyOnly.rows.map(compactDaily), c: [dailyOnly.scanned, dailyOnly.settingsScanned], ms: Date.now() - startedAt };
    }

    if (action === 'extras') {
      const [searchOnly, growthOnly] = await Promise.all([
        analyzeSimpleFeature({ id: 'movie_search_all_platforms', title: '全平台电影评分查询', type: 'query_feature', collection: 'user_movie_queries', dateField: 'queriedAt', actionLabel: '不同电影查询记录' }, cutoff.getTime()),
        analyzeSimpleFeature({ id: 'child_growth', title: '儿童生长发育评估', type: 'assessment_feature', collection: 'growth_records', dateField: 'created_at', actionLabel: '评估次数' }, cutoff.getTime())
      ]);
      return { ok: 1, part: 'extras', m: [snapshot.toISOString(), days, cutoffDate], f: [compactFeature(searchOnly), compactFeature(growthOnly)], c: [searchOnly.scanned, growthOnly.scanned], ms: Date.now() - startedAt };
    }

    if (action !== 'all') return { ok: 0, error: 'Unknown action' };

    const membership = await loadThemeMembership();
    const searchConfig = {
      id: 'movie_search_all_platforms', title: '全平台电影评分查询', type: 'query_feature',
      collection: 'user_movie_queries', dateField: 'queriedAt', actionLabel: '不同电影查询记录'
    };
    const growthConfig = {
      id: 'child_growth', title: '儿童生长发育评估', type: 'assessment_feature',
      collection: 'growth_records', dateField: 'created_at', actionLabel: '评估次数'
    };
    // Once membership is ready, the five source scans are independent. Run
    // them concurrently so their database latency does not accumulate.
    const [markResult, search, growth, daily] = await Promise.all([
      analyzeMarkThemes(cutoff.getTime(), membership),
      analyzeSimpleFeature(searchConfig, cutoff.getTime()),
      analyzeSimpleFeature(growthConfig, cutoff.getTime()),
      analyzeDailyThemes(cutoffDate, snapshotDate)
    ]);

    const fullResult = {
      success: true,
      meta: {
        snapshotAt: snapshot.toISOString(), days, cutoffDate,
        privacy: 'Aggregate counts only; no openid returned.',
        overlapNote: '同一内容可属于多个主题，主题数据不得跨主题求和。',
        queryLimitation: 'user_movie_queries 为用户×电影 upsert，actions 表示保存的不同电影查询记录，不是真实点击次数。'
      },
      features: [...markResult.rows, search, growth],
      dailyThemes: daily.rows,
      validation: {
        expectedMarkThemes: MARK_THEMES.length,
        expectedDailyThemes: DAILY_THEMES.length,
        scanned: { ...markResult.scanned, DailyLogs: daily.scanned, user_movie_queries: search.scanned, growth_records: growth.scanned }
      },
      elapsedMs: Date.now() - startedAt
    };

    // Cloud console logs truncate long objects. Compact is the default wire
    // format and keeps the complete result to a few KB. Positional schemas:
    // f: [id,totalUsers,totalActions,avgActionsPerUser,recentUsers,recentActions]
    // d: [id,totalUsers,totalDays,recentUsers,recentDays,repeatRate,
    //     avgActiveDaysPerUser,dayDistribution,recentDayDistribution,
    //     retention,streaks,weekly,goal,recordDateDays,recordDateDistribution]
    // c: [Marks,BookMarks,DailyLogs,user_movie_queries,growth_records]
    if (event && event.format === 'full') return fullResult;
    return {
      ok: 1,
      m: [fullResult.meta.snapshotAt, days, cutoffDate],
      f: fullResult.features.map(row => [
        row.id, row.totalUsers, row.totalActions,
        row.avgActionsPerUser == null ? null : row.avgActionsPerUser,
        row.recentUsers, row.recentActions
      ]),
      d: fullResult.dailyThemes.map(row => [
        row.id, row.totalUsers, row.totalDays, row.recentUsers,
        row.recentDays, row.repeatRate, row.avgActiveDaysPerUser
      ]),
      c: [
        fullResult.validation.scanned.Marks,
        fullResult.validation.scanned.BookMarks,
        fullResult.validation.scanned.DailyLogs,
        fullResult.validation.scanned.user_movie_queries,
        fullResult.validation.scanned.growth_records
      ],
      ms: fullResult.elapsedMs
    };
  } catch (err) {
    console.error('analyzeCoreUsage failed:', err);
    return { success: false, error: err.message, elapsedMs: Date.now() - startedAt };
  }
};
