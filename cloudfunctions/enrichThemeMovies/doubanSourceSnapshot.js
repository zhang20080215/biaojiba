// 分类接口快照用于补齐详情接口缺失字段；与榜单名称无关。
function readSnapshot(target) {
    if (!target || !/^\d+$/.test(String(target.doubanId || ''))) return null;
    try {
        const source = new URL(target.sourceUrl);
        const cover = new URL(target.sourceCoverUrl);
        const subject = new URL(target.sourceSubjectUrl);
        const id = String(target.doubanId);
        if (source.origin !== 'https://movie.douban.com' ||
            !['/explore', '/explore/', '/tv', '/tv/'].includes(source.pathname)) return null;
        if (subject.origin !== source.origin || subject.pathname !== `/subject/${id}/`) return null;
        if (cover.protocol !== 'https:' || !/^img\d+\.doubanio\.com$/.test(cover.hostname) ||
            cover.port || cover.username || cover.password) return null;
        const rating = Number(target.sourceRating);
        if (!Number.isFinite(rating) || rating <= 0 || rating > 10) return null;
        const count = Number(target.sourceRatingCount);
        return { doubanId: id, coverUrl: cover.href, rating,
            ratingCount: Number.isSafeInteger(count) && count >= 0 ? count : 0 };
    } catch (_) { return null; }
}

function applyDoubanSourceSnapshot(target, info) {
    const snapshot = readSnapshot(target);
    if (!snapshot || (info && String(info.doubanId) !== snapshot.doubanId)) return info;
    if (!info) return { ...snapshot, title: target.title,
        directors: target.director || '', countries: target.country || '', matchVerified: true };
    return { ...info, rating: info.rating || snapshot.rating,
        ratingCount: info.ratingCount || snapshot.ratingCount, coverUrl: info.coverUrl || snapshot.coverUrl };
}

module.exports = { applyDoubanSourceSnapshot };
