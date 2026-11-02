// 每日猜电影 · 纵横填字
//
// 7×7 网格里横竖交叉着 8 部电影的中文片名（10-30 之前的题是 5 部），线索是打过码的豆瓣简介。
// 玩家点一条线索选中它，再从底部字池点字往格子里填，填满一条后整条提交。
//
// 字池是**多重集**：一个格子一份字，重复的字给多份（《虫虫危机》给两个「虫」），
// 每份只能用一次，另混入若干干扰字。所以字池按**下标**操作而不是按字操作 ——
// 同一个字可能有好几份，用掉哪一份、退回哪一份必须对得上。
//
// **校验按整条走，不按格。** 逐格反馈「这个字对不对」等于开放暴力试错——
// 字池就二十来个字，一格格试几轮就能填满整盘。整条提交则错一次扣一次机会。
// 所以前端拿不到任何单字的对错，只有提交后服务端给的整条结果。
//
// 答案同样只在服务端：getGuessPuzzle 下发的是 mask（哪些格子要填）+ 线索 + 字池，
// 不含 entries[].word。进度存 guess_records（openid+mode+date），切后台/换设备能续上。

const rewardedAdManager = require('../../../utils/rewardedAdManager');
const subscribeConfig = require('../../../utils/subscribeConfig');

const MODE = 'cross';
// 广告位名。adConfig 里没配这个位时 rewardedAdManager.show() 直接返回 true（放行），
// 所以开发期不配也能测；真正拦住滥用的是服务端的次数上限，不是广告本身。
const AD_SLOT = 'guess_extra_rewarded';

// 往前最多回看几天（今天不算）。更早的题在库里还留着，但「每日一题」的意思是今天这一局；
// 放开无限回翻等于把它变成一个可以坐下来刷完的关卡包，也就没人惦记明天了。
// 三天够补上错过的一个周末，再往前意义不大。
const MAX_PAST_DAYS = 3;

const HOWTO_KEY = 'guessCrossHowtoSeen';

// 生命值的爱心图标：圆润的心形，还剩的是实心红、扣掉的是灰色描边（点赞按钮那种样式）。
// 原先是文字 ♥ / ♡，不同手机字体下粗细、大小都不一样，红色也偏暗
const HEART_PATH = 'M12 20.6c-.3 0-.6-.1-.8-.3C8.3 17.8 3 13.5 3 8.8 3 6.1 5.1 4 7.8 4c1.7 0 3.2.9 4.2 2.3C13 4.9 14.5 4 16.2 4 18.9 4 21 6.1 21 8.8c0 4.7-5.3 9-8.2 11.5-.2.2-.5.3-.8.3z';
function svgUri(svg) { return 'data:image/svg+xml,' + encodeURIComponent(svg); }
const HEART_ON = svgUri('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="' + HEART_PATH + '" fill="#FF2442"/></svg>');
// 计时器前的小时钟（线性图标，和计数条的灰字同色）
const CLOCK_ICON = svgUri('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#6F8244" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9.5 3h5"/></svg>');
const HEART_OFF = svgUri('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="' + HEART_PATH
    + '" fill="none" stroke="#C9C6BA" stroke-width="1.8" stroke-linejoin="round"/></svg>');
// 格子边长的上下限（rpx）。上限 90 是被宽度卡死的（7 列并排），下限 60 再小字就看不清了
const CELL_MAX = 90;
const CELL_MIN = 60;

/**
 * 这一局的成绩档位。分数留着当排行榜的依据，但「初始 100、可以扣」的分数本身没人看得懂，
 * 结束面板和分享卡都先给档位。只分三种说法：完美通关 / 通关 / 未通关 ——
 * 错没错、用没用提示，面板上的次数和答题卡上的黄格子已经说了，档位名不再重复（10-30 定）。
 * key 仍细分，留着以后做统计
 */
function gradeOf(rec, total) {
    const solved = (rec.filled || []).length;
    if (!total || solved < total) return { key: 'dead', label: '未通关' };
    if (rec.revives) return { key: 'revive', label: '通关' };
    if (rec.hintsUsed) return { key: 'hint', label: '通关' };
    if ((rec.wrongGuesses || []).length) return { key: 'wrong', label: '通关' };
    return { key: 'perfect', label: '完美通关' };
}

/** 秒数 → 「4 分 12 秒」 */
function durationText(sec) {
    if (sec == null || sec < 0) return '';
    if (sec < 60) return sec + ' 秒';
    const m = Math.floor(sec / 60);
    if (m >= 60) return Math.floor(m / 60) + ' 小时 ' + (m % 60) + ' 分';
    return m + ' 分 ' + (sec % 60) + ' 秒';
}

/**
 * 日期加减。用 UTC 解析 + UTC 取值，避免真机时区把 '2026-08-29' 解析成本地零点后
 * 又按另一个时区格式化，跨月/跨年时会差一天。服务端 cnDateStr 也是同一套做法。
 */
function shiftDate(dateStr, delta) {
    const ms = Date.parse(dateStr + 'T00:00:00Z') + delta * 86400000;
    const d = new Date(ms);
    const p = n => (n < 10 ? '0' : '') + n;
    return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate());
}

/** 两个日期相差几天（b − a） */
function dayDiff(a, b) {
    return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
}

/** 一条 entry 覆盖的所有坐标 */
function cellsOf(entry) {
    const out = [];
    for (let i = 0; i < entry.len; i++) {
        out.push({
            r: entry.r + (entry.dir === 'V' ? i : 0),
            c: entry.c + (entry.dir === 'H' ? i : 0)
        });
    }
    return out;
}

