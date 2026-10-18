const test = require('node:test');
const assert = require('node:assert/strict');
const { createMemoryStore, createSupportMemory } = require('../supportMemory');
const { createObserver } = require('../supportLearning');

function fixture(options = {}) {
  const now = Date.now();
  const store = createMemoryStore();
  const policy = { enabled: true, contextEnabled: true, forumIds: ['help','pilot'], deleteForumIds: ['help','pilot'], staffIds: ['staff'], botId: 'bot' };
  const memory = createSupportMemory({ store, policy });
  const channels = new Map(), messages = new Map(), reads = [];
  const client = { channels: { fetch: async (id, flags) => {
    reads.push({ type: 'post', id, flags });
    assert.deepEqual(flags, { force: true, cache: false });
    const value = channels.get(id);
    if (value instanceof Error) throw value;
    return value;
  } } };
  const channel = (id, ownerId = 'alice', parentId = 'help', guildId = 'guild') => {
    const ch = { id, ownerId, parentId, guildId, client, name: 'Earlier support attempt', isThread: () => true };
    ch.messages = { fetch: async flags => {
      reads.push({ type: 'message', id: flags.message, flags });
      assert.deepEqual(flags, { message: flags.message, force: true, cache: false });
      const value = messages.get(flags.message);
      if (value instanceof Error) throw value;
      return value;
    } };
    channels.set(id, ch); return ch;
  };
  const current = channel('current');
  const message = (id, ch, content, authorId = ch.ownerId, at = now - 1000) => ({
    id, channel: ch, guildId: ch.guildId, content, createdTimestamp: at,
    author: { id: authorId, bot: authorId === 'bot' },
  });
  async function save(id, ch, content, authorId, at) {
    const value = message(id, ch, content, authorId, at); messages.set(id, value);
    await memory.capture(value); return value;
  }
  const observer = createObserver(memory, options);
  const live = [message('current-earlier', current, 'Current post detail.')];
  const read = () => observer.history(current, 'current-newest', live, 'alice');
  return { now, store, memory, policy, observer, channel, current, message, save, messages, channels, reads, live, read };
}
const previous = rows => rows.filter(row => row.source === 'previous_post');

test('a new post receives live earlier attempts, title and outcome, not retained message copies', async () => {
  const f = fixture(), old = f.channel('old');
  for (let i = 0; i < 4; i++) await f.save('owner-' + i, old, i ? 'Earlier attempt ' + i : 'Discard the oldest owner message', 'alice', f.now - 9000 + i);
  await f.save('old-bot', old, 'Discard the older bot reply', 'bot', f.now - 8000);
  await f.save('last-bot', old, 'Earlier bot reply; not product evidence.', 'bot', f.now - 7000);
  // Staff chatter must not crowd the owner's last three references out of context.
  for (let i = 0; i < 55; i++) await f.save('staff-' + i, old, 'STAFF-ONLY-SYNTHETIC-CANARY', 'staff', f.now - 6000 + i);
  f.messages.get('owner-3').content = 'I already re-opened the app. https://private.test/path';
  old.name = 'Connection follow-up';
  await f.memory.signal({ ...f.memory.scopeFor(old), eventId: 'needs-help', kind: 'needs_help', area: 'app' });
  const rows = await f.read(), notes = previous(rows);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].trust, 'conversation_only');
  assert.match(notes[0].content, /Connection follow-up/);
  assert.match(notes[0].content, /Earlier attempt 1/);
  assert.match(notes[0].content, /Earlier attempt 2/);
  assert.match(notes[0].content, /already re-opened/);
  assert.match(notes[0].content, /Earlier bot reply/);
  assert.match(notes[0].content, /needs_help/);
  assert.doesNotMatch(notes[0].content, /Discard|STAFF-ONLY|private\.test/);
  assert.ok(rows.some(row => row.content === 'Current post detail.'));
  assert.equal(f.reads.filter(row => row.type === 'message').length, 4);
  assert.doesNotMatch(JSON.stringify([...f.store.rows.values()]), /Earlier attempt|re-opened|Connection follow-up/);
});

test('no more than two other posts are read, always uncached', async () => {
  const f = fixture();
  for (let i = 0; i < 3; i++) await f.save('post-message-' + i, f.channel('older-' + i), 'Attempt ' + i, 'alice', f.now - 3000 + i);
  const rows = await f.read();
  assert.equal(previous(rows).length, 2);
  assert.deepEqual(f.reads.filter(row => row.type === 'post').map(row => row.id).sort(), ['older-1','older-2']);
});

test('wrong owner, guild or forum references are rejected before any Discord read', async () => {
  const f = fixture(), base = f.memory.scopeFor(f.current);
  const original = f.memory.otherThreads;
  f.memory.otherThreads = async () => [
    { ...base, threadId: 'stranger', customerId: 'bob' },
    { ...base, threadId: 'elsewhere', guildId: 'other' },
    { ...base, threadId: 'different-forum', forumId: 'pilot' },
    { ...base },
  ];
  assert.deepEqual(previous(await f.read()), []);
  assert.equal(f.reads.length, 0);
  f.memory.otherThreads = original;
});

for (const change of ['ownerId','parentId','guildId']) {
  test('live post ' + change + ' changes cannot expose earlier owner context', async () => {
    const f = fixture(), old = f.channel('old');
    await f.save('old-message', old, 'SYNTHETIC-OWNER-CANARY');
    old[change] = 'different';
    assert.deepEqual(previous(await f.read()), []);
    assert.equal(f.reads.filter(row => row.type === 'message').length, 0);
  });
}

