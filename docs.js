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
  isSingleItemDeletionQuestion,
  isDeveloperIntent,
  isDeveloperPageCompatibleQuestion,
} = require('./retrieval');
let indexCache = { at: 0, text: '' };
let indexLookup = null;

async function docsIndexText(fetchFn) {
  const now = Date.now();
  if (indexCache.text && now - indexCache.at <= 60 * 60 * 1000) return indexCache.text;
  if (!indexLookup) {
    indexLookup = (async () => {
      const response = await fetchFn(INDEX_URL);
      if (!response.ok) return '';
      const text = await response.text();
      indexCache = { at: Date.now(), text };
      return text;
    })().finally(() => { indexLookup = null; });
  }
  return indexLookup;
}

function newDocsLookupCache() {
  return { fetches: new Map(), searches: new Map(), saves: new Map() };
}

function memoizedDocsFetch(fetchFn, cache) {
  if (!cache) return fetchFn;
  return async (url, options) => {
    const key = String(url);
    if (!cache.fetches.has(key)) {
      cache.fetches.set(key, Promise.resolve().then(async () => {
        const response = await fetchFn(url, options);
        return { ok: response.ok, status: response.status, body: response.ok ? await response.text() : '' };
      }));
    }
    const snapshot = await cache.fetches.get(key);
    return { ok: snapshot.ok, status: snapshot.status, text: async () => snapshot.body };
  };
}

function memoizedDocsStore(store, cache) {
  if (!cache || !store?.searchDocPages) return store;
  return {
    searchDocPages: (query, limit, sources = []) => {
      const key = JSON.stringify([query, limit, sources]);
      if (!cache.searches.has(key)) {
        cache.searches.set(key, Promise.resolve().then(() => store.searchDocPages(query, limit, sources)));
      }
      return cache.searches.get(key);
    },
    saveDocPage: store.saveDocPage && ((page) => {
      const key = String(page.url || '');
      if (!cache.saves.has(key)) {
        cache.saves.set(key, Promise.resolve().then(() => store.saveDocPage(page)));
      }
      return cache.saves.get(key);
    }),
  };
}

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

function githubDocsPath(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.toLowerCase() !== 'github.com') return '';
    const match = decodeURIComponent(parsed.pathname).match(/^\/BasedHardware\/omi\/blob\/[^/]+\/docs\/(.+\.(?:md|mdx))$/i);
    return match ? match[1].replace(/\.mdx?$/i, '.md').toLowerCase() : '';
  } catch {
    return '';
  }
}

function canonicalizeGithubDocsEvidence(evidence, { indexText, fetchImpl } = {}) {
  const text = String(evidence || '');
  if (!/github\.com\/BasedHardware\/omi\/blob\/[^/]+\/docs\//i.test(text)) return Promise.resolve(text);
  return Promise.resolve(indexText || docsIndexText(fetchImpl || fetch)).then((index) => {
    if (!index) return text;
    const official = new Map(pagesFromIndex(index).map((page) => [
      decodeURIComponent(new URL(page.url).pathname).slice(1).toLowerCase(), page.url,
    ]));
    return text.replace(/https:\/\/github\.com\/BasedHardware\/omi\/blob\/[^\s)>]+/gi, (url) =>
      official.get(githubDocsPath(url)) || url);
  }).catch(() => text);
}

function compatibleDevicePage(question, page) {
  const developerQuestion = isDeveloperPageCompatibleQuestion(question);
  if (!developerQuestion && /\/api-reference\//i.test(String(page.url || ''))) return false;
  if (!developerQuestion && isSingleItemDeletionQuestion(question) &&
      /\/(?:doc\/(?:developer|assembly|hardware)\/|get_started\/Flash_device)/i.test(String(page.url || ''))) return false;
  const consumerControls = /\b(?:button|tap|press|hold|turn|power|light|led|pair|reset)\b/i.test(question) &&
    /\b(?:omi|necklace)\b/i.test(question) && !/\bdev\s*kit\b|devkit/i.test(question);
  return !consumerControls || !/\bdev\s*kit\b|devkit/i.test(`${page.title || ''} ${page.url || ''}`);
}

function topPages(question, pages, limit = 2, compatibilityQuestion = question) {
  const wanted = new Set(words(question));
  const deviceControl = /\b(?:button|tap|press|hold|turn|power|light|led|pair|reset)\b/i.test(question) &&
    /\b(?:omi|device|necklace)\b/i.test(question);
  return pages
    .filter((page) => compatibleDevicePage(compatibilityQuestion, page))
    .map((page) => ({
      page,
      score: words(`${page.title} ${page.blurb} ${page.url}`).filter((word) => wanted.has(word)).length +
        (deviceControl && /\bomi\b/i.test(page.title) && /\bsetup\b/i.test(page.title) ? 1 : 0),
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
    const allSets = batches.map((batch) => batch[0].filter((row) => compatibleDevicePage(question, row)));
    const helpSets = batches.map((batch) => batch[1].filter((row) => compatibleDevicePage(question, row)));
    const githubSets = batches.map((batch) => batch[2].filter((row) => compatibleDevicePage(question, row)));
    const developerQuestion = isDeveloperIntent(question);
    const ranked = mergeRanked([...allSets, ...helpSets, ...githubSets], developerQuestion ? 24 : 12);
    if (developerQuestion) {
      const developerPage = (row) => /^https:\/\/docs\.omi\.me\/(?:api-reference|docs?\/developer)\//i.test(String(row.url || ''));
      ranked.sort((a, b) => Number(developerPage(b)) - Number(developerPage(a)) || b.fusedScore - a.fusedScore);
    }
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

async function relevantDocs(question, { fetchImpl, store, queries: plannedQueries = [], lookupCache } = {}) {
  const fetchFn = memoizedDocsFetch(fetchImpl || fetch, lookupCache);
  const saved = memoizedDocsStore(activeStore(store), lookupCache);
  const queries = supportQueries(question, plannedQueries);
  const stored = await storedDocs(question, saved, plannedQueries);
  if (stored) return stored;
  try {
    const indexText = await docsIndexText(fetchFn);
    if (!indexText) return '';
    const allPages = pagesFromIndex(indexText);
    const picked = [];
    const seen = new Set();
    for (const query of queries) {
      for (const page of topPages(query, allPages, 3, question)) {
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
    return formatEvidence(rankLocalChunks(queries, chunks, 8, { customerQuestion: question }));
  } catch (err) {
    console.error('[Docs] lookup failed:', err.message);
    return '';
  }
}

module.exports = { relevantDocs, storedDocs, pagesFromIndex, topPages, clipPage, newDocsLookupCache, canonicalizeGithubDocsEvidence };
