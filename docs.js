const INDEX_URL = 'https://docs.omi.me/llms.txt';
const CLIP = 1800;
let indexCache = { at: 0, text: '' };

function words(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 3);
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

function bestPage(question, pages) {
  const wanted = new Set(words(question));
  let best = null;
  let score = 0;
  for (const page of pages) {
    const shared = words(`${page.title} ${page.blurb} ${page.url}`).filter((word) => wanted.has(word));
    if (shared.length > score) {
      score = shared.length;
      best = page;
    }
  }
  return score > 0 ? best : null;
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

async function relevantDocs(question, { fetchImpl } = {}) {
  const fetchFn = fetchImpl || fetch;
  try {
    const now = Date.now();
    if (!indexCache.text || now - indexCache.at > 60 * 60 * 1000) {
      const indexRes = await fetchFn(INDEX_URL);
      if (!indexRes.ok) return '';
      indexCache = { at: now, text: await indexRes.text() };
    }
    const page = bestPage(question, pagesFromIndex(indexCache.text));
    if (!page) return '';
    const pageRes = await fetchFn(page.url);
    if (!pageRes.ok) return '';
    const excerpt = clipPage(await pageRes.text());
    if (!excerpt) return '';
    return `${page.title}\n${page.url}\n${excerpt}`;
  } catch (err) {
    console.error('[Docs] lookup failed:', err.message);
    return '';
  }
}

module.exports = { relevantDocs, pagesFromIndex, bestPage, clipPage };
