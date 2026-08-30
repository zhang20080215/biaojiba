// 每日猜电影 · 纵横填字
//
// 7×7 网格里横竖交叉着 5 部电影的中文片名，线索是打过码的豆瓣简介第一句。
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

const MODE = 'cross';
// 广告位名。adConfig 里没配这个位时 rewardedAdManager.show() 直接返回 true（放行），
// 所以开发期不配也能测；真正拦住滥用的是服务端的次数上限，不是广告本身。
const AD_SLOT = 'guess_extra_rewarded';

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
        dayOffset: 0,       // 相对今天第几天，头部显示用
        board: [],          // [[{ on, ch, locked, active, focus, no }]]
        entries: [],        // [{ no, r, c, dir, len, clue, solved, word }]
        // 字池是**多重集**：一个格子一个字，重复的字给多份（《虫虫危机》给两个「虫」），
        // 每份只能用一次。所以按下标操作，不能按字操作 —— 同一个字可能有好几份，
        // 用掉哪一份、退回哪一份必须对得上。
        chips: [],          // [{ ch, used }]，下标即身份
        currentNo: 0,
        // 只展示当前选中那条的线索：五条堆在一起会被底部字池盖住，
        // 切换靠上面那排编号标签（和点格子）
        current: null,      // { no, dir, len, clue, solved, word }
        focusIdx: 0,        // 光标在当前条目的第几个字
        canSubmit: false,
        submitting: false,
        solvedCount: 0,
        lives: 3,
        maxLives: 3,
        hintsLeft: 2,
        canBuyHint: true,
        canRevive: true,
        lifeIcons: [],      // 渲染用：[true,true,false] = 还剩两颗爱心
        score: 100,      // 初始分，服务端同一口径（CROSS_START_SCORE）
        finished: false
    },

    onLoad() {
        this._date = null;   // null = 今天，由服务端按中国时区判定
        // 提前把激励视频素材拉起来：提示/复活是用户点了才弹，现拉会让人干等几秒。
        // preload 内部有「页面不在栈顶就不 create」的守卫，不会绑错页面。
        rewardedAdManager.preload(AD_SLOT, this);
        this.refresh();
    },

    onUnload() {
        this._destroyed = true;
    },

    onShow() {
        // 题目一天不变，但进度可能在别的端变了
        if (!this.data.loading && this.data.date) this._loadState();
    },

    onPullDownRefresh() {
        this.refresh().then(() => wx.stopPullDownRefresh());
    },

    async refresh() {
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

            this.setData({
                loading: false,
                date: puzzle.date || '',
                // 第一次拿到的日期就是「今天」（那次没传 date），后面切日期都相对它算
                dayOffset: this._today ? dayDiff(this._today, puzzle.date || this._today) : 0,
                entries,
                chips: (puzzle.charPool || []).map(function (ch) { return { ch: ch, used: false }; }),
                currentNo: entries.length ? entries[0].no : 0,
                focusIdx: 0,
                // 切关要清干净：_applySolved 在没有已答条目时会直接 return，
                // 不在这里归零的话上一关的「已答出 3/5」会留在计数条上
                solvedCount: 0,
                current: null,
                score: rec.score || 0,
                finished: !!rec.finished
            });
            this._applyStatus(st);
            if (!this._today) this._today = puzzle.date || '';
            this._buildBoard();
            // 断线重连：先把已答出的整条填回盘面，再补上花分揭开的零散字
            this._applySolved(st.solved || []);
            this._applyRevealed(st.revealed || []);
        } catch (e) {
            this.setData({ loading: false, errMsg: (e && e.message) || '加载失败' });
        }
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
        this.setData({
            lives: lives,
            maxLives: maxLives,
            lifeIcons: lifeIcons,
            hintsLeft: r.hintsLeft == null ? this.data.hintsLeft : r.hintsLeft,
            canBuyHint: !!r.canBuyHint,
            canRevive: !!r.canRevive,
            score: rec.score == null ? this.data.score : rec.score,
            finished: !!rec.finished
        });
    },

    /** 按 mask 铺盘，并把每条的起始格标上序号 */
    _buildBoard() {
        const mask = this._mask || [];
        // chip = 填这一格的字池下标，−1 表示空；退格要靠它把那一份字还回去
        const board = mask.map(row => row.map(m => ({
            on: !!m, ch: '', chip: -1, locked: false, active: false, focus: false, flash: false, no: 0
        })));
        this.data.entries.forEach(e => {
            if (board[e.r] && board[e.r][e.c]) board[e.r][e.c].no = e.no;
        });
        this.setData({ board });
        this._syncActive();
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
        this.setData({
            board, chips, entries,
            solvedCount: entries.filter(e => e.solved).length,
            currentNo: next ? next.no : (entries.length ? entries[0].no : 0),
            focusIdx: keep ? this.data.focusIdx : 0
        });
        this._syncActive();
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
            current: cur ? {
                no: cur.no, dir: cur.dir, len: cur.len,
                clue: cur.clue, solved: cur.solved, word: cur.word
            } : null,
            canSubmit: !!cur && !cur.solved && filled === cur.len && !this.data.submitting
        });
    },

    prevDay() { this._shiftDay(-1); },
    nextDay() { this._shiftDay(1); },

    /**
     * 切到相邻日期。题目是按日期备好的（prepare 备了 30 天），所以切日期就等于换一关；
     * 进度也是按 openid+mode+date 存的，换日期自然是一局新的。
     * 没备到的日期不会报错 —— getGuessPuzzle 会现出一道并落库。
     */
    _shiftDay(delta) {
        if (this.data.loading || !this.data.date) return;
        this._date = shiftDate(this.data.date, delta);
        this.refresh();
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
                data: { action: 'answer', mode: MODE, entryNo: cur.no, chars, date: this._date || undefined }
            });
            const r = res.result || {};
            if (!r.success) throw new Error(r.error || '提交失败');
            this.setData({ submitting: false });
            this._applyStatus(r);
            if (r.correct) {
                this._applySolved([r.entry]);
                wx.showToast({ title: '答对了《' + r.entry.word + '》', icon: 'none' });
            } else {
                // 错了就把这条清空重来（锁定的交叉格留着）
                this._clearEntry(cur);
                if (r.finished) this._offerRevive();
                else {
                    // 剩几次用服务端回的 lives，不用本地推算 —— 复活/多端作答都可能让它对不上
                    const left = r.lives == null ? this.data.lives : r.lives;
                    wx.showToast({ title: '不对，扣一颗♥，还剩 ' + left + ' 颗', icon: 'none' });
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
            const watched = await rewardedAdManager.show(AD_SLOT, this);
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
            wx.showToast({ title: '♥ 已经是满的', icon: 'none' });
            return;
        }
        const ok = await this._confirm('♥ 用完了', '看一段视频可以补回一颗♥，接着答。答错照样扣 10 分。');
        if (!ok) return;
        const watched = await rewardedAdManager.show(AD_SLOT, this);
        if (!watched) return;
        const r = await this._call({ action: 'revive' });
        if (!r || !r.revived) {
            wx.showToast({ title: (r && r.error) || '没能补回♥', icon: 'none' });
            return;
        }
        this._applyStatus(r);
        wx.showToast({ title: '补回一颗♥', icon: 'none' });
    },

    /** 结束面板上的复活按钮 */
    onRevive() { this._offerRevive(); },

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
    onShareAppMessage() {
        return {
            title: '每日填字 · 五部电影横竖交叉，看剧情猜片名',
            path: '/pages/guess/cross/index'
        };
    }
});
