// No client-supplied collection names, identities, or query filters are accepted.
function mergeCatalog(base, registry) {
  const all = new Map(base.map(c => [c.id, { ...c }]));
  registry.forEach(d => {
    if (!d || d.enabled === false || !d.theme || !d.cardId || all.has(d.cardId)) return;
    all.set(d.cardId, { id: d.cardId, collection: d.type === 'book' ? 'generic_theme_books' : 'generic_theme_movies', theme: d.theme,
      ...(d.type === 'book' ? { marksCollection: 'BookMarks', idField: 'bookId', source: d.source || d.theme } : {}) });
  });
  return [...all.values()];
}
function belongs(row, config) { return (!config.theme || row.theme === config.theme) && (!config.topFiltered || row.isTop250 !== false); }
function validMark(row, config) {
  if (!row.openid || typeof row.openid !== 'string') return false;
  const book = config.marksCollection === 'BookMarks';
  if (!(book ? ['read', 'wish'] : ['watched', 'wish']).includes(row.status)) return false;
  return !config.source || (config.source === 'douban' ? !row.source || row.source === 'douban' : row.source === config.source);
}
function summarize(config, ids, marks) {
  const accepted = new Set(ids);
  const selected = new Map();
  marks.forEach(row => {
    const id = row[config.idField || 'movieId'];
    if (!accepted.has(id) || !validMark(row, config)) return;
    const previous = selected.get(id);
    if (!previous || String(row.marked_at || '') > String(previous.marked_at || '')) selected.set(id, row);
  });
  let done = 0, wish = 0;
  selected.forEach(row => { if (row.status === 'wish') wish++; else done++; });
  return { total: accepted.size, done, wish };
}
module.exports = { mergeCatalog, belongs, validMark, summarize };
