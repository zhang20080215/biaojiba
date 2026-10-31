// 每日填字 · 答题卡（发小红书用，1080×1440 = 3:4）
//
// 由填字页结束面板「生成答题卡」进来，数据走 getApp().globalData.guessShare（见 index.js onShareCard）。
//
// 版式（10-30 按「精致、克制」重做一版）：
//   · 左对齐，所有东西靠同一条左边线（x = 72），四周留白 72；纵向间距都取 8 的倍数
//   · 字号只用五档：72（档位）/ 40（数据）/ 26（玩法名、日期）/ 19~24（线索正文，按放不放得下自动挑）/ 21（小标签、图例）
//   · 自上而下：玩法名 ｜ 日期 + 发丝线 → 档位 → 一排数据（大数字 + 小标签）→ 题目卡 → 水印
//   · 每样东西只出现一次；错几次、用了几次提示不单列，棋盘上的黄格子已经说明了
//
// 题目卡：左边棋盘（每格按结果上色）+ 图例，右边按「横向 / 竖向」分组列线索（填字书的排法，
// 条目号对得上棋盘）。页面上的「显示答案」开关**只决定格子里写不写字**，其余版式完全一样（10-30 定）：
// 默认不写，发出去不剧透、别人还能照着线索猜。
//
// 和其它海报页一样：canvas 是原生组件藏不住，直接当预览图显示（backing 1080×1440、CSS 缩放）；
// 保存走 rewardedSaveGate。水印与每日步数统计海报一致：「使用小程序「标记吧」生成」，
// 不放二维码 / 外链（推广合规）。

const rewardedSaveGate = require('../../../utils/rewardedSaveGate');

const W = 1080;
const H = 1440;
const FONT = '"PingFang SC", "Helvetica Neue", sans-serif';
const C = {
    page: '#FAF8F2',
    ink: '#2B2B28',
    body: '#55544E',
    muted: '#9C998F',          // 与 utils/daily/palette.js NEUTRAL.inkMuted 一致（水印色）
    faint: '#B9B6AB',
    line: '#E7E3D8',
    green: '#6B7F43',
    gold: '#A87A1C',
    red: '#B4573A'
};
const WATERMARK = '使用小程序「标记吧」生成';   // 与 utils/metricReportPoster.js 一致，字号色值也一样
const CELL = {
    clean: { bg: '#6B7F43', fg: '#FFFFFF', label: '一次答对' },
    mixed: { bg: '#E2C46B', fg: '#FFFFFF', label: '错过或用过提示' },
    miss: { bg: '#E6E2D7', fg: '#8A877D', label: '没答出' }
};
const GRADE_COLOR = { perfect: C.green, dead: C.red };
const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

// 版面骨架（px）
const M = 72;                                    // 四周留白 / 左边线
const CARD = { top: 380, bottom: 1310, pad: 44, r: 28 };

const font = (size, weight) => (weight || 400) + ' ' + size + 'px ' + FONT;

function roundRect(ctx, x, y, w, h, r) {
    const k = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + k, y);
    ctx.arcTo(x + w, y, x + w, y + h, k);
    ctx.arcTo(x + w, y + h, x, y + h, k);
    ctx.arcTo(x, y + h, x, y, k);
    ctx.arcTo(x, y, x + w, y, k);
    ctx.closePath();
}

/** 写一段字，返回宽度。baseline 用 alphabetic：同一行不同字号的字靠基线对齐，才不会高低错落 */
function text(ctx, s, x, y, size, color, weight, align) {
    ctx.font = font(size, weight);
    ctx.fillStyle = color;
    ctx.textAlign = align || 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(s, x, y);
    return ctx.measureText(s).width;
}

function hairline(ctx, x1, y, x2) {
    ctx.fillStyle = C.line;
    ctx.fillRect(x1, y, x2 - x1, 2);
}

