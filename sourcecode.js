const TREE_URL = 'https://api.github.com/repos/BasedHardware/omi/git/trees/main?recursive=1';
const RAW_ROOT = 'https://raw.githubusercontent.com/BasedHardware/omi/main/';
const PAGE_ROOT = 'https://github.com/BasedHardware/omi/blob/main/';
const MAX_SOURCE_FILE_BYTES = 250_000;

function usefulSourceEntry(entry) {
  const path = String(entry?.path || '');
  const size = Number(entry?.size || 0);
  return (
    entry?.type === 'blob' &&
    size > 0 &&
    size <= MAX_SOURCE_FILE_BYTES &&
    /^app\/lib\/(?:providers|services)\/.+\.dart$/i.test(path) &&
    !/\.(?:g|freezed)\.dart$/i.test(path)
  );
}

function encodePath(path) {
  return String(path || '')
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
}

async function mapPool(items, limit, fn) {
  const out = [];
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      out[index] = await fn(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return out;
}

async function loadOfficialSource(fetchImpl, store, { concurrency = 6, maxFiles = 250 } = {}) {
  if (!store?.saveDocPage) return 0;
  const fetchFn = fetchImpl || fetch;
  const treeRes = await fetchFn(TREE_URL, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'omi-vector-bot' },
  });
  if (!treeRes.ok) return 0;
  const data = await treeRes.json();
  const entries = (Array.isArray(data?.tree) ? data.tree : [])
    .filter(usefulSourceEntry)
    .slice(0, Math.max(0, maxFiles));

  const saved = await mapPool(entries, Math.max(1, concurrency), async (entry) => {
    try {
      const encoded = encodePath(entry.path);
      const res = await fetchFn(`${RAW_ROOT}${encoded}`, {
        headers: { Accept: 'text/plain', 'User-Agent': 'omi-vector-bot' },
      });
      if (!res.ok) return 0;
      const body = await res.text();
      if (!String(body || '').trim()) return 0;
      await store.saveDocPage({
        url: `${PAGE_ROOT}${encoded}`,
        title: entry.path,
        body,
      });
      return 1;
    } catch (err) {
      console.error(`[DB] official source failed (${entry.path}):`, err.message);
      return 0;
    }
  });
  return saved.reduce((sum, count) => sum + count, 0);
}

module.exports = {
  PAGE_ROOT,
  TREE_URL,
  loadOfficialSource,
  usefulSourceEntry,
};
