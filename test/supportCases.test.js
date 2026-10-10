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
