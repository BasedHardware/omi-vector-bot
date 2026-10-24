const test = require('node:test');
const assert = require('node:assert/strict');
const { createMemoryStore, createSupportMemory } = require('../supportMemory');
const { createObserver, forgetOwnedThread } = require('../supportLearning');

const DAY = 86400000;
const at = 1792310400000;
function fixture({ key = Buffer.alloc(32, 9) } = {}) {
  const store = createMemoryStore();
  const policy = { enabled: true, contextEnabled: true, forumIds: ['help', 'pilot'], deleteForumIds: ['help', 'pilot'], staffIds: ['staff'], botId: 'bot' };
  const memory = createSupportMemory({ store, policy, now: () => at, key });
  const channel = (id = 'thread-a', ownerId = 'alice', parentId = 'help', guildId = 'guild') => ({ id, ownerId, parentId, guildId, isThread: () => true });
  const message = (id, ch = channel(), createdTimestamp = at) => ({ id, channel: ch, guildId: ch.guildId, author: { id: ch.ownerId }, createdTimestamp,
    content: 'Synthetic earlier attempt' });
  return { store, policy, memory, channel, message };
}

test('memory persists reference fields only and never reads text or an encryption key', async () => {
  const { memory, store, message } = fixture({ key: () => { throw Error('Memory must not read an encryption key'); } });
  const referenceOnly = message('message-a');
  Object.defineProperty(referenceOnly, 'content', { get() { throw Error('Reference capture must not read message text'); } });
  assert.equal(await memory.capture(referenceOnly), true);
  const row = [...store.rows.values()][0];
  assert.deepEqual(Object.keys(row).sort(), ['at', 'customerId', 'expiresAt', 'forumId', 'guildId', 'messageId', 'role', 'threadId']);
  assert.equal(row.expiresAt, at + 30 * DAY);
  const [reference] = await memory.history(memory.scopeFor(message('message-a').channel));
  assert.equal(reference.id, 'message-a');
  assert.equal(reference.trust, 'conversation_only');
  assert.equal(reference.content, undefined);
});

test('earlier post lookup is owner guild and forum scoped, excludes the current post and caps at two', async () => {
  const { memory, channel, message } = fixture();
  for (const [n, ch] of [
    [1, channel('old-a')], [2, channel('old-b')], [3, channel('old-c')],
    [4, channel('stranger', 'bob')], [5, channel('other-forum', 'alice', 'pilot')],
    [6, channel('other-guild', 'alice', 'help', 'other')], [7, channel('current')],
  ]) await memory.capture(message(`message-${n}`, ch, at - (10 - n) * 1000));
  const earlier = await memory.otherThreads(memory.scopeFor(channel('current')));
  assert.deepEqual(earlier.map(row => row.threadId), ['old-c', 'old-b']);
  assert.ok(earlier.every(row => row.guildId === 'guild' && row.customerId === 'alice' && row.forumId === 'help'));
});

test('forget erases all owner references and outcomes in the forum and preserves other scopes', async () => {
  const { memory, store, channel, message } = fixture();
  for (const ch of [channel('old-a'), channel('old-b'), channel('other-owner', 'bob'), channel('other-forum', 'alice', 'pilot')]) {
    await memory.capture(message(`message-${ch.id}`, ch));
    await memory.signal({ ...memory.scopeFor(ch), eventId: 'outcome', kind: 'needs_help', area: 'app' });
  }
  await memory.forgetCustomer(memory.scopeFor(channel('new-empty-post')));
  assert.deepEqual([...store.rows.values()].map(row => row.threadId).sort(), ['other-forum', 'other-owner']);
  assert.deepEqual([...store.signals.values()].map(row => row.threadId).sort(), ['other-forum', 'other-owner']);
  assert.equal(await memory.capture(message('future', channel('yet-another-post'))), false);
  assert.equal(await memory.signal({ ...memory.scopeFor(channel('yet-another-post')), eventId: 'future', kind: 'answer_sent' }), false);
  assert.deepEqual(await memory.otherThreads(memory.scopeFor(channel('new-empty-post'))), []);
  const restarted = createSupportMemory({ store, policy: { enabled: true, forumIds: ['help'], staffIds: [] }, now: () => at + 40 * DAY });
  await restarted.prune();
  assert.equal(await restarted.capture(message('after-restart', channel('fresh-post'), at + 40 * DAY)), false);
});

