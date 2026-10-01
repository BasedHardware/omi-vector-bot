const INDEX_URL = 'https://docs.omi.me/llms.txt';
const CLIP = 60_000;
const {
  cleanDocument,
  chunkDocument,
  formatEvidence,
  mergeRanked,
  queryTerms,
  rankLocalChunks,
  supportQueries,
} = require('./retrieval');
let indexCache = { at: 0, text: '' };

function words(text) {
  return queryTerms(text, 30);
}

function pagesFromIndex(text) {
  const pages = [];
  const re = /\[([^\]]+)\]\((https:\/\/docs\.omi\.me\/[^)\s]+)\)(?::\s*([^\n]+))?/g;
  let match;
  while ((match = re.exec(String(text || '')))) {
    pages.push({ title: match[1], url: match[2], blurb: match[3] || '' });
  }
  return pages;
}

function topPages(question, pages, limit = 2) {
  const wanted = new Set(words(question));
  return pages
    .map((page) => ({
      page,
      score: words(`${page.title} ${page.blurb} ${page.url}`).filter((word) => wanted.has(word)).length,
    }))
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((hit) => hit.page);
}

function clipPage(text) {
  return cleanDocument(text, CLIP);
}

function activeStore(store) {
  if (store) return store;
  if (!process.env.DATABASE_URL) return null;
  return require('./db');
}

async function rememberPages(store, pages) {
  if (!store?.saveDocPage) return;
  for (const page of pages) {
    try {
      await store.saveDocPage(page);
    } catch (err) {
      console.error('[Docs] save failed:', err.message);
    }
  }
}

async function storedDocs(question, store, plannedQueries = []) {
  if (!store?.searchDocPages) return '';
  try {
    const queries = supportQueries(question, plannedQueries);
    const batches = await Promise.all(
      queries.map((query) =>
        Promise.all([
          store.searchDocPages(query, 12),
          store.searchDocPages(query, 5, ['help']),
          store.searchDocPages(query, 5, ['github']),
        ])
      )
    );
    const allSets = batches.map((batch) => batch[0]);
    const helpSets = batches.map((batch) => batch[1]);
    const githubSets = batches.map((batch) => batch[2]);
    const ranked = mergeRanked([...allSets, ...helpSets, ...githubSets], 12);
    const required = [mergeRanked(helpSets, 1)[0], mergeRanked(githubSets, 1)[0]].filter(Boolean);
    const rows = [];
    const seen = new Set();
    for (const row of [...ranked.slice(0, 3), ...required, ...ranked.slice(3)]) {
      const key = `${row.url || ''}#${row.chunk_index ?? row.chunkIndex ?? 0}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(row);
      if (rows.length >= 8) break;
    }
    return formatEvidence(rows);
  } catch (err) {
    console.error('[Docs] stored lookup failed:', err.message);
    return '';
  }
}

async function relevantDocs(question, { fetchImpl, store, queries: plannedQueries = [] } = {}) {
  const fetchFn = fetchImpl || fetch;
  const saved = activeStore(store);
  const queries = supportQueries(question, plannedQueries);
  const stored = await storedDocs(question, saved, plannedQueries);
  if (stored) return stored;
  try {
    const now = Date.now();
    if (!indexCache.text || now - indexCache.at > 60 * 60 * 1000) {
      const indexRes = await fetchFn(INDEX_URL);
      if (!indexRes.ok) return '';
      indexCache = { at: now, text: await indexRes.text() };
    }
    const allPages = pagesFromIndex(indexCache.text);
    const picked = [];
    const seen = new Set();
    for (const query of queries) {
      for (const page of topPages(query, allPages, 3)) {
        if (seen.has(page.url)) continue;
        seen.add(page.url);
        picked.push(page);
        if (picked.length >= 6) break;
      }
      if (picked.length >= 6) break;
    }
    if (!picked.length) return '';
    const pages = [];
    const chunks = [];
    for (const page of picked) {
      const pageRes = await fetchFn(page.url);
      if (!pageRes.ok) continue;
      const excerpt = clipPage(await pageRes.text());
      if (!excerpt) continue;
      pages.push({ url: page.url, title: page.title, body: excerpt });
      chunks.push(...chunkDocument({ url: page.url, title: page.title, body: excerpt }));
    }
    await rememberPages(saved, pages);
    return formatEvidence(rankLocalChunks(queries, chunks, 8));
  } catch (err) {
    console.error('[Docs] lookup failed:', err.message);
    return '';
  }
}

module.exports = { relevantDocs, storedDocs, pagesFromIndex, topPages, clipPage };
