// pages/doubanBooks/list/list.js — 豆瓣读书 TOP250 列表（骨架阶段）
//
// 当前简化项（待 fetchDoubanBooks + 后端 Marks 集合上线后补齐）：
// - 数据来源：硬编码 seed（utils/doubanBooksLoader.js）
// - 标记持久化：wx.setStorageSync 本地存储；后续切到云函数 batchUpdateMarks
// - 海报分享：占位按钮，点击 toast 提示"敬请期待"
// - 广告/批量编辑/授权弹窗：暂未接入

const { loadBooks } = require('../../../utils/doubanBooksLoader');

const STORAGE_KEY = 'doubanBooks_marks';

function readMarksFromStorage() {
    try {
        const raw = wx.getStorageSync(STORAGE_KEY);
        return raw && typeof raw === 'object' ? raw : {};
    } catch (e) {
        return {};
    }
}

function writeMarksToStorage(map) {
    try {
        wx.setStorageSync(STORAGE_KEY, map || {});
    } catch (e) {
        // ignore
    }
}

function formatMarkedAt(date) {
    const d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) return '';
    return `${d.getMonth() + 1}/${d.getDate()}`;
}

Page({
    data: {
        allBooks: [],
        books: [],
        markStatusMap: {},   // bookId -> 'read' | 'wish'
        markDateMap: {},     // bookId -> 'M/d'
        readCount: 0,
        wishCount: 0,
        unreadCount: 0,
        allCount: 0,
        readProgressPercent: 0,
        readProgressText: '0%',
        readProgressWidth: '0%',
        activeTab: 0,
        currentFilter: 'all',
        loading: false,
        customToast: '',
        customToastVisible: false
    },

    onLoad() {
        this.loadAllBooks();
    },

    onPullDownRefresh() {
        this.loadAllBooks();
        wx.stopPullDownRefresh();
    },

    onUnload() {
        if (this._toastTimer) clearTimeout(this._toastTimer);
    },

    onBackHome() {
        wx.reLaunch({ url: '/pages/category/category' });
    },

    async loadAllBooks() {
        this.setData({ loading: true });
        try {
            const books = await loadBooks();
            const markStatusMap = readMarksFromStorage();
            const markDateMap = {};
            Object.keys(markStatusMap).forEach((bookId) => {
                const entry = markStatusMap[bookId];
                if (entry && typeof entry === 'object') {
                    markDateMap[bookId] = entry.markedAt ? formatMarkedAt(entry.markedAt) : '';
                }
            });
            // markStatusMap 仅保留 status 字符串，便于模板比较
            const flatStatusMap = {};
            Object.keys(markStatusMap).forEach((bookId) => {
                const entry = markStatusMap[bookId];
                if (entry && typeof entry === 'object') {
                    flatStatusMap[bookId] = entry.status || '';
                } else if (typeof entry === 'string') {
                    flatStatusMap[bookId] = entry;
                }
            });

            this.setData({
                allBooks: books,
                markStatusMap: flatStatusMap,
                markDateMap,
                allCount: books.length
            });
            this.recomputeCounts();
            this.applyFilter();
        } catch (e) {
            this.showCustomToast('加载失败，请重试');
        } finally {
            this.setData({ loading: false });
        }
    },

    recomputeCounts() {
        const { allBooks, markStatusMap } = this.data;
        let readCount = 0;
        let wishCount = 0;
        allBooks.forEach((b) => {
            const s = markStatusMap[b._id];
            if (s === 'read') readCount += 1;
            else if (s === 'wish') wishCount += 1;
        });
        const allCount = allBooks.length;
        const unreadCount = Math.max(0, allCount - readCount - wishCount);
        const percent = allCount > 0 ? Math.round((readCount / allCount) * 100) : 0;
        this.setData({
            readCount,
            wishCount,
            unreadCount,
            allCount,
            readProgressPercent: percent,
            readProgressText: `${percent}%`,
            readProgressWidth: `${percent}%`
        });
    },

    onTabChange(e) {
        const idx = Number(e.currentTarget.dataset.index);
        const filterMap = ['all', 'read', 'wish', 'unread'];
        this.setData({
            activeTab: idx,
            currentFilter: filterMap[idx] || 'all'
        });
        this.applyFilter();
    },

    applyFilter() {
        const { allBooks, currentFilter, markStatusMap } = this.data;
        let books = allBooks;
        if (currentFilter === 'read') {
            books = allBooks.filter((b) => markStatusMap[b._id] === 'read');
        } else if (currentFilter === 'wish') {
            books = allBooks.filter((b) => markStatusMap[b._id] === 'wish');
        } else if (currentFilter === 'unread') {
            books = allBooks.filter((b) => !markStatusMap[b._id]);
        }
        this.setData({ books });
    },

    onMarkBook(e) {
        const { bookId, status } = e.currentTarget.dataset;
        if (!bookId || !status) return;
        const stored = readMarksFromStorage();
        const markStatusMap = { ...this.data.markStatusMap };
        const markDateMap = { ...this.data.markDateMap };
        const current = markStatusMap[bookId];

        if (current === status) {
            // 取消标记
            delete stored[bookId];
            delete markStatusMap[bookId];
            delete markDateMap[bookId];
            this.showCustomToast('已取消标记');
        } else {
            const now = Date.now();
            stored[bookId] = { status, markedAt: now };
            markStatusMap[bookId] = status;
            markDateMap[bookId] = formatMarkedAt(now);
            this.showCustomToast(status === 'read' ? '标记为已读' : '标记为想读');
        }

        writeMarksToStorage(stored);
        this.setData({ markStatusMap, markDateMap });
        this.recomputeCounts();
        this.applyFilter();
    },

    onSharePoster() {
        // TODO: 接入 utils/doubanBooksPosterDrawer 与 pages/doubanBooks/share
        this.showCustomToast('海报功能敬请期待');
    },

    showCustomToast(text) {
        if (this._toastTimer) clearTimeout(this._toastTimer);
        this.setData({ customToast: text, customToastVisible: true });
        this._toastTimer = setTimeout(() => {
            this.setData({ customToastVisible: false });
        }, 1600);
    }
});
