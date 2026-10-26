const markTimeline = require('../../../utils/markTimeline');
const toast = require('../../../utils/dailyToast.js');
const imageCache = require('../../../utils/imageCacheManager.js');
const { decorateMovie } = require('../../../utils/movieFormat.js');
const { getNavMetrics, todayStr } = require('./common.js');
const { trackDaily } = require('../../../utils/track.js');

const MOOD_OPTIONS = [
  { key: 'love', emoji: '😍', label: '超爱' },
  { key: 'happy', emoji: '😂', label: '欢乐' },
  { key: 'touched', emoji: '😢', label: '泪目' },
  { key: 'shocked', emoji: '😱', label: '震撼' },
  { key: 'healing', emoji: '🥰', label: '治愈' },
  { key: 'thinking', emoji: '🤔', label: '深思' },
  { key: 'bored', emoji: '😴', label: '无聊' },
  { key: 'letdown', emoji: '😞', label: '失望' },
  { key: 'thrilled', emoji: '🔥', label: '热血' },
  { key: 'scared', emoji: '😨', label: '惊悚' },
  { key: 'romantic', emoji: '💞', label: '心动' },
  { key: 'nostalgic', emoji: '🕰️', label: '怀旧' },
  { key: 'cool', emoji: '😎', label: '过瘾' },
  { key: 'confused', emoji: '🤯', label: '烧脑' }
];
// 网格只展示前若干个，最后一格为「更多」，其余进弹窗
const VISIBLE_MOOD_COUNT = 7;

// rating(0~5, 步进0.5) → 5 颗星状态数组：'full' | 'half' | 'empty'
function buildStars(rating) {
  const r = Number(rating) || 0;
  const arr = [];
  for (let i = 1; i <= 5; i++) {
    if (r >= i) arr.push('full');
    else if (r >= i - 0.5) arr.push('half');
    else arr.push('empty');
  }
  return arr;
}

// 拖拽评分：星条内手指落点 → 评分（间距感知，对齐到视觉上的星，精确到 0.5）。
// 星条 = 5×56rpx 星 + 4×16rpx 间距 = 344rpx（见 add.wxss）；每颗星左半(28rpx)=X.5，右半+其后间距=X.0。
// 用比例 + 常量宽度换算，跟设备 px 无关。
function starValueFromX(clientX, rect) {
  let frac = (clientX - rect.left) / rect.width;
  if (frac < 0) frac = 0;
  if (frac > 1) frac = 1;
  const xRpx = frac * 344;
  let i = Math.floor(xRpx / 72); // 每颗星 + 间距 = 72rpx
  if (i > 4) i = 4;
  const within = xRpx - i * 72;
  const v = i + (within < 28 ? 0.5 : 1);
  return v < 0.5 ? 0.5 : (v > 5 ? 5 : v);
}

// 可见心情：始终包含当前选中项（选中项在隐藏区时顶到末位，避免选了却看不到）
function computeVisibleMoods(all, selectedKey) {
  if (!selectedKey) return all.slice(0, VISIBLE_MOOD_COUNT);
  const idx = all.findIndex(m => m.key === selectedKey);
  if (idx < 0 || idx < VISIBLE_MOOD_COUNT) return all.slice(0, VISIBLE_MOOD_COUNT);
  return all.slice(0, VISIBLE_MOOD_COUNT - 1).concat([all[idx]]);
}

function formatDateText(d) {
  const p = String(d || '').split('-').map(Number);
  if (p.length < 3 || p.some(isNaN)) return d || '';
  return `${p[0]}年${p[1]}月${p[2]}日`;
}

function buildMeta(year, director) {
  const parts = [];
  if (year) parts.push(String(year));
  if (director) parts.push('导演 ' + director);
  return parts.join('  ·  ');
}

