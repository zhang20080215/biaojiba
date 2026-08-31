// 每日猜电影 · 线索猜片
//
// 每天一部答案，9 条线索按「由泛到精」排好（年代/地区 → 类型/片长 → 评分/片名字数
// → 榜单/标签 → 年份 → 导演 → 主演 → 剧情），每猜错一次多解锁一条。
// 猜得越早分越高。
//
// 线索是服务端按 revealed 条数截断下发的——把 9 条一次性发过来，
// 打开调试面板就能看到答案，等于没玩。

const MODE = 'clue';
const SUGGEST_DEBOUNCE_MS = 300;

/** 同 grid 页：batchUpdateMarks 要前端传 openid，app.ensureOpenid() 又不返回值，这里自己兜一层 */
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

Page({
    data: {
        loading: true,
        errMsg: '',
        date: '',
        clues: [],
        totalClues: 9,
        record: null,
        guessesLeft: 9,
        maxGuesses: 9,
        score: 0,
        finished: false,
        won: false,
        answer: null,
        keyword: '',
        candidates: [],
        searching: false,
        submitting: false
    },

    onLoad() { this.refresh(); },

    async refresh() {
        this.setData({ loading: true, errMsg: '' });
        try {
            // 先取进度，才知道该解锁几条线索：解锁数 = 已用次数 + 1（开局先给 1 条）
            const stateRes = await wx.cloud.callFunction({
                name: 'submitGuess', data: { action: 'state', mode: MODE }
            });
            const rec = (stateRes.result && stateRes.result.record) || null;
            const used = (rec && rec.guessesUsed) || 0;
            // maxGuesses 在响应顶层，不在 record 里
            this.setData({ maxGuesses: (stateRes.result && stateRes.result.maxGuesses) || 9 });

            const puzzleRes = await wx.cloud.callFunction({
                name: 'getGuessPuzzle', data: { mode: MODE, revealed: used + 1 }
            });
            const out = puzzleRes.result || {};
            if (!out.success) throw new Error(out.error || '题目加载失败');

            this.setData({ loading: false, date: out.puzzle.date, totalClues: out.puzzle.totalClues });
            this._applyRecord(rec, out.puzzle.clues);
        } catch (e) {
            this.setData({ loading: false, errMsg: (e && e.message) || '加载失败，下拉重试' });
        }
    },

    _applyRecord(rec, clues) {
        const max = this.data.maxGuesses;
        const used = (rec && rec.guessesUsed) || 0;
        const patch = {
            record: rec,
            score: (rec && rec.score) || 0,
            finished: !!(rec && rec.finished),
            won: !!(rec && (rec.filled || []).length),
            guessesLeft: Math.max(0, max - used)
        };
        if (clues) patch.clues = clues;
        this.setData(patch);
    },

    onKeywordInput(e) {
        const keyword = e.detail.value;
        this.setData({ keyword });
        clearTimeout(this._suggestTimer);
        if (!keyword.trim()) {
            this.setData({ candidates: [], searching: false });
            return;
        }
        this._suggestTimer = setTimeout(() => this._suggest(keyword), SUGGEST_DEBOUNCE_MS);
    },

    async _suggest(keyword) {
        this.setData({ searching: true });
        this._suggestSeq = (this._suggestSeq || 0) + 1;
        const seq = this._suggestSeq;
        try {
            const res = await wx.cloud.callFunction({ name: 'submitGuess', data: { action: 'suggest', keyword } });
            if (seq !== this._suggestSeq) return;   // 只认最后一次
            this.setData({ candidates: (res.result && res.result.candidates) || [], searching: false });
        } catch (e) {
            if (seq === this._suggestSeq) this.setData({ searching: false });
        }
    },

    async onPickCandidate(e) {
        if (this.data.submitting) return;
        const guessId = e.currentTarget.dataset.id;
        this.setData({ submitting: true });
        try {
            const res = await wx.cloud.callFunction({
                name: 'submitGuess', data: { action: 'answer', mode: MODE, guessId }
            });
            const out = res.result || {};
            if (!out.success) throw new Error(out.error || '提交失败');
            if (out.resolved === false) {
                wx.showToast({ title: out.message || '片库里没有这部', icon: 'none' });
                this.setData({ submitting: false });
                return;
            }

            this.setData({ submitting: false, keyword: '', candidates: [] });
            this._applyRecord(out.record);
            if (out.answer) this.setData({ answer: out.answer });

            if (out.correct) {
                wx.showToast({ title: '猜中了 +' + out.gained, icon: 'none' });
                this._lastMovieIds = out.movieIds || [];
            } else {
                wx.showToast({ title: '不是这部，再看一条线索', icon: 'none' });
                // 猜错了要多解锁一条线索，重新拉一次题面
                await this._reloadClues(out.record);
            }
        } catch (e) {
            this.setData({ submitting: false });
            wx.showToast({ title: (e && e.message) || '提交失败', icon: 'none' });
        }
    },

    async _reloadClues(rec) {
        try {
            const used = (rec && rec.guessesUsed) || 0;
            const res = await wx.cloud.callFunction({
                name: 'getGuessPuzzle', data: { mode: MODE, revealed: used + 1 }
            });
            if (res.result && res.result.success) this.setData({ clues: res.result.puzzle.clues });
        } catch (e) { /* 静默：线索没刷出来不影响继续猜 */ }
    },

    async onMarkWatched() {
        if (!this._lastMovieIds || !this._lastMovieIds.length) return;
        try {
            const openid = await resolveOpenid();
            if (!openid) { wx.showToast({ title: '标记失败：没拿到身份', icon: 'none' }); return; }
            const res = await wx.cloud.callFunction({
                name: 'batchUpdateMarks', data: { movieIds: this._lastMovieIds, status: 'watched', openid }
            });
            if (!(res.result && res.result.success)) throw new Error((res.result && res.result.error) || '标记失败');
            wx.showToast({ title: '已标记为看过', icon: 'success' });
            this._lastMovieIds = [];
        } catch (e) {
            wx.showToast({ title: (e && e.message) || '标记失败', icon: 'none' });
        }
    },

    goGridMode() {
        wx.redirectTo({ url: '/pages/guess/grid/index' });
    },

    onPullDownRefresh() {
        this.refresh().then(() => wx.stopPullDownRefresh());
    },

    onShareAppMessage() {
        const d = this.data;
        return {
            title: d.won ? '我用 ' + (d.maxGuesses - d.guessesLeft) + ' 次猜中了今天的电影' : '每日猜电影：9 条线索，你能猜中吗',
            path: '/pages/guess/clue/index'
        };
    },

    onUnload() { clearTimeout(this._suggestTimer); }
});
