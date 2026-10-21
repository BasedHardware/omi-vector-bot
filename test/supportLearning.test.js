const test = require('node:test');
const assert = require('node:assert/strict');
const { createObserver } = require('../supportLearning');
const { createSupportMemory, createMemoryStore } = require('../supportMemory');

const now = Date.now();
function fixture() {
  const store = createMemoryStore();
  const policy = { enabled: true, contextEnabled: true, forumIds: ['help'], staffIds: ['staff'], botId: 'bot' };
  const memory = createSupportMemory({ store, policy, key: Buffer.alloc(32, 3) });
  const channel = { id: 'thread', guildId: 'guild', ownerId: 'alice', parentId: 'help', isThread: () => true };
  const message = (id, author, content, at = now) => ({ id, channel, guildId: 'guild', author: { id: author, bot: author === 'bot' }, content, createdTimestamp: at });
  const observer = createObserver(memory);
  return { store, memory, channel, message, observer };
}

test('retained attempts survive observer recreation but only after Discord revalidates them', async () => {
  const { memory, channel, message, observer } = fixture();
  const earlier = message('old', 'alice', 'Already restarted the phone.', now - 1000);
  await observer.capture(earlier);
  const restarted = createObserver(memory);
  const live = message('new', 'staff', 'Please send the app version.');
  channel.messages = { fetch: async options => {
    assert.deepEqual(options, { message: 'old', force: true, cache: false }); return earlier;
  } };
  const history = await restarted.history(channel, 'current', [live], 'alice');
  assert.deepEqual(history.map(m => m.content), ['Already restarted the phone.', 'Please send the app version.']);
  assert.deepEqual(history.map(m => m.author), ['customer', 'staff']);
});

test('an offline deletion is not resurrected; failed access never returns stale private text', async () => {
  const { channel, message, observer, memory } = fixture();
  await observer.capture(message('old', 'alice', 'This message was removed while the bot was offline.'));
  channel.messages = { fetch: async () => { throw Object.assign(Error('missing'), { code: 10008 }); } };
  assert.deepEqual(await observer.history(channel, 'current', [], 'alice'), []);
  assert.deepEqual(await memory.history(memory.scopeFor(channel)), []);
  await observer.capture(message('other', 'alice', 'Do not expose this without live access.'));
  channel.messages.fetch = async () => { throw Object.assign(Error('access denied'), { code: 50013 }); };
  assert.deepEqual(await observer.history(channel, 'current', [], 'alice'), []);
});

test('another participant in the same public thread cannot receive retained customer context', async () => {
  const { observer, channel, message } = fixture();
  const live = message('past', 'alice', 'Owner-specific past attempt');
  assert.deepEqual(await observer.history(channel, 'current', [live], 'bob'), []);
});

test('message edits and bulk/thread deletes flow through the same observer without answering', async () => {
  const { channel, message, observer, memory } = fixture();
  await observer.capture(message('m1', 'alice', 'Old text'));
  await observer.capture({ ...message('m1', 'alice', 'Corrected text'), editedTimestamp: now + 1 });
  assert.equal((await memory.history(memory.scopeFor(channel)))[0].id, 'm1');
  assert.equal((await memory.history(memory.scopeFor(channel)))[0].content, undefined);
  await observer.forgetMessage(message('m1', 'alice', ''));
  assert.deepEqual(await memory.history(memory.scopeFor(channel)), []);
  await observer.capture(message('m2', 'staff', 'Human response'));
  await observer.forgetThread(channel);
  assert.deepEqual(await memory.history(memory.scopeFor(channel)), []);
});

test('memory outages are isolated from customer delivery and never print raw exception text', async t => {
  const logs = [];
  t.mock.method(console, 'error', (...args) => logs.push(args.join(' ')));
  const observer = createObserver({ enabled: true, capture: async () => { throw Error('CANARY-private-text'); } });
  assert.equal(await observer.capture({}), false);
  assert.doesNotMatch(logs.join(' '), /CANARY/);
  assert.match(logs.join(' '), /SupportMemory/);
});

