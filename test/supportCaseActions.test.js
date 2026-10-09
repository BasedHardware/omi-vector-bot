const assert = require('node:assert/strict');
const test = require('node:test');
const actions = require('../supportCaseActions');

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
function deferred() { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; }

test('a case action receives an ownership guard, returns its result and releases its metadata-only lease', async () => {
  const store = actions.createMemoryStore();
  const service = actions.createActionService(store);
  const result = await service.run('case-1', async (assertOwned) => {
    await assertOwned();
    const row = store.state.leases.get('case-1');
    assert.match(row.owner, /^[0-9a-f-]{36}$/);
    assert.deepEqual(Object.keys(row).sort(), ['caseId', 'leaseUntil', 'owner']);
    return 'work completed';
  });
  assert.equal(result, 'work completed');
  assert.equal(store.state.leases.size, 0);
});

test('separate service copies serialize the same case while independent cases can progress', async () => {
  const store = actions.createMemoryStore();
  const first = actions.createActionService(store, { leaseMs: 200, heartbeatMs: 10, waitMs: 200 });
  const second = actions.createActionService(actions.createMemoryStore(store.state), { leaseMs: 200, heartbeatMs: 10, waitMs: 200 });
  const began = deferred(); const release = deferred(); const effects = [];
  const closing = first.run('shared-case', async (assertOwned) => {
    effects.push('close began'); began.resolve(); await release.promise; await assertOwned(); effects.push('close ended');
  });
  await began.promise;
  const reopening = second.run('shared-case', async (assertOwned) => { await assertOwned(); effects.push('reopen'); });
  await second.run('different-case', async (assertOwned) => { await assertOwned(); effects.push('independent'); });
  assert.deepEqual(effects, ['close began', 'independent']);
  release.resolve(); await Promise.all([closing, reopening]);
  assert.deepEqual(effects, ['close began', 'independent', 'close ended', 'reopen']);
  assert.equal(store.state.leases.size, 0);
});

test('waiting for a held case is bounded and does not execute a second action', async () => {
  const store = actions.createMemoryStore();
  assert.equal(await store.acquire('busy-case', 'other-owner', 1000), true);
  const service = actions.createActionService(store, { waitMs: 30 });
  let called = false;
  const before = Date.now();
  await assert.rejects(service.run('busy-case', async () => { called = true; }), actions.CaseActionBusyError);
  assert.equal(called, false);
  assert.ok(Date.now() - before < 250);
  assert.equal(store.state.leases.get('busy-case').owner, 'other-owner');
});

test('heartbeat renewal keeps a long action owned until all its stages finish', async () => {
  const store = actions.createMemoryStore();
  let renewals = 0;
  const originalRenew = store.renew;
  store.renew = async (...args) => { renewals += 1; return originalRenew(...args); };
  const service = actions.createActionService(store, { leaseMs: 60, heartbeatMs: 10, waitMs: 60 });
  await service.run('long-case', async (assertOwned) => { await delay(95); await assertOwned(); });
  assert.ok(renewals >= 2);
  assert.equal(store.state.leases.size, 0);
});

test('failed or rejected renewal fences the next mutation and logs no private exception', async () => {
  for (const failure of ['false', 'throw']) {
    const store = actions.createMemoryStore(); const logs = []; const effects = [];
    store.renew = async () => { if (failure === 'throw') throw new Error('PRIVATE_CUSTOMER_BODY'); return false; };
    const service = actions.createActionService(store, { leaseMs: 200, heartbeatMs: 5, waitMs: 30, log: (line) => logs.push(line) });
    await assert.rejects(service.run('private-case', async (assertOwned) => {
      effects.push('began'); await delay(20); await assertOwned(); effects.push('mutated');
    }), actions.CaseActionLeaseLostError);
    assert.deepEqual(effects, ['began']);
    assert.equal(store.state.leases.size, 0);
    assert.ok(logs.includes('[CaseActions] lease renewal unavailable'));
    assert.doesNotMatch(logs.join(' '), /PRIVATE_CUSTOMER_BODY|private-case/);
  }
});

