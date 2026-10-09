const assert = require('node:assert/strict');
const test = require('node:test');
const { createMemoryStore, createCaseService, createPostgresStore, initSchema } = require('../supportCases');

test('support cases survive service recreation and isolate customers sharing a channel', async () => {
  const store = createMemoryStore();
  const beforeRestart = createCaseService(store);
  const alice = await beforeRestart.getOrCreateCase({ channelId: 'general', customerId: 'alice' });
  const bob = await beforeRestart.getOrCreateCase({ channelId: 'general', customerId: 'bob' });
  assert.notEqual(alice.id, bob.id);
  assert.match(alice.id, /^[0-9a-f-]{36}$/);
  await beforeRestart.linkHandoff(alice.id, { handoffThreadId: 'alice-thread', escalationId: 11 });
  const afterRestart = createCaseService(createMemoryStore(store.state));
  assert.equal((await afterRestart.getActiveCase('general', 'alice')).id, alice.id);
  assert.equal((await afterRestart.getActiveCase('general', 'bob')).id, bob.id);
  assert.equal(await afterRestart.getCaseByThread('general'), null);
  assert.equal((await afterRestart.getCaseByThread('alice-thread')).customerId, 'alice');
  assert.equal(await afterRestart.getCaseByThread('alice-thread', 'bob'), null);
});

test('support case persistence never accepts raw customer content', async () => {
  const store = createMemoryStore();
  const cases = createCaseService(store);
  const value = await cases.getOrCreateCase({
    channelId: 'general', customerId: 'customer',
    context: { area: 'app', lane: 'device', needsPerson: true, attachmentCount: 3,
      summary: 'my transcript is private', email: 'customer@example.com', order: '#123456',
      transcript: 'confidential words', reasonCodes: ['data_loss_risk', 'sk-supersecretkey'],
    },
    sources: [
      { url: 'https://docs.omi.me/doc/user?email=customer@example.com', body: 'raw transcript' },
      'https://cdn.discordapp.com/attachments/customer/private.png',
      'https://help.omi.me/customer@example.com',
    ],
  });
  assert.deepEqual(value.context, { area: 'app', lane: 'device', reasonCodes: ['data_loss_risk'], needsPerson: true, attachmentCount: 3 });
  assert.deepEqual(value.sources, ['https://docs.omi.me/doc/user']);
  const persisted = JSON.stringify([...store.state.cases.values()]);
  for (const secret of ['private', 'customer@example.com', '123456', 'confidential', 'sk-supersecretkey', 'raw transcript']) assert.equal(persisted.includes(secret), false);
});

test('case lifecycle requires delivery and reopens only for its customer', async () => {
  const cases = createCaseService(createMemoryStore());
  const value = await cases.getOrCreateCase({ channelId: 'help', customerId: 'alice', customerThreadId: 'help' });
  assert.equal(await cases.markAccepted(value.id, { staffId: 'staff' }), null);
  assert.throws(() => cases.markDelivered(value.id), /Confirmed delivery/);
  assert.equal((await cases.markDelivered(value.id, { messageId: 'staff-message', destination: 'staff' })).status, 'delivered');
  assert.equal((await cases.markAccepted(value.id, { staffId: 'staff' })).status, 'accepted');
  await assert.rejects(cases.resolveByThread('help'), /Confirmed customer delivery/);
  assert.equal((await cases.resolveByThread('help', { close: true, deliveryId: 'customer-message' })).status, 'closed');
  assert.equal(await cases.reopenByThread('help', 'bob'), null);
  assert.equal((await cases.reopenByThread('help', 'alice')).status, 'queued');
  assert.equal((await cases.reopenByThread('help', 'alice')).status, 'queued');
  assert.equal((await cases.getActiveCase('help', 'alice')).id, value.id);
});

test('ambiguous thread bindings never choose another customer', async () => {
  const cases = createCaseService(createMemoryStore());
  for (const customerId of ['alice', 'bob']) {
    const value = await cases.getOrCreateCase({ channelId: 'general', customerId });
    await cases.linkHandoff(value.id, { handoffThreadId: 'shared-thread' });
  }
  assert.equal(await cases.getCaseByThread('shared-thread'), null);
  assert.equal((await cases.getCaseByThread('shared-thread', 'bob')).customerId, 'bob');
});

