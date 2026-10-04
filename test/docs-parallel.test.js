const assert = require('node:assert/strict');
const test = require('node:test');
const { relevantDocs } = require('../docs');

test('selected docs pages fetch concurrently and keep index order', async () => {
  const urls = [
    'https://docs.omi.me/omi-battery-a.md',
    'https://docs.omi.me/omi-battery-b.md',
    'https://docs.omi.me/omi-battery-c.md',
  ];
  const started = [];
  let releasePages;
  const pagesReady = new Promise((resolve) => { releasePages = resolve; });
  const fetchImpl = async (url, options) => {
    assert.ok(options.signal, 'official requests have a bounded wait');
    if (String(url).endsWith('/llms.txt')) {
      return {
        ok: true,
        text: async () => urls.map((pageUrl, index) =>
          `- [Omi battery ${index + 1}](${pageUrl}): Omi battery recording guide`).join('\n'),
      };
    }
    started.push(String(url));
    await pagesReady;
    return { ok: true, text: async () => `# Omi battery\n\nPart ${started.indexOf(String(url)) + 1} explains recording and charging.` };
  };

  const result = relevantDocs('Omi battery recording', { fetchImpl });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(started, urls, 'all selected pages start before any one completes');
  releasePages();
  const evidence = await result;
  assert.ok(evidence.includes(urls[0]));
  assert.ok(evidence.indexOf(urls[0]) < evidence.indexOf(urls[1]));
});