Page({
    data: {
        loading: true,
        errMsg: '',
        date: '',
        dateShort: '',      // 日期去掉年份，计数条那一行放得下
        dayOffset: 0,       // 相对今天第几天，头部显示用
        atOldest: false,    // 已经翻到可回看的最早一天，左箭头压暗
        board: [],          // [[{ on, ch, locked, active, focus, no }]]，下标即绝对坐标
        viewRows: [],       // 实际渲染哪几行（绝对行号）——空行不画，见 _buildBoard
        dockPad: 250,       // 底部为固定字池让出的高度（px），实测后覆盖，见 _measureDock
        entries: [],        // [{ no, r, c, dir, len, clue, solved, word }]
        // 字池是**多重集**：一个格子一个字，重复的字给多份（《虫虫危机》给两个「虫」），
        // 每份只能用一次。所以按下标操作，不能按字操作 —— 同一个字可能有好几份，
        // 用掉哪一份、退回哪一份必须对得上。
        chips: [],          // [{ ch, used }]，下标即身份
        currentNo: 0,
        // 只展示当前选中那条的线索：几条堆在一起会被底部字池盖住，
        // 切换靠上面那排编号标签（和点格子）
        current: null,      // { no, dir, len, clue, solved, word }
        focusIdx: 0,        // 光标在当前条目的第几个字
        canSubmit: false,
        curFilled: 0,       // 当前这条已经填了几格，提交按钮上显示「还差 N 个字」
        answers: [],        // 结束后服务端给的全部答案

        submitting: false,
        solvedCount: 0,
        lives: 3,
        maxLives: 3,
        hintsLeft: 2,
        canBuyHint: true,
        canRevive: true,
        lifeIcons: [],      // 渲染用：[true,true,false] = 还剩两颗爱心
        heartOn: HEART_ON,
        heartOff: HEART_OFF,
        clockIcon: CLOCK_ICON,
        timerText: '',      // 作答计时「03:12」，见作答计时那一段
        score: 100,      // 初始分，服务端同一口径（CROSS_START_SCORE）
        finished: false,

        // 格子边长（rpx），按屏幕剩余高度现算，见 _fitBoard。每天 8 部时棋盘基本占满 7 行，
        // 写死 90rpx 的话 iPhone 14 这类屏幕上会比一屏高出 200~300rpx
        cell: 90,
        cellFont: 38,
        cellNoFont: 18,
        showHowto: false,   // 玩法说明只在第一次玩时出现

        // —— 结束面板
        grade: null,        // { key, label }：完美通关 / 通关 / 未通关
        wrongCount: 0,
        hintCount: 0,
        summary: null       // submitGuess summary：连续天数、累计、完美次数、排行榜、用时
    },

    onLoad() {
        let seen = false;
        try { seen = !!wx.getStorageSync(HOWTO_KEY); } catch (e) { /* 读不到就当没看过 */ }
        this.setData({ showHowto: !seen });
        this._date = null;   // null = 今天，由服务端按中国时区判定
        // 提前把激励视频素材拉起来：提示/复活是用户点了才弹，现拉会让人干等几秒。
        // preload 内部有「页面不在栈顶就不 create」的守卫，不会绑错页面。
        rewardedAdManager.preload(AD_SLOT, this);
        this.refresh();
    },

    onUnload() {
        this._flushTimer();
        this._destroyed = true;
    },

    onShow() {
        // 题目一天不变，但进度可能在别的端变了
        if (!this.data.loading && this.data.date) {
            this._loadState();
            this._timerResume();
        }
    },

    /** 切到后台（含锁屏、去别的页面）就停表，并把这段时间报上去 */
    onHide() {
        this._flushTimer();
    },

    onPullDownRefresh() {
        this.refresh().then(() => wx.stopPullDownRefresh());
    },

    // ====================================================================
    // 作答计时：只算填字页停在前台、这一局还没结束的时间。
    // 切后台、离开页面、看激励视频时停表；做完（或爱心用完）停表，复活后接着走。
    // 累计值存在服务端（guess_opens.activeSeconds），作答 / 求提示 / 复活时带上这段时长，
    // 切后台时单独报一次（action:'tick'），关掉重进、换手机都能接着算。
    //   _base   打开时服务端已经记着的秒数
    //   _local  这次打开以来本地累计的秒数（已经停表的那几段）
    //   _since  正在走的这一段从什么时候开始（ms），没在走是 0
    //   _sent   _local 里已经报给服务端的部分
    // ====================================================================
    _timerReset(base) {
        if (this._tick) { clearInterval(this._tick); this._tick = null; }
        this._base = Number(base) || 0;
        this._local = 0;
        this._since = 0;
        this._sent = 0;
        this._renderTimer();
    },

    _timerResume() {
        if (this._since || this._adPlaying || this.data.finished || this.data.loading || this.data.errMsg) return;
        this._since = Date.now();
        if (!this._tick) this._tick = setInterval(() => this._renderTimer(), 1000);
        this._renderTimer();
    },

    _timerPause() {
        if (this._since) {
            this._local += (Date.now() - this._since) / 1000;
            this._since = 0;
        }
        if (this._tick) { clearInterval(this._tick); this._tick = null; }
        this._renderTimer();
    },

    _localSeconds() {
        return (this._local || 0) + (this._since ? (Date.now() - this._since) / 1000 : 0);
    },

    /** 还没报给服务端的整秒数（取走即算报过） */
    _takeDelta() {
        const done = Math.floor(this._localSeconds());
        const d = done - (this._sent || 0);
        if (d <= 0) return 0;
        this._sent = done;
        return d;
    },

    /** 停表并把没报的时长报上去（切后台 / 离开 / 换日期前） */
    _flushTimer() {
        this._timerPause();
        const d = this._takeDelta();
        if (!d || !this.data.date) return Promise.resolve();
        return this._call({ action: 'tick', activeDelta: d });
    },

    _renderTimer() {
        if (this._destroyed) return;
        const sec = Math.floor((this._base || 0) + this._localSeconds());
        const p = n => (n < 10 ? '0' : '') + n;
        const h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, s = sec % 60;
        const text = (h ? h + ':' + p(m) : p(m)) + ':' + p(s);
        if (text !== this.data.timerText) this.setData({ timerText: text });
    },

    async refresh() {
        // 下拉刷新 / 换日期：先把上一段计时报掉，再按服务端的累计值重新起表
        if (this.data.date) await this._flushTimer();
        this.setData({ loading: true, errMsg: '' });
        try {
            // _date 为空表示「今天」，交给服务端按中国时区算，前端不猜
            const d = this._date || undefined;
            const [puzzleRes, stateRes] = await Promise.all([
                wx.cloud.callFunction({ name: 'getGuessPuzzle', data: { mode: MODE, date: d } }),
                wx.cloud.callFunction({ name: 'submitGuess', data: { action: 'state', mode: MODE, date: d } })
            ]);
            const p = puzzleRes.result || {};
            if (!p.success) throw new Error(p.error || '题目加载失败');
            const puzzle = p.puzzle || {};
            this._mask = puzzle.mask || [];

            const entries = (puzzle.entries || []).map(e => Object.assign({}, e, { solved: false, word: '' }));
            const st = stateRes.result || {};
            const rec = st.record || {};

            // 这一趟没传 date 就意味着请求的是「今天」，返回的日期即服务端认定的今天。
            // 每次都更新而不是只认第一次：页面挂在后台跨了零点再下拉刷新时，
            // _today 还停在昨天的话，往后翻会把新的今天也拦掉。
            if (!this._date) this._today = puzzle.date || this._today || '';
            // 负数 = 往前第几天。要在 _today 更新之后算，跨零点刷新才不会把「今天」算成「1天后」
            const dayOffset = this._today ? dayDiff(this._today, puzzle.date || this._today) : 0;

            this.setData({
                loading: false,
                date: puzzle.date || '',
                dateShort: (puzzle.date || '').slice(5),
                dayOffset,
                atOldest: dayOffset <= -MAX_PAST_DAYS,
                entries,
                chips: (puzzle.charPool || []).map(function (ch) { return { ch: ch, used: false }; }),
                currentNo: entries.length ? entries[0].no : 0,
                focusIdx: 0,
                // 切关要清干净：_applySolved 在没有已答条目时会直接 return，
                // 不在这里归零的话上一关的「已答出 3/5」会留在计数条上
                solvedCount: 0,
                current: null,
                // 切关不清的话，上一关的答案清单会跟过来（虽然 finished 为假时不显示，但仍是脏数据）
                answers: [],
                summary: null,
                grade: null,
                score: rec.score || 0,
                finished: !!rec.finished
            });
            this._summaryFor = '';
            this._applyStatus(st);
            this._buildBoard();
            // 断线重连：先把已答出的整条填回盘面，再补上花分揭开的零散字
            this._applySolved(st.solved || []);
            this._applyRevealed(st.revealed || []);
            this._revealAnswers();
            // 计时从服务端记着的累计值接着走；已经做完的局不走
            this._timerReset(st.activeSeconds);
            this._timerResume();
        } catch (e) {
            this.setData({ loading: false, errMsg: (e && e.message) || '加载失败' });
        }
    },

    /**
     * 一局结束后把没答出来的那几条直接填回棋盘（红字），这一局的交代就在棋盘上，
     * 不再在下面另列一张片单。答案由服务端在结束后才给（answers）
     */
    _revealAnswers() {
        if (!this.data.finished || !(this.data.answers || []).length) return;
        const board = this.data.board;
        let changed = false;
        this.data.answers.forEach(a => {
            const e = this.data.entries.find(x => x.no === a.no);
            if (!e || e.solved || !a.word) return;
            cellsOf(e).forEach((pt, i) => {
                const cell = board[pt.r] && board[pt.r][pt.c];
                if (!cell || cell.locked) return;
                cell.ch = a.word[i];
                cell.chip = -1;          // 字池已经收起来了，不必再还字
                cell.locked = true;
                cell.missed = true;
                changed = true;
            });
        });
        if (changed) this.setData({ board });
    },

    /** 复活后接着做：把刚才填回去的答案再擦掉 */
    _hideAnswers() {
        const board = this.data.board;
        let changed = false;
        board.forEach(row => row.forEach(cell => {
            if (!cell.missed) return;
            cell.missed = false;
            cell.locked = false;
            cell.ch = '';
            cell.chip = -1;
            changed = true;
        }));
        if (changed) { this.setData({ board }); this._syncActive(); }
    },

    /** 刚做完时把结束面板滚进视野：8 部的棋盘占满一屏，面板在下面，不滚的话以为没反应 */
    _scrollToPanel() {
        setTimeout(() => {
            if (this._destroyed || !this.data.finished) return;
            wx.pageScrollTo({ selector: '.over', offsetTop: -16, duration: 300 });
        }, 350);
    },

    async _loadState() {
        try {
            const res = await wx.cloud.callFunction({
                name: 'submitGuess', data: { action: 'state', mode: MODE, date: this._date || undefined }
            });
            const st = res.result || {};
            if (!st.success) return;
            const rec = st.record || {};
            this._applyStatus(st);
            this._applySolved(st.solved || []);
            this._applyRevealed(st.revealed || []);
            this._revealAnswers();
        } catch (e) { /* 静默：进度刷新失败不该打断正在玩的这局 */ }
    },

    /**
     * 把服务端回来的局面字段（生命/提示/分数）落到 data。
     * 这些值**只认服务端**：前端改本地变量刷不了分，也偷不到提示次数。
     */
    _applyStatus(r) {
        if (!r) return;
        const rec = r.record || {};
        const maxLives = r.maxLives || this.data.maxLives || 3;
        const lives = r.lives == null ? this.data.lives : r.lives;
        const lifeIcons = [];
        for (let i = 0; i < maxLives; i++) lifeIcons.push(i < lives);
        const finished = !!rec.finished;
        if (r.record) this._rec = rec;   // 分享卡要按条目看错没错、用没用提示
        this.setData({
            lives: lives,
            maxLives: maxLives,
            lifeIcons: lifeIcons,
            hintsLeft: r.hintsLeft == null ? this.data.hintsLeft : r.hintsLeft,
            canBuyHint: !!r.canBuyHint,
            canRevive: !!r.canRevive,
            answers: r.answers || this.data.answers || [],
            score: rec.score == null ? this.data.score : rec.score,
            finished: finished,
            grade: finished ? gradeOf(rec, this.data.entries.length) : null,
            wrongCount: (rec.wrongGuesses || []).length,
            hintCount: rec.hintsUsed || 0
        });
        // 做完 / 爱心用完就停表；复活后接着走
        if (finished) this._timerPause(); else this._timerResume();
        if (finished) this._loadSummary();
        // 字池随结束消失 / 复活后又回来，棋盘可用高度跟着变
        this._measureDock();
    },

    /**
     * 结束面板的数（连续天数、排行榜、用时）。同一天只拉一次；
     * 复活后又做完会再结束一次，名次可能变，所以按「日期 + 分数」判断要不要重拉
     */
    async _loadSummary() {
        const key = this.data.date + '|' + this.data.score;
        if (this._summaryFor === key) return;
        this._summaryFor = key;
        const r = await this._call({ action: 'summary' });
        if (this._destroyed || this._summaryFor !== key || !r || !r.success) return;
        const rank = r.rank || {};
        const top = rank.top || [];
        this.setData({
            summary: {
                streak: r.streak || 0,
                totalDays: r.totalDays || 0,
                perfectDays: r.perfectDays || 0,
                duration: durationText(r.seconds),
                seconds: r.seconds,
                total: rank.total || 0,
                myRank: rank.myRank || 0,   // 只有进了前 10 才有
                timeCol: rank.timeCol || '用时',   // 那一列的表头：11-03 起是用时，之前是做完的钟点
                top: top,
                meAvatar: rank.meAvatar || ''   // 没进前 10 时，末尾「我 · 未上榜」那行用
            }
        });
    },

    /**
     * 量一下底部字池实际多高，据此给页面底部留白。
     * 写死一个值不行：字池行数随字数变（24 字 3 行、32 字 4 行），
     * 留多了棋盘偏上、上下留白不对称，留少了字池盖住棋盘最后一行。
     */
    _measureDock() {
        wx.createSelectorQuery().in(this).select('.dock').boundingClientRect(rect => {
            if (this._destroyed) return;
            if (rect && rect.height) {
                const pad = Math.ceil(rect.height) + 12;   // 12px 呼吸位，别让棋盘贴着字池
                if (pad !== this.data.dockPad) this.setData({ dockPad: pad });
            }
            this._fitBoard();
        }).exec();
    },

    /**
     * 按屏幕剩余高度定格子边长：棋盘上沿到字池上沿之间这段高度，平分给要画的那几行。
     * 上限 90rpx（宽度卡死的，7 列要并排），下限 60rpx。
     * 做完之后字池消失、结束面板在棋盘下面可以滚，格子回到最大。
     */
    _fitBoard() {
        if (this.data.finished) {
            if (this.data.cell !== CELL_MAX) this._setCell(CELL_MAX);
            return;
        }
        wx.createSelectorQuery().in(this)
            .select('.board-wrap').boundingClientRect()
            .selectViewport().scrollOffset()
            .exec(res => {
                if (this._destroyed || !res || !res[0]) return;
                const win = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
                const k = 750 / (win.windowWidth || 375);
                const top = res[0].top + ((res[1] && res[1].scrollTop) || 0);
                const availRpx = (win.windowHeight - top - this.data.dockPad) * k;
                const rows = this.data.viewRows.length || 7;
                // 棋盘外框：上下 margin 12×2 + padding 8×2 = 40rpx；每格上下 margin 3×2 = 6rpx
                const cell = Math.max(CELL_MIN, Math.min(CELL_MAX, Math.floor((availRpx - 40) / rows - 6)));
                if (cell !== this.data.cell) this._setCell(cell);
            });
    },

    _setCell(cell) {
        this.setData({ cell: cell, cellFont: Math.round(cell * 0.42), cellNoFont: Math.max(14, Math.round(cell * 0.2)) });
    },

    /** 按 mask 铺盘，并把每条的起始格标上序号 */
    _buildBoard() {
        const mask = this._mask || [];
        // chip = 填这一格的字池下标，−1 表示空；退格要靠它把那一份字还回去
        const board = mask.map(row => row.map(m => ({
            on: !!m, ch: '', chip: -1, locked: false, missed: false, active: false, focus: false, flash: false, no: 0
        })));
        this.data.entries.forEach(e => {
            if (board[e.r] && board[e.r][e.c]) board[e.r][e.c].no = e.no;
        });
        // 7×7 里片子不多，顶上/底下常有整行空着，全画出来棋盘就顶着一大片白。
        // 只渲染「第一个有格子的行 ~ 最后一个有格子的行」，中间的空行保留（那是题面的一部分）。
        // 存绝对行号，点击照旧按绝对坐标走——裁剪只影响画，不影响算。
        const used = board.map(row => row.some(c => c.on));
        const first = used.indexOf(true);
        const last = used.lastIndexOf(true);
        const viewRows = [];
        for (let r = first < 0 ? 0 : first; r <= (last < 0 ? board.length - 1 : last); r++) viewRows.push(r);
        this.setData({ board, viewRows });
        this._syncActive();
        this._measureDock();
    },

    /** 把服务端回来的已答出条目写进盘面并锁死 */
    _applySolved(solved) {
        if (!solved) solved = [];
        const board = this.data.board;
        const chips = this.data.chips;
        const entries = this.data.entries.slice();
        solved.forEach(s => {
            const idx = entries.findIndex(e => e.no === s.no);
            if (idx >= 0) entries[idx] = Object.assign({}, entries[idx], { solved: true, word: s.word });
            cellsOf(s).forEach((pt, i) => {
                if (!board[pt.r] || !board[pt.r][pt.c]) return;
                const cell = board[pt.r][pt.c];
                if (cell.locked) return;                 // 交叉格可能已被另一条锁过
                // 玩家自己填对的那一格保留原来占用的份数，别重复扣
                if (cell.ch !== s.word[i]) {
                    this._freeCell(cell, chips);
                    cell.chip = this._takeChip(s.word[i], chips);
                    cell.ch = s.word[i];
                }
                cell.locked = true;
            });
        });
        // 当前这条要是还没答出就别动它 —— onShow 回到页面时也会走这里，
        // 无条件重置会把玩家正在填的那条选择弄丢。
        const keep = entries.find(e => e.no === this.data.currentNo && !e.solved);
        const next = keep || entries.find(e => !e.solved);
        const solvedCount = entries.filter(e => e.solved).length;
        // 答出第一条就算看懂玩法了，说明那一行以后不再出现（也就多出一行高度给棋盘）
        const hideHowto = solvedCount > 0 && this.data.showHowto;
        if (hideHowto) { try { wx.setStorageSync(HOWTO_KEY, 1); } catch (e) { /* 存不上下次再显示一次 */ } }
        this.setData({
            board, chips, entries,
            solvedCount: solvedCount,
            showHowto: hideHowto ? false : this.data.showHowto,
            currentNo: next ? next.no : (entries.length ? entries[0].no : 0),
            focusIdx: keep ? this.data.focusIdx : 0
        });
        this._syncActive();
        if (hideHowto) this._fitBoard();
    },

    /**
     * 从字池里领一份字（优先没用过的），返回下标；领不到给 −1。
     * 提示和「续上已答出的条目」都会直接往格子里写字，也要走这里扣掉相应的份数，
     * 否则玩家手上会凭空多出可用的字。
     */
    _takeChip(ch, chips) {
        const i = chips.findIndex(function (x) { return x.ch === ch && !x.used; });
        if (i >= 0) chips[i].used = true;
        return i;
    },

    /** 清空一格，并把它占用的那份字还回字池 */
    _freeCell(cell, chips) {
        if (cell.chip >= 0 && chips[cell.chip]) chips[cell.chip].used = false;
        cell.ch = '';
        cell.chip = -1;
    },

    /** 重算高亮 / 光标 / 提交可用，盘面变了就调一次 */
    _syncActive() {
        const board = this.data.board;
        const cur = this.data.entries.find(e => e.no === this.data.currentNo);
        board.forEach(row => row.forEach(cell => { cell.active = false; cell.focus = false; }));
        let filled = 0;
        if (cur) {
            const pts = cellsOf(cur);
            pts.forEach((pt, i) => {
                const cell = board[pt.r] && board[pt.r][pt.c];
                if (!cell) return;
                cell.active = true;
                if (cell.ch) filled++;
                if (i === this.data.focusIdx) cell.focus = true;
            });
        }
        this.setData({
            board,
            curFilled: filled,
            current: cur ? {
                no: cur.no, dir: cur.dir, len: cur.len,
                // info =「1994 · 美国 · 剧情/犯罪」，2026-10-30 起的题才有，老题为空就不显示
                clue: cur.clue, info: cur.info || '', solved: cur.solved, word: cur.word
            } : null,
            canSubmit: !!cur && !cur.solved && filled === cur.len && !this.data.submitting
        });
    },

    prevDay() { this._shiftDay(-1); },
    nextDay() { this._shiftDay(1); },

    /**
     * 切到相邻日期。题目是按日期备好的（prepare 备了 30 天），所以切日期就等于换一关；
     * 进度也是按 openid+mode+date 存的，换日期自然是一局新的。
     *
     * **往后翻不能越过今天。** 后面 30 天的题在库里都是现成的，不拦就等于把明天的
     * 答案提前发出去，每日一题也就没有「每日」可言了。今天以后的日期一律转成订阅弹窗。
     *
     * **往前最多 MAX_PAST_DAYS 天。** 见常量处的说明。
     */
    _shiftDay(delta) {
        if (this.data.loading || !this.data.date) return;
        const target = shiftDate(this.data.date, delta);
        if (delta > 0 && this._today && target > this._today) {
            this._offerTomorrow();
            return;
        }
        if (delta < 0 && this._today && dayDiff(target, this._today) > MAX_PAST_DAYS) {
            wx.showToast({ title: '只能回看最近 ' + MAX_PAST_DAYS + ' 天的题', icon: 'none' });
            return;
        }
        this._date = target;
        this.refresh();
    },

    /**
     * 想看明天的题时的去处：明天零点才开，顺手给个订阅入口。
     * 订阅走 deferToNextDay —— 用户要的是「明天有新题了叫我」，当天再推一条没有意义。
     */
    async _offerTomorrow() {
        const tplId = subscribeConfig.getTemplateId('guessCrossDaily');
        if (!tplId) {
            wx.showToast({ title: '明天零点更新新题', icon: 'none' });
            return;
        }
        const ok = await this._confirm(
            '明天的题还没开',
            '每天零点更新一局新的。订阅提醒的话，明天上午 10 点叫你来玩。'
        );
        if (!ok) return;
        this._subscribe(tplId);
    },

    /** 结束面板上的「明早 10 点提醒我」：用户已经主动点了，不再多弹一层确认 */
    onSubscribe() {
        const tplId = subscribeConfig.getTemplateId('guessCrossDaily');
        if (!tplId) {
            wx.showToast({ title: '明天零点更新新题', icon: 'none' });
            return;
        }
        this._subscribe(tplId);
    },

    _subscribe(tplId) {
        wx.requestSubscribeMessage({
            tmplIds: [tplId],
            success: res => {
                if (res[tplId] !== 'accept') {
                    wx.showToast({ title: '没订阅上，明天记得来', icon: 'none' });
                    return;
                }
                wx.cloud.callFunction({
                    name: 'subscribeMessage',
                    data: { topic: 'guessCrossDaily', templateId: tplId, accepted: true, theme: MODE, deferToNextDay: true }
                }).then(r => {
                    const done = r && r.result && r.result.success;
                    wx.showToast({ title: done ? '订好了，明早 10 点见' : '没记上，稍后再试', icon: 'none' });
                }).catch(() => wx.showToast({ title: '没记上，稍后再试', icon: 'none' }));
            },
            fail: () => wx.showToast({ title: '订阅没成功', icon: 'none' })
        });
    },

    onTapClue(e) {
        const no = Number(e.currentTarget.dataset.no);
        const entry = this.data.entries.find(x => x.no === no);
        if (!entry) return;
        // 已答出的也让点开看：线索区只显示当前这条，不给看就没法回顾了
        this.setData({ currentNo: no, focusIdx: entry.solved ? 0 : this._firstEmptyIdx(entry) });
        this._syncActive();
    },

    /** 点格子：若属于当前条目就移光标；若属于别的条目就切过去 */
    onTapCell(e) {
        const r = Number(e.currentTarget.dataset.r);
        const c = Number(e.currentTarget.dataset.c);
        const cell = this.data.board[r] && this.data.board[r][c];
        if (!cell || !cell.on) return;
        const cur = this.data.entries.find(x => x.no === this.data.currentNo);
        if (cur && !cur.solved) {
            const idx = cellsOf(cur).findIndex(p => p.r === r && p.c === c);
            if (idx >= 0) { this.setData({ focusIdx: idx }); this._syncActive(); return; }
        }
        // 交叉格可能同时属于两条，优先挑还没答出的那条
        const owner = this.data.entries.find(x =>
            !x.solved && cellsOf(x).some(p => p.r === r && p.c === c));
        if (!owner) return;
        const idx = cellsOf(owner).findIndex(p => p.r === r && p.c === c);
        this.setData({ currentNo: owner.no, focusIdx: Math.max(0, idx) });
        this._syncActive();
    },

    _firstEmptyIdx(entry) {
        const pts = cellsOf(entry);
        for (let i = 0; i < pts.length; i++) {
            const cell = this.data.board[pts[i].r] && this.data.board[pts[i].r][pts[i].c];
            if (cell && !cell.ch) return i;
        }
        return 0;
    },

    onTapChar(e) {
        if (this.data.finished) return;
        const idx = Number(e.currentTarget.dataset.i);
        const chips = this.data.chips;
        const chip = chips[idx];
        if (!chip || chip.used) return;          // 用过的那一份点不动
        const cur = this.data.entries.find(x => x.no === this.data.currentNo);
        if (!cur || cur.solved) return;
        const pts = cellsOf(cur);
        const pt = pts[this.data.focusIdx];
        if (!pt) return;
        const board = this.data.board;
        const cell = board[pt.r][pt.c];
        // 交叉格若已被另一条锁定，跳过它继续往后填
        if (cell.locked) {
            this.setData({ focusIdx: Math.min(pts.length - 1, this.data.focusIdx + 1) });
            this._syncActive();
            return;
        }
        // 这一格原本有字就先把那一份还回去，再放新的
        this._freeCell(cell, chips);
        chip.used = true;
        cell.ch = chip.ch;
        cell.chip = idx;
        // 光标自动往后挪到下一个空位，全填满就停在最后
        let next = this.data.focusIdx + 1;
        while (next < pts.length && board[pts[next].r][pts[next].c].locked) next++;
        this.setData({ board, chips, focusIdx: Math.min(next, pts.length - 1) });
        this._syncActive();
    },

    onBackspace() {
        const cur = this.data.entries.find(x => x.no === this.data.currentNo);
        if (!cur || cur.solved) return;
        const pts = cellsOf(cur);
        const board = this.data.board;
        // 从光标往回找第一个能删的（锁定格不能删——那是别的条目答对了的）
        let i = this.data.focusIdx;
        if (i >= pts.length || !board[pts[i].r][pts[i].c].ch) i--;
        while (i >= 0 && board[pts[i].r][pts[i].c].locked) i--;
        if (i < 0) return;
        const chips = this.data.chips;
        this._freeCell(board[pts[i].r][pts[i].c], chips);
        this.setData({ board, chips, focusIdx: i });
        this._syncActive();
    },

    async onSubmit() {
        if (!this.data.canSubmit || this.data.submitting) return;
        const cur = this.data.entries.find(x => x.no === this.data.currentNo);
        if (!cur) return;
        const chars = cellsOf(cur).map(p => this.data.board[p.r][p.c].ch);
        this.setData({ submitting: true });
        try {
            const res = await wx.cloud.callFunction({
                name: 'submitGuess',
                // ⚠ date 必须带上：submitGuess 里 date 缺省取今天，翻到别的日期做题时
                // 会拿今天那道题的第 N 条来比对，判错且串词
                data: { action: 'answer', mode: MODE, entryNo: cur.no, chars, date: this._date || undefined, activeDelta: this._takeDelta() }
            });
            const r = res.result || {};
            if (!r.success) throw new Error(r.error || '提交失败');
            this.setData({ submitting: false });
            this._applyStatus(r);
            if (r.correct) {
                this._applySolved([r.entry]);
                this._flashEntry(r.entry);
                wx.showToast({ title: '答对了《' + r.entry.word + '》', icon: 'none' });
                if (this.data.finished) this._scrollToPanel();
            } else {
                // 错了就把这条清空重来（锁定的交叉格留着）
                this._clearEntry(cur);
                if (r.finished) {
                    this._revealAnswers();
                    this._scrollToPanel();
                    this._offerRevive();
                } else {
                    // 剩几次用服务端回的 lives，不用本地推算 —— 复活/多端作答都可能让它对不上
                    const left = r.lives == null ? this.data.lives : r.lives;
                    wx.showToast({ title: '不对，扣一颗心，还剩 ' + left + ' 颗', icon: 'none' });
                }
            }
        } catch (e) {
            this.setData({ submitting: false });
            wx.showToast({ title: (e && e.message) || '提交失败', icon: 'none' });
        }
    },

    _clearEntry(entry) {
        const board = this.data.board;
        const chips = this.data.chips;
        cellsOf(entry).forEach(p => {
            const cell = board[p.r][p.c];
            if (cell && !cell.locked) this._freeCell(cell, chips);
        });
        this.setData({ board, chips, focusIdx: this._firstEmptyIdx(entry) });
        this._syncActive();
    },

    /**
     * 求提示。每天 2 次免费，用完可以看激励视频再换一次（服务端封顶）。
     * 提示按「逐字揭开当前这条」发放，每次 −5 分。
     */
    async onHint() {
        if (this.data.finished) return;
        const cur = this.data.entries.find(x => x.no === this.data.currentNo);
        if (!cur || cur.solved) return;

        if (this.data.hintsLeft <= 0) {
            const ok = await this._confirm('提示用完了', '看一段视频可以再得一次提示，可以反复看。每用一次提示扣 5 分。');
            if (!ok) return;
            const watched = await this._watchAd();
            if (!watched) return;
            const g = await this._call({ action: 'grantHint' });
            if (!g || !g.granted) {
                wx.showToast({ title: (g && g.error) || '没能拿到提示', icon: 'none' });
                return;
            }
            this._applyStatus(g);
        } else {
            // 能不能揭、还能揭几个，判断全在服务端（要考虑交叉格带来的已知位，
            // 前端再算一遍必然走样）。这里只说清楚会发生什么。
            const ok = await this._confirm('用一次提示', '在这条里随机亮出一个还没揭开的字，扣 5 分。');
            if (!ok) return;
        }

        const r = await this._call({ action: 'hint', entryNo: cur.no });
        if (!r || !r.success) { wx.showToast({ title: (r && r.error) || '提示失败', icon: 'none' }); return; }
        if (!r.hinted) { wx.showToast({ title: r.error || '这条没法再提示了', icon: 'none' }); this._applyStatus(r); return; }
        const board = this.data.board;
        const chips = this.data.chips;
        this._revealCell(board, chips, r.hint, true);
        this.setData({ board, chips, focusIdx: this._firstEmptyIdx(cur) });
        this._flashCell(r.hint.r, r.hint.c);
        this._applyStatus(r);
        this._syncActive();
    },

    /**
     * 把一个揭出来的字放进格子并锁住：提示是花分买的，不该被误删或被别的字覆盖。
     * 同样要从字池扣掉一份，否则玩家手上会凭空多出可用的字。
     */
    _revealCell(board, chips, h, flash) {
        if (!h || h.r == null || h.c == null) return;
        const cell = board[h.r] && board[h.r][h.c];
        if (!cell || cell.locked) return;
        if (cell.ch !== h.ch) {
            this._freeCell(cell, chips);
            cell.chip = this._takeChip(h.ch, chips);
            cell.ch = h.ch;
        }
        cell.locked = true;
        if (flash) cell.flash = true;
    },

    /**
     * 让刚揭出来的格子闪一下。
     * 随机揭字之后这个提示是必需的：字会落在这条的任意一格，而格子在页面上方、
     * 离底部按钮很远，不给视觉反馈的话用户看完广告回来根本不知道哪儿变了。
     */
    _flashCell(r, c) {
        const key = 'board[' + r + '][' + c + '].flash';
        setTimeout(() => {
            if (this._destroyed) return;
            const patch = {};
            patch[key] = false;
            this.setData(patch);
        }, 1400);
    },

    /** 答对一整条时把这条逐格点亮一下，比只弹个 toast 有交代得多 */
    _flashEntry(entry) {
        const board = this.data.board;
        cellsOf(entry).forEach((pt, i) => {
            const cell = board[pt.r] && board[pt.r][pt.c];
            if (cell) cell.flash = true;
            this._flashCell(pt.r, pt.c);
        });
        this.setData({ board });
    },

    /** 断线重进时把之前花分揭出来的字复原 */
    _applyRevealed(revealed) {
        if (!revealed || !revealed.length) return;
        const board = this.data.board;
        const chips = this.data.chips;
        revealed.forEach(h => this._revealCell(board, chips, h, false));
        this.setData({ board, chips });
        this._syncActive();
    },

    /** 爱心扣完后问要不要看广告补一颗 */
    async _offerRevive() {
        // 复活不限次数，这里只挡「生命值已满」这种没意义的调用
        if (!this.data.canRevive) {
            wx.showToast({ title: '爱心已经是满的', icon: 'none' });
            return;
        }
        const ok = await this._confirm('爱心用完了', '看一段视频可以补回一颗心，接着答。答错照样扣 10 分。');
        if (!ok) return;
        const watched = await this._watchAd();
        if (!watched) return;
        const r = await this._call({ action: 'revive' });
        if (!r || !r.revived) {
            wx.showToast({ title: (r && r.error) || '没能补回爱心', icon: 'none' });
            return;
        }
        this._applyStatus(r);
        this._hideAnswers();
        wx.showToast({ title: '补回一颗心', icon: 'none' });
    },

    /** 结束面板上的复活按钮 */
    onRevive() { this._offerRevive(); },

    /** 看激励视频：看的这段时间不算作答用时 */
    async _watchAd() {
        this._adPlaying = true;
        this._timerPause();
        try {
            return await rewardedAdManager.show(AD_SLOT, this);
        } finally {
            this._adPlaying = false;
            this._timerResume();
        }
    },

    _confirm(title, content) {
        return new Promise(resolve => {
            wx.showModal({
                title: title, content: content,
                success: r => resolve(!!r.confirm),
                fail: () => resolve(false)
            });
        });
    },

    /** submitGuess 调用的统一出口：mode 和 date 一处补齐，免得又漏传日期 */
    async _call(data) {
        // 求提示 / 换提示 / 复活都顺带把这段作答用时报上去（见作答计时那一段）
        if (['hint', 'grantHint', 'revive'].indexOf(data.action) >= 0 && data.activeDelta == null) {
            data = Object.assign({}, data, { activeDelta: this._takeDelta() });
        }
        try {
            const res = await wx.cloud.callFunction({
                name: 'submitGuess',
                data: Object.assign({ mode: MODE, date: this._date || undefined }, data)
            });
            return res.result || null;
        } catch (e) {
            return null;
        }
    },
    /**
     * 生成分享卡：把这一局的成绩交给 share 页画图。
     * 每条只给「干净答出 / 答出但错过或用过提示 / 没答出」三种状态，不带片名，分享出去不剧透
     */
    onShareCard() {
        const rec = this._rec || {};
        const filled = (rec.filled || []).map(Number);
        // 每条的结果：clean 一次答对 / mixed 错过或用过提示 / miss 没答出
        const stateOf = {};
        this.data.entries.forEach(e => {
            if (filled.indexOf(e.no) < 0) { stateOf[e.no] = 'miss'; return; }
            const wrong = (rec.wrongGuesses || []).some(x => x.entryNo === e.no);
            const hinted = (rec.hints || []).some(x => x.entryNo === e.no);
            stateOf[e.no] = wrong || hinted ? 'mixed' : 'clean';
        });
        // 当天的棋盘：只取有格子的那几行。交叉格属于两条，按「答出的那条里最差的」上色，
        // 两条都没答出才算 miss。字也带上（答题卡默认不画，开了「显示答案」才画）
        const board = this.data.board;
        const grid = this.data.viewRows.map(r => (board[r] || []).map((cell, c) => {
            if (!cell.on) return null;
            const owners = this.data.entries.filter(e => cellsOf(e).some(p => p.r === r && p.c === c));
            const solved = owners.map(e => stateOf[e.no]).filter(st => st !== 'miss');
            const st = !solved.length ? 'miss' : (solved.indexOf('mixed') >= 0 ? 'mixed' : 'clean');
            return { ch: cell.ch || '', no: cell.no || 0, st: st };
        }));
        const s = this.data.summary || {};
        getApp().globalData.guessShare = {
            date: this.data.date,
            grade: this.data.grade,
            score: this.data.score,
            solved: this.data.solvedCount,
            total: this.data.entries.length,
            wrong: this.data.wrongCount,
            hints: this.data.hintCount,
            duration: s.duration || '',
            seconds: s.seconds == null ? null : s.seconds,   // 答题卡上按「04:47」显示
            streak: s.streak || 0,
            myRank: s.myRank || 0,
            players: s.total || 0,
            grid: grid,
            // 不显示答案的版本把每条线索列在棋盘旁边（线索本身已经打过码，不含片名）
            clues: this.data.entries.map(e => ({ no: e.no, dir: e.dir, len: e.len, clue: e.clue || '' }))
        };
        wx.navigateTo({ url: '/pages/guess/cross/share' });
    },

    onShareAppMessage() {
        // 做完了就把成绩带进转发标题（不剧透片名）
        const g = this.data.finished && this.data.grade;
        const s = this.data.summary;
        if (g && g.key !== 'dead') {
            return {
                title: '我在每日电影填词' + g.label + (s && s.myRank ? '，今天第 ' + s.myRank + ' 名' : '') + '，来挑战',
                path: '/pages/guess/cross/index'
            };
        }
        return {
            title: '每日填字 · 八部电影横竖交叉，看剧情猜片名',
            path: '/pages/guess/cross/index'
        };
    }
});
