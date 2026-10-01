const { cleanDocument } = require('./retrieval');

const SITEMAP = 'https://www.omi.me/sitemap.xml';

function sitemapUrls(xml) {
  return [...String(xml || '').matchAll(/<loc>([^<]+)<\/loc>/g)]
    .map((match) => match[1].replace(/&amp;/g, '&').trim())
    .filter(Boolean);
}

function contentSitemaps(xml) {
  return sitemapUrls(xml).filter((url) => /\/sitemap_(?:products|pages)_\d+\.xml/i.test(url));
}

function supportPageUrls(xml) {
  return sitemapUrls(xml).filter((url) => {
    try {
      const parsed = new URL(url);
      return /^(?:www\.)?omi\.me$/i.test(parsed.hostname) && /^\/(?:products|pages)\//i.test(parsed.pathname);
    } catch {
      return false;
    }
  });
}

function titleFromHtml(html, url) {
  const raw = (String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || url;
  return cleanDocument(raw, 240).replace(/\s*[–—|]\s*Omi\s*$/i, '').trim();
}

function pageText(html) {
  const main =
    (String(html || '').match(/<main[\s\S]*?<\/main>/i) || [])[0] ||
    (String(html || '').match(/<body[\s\S]*?<\/body>/i) || [])[0] ||
    html;
  return cleanDocument(main);
}

async function mapPool(items, limit, fn) {
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      await fn(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
}

async function loadOfficialWebsite(fetchImpl, db) {
  const fetchFn = fetchImpl || fetch;
  const root = await fetchFn(SITEMAP, { headers: { 'User-Agent': 'omi-vector-bot' } });
  if (!root.ok) return 0;
  const maps = contentSitemaps(await root.text());
  const urls = [];
  for (const map of maps) {
    try {
      const res = await fetchFn(map, { headers: { 'User-Agent': 'omi-vector-bot' } });
      if (!res.ok) continue;
      urls.push(...supportPageUrls(await res.text()));
    } catch (err) {
      console.error('[Website] sitemap failed:', err.message);
    }
  }

  let saved = 0;
  const unique = [...new Set(urls)].slice(0, 160);
  await mapPool(unique, 4, async (url) => {
    try {
      const res = await fetchFn(url, { headers: { 'User-Agent': 'omi-vector-bot' } });
      if (!res.ok) return;
      const html = await res.text();
      const body = pageText(html);
      if (body.length < 80) return;
      await db.saveDocPage({ url, title: titleFromHtml(html, url), body });
      saved += 1;
    } catch (err) {
      console.error('[Website] page failed:', err.message);
    }
  });
  return saved;
}

module.exports = {
  SITEMAP,
  sitemapUrls,
  contentSitemaps,
  supportPageUrls,
  titleFromHtml,
  pageText,
  loadOfficialWebsite,
};
