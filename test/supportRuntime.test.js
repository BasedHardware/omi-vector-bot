const test = require('node:test');
const assert = require('node:assert/strict');
const { SupportRuntime, MemoryRuntimeStore, PostgresRuntimeStore, questionFingerprint, assertCurrentOwnership, markCurrentReplySent, initSchema } = require('../supportRuntime');

const request = (messageId, caseKey = 'thread:customer', text = '') => ({ messageId, caseKey, fingerprint: text ? questionFingerprint(text) : null });
const barrier = () => { let release; const promise = new Promise((resolve) => { release = resolve; }); return { promise, release }; };

test('two runtime copies share one message claim and persisted repeat fingerprints', async () => {
  const store = new MemoryRuntimeStore();
  const first = new SupportRuntime({ store });
  const second = new SupportRuntime({ store });
  let calls = 0;
  const held = barrier();
  const pending = first.run(request('one', 'thread:alice', 'Please help'), async () => { calls++; await held.promise; return true; });
  assert.equal((await second.run(request('one', 'thread:alice', 'Please help'), async () => { calls++; return true; })).status, 'duplicate');
  held.release(); await pending;
  assert.equal((await second.run(request('two', 'thread:alice', '  PLEASE   HELP  '), async () => { calls++; return true; })).status, 'duplicate');
  await second.run(request('three', 'thread:bob', 'Please help'), async () => { calls++; return true; });
  assert.equal(calls, 2);
});

test('follow-ups run in arrival order for one customer while another customer progresses', async () => {
  const runtime = new SupportRuntime();
  const held = barrier(); const started = barrier(); const events = [];
  const first = runtime.run(request('a'), async () => { events.push('first'); started.release(); await held.promise; events.push('end'); return true; });
  await started.promise;
  const second = runtime.run(request('b'), async () => { events.push('second'); return true; });
  await runtime.run(request('c', 'other:customer'), async () => { events.push('other'); return true; });
  assert.deepEqual(events, ['first', 'other']);
  held.release(); await Promise.all([first, second]);
  assert.deepEqual(events, ['first', 'other', 'end', 'second']);
});

