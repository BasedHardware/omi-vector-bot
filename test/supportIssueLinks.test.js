const test = require('node:test');
const assert = require('node:assert/strict');
const { createMemoryStore, createPostgresStore, createIssueLinkService, initSchema } = require('../supportIssueLinks');

const owners = new Map([
  ['case-alice', { customerId: 'alice', channelId: 'general', handoffThreadId: 'alice-thread' }],
  ['case-bob', { customerId: 'bob', channelId: 'general', handoffThreadId: 'bob-thread' }],
]);
const options = { getCase: async (caseId) => owners.get(caseId) || null };
const input = (extra = {}) => ({ repo: 'BasedHardware/omi', issueNumber: 42, caseId: 'case-alice', customerId: 'alice',
  channelId: 'general', threadId: 'alice-thread', sourceMessageId: 'source-alice', approvedBy: 'staff-one', ...extra });

test('case-owned issue links survive service recreation and keep first approval provenance', async () => {
  const store = createMemoryStore();
  const service = createIssueLinkService(store, options);
  const first = await service.link(input());
  const restarted = createIssueLinkService(createMemoryStore(store.state), options);
  const repeated = await restarted.link(input({ approvedBy: 'staff-two' }));
  assert.equal(first.repo, 'basedhardware/omi');
  assert.equal(repeated.approvedBy, 'staff-one');
  assert.equal(repeated.sourceMessageId, 'source-alice');
  assert.deepEqual(await restarted.findForCase('case-alice', 'BasedHardware/omi'), first);
  assert.deepEqual(await restarted.listForIssue('BasedHardware/omi', 42), [first]);
});

test('same shared channel never confers issue ownership to another customer or staff-click channel', async () => {
  const service = createIssueLinkService(createMemoryStore(), options);
  await service.link(input());
  await assert.rejects(service.link(input({ customerId: 'bob' })), /ownership/);
  await assert.rejects(service.link(input({ channelId: 'staff-room' })), /ownership/);
  await assert.rejects(service.link(input({ threadId: 'bob-thread' })), /ownership/);
  assert.equal(await service.findForCase('case-bob', 'BasedHardware/omi'), null);
  await service.link(input({ caseId: 'case-bob', customerId: 'bob', threadId: 'bob-thread', sourceMessageId: 'source-bob' }));
  assert.equal((await service.listForIssue('BasedHardware/omi', 42)).length, 2);
});

test('repository and target remain scoped and cannot be silently retargeted', async () => {
  const service = createIssueLinkService(createMemoryStore(), options);
  await service.link(input());
  await assert.rejects(service.link(input({ issueNumber: 43 })), /conflict/);
  await assert.rejects(service.link(input({ repo: 'https://github.com/evil/repo' })), /repository/);
  await assert.rejects(service.link(input({ issueNumber: '42/comments' })), /number/);
  await assert.rejects(service.link(input({ approvedBy: '' })), /identifier/);
  assert.equal(await service.findForCase('case-alice', 'other/repo'), null);
});

test('different original reports in one general-channel case can link separate issues without guessing an update target', async () => {
  const service = createIssueLinkService(createMemoryStore(), options);
  await service.link(input());
  await service.link(input({ issueNumber: 43, sourceMessageId: 'source-other-bug' }));
  assert.equal(await service.findForCase('case-alice', 'BasedHardware/omi'), null);
  assert.equal((await service.findForSource('case-alice', 'BasedHardware/omi', 'source-alice')).issueNumber, 42);
  assert.equal((await service.findForSource('case-alice', 'BasedHardware/omi', 'source-other-bug')).issueNumber, 43);
  assert.equal((await service.listForCase('case-alice', 'BasedHardware/omi')).length, 2);
  assert.equal((await service.listForThread('case-alice', 'BasedHardware/omi', 'alice-thread')).length, 2);
  assert.deepEqual(await service.listForThread('case-alice', 'BasedHardware/omi', 'bob-thread'), []);
  await assert.rejects(service.link(input({ issueNumber: 44 })), /conflict/);
});

test('Postgres links check authoritative case ownership in SQL and never use legacy/public markers', async () => {
  const calls = [];
  const row = { repo: 'basedhardware/omi', case_id: 'case-alice', issue_number: 42, customer_id: 'alice', channel_id: 'general',
    thread_id: 'alice-thread', source_message_id: 'source-alice', approved_by: 'staff-one' };
  const client = { query: async (sql, args) => { calls.push({ sql, args }); return { rows: args ? [row] : [] }; } };
  await initSchema(client);
  const service = createIssueLinkService(createPostgresStore(client), options);
  assert.equal((await service.link(input())).customerId, 'alice');
  assert.match(calls[1].sql, /FROM support_cases c/);
  assert.match(calls[1].sql, /c\.customer_id=\$4/);
  assert.match(calls[1].sql, /ON CONFLICT \(repo,case_id,source_message_id\)/);
  assert.doesNotMatch(JSON.stringify(calls), /issue_threads|vector-thread|discord\.com|PRIVATE_CONTENT/);
  assert.deepEqual(calls[1].args, ['basedhardware/omi', 'case-alice', 42, 'alice', 'general', 'alice-thread', 'source-alice', 'staff-one']);
});