test('an old closed case cannot reopen over a newer active customer case', async () => {
  const cases = createCaseService(createMemoryStore());
  const old = await cases.getOrCreateCase({ channelId: 'general', customerId: 'alice' });
  await cases.linkHandoff(old.id, { handoffThreadId: 'old-thread' });
  await cases.resolveCase(old.id, { close: true, confirmed: true });
  const current = await cases.getOrCreateCase({ channelId: 'general', customerId: 'alice' });
  assert.equal(await cases.reopenByThread('old-thread', 'alice'), null);
  assert.equal((await cases.getActiveCase('general', 'alice')).id, current.id);
  assert.equal((await cases.getCaseById(old.id)).status, 'closed');
});

test('real case acceptance survives service recreation and retains the first accepting staff identity', async () => {
  const store = createMemoryStore();
  const cases = createCaseService(store);
  const value = await cases.getOrCreateCase({ channelId: 'general', customerId: 'alice' });
  assert.throws(() => cases.markAccepted(value.id), /identifier/);
  await cases.markDelivered(value.id, { confirmed: true, destination: 'staff-channel' });
  const accepted = await cases.markAccepted(value.id, { staffId: 'first-staff' });
  assert.equal(accepted.status, 'accepted');
  assert.equal(accepted.acceptedBy, 'first-staff');
  assert.ok(accepted.acceptedAt);
  const restarted = createCaseService(createMemoryStore(store.state));
  const repeated = await restarted.markAccepted(value.id, { staffId: 'other-staff' });
  assert.equal(repeated.acceptedBy, 'first-staff');
  assert.equal(repeated.acceptedAt, accepted.acceptedAt);
  assert.deepEqual(await restarted.getCaseById(value.id), repeated);
});

test('reopening advances one generation and clears prior receipts and acceptance', async () => {
  const cases = createCaseService(createMemoryStore());
  const value = await cases.getOrCreateCase({ channelId: 'help', customerId: 'alice', customerThreadId: 'help' });
  await cases.markDelivered(value.id, { messageId: 'old-card', expectedGeneration: 0 });
  await cases.markAccepted(value.id, { staffId: 'old-owner' });
  await cases.resolveCase(value.id, { close: true, confirmed: true });
  const reopened = await cases.reopenByThread('help', 'alice');
  assert.equal(reopened.generation, 1);
  for (const field of ['deliveryId', 'deliveryDestination', 'acceptedBy', 'acceptedAt']) assert.equal(reopened[field], null);
  assert.equal((await cases.reopenByThread('help', 'alice')).generation, 1);
  assert.equal(await cases.markDelivered(value.id, { messageId: 'late-old-card', expectedGeneration: 0 }), null);
  assert.throws(() => cases.markDelivered(value.id, { messageId: 'bad-card', expectedGeneration: -1 }), /generation/);
  assert.equal((await cases.getCaseById(value.id)).status, 'queued');
  await cases.markDelivered(value.id, { messageId: 'new-card', expectedGeneration: 1 });
  assert.equal((await cases.markAccepted(value.id, { staffId: 'new-owner' })).acceptedBy, 'new-owner');
});

test('Postgres initialization and case inserts use an injectable client and sanitized parameters', async () => {
  const calls = [];
  const client = { query: async (sql, args) => { calls.push({ sql, args }); return { rows: [] }; } };
  await initSchema(client);
  const cases = createCaseService(createPostgresStore(client));
  await cases.getOrCreateCase({ channelId: 'general', customerId: 'alice', context: { summary: 'private transcript', area: 'app' } });
  assert.match(calls[0].sql, /support_cases_active_scope_idx/);
  assert.deepEqual(calls[1].args.slice(1, 4), ['general', 'alice', null]);
  assert.equal(calls[1].args[4].includes('private transcript'), false);
  assert.deepEqual(JSON.parse(calls[1].args[4]), { area: 'app', reasonCodes: [] });
});

