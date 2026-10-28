// 首页 / 分类 / 我的 / 记录四个 tab 的统一线条图标（替代主题的 placeholderEmoji）。
// 24 网格、1.8 线宽、圆角端点，与头图的调色盘、反馈按钮同一种语言。
//
// 运行时只用 keyFor(theme) 拿到图标类别名，模板写成 class="hub-glyph icon-{{iconKey}}"；
// 图标本体由 tools/build-hub-icons.cjs 从下面的 ICONS 生成进 styles/hub-icons.wxss（SVG data URI）。
// 不把 data URI 塞进 setData：一个图标约 1KB，38 个主题在热门 / 最新 / 分类等多个列表里重复，会显著拖慢渲染。
// 改 ICONS 后重跑：node tools/build-hub-icons.cjs
const ICONS = {
  film: `<rect x='3' y='4' width='18' height='16' rx='2.2'/><path d='M7.5 4v16M16.5 4v16M3 9h4.5M3 15h4.5M16.5 9H21M16.5 15H21'/>`,
  trophy: `<path d='M8 4h8v5.2a4 4 0 0 1-8 0z'/><path d='M8 6H5.2a3 3 0 0 0 3 4M16 6h2.8a3 3 0 0 1-3 4'/><path d='M12 13.2v3.6M9 20.2h6M10.2 16.8h3.6'/>`,
  tv: `<rect x='3' y='6.5' width='18' height='12' rx='2.2'/><path d='M8.5 3.5l3.5 3 3.5-3M9.5 21h5'/>`,
  sparkle: `<path d='M11 3.5l1.7 5 5 1.7-5 1.7-1.7 5-1.7-5-5-1.7 5-1.7z'/><path d='M18 14.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z'/>`,
  book: `<path d='M5 18.5V5.5A2.5 2.5 0 0 1 7.5 3H19.5v13.5H7.5A2.5 2.5 0 0 0 5 19a2 2 0 0 0 2.5 2h12v-4.5'/><path d='M9 7.5h6.5'/>`,
  mountain: `<path d='M3 19.5l6-9.5 4 5.5 2.8-3.8 5.2 7.8z'/><circle cx='16.6' cy='6.2' r='1.9'/>`,
  museum: `<path d='M3.5 9L12 4l8.5 5z'/><path d='M5.8 9.5v8.5M10 9.5v8.5M14 9.5v8.5M18.2 9.5v8.5M3.5 20.5h17'/>`,
  pin: `<path d='M12 21s-6.5-5.8-6.5-11.2a6.5 6.5 0 0 1 13 0C18.5 15.2 12 21 12 21z'/><circle cx='12' cy='9.8' r='2.4'/>`,
  coins: `<ellipse cx='12' cy='6.2' rx='7' ry='2.8'/><path d='M5 6.2v5.4c0 1.6 3.1 2.8 7 2.8s7-1.2 7-2.8V6.2M5 11.6v5.6c0 1.6 3.1 2.8 7 2.8s7-1.2 7-2.8v-5.6'/>`,
  clapper: `<path d='M4 10.5h16v8.3a2.2 2.2 0 0 1-2.2 2.2H6.2A2.2 2.2 0 0 1 4 18.8z'/><path d='M4 10.5l-.5-3a1.6 1.6 0 0 1 1.3-1.8L17.5 3.4a1.6 1.6 0 0 1 1.9 1.3l.5 2.9'/><path d='M8.6 5.9l2.2 3.2M13.4 5l2.2 3.2'/><path d='M9.2 15.6l2 2 3.8-3.8'/>`,
  reading: `<path d='M12 6.6C10.3 5.1 7.8 4.6 4 4.6v13.2c3.8 0 6.3.5 8 2 1.7-1.5 4.2-2 8-2V4.6c-3.8 0-6.3.5-8 2z'/><path d='M12 6.6v13.2'/>`,
  // 哑铃：两片杠铃片用圆角矩形，比单线更有分量，和另外三个每日图标视觉重量一致
  dumbbell: `<rect x='5.4' y='6.8' width='3.2' height='10.4' rx='1.1'/><rect x='15.4' y='6.8' width='3.2' height='10.4' rx='1.1'/><path d='M2.8 10.3v3.4M21.2 10.3v3.4M8.6 12h6.8'/>`,
  // 两只脚印：每日步数
  footprints: `<path d='M8.2 3.8c-1.9 0-3 2.1-3 4.6 0 2 .9 3.7 1.6 4.8h3.2c.7-1.1 1.6-2.8 1.6-4.8 0-2.5-1.5-4.6-3.4-4.6z'/><path d='M6.9 15.4h3l-.2 1.9a1.3 1.3 0 0 1-2.6 0z'/><path d='M15.8 7.3c-1.9 0-3.4 2.1-3.4 4.6 0 2 .9 3.7 1.6 4.8h3.2c.7-1.1 1.6-2.8 1.6-4.8 0-2.5-1.1-4.6-3-4.6z'/><path d='M14.1 18.9h3l-.2 1.9a1.3 1.3 0 0 1-2.6 0z'/>`,
  droplet: `<path d='M12 3.5s6 6.2 6 10.6a6 6 0 0 1-12 0c0-4.4 6-10.6 6-10.6z'/><path d='M9.3 14.4a2.9 2.9 0 0 0 2.6 2.6'/>`,
  search: `<circle cx='10.8' cy='10.8' r='6.5'/><path d='M15.8 15.8l4.7 4.7'/>`,
  // 榜单许愿：魔法棒 + 三颗小星
  wand: `<path d='M4.5 19.5l9.8-9.8'/><path d='M12.6 8l3.4 3.4'/><path d='M17.5 2.8v3.6M15.7 4.6h3.6M20.2 10.4v2.6M18.9 11.7h2.6M9.6 3.6v2.2M8.5 4.7h2.2'/>`,
  ruler: `<rect x='2.5' y='8' width='19' height='8' rx='1.6'/><path d='M6.5 8v3M10 8v4.2M13.5 8v3M17 8v4.2'/>`
};