test('partial edits fetch only an approved support thread; general-channel edits cause no read', async () => {
  const { channel, message, observer, memory } = fixture();
  let fetches = 0;
  const partial = { ...message('edit', 'alice', ''), partial: true, fetch: async () => {
    fetches++; return { ...message('edit', 'alice', 'New text'), editedTimestamp: now + 1 };
  } };
  await observer.update(partial);
  assert.equal(fetches, 1);
  assert.equal((await memory.history(memory.scopeFor(channel)))[0].id, 'edit');
  assert.equal((await memory.history(memory.scopeFor(channel)))[0].content, undefined);
  await observer.update({ ...partial, channel: { ...channel, parentId: 'other' } });
  assert.equal(fetches, 1);
});

test('quality inputs cannot replace the approved thread scope', async () => {
  const { observer, channel, store } = fixture();
  await observer.signal(channel, { guildId: 'unrelated', threadId: 'stranger', customerId: 'bob', eventId: 'event', kind: 'needs_help', area: 'app' }, 'alice');
  const [row] = [...store.signals.values()];
  assert.equal(row.guildId, 'guild'); assert.equal(row.threadId, 'thread'); assert.equal(row.customerId, 'alice');
});

test('another participant cannot be counted as an outcome for the post owner', async () => {
  const { observer, channel, store } = fixture();
  assert.equal(await observer.signal(channel, { eventId: 'other', kind: 'review_rejected', area: 'app' }, 'bob'), false);
  assert.equal(store.signals.size, 0);
});

test('optional writes are serialized and bounded without dropping customer deletion', async t => {
  t.mock.method(console, 'error', () => {});
  let release;
  const waiting = new Promise(resolve => { release = resolve; });
  let active = 0, peak = 0, deletes = 0;
  const observer = createObserver({ enabled: true, scopeFor: () => ({ guildId: 'g', threadId: 't', customerId: 'c' }),
    capture: async () => { active++; peak = Math.max(peak, active); await waiting; active--; return true; },
    forgetMessage: async () => { deletes++; } }, { maxPendingWrites: 2 });
  const first = observer.capture({}), second = observer.capture({});
  const excess = await Promise.race([observer.capture({}), new Promise(resolve => setTimeout(() => resolve('not bounded'), 30))]);
  await observer.forgetMessage({ id: 'deleted' });
  assert.equal(deletes, 1);
  release(); await Promise.all([first, second]);
  assert.equal(excess, false);
  assert.equal(peak, 1);
  assert.equal(observer.health().droppedWrites, 1);
});

test('unrelated channels cannot occupy the optional support-write queue', async t => {
  const logs = [];
  t.mock.method(console, 'error', text => logs.push(text));
  const observer = createObserver({ enabled: true, scopeFor: () => null,
    capture: async () => { throw Error('an unrelated channel must not be processed'); } });
  assert.equal(await observer.capture({ channel: {} }), false);
  assert.equal(logs.length, 0);
  assert.equal(observer.health().pendingWrites, 0);
});

for (const deletion of ['message', 'thread']) {
  test(`${deletion} deletion wins before the first queued capture registers its thread`, async () => {
    const { memory, store, channel, message } = fixture();
    let release;
    const blocked = new Promise(resolve => { release = resolve; });
    const delayed = createObserver({ ...memory, capture: async item => { await blocked; return memory.capture(item); } });
    const saving = delayed.capture(message('pending', 'alice', 'Remove this before retention starts.'));
    try {
      if (deletion === 'message') await delayed.forgetMessage(message('pending', 'alice', ''));
      else await delayed.forgetThread(channel);
    } finally { release(); }
    assert.equal(await saving, false);
    assert.equal(store.rows.size, 0);
  });
}

