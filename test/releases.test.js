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
  assert.match(text, /https:\/\/github\.com\/BasedHardware\/omi\/releases\/tag\/v1\.2\.0/);
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

const desktopFeed = [
  {
    tag_name: 'v0.12.464+12464-macos',
    name: 'Omi Desktop v0.12.464 (candidate)',
    body: "## OMI Desktop v0.12.464\n\n### What's New\n- Bug fixes and improvements",
    published_at: '2026-10-10T12:00:00Z',
  },
  {
    tag_name: 'v0.12.463+12463-macos',
    name: 'Omi Desktop v0.12.463 (candidate)',
    body: "## OMI Desktop v0.12.463\n\n### What's New\n- Settings now say plainly what the app does with the latest version of your data",
    published_at: '2026-10-10T09:00:00Z',
  },
  {
    tag_name: 'v0.12.452+12452-macos',
    name: 'Omi Desktop v0.12.452 (candidate)',
    body: "## OMI Desktop v0.12.452\n\n### What's New\n- Fixed chat failing with a generic error for BYOK users in the desktop app",
    published_at: '2026-10-08T12:00:00Z',
  },
];

function releaseFor(question, feed = desktopFeed) {
  resetReleaseCache();
  return matchingRelease(question, { fetchImpl: async () => ({ ok: true, json: async () => feed }), store: null });
}

test('a latest-version question gets the newest release, not the one that shares the most words', async () => {
  for (const question of [
    'What is the latest version of the desktop app?',
    'Where do I download the desktop app, which version?',
    "What's new in the desktop app?",
  ]) {
    assert.match(await releaseFor(question), /v0\.12\.464/, question);
  }
});

test('a firmware or phone app question is not handed a desktop release note', async () => {
  for (const question of [
    'Is there a firmware update for my Omi?',
    "What's new in the latest version of the phone app?",
    'Any new version of the Android app?',
  ]) {
    assert.equal(await releaseFor(question), '', question);
  }
});

test('a question about one fix still gets the release that mentions it', async () => {
  assert.match(await releaseFor('Which desktop version fixed the BYOK chat error?'), /v0\.12\.452/);
  assert.equal(await releaseFor('Which desktop version fixed the calendar sync?'), '');
});