// 本地目录里的主题按 id 指定；没列到的（含云端注册表新主题）按分类兜底
const ICON_BY_ID = {
  douban_movies: 'film', imdb_movies: 'film', letterboxd500_movies: 'film', arthouse_movies: 'film', sightsound_movies: 'film',
  rt_horror_movies: 'film', rt_war_movies: 'film', rt_action_movies: 'film',
  oscar_movies: 'trophy', oscar_anime_movies: 'trophy', oscar_cinematography_movies: 'trophy', oscar_screenplay_movies: 'trophy',
  oscar_foreign_movies: 'trophy', oscar_director_movies: 'trophy', oscar_vfx_movies: 'trophy', oscar_actor_movies: 'trophy',
  oscar_actress_movies: 'trophy', palme_dor_movies: 'trophy',
  boxoffice_movies: 'coins',
  douban_tv_cn: 'tv', douban_tv_foreign: 'tv',
  rt_animation_movies: 'sparkle', douban_tv_anime: 'sparkle', bangumi_anime: 'sparkle',
  douban_books: 'book', weread_books: 'book', maodun_books: 'book', newbery_books: 'book',
  scenic_5a: 'mountain', museum_grade1: 'museum', travel_provinces: 'pin', travel_cities: 'pin',
  daily_movie: 'clapper', daily_read: 'reading', daily_sport: 'dumbbell', daily_water: 'droplet', daily_steps: 'footprints',
  movie_search_all_platforms: 'search', child_growth: 'ruler'
};
const ICON_BY_CATEGORY = { movie: 'film', oscar: 'trophy', tv: 'tv', anime: 'sparkle', reading: 'book', travel: 'pin', parenting: 'ruler', daily: 'sparkle', game: 'film' };

function keyFor(theme) {
  if (!theme) return 'film';
  return ICON_BY_ID[theme.id] || ICON_BY_CATEGORY[theme.category] || 'film';
}

function svg(key, color, width) {
  return `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='${color}' stroke-width='${width || 1.8}' stroke-linecap='round' stroke-linejoin='round'>${ICONS[key]}</svg>`;
}

module.exports = { ICONS, ICON_BY_ID, keyFor, svg };