function dateLabel(d) {
    const p = String(d || '').split('-').map(Number);
    if (p.length !== 3 || p.some(isNaN)) return '';
    const wd = new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay();
    return p[0] + '.' + (p[1] < 10 ? '0' : '') + p[1] + '.' + (p[2] < 10 ? '0' : '') + p[2] + '  ' + WEEK[wd];
}

function clock(sec) {
    if (sec == null || sec < 0) return '';
    const p = n => (n < 10 ? '0' : '') + n;
    const h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, s = sec % 60;
    return (h ? h + ':' + p(m) : p(m)) + ':' + p(s);
}

/**
 * 棋盘在 w×h 里能画多大。左右整列空着的先裁掉（填字页只裁了空行），棋盘才居中。
 * 返回裁好的格子和实际宽高，排版时先量再定位置
 */
function boardMetrics(raw, w, h, maxSize) {
    raw = raw || [];
    let minC = Infinity, maxC = -1;
    raw.forEach(row => row.forEach((cell, ci) => { if (cell) { minC = Math.min(minC, ci); maxC = Math.max(maxC, ci); } }));
    const grid = minC <= maxC ? raw.map(row => row.slice(minC, maxC + 1)) : raw;
    const rows = grid.length || 1;
    const cols = grid.reduce((m, row) => Math.max(m, row.length), 0) || 7;
    // 格子间距约为边长的 1/12：窄缝让棋盘读成一个整体，而不是一堆散块
    const size = Math.floor(Math.min(w / (cols + (cols - 1) / 12), h / (rows + (rows - 1) / 12), maxSize));
    const gap = Math.max(4, Math.round(size / 12));
    return { grid: grid, gap: gap, size: size, w: cols * size + (cols - 1) * gap, h: rows * size + (rows - 1) * gap };
}

/** 画棋盘：左上角在 (gx, gy)。每格按结果上色；showAnswers 时把字写进去；条目起始格左上角标序号 */
function drawBoard(ctx, m, showAnswers, gx, gy) {
    const size = m.size, gap = m.gap;
    m.grid.forEach((row, ri) => row.forEach((cell, ci) => {
        if (!cell) return;
        const x = gx + ci * (size + gap), y = gy + ri * (size + gap);
        const look = CELL[cell.st] || CELL.miss;
        ctx.fillStyle = look.bg;
        roundRect(ctx, x, y, size, size, Math.max(4, size * 0.12));
        ctx.fill();
        if (showAnswers && cell.ch) {
            // 起始格左上角有序号，字往右下让一点，免得小格子里两者挤在一起
            const off = cell.no ? size * 0.06 : 0;
            text(ctx, cell.ch, x + size / 2 + off, y + size * 0.69 + off, Math.round(size * 0.46), look.fg, 600, 'center');
        }
        if (cell.no) {
            ctx.globalAlpha = 0.8;
            text(ctx, String(cell.no), x + size * 0.1, y + size * 0.1 + Math.round(size * 0.2), Math.max(13, Math.round(size * 0.2)), look.fg, 600);
            ctx.globalAlpha = 1;
        }
    }));
}

/** 图例：从 (x, y) 开始；vertical 时一项一行，否则一行排开 */
function drawLegend(ctx, x, y, vertical) {
    let lx = x, ly = y;
    ['clean', 'mixed', 'miss'].forEach(k => {
        ctx.fillStyle = CELL[k].bg;
        roundRect(ctx, lx, ly - 15, 16, 16, 4);
        ctx.fill();
        const w = text(ctx, CELL[k].label, lx + 26, ly, 21, C.muted, 400);
        if (vertical) ly += 36; else lx += 26 + w + 32;
    });
}

/** 横排图例的总宽，居中用 */
function legendWidth(ctx) {
    ctx.font = font(21);
    return ['clean', 'mixed', 'miss'].reduce((sum, k, i) => sum + 26 + ctx.measureText(CELL[k].label).width + (i ? 32 : 0), 0);
}

