const { pagesFromIndex, clipPage } = require('../docs');
const { PAGE_ROOT, loadOfficialSource } = require('../sourcecode');

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

async function shouldSync(db, key, legacyHasRows, { force, maxAgeMs }) {
  if (force) return true;
  if (typeof db.sourceNeedsSync === 'function') {
    return db.sourceNeedsSync(key, maxAgeMs);
  }
  return !legacyHasRows;
}

async function noteSync(db, key, count) {
  if (count > 0 && typeof db.markSourceSynced === 'function') {
    await db.markSourceSynced(key, count);
  }
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

async function fillIfEmpty({ fetchImpl, store, force = false, maxAgeMs = 24 * 60 * 60 * 1000 } = {}) {
  const db = store || require('../db');
  const docsHaveRows = (await tableCount(db, 'doc_pages')) > 0;
  const releasesHaveRows = (await tableCount(db, 'releases')) > 0;
  let docs = 0;
  let releases = 0;
  if (await shouldSync(db, 'docs', docsHaveRows, { force, maxAgeMs })) {
    docs = await loadDocs(fetchImpl, db);
    await noteSync(db, 'docs', docs);
  }
  if (await shouldSync(db, 'releases', releasesHaveRows, { force, maxAgeMs })) {
    releases = await loadReleases(fetchImpl, db);
    await noteSync(db, 'releases', releases);
  }
  if (docs || releases) console.log(`[DB] filled docs=${docs} releases=${releases}`);
  let source = 0;
  if (typeof db.countPagesLike === 'function') {
    const sourceHasRows = (await db.countPagesLike(PAGE_ROOT)) > 0;
    if (await shouldSync(db, 'github-source', sourceHasRows, { force, maxAgeMs })) {
      source = await loadOfficialSource(fetchImpl, db);
      await noteSync(db, 'github-source', source);
    }
    if (source) console.log(`[DB] filled official-source=${source}`);
  }
  let help = 0;
  let discord = 0;
  let website = 0;
  if (db.pool) {
    const { loadHelpCenter, loadDiscordHelp } = require('../helpcenter');
    const { loadOfficialWebsite } = require('../website');
    const helpHaveRows = (await db.countPagesLike('https://help.omi.me/')) > 0;
    const discordHaveRows = (await db.countPagesLike('https://discord.com/channels/')) > 0;
    const websiteHaveRows = (await db.countPagesLike('https://www.omi.me/')) > 0;
    if (await shouldSync(db, 'help', helpHaveRows, { force, maxAgeMs })) {
      help = await loadHelpCenter(fetchImpl, db);
      await noteSync(db, 'help', help);
    }
    if (await shouldSync(db, 'website', websiteHaveRows, { force, maxAgeMs })) {
      website = await loadOfficialWebsite(fetchImpl, db);
      await noteSync(db, 'website', website);
    }
    if (await shouldSync(db, 'discord', discordHaveRows, { force, maxAgeMs })) {
      discord = await loadDiscordHelp(fetchImpl, db);
      await noteSync(db, 'discord', discord);
    }
    if (help || website || discord) {
      console.log(`[DB] filled help=${help} website=${website} discord=${discord}`);
    }
  }
  return { docs, releases, source, help, website, discord };
}

module.exports = { fillIfEmpty, loadDocs, loadOfficialSource, loadReleases };

if (require.main === module) {
  const db = require('../db');
  db.initSchema()
    .then(() => fillIfEmpty({ store: db, force: process.argv.includes('--force') }))
    .then(() => db.shutdown())
    .catch((err) => {
      console.error('[DB] fill failed:', err.message);
      process.exit(1);
    });
}
