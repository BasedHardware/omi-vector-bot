const test = require('node:test');
const assert = require('node:assert/strict');
const receipts = require('../githubNoticeReceipts');
const { notifyLinkedThreads } = require('../commands');
const DAY = 86400000;
const FIRST = '20000000-0000-4000-8000-000000000001';
const NEXT = '20000000-0000-4000-8000-000000000002';
function fixture() {
  let clock = Date.now();
  const now = () => clock;
  const store = receipts.createMemoryStore(new Map(), { now });
  const sent = [];
  const record = { repo: 'basedhardware/omi', caseId: 'lifecycle-case', customerId: 'lifecycle-owner',
    channelId: 'lifecycle-channel', sourceMessageId: 'lifecycle-source' };
  const source = { id: record.sourceMessageId, author: { id: record.customerId },
    reply: async value => { sent.push(value); return { id: '100000000000000999' }; } };
  const client = { channels: { fetch: async () => ({ id: record.channelId, isTextBased: () => true,
    messages: { fetch: async () => source } }) } };
  const options = { now, noticeReceipts: store, issueLinks: { listForIssue: async () => [record] },
    cases: { getCaseById: async () => ({ ...record }) } };
  const event = { deliveryId: FIRST, occurredAt: clock, kind: 'closed', number: 42, numbers: [42], line: '#42 was closed.' };
  return { store, sent, client, options, event, now, advance: ms => { clock += ms; } };
}

test('old events are ignored even with no receipt and a fresh arrival or changed delivery ID', async () => {
  const f = fixture();
  const old = { ...f.event, occurredAt: f.now() - 31 * DAY };
  assert.equal(await notifyLinkedThreads(f.client, old, f.options), 0);
  assert.equal(await notifyLinkedThreads(f.client, { ...old, deliveryId: NEXT }, f.options), 0);
  assert.equal(f.sent.length, 0);
  assert.equal(f.store.state.size, 0);
});

test('expiry removes a fence but cannot re-enable its old event; a fresh event still sends once', async () => {
  const f = fixture();
  assert.equal(await notifyLinkedThreads(f.client, f.event, f.options), 1);
  f.advance(30 * DAY);
  await f.store.pruneExpired();
  assert.equal(f.store.state.size, 0);
  assert.equal(await notifyLinkedThreads(f.client, f.event, f.options), 0);
  const fresh = { ...f.event, deliveryId: NEXT, occurredAt: f.now() };
  assert.equal(await notifyLinkedThreads(f.client, fresh, f.options), 1);
  assert.equal(await notifyLinkedThreads(f.client, fresh, f.options), 0);
  assert.equal(f.sent.length, 2);
});

test('customer erasure removes receipts and suppresses their still-fresh replays without blocking later events', async () => {
  const f = fixture();
  assert.equal(await notifyLinkedThreads(f.client, f.event, f.options), 1);
  const customerKey = receipts.customerKey('lifecycle-owner');
  const other = { ...receipts.keys('basedhardware/omi', NEXT, ['other-recipient']),
    customerKey: receipts.customerKey('another-owner'), eventAt: f.now() };
  assert.equal(await f.store.begin(other), true);
  const erased = await f.store.eraseCustomer(customerKey);
  assert.equal(erased.remaining, false);
  assert.equal(f.store.state.size, 1);
  assert.ok([...f.store.state.values()].every(row => row.customerKey !== customerKey));
  assert.equal(await notifyLinkedThreads(f.client, f.event, f.options), 0);
  f.advance(1000);
  assert.equal(await notifyLinkedThreads(f.client, { ...f.event, deliveryId: NEXT, occurredAt: f.now() }, f.options), 1);
});

test('recreated adapters retain erasure cutoff and late confirmation cannot recreate deleted receipt rows', async () => {
  const f = fixture();
  const value = { ...receipts.keys('basedhardware/omi', FIRST, ['recipient']),
    customerKey: receipts.customerKey('lifecycle-owner'), eventAt: f.now() };
  await f.store.begin(value);
  await f.store.eraseCustomer(value.customerKey);
  const recreated = receipts.createMemoryStore(f.store.state, { now: f.now });
  assert.equal(await recreated.confirm({ ...value, messageId: '100000000000000999' }), false);
  assert.equal(await recreated.begin(value), false);
  assert.equal(recreated.state.size, 0);
  f.advance(31 * DAY);
  await recreated.pruneExpired();
  assert.equal(await recreated.begin(value), false);
});

test('subject timestamps come from the event subject, not issue age, arrival or an unrelated updated_at', () => {
  const old = '2024-01-02T03:04:05Z', fresh = '2026-10-26T03:04:05Z';
  const cases = [
    [{ action: 'created', comment: { created_at: fresh }, issue: { created_at: old, updated_at: old } }, fresh],
    [{ action: 'closed', issue: { closed_at: old, updated_at: fresh } }, old],
    [{ action: 'opened', issue: { created_at: old, updated_at: fresh } }, old],
    [{ action: 'reopened', issue: { created_at: old, closed_at: null, updated_at: fresh } }, fresh],
    [{ action: 'closed', pull_request: { merged: true, merged_at: old, updated_at: fresh } }, old],
  ];
  for (const [payload, expected] of cases) assert.equal(receipts.eventTimestamp(payload), Date.parse(expected));
  for (const payload of [{ action: 'closed', issue: {} }, { action: 'closed', issue: { closed_at: 'tomorrow' } },
    { action: 'closed', issue: { closed_at: '2026-02-31T00:00:00Z' } }]) assert.equal(receipts.eventTimestamp(payload), null);
});

test('missing, invalid and too-far-future subject times never allocate a receipt or send', async () => {
  const f = fixture();
  for (const occurredAt of [undefined, NaN, Infinity, 0, f.now() + 10 * 60000]) {
    assert.equal(await notifyLinkedThreads(f.client, { ...f.event, occurredAt }, f.options), 0);
  }
  assert.equal(f.sent.length, 0);
  assert.equal(f.store.state.size, 0);
});

test('legacy rows without verified customer attribution cannot create unerasable notice receipts', async t => {
  const github = require('../github');
  github.resetGithubMemory(); t.after(() => github.resetGithubMemory());
  github.linkIssueThread(42, 'lifecycle-channel', { persist: false });
  const f = fixture();
  f.options.issueLinks.listForIssue = async () => [];
  f.options.cases.getCaseByThread = async () => null;
  f.client.channels.fetch = async () => ({ id: 'lifecycle-channel', isThread: () => true,
    isTextBased: () => true, send: async () => assert.fail('ownerless legacy notice') });
  assert.equal(await notifyLinkedThreads(f.client, f.event, f.options), 0);
  assert.equal(f.store.state.size, 0);
});