/** 按宽度折行，最多 maxLines 行，放不下的在最后一行末尾加「…」；标点不放行首 */
function wrapText(ctx, str, width, maxLines) {
    const chars = Array.from(String(str || ''));
    const lines = [];
    let line = '';
    let cut = false;
    for (let i = 0; i < chars.length; i++) {
        if (ctx.measureText(line + chars[i]).width > width && line && !/[，。、；：！？）」』》,.;:!?)]/.test(chars[i])) {
            lines.push(line);
            line = '';
            if (lines.length === maxLines) { cut = true; break; }
        }
        line += chars[i];
    }
    if (!cut) { if (line) lines.push(line); return { lines: lines, cut: false }; }
    let last = lines[maxLines - 1];
    while (last && ctx.measureText(last + '…').width > width) last = last.slice(0, -1);
    lines[maxLines - 1] = last + '…';
    return { lines: lines, cut: true };
}

/**
 * 线索栏：按「横向 / 竖向」分两组，每条是「条目号  线索 4」，字数用浅色小一号跟在末尾。
 * 字号从 24 往下试：先找全部放得下、一条都不用截断的，找不到再取放得下的最大字号
 */
function drawClues(ctx, clues, x, y, w, h) {
    const groups = [
        { title: '横向', items: clues.filter(c => c.dir === 'H') },
        { title: '竖向', items: clues.filter(c => c.dir !== 'H') }
    ].filter(g => g.items.length);
    const numW = 36;
    const plan = size => {
        const lh = Math.round(size * 1.6);
        const itemGap = Math.round(size * 0.6);
        const headH = 44;
        const groupGap = 32;
        ctx.font = font(size);
        let cut = false;
        const out = groups.map(g => ({
            title: g.title,
            items: g.items.map(cl => {
                const r = wrapText(ctx, cl.clue, w - numW, 3);
                if (r.cut) cut = true;
                // 字数（小一号浅色）跟在正文末尾，不参与折行：最后一行放不下就另起一行，没有行可用就不写
                let tail = r.cut ? '' : '  ' + cl.len + '字';
                const lines = r.lines.slice();
                if (tail) {
                    const lastW = ctx.measureText(lines[lines.length - 1] || '').width;
                    ctx.font = font(size - 4);
                    const tailW = ctx.measureText(tail).width;
                    ctx.font = font(size);
                    if (lastW + tailW > w - numW) {
                        if (lines.length < 3) { lines.push(''); tail = cl.len + '字'; } else tail = '';
                    }
                }
                return { no: cl.no, lines: lines, tail: tail };
            })
        }));
        const total = out.reduce((sum, g, gi) => sum + (gi ? groupGap : 0) + headH
            + g.items.reduce((s2, it) => s2 + it.lines.length * lh, 0) + itemGap * (g.items.length - 1), 0);
        return { size: size, lh: lh, itemGap: itemGap, headH: headH, groupGap: groupGap, groups: out, total: total, cut: cut };
    };
    let best = null, fallback = null;
    for (let size = 24; size >= 19; size--) {
        const p = plan(size);
        if (p.total > h) continue;
        if (!fallback) fallback = p;
        if (!p.cut) { best = p; break; }
    }
    const p = best || fallback || plan(19);
    let cy = y + Math.max(0, (h - p.total) / 2);
    p.groups.forEach((g, gi) => {
        if (gi) cy += p.groupGap;
        // 组标题：小字绿色 + 后面一条发丝线
        const tw = text(ctx, g.title, x, cy + 22, 21, C.green, 600);
        hairline(ctx, x + tw + 16, cy + 14, x + w);
        cy += p.headH;
        g.items.forEach((it, ii) => {
            if (ii) cy += p.itemGap;
            const base = cy + p.lh * 0.72;
            text(ctx, String(it.no), x, base, p.size, C.green, 600);
            it.lines.forEach((ln, li) => {
                const ly = base + li * p.lh;
                const isLast = li === it.lines.length - 1;
                if (isLast && it.tail) {
                    const bw = ln ? text(ctx, ln, x + numW, ly, p.size, C.body, 400) : 0;
                    text(ctx, it.tail, x + numW + bw, ly, p.size - 4, C.faint, 400);
                } else {
                    text(ctx, ln, x + numW, ly, p.size, C.body, 400);
                }
            });
            cy += it.lines.length * p.lh;
        });
    });
}

