// 每日选片：转盘抽一部电影
//
// 选一个电影类榜单（豆瓣 TOP250、IMDb、奥斯卡、各类影单、剧集榜……，加上自己的自建影单），
// 范围选「未看」或「全部」，范围里有多少部转盘上就有多少格（字小到看不清也照画），
// 点中间的「转」，停在哪部就看哪部。
// 页面一屏只放转盘：榜单和范围收在来源胶囊点开的底部面板里；转完弹一张票根卡（截图、分享用）。
// 不限次数；今天最后一次转出的片存在本地（storage dailyPickToday），转盘下方留一条，首页卡片也读它。
// 票根上可以直接「想看 / 看过」，写的就是这个榜单里那一条的标记（batchUpdateMarks），
// 和在榜单页里点是一回事，跨榜单同步也照常生效。
//
// 纯逻辑（片池 / 转盘绘制 / 转盘角度 / 今日结果）在 utils/dailyPick.js，测试 tools/test-daily-pick.cjs。

const DataLoader = require('../../utils/dataLoader.js');
const { rankingSources, callList } = require('../customList/common.js');
const { awaitOpenid } = require('../../utils/openidWaiter.js');
const markTimeline = require('../../utils/markTimeline.js');
const { trackMark, track } = require('../../utils/track.js');
const pick = require('../../utils/dailyPick.js');
const palette = require('../../utils/daily/palette.js');

const STORE_TODAY = 'dailyPickToday';
const STORE_SOURCE = 'dailyPickSource';
const STORE_SCOPE = 'dailyPickScope';
const SPIN_MS = 4200;            // 与 index.wxss 里 .pk-wheel 的 transition 时长一致
const BULBS = 24;                // 外圈灯珠数
const WHEEL_PX = 1072;           // 转盘图边长（显示 536rpx，按 2 倍画）

/** 票根上的一行：年份 · 国家 · 导演 */
function metaOf(m) {
    return m ? [m.year, m.country, m.director ? '导演 ' + m.director : ''].filter(Boolean).join(' · ') : '';
}

function readStore(key) {
    try { return wx.getStorageSync(key); } catch (e) { return ''; }
}
function writeStore(key, v) {
    try { wx.setStorageSync(key, v); } catch (e) { /* 存不上就算了 */ }
}

