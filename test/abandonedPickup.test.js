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
