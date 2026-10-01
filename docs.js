const INDEX_URL = 'https://docs.omi.me/llms.txt';
const CLIP = 1800;
let indexCache = { at: 0, text: '' };

function words(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length >= 3);
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
  const plain = String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > CLIP ? `${plain.slice(0, CLIP)}…` : plain;
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

async function storedDocs(question, store) {
  if (!store?.searchDocPages) return '';
  try {
    const rows = await store.searchDocPages(question, 4);
    return (rows || [])
      .map((row) => `${row.title}\n${row.url}\n${clipPage(row.body)}`)
      .filter((block) => block.trim())
      .join('\n\n');
  } catch (err) {
    console.error('[Docs] stored lookup failed:', err.message);
    return '';
  }
}

async function relevantDocs(question, { fetchImpl, store } = {}) {
  const fetchFn = fetchImpl || fetch;
  const saved = activeStore(store);
  try {
    const now = Date.now();
    if (!indexCache.text || now - indexCache.at > 60 * 60 * 1000) {
      const indexRes = await fetchFn(INDEX_URL);
      if (!indexRes.ok) return storedDocs(question, saved);
      indexCache = { at: now, text: await indexRes.text() };
    }
    const picked = topPages(question, pagesFromIndex(indexCache.text));
    if (!picked.length) return storedDocs(question, saved);
    const blocks = [];
    const pages = [];
    for (const page of picked) {
      const pageRes = await fetchFn(page.url);
      if (!pageRes.ok) continue;
      const excerpt = clipPage(await pageRes.text());
      if (!excerpt) continue;
      blocks.push(`${page.title}\n${page.url}\n${excerpt}`);
      pages.push({ url: page.url, title: page.title, body: excerpt });
    }
    await rememberPages(saved, pages);
    if (blocks.length) {
      const stored = await storedDocs(question, saved);
      return [blocks.join('\n\n'), stored].filter(Boolean).join('\n\n');
    }
    return storedDocs(question, saved);
  } catch (err) {
    console.error('[Docs] lookup failed:', err.message);
    return storedDocs(question, saved);
  }
}

module.exports = { relevantDocs, pagesFromIndex, topPages, clipPage };
