// 每日猜电影 · 交叉填格
//
// 3×3 网格，三行是人物（演员/导演）、三列是属性（类型/年代/地区/榜单/片名字数…），
// 每格要填一部同时满足行列两条的电影，一局 9 次机会。
//
// 答案校验全在服务端（submitGuess）——puzzle 文档里带着每格的正确答案集合，
// 前端只拿得到行列标签和「这格有几种解」，拿不到解本身。
//
// 进度也存在服务端（guess_records，按 openid+mode+date）：切后台回来、换设备、
// 甚至重装小程序都要能续上今天这局，不能只放本地 storage。


const MODE = 'grid';
const SUGGEST_DEBOUNCE_MS = 300;

/**
 * 取 openid。
 * batchUpdateMarks 是**前端传 openid** 的（缺了直接返回「参数不完整」，静默失败），
 * 而 app.ensureOpenid() 不返回值也不返回 promise，所以这里自己兜一层：
 * globalData 有就用，没有就现调 getOpenid 并回填。
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

Page({
    data: {
        loading: true,
        errMsg: '',
        date: '',
        cols: [],           // 三列标签
        gridRows: [],       // [{ label, type, cells: [{ r, c, count, filled, hint }] }]
        record: null,
        guessesLeft: 9,
        maxGuesses: 9,
        score: 0,
        finished: false,
        filledCount: 0,
        // 作答弹窗
        picker: {
            show: false, r: -1, c: -1, rowLabel: '', colLabel: '',
            keyword: '', candidates: [], searching: false, hint: '', submitting: false
        },
        // 答对后的「顺手标记」提示
        lastCorrect: null
    },

    onLoad() {
        this.refresh();
    },

    onShow() {
        // 从别处返回时不重拉题目（题目一天不变），但进度可能在别的端变了
        if (!this.data.loading && this.data.date) this._loadState();
    },

    async refresh() {
        this.setData({ loading: true, errMsg: '' });
        try {
            const [puzzleRes, stateRes] = await Promise.all([
                wx.cloud.callFunction({ name: 'getGuessPuzzle', data: { mode: MODE } }),
                wx.cloud.callFunction({ name: 'submitGuess', data: { action: 'state', mode: MODE } })
            ]);
            const puzzle = puzzleRes.result || {};
            if (!puzzle.success) throw new Error(puzzle.error || '题目加载失败');
            this._puzzle = puzzle.puzzle;
            const rec = (stateRes.result && stateRes.result.record) || null;
            this.setData({
                loading: false,
                date: this._puzzle.date,
                cols: this._puzzle.cols,
                maxGuesses: (stateRes.result && stateRes.result.maxGuesses) || 9
            });
            this._applyRecord(rec);
        } catch (e) {
            this.setData({ loading: false, errMsg: (e && e.message) || '加载失败，下拉重试' });
        }
    },

    async _loadState() {
        try {
            const res = await wx.cloud.callFunction({ name: 'submitGuess', data: { action: 'state', mode: MODE } });
            if (res.result && res.result.success) this._applyRecord(res.result.record);
        } catch (e) { /* 静默：进度刷新失败不影响已渲染的题面 */ }
    },

    /** 把服务端进度套到题面上，拼出渲染用的 3×3 */
    _applyRecord(rec) {
        const p = this._puzzle;
        if (!p) return;
        const filledMap = {};
        (rec && rec.filled || []).forEach(f => { filledMap[f.cellKey] = f; });
        const hintMap = {};
        (rec && rec.hints || []).forEach(h => { hintMap[h.cellKey] = h.text; });
        const countOf = {};
        (p.cells || []).forEach(c => { countOf[c.r + '_' + c.c] = c.count; });

        const gridRows = (p.rows || []).map((row, r) => ({
            label: row.label,
            type: row.type,
            cells: [0, 1, 2].map(c => {
                const key = r + '_' + c;
                return { r, c, key, count: countOf[key] || 0, filled: filledMap[key] || null, hint: hintMap[key] || '' };
            })
        }));

        const used = (rec && rec.guessesUsed) || 0;
        const max = this.data.maxGuesses;
        this.setData({
            gridRows,
            record: rec,
            score: (rec && rec.score) || 0,
            finished: !!(rec && rec.finished),
            filledCount: (rec && rec.filled || []).length,
            guessesLeft: Math.max(0, max - used)
        });
    },

    // —— 作答弹窗

    onTapCell(e) {
        if (this.data.finished) return;
        const { r, c } = e.currentTarget.dataset;
        const row = this.data.gridRows[r];
        if (row.cells[c].filled) return;   // 已填的格子不再作答
        this.setData({
            picker: {
                show: true, r: Number(r), c: Number(c),
                rowLabel: row.label, colLabel: this.data.cols[c].label,
                keyword: '', candidates: [], searching: false,
                hint: row.cells[c].hint || '', submitting: false
            }
        });
    },

    closePicker() {
        this.setData({ 'picker.show': false });
    },
    // 弹窗内部点击不该穿透到遮罩
    noop() { },

    onKeywordInput(e) {
        const keyword = e.detail.value;
        this.setData({ 'picker.keyword': keyword });
        clearTimeout(this._suggestTimer);
        if (!keyword.trim()) {
            this.setData({ 'picker.candidates': [], 'picker.searching': false });
            return;
        }
        // 防抖：逐字触发云函数会把联想打成一串并发请求，返回还乱序
        this._suggestTimer = setTimeout(() => this._suggest(keyword), SUGGEST_DEBOUNCE_MS);
    },

    async _suggest(keyword) {
        this.setData({ 'picker.searching': true });
        this._suggestSeq = (this._suggestSeq || 0) + 1;
        const seq = this._suggestSeq;
        try {
            const res = await wx.cloud.callFunction({ name: 'submitGuess', data: { action: 'suggest', keyword } });
            // 只认最后一次请求的结果，避免慢的那次盖掉快的那次
            if (seq !== this._suggestSeq) return;
            this.setData({
                'picker.candidates': (res.result && res.result.candidates) || [],
                'picker.searching': false
            });
        } catch (e) {
            if (seq === this._suggestSeq) this.setData({ 'picker.searching': false });
        }
    },

    async onPickCandidate(e) {
        if (this.data.picker.submitting) return;
        const guessId = e.currentTarget.dataset.id;
        const { r, c } = this.data.picker;
        this.setData({ 'picker.submitting': true });
        try {
            const res = await wx.cloud.callFunction({
                name: 'submitGuess',
                data: { action: 'answer', mode: MODE, guessId, r, c }
            });
            const out = res.result || {};
            if (!out.success) throw new Error(out.error || '提交失败');

            if (out.resolved === false) {
                wx.showToast({ title: out.message || '片库里没有这部', icon: 'none' });
                this.setData({ 'picker.submitting': false });
                return;
            }
            this._applyRecord(out.record);
            if (out.correct) {
                this.setData({
                    'picker.show': false, 'picker.submitting': false,
                    lastCorrect: { movie: out.movie, gained: out.gained, movieIds: out.movieIds || [] }
                });
                wx.showToast({ title: '答对了 +' + out.gained, icon: 'none' });
            } else {
                this.setData({ 'picker.show': false, 'picker.submitting': false });
                wx.showToast({ title: '《' + out.movie.title + '》不符合这一格', icon: 'none' });
            }
        } catch (e) {
            this.setData({ 'picker.submitting': false });
            wx.showToast({ title: (e && e.message) || '提交失败', icon: 'none' });
        }
    },

    /** 求提示：透露该格某个正确答案的一个侧面，代价是一次猜测机会 */
    async onWantHint() {
        const { r, c } = this.data.picker;
        if (this.data.guessesLeft <= 0) {
            wx.showToast({ title: '没有机会了', icon: 'none' });
            return;
        }
        const confirm = await new Promise(resolve => {
            wx.showModal({
                title: '求提示',
                content: '会透露这一格某部正确答案的一个侧面，代价是 1 次猜测机会。',
                confirmText: '就要提示',
                success: res => resolve(res.confirm),
                fail: () => resolve(false)
            });
        });
        if (!confirm) return;
        try {
            const res = await wx.cloud.callFunction({
                name: 'submitGuess', data: { action: 'hint', mode: MODE, r, c }
            });
            const out = res.result || {};
            if (!out.success) throw new Error(out.error || '拿不到提示');
            this._applyRecord(out.record);
            this.setData({ 'picker.hint': out.hint });
        } catch (e) {
            wx.showToast({ title: (e && e.message) || '拿不到提示', icon: 'none' });
        }
    },

    /** 答对的片顺手标记成「看过」——movieIds 是这部片在各榜单里的文档 id，一次全点亮 */
    async onMarkWatched() {
        const lc = this.data.lastCorrect;
        if (!lc || !lc.movieIds.length) return;
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

    goClueMode() {
        wx.navigateTo({ url: '/pages/guess/clue/index' });
    },

    onPullDownRefresh() {
        this.refresh().then(() => wx.stopPullDownRefresh());
    },

    onShareAppMessage() {
        const d = this.data;
        return {
            title: d.finished
                ? '我在标记吧填出了 ' + d.filledCount + '/9 格，得分 ' + d.score
                : '每日猜电影：9 个格子，9 次机会',
            path: '/pages/guess/grid/index'
        };
    },

    onUnload() {
        clearTimeout(this._suggestTimer);
    }
});