// 千位分隔符：699743 → "699,743"
function addThousandSep(n) {
  if (n === null || n === undefined || n === '') return '';
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// 外部源候选（无 doubanId）：时光网（成人内容正片）/ TVmaze（补季），豆瓣登录墙挡掉的条目靠它们补。
// 不能走 fetchMovieFullInfo，选中后按候选自带字段直接展示；对用户不做视觉区分。
function isExternalSource(item) {
  return !!item && (item.source === 'mtime' || item.source === 'tvmaze');
}

// 「继续观看」归并键：与 decorateCandidate 的 key 同一口径，豆瓣 db{doubanId} / TVmaze tv{id}s{季} / 时光网 mt{id}
function continueKeyOf(m) {
  if (!m) return '';
  if (m.source === 'tvmaze' && m.tvmazeId) return `tv${m.tvmazeId}s${Number(m.tvmazeSeason) || 0}`;
  if (m.source === 'mtime' && m.mtimeId) return `mt${m.mtimeId}`;
  return m.doubanId ? `db${m.doubanId}` : '';
}

// 候选视图模型：豆瓣候选带评分/人数直接展示；外部源候选无评分。
function decorateCandidate(item) {
  const ext = isExternalSource(item);
  return {
    ...item,
    // 无 key（旧云函数）时兜底，保证列表 wx:key / 选中定位可用
    key: item.key || (item.source === 'mtime' ? `mt${item.mtimeId}`
      : item.source === 'tvmaze' ? `tv${item.tvmazeId}s${item.tvmazeSeason || 0}` : `db${item.doubanId}`),
    posterThumb: imageCache.getThumbnailUrl(item.posterUrl, 'list'),
    ratingText: (!ext && item.rating) ? Number(item.rating).toFixed(1) : '',
    votesText: (!ext && item.ratingCount) ? `${addThousandSep(item.ratingCount)}人评价` : ''
  };
}

// 片名归一化（与云函数 normalizeForMatch 同一口径）：去空白与常见标点、小写，补季去重用
function normTitle(t) {
  return String(t || '').replace(/[\s　]+/g, '').replace(/[·・:：\-—_（）()【】\[\]"'!！?？、,，.。/]/g, '').toLowerCase();
}

// 从豆瓣候选里抠「补季线索」：标题形如「行尸走肉 第八季」且带英文原名 → { cn: '行尸走肉', en: 'The Walking Dead' }。
// 按 en 去重、最多 2 部；用户直接输英文名（豆瓣一条季都没回）时退成 [{ cn: '', en: keyword }]。
const SEASON_TITLE_RE = /^(.+?)\s*第[一二三四五六七八九十零百\d]+季$/;
function seasonHintsFrom(candidates, keyword) {
  const byEn = {};
  const hints = [];
  (candidates || []).forEach(c => {
    if (c.source && c.source !== 'douban') return;
    const m = SEASON_TITLE_RE.exec(String(c.title || '').trim());
    if (!m || !c.originalTitle) return;
    const en = normTitle(c.originalTitle);
    if (!en || byEn[en]) return;
    byEn[en] = true;
    hints.push({ cn: m[1].trim(), en: c.originalTitle.trim() });
  });
  if (!hints.length && /[a-z]/i.test(keyword)) hints.push({ cn: '', en: keyword });
  return hints.slice(0, 2);
}

// 4 平台固定展示：豆瓣 / IMDb / 新鲜度(RT 影评人) / 爆米花(RT 观众)，缺数据补 '—'
function buildRatingCells(mv) {
  const douban = mv.douban || {};
  const imdb = mv.imdb || {};
  return [
    { label: '豆瓣', value: douban.rating ? String(douban.rating) : '—', sub: mv.doubanVotesLabel || '' },
    { label: 'IMDb', value: imdb.rating ? String(imdb.rating) : '—', sub: mv.imdbVotesLabel || '' },
    { label: '新鲜度', value: mv.hasRtCritic ? mv.rtCriticText : '—', sub: '影评人' },
    { label: '爆米花', value: mv.hasRtAudience ? mv.rtAudienceText : '—', sub: '观众' }
  ];
}

Page({
  data: {
    toast: { show: false, text: '', icon: '' },
    statusBarHeight: 20,
    navBarHeight: 48,
    navOffset: 68,

    keyword: '',
    searching: false,
    searched: false,
    error: '',
    candidates: [],
    // 第二趟补季（TVmaze）进行中：豆瓣列表已展示，列表底部给一行「正在补全分季」，
    // 否则用户看列表里只有 8~11 季就以为搜完了
    seasonLoading: false,
    // 继续观看：未看完的电视剧（已知总集数且看到集数 < 总集数），点击带入表单预填
    continueList: [],
    selected: null,

    // 选中后展示
    posterSrc: '',
    movieMeta: '',
    ratingsLoading: false,
    ratingsError: '',
    ratingCells: [],
    movieFull: null,
    // 时光网候选选中态标记：控制跳过全平台评分抓取（对用户不可见、不做来源展示）
    mtimeMode: false,

    // 剧集进度（仅电视剧展示）：hasEpisodes 决定是否显示「看到第几集」输入
    hasEpisodes: false,
    totalEpisodes: 0,        // 豆瓣返回的总集数，0=未知
    currentEpisode: '',      // 输入框原文，空串=未填
    episodeProgressText: '', // 「当前集/总集数」都有时才显示的百分比

    date: '',
    dateText: '',
    rating: 0,
    ratingLabel: '未评分',
    stars: buildStars(0),
    moods: MOOD_OPTIONS,
    visibleMoods: computeVisibleMoods(MOOD_OPTIONS, ''),
    moodModal: false,
    mood: '',
    note: '',
    noteCount: 0,
    submitting: false
  },

  onLoad(options) {
    const nav = getNavMetrics();
    const date = (options && options.date) || todayStr();
    this.setData({
      statusBarHeight: nav.statusBarHeight,
      navBarHeight: nav.navBarHeight,
      navOffset: nav.navOffset,
      date,
      dateText: formatDateText(date)
    });
    wx.setNavigationBarColor({ frontColor: '#000000', backgroundColor: '#FAF6EB' });
    wx.setNavigationBarTitle({ title: '添加电影' });
    this._loadContinueWatching();
  },

  // 拉取该用户所有观影记录，派生「未看完的电视剧」列表（静默失败，不影响添加）
  _loadContinueWatching() {
    wx.cloud.callFunction({
      name: 'syncDailyLog',
      data: { action: 'getAll', theme: 'movie' },
      success: res => {
        const days = (res && res.result && res.result.days) || [];
        this.setData({ continueList: this._deriveContinue(days) });
      },
      fail: () => {}
    });
  },

  // 按「同一部剧」归并全部记录：仅电视剧(subtype==='tv' 或 总集数>1) + 已知总集数，
  // 取最大已看集数；未看完(1 <= 最大已看 < 总集数)才进列表，最近看的在前，展示用最新一条 meta。
  // 归并键不能只认 doubanId：TVmaze 补进来的季（《行尸走肉》1~7 季）没有 doubanId，
  // 按 tvmazeId+季 归并；时光网条目按 mtimeId（它们没有分季，进不了这个列表，但键要唯一）
  _deriveContinue(days) {
    const byId = {};
    (days || []).forEach(d => {
      (d.entries || []).forEach(en => {
        const m = en.meta || {};
        const id = continueKeyOf(m);
        const total = Number(m.totalEpisodes) || 0;
        const isTv = m.subtype === 'tv' || total > 1;
        if (!id || !isTv || total <= 0) return;
        const cur = Number(m.currentEpisode) || 0;
        const rec = byId[id] || { maxEp: 0, total: 0, latestTs: 0, meta: m };
        if (cur > rec.maxEp) rec.maxEp = cur;
        if (total > rec.total) rec.total = total;
        if ((en.ts || 0) >= rec.latestTs) { rec.latestTs = en.ts || 0; rec.meta = m; }
        byId[id] = rec;
      });
    });
    return Object.keys(byId)
      .map(id => byId[id])
      .filter(r => r.maxEp >= 1 && r.maxEp < r.total)
      .sort((a, b) => b.latestTs - a.latestTs)
      .map(r => {
        const m = r.meta;
        const poster = m.poster || m.originalPoster || '';
        return {
          key: continueKeyOf(m),
          doubanId: m.doubanId || '',
          source: m.source || 'douban',
          mtimeId: m.mtimeId || '',
          tvmazeId: m.tvmazeId || '',
          tvmazeSeason: Number(m.tvmazeSeason) || 0,
          subtype: m.subtype || '',
          title: m.title || '未命名电影',
          year: m.year || '',
          director: m.director || '',
          poster,
          originalPoster: m.originalPoster || '',
          posterThumb: imageCache.getThumbnailUrl(poster, 'list'),
          lastEpisode: r.maxEp,
          totalEpisodes: r.total
        };
      });
  },

  // 点击「继续观看」：把该剧带入添加表单（跳过搜索），预填上次看到的集数
  onContinueWatch(e) {
    const key = e.currentTarget.dataset.key;
    const item = this.data.continueList.find(x => x.key === key);
    if (!item) return;
    const selected = {
      doubanId: item.doubanId,
      source: item.source,
      mtimeId: item.mtimeId,
      tvmazeId: item.tvmazeId,
      tvmazeSeason: item.tvmazeSeason,
      subtype: item.subtype,
      totalEpisodes: item.totalEpisodes,
      title: item.title,
      year: item.year,
      director: item.director,
      posterUrl: item.originalPoster || item.poster,
      posterThumb: item.posterThumb
    };
    // TVmaze 季没有 doubanId，不能去 fetchMovieFullInfo 抓评分，按候选字段直接展示 + 预填集数
    if (isExternalSource(selected)) {
      this.setData({ candidates: [], searched: false, error: '' });
      this._selectExternal(selected);
      this.setData({ hasEpisodes: true, currentEpisode: String(item.lastEpisode || '') });
      this._syncEpisodeProgress();
      return;
    }
    this.setData({
      candidates: [],
      searched: false,
      error: '',
      selected,
      posterSrc: item.posterThumb || item.poster || '/images/default-movie.jpg',
      movieMeta: buildMeta(item.year, item.director),
      ratingsLoading: true,
      ratingsError: '',
      ratingCells: [],
      movieFull: null,
      mtimeMode: false,
      hasEpisodes: true,
      totalEpisodes: item.totalEpisodes,
      currentEpisode: String(item.lastEpisode || ''),
      episodeProgressText: ''
    });
    this._syncEpisodeProgress();
    this._fullInfoPromise = this._fetchFullRatings(item.doubanId);
  },

  onBack() {
    if (getCurrentPages().length > 1) wx.navigateBack();
    else wx.redirectTo({ url: '/pages/daily/movie/index' });
  },

  onKeywordInput(e) {
    this.setData({ keyword: e.detail.value });
  },

  _resetSelection() {
    this.setData({
      selected: null,
      posterSrc: '',
      movieMeta: '',
      ratingsLoading: false,
      ratingsError: '',
      ratingCells: [],
      movieFull: null,
      mtimeMode: false,
      hasEpisodes: false,
      totalEpisodes: 0,
      currentEpisode: '',
      episodeProgressText: ''
    });
  },

  onClearKeyword() {
    this.setData({ keyword: '', candidates: [], searched: false, error: '', seasonLoading: false });
    this._resetSelection();
  },

  // 调一次搜索。失败得快（2 秒内）多半是弱网/切后台把请求丢了，重试一次基本就回来了；
  // 失败得慢说明是上游超时，再来一次只是让人多等一轮，直接放弃。
  // 用户在地铁电梯里点搜索的失败率本来就不低，这一次重试比什么服务端优化都管用。
  _callSearch(keyword) {
    return wx.cloud.callFunction({
      name: 'searchMovieByTitle',
      // includeMtime：豆瓣被登录墙挡掉的正片（如蓝丝绒/巴黎野玫瑰）用时光网兜底补进候选
      data: { keyword, includeMtime: true }
    });
  },

  async _searchWithRetry(keyword) {
    const startedAt = Date.now();
    try {
      return await this._callSearch(keyword);
    } catch (e) {
      const fastFail = Date.now() - startedAt < 2000;
      if (!fastFail) throw e;
      console.warn('daily movie search 快速失败，重试一次', e && (e.errMsg || e.message));
      return await this._callSearch(keyword);
    }
  },

  // 第二趟：补季。豆瓣对《行尸走肉》1~7 季这类条目只对登录用户开放，匿名只回 8~11 季 + 衍生剧；
  // 从豆瓣候选里抠出 { cn, en } 线索交给云函数去 TVmaze 拉全部季，回来后按片名去重、追加到列表末尾。
  // 中途用户换了关键词 / 清空 / 已选中则丢弃；失败一律静默——它是补充，不是主结果。
  async _appendSeasonExtras(keyword, candidates) {
    const hints = seasonHintsFrom(candidates, keyword);
    if (!hints.length) return;
    const seq = (this._seasonSeq = (this._seasonSeq || 0) + 1);
    this.setData({ seasonLoading: true });
    try {
      let res;
      try {
        res = await wx.cloud.callFunction({ name: 'searchMovieByTitle', data: { keyword, seasonsFor: hints } });
      } catch (e) {
        console.warn('season extras fail', e && (e.errMsg || e.message));
        return;
      }
      const list = (res && res.result && res.result.success && res.result.candidates) || [];
      if (!list.length) return;
      if ((this.data.keyword || '').trim() !== keyword || !this.data.searched || this.data.searching || this.data.selected) return;
      const seen = new Set((this.data.candidates || []).map(c => normTitle(c.title)));
      const extras = [];
      list.forEach(c => {
        const t = normTitle(c.title);
        if (!t || seen.has(t)) return;
        seen.add(t);
        extras.push(decorateCandidate(c));
      });
      if (extras.length) this.setData({ candidates: this.data.candidates.concat(extras) });
    } finally {
      // 无论追加成功/无结果/失败/被作废都把提示收掉；但如果期间又起了一轮补季（seq 变了），
      // 提示归新那轮管，这里不动
      if (this._seasonSeq === seq) this.setData({ seasonLoading: false });
    }
  },

  async onSearch() {
    const keyword = (this.data.keyword || '').trim();
    if (!keyword) {
      toast.show(this, '请输入电影名');
      return;
    }
    if (this.data.searching) return;
    this.setData({ searching: true, searched: false, error: '', candidates: [], seasonLoading: false });
    this._resetSelection();
    try {
      const res = await this._searchWithRetry(keyword);
      const result = res && res.result;
      if (!result || !result.success) {
        this.setData({
          searching: false,
          searched: true,
          error: (result && result.error) || '搜索失败，请稍后重试'
        });
        return;
      }
      const candidates = (result.candidates || []).map(decorateCandidate);
      this.setData({ searching: false, searched: true, candidates, error: '' });
      this._appendSeasonExtras(keyword, candidates);   // 不 await：豆瓣列表已展示，缺的季几秒后追加
    } catch (e) {
      console.error('daily movie search fail', e);
      // 超时和真断网要说不同的话：前者重试有用（豆瓣时好时坏），后者重试没用。
      // 云函数被平台超时杀掉时 errMsg 里带 -504003 / timed out
      const msg = String((e && (e.errMsg || e.message)) || '');
      const timedOut = /504003|timed out|timeout|超时/i.test(msg);
      this.setData({
        searching: false,
        searched: true,
        error: timedOut ? '搜索超时了，再试一次' : '网络异常，请稍后重试'
      });
    }
  },

  onSelectMovie(e) {
    const key = e.currentTarget.dataset.key;
    const selected = this.data.candidates.find(item => String(item.key) === String(key));
    if (!selected) return;
    // 外部源候选（时光网 / TVmaze）：无 doubanId，不能走 fetchMovieFullInfo，直接用候选自带字段
    if (isExternalSource(selected)) {
      this._selectExternal(selected);
      return;
    }
    this.setData({
      selected,
      posterSrc: selected.posterThumb || '/images/default-movie.jpg',
      movieMeta: buildMeta(selected.year, selected.director),
      ratingsLoading: true,
      ratingsError: '',
      ratingCells: [],
      movieFull: null,
      mtimeMode: false,
      hasEpisodes: false,
      totalEpisodes: 0,
      currentEpisode: '',
      episodeProgressText: ''
    });
    // 保存在飞的 Promise：提交时若云封面还没就绪，onSubmit 会 await 它
    this._fullInfoPromise = this._fetchFullRatings(selected.doubanId);
  },

  // 选中外部源候选（时光网 / TVmaze）：不抓评分，按候选字段直接展示；电视剧允许记「看到第几集」
  // （时光网无总集数分母；TVmaze 季候选带 totalEpisodes，进度条有分母）
  _selectExternal(selected) {
    const isTv = selected.subtype === 'tv';
    this._fullInfoPromise = null;
    this.setData({
      selected,
      posterSrc: selected.posterThumb || selected.posterUrl || '/images/default-movie.jpg',
      movieMeta: buildMeta(selected.year, selected.director),
      ratingsLoading: false,
      ratingsError: '',
      ratingCells: [],
      movieFull: null,
      mtimeMode: true,
      hasEpisodes: isTv,
      totalEpisodes: Number(selected.totalEpisodes) || 0,
      currentEpisode: '',
      episodeProgressText: ''
    });
  },

  // 拉取全平台评分（豆瓣/IMDb/新鲜度/爆米花），首次约 10s，命中缓存秒回
  async _fetchFullRatings(doubanId) {
    try {
      const res = await wx.cloud.callFunction({
        name: 'fetchMovieFullInfo',
        data: { doubanId, skipUserQuery: true }
      });
      // 用户可能已重新选择/清空，丢弃过期结果
      if (!this.data.selected || String(this.data.selected.doubanId) !== String(doubanId)) return;

      const result = res && res.result;
      if (!result || !result.success || !result.movie) {
        this.setData({ ratingsLoading: false, ratingsError: '评分获取失败，可直接记录' });
        return;
      }
      const mv = decorateMovie(result.movie);
      // 剧集判定：subtype==='tv' 视为电视剧 → 允许填「看到第几集」；总集数作分母（0=未知）。
      // 「继续观看」带入时已预置 total/hasEpisodes，若这次抓取无集数（老缓存）则沿用预置值，不下调。
      const totalEpisodes = (Number(mv.episodesCount) || 0) || (Number(this.data.totalEpisodes) || 0);
      const hasEpisodes = mv.subtype === 'tv' || totalEpisodes > 1 || this.data.hasEpisodes;
      this.setData({
        ratingsLoading: false,
        ratingsError: '',
        ratingCells: buildRatingCells(mv),
        movieFull: mv,
        hasEpisodes,
        totalEpisodes,
        posterSrc: mv.poster || this.data.posterSrc,
        movieMeta: buildMeta(mv.year || this.data.selected.year, mv.directorText || this.data.selected.director)
      });
      this._syncEpisodeProgress();
    } catch (e) {
      console.error('daily movie full info fail', e);
      if (!this.data.selected || String(this.data.selected.doubanId) !== String(doubanId)) return;
      this.setData({ ratingsLoading: false, ratingsError: '评分获取失败，可直接记录' });
    }
  },

  // 重新选择：退回候选列表，保留已有搜索结果
  onReselect() {
    this._resetSelection();
  },

  onDateChange(e) {
    const date = e.detail.value;
    this.setData({ date, dateText: formatDateText(date) });
  },

  // 五角星评分：半星点按——每颗星左半热区=X.5、右半=X.0（data-value 已算好），一点即准
  onStarTap(e) {
    let v = Number(e.currentTarget.dataset.value) || 0.5;
    if (v < 0.5) v = 0.5;
    if (v > 5) v = 5;
    if (v === this.data.rating) return;
    this.setData({ rating: v, ratingLabel: `${v.toFixed(1)} 星`, stars: buildStars(v) });
  },

  // 拖拽评分：touchstart 只测量星条位置，touchmove 按落点实时改分（点按仍走 onStarTap，互不冲突）
  onStarTouchStart() {
    wx.createSelectorQuery().in(this).select('.star-row').boundingClientRect(rect => {
      if (rect && rect.width) this._starRect = rect;
    }).exec();
  },
  onStarTouchMove(e) {
    const rect = this._starRect;
    if (!rect || !rect.width) return;
    const t = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]);
    if (!t) return;
    const v = starValueFromX(t.clientX, rect);
    if (v === this.data.rating) return;
    this.setData({ rating: v, ratingLabel: `${v.toFixed(1)} 星`, stars: buildStars(v) });
  },

  onMoodTap(e) {
    const key = e.currentTarget.dataset.key;
    // 再次点击当前心情可取消
    const mood = this.data.mood === key ? '' : key;
    this.setData({ mood, visibleMoods: computeVisibleMoods(MOOD_OPTIONS, mood) });
  },

  onOpenMoodModal() {
    this.setData({ moodModal: true });
  },
  onCloseMoodModal() {
    this.setData({ moodModal: false });
  },
  onPickMood(e) {
    const key = e.currentTarget.dataset.key;
    const mood = this.data.mood === key ? '' : key;
    this.setData({ mood, moodModal: false, visibleMoods: computeVisibleMoods(MOOD_OPTIONS, mood) });
  },

  onNoteInput(e) {
    const note = e.detail.value || '';
    this.setData({ note, noteCount: note.length });
  },

  // 看到第几集：只留数字、去前导零；已知总集数则钳制到上限（返回自纠正后的值回写输入框）
  // 镜像每日读书 onCurrentPageInput
  onCurrentEpisodeInput(e) {
    const digits = String(e.detail.value || '').replace(/\D/g, '').replace(/^0+(?=\d)/, '');
    let currentEpisode = digits;
    const total = Number(this.data.totalEpisodes) || 0;
    if (total && digits && Number(digits) > total) currentEpisode = String(total);
    this.setData({ currentEpisode });
    this._syncEpisodeProgress();
    return currentEpisode;
  },

  _syncEpisodeProgress() {
    const total = Number(this.data.totalEpisodes) || 0;
    const cur = Number(this.data.currentEpisode) || 0;
    if (!total || !cur) {
      if (this.data.episodeProgressText) this.setData({ episodeProgressText: '' });
      return;
    }
    const pct = Math.min(100, Math.round(cur / total * 100));
    this.setData({ episodeProgressText: `${pct}%` });
  },

  async onSubmit() {
    if (this.data.submitting) return;
    const selected = this.data.selected;
    if (!selected) {
      toast.show(this, '请先选择电影');
      return;
    }
    this.setData({ submitting: true });

    // 保证封面尽量落 cloud://（canvas 分享只认云存储封面）：
    // 若全平台信息还在飞，先等它把已转存的 cloud:// 封面拿回来再存。
    const isCloud = p => typeof p === 'string' && p.indexOf('cloud://') === 0;
    let full = this.data.movieFull || {};
    if (!isCloud(full.poster) && this._fullInfoPromise) {
      try { await this._fullInfoPromise; } catch (e) {}
      // 期间用户可能已重选/离开
      if (!this.data.selected || String(this.data.selected.doubanId) !== String(selected.doubanId)) {
        this.setData({ submitting: false });
        return;
      }
      full = this.data.movieFull || {};
    }

    const moodOpt = MOOD_OPTIONS.find(m => m.key === this.data.mood);
    // poster 优先 cloud://（供 canvas 海报）；拿不到再退豆瓣直链（仅供列表 <image> 展示）。
    // originalPoster 存豆瓣原图，供迁移/重试转存云存储时使用。
    const cloudPoster = isCloud(full.poster) ? full.poster : '';
    // 外部源候选可能带 posterLarge（TVmaze 原图 2~3 MB）：列表用小图，落库交给服务端镜像大图
    const rawPoster = full.originalPoster || selected.posterLarge || selected.posterUrl || '';
    const meta = {
      doubanId: selected.doubanId || '',
      // 外部源候选：无 doubanId，用 mtimeId / tvmazeId(+tvmazeSeason) + source 标记来源（platform 各项自然为空）
      mtimeId: selected.mtimeId || '',
      tvmazeId: selected.tvmazeId || '',
      tvmazeSeason: Number(selected.tvmazeSeason) || 0,
      source: selected.source || 'douban',
      title: selected.title || '',
      year: full.year || selected.year || '',
      poster: cloudPoster || rawPoster,
      originalPoster: rawPoster,
      director: full.directorText || selected.director || '',
      genres: Array.isArray(full.genres) ? full.genres.slice(0, 4) : [],
      // 剧集进度：subtype 标记电视剧，totalEpisodes 0=未知，currentEpisode 0=未填
      subtype: full.subtype || selected.subtype || '',
      totalEpisodes: this.data.hasEpisodes ? (Number(this.data.totalEpisodes) || 0) : 0,
      currentEpisode: this.data.hasEpisodes ? (Number(this.data.currentEpisode) || 0) : 0,
      rating: Number(this.data.rating) || 0,
      mood: this.data.mood || '',
      moodEmoji: moodOpt ? moodOpt.emoji : '',
      moodLabel: moodOpt ? moodOpt.label : '',
      // 全平台评分快照，供片单列表展示
      platform: {
        douban: full.douban && full.douban.rating ? String(full.douban.rating) : '',
        imdb: full.imdb && full.imdb.rating ? String(full.imdb.rating) : '',
        rtCritic: full.hasRtCritic ? full.rtCriticText : '',
        rtAudience: full.hasRtAudience ? full.rtAudienceText : ''
      },
      note: (this.data.note || '').trim()
    };
    wx.cloud.callFunction({
      name: 'syncDailyLog',
      data: { action: 'addEntry', theme: 'movie', date: this.data.date, value: 1, meta },
      success: res => {
        const result = res && res.result;
        if (!result || !result.success) {
          toast.show(this, '记录失败');
          return;
        }
        trackDaily('movie', this.route);
        markTimeline.record(this, 'daily:movie', 'checkin', [meta]); // 埋点：打卡成功
        toast.show(this, '已记录', { icon: 'success' });
        setTimeout(() => {
          wx.navigateBack();
        }, 450);
      },
      fail: err => {
        console.error('daily movie add fail', err);
        toast.show(this, '网络异常');
      },
      complete: () => {
        this.setData({ submitting: false });
      }
    });
  }
});