test('resolution is generation-fenced both by case ID and by customer thread', async () => {
  const cases = createCaseService(createMemoryStore());
  const value = await cases.getOrCreateCase({ channelId: 'help', customerId: 'alice', customerThreadId: 'help' });
  await cases.resolveCase(value.id, { close: true, confirmed: true, expectedGeneration: 0 });
  await cases.reopenByThread('help', 'alice', { expectedGeneration: 0 });
  assert.equal(await cases.resolveCase(value.id, { close: true, deliveryId: 'old-close', expectedGeneration: 0 }), null);
  assert.equal(await cases.resolveByThread('help', { customerId: 'alice', close: true, deliveryId: 'old-close', expectedGeneration: 0 }), null);
  assert.equal((await cases.getCaseById(value.id)).status, 'queued');
  assert.throws(() => cases.resolveCase(value.id, { confirmed: true, expectedGeneration: -1 }), /generation/);
  await assert.rejects(cases.resolveByThread('help', { confirmed: true, expectedGeneration: 1.5 }), /generation/);
  assert.equal((await cases.resolveByThread('help', { customerId: 'alice', close: true, deliveryId: 'current-close', expectedGeneration: 1 })).status, 'closed');
});

test('forced customer feedback advances an active epoch before delayed closure can save', async () => {
  for (const status of ['queued', 'delivered', 'accepted']) {
    const store = createMemoryStore(); const cases = createCaseService(store);
    const value = await cases.getOrCreateCase({ channelId: 'help', customerId: 'alice', customerThreadId: 'help' });
    if (status !== 'queued') await cases.markDelivered(value.id, { messageId: 'staff-card', destination: 'staff', expectedGeneration: 0 });
    if (status === 'accepted') await cases.markAccepted(value.id, { staffId: 'first-staff' });
    assert.equal(await cases.reopenByThread('help', 'bob', { expectedGeneration: 0, forceGeneration: true }), null);
    const restarted = createCaseService(createMemoryStore(store.state));
    const reopened = await restarted.reopenByThread('help', 'alice', { expectedGeneration: 0, forceGeneration: true });
    assert.equal(reopened.status, 'queued'); assert.equal(reopened.generation, 1);
    for (const field of ['deliveryId', 'deliveryDestination', 'acceptedBy', 'acceptedAt']) assert.equal(reopened[field], null);
    assert.equal(await restarted.reopenByThread('help', 'alice', { expectedGeneration: 0, forceGeneration: true }), null);
    assert.equal(await restarted.resolveCase(value.id, { close: true, deliveryId: 'delayed-close', expectedGeneration: 0 }), null);
    assert.equal((await restarted.getCaseById(value.id)).status, 'queued');
    await assert.rejects(restarted.reopenByThread('help', 'alice', { forceGeneration: true }), /generation/);
    await assert.rejects(restarted.reopenByThread('help', 'alice', { expectedGeneration: '1' }), /generation/);
    assert.equal((await restarted.reopenByThread('help', 'alice', { expectedGeneration: 1 })).generation, 1);
  }
});

test('thread scope distinguishes absence, one owner history and multiple active cases', async () => {
  const store = createMemoryStore(); const cases = createCaseService(store);
  assert.deepEqual(await cases.getThreadCaseScope('missing'), { case: null, ambiguous: false, count: 0 });
  const old = await cases.getOrCreateCase({ channelId: 'general', customerId: 'alice' });
  await cases.linkHandoff(old.id, { handoffThreadId: 'customer-thread' });
  await cases.resolveCase(old.id, { close: true, confirmed: true });
  const active = await cases.getOrCreateCase({ channelId: 'general', customerId: 'alice' });
  await cases.linkHandoff(active.id, { handoffThreadId: 'customer-thread' });
  const unique = await cases.getThreadCaseScope('customer-thread');
  assert.equal(unique.case.id, active.id); assert.equal(unique.ambiguous, false); assert.equal(unique.count, 2);
  await cases.resolveCase(active.id, { confirmed: true });
  store.state.cases.get(old.id).createdAt = '2020-01-01T00:00:00.000Z';
  assert.equal((await cases.getThreadCaseScope('customer-thread')).case.id, active.id);
  await cases.reopenByThread('customer-thread', 'alice'); // Ambiguous legacy lookup must not guess.
  const secondActive = await cases.getOrCreateCase({ channelId: 'another-channel', customerId: 'alice', customerThreadId: 'customer-thread' });
  const firstActive = await cases.getOrCreateCase({ channelId: 'general', customerId: 'alice', customerThreadId: 'customer-thread' });
  assert.notEqual(firstActive.id, secondActive.id);
  const ambiguous = await cases.getThreadCaseScope('customer-thread');
  assert.deepEqual(ambiguous, { case: null, ambiguous: true, count: 4 });
});

