const assert = require('node:assert/strict');
const test = require('node:test');
const { matchingRelease, resetReleaseCache } = require('../releases');

test('a desktop version question gets the matching release note', async () => {
  resetReleaseCache();
  const text = await matchingRelease('What is the latest version of the desktop app?', {
    fetchImpl: async () => ({
      ok: true,
      json: async () => [
        {
          tag_name: 'v1.2.0',
          name: 'Desktop app',
          body: 'The desktop app download is fixed.',
          published_at: '2026-09-01T00:00:00Z',
        },
      ],
    }),
  });
  assert.match(text, /Desktop app/);
  assert.match(text, /v1\.2\.0/);
});

test('a charging question does not pull a release note', async () => {
  resetReleaseCache();
  let called = false;
  const text = await matchingRelease('My Omi is not charging.', {
    fetchImpl: async () => {
      called = true;
      return { ok: true, json: async () => [] };
    },
  });
  assert.equal(text, '');
  assert.equal(called, false);
});
