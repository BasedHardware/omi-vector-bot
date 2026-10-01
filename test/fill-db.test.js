const assert = require('node:assert/strict');
const test = require('node:test');
const { fillIfEmpty } = require('../scripts/fill-db');

function memoryStore() {
  const docs = [];
  const releases = [];
  return {
    docs,
    releases,
    count(table) {
      if (table === 'doc_pages') return docs.length;
      if (table === 'releases') return releases.length;
      return 0;
    },
    async saveDocPage(page) {
      docs.push(page);
    },
    async saveRelease(note) {
      releases.push(note);
    },
  };
}

test('an empty store is filled from the docs index and release list', async () => {
  const store = memoryStore();
  const result = await fillIfEmpty({
    store,
    fetchImpl: async (url) => {
      const target = String(url);
      if (target.endsWith('/llms.txt')) {
        return {
          ok: true,
          text: async () =>
            '- [Battery](https://docs.omi.me/doc/battery.md): battery life\n- [Pairing](https://docs.omi.me/doc/pair.md): pair the device',
        };
      }
      if (target.includes('api.github.com')) {
        return {
          ok: true,
          json: async () => [
            { tag_name: 'v1.2.0', name: 'Desktop', body: 'Desktop download fix.', published_at: '2026-09-01T00:00:00Z' },
          ],
        };
      }
      return { ok: true, text: async () => 'Battery life is 24 hours to a few days.' };
    },
  });
  assert.equal(result.docs, 2);
  assert.equal(result.releases, 1);
  assert.equal(store.docs.length, 2);
  assert.equal(store.releases[0].tag, 'v1.2.0');
});

test('a store that already has rows is left alone', async () => {
  const store = memoryStore();
  store.docs.push({ url: 'https://docs.omi.me/already' });
  store.releases.push({ tag: 'v0' });
  let called = false;
  const result = await fillIfEmpty({
    store,
    fetchImpl: async () => {
      called = true;
      return { ok: false };
    },
  });
  assert.equal(called, false);
  assert.equal(result.docs, 0);
  assert.equal(result.releases, 0);
});

test('the daily fill indexes official public source independently of code-search permission', async () => {
  const store = memoryStore();
  store.docs.push({ url: 'https://docs.omi.me/already' });
  store.releases.push({ tag: 'v0' });
  store.countPagesLike = async () => 0;
  store.sourceNeedsSync = async (key) => key === 'github-source';
  store.markSourceSynced = async (key, count) => {
    store.synced = { key, count };
  };

  const result = await fillIfEmpty({
    store,
    fetchImpl: async (url) => {
      const target = String(url);
      if (target.includes('/git/trees/')) {
        return {
          ok: true,
          json: async () => ({
            tree: [{ type: 'blob', path: 'app/lib/providers/message_provider.dart', size: 100 }],
          }),
        };
      }
      return { ok: true, text: async () => 'AI responses are added to chat messages.' };
    },
  });

  assert.equal(result.source, 1);
  assert.deepEqual(store.synced, { key: 'github-source', count: 1 });
  assert.equal(store.docs.at(-1).title, 'app/lib/providers/message_provider.dart');
});
