// 每日猜电影 · 纵横填字
//
// 7×7 网格里横竖交叉着 5 部电影的中文片名，线索是打过码的豆瓣简介第一句。
// 玩家点一条线索选中它，再从底部字池点字往格子里填，填满一条后整条提交。
//
// **校验按整条走，不按格。** 逐格反馈「这个字对不对」等于开放暴力试错——
// 字池就二十来个字，一格格试几轮就能填满整盘。整条提交则错一次扣一次机会。
// 所以前端拿不到任何单字的对错，只有提交后服务端给的整条结果。
//
// 答案同样只在服务端：getGuessPuzzle 下发的是 mask（哪些格子要填）+ 线索 + 字池，
// 不含 entries[].word。进度存 guess_records（openid+mode+date），切后台/换设备能续上。

const MODE = 'cross';

/**
 * 取 openid。
 * batchUpdateMarks 是**前端传 openid** 的（缺了直接返回「参数不完整」，静默失败），
 * 而 app.ensureOpenid() 不返回值也不返回 promise，所以这里自己兜一层。
 * 猜题相关的云函数不需要——submitGuess 自己从 wxContext 取。
 */
async function resolveOpenid() {
    const app = getApp();
    const cached = app && app.globalData && app.globalData.openid;
    if (cached) return cached;
    try {
        const res = await wx.cloud.callFunction({ name: 'getOpenid' });
        const openid = (res && res.result && res.result.openid) || '';
        if (openid && app && app.globalData) app.globalData.openid = openid;
        return openid;
    } catch (e) {
        return '';
    }
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
        board: [],          // [[{ on, ch, locked, active, focus, no }]]
        entries: [],        // [{ no, r, c, dir, len, clue, solved, word }]
        // 字池项预先算好 used 标记：WXML 里用变量当键取对象值（usedChars[item]）不保险，
        // 直接给数组更稳，也少一层绑定
        chips: [],          // [{ ch, used }]
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
        finished: false,
        lastCorrect: null
    },

    onLoad() {
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
            const [puzzleRes, stateRes] = await Promise.all([
                wx.cloud.callFunction({ name: 'getGuessPuzzle', data: { mode: MODE } }),
                wx.cloud.callFunction({ name: 'submitGuess', data: { action: 'state', mode: MODE } })
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
                entries,
                chips: (puzzle.charPool || []).map(function (ch) { return { ch: ch, used: false }; }),
                currentNo: entries.length ? entries[0].no : 0,
                focusIdx: 0,
                maxGuesses: st.maxGuesses || 12,
                guessesLeft: Math.max(0, (st.maxGuesses || 12) - (rec.guessesUsed || 0)),
                score: rec.score || 0,
                finished: !!rec.finished
            });
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
                name: 'submitGuess', data: { action: 'state', mode: MODE }
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
        const board = mask.map(row => row.map(m => ({
            on: !!m, ch: '', locked: false, active: false, focus: false, no: 0
        })));
        this.data.entries.forEach(e => {
            if (board[e.r] && board[e.r][e.c]) board[e.r][e.c].no = e.no;
        });
        this.setData({ board });
        this._syncActive();
    },

    /** 把服务端回来的已答出条目写进盘面并锁死 */
    _applySolved(solved) {
        if (!solved || !solved.length) return;
        const board = this.data.board;
        const entries = this.data.entries.slice();
        solved.forEach(s => {
            const idx = entries.findIndex(e => e.no === s.no);
            if (idx >= 0) entries[idx] = Object.assign({}, entries[idx], { solved: true, word: s.word });
            cellsOf(s).forEach((pt, i) => {
                if (!board[pt.r] || !board[pt.r][pt.c]) return;
                board[pt.r][pt.c].ch = s.word[i];
                board[pt.r][pt.c].locked = true;
            });
        });
        // 光标挪到第一条没答出的
        const next = entries.find(e => !e.solved);
        this.setData({
            board, entries,
            solvedCount: entries.filter(e => e.solved).length,
            currentNo: next ? next.no : (entries.length ? entries[0].no : 0),
            focusIdx: 0
        });
        this._syncActive();
    },

    /** 重算高亮 / 光标 / 字池淡色 / 提交可用，盘面变了就调一次 */
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
        const used = {};
        board.forEach(row => row.forEach(cell => { if (cell.ch) used[cell.ch] = true; }));
        const chips = this.data.chips.map(function (x) { return { ch: x.ch, used: !!used[x.ch] }; });
        this.setData({
            board, chips,
            current: cur ? {
                no: cur.no, dir: cur.dir, len: cur.len,
                clue: cur.clue, solved: cur.solved, word: cur.word
            } : null,
            canSubmit: !!cur && !cur.solved && filled === cur.len && !this.data.submitting
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
        const ch = e.currentTarget.dataset.ch;
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
        cell.ch = ch;
        // 光标自动往后挪到下一个空位，全填满就停在最后
        let next = this.data.focusIdx + 1;
        while (next < pts.length && board[pts[next].r][pts[next].c].locked) next++;
        this.setData({ board, focusIdx: Math.min(next, pts.length - 1) });
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
        board[pts[i].r][pts[i].c].ch = '';
        this.setData({ board, focusIdx: i });
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
                data: { action: 'answer', mode: MODE, entryNo: cur.no, chars }
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
                this.setData({
                    lastCorrect: {
                        word: r.entry.word,
                        movieIds: r.movieIds || []
                    }
                });
                wx.showToast({ title: '答对了', icon: 'success' });
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
        cellsOf(entry).forEach(p => {
            const cell = board[p.r][p.c];
            if (cell && !cell.locked) cell.ch = '';
        });
        this.setData({ board, focusIdx: this._firstEmptyIdx(entry) });
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
                data: { action: 'hint', mode: MODE, entryNo: cur.no }
            });
            const r = res.result || {};
            if (!r.success) { wx.showToast({ title: r.error || '提示失败', icon: 'none' }); return; }
            const rec = r.record || {};
            const board = this.data.board;
            const pts = cellsOf(cur);
            // hint.chars 是从头揭开的前 N 个字，直接盖上去
            (r.hint.chars || '').split('').forEach((ch, i) => {
                if (pts[i]) board[pts[i].r][pts[i].c].ch = ch;
            });
            this.setData({
                board,
                guessesLeft: Math.max(0, (r.maxGuesses || this.data.maxGuesses) - (rec.guessesUsed || 0)),
                finished: !!rec.finished,
                focusIdx: this._firstEmptyIdx(cur)
            });
            this._syncActive();
        } catch (e) {
            wx.showToast({ title: '提示失败', icon: 'none' });
        }
    },

    async markWatched() {
        const lc = this.data.lastCorrect;
        if (!lc || !lc.movieIds.length) {
            wx.showToast({ title: '这部片没有可标记的榜单记录', icon: 'none' });
            this.setData({ lastCorrect: null });
            return;
        }
        try {
            const openid = await resolveOpenid();
            if (!openid) { wx.showToast({ title: '标记失败：没拿到身份', icon: 'none' }); return; }
            const res = await wx.cloud.callFunction({
                name: 'batchUpdateMarks',
                data: { movieIds: lc.movieIds, status: 'watched', openid }
            });
            if (!(res.result && res.result.success)) throw new Error((res.result && res.result.error) || '标记失败');
            wx.showToast({ title: '已标记为看过', icon: 'success' });
            this.setData({ lastCorrect: null });
        } catch (e) {
            wx.showToast({ title: (e && e.message) || '标记失败', icon: 'none' });
        }
    },

    dismissCorrect() {
        this.setData({ lastCorrect: null });
    },

    onShareAppMessage() {
        return {
            title: '每日填字 · 5 部电影横竖交叉，来试试',
            path: '/pages/guess/cross/index'
        };
    }
});
