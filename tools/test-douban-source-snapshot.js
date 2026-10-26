const assert = require('node:assert/strict');
const { applyDoubanSourceSnapshot: apply } = require('../cloudfunctions/enrichThemeMovies/doubanSourceSnapshot');
const source = require('./douban-comedy-seed/doubanComedy250.json')[0];
// 一个从未注册过的主题也能使用有效来源快照。
const target = { ...source, theme: 'futureDoubanTheme' };
assert.equal(apply(target, null).rating, source.sourceRating);
assert.equal(apply(target, null).doubanId, source.doubanId);
const detail = { doubanId: source.doubanId, rating: 9.1, ratingCount: 123, coverUrl: 'detail-cover', title: '详情标题' };
assert.deepEqual(apply(target, detail), detail);
const missing = apply(target, { doubanId: source.doubanId, rating: 0, coverUrl: '' });
assert.equal(missing.rating, source.sourceRating);
assert.equal(missing.coverUrl, source.sourceCoverUrl);
const wrongId = { ...detail, doubanId: '123' };
assert.equal(apply(target, wrongId), wrongId);
for (const patch of [
    {sourceUrl:'https://example.com/explore'}, {sourceUrl:'https://movie.douban.com.evil.test/tv/'},
    {sourceSubjectUrl:'https://movie.douban.com/subject/123/'},
    {sourceCoverUrl:'https://img3.doubanio.com.evil.test/cover.jpg'},
    {sourceCoverUrl:'http://img3.doubanio.com/cover.jpg'},
    {sourceRating:0}, {sourceRating:10.1}, {sourceRating:Infinity}, {doubanId:'abc'}
]) assert.equal(apply({...target,...patch},null),null);
assert.equal(apply({title:'旧名单',doubanId:'123'},null),null);
for (const name of ['doubanTvKorea250','doubanTvJapan250']) {
    for (const row of require('./douban-regional-tv-seed/'+name+'.json')) assert.ok(apply(row,null));
}
for (const count of [-1,Infinity,2.5]) assert.equal(apply({...target,sourceRatingCount:count},null).ratingCount,0);
console.log('豆瓣来源兜底检查通过：新主题、详情优先、缺字段补齐、非法来源/错ID拒绝、500条剧集快照。');
