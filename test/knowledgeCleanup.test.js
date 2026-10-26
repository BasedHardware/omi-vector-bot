const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createMemoryStore, createPostgresStore } = require('../knowledgeReviewStore');
const DAY = 86400000;

async function put(store, guildId, factId, provenance) {
  const state = { latestVersion: 1, publishedVersion: 1, updatedAt: 1,
    versions: [{ version: 1, status: 'published', content: 'Synthetic public fact.',
      approvedBy: 'synthetic-staff', validationToken: null, provenance }] };
  await store.mutate({ guildId, factId }, () => ({ state, result: true }), { create: true });
  return state;
}

test('global expiry removes case pointers across guilds without changing reviewed product state', async () => {
  const store = createMemoryStore();
  const live = { caseId: 'live-case', expiresAt: 400 };
  const original = await put(store, 'guild-a', 'fact', [{ caseId: 'old-case', expiresAt: 200 }, live]);
  await put(store, 'guild-b', 'fact', [{ caseId: 'second-old-case', expiresAt: 200 }]);
  assert.deepEqual(await store.pruneExpiredProvenance(300), { examined: 2, barriersDeleted: 0, remaining: false });
  original.versions[0].provenance = [live];
  assert.deepEqual(await store.read({ guildId: 'guild-a', factId: 'fact' }), original);
  assert.deepEqual((await store.read({ guildId: 'guild-b', factId: 'fact' })).versions[0].provenance, []);
  assert.equal((await store.pruneExpiredProvenance(300)).examined, 0);
});

test('global expiry is bounded to one hundred facts and later batches make progress', async () => {
  const store = createMemoryStore();
  for (let i = 0; i < 101; i++) await put(store, 'guild', 'fact-' + String(i).padStart(3, '0'), [{ caseId: 'old-case', expiresAt: 200 }]);
  assert.deepEqual(await store.pruneExpiredProvenance(300), { examined: 100, barriersDeleted: 0, remaining: true });
  assert.equal((await store.read({ guildId: 'guild', factId: 'fact-100' })).versions[0].provenance.length, 1);
  assert.deepEqual(await store.pruneExpiredProvenance(300), { examined: 1, barriersDeleted: 0, remaining: false });
});

test('global cleanup retires expired barriers but preserves active erasure protection', async () => {
  const store = createMemoryStore();
  await store.eraseProvenance('guild', 1, ['old-erasure']);
  await store.eraseProvenance('guild', 30 * DAY, ['active-erasure']);
  assert.deepEqual(await store.pruneExpiredProvenance(31 * DAY), { examined: 0, barriersDeleted: 1, remaining: false });
  await put(store, 'guild', 'still-blocked', [{ caseId: 'active-erasure', expiresAt: 40 * DAY }]);
  assert.deepEqual((await store.read({ guildId: 'guild', factId: 'still-blocked' })).versions[0].provenance, []);
});

test('a stopped batch leaves unexamined facts for a later sweep', async () => {
  const store = createMemoryStore();
  for (const factId of ['first', 'second']) await put(store, 'guild', factId, [{ caseId: 'old-case', expiresAt: 200 }]);
  let checks = 0;
  const result = await store.pruneExpiredProvenance(300, { shouldStop: () => checks++ > 0 });
  assert.equal(result.examined, 1); assert.equal(result.remaining, true);
  assert.equal((await store.read({ guildId: 'guild', factId: 'second' })).versions[0].provenance.length, 1);
});

test('SQL barrier deletion rechecks expiry on the deleted row, not only candidate selection', async () => {
  const statements = [];
  const client = { query: async sql => { statements.push(sql); return { rows: [] }; }, release() {} };
  const store = createPostgresStore({ connect: async () => client });
  await store.pruneExpiredProvenance(300);
  const deletion = statements.find(sql => sql.startsWith('DELETE FROM support_knowledge_erasures'));
  assert.match(deletion, /WHERE expires_at<=\$1 AND ctid IN/);
});

function workerFixture(store, options = {}) {
  const { createKnowledgeCleanup } = require('../knowledgeCleanup');
  const timers = [], tracked = [];
  let stopping = false;
  const job = createKnowledgeCleanup({ store, now: () => 300, stopping: () => stopping,
    track: operation => { tracked.push(operation); return operation(); },
    setTimer: (callback, delay) => { const timer = { callback, delay, unref() { this.unrefed = true; } }; timers.push(timer); return timer; },
    clearTimer: timer => { timer.cleared = true; }, ...options });
  return { job, timers, tracked, stopRuntime: () => { stopping = true; } };
}

