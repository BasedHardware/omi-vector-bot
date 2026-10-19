const test = require('node:test');
const assert = require('node:assert/strict');
const { createStore, scopeForThread, languageCode, getStore, RETENTION_MS } = require('../supportThreadLanguage');

test('only thread scopes with guild, thread and current owner are eligible', () => {
  const channel = { guildId: 'guild', id: 'thread', ownerId: 'owner', isThread: () => true };
  assert.deepEqual(scopeForThread(channel), { guildId: 'guild', threadId: 'thread', ownerId: 'owner' });
  for (const key of ['guildId', 'id', 'ownerId']) assert.equal(scopeForThread({ ...channel, [key]: undefined }), null);
  assert.equal(scopeForThread({ ...channel, isThread: () => false }), null);
  assert.equal(scopeForThread({ ...channel, ownerId: 'private text is not an ID' }), null);
});

test('language storage accepts codes, not messages or arbitrary metadata', async () => {
  const calls = [];
  const store = createStore({ query: async (...args) => { calls.push(args); return { rows: [] }; } }, { now: () => 1000 });
  const scope = { guildId: 'guild', threadId: 'thread', ownerId: 'owner', message: 'fixture-private-text' };
  assert.equal(await store.save(scope, 'es'), true);
  assert.deepEqual(calls[0][1], ['guild', 'thread', 'owner', 'es', new Date(1000 + RETENTION_MS)]);
  for (const value of ['fixture-private-text', 'es; DROP TABLE', '__proto__', '', null, {}]) {
    assert.equal(await store.save(scope, value), false);
  }
  assert.equal(calls.length, 1);
  assert.equal(languageCode('hi-Latn'), 'hi-Latn');
  assert.equal(languageCode('hi-Deva'), 'hi-Deva');
  assert.equal(await store.save({ ...scope, ownerId: '' }, 'es'), false);
});

test('lookup is owner-bound and expiry-filtered with no process-local copy', async () => {
  const calls = []; let failed = false;
  const pool = { query: async (...args) => {
    calls.push(args); if (failed) throw new Error('synthetic database outage');
    return { rows: [{ language_code: 'zh' }] };
  } };
  const scope = { guildId: 'guild', threadId: 'thread', ownerId: 'owner' };
  const first = createStore(pool, { now: () => 1000 });
  assert.equal(await first.get(scope), 'zh');
  assert.deepEqual(calls[0][1], ['guild', 'thread', 'owner', new Date(1000)]);
  assert.match(calls[0][0], /owner_id=\$3 AND expires_at>\$4/);
  failed = true;
  await assert.rejects(first.get(scope));
  await assert.rejects(createStore(pool).get(scope));
});

test('without a configured database, preferences are unavailable, never process memory', t => {
  const previous = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  t.after(() => { if (previous === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous; });
  assert.equal(getStore(), null);
  assert.throws(() => createStore(null));
});
