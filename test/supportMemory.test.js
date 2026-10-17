const test = require('node:test');
const assert = require('node:assert/strict');
const { createSupportMemory, createMemoryStore, configFromEnv, mergeHistory } = require('../supportMemory');

const now = 1792233000000;
const policy = { enabled: true, forumIds: ['help'], staffIds: ['staff'], botId: 'bot', retentionDays: 30 };
function message(overrides = {}) {
  return { id: 'm1', guildId: 'guild', content: 'I already restarted the phone.',
    createdTimestamp: now, editedTimestamp: null, author: { id: 'alice', bot: false },
    attachments: { size: 0 }, channel: { id: 'thread', guildId: 'guild', parentId: 'help', ownerId: 'alice', isThread: () => true }, ...overrides };
}
function fixture(options = {}) {
  const store = createMemoryStore();
  const memory = createSupportMemory({ store, policy, key: Buffer.alloc(32, 7), now: () => now, ...options });
  return { store, memory };
}
const scope = { guildId: 'guild', threadId: 'thread', customerId: 'alice' };

test('memory is opt-in and requires published privacy policy approval and durable storage', () => {
  const env = { SUPPORT_MEMORY_ENABLED: '1', HELP_FORUM_CHANNEL_ID: 'help', SUPPORT_MEMORY_FORUM_IDS: 'help', DATABASE_URL: 'configured' };
  assert.equal(configFromEnv(env).enabled, false);
  env.SUPPORT_MEMORY_POLICY_APPROVED = '1';
  assert.equal(configFromEnv(env).enabled, true);
  assert.equal(configFromEnv(env).contextEnabled, false);
  assert.equal(configFromEnv({ ...env, SUPPORT_MEMORY_CONTEXT_ENABLED: '1' }).contextEnabled, true);
  assert.equal(configFromEnv({ ...env, DATABASE_URL: '' }).enabled, false);
  assert.equal(configFromEnv({ ...env, SUPPORT_MEMORY_FORUM_IDS: '' }).enabled, false);
  assert.deepEqual(configFromEnv({ ...env, SUPPORT_MEMORY_FORUM_IDS: 'help,unrelated' }).forumIds, ['help']);
  assert.deepEqual(configFromEnv({ ...env, VECTOR_TEST_CHANNEL_ID: 'pilot', SUPPORT_MEMORY_FORUM_IDS: 'pilot' }).forumIds, ['pilot']);
  assert.equal(configFromEnv({ ...env, SUPPORT_MEMORY_RETENTION_DAYS: '9999' }).retentionDays, 30);
});

test('stores only the owning support thread, named staff and this bot; captures quiet staff replies', async () => {
  const { memory, store } = fixture();
  assert.equal(await memory.capture(message()), true);
  assert.equal(await memory.capture(message({ id: 'staff1', author: { id: 'staff', bot: false } })), true);
  assert.equal(await memory.capture(message({ id: 'bot1', author: { id: 'bot', bot: true } })), true);
  for (const other of [message({ author: { id: 'bob' } }), message({ author: { id: 'otherbot', bot: true } }),
    message({ webhookId: 'hook' }), message({ channel: { ...message().channel, parentId: 'general' } }),
    message({ channel: { ...message().channel, ownerId: null } })]) {
    assert.equal(await memory.capture(other), false);
  }
  assert.equal(store.rows.size, 3);
  assert.deepEqual((await memory.history(scope)).map(m => m.author).sort(), ['bot', 'customer', 'staff']);
  assert.deepEqual(await memory.history({ ...scope, customerId: 'bob' }), []);
  assert.deepEqual(await memory.history({ ...scope, guildId: 'other-guild' }), []);
});

test('persistence encrypts redacted content, drops attachments/URLs and binds ciphertext to the scope', async () => {
  const { memory, store } = fixture();
  await memory.capture(message({ content: 'Call me on 98765 43210, order number is 22777, email me at person@example.test. api_key=syntheticsecret123 https://private.test/download?token=abc',
    attachments: { size: 1, values: () => [{ url: 'https://private.test/audio' }] } }));
  const serialized = JSON.stringify([...store.rows.values()]);
  assert.doesNotMatch(serialized, /person@|98765|22777|syntheticsecret|private\.test|Call me/);
  const [entry] = await memory.history(scope);
  assert.doesNotMatch(entry.content, /person@|98765|22777|syntheticsecret|private\.test/);
  assert.equal(entry.attachmentCount, 1);
  const row = [...store.rows.values()][0];
  row.customerId = 'bob';
  await assert.rejects(memory.history({ ...scope, customerId: 'bob' }));
});