test('a delayed database claim cannot let a later customer follow-up run first', async () => {
  const store = new MemoryRuntimeStore(); const holdClaim = barrier();
  const originalClaim = store.claim.bind(store);
  store.claim = async (job) => { if (job.messageId === 'first') await holdClaim.promise; return originalClaim(job); };
  const runtime = new SupportRuntime({ store }); const order = [];
  const first = runtime.run(request('first'), async () => { order.push('first'); return true; });
  const second = runtime.run(request('second'), async () => { order.push('second'); return true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(order, []);
  holdClaim.release(); await Promise.all([first, second]);
  assert.deepEqual(order, ['first', 'second']);
});

test('workers are bounded across runtime copies through shared lease slots', async () => {
  const store = new MemoryRuntimeStore({ slots: 1 });
  const first = new SupportRuntime({ store }); const second = new SupportRuntime({ store });
  const held = barrier(); const started = barrier(); let calls = 0;
  const pending = first.run(request('a', 'one'), async () => { calls++; started.release(); await held.promise; return true; });
  await started.promise;
  const waiting = second.run(request('b', 'two'), async () => { calls++; return true; });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(calls, 1);
  held.release(); await Promise.all([pending, waiting]);
  assert.equal(calls, 2);
});

test('draining rejects new work and waits for an accepted reply before returning', async () => {
  const runtime = new SupportRuntime(); const held = barrier(); const started = barrier();
  const pending = runtime.run(request('a'), async () => { started.release(); await held.promise; return true; });
  await started.promise;
  let completed = false;
  const draining = runtime.drain(1000).then((result) => { completed = true; return result; });
  assert.equal((await runtime.run(request('b'), async () => { throw new Error('must not start'); })).status, 'stopping');
  assert.equal(completed, false);
  held.release(); await pending; assert.equal(await draining, true);
});

test('drain has a bounded timeout and keeps existing ownership while work finishes', async () => {
  const runtime = new SupportRuntime(); const held = barrier(); const started = barrier();
  const pending = runtime.run(request('a'), async () => { started.release(); await held.promise; await assertCurrentOwnership(); return true; });
  await started.promise;
  assert.equal(await runtime.drain(5), false);
  held.release(); await pending;
});

test('drain waits for receipt reconciliation added while an accepted send finishes', async () => {
  const runtime = new SupportRuntime(); const send = barrier(); const receipt = barrier();
  const pending = runtime.track(() => send.promise);
  let drained = false;
  const stopping = runtime.drain(1000).then((result) => { drained = true; return result; });
  const reconciliation = runtime.track(() => receipt.promise, { acceptedReceipt: true });
  assert.equal((await runtime.track(() => assert.fail('new work must stop'))).status, 'stopping');
  send.release(); await pending;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(drained, false);
  receipt.release(); await reconciliation;
  assert.equal(await stopping, true);
});

test('additional receipt work cannot restart the original drain timeout', async () => {
  const runtime = new SupportRuntime(); const send = barrier(); const receipt = barrier();
  const pending = runtime.track(() => send.promise);
  const stopping = runtime.drain(5);
  const reconciliation = runtime.track(() => receipt.promise, { acceptedReceipt: true });
  send.release(); await pending;
  assert.equal(await stopping, false);
  receipt.release(); await reconciliation;
});

test('lease expiry fences stale replies and does not automatically replay an uncertain started request', async () => {
  let now = 1000; const store = new MemoryRuntimeStore({ now: () => now });
  const runtime = new SupportRuntime({ store }); const held = barrier(); const started = barrier();
  const pending = runtime.run(request('a'), async () => { started.release(); await held.promise; await assertCurrentOwnership(); return true; });
  const rejected = assert.rejects(pending, /lease lost/);
  await started.promise; now += 120_001;
  assert.equal(await store.claim({ ...request('a'), owner: 'new-owner' }), false);
  // A manually reconciled takeover still cannot be overwritten by the old job.
  store.messages.get('a').owner = 'new-owner';
  held.release(); await rejected;
  assert.equal(store.messages.get('a').owner, 'new-owner');
});

test('queue saturation persists identifiers for later recovery without unbounded fallback sends', async () => {
  const runtime = new SupportRuntime({ concurrency: 1, maxQueued: 0 }); const held = barrier(); const started = barrier();
  const pending = runtime.run(request('a'), async () => { started.release(); await held.promise; return true; });
  await started.promise; let calls = 0;
  assert.equal((await runtime.run(request('b', 'other', 'private request'), async () => { throw new Error('no model'); })).status, 'queued');
  assert.equal((await runtime.run(request('b', 'other'), async () => true)).status, 'queued');
  assert.equal((await runtime.store.queued(10)).length, 1);
  assert.doesNotMatch(JSON.stringify(await runtime.store.queued(10)), /private request/);
  held.release(); await pending;
  await runtime.recoverQueued((input) => runtime.run(input, async () => { calls++; return true; }));
  assert.equal(calls, 1); assert.deepEqual(await runtime.store.queued(10), []);
});

test('deferred identifiers survive replacement of the runtime and queued duplicates can be discarded', async () => {
  const store = new MemoryRuntimeStore();
  await store.enqueue(request('duplicate', 'same'));
  await store.enqueue(request('valid', 'different'));
  const restarted = new SupportRuntime({ store }); let answered = 0;
  await restarted.recoverQueued(async (input) => {
    if (input.messageId === 'duplicate') await store.discard(input);
    else await restarted.run(input, async () => { answered++; return true; });
  });
  assert.equal(answered, 1); assert.deepEqual(await store.queued(10), []);
});

test('database coordination failures do not silently fall back to local claims', async () => {
  const runtime = new SupportRuntime({ store: new PostgresRuntimeStore({ query: async () => { throw new Error('db down'); } }) });
  let calls = 0;
  await assert.rejects(runtime.run(request('a'), async () => { calls++; return true; }), /db down/);
  assert.equal(calls, 0);
});

test('a completion-store failure after a confirmed reply is flagged without replaying delivery', async () => {
  const store = new MemoryRuntimeStore(); const logs = [];
  store.finish = async () => { throw new Error('persistence down'); };
  const runtime = new SupportRuntime({ store, log: (line) => logs.push(line) }); let sends = 0;
  await assert.rejects(runtime.run(request('once'), async () => { sends++; markCurrentReplySent(); return true; }), (error) => error.replyAlreadySent === true);
  assert.equal(sends, 1);
  assert.equal((await runtime.run(request('once'), async () => { sends++; return true; })).status, 'duplicate');
  assert.match(logs[0], /completion uncertain/);
});

test('ignored messages do not suppress a later answer to the same text', async () => {
  const runtime = new SupportRuntime(); let calls = 0;
  await runtime.run(request('a', 'thread', 'hello'), async () => false);
  await runtime.run(request('b', 'thread', 'hello'), async () => { calls++; return true; });
  assert.equal(calls, 1);
});

test('runtime schema and SQL claims persist no raw customer content', async () => {
  const calls = []; const pool = { query: async (sql, args) => { calls.push({ sql, args }); return { rows: [{ message_id: 'a' }] }; } };
  await initSchema(pool);
  const store = new PostgresRuntimeStore(pool);
  await store.claim({ ...request('a', 'thread', 'private meeting and email'), owner: 'owner' });
  assert.match(calls[0].sql, /CREATE TABLE IF NOT EXISTS support_worker_slots/);
  assert.match(calls[1].sql, /ON CONFLICT.*message_id/s);
  assert.doesNotMatch(JSON.stringify(calls), /private meeting and email/);
});