test('a deleted earlier post is omitted and its references retired', async () => {
  const f = fixture(), old = f.channel('old');
  await f.save('old-message', old, 'Synthetic removed context');
  f.channels.set('old', Object.assign(Error('synthetic removed'), { code: 10003 }));
  assert.deepEqual(previous(await f.read()), []);
  assert.deepEqual(await f.memory.history(f.memory.scopeFor(old)), []);
});

test('a deleted message is retired; denied reads do not claim deletion', async () => {
  const f = fixture(), old = f.channel('old');
  await f.save('removed', old, 'Synthetic removed context');
  await f.save('denied', old, 'Synthetic inaccessible context');
  f.messages.set('removed', Object.assign(Error('synthetic missing'), { code: 10008 }));
  f.messages.set('denied', Object.assign(Error('synthetic denied'), { code: 50013 }));
  assert.deepEqual(previous(await f.read()), []);
  assert.deepEqual((await f.memory.history(f.memory.scopeFor(old))).map(row => row.id), ['denied']);
});

test('a database outage leaves current-post history intact and logs one fixed metadata line', async t => {
  const f = fixture(), logs = [];
  t.mock.method(console, 'error', (...args) => logs.push(args.join(' ')));
  f.memory.otherThreads = async () => { throw Error('SYNTHETIC-RAW-EXCEPTION'); };
  const rows = await f.read();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].content, 'Current post detail.');
  assert.equal(logs.length, 1);
  assert.doesNotMatch(logs.join(' '), /SYNTHETIC-RAW/);
});

test('extra context has a hard 1500ms ceiling even if a larger budget is requested', async t => {
  const f = fixture({ historyBudgetMs: 9000 }), delays = [];
  const set = global.setTimeout;
  t.mock.method(global, 'setTimeout', (callback, delay, ...args) => { delays.push(delay); return set(callback, Math.min(delay, 5), ...args); });
  t.mock.method(console, 'error', () => {});
  f.memory.otherThreads = () => new Promise(() => {});
  assert.equal((await f.read())[0].content, 'Current post detail.');
  assert.deepEqual(delays, [1500]);
});

test('a timed-out post fetch cannot schedule later message reads or inject late context', async t => {
  const f = fixture({ historyBudgetMs: 5 }), old = f.channel('old');
  await f.save('old-message', old, 'Synthetic late context');
  let release;
  old.client.channels.fetch = async () => new Promise(resolve => { release = () => resolve(old); });
  t.mock.method(console, 'error', () => {});
  const rows = await f.read();
  assert.equal(typeof release, 'function');
  assert.deepEqual(previous(rows), []);
  release(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.reads.filter(row => row.type === 'message').length, 0);
});

test('turning context off during a live read prevents later content use', async () => {
  const f = fixture(), old = f.channel('old');
  await f.save('old-message', old, 'Synthetic late context');
  old.client.channels.fetch = async () => { f.policy.contextEnabled = false; return old; };
  assert.deepEqual(previous(await f.read()), []);
  assert.equal(f.reads.filter(row => row.type === 'message').length, 0);
});

test('opt-out during the live fetch prevents already-read earlier content being returned', async () => {
  const f = fixture(), old = f.channel('old');
  await f.save('old-message', old, 'Synthetic now-forgotten context');
  old.messages.fetch = async () => {
    await f.memory.forgetCustomer(f.memory.scopeFor(f.current));
    return f.messages.get('old-message');
  };
  assert.deepEqual(previous(await f.read()), []);
});

test('expired earlier references never cause a Discord read', async () => {
  const f = fixture(), old = f.channel('old');
  await f.save('ancient', old, 'Synthetic expired context', 'alice', f.now - 31 * 86400000);
  assert.deepEqual(previous(await f.read()), []);
  assert.equal(f.reads.length, 0);
});

test('disabled context never looks up earlier posts but retains the current post', async () => {
  const f = fixture(); f.policy.contextEnabled = false;
  f.memory.otherThreads = () => { throw Error('Disabled context must not query'); };
  assert.equal((await f.read())[0].content, 'Current post detail.');
  assert.equal(f.reads.length, 0);
});

test('timed-out reads remain capacity-bounded until the underlying operation settles', async t => {
  const f = fixture({ historyBudgetMs: 5, maxPendingReads: 1 });
  let release, calls = 0;
  f.memory.otherThreads = async () => { calls++; return new Promise(resolve => { release = resolve; }); };
  t.mock.method(console, 'error', () => {});
  await f.read();
  await f.read();
  assert.equal(calls, 1);
  assert.equal(f.observer.health().pendingReads, 1);
  release([]); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.observer.health().pendingReads, 0);
});

test('deleting a referenced reply cannot preserve an outcome whose supporting message was removed', async () => {
  const f = fixture(), old = f.channel('old');
  await f.save('owner-detail', old, 'I already checked Bluetooth.');
  await f.save('removed-bot', old, 'Synthetic earlier answer', 'bot');
  await f.memory.signal({ ...f.memory.scopeFor(old), eventId: 'resolution', kind: 'resolved' });
  f.messages.set('removed-bot', Object.assign(Error('synthetic missing'), { code: 10008 }));
  const [note] = previous(await f.read());
  assert.match(note.content, /Stored outcome: unknown/);
  assert.doesNotMatch(note.content, /Stored outcome: resolved/);
});

test('opt-out after a reference query prevents scheduling new message reads from that stale result', async () => {
  const f = fixture(), old = f.channel('old');
  await f.save('owner-detail', old, 'Synthetic earlier detail');
  const original = f.memory.contextReferences;
  f.memory.contextReferences = async scope => {
    const references = await original(scope);
    await f.memory.forgetCustomer(f.memory.scopeFor(f.current));
    return references;
  };
  assert.deepEqual(previous(await f.read()), []);
  assert.equal(f.reads.filter(row => row.type === 'message').length, 0);
});
