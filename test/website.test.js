const assert = require('node:assert/strict');
const test = require('node:test');
const {
  contentSitemaps,
  loadOfficialWebsite,
  pageText,
  supportPageUrls,
} = require('../website');

test('the Omi sitemap keeps product, page and curated news sources', () => {
  const root = `
    <loc>https://www.omi.me/sitemap_products_1.xml?from=1&amp;to=2</loc>
    <loc>https://www.omi.me/sitemap_pages_1.xml?from=1&amp;to=2</loc>
    <loc>https://www.omi.me/sitemap_blogs_1.xml</loc>`;
  assert.deepEqual(contentSitemaps(root), [
    'https://www.omi.me/sitemap_products_1.xml?from=1&to=2',
    'https://www.omi.me/sitemap_pages_1.xml?from=1&to=2',
    'https://www.omi.me/sitemap_blogs_1.xml',
  ]);
  assert.deepEqual(
    supportPageUrls('<loc>https://www.omi.me/products/omi</loc><loc>https://www.omi.me/blogs/news/new-features</loc><loc>https://www.omi.me/blogs/iot-devices-faq/other-device</loc><loc>https://evil.example/pages/omi</loc>'),
    ['https://www.omi.me/products/omi', 'https://www.omi.me/blogs/news/new-features']
  );
});

test('website ingestion stores cleaned official product text', async () => {
  const saved = [];
  const count = await loadOfficialWebsite(
    async (url) => {
      const target = String(url);
      if (target.endsWith('/sitemap.xml')) {
        return { ok: true, text: async () => '<loc>https://www.omi.me/sitemap_products_1.xml</loc>' };
      }
      if (target.includes('sitemap_products')) {
        return { ok: true, text: async () => '<loc>https://www.omi.me/products/omi</loc>' };
      }
      return {
        ok: true,
        text: async () =>
          '<html><head><title>Omi Necklace — Omi</title><script>secret()</script></head><body><main><h1>Omi Necklace</h1><p>Battery life is up to a day. The necklace connects to the Omi app and is designed for everyday conversations.</p></main></body></html>',
      };
    },
    { saveDocPage: async (page) => saved.push(page) }
  );
  assert.equal(count, 1);
  assert.equal(saved[0].url, 'https://www.omi.me/products/omi');
  assert.match(saved[0].body, /Battery life/);
  assert.doesNotMatch(saved[0].body, /secret/);
  assert.match(pageText('<main><h2>Pairing</h2><p>Use the app.</p></main>'), /Pairing\nUse the app/);
});