test('thread scope checks every historical owner, not just the newest matching cases', async () => {
  const store = createMemoryStore(); const cases = createCaseService(store);
  const bob = await cases.getOrCreateCase({ channelId: 'customer-thread', customerId: 'bob' });
  await cases.resolveCase(bob.id, { close: true, confirmed: true });
  store.state.cases.get(bob.id).createdAt = '2020-01-01T00:00:00.000Z';
  for (let index = 0; index < 3; index++) {
    const alice = await cases.getOrCreateCase({ channelId: 'general', customerId: 'alice', customerThreadId: 'customer-thread' });
    await cases.resolveCase(alice.id, { close: true, confirmed: true });
  }
  assert.deepEqual(await cases.getThreadCaseScope('customer-thread'), { case: null, ambiguous: true, count: 4 });
});

test('Postgres thread scope aggregates all rows once and transition parameters retain the epoch fence', async () => {
  const calls = []; const row = { id: 'case', channel_id: 'help', customer_id: 'alice', customer_thread_id: 'help', status: 'accepted', generation: 4 };
  const client = { query: async (sql, args) => {
    calls.push({ sql, args });
    return { rows: sql.includes('WITH matching_cases') ? [{ count: 3, owner_count: 1, active_count: 1, case_row: row }] : [row] };
  } };
  const cases = createCaseService(createPostgresStore(client));
  const scope = await cases.getThreadCaseScope('help');
  assert.equal(scope.case.id, 'case'); assert.equal(scope.count, 3); assert.equal(scope.ambiguous, false);
  assert.match(calls[0].sql, /COUNT\(DISTINCT customer_id\)/);
  assert.match(calls[0].sql, /channel_id=\$1 OR customer_thread_id=\$1 OR handoff_thread_id=\$1/);
  assert.doesNotMatch(calls[0].sql, /LIMIT 2/);
  await cases.resolveCase('case', { close: true, confirmed: true, expectedGeneration: 4 });
  assert.equal(calls[1].args[5], 4); assert.equal(calls[1].args[6], false);
  await cases.reopenByThread('help', 'alice', { expectedGeneration: 4, forceGeneration: true });
  const transition = calls.at(-1);
  assert.equal(transition.args[5], 4); assert.equal(transition.args[6], true);
  assert.match(transition.sql, /status IN \('closed', 'resolved'\) OR \$7::boolean/);
});

test('receipt-bound reopen selects only its exact current case and never retargets historical feedback', async () => {
  const store = createMemoryStore(); const cases = createCaseService(store);
  const old = await cases.getOrCreateCase({ channelId: 'general', customerId: 'alice', customerThreadId: 'help' });
  await cases.resolveCase(old.id, { close: true, confirmed: true });
  store.state.cases.get(old.id).createdAt = '2020-01-01T00:00:00.000Z';
  const current = await cases.getOrCreateCase({ channelId: 'general', customerId: 'alice', customerThreadId: 'help' });
  assert.equal(await cases.reopenByThread('help', 'alice', { expectedGeneration: 0, forceGeneration: true }), null);
  assert.equal(await cases.reopenByThread('help', 'alice', { expectedCaseId: old.id, expectedGeneration: 0, forceGeneration: true }), null);
  assert.equal(await cases.reopenByThread('other-thread', 'alice', { expectedCaseId: current.id, expectedGeneration: 0, forceGeneration: true }), null);
  assert.equal(await cases.reopenByThread('help', 'bob', { expectedCaseId: current.id, expectedGeneration: 0, forceGeneration: true }), null);
  await assert.rejects(cases.reopenByThread('help', 'alice', { expectedCaseId: current.id, forceGeneration: true }), /generation/);
  const reopened = await cases.reopenByThread('help', 'alice', { expectedCaseId: current.id, expectedGeneration: 0, forceGeneration: true });
  assert.equal(reopened.id, current.id); assert.equal(reopened.generation, 1);
  assert.equal(await cases.reopenByThread('help', 'alice', { expectedCaseId: current.id, expectedGeneration: 0, forceGeneration: true }), null);
  assert.equal((await cases.getCaseById(old.id)).status, 'closed');
  const bob = await cases.getOrCreateCase({ channelId: 'other', customerId: 'bob', customerThreadId: 'help' });
  assert.equal(await cases.reopenByThread('help', 'alice', { expectedCaseId: current.id, expectedGeneration: 1, forceGeneration: true }), null);
  assert.equal((await cases.getCaseById(bob.id)).generation, 0);
});
