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

const MODE = 'cross';

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
        guessesLeft: 12,
        maxGuesses: 12,
        score: 0,
        finished: false
    },

    onLoad() {
        this._date = null;   // null = 今天，由服务端按中国时区判定
        this.refresh();
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
                maxGuesses: st.maxGuesses || 12,
                guessesLeft: Math.max(0, (st.maxGuesses || 12) - (rec.guessesUsed || 0)),
                score: rec.score || 0,
                finished: !!rec.finished
            });
            if (!this._today) this._today = puzzle.date || '';
            this._buildBoard();
            // 断线重连：把已答出的条目填回盘面
            this._applySolved(st.solved || []);
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
            this.setData({
                maxGuesses: st.maxGuesses || this.data.maxGuesses,
                guessesLeft: Math.max(0, (st.maxGuesses || this.data.maxGuesses) - (rec.guessesUsed || 0)),
                score: rec.score || 0,
                finished: !!rec.finished
            });
            this._applySolved(st.solved || []);
        } catch (e) { /* 静默：进度刷新失败不该打断正在玩的这局 */ }
    },

    /** 按 mask 铺盘，并把每条的起始格标上序号 */
    _buildBoard() {
        const mask = this._mask || [];
        // chip = 填这一格的字池下标，−1 表示空；退格要靠它把那一份字还回去
        const board = mask.map(row => row.map(m => ({
            on: !!m, ch: '', chip: -1, locked: false, active: false, focus: false, no: 0
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
            const rec = r.record || {};
            this.setData({
                submitting: false,
                guessesLeft: Math.max(0, (r.maxGuesses || this.data.maxGuesses) - (rec.guessesUsed || 0)),
                score: rec.score || 0,
                finished: !!rec.finished
            });
            if (r.correct) {
                this._applySolved([r.entry]);
                wx.showToast({ title: '答对了：' + r.entry.word, icon: 'none' });
            } else {
                // 错了就把这条清空重来（锁定的交叉格留着）
                this._clearEntry(cur);
                wx.showToast({ title: '不对，再想想', icon: 'none' });
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

    async onHint() {
        if (this.data.finished) return;
        const cur = this.data.entries.find(x => x.no === this.data.currentNo);
        if (!cur || cur.solved) return;
        const ok = await new Promise(resolve => {
            wx.showModal({
                title: '求提示',
                content: '揭开这条的下一个字，消耗一次机会。',
                success: r => resolve(!!r.confirm),
                fail: () => resolve(false)
            });
        });
        if (!ok) return;
        try {
            const res = await wx.cloud.callFunction({
                name: 'submitGuess',
                data: { action: 'hint', mode: MODE, entryNo: cur.no, date: this._date || undefined }
            });
            const r = res.result || {};
            if (!r.success) { wx.showToast({ title: r.error || '提示失败', icon: 'none' }); return; }
            const rec = r.record || {};
            const board = this.data.board;
            const chips = this.data.chips;
            const pts = cellsOf(cur);
            // hint.chars 是从头揭开的前 N 个字，直接盖上去（并从字池扣掉相应份数）
            (r.hint.chars || '').split('').forEach((ch, i) => {
                if (!pts[i]) return;
                const cell = board[pts[i].r][pts[i].c];
                if (cell.locked || cell.ch === ch) return;
                this._freeCell(cell, chips);
                cell.chip = this._takeChip(ch, chips);
                cell.ch = ch;
            });
            this.setData({
                board, chips,
                guessesLeft: Math.max(0, (r.maxGuesses || this.data.maxGuesses) - (rec.guessesUsed || 0)),
                finished: !!rec.finished,
                focusIdx: this._firstEmptyIdx(cur)
            });
            this._syncActive();
        } catch (e) {
            wx.showToast({ title: '提示失败', icon: 'none' });
        }
    },

    onShareAppMessage() {
        return {
            title: '每日填字 · 5 部电影横竖交叉，来试试',
            path: '/pages/guess/cross/index'
        };
    }
});
