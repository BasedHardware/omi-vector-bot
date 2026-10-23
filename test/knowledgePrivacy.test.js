const test = require('node:test');
const assert = require('node:assert/strict');
const { createCaseService, createMemoryStore } = require('../supportCases');
const { forgetOwnedThread } = require('../supportLearning');
const { createMemoryStore: memoryStore } = require('../supportMemory');

function policy(t) {
  const old = process.env.HELP_FORUM_CHANNEL_ID;
  process.env.HELP_FORUM_CHANNEL_ID = 'synthetic-forum';
  t.after(() => { if (old === undefined) delete process.env.HELP_FORUM_CHANNEL_ID; else process.env.HELP_FORUM_CHANNEL_ID = old; });
}
const channel = { id: 'synthetic-post', guildId: 'synthetic-guild', parentId: 'synthetic-forum',
  ownerId: 'synthetic-owner', isThread: () => true, name: 'Synthetic support' };
const scope = { guildId: channel.guildId, forumId: channel.parentId, threadId: channel.id, customerId: channel.ownerId };

test('support cases persist server/forum scope without rebinding it on later calls', async () => {
  const cases = createCaseService(createMemoryStore());
  const input = { channelId: channel.id, customerThreadId: channel.id, customerId: channel.ownerId,
    guildId: channel.guildId, forumId: channel.parentId };
  const first = await cases.getOrCreateCase(input);
  assert.equal(first.guildId, channel.guildId); assert.equal(first.forumId, channel.parentId);
  const later = await cases.getOrCreateCase({ ...input, guildId: 'other-guild', forumId: 'other-forum' });
  assert.equal(later.guildId, first.guildId); assert.equal(later.forumId, first.forumId);
  const legacy = await cases.getOrCreateCase({ channelId: 'legacy', customerId: channel.ownerId });
  assert.equal(legacy.guildId, null); assert.equal(legacy.forumId, null);
  await assert.rejects(cases.getOrCreateCase({ ...input, forumId: null }), /Incomplete/);
});

test('case scope is derived only from the owner of a configured support post', t => {
  policy(t); const { caseScopeFor } = require('../supportKnowledgePrivacy');
  assert.deepEqual(caseScopeFor(channel, channel.ownerId), { guildId: channel.guildId, forumId: channel.parentId });
  assert.deepEqual(caseScopeFor(channel, 'other-owner'), {});
  assert.deepEqual(caseScopeFor({ ...channel, parentId: 'other-forum' }, channel.ownerId), {});
  assert.deepEqual(caseScopeFor({ ...channel, name: 'Handoff — synthetic' }, channel.ownerId), {});
});

test('forgetting verifies the owner and passes only application-derived scope to correction erasure', async t => {
  policy(t); const calls = [];
  const eraseKnowledge = async value => { calls.push(value); return { ok: true }; };
  const store = memoryStore();
  assert.equal(await forgetOwnedThread(channel, 'other-owner', { store, eraseKnowledge }), false);
  assert.equal(calls.length, 0);
  assert.equal(await forgetOwnedThread(channel, channel.ownerId, { store, eraseKnowledge }), true);
  assert.deepEqual(calls, [scope]);
});

test('a correction-erasure failure cannot claim complete deletion, but the memory opt-out survives', async t => {
  policy(t); const store = memoryStore();
  assert.equal(await forgetOwnedThread(channel, channel.ownerId, { store,
    eraseKnowledge: async () => ({ ok: false, reason: 'unavailable' }) }), false);
  assert.equal(await store.isSuppressed({ ...scope, threadId: 'later-post' }, Date.now()), true);
});

test('a thrown correction-erasure failure is metadata-only and never becomes a success', async t => {
  policy(t); const logs = [];
  t.mock.method(console, 'error', (...parts) => logs.push(parts.join(' ')));
  assert.equal(await forgetOwnedThread(channel, channel.ownerId, { store: memoryStore(),
    eraseKnowledge: async () => { throw Error('SYNTHETIC-PRIVATE-ERROR'); } }), false);
  assert.equal(logs.length, 1); assert.doesNotMatch(logs[0], /SYNTHETIC|synthetic-owner|synthetic-guild/);
});

test('unsupported forums and handoff posts cannot invoke correction erasure', async t => {
  policy(t); let calls = 0;
  for (const invalid of [{ ...channel, parentId: 'other-forum' }, { ...channel, name: 'Handoff — synthetic' }]) {
    assert.equal(await forgetOwnedThread(invalid, channel.ownerId, { store: memoryStore(),
      eraseKnowledge: async () => { calls++; return { ok: true }; } }), false);
  }
  assert.equal(calls, 0);
});

test('the privacy coordinator bounds immediate passes and never confirms unfinished work', async () => {
  const { eraseOwnedKnowledge } = require('../supportKnowledgePrivacy');
  let calls = 0;
  const store = { eraseOwnedReferences: async value => { calls++; assert.deepEqual(value, scope); return { ok: true, remaining: true }; } };
  assert.equal((await eraseOwnedKnowledge(scope, { store })).ok, false);
  assert.equal(calls, 10);
  calls = 0;
  store.eraseOwnedReferences = async () => ({ ok: true, remaining: ++calls < 2 });
  assert.equal((await eraseOwnedKnowledge(scope, { store })).ok, true);
  assert.equal(calls, 2);
});

test('the privacy coordinator rejects incomplete scope before any storage call', async () => {
  const { eraseOwnedKnowledge } = require('../supportKnowledgePrivacy');
  let calls = 0;
  const store = { eraseOwnedReferences: async () => { calls++; return { ok: true }; } };
  assert.equal((await eraseOwnedKnowledge({ customerId: channel.ownerId }, { store })).ok, false);
  assert.equal(calls, 0);
});

test('the privacy coordinator does not fall back after a database failure or print the raw error', async t => {
  const { eraseOwnedKnowledge } = require('../supportKnowledgePrivacy');
  const logs = []; let calls = 0;
  t.mock.method(console, 'error', (...parts) => logs.push(parts.join(' ')));
  assert.deepEqual(await eraseOwnedKnowledge(scope, { store: { eraseOwnedReferences: async () => {
    calls++; throw Error('SYNTHETIC-PRIVATE-ERROR');
  } } }), { ok: false, reason: 'unavailable' });
  assert.equal(calls, 1); assert.equal(logs.length, 1); assert.doesNotMatch(logs[0], /SYNTHETIC|synthetic-owner/);
});