test('duplicate delivery and out-of-order edits do not create duplicate or stale history', async () => {
  const { memory, store } = fixture();
  await memory.capture(message());
  await memory.capture(message());
  await memory.capture(message({ content: 'Restarted; still broken.', editedTimestamp: now + 2 }));
  await memory.capture(message({ content: 'Older edit', editedTimestamp: now + 1 }));
  assert.equal(store.rows.size, 1);
  assert.equal((await memory.history(scope))[0].content, 'Restarted; still broken.');
});

test('deletion prevents delayed creates from restoring a message, and thread deletion removes context', async () => {
  const { memory } = fixture();
  await memory.capture(message());
  await assert.rejects(memory.forgetThread({ ...scope, customerId: 'bob' }));
  await memory.forgetMessage({ ...scope, messageId: 'm1' });
  assert.equal(await memory.capture(message()), false);
  await memory.capture(message({ id: 'm2' }));
  await memory.forgetThread(scope);
  assert.deepEqual(await memory.history(scope), []);
  assert.equal(await memory.capture(message({ id: 'm3' })), false);
});

test('retention is based on original creation, edits cannot keep private text indefinitely', async () => {
  const { memory, store } = fixture();
  const ancient = now - 31 * 86400000;
  assert.equal(await memory.capture(message({ createdTimestamp: ancient, editedTimestamp: now })), false);
  await memory.capture(message());
  const expired = createSupportMemory({ store, policy, key: Buffer.alloc(32, 7), now: () => now + 31 * 86400000 });
  assert.deepEqual(await expired.history(scope), []);
  await expired.prune();
  assert.equal(store.rows.size, 0);
});

test('an explicit customer opt-out prevents retention even after the normal retention window', async () => {
  const { memory, store } = fixture();
  await memory.capture(message());
  await memory.forgetThread(scope, { optOut: true });
  const laterNow = now + 31 * 86400000;
  const later = createSupportMemory({ store, policy, key: Buffer.alloc(32, 7), now: () => laterNow });
  await later.prune();
  assert.equal(await later.capture(message({ id: 'new-message', createdTimestamp: laterNow })), false);
});

test('the capture kill switch does not disable deletion or expiry cleanup of existing history', async () => {
  const { memory, store } = fixture();
  await memory.capture(message());
  const off = createSupportMemory({ store, policy: { ...policy, enabled: false, deleteForumIds: ['help'] }, now: () => now + 31 * 86400000 });
  assert.equal(off.cleanupEnabled, true);
  assert.ok(off.deletionScopeFor(message().channel));
  await off.prune();
  assert.equal(store.rows.size, 0);
  await memory.capture(message());
  await off.forgetMessage({ ...scope, messageId: 'm1' }, { onlyKnown: true });
  assert.equal(store.rows.size, 0);
});

test('disabled memory does not call the store; storage errors never fall back to a process cache', async () => {
  const store = { put: async () => { throw Error('database unavailable'); } };
  const disabled = createSupportMemory({ store, policy: { ...policy, enabled: false } });
  assert.equal(await disabled.capture(message()), false);
  assert.deepEqual(await disabled.history(scope), []);
  const { memory } = fixture({ store });
  await assert.rejects(memory.capture(message()), /database unavailable/);
});

test('quality signals are metadata-only, deduplicated and never silently promoted to knowledge', async () => {
  const { memory, store } = fixture();
  const input = { ...scope, eventId: 'feedback1', kind: 'needs_help', area: 'app', detail: 'private customer text' };
  await memory.signal(input); await memory.signal(input);
  const report = await memory.report();
  assert.deepEqual(report, [{ kind: 'needs_help', area: 'app', count: 1 }]);
  assert.doesNotMatch(JSON.stringify([...store.signals.values()]), /private customer text/);
  await assert.rejects(memory.signal({ ...input, kind: 'arbitrary customer input' }));
  await memory.forgetThread(scope);
  assert.deepEqual(await memory.report(), []);
});

test('history merging is chronological, excludes current message, and labels all context as untrusted', () => {
  const saved = [{ id: '1', author: 'customer', content: 'Already restarted.', at: 1 }, { id: '2', author: 'staff', content: 'Old advice', at: 2 }];
  const live = [{ id: '2', author: 'staff', content: 'Corrected advice', at: 2 }, { id: '3', author: 'customer', content: 'Newest', at: 3 }];
  const merged = mergeHistory(saved, live, '3');
  assert.deepEqual(merged.map(m => m.content), ['Already restarted.', 'Corrected advice']);
  assert.ok(merged.every(m => m.trust === 'conversation_only'));
});