test('cleanup starts once, coalesces pending work, and continues bounded backlog batches', async () => {
  let release, calls = 0;
  const first = new Promise(resolve => { release = resolve; });
  const f = workerFixture({ pruneExpiredProvenance: async at => {
    assert.equal(at, 300); calls++; return calls === 1 ? first : { remaining: false };
  } });
  const pending = f.job.start();
  f.job.start(); f.job.run();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1); assert.equal(f.tracked.length, 1);
  release({ remaining: true }); await pending;
  assert.equal(f.timers[0].delay, 250); assert.equal(f.timers[0].unrefed, true);
  f.timers[0].callback(); await f.job.run();
  assert.equal(calls, 2); assert.equal(f.timers.at(-1).delay, 60000);
  f.job.stop(); assert.equal(f.timers.at(-1).cleared, true);
  f.timers.at(-1).callback(); await f.job.run(); assert.equal(calls, 2);
});

test('cleanup failure logs fixed metadata and retries without breaking the caller', async t => {
  let calls = 0; const logs = [];
  t.mock.method(console, 'error', (...values) => logs.push(values.join(' ')));
  const f = workerFixture({ pruneExpiredProvenance: async () => { calls++; if (calls === 1) throw Error('SYNTHETIC-PRIVATE-ERROR'); return { remaining: false }; } });
  assert.equal(await f.job.start(), null);
  assert.equal(logs.length, 1); assert.doesNotMatch(logs[0], /SYNTHETIC/);
  assert.equal(f.timers[0].delay, 60000);
  f.timers[0].callback(); await f.job.run();
  assert.equal(calls, 2); f.job.stop();
});

test('shutdown prevents queued and late callbacks from starting another cleanup batch', async () => {
  let release, calls = 0;
  const waiting = new Promise(resolve => { release = resolve; });
  const f = workerFixture({ pruneExpiredProvenance: async () => { calls++; return waiting; } });
  const pending = f.job.start(); await new Promise(resolve => setImmediate(resolve));
  f.stopRuntime(); f.job.stop(); release({ remaining: true }); await pending;
  assert.equal(f.timers.length, 0);
  await f.job.run(); assert.equal(calls, 1);
  const g = workerFixture({ pruneExpiredProvenance: async () => { calls++; return { remaining: false }; } });
  const queued = g.job.start(); g.job.stop(); await queued;
  assert.equal(calls, 1);
});

test('receipt retention uses the same retry worker with its own fixed unavailable log', async () => {
  let notices = 0, calls = 0;
  const f = workerFixture({ pruneExpiredProvenance: async () => { calls++; throw Error('private fixture error'); } },
    { logUnavailable: () => { notices++; } });
  assert.equal(await f.job.start(), null);
  assert.equal(notices, 1); assert.equal(f.timers[0].delay, 60000);
  f.timers[0].callback(); await f.job.run();
  assert.equal(calls, 2); assert.equal(notices, 2); f.job.stop();
});

test('cleanup startup is database scoped, before login, and independent of publication flags', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
  const start = source.slice(source.indexOf('async function start()'), source.indexOf('async function shutdown('));
  assert.match(start, /knowledgeCleanup = createKnowledgeCleanup/);
  assert.ok(start.indexOf('await db.initSchema()') < start.indexOf('knowledgeCleanup.start()'));
  assert.ok(start.indexOf('knowledgeCleanup.start()') < start.indexOf('await client.login('));
  assert.doesNotMatch(start, /SUPPORT_FIX_INBOX|SUPPORT_MEMORY_ENABLED/);
  assert.match(source.slice(source.indexOf('async function shutdown(')), /knowledgeCleanup\?\.stop\(\)/);
  assert.ok(start.indexOf('await db.initSchema()') < start.indexOf('noticeCleanup.start()'));
  assert.ok(start.indexOf('noticeCleanup.start()') < start.indexOf('await client.login('));
  assert.match(source.slice(source.indexOf('async function shutdown(')), /noticeCleanup\?\.stop\(\)/);
});