test('a replaced owner fences old work and its final release cannot delete the replacement', async () => {
  const store = actions.createMemoryStore();
  const service = actions.createActionService(store);
  await assert.rejects(service.run('replacement-case', async (assertOwned) => {
    const original = store.state.leases.get('replacement-case');
    store.state.leases.set('replacement-case', { ...original, owner: 'replacement-owner' });
    await assertOwned();
    assert.fail('a stale owner must not mutate');
  }), actions.CaseActionLeaseLostError);
  assert.equal(store.state.leases.get('replacement-case').owner, 'replacement-owner');
});

test('expired owners cannot renew or resurrect a lease claimed by another copy', async () => {
  const store = actions.createMemoryStore();
  assert.equal(await store.acquire('expiry-case', 'first-owner', 100, 1000), true);
  assert.equal(await store.owned('expiry-case', 'first-owner', 1100), false);
  assert.equal(await store.renew('expiry-case', 'first-owner', 100, 1100), false);
  assert.equal(await store.acquire('expiry-case', 'next-owner', 100, 1100), true);
  assert.equal(await store.release('expiry-case', 'first-owner'), false);
  assert.equal(await store.owned('expiry-case', 'next-owner', 1101), true);
});

test('work failures release ownership without replacing the original failure', async () => {
  const store = actions.createMemoryStore(); const service = actions.createActionService(store);
  const failure = new Error('controlled work error');
  await assert.rejects(service.run('work-case', async () => { throw failure; }), (error) => error === failure);
  assert.equal(store.state.leases.size, 0);
});

test('database failures fail closed rather than executing against a local memory fallback', async () => {
  const logs = []; let called = false;
  const store = actions.createPostgresStore({ query: async () => { throw new Error('PRIVATE_SQL_PARAMETERS'); } });
  const service = actions.createActionService(store, { log: (line) => logs.push(line) });
  await assert.rejects(service.run('db-case', async () => { called = true; }), actions.CaseActionUnavailableError);
  assert.equal(called, false);
  assert.deepEqual(logs, ['[CaseActions] lease acquisition unavailable']);
});

test('a slow acquisition never executes after its deadline and cleans only its late owner grant', async () => {
  const backing = actions.createMemoryStore(); const release = deferred();
  const store = { ...backing, acquire: async (...args) => { await release.promise; return backing.acquire(...args); } };
  const service = actions.createActionService(store, { waitMs: 20, log: () => {} });
  let called = false;
  await assert.rejects(service.run('late-case', async () => { called = true; }), actions.CaseActionBusyError);
  release.resolve(); await new Promise((resolve) => setImmediate(resolve));
  assert.equal(called, false);
  assert.equal(backing.state.leases.size, 0);
});

test('schema and SQL mutations are additive, metadata-only and owner-fenced', async () => {
  const calls = [];
  const client = { query: async (sql, args) => { calls.push({ sql, args }); return { rows: [{ case_id: 'case' }] }; } };
  await actions.initSchema(client);
  assert.match(calls[0].sql, /CREATE TABLE IF NOT EXISTS support_case_action_leases/);
  assert.doesNotMatch(calls[0].sql, /DROP|customer|payload|question|transcript/i);
  const store = actions.createPostgresStore(client);
  assert.equal(await store.acquire('case', 'owner', 120000), true);
  assert.match(calls.at(-1).sql, /WHERE support_case_action_leases\.lease_until <= NOW\(\)/);
  assert.equal(await store.renew('case', 'owner', 120000), true);
  assert.match(calls.at(-1).sql, /owner=\$2 AND lease_until>NOW\(\)/);
  assert.equal(await store.release('case', 'owner'), true);
  assert.match(calls.at(-1).sql, /case_id=\$1 AND owner=\$2/);
});

test('invalid scope, timings and work do not reach storage', async () => {
  let calls = 0;
  const store = { acquire: async () => { calls += 1; return true; } };
  const service = actions.createActionService(store);
  await assert.rejects(service.run('invalid case', async () => {}), actions.CaseActionUnavailableError);
  await assert.rejects(service.run('valid-case', null), actions.CaseActionUnavailableError);
  assert.throws(() => actions.createActionService(store, { waitMs: 20001 }), actions.CaseActionUnavailableError);
  assert.equal(calls, 0);
});
