const test = require('node:test');
const assert = require('node:assert/strict');
const { MemoryRuntimeStore, SupportRuntime, assertCurrentOwnership, markCurrentReplySent } = require('../supportRuntime');

async function fixture({ slots = 1 } = {}) {
  let now = 0;
  const store = new MemoryRuntimeStore({ now: () => now, slots });
  const job = { messageId: 'synthetic-request', caseKey: 'synthetic-case', owner: 'old-worker', fingerprint: null };
  assert.equal(await store.claim(job), true);
  assert.equal(await store.acquire(job), true);
  return { store, job, at: value => { now = value; } };
}

test('the recovery scan adds at most one second to the missed-heartbeat threshold', () => {
  assert.equal(new SupportRuntime().sweepMs, 1000);
});

test('dead unsent owner is picked up 45 seconds after its last heartbeat, with resources released', async () => {
  const { store, job, at } = await fixture();
  at(15000); assert.equal(await store.renew(job), true);
  at(59999); assert.deepEqual(await store.abandoned(), []);
  at(60000);
  assert.deepEqual(await store.abandoned(), [{ messageId: job.messageId, state: 'queued' }]);
  assert.equal(await store.owned(job), false);
  assert.equal(await store.markDelivering(job), false);
  const next = { ...job, owner: 'replacement-worker', slot: undefined };
  assert.equal(await store.claim(next), true);
  assert.equal(await store.acquire(next), true, 'the old 120-second case/slot lease must not delay pickup');
  assert.equal(await store.owned(next), true);
});

test('a live owner stalled for 30 seconds is not taken over and can refresh its heartbeat', async () => {
  const { store, job, at } = await fixture();
  at(30000);
  assert.deepEqual(await store.abandoned(), []);
  assert.equal(await store.renew(job), true);
  at(45000);
  assert.deepEqual(await store.abandoned(), []);
  assert.equal(await store.owned(job), true);
  assert.equal(await store.markDelivering(job), true);
});

test('regular 15-second heartbeats protect an answer lasting longer than the original lease', async () => {
  const { store, job, at } = await fixture();
  for (let tick = 15000; tick <= 180000; tick += 15000) {
    at(tick); assert.equal(await store.renew(job), true);
    assert.deepEqual(await store.abandoned(), []);
  }
  assert.equal(await store.owned(job), true);
});

test('delivery-started work is never requeued by the shorter heartbeat detector', async () => {
  const { store, job, at } = await fixture();
  assert.equal(await store.markDelivering(job), true);
  at(45000); assert.deepEqual(await store.abandoned(), []);
  at(120001); assert.deepEqual(await store.abandoned(), []);
  at(720001);
  assert.deepEqual(await store.abandoned(), [{ messageId: job.messageId, state: 'uncertain' }]);
  assert.deepEqual(await store.queued(3), []);
  assert.equal(await store.claim({ ...job, owner: 'replacement-worker' }), false);
});

test('an older writer cannot inherit stale heartbeat evidence from a different claim owner', async () => {
  const { store, job, at } = await fixture();
  // Simulate an older runtime claiming queued work without writing new columns.
  store.messages.get(job.messageId).owner = 'legacy-worker';
  at(45000); assert.deepEqual(await store.abandoned(), []);
  at(120001);
  assert.deepEqual(await store.abandoned(), [{ messageId: job.messageId, state: 'queued' }]);
});

test('the current runtime still excludes its own in-flight owner from recovery', async () => {
  const { store, job, at } = await fixture();
  at(180000);
  assert.deepEqual(await store.abandoned({ exclude: [job.owner] }), []);
  assert.equal(store.messages.get(job.messageId).state, 'processing');
});

test('a resumed stale worker stands down after early pickup, leaving one customer reply', async () => {
  let now = 0;
  const store = new MemoryRuntimeStore({ now: () => now, slots: 1 });
  const old = new SupportRuntime({ store, heartbeatMs: 1000000, log: () => {} });
  const next = new SupportRuntime({ store, sweepMs: 0, log: () => {} });
  let begin, resume;
  const started = new Promise(resolve => { begin = resolve; });
  const held = new Promise(resolve => { resume = resolve; });
  let sends = 0;
  const send = async () => { await assertCurrentOwnership(); sends++; markCurrentReplySent(); return true; };
  const pending = old.run({ messageId: 'synthetic-race', caseKey: 'synthetic-race-case' }, async () => {
    begin(); await held; return send();
  });
  const settled = pending.then(value => ({ value }), error => ({ error }));
  try {
    await started; now = 45000;
    await next.recoverQueued(input => next.run(input, send));
    assert.equal(sends, 1);
    resume();
    assert.match((await settled).error?.message || '', /support lease lost/);
    assert.equal(sends, 1);
    assert.equal(store.messages.get('synthetic-race').state, 'answered');
  } finally { resume(); await settled; }
});

test('early takeover plus an old-worker ownership outage cannot send a second answer', async () => {
  let now = 0, oldOwner, oldReadFails = false, sends = 0;
  const store = new MemoryRuntimeStore({ now: () => now, slots: 1 });
  const owned = store.owned.bind(store);
  store.owned = async job => {
    if (oldReadFails && job.owner === oldOwner) throw new Error('synthetic partition');
    return owned(job);
  };
  const old = new SupportRuntime({ store, heartbeatMs: 1000000, log: () => {} });
  const next = new SupportRuntime({ store, sweepMs: 0, log: () => {} });
  let begin, resume;
  const started = new Promise(resolve => { begin = resolve; });
  const held = new Promise(resolve => { resume = resolve; });
  const send = async () => { await assertCurrentOwnership(); sends++; markCurrentReplySent(); return true; };
  const pending = old.run({ messageId: 'partition-race', caseKey: 'partition-case' }, async () => {
    oldOwner = [...old.jobs.keys()][0]; begin(); await held; return send();
  });
  const settled = pending.then(value => ({ value }), error => ({ error }));
  try {
    await started; now = 45000;
    await next.recoverQueued(input => next.run(input, send));
    assert.equal(sends, 1);
    oldReadFails = true; resume();
    assert.ok((await settled).error, 'unknown ownership must fence the resumed worker');
    assert.equal(sends, 1);
    assert.equal(store.messages.get('partition-race').state, 'answered');
  } finally { resume(); await settled; }
});