/** 一排数据：大数字（可带小单位）+ 下面的小标签，等宽分栏、左对齐 */
function drawStats(ctx, items, x, y, w) {
    const colW = w / Math.max(items.length, 4);
    items.forEach((it, i) => {
        const cx = x + colW * i;
        const vw = text(ctx, it.v, cx, y, 40, it.color || C.ink, 600);
        if (it.u) text(ctx, it.u, cx + vw + 6, y, 22, C.muted, 400);
        text(ctx, it.l, cx, y + 36, 21, C.muted, 400);
        if (i) {
            ctx.fillStyle = C.line;
            ctx.fillRect(cx - 28, y - 30, 2, 74);
        }
    });
}

Page({
    data: {
        previewW: 300,
        previewH: 400,
        ready: false,
        empty: false,
        showAnswers: false,
        isGenerating: false,
        needRewardedAd: false
    },

    onLoad() {
        const card = getApp().globalData.guessShare;
        if (!card) { this.setData({ empty: true }); return; }
        this._card = card;
        const win = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
        const previewW = Math.min(Math.round((win.windowWidth || 375) * 0.84), 340);
        this.setData({ previewW: previewW, previewH: Math.round(previewW * H / W) });
        rewardedSaveGate.refreshHint(this);
    },

    onReady() {
        if (this._card) this._draw();
    },

    onUnload() {
        this._destroyed = true;
    },

    /** 「显示答案」开关：换一种画法重画 */
    onToggleAnswers(e) {
        if (!this._card || this._drawing) return;
        this.setData({ showAnswers: !!(e && e.detail && e.detail.value), ready: false });
        this._draw();
    },

    async _draw() {
        this._drawing = true;
        try {
            const canvas = await new Promise((resolve, reject) => {
                wx.createSelectorQuery().in(this).select('#card').fields({ node: true, size: true }).exec(res => {
                    if (!res || !res[0] || !res[0].node) reject(new Error('canvas 节点获取失败'));
                    else resolve(res[0].node);
                });
            });
            if (this._destroyed) return;
            canvas.width = W;
            canvas.height = H;
            this._paint(canvas.getContext('2d'), this._card, this.data.showAnswers);
            // 双帧让 Canvas 2D 把绘制提交到 bitmap，避免导出空白
            await new Promise(resolve => canvas.requestAnimationFrame(() => canvas.requestAnimationFrame(resolve)));
            if (this._destroyed) return;
            const res = await wx.canvasToTempFilePath({ canvas: canvas, fileType: 'png', quality: 1 });
            if (this._destroyed) return;
            this._temp = res.tempFilePath;
            this.setData({ ready: true });
        } catch (e) {
            console.error('[guess share] 生成失败', e);
            if (!this._destroyed) wx.showToast({ title: '生成失败', icon: 'none' });
        } finally {
            this._drawing = false;
        }
    },

    _paint(ctx, c, showAnswers) {
        ctx.fillStyle = C.page;
        ctx.fillRect(0, 0, W, H);

        // —— 头：玩法名 ｜ 日期，下面一条发丝线
        text(ctx, '每日电影填词', M, 104, 26, C.green, 600);
        text(ctx, dateLabel(c.date), W - M, 104, 26, C.muted, 400, 'right');
        hairline(ctx, M, 130, W - M);

        // —— 档位
        const grade = c.grade || { key: '', label: '' };
        text(ctx, grade.label, M - 3, 222, 72, GRADE_COLOR[grade.key] || C.ink, 700);

        // —— 一排数据：名次（进了前 10 才有）/ 答出（没做完才有）/ 得分 / 用时 / 连续打卡
        const items = [];
        if (c.myRank) items.push({ v: String(c.myRank), u: '名', l: '排行', color: C.gold });
        if (c.solved < c.total) items.push({ v: c.solved + '/' + c.total, l: '答出' });
        items.push({ v: String(c.score), u: '分', l: '得分' });
        if (c.seconds != null) items.push({ v: clock(c.seconds), l: '用时' });
        if (c.streak) items.push({ v: String(c.streak), u: '天', l: '连续打卡' });
        drawStats(ctx, items, M, 310, W - M * 2);

        // —— 题目卡：白底细边框，不加重阴影
        const cardX = M, cardW = W - M * 2, cardH = CARD.bottom - CARD.top;
        ctx.fillStyle = '#FFFFFF';
        roundRect(ctx, cardX, CARD.top, cardW, cardH, CARD.r);
        ctx.fill();
        ctx.strokeStyle = C.line;
        ctx.lineWidth = 2;
        ctx.stroke();

        const clues = (c.clues || []).filter(x => x && x.clue);
        const ix = cardX + CARD.pad, iy = CARD.top + CARD.pad;
        const iw = cardW - CARD.pad * 2, ih = cardH - CARD.pad * 2;
        if (clues.length) {
            // 左：棋盘 + 图例当一组，在左栏里上下居中；右：线索。显示答案与否只差格子里的字
            const leftW = 300, legendH = 2 * 36 + 16, legendGap = 40;
            const m = boardMetrics(c.grid, leftW, ih - legendH - legendGap, 72);
            const top = iy + (ih - (m.h + legendGap + legendH)) / 2;
            drawBoard(ctx, m, showAnswers, ix, top);
            drawLegend(ctx, ix, top + m.h + legendGap + 16, true);
            const dx = ix + leftW + 32;
            ctx.fillStyle = C.line;
            ctx.fillRect(dx, iy, 2, ih);
            drawClues(ctx, clues, dx + 34, iy, ix + iw - (dx + 34), ih);
        } else {   // 拿不到线索时（兜底）整张卡给棋盘
            const legendH = 40;
            const m = boardMetrics(c.grid, iw, ih - legendH - 40, 112);
            const top = iy + (ih - (m.h + 40 + legendH)) / 2;
            drawBoard(ctx, m, showAnswers, cardX + (cardW - m.w) / 2, top);
            drawLegend(ctx, W / 2 - legendWidth(ctx) / 2, top + m.h + 40 + 26, false);
        }

        // —— 水印（与每日步数统计海报一致：同一句、同字号同颜色、底部居中）
        text(ctx, WATERMARK, W / 2, H - 58, 35, C.muted, 400, 'center');
    },

    async saveImage() {
        if (this.data.isGenerating) return;
        if (!this._temp || !this.data.ready) { wx.showToast({ title: '图片还没生成好', icon: 'none' }); return; }
        const ok = await rewardedSaveGate.ensureGrant(this);
        if (!ok) return;
        try {
            this.setData({ isGenerating: true });
            await wx.saveImageToPhotosAlbum({ filePath: this._temp });
            wx.showToast({ title: '已保存到相册', icon: 'success' });
        } catch (err) {
            if (err && err.errMsg && err.errMsg.indexOf('auth deny') >= 0) {
                wx.showModal({
                    title: '权限提示',
                    content: '需要授权保存图片到相册',
                    confirmText: '去设置',
                    success: r => { if (r.confirm) wx.openSetting(); }
                });
            } else {
                wx.showToast({ title: '保存失败', icon: 'none' });
            }
        } finally {
            if (!this._destroyed) this.setData({ isGenerating: false });
        }
    },

    onShareAppMessage() {
        const c = this._card || {};
        const g = c.grade && c.grade.key !== 'dead' ? c.grade.label : '';
        return {
            title: g ? '我在每日电影填词' + g + (c.myRank ? '，今天第 ' + c.myRank + ' 名' : '') + '，来挑战' : '每日填字 · 八部电影横竖交叉，看剧情猜片名',
            path: '/pages/guess/cross/index'
        };
    }
});
