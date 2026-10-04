const assert = require('node:assert/strict');
const test = require('node:test');
const { relevantDocs, newDocsLookupCache } = require('../docs');

test('parallel raw and planned lookups fetch each official URL once', async () => {
  const seen = new Map();
  const pageUrl = 'https://docs.omi.me/onboarding/pairing';
  const fetchImpl = async (url) => {
    seen.set(String(url), (seen.get(String(url)) || 0) + 1);
    return { ok: true, status: 200, text: async () => String(url) === pageUrl
      ? 'Pair the Omi device in the Omi app using Bluetooth.'
      : `[Pairing Omi](${pageUrl}): Pair the Omi device in the app.` };
  };
  const cache = newDocsLookupCache();
  const [raw, planned] = await Promise.all([
    relevantDocs('Pair the Omi device', { fetchImpl, lookupCache: cache }),
    relevantDocs('Pair the Omi device', { fetchImpl, lookupCache: cache, queries: ['Omi Bluetooth pairing'] }),
  ]);
  assert.match(raw, /Pair the Omi device/);
  assert.match(planned, /Pair the Omi device/);
  assert.equal(seen.get('https://docs.omi.me/llms.txt'), 1);
  assert.equal(seen.get(pageUrl), 1);
});

test('parallel stored lookups deduplicate identical index searches', async () => {
  const calls = [];
  const store = {
    searchDocPages: async (query, limit, sources) => {
      calls.push([query, limit, sources]);
      return [{ url: 'https://help.omi.me/pairing', title: 'Pairing', body: 'Pair the device in the app.', source: 'help' }];
    },
  };
  const cache = newDocsLookupCache();
  await Promise.all([
    relevantDocs('How to pair Omi?', { store, lookupCache: cache }),
    relevantDocs('How to pair Omi?', { store, lookupCache: cache }),
  ]);
  assert.equal(calls.length, 3, 'all/help/github searches each run once');
});
