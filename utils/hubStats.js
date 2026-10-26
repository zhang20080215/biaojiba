function valid(row) {
  return !!(row && row.valid === true && Number.isFinite(row.users) && row.users >= 0 &&
    (row.total == null || Number.isFinite(row.total) && row.total >= 0));
}
// Merge partial/out-of-order snapshots per theme; failed rows never erase a
// successful count. Keep original row timestamps so failures cannot renew them.
function merge(previous, incoming, now = Date.now()) {
  if (!previous && !incoming) return null;
  const rows = {};
  for (const snapshot of [previous, incoming]) {
    if (!snapshot) continue;
    for (const [id, row] of Object.entries(snapshot.rows || {})) {
      const at = row && (row.updatedAt || snapshot.generatedAt) || 0;
      if (!valid(row) || !at) continue;
      if (!rows[id] || at >= rows[id].updatedAt) rows[id] = { ...row, updatedAt: at };
    }
  }
  const newer = !previous || (incoming && (incoming.generatedAt || 0) >= (previous.generatedAt || 0));
  const metadata = newer ? { ...previous, ...incoming } : { ...incoming, ...previous };
  for (const key of ['needsRefresh', 'refreshPaused', 'busy', 'error']) {
    if (incoming && key in incoming) metadata[key] = incoming[key];
  }
  return { ...metadata, rows, generatedAt: Math.max(previous && previous.generatedAt || 0, incoming && incoming.generatedAt || 0) };
}
module.exports = { merge };
