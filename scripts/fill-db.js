const { pagesFromIndex, clipPage } = require('../docs');

const INDEX_URL = 'https://docs.omi.me/llms.txt';
const RELEASES_URL = 'https://api.github.com/repos/BasedHardware/omi/releases';

function clipRelease(text) {
  const plain = String(text || '')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > 800 ? `${plain.slice(0, 800)}…` : plain;
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
  const workers = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return out;
}

async function tableCount(db, table) {
  if (typeof db.count === 'function') return db.count(table);
  const { rows } = await db.pool.query(`SELECT count(*)::int AS n FROM ${table}`);
  return rows[0].n;
}

async function loadDocs(fetchImpl, db) {
  const fetchFn = fetchImpl || fetch;
  const indexRes = await fetchFn(INDEX_URL);
  if (!indexRes.ok) return 0;
  const pages = pagesFromIndex(await indexRes.text());
  const saved = await mapPool(pages, 5, async (page) => {
    try {
      const res = await fetchFn(page.url);
      if (!res.ok) return 0;
      const body = clipPage(await res.text());
      if (!body) return 0;
      await db.saveDocPage({ url: page.url, title: page.title, body });
      return 1;
    } catch (err) {
      console.error('[DB] doc page failed:', err.message);
      return 0;
    }
  });
  return saved.reduce((sum, n) => sum + n, 0);
}

async function loadReleases(fetchImpl, db) {
  const fetchFn = fetchImpl || fetch;
  let saved = 0;
  for (let page = 1; page <= 6; page += 1) {
    const res = await fetchFn(`${RELEASES_URL}?per_page=100&page=${page}`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'omi-vector-bot' },
    });
    if (!res.ok) break;
    const data = await res.json();
    if (!Array.isArray(data) || !data.length) break;
    for (const item of data) {
      const tag = String(item.tag_name || '');
      if (!tag) continue;
      await db.saveRelease({
        tag,
        name: String(item.name || tag),
        body: clipRelease(item.body),
        publishedAt: item.published_at || null,
      });
      saved += 1;
    }
    if (data.length < 100) break;
  }
  return saved;
}

async function fillIfEmpty({ fetchImpl, store, force = false } = {}) {
  const db = store || require('../db');
  const docsHaveRows = !force && (await tableCount(db, 'doc_pages')) > 0;
  const releasesHaveRows = !force && (await tableCount(db, 'releases')) > 0;
  let docs = 0;
  let releases = 0;
  if (!docsHaveRows) docs = await loadDocs(fetchImpl, db);
  if (!releasesHaveRows) releases = await loadReleases(fetchImpl, db);
  if (docs || releases) console.log(`[DB] filled docs=${docs} releases=${releases}`);
  return { docs, releases };
}

module.exports = { fillIfEmpty, loadDocs, loadReleases };

if (require.main === module) {
  fillIfEmpty({ force: process.argv.includes('--force') })
    .then(() => require('../db').shutdown())
    .catch((err) => {
      console.error('[DB] fill failed:', err.message);
      process.exit(1);
    });
}