test('forum-wide opt-out wins over queued first capture and queued outcomes', async () => {
  const { memory, store, channel, message } = fixture();
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const observer = createObserver({ ...memory, capture: async value => { await pending; return memory.capture(value); } });
  const saving = observer.capture(message('queued', channel('queued-post')));
  const signal = observer.signal(channel('queued-post'), { eventId: 'queued-event', kind: 'needs_help' }, 'alice');
  await memory.forgetCustomer(memory.scopeFor(channel('different-post')));
  release();
  assert.equal(await saving, false);
  assert.equal(await signal, false);
  assert.equal(store.rows.size + store.signals.size, 0);
});

test('references expire from creation and duplicate edits cannot extend their lifetime', async () => {
  const { memory, store, channel, message, policy } = fixture();
  await memory.capture(message('old', channel(), at - 29 * DAY));
  await memory.capture({ ...message('old', channel()), editedTimestamp: at });
  assert.equal([...store.rows.values()][0].expiresAt, at + DAY);
  const later = createSupportMemory({ store, policy, now: () => at + DAY });
  assert.deepEqual(await later.history(later.scopeFor(channel())), []);
  await later.prune();
  assert.equal(store.rows.size, 0);
});

test('the development adapter also strips unapproved fields rather than copying the input object', async () => {
  const store = createMemoryStore();
  await store.put({ guildId: 'g', forumId: 'f', threadId: 't', customerId: 'c', messageId: 'm', role: 'customer', at, expiresAt: at + DAY,
    text: 'SYNTHETIC-TEXT-MUST-NOT-PERSIST', ciphertext: 'SYNTHETIC-CIPHERTEXT', iv: 'synthetic', tag: 'synthetic', attachment: 'synthetic' }, at);
  assert.doesNotMatch(JSON.stringify([...store.rows.values()]), /SYNTHETIC|ciphertext|attachment|"text"|"iv"|"tag"/);
});

test('deletion and customer opt-out still work with both capture and context switches off', async t => {
  const before = process.env.HELP_FORUM_CHANNEL_ID;
  process.env.HELP_FORUM_CHANNEL_ID = 'help';
  t.after(() => { if (before === undefined) delete process.env.HELP_FORUM_CHANNEL_ID; else process.env.HELP_FORUM_CHANNEL_ID = before; });
  const { store, memory, channel, message, policy } = fixture();
  await memory.capture(message('one', channel('first')));
  await memory.capture(message('two', channel('second')));
  const off = createSupportMemory({ store, policy: { ...policy, enabled: false, contextEnabled: false }, now: () => at });
  assert.ok(off.deletionScopeFor(channel('first')));
  assert.equal(await forgetOwnedThread(channel('second'), 'alice', { store }), true);
  assert.equal(store.rows.size, 0);
  assert.equal(await memory.capture(message('future', channel('third'))), false);
});

test('observer switches reflect policy changes instead of caching an enabled state', () => {
  const { memory, policy } = fixture();
  const observer = createObserver(memory);
  assert.equal(observer.enabled, true);
  assert.equal(observer.contextEnabled, true);
  policy.contextEnabled = false;
  assert.equal(observer.contextEnabled, false);
  policy.enabled = false;
  assert.equal(observer.enabled, false);
});

test('a review signal cannot replace the last actual support outcome', async () => {
  const { memory, channel, message } = fixture();
  await memory.capture(message('previous', channel('previous')));
  const scope = memory.scopeFor(channel('previous'));
  await memory.signal({ ...scope, eventId: 'a-resolution', kind: 'resolved', area: 'app' });
  await memory.signal({ ...scope, eventId: 'z-review', kind: 'review_rejected', area: 'app' });
  const [previous] = await memory.otherThreads(memory.scopeFor(channel('current')));
  assert.equal(previous.outcome, 'resolved');
  assert.ok((await memory.report()).some(row => row.kind === 'review_rejected'));
});