test('deletions outside the capture pilot do not register never-retained threads', async () => {
  const { store, message, channel } = fixture();
  const memory = createSupportMemory({ store, policy: { enabled: true, forumIds: ['pilot'], deleteForumIds: ['help', 'pilot'], staffIds: [] } });
  const observer = createObserver(memory);
  await observer.forgetMessage(message('outside', 'alice', ''));
  await observer.forgetThread(channel);
  const later = createSupportMemory({ store, policy: { enabled: true, forumIds: ['help'], staffIds: [] }, key: Buffer.alloc(32, 3) });
  assert.equal(await later.capture(message('outside', 'alice', 'Not suppressed by unrelated deletion observation.')), true);
});

test('expiry cleanup bypasses a full optional write queue and concurrent sweeps coalesce', async t => {
  t.mock.method(console, 'error', () => {});
  let releaseWrite, releasePrune, prunes = 0;
  const writing = new Promise(resolve => { releaseWrite = resolve; });
  const pruning = new Promise(resolve => { releasePrune = resolve; });
  const observer = createObserver({ enabled: true, scopeFor: () => ({ guildId: 'g', threadId: 't', customerId: 'c' }),
    capture: async () => { await writing; return true; },
    prune: async () => { prunes++; await pruning; } }, { maxPendingWrites: 1 });
  const saving = observer.capture({});
  const first = observer.prune(), second = observer.prune();
  await new Promise(resolve => setImmediate(resolve));
  const concurrentSweeps = prunes;
  releaseWrite(); releasePrune();
  await Promise.all([saving, first, second]);
  assert.equal(concurrentSweeps, 1);
  assert.equal(observer.health().droppedWrites, 0);
});

test('aggregate improvement suggestions contain no case text and cannot publish themselves', () => {
  const { improvementCandidates } = require('../supportLearning');
  const candidates = improvementCandidates([
    { kind: 'no_official_source', area: 'app', count: 4, customerText: 'CANARY private text' },
    { kind: 'delivery_failed', area: 'shop', count: 1 },
    { kind: 'arbitrary private content', area: 'private@example.test', count: 9 },
    { kind: 'answer_sent', area: 'app', count: 100 },
  ]);
  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].kind, 'delivery_failed');
  assert.ok(candidates.every(c => c.status === 'needs_review'));
  assert.match(candidates[0].nextAction, /delivery/);
  assert.doesNotMatch(JSON.stringify(candidates), /CANARY|private@example|arbitrary|customerText/);
});

test('customer erasure works with capture disabled and without a decryption key', async t => {
  const before = process.env.HELP_FORUM_CHANNEL_ID;
  process.env.HELP_FORUM_CHANNEL_ID = 'help';
  t.after(() => { if (before === undefined) delete process.env.HELP_FORUM_CHANNEL_ID; else process.env.HELP_FORUM_CHANNEL_ID = before; });
  const { memory, store, message, channel } = fixture();
  await memory.capture(message('erase', 'alice', 'Saved attempt'));
  const { forgetOwnedThread } = require('../supportLearning');
  assert.equal(await forgetOwnedThread(channel, 'bob', { store }), false);
  assert.equal(await forgetOwnedThread(channel, 'alice', { store }), true);
  assert.deepEqual(await memory.history(memory.scopeFor(channel)), []);
  assert.equal(await memory.capture(message('later', 'alice', 'Do not recapture')), false);
});

test('reference memory capture and cleanup do not consult the identity encryption key', t => {
  const values = { SUPPORT_MEMORY_ENABLED: '1', SUPPORT_MEMORY_POLICY_APPROVED: '1', SUPPORT_MEMORY_FORUM_IDS: 'help',
    HELP_FORUM_CHANNEL_ID: 'help', DATABASE_URL: 'postgres://synthetic@localhost/unused_test', DATA_ENCRYPTION_KEY: '' };
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  Object.assign(process.env, values);
  t.after(() => { for (const key of Object.keys(values)) if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; });
  t.mock.method(console, 'error', () => {});
  t.mock.method(require('../supportIdentityStore'), 'configuredKey', () => { throw Error('Memory must not inspect the identity key'); });
  const observer = require('../supportLearning').getObserver('bot');
  assert.equal(observer.enabled, true);
  assert.equal(observer.contextEnabled, false);
  assert.equal(observer.cleanupEnabled, true);
});