Page({
    data: {
        themeClass: '',
        dateText: '',           // 10月31日 · 周六
        dateShort: '',          // 10.31（票根上的印章）
        bulbs: [],              // 灯珠角度
        sources: [],            // [{ theme, title, listId?, orderDirection? }]
        sourceKey: '',          // theme 或 customMovie:listId
        sourceTitle: '',
        scope: 'unwatched',     // unwatched | all
        counts: { all: 0, unwatched: 0 },
        loading: true,
        errMsg: '',
        poolSize: 0,            // 转盘上有几格（= 当前范围的片数）
        empty: false,           // 当前范围一部都没有
        wheelImg: '',           // canvas 画好导出的转盘图；空时露出 wheelBg 占位
        wheelBg: '',
        rotation: 0,
        spinning: false,
        today: null,            // 今日选片快照（含 status：watched / wish / ''）
        metaText: '',
        reveal: false,          // 票根卡开着
        justPicked: false,      // 刚转出来：票根弹一下
        sheet: false            // 来源面板开着
    },

    onLoad() {
        const date = pick.cnToday();
        const rec = pick.todayPick(readStore(STORE_TODAY), date);
        const scope = readStore(STORE_SCOPE) === 'all' ? 'all' : 'unwatched';
        this.setData({
            themeClass: palette.currentClass(),
            dateText: pick.dateLabel(date),
            dateShort: date.slice(5).replace('-', '.'),
            bulbs: Array.from({ length: BULBS }, (_, i) => i * 360 / BULBS),
            scope: scope,
            today: rec ? rec.movie : null,
            metaText: metaOf(rec && rec.movie),
            wheelBg: pick.wheelBackground(pick.SLOTS, 'var(--brand-accent)', 'var(--brand-tint)')
        });
        this._init();
    },

    onReady() {
        wx.createSelectorQuery().in(this).select('#pkWheelCanvas').fields({ node: true }).exec(res => {
            this._canvas = res && res[0] && res[0].node;
            if (this._canvas && this._candidates) this._renderWheel();
        });
    },

    onShow() {
        const cls = palette.currentClass();
        if (cls === this.data.themeClass) return;
        this.setData({ themeClass: cls });
        if (this._candidates) this._renderWheel();      // 换了主题色，转盘图重画
    },

    onPullDownRefresh() {
        const done = () => wx.stopPullDownRefresh();
        if (this.data.spinning || !this.data.sourceKey) { done(); return; }
        this._loadSource(this.data.sourceKey, true).then(done, done);
    },

    onUnload() {
        this._destroyed = true;
        if (this._spinTimer) clearTimeout(this._spinTimer);
    },

    async _init() {
        const sources = rankingSources('movie');
        // 自建影单也能抽（只读自己的）；读不到不影响别的
        try {
            const r = await callList('mine', {});
            (r.lists || []).filter(l => l.type === 'movie' && l.count).forEach(l => {
                sources.push({ theme: 'customMovie', listId: l._id, title: '我的影单 · ' + (l.title || '未命名') });
            });
        } catch (e) { /* 没建过 / 读失败 */ }
        if (this._destroyed) return;
        const saved = readStore(STORE_SOURCE);
        const keyOf = s => s.theme + (s.listId ? ':' + s.listId : '');
        const first = sources.find(s => keyOf(s) === saved) || sources[0];
        this.setData({ sources: sources.map(s => Object.assign({}, s, { key: keyOf(s) })) });
        if (first) this._loadSource(keyOf(first));
        else this.setData({ loading: false, errMsg: '没有可选的榜单' });
    },

    /** 读一个榜单的全部片 + 我的标记 */
    async _loadSource(key, force) {
        const src = this.data.sources.find(s => s.key === key);
        if (!src) return;
        this.setData({ sourceKey: key, sourceTitle: src.title, loading: true, errMsg: '', empty: false, wheelImg: '' });
        writeStore(STORE_SOURCE, key);
        try {
            const openid = await awaitOpenid(this, 3000);
            const opts = DataLoader.queryOptions({ orderDirection: src.orderDirection }, src.listId);
            const res = await DataLoader.loadMoviesData(src.theme, openid, !!force, opts, { silent: true });
            if (this._destroyed || this.data.sourceKey !== key) return;
            this._openid = openid;
            this._movies = res.movies || [];
            this._status = DataLoader.processMarks(res.marks || [], this._movies).markStatusMap || {};
            this.setData({ loading: false });
            this._fillWheel();
        } catch (e) {
            if (!this._destroyed) this.setData({ loading: false, errMsg: '榜单没读出来，下拉或换一个试试' });
        }
    },

    /** 当前范围的整个片池都上转盘（按榜单顺序），一部一格 */
    _fillWheel() {
        const movies = this._movies || [];
        const all = pick.poolOf(movies, this._status, 'all');
        const unwatched = pick.poolOf(movies, this._status, 'unwatched');
        this._candidates = this.data.scope === 'all' ? all : unwatched;
        this.setData({
            counts: { all: all.length, unwatched: unwatched.length },
            poolSize: this._candidates.length,
            empty: !this._candidates.length,
            wheelImg: ''
        });
        this._renderWheel();
    },

    /**
     * 把转盘画到屏幕外的 canvas 上，导出成图片再拿去转：几百格文字用节点摆太重，
     * 字号也会被内核的最小字号卡住，画成图字多小都行。canvas 没拿到时等 onReady 再画
     */
    _renderWheel() {
        const canvas = this._canvas;
        const titles = (this._candidates || []).map(m => m.title || m.name);
        if (!canvas || !titles.length) return;
        const token = this._wheelToken = (this._wheelToken || 0) + 1;
        const t = palette.get(palette.idFromClass(this.data.themeClass));
        canvas.width = WHEEL_PX;
        canvas.height = WHEEL_PX;
        pick.drawWheel(canvas.getContext('2d'), WHEEL_PX, titles,
            { accent: t.accent, tint: t.tint, mid: palette.mix(t.accent, t.tint, 0.5) });
        wx.canvasToTempFilePath({
            canvas: canvas,
            fileType: 'png',
            success: r => {
                if (!this._destroyed && token === this._wheelToken) this.setData({ wheelImg: r.tempFilePath });
            },
            fail: () => {
                if (!this._destroyed && token === this._wheelToken) this.setData({ errMsg: '转盘没画出来，下拉刷新试试' });
            }
        });
    },

    openSheet() {
        if (this.data.spinning) return;
        this.setData({ sheet: true });
    },

    closeSheet() {
        this.setData({ sheet: false });
    },

    onSource(e) {
        const key = e.currentTarget.dataset.key;
        this.setData({ sheet: false });
        if (this.data.spinning || key === this.data.sourceKey) return;
        this._loadSource(key);
    },

    onScope(e) {
        const scope = e.currentTarget.dataset.scope === 'all' ? 'all' : 'unwatched';
        if (this.data.spinning || scope === this.data.scope) return;
        this.setData({ scope: scope });
        writeStore(STORE_SCOPE, scope);
        this._fillWheel();
    },

    /** 「未看」里抽空了：一键换到「全部」 */
    onAllScope() {
        this.onScope({ currentTarget: { dataset: { scope: 'all' } } });
    },

    onRetry() {
        if (this.data.sourceKey) this._loadSource(this.data.sourceKey, true);
    },

    openReveal() {
        if (this.data.today) this.setData({ reveal: true, justPicked: false });
    },

    closeReveal() {
        this.setData({ reveal: false });
    },

    noop() {},

    /** 记下今日选片（本地）并刷新票根 / 选片条 */
    _setToday(movie, extra) {
        writeStore(STORE_TODAY, { date: pick.cnToday(), movie: movie });
        this.setData(Object.assign({ today: movie, metaText: metaOf(movie) }, extra || {}));
    },

    onSpin() {
        const n = (this._candidates || []).length;
        if (this.data.spinning || this.data.loading || !n || !this.data.wheelImg) return;   // 图没出来时转的是占位底，停下的格子对不上
        const idx = Math.floor(Math.random() * n);
        const src = this.data.sources.find(s => s.key === this.data.sourceKey) || {};
        const movie = Object.assign(pick.snapshot(this._candidates[idx], src), { status: this._status[this._candidates[idx]._id] || '' });
        this.setData({ rotation: pick.spinTo(this.data.rotation, idx, n, Math.random), spinning: true, justPicked: false });
        track('daily_pick_spin', { theme: src.theme, scope: this.data.scope });
        this._spinTimer = setTimeout(() => {
            if (this._destroyed) return;
            this._setToday(movie, { spinning: false, reveal: true, justPicked: true });
            try { wx.vibrateShort({ type: 'light' }); } catch (e) { /* 不支持就算了 */ }
        }, SPIN_MS);
    },

    /** 结果卡上的「想看 / 看过」：写这个榜单里那一条的标记，再点一次取消 */
    onMark(e) {
        const m = this.data.today;
        if (!m || this._marking) return;
        const want = e.currentTarget.dataset.status;
        const status = m.status === want ? 'unwatched' : want;
        const openid = this._openid || (getApp().globalData && getApp().globalData.openid) || '';
        if (!openid) { wx.showToast({ title: '还没拿到身份，稍后再试', icon: 'none' }); return; }
        this._marking = true;
        trackMark(m.theme, status, 'pick', 1);
        wx.cloud.callFunction({
            name: 'batchUpdateMarks',
            data: { movieIds: [m._id], status: status, openid: openid }
        }).then(res => {
            const ok = res && res.result && res.result.success;
            if (!ok) throw new Error('fail');
            const next = Object.assign({}, m, { status: status === 'unwatched' ? '' : status });
            if (this._status) {
                if (status === 'unwatched') delete this._status[m._id];
                else this._status[m._id] = status;
            }
            if (status !== 'unwatched') markTimeline.record(this, m.theme, status, [{ _id: m._id, title: m.title, year: m.year, cover: m.cover, rating: m.rating }]);
            this._setToday(next);
            // 标了「看过」而范围是「未看」：池子变了，计数跟着变（转盘上的这批先不动）
            if (this._movies) {
                const unwatched = pick.poolOf(this._movies, this._status, 'unwatched').length;
                this.setData({ 'counts.unwatched': unwatched });
            }
            wx.showToast({ title: status === 'watched' ? '已标记看过' : status === 'wish' ? '已加入想看' : '已取消标记', icon: 'none' });
        }).catch(() => {
            wx.showToast({ title: '没标记上，稍后再试', icon: 'none' });
        }).then(() => { this._marking = false; });
    },

    onShareAppMessage() {
        return { title: this._shareTitle(), path: '/pages/pick/index' };
    },

    onShareTimeline() {
        return { title: this._shareTitle() };
    },

    _shareTitle() {
        const m = this.data.today;
        return m ? '今天转到了《' + m.title + '》，你也来转一部' : '不知道看什么？转一部电影';
    }
});