test('a slow recovered answer does not block a later dead-owner sweep with spare capacity', async () => {
  let now = 0, sends = 0, begin, resume;
  const store = new MemoryRuntimeStore({ now: () => now, slots: 3 });
  const runtime = new SupportRuntime({ store, heartbeatMs: 1000000, sweepMs: 0, log: () => {} });
  const started = new Promise(resolve => { begin = resolve; });
  const held = new Promise(resolve => { resume = resolve; });
  await store.enqueue({ messageId: 'slow-recovered', caseKey: 'case-one' });
  const orphan = { messageId: 'later-orphan', caseKey: 'case-two', owner: 'dead-owner' };
  await store.claim(orphan); await store.acquire(orphan);
  const handler = input => runtime.run(input, async () => {
    if (input.messageId === 'slow-recovered') { begin(); await held; }
    await assertCurrentOwnership(); sends++; markCurrentReplySent(); return true;
  });
  const first = runtime.recoverQueued(handler);
  try {
    await started; now = 45000;
    await runtime.recoverQueued(handler);
    assert.equal(store.messages.get(orphan.messageId).state, 'answered');
    assert.equal(sends, 1, 'later request completes while the first is still running');
    assert.equal(runtime.running, 1);
  } finally { resume(); await first; await runtime.drain(1000); }
});

test('a committed delivery marker with a lost acknowledgement can never be requeued', async () => {
  let now = 0, sends = 0;
  const store = new MemoryRuntimeStore({ now: () => now });
  const mark = store.markDelivering.bind(store);
  store.markDelivering = async job => { await mark(job); throw new Error('synthetic lost acknowledgement'); };
  const runtime = new SupportRuntime({ store, log: () => {} });
  await assert.rejects(runtime.run({ messageId: 'ambiguous-marker', caseKey: 'marker-case' }, async () => {
    await assertCurrentOwnership(); sends++; return true;
  }), error => error.code === 'SUPPORT_OWNERSHIP_UNKNOWN');
  assert.equal(sends, 0);
  assert.equal(store.messages.get('ambiguous-marker').deliveryStarted, true);
  assert.equal(store.messages.get('ambiguous-marker').state, 'processing');
  now = 45000;
  assert.deepEqual(await store.abandoned(), []);
  now = 720001;
  assert.deepEqual(await store.abandoned(), [{ messageId: 'ambiguous-marker', state: 'uncertain' }]);
  assert.deepEqual(await store.queued(3), []);
});

test('a deferred unsent ownership outage is recovered once after the database returns', async () => {
  const store = new MemoryRuntimeStore(); const original = store.owned.bind(store);
  let unavailable = false, sends = 0;
  store.owned = async job => { if (unavailable) throw new Error('synthetic partition'); return original(job); };
  const runtime = new SupportRuntime({ store, log: () => {}, sweepMs: 0 });
  await assert.rejects(runtime.run({ messageId: 'recover-held', caseKey: 'recover-case' }, async () => {
    unavailable = true; await assertCurrentOwnership(); sends++; return true;
  }), error => error.code === 'SUPPORT_OWNERSHIP_UNKNOWN');
  unavailable = false;
  await runtime.recoverQueued(input => runtime.run(input, async () => {
    await assertCurrentOwnership(); sends++; markCurrentReplySent(); return true;
  }));
  assert.equal(sends, 1);
  assert.equal(store.messages.get('recover-held').state, 'answered');
});

test('a recovery fetch in progress is not dispatched repeatedly on later scans', async () => {
  const store = new MemoryRuntimeStore(); const runtime = new SupportRuntime({ store, sweepMs: 0 });
  await store.enqueue({ messageId: 'slow-fetch', caseKey: 'fetch-case' });
  let release, calls = 0;
  const held = new Promise(resolve => { release = resolve; });
  const handler = async () => { calls++; await held; };
  const first = runtime.recoverQueued(handler);
  await new Promise(resolve => setImmediate(resolve));
  try { await runtime.recoverQueued(handler); assert.equal(calls, 1); }
  finally { release(); await first; }
});

test('one failed recovery fetch cannot remove drain tracking for another unfinished fetch', async () => {
  const store = new MemoryRuntimeStore(); const runtime = new SupportRuntime({ store, sweepMs: 0 });
  await store.enqueue({ messageId: 'fetch-fails', caseKey: 'fetch-one' });
  await store.enqueue({ messageId: 'fetch-held', caseKey: 'fetch-two' });
  let resume, begin;
  const started = new Promise(resolve => { begin = resolve; });
  const held = new Promise(resolve => { resume = resolve; });
  const task = runtime.track(() => runtime.recoverQueued(async input => {
    if (input.messageId === 'fetch-fails') throw new Error('synthetic fetch failure');
    begin(); await held;
  }));
  const settled = task.then(value => ({ value }), error => ({ error }));
  try {
    await started;
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(await runtime.drain(5), false);
  } finally { resume(); await settled; }
  assert.ok((await settled).error);
  assert.equal(await runtime.drain(1000), true);
});
