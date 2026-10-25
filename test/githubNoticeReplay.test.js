const assert = require('node:assert/strict');
const test = require('node:test');
const { notifyLinkedThreads } = require('../commands');

const EVENT = '10000000-0000-4000-8000-000000000001';
const NEXT_EVENT = '10000000-0000-4000-8000-000000000002';
function fixture(state = new Map()) {
  const sent = [];
  const record = { repo: 'basedhardware/omi', issueNumber: 42, caseId: 'synthetic-case', customerId: 'synthetic-owner',
    channelId: 'synthetic-thread', threadId: 'synthetic-thread', sourceMessageId: 'synthetic-source' };
  const key = x => JSON.stringify([x.eventKey, x.recipientKey]);
  const receipts = {
    async begin(x) { if (state.has(key(x))) return false; state.set(key(x), 'started'); return true; },
    async confirm(x) { if (state.get(key(x)) !== 'started') return false; state.set(key(x), 'sent'); return true; },
    async uncertain(x) { if (state.get(key(x)) === 'started') state.set(key(x), 'uncertain'); },
  };
  const source = { id: record.sourceMessageId, author: { id: record.customerId },
    reply: async payload => { sent.push(payload); return { id: '100000000000000999' }; } };
  const channel = { id: record.threadId, isTextBased: () => true, messages: { fetch: async () => source } };
  const client = { channels: { fetch: async () => channel } };
  const options = { noticeReceipts: receipts, issueLinks: { listForIssue: async () => [record] },
    cases: { getCaseById: async () => ({ customerId: record.customerId, channelId: record.threadId }) } };
  const event = { deliveryId: EVENT, kind: 'closed', number: 42, numbers: [42], line: '#42 was closed.' };
  return { state, sent, source, channel, client, options, event, record };
}

test('repeated GitHub delivery emits one notice, including after service recreation', async () => {
  const f = fixture();
  assert.equal(await notifyLinkedThreads(f.client, f.event, f.options), 1);
  assert.equal(await notifyLinkedThreads(f.client, f.event, f.options), 0);
  const restarted = fixture(f.state);
  assert.equal(await notifyLinkedThreads(restarted.client, restarted.event, restarted.options), 0);
  assert.equal(f.sent.length + restarted.sent.length, 1);
});

test('concurrent copies of one GitHub event cannot both send', async () => {
  const f = fixture();
  const results = await Promise.all(Array.from({ length: 6 }, () => notifyLinkedThreads(f.client, f.event, f.options)));
  assert.equal(results.reduce((a, n) => a + n, 0), 1);
  assert.equal(f.sent.length, 1);
});

test('a distinct GitHub event with identical wording is not suppressed', async () => {
  const f = fixture();
  await notifyLinkedThreads(f.client, f.event, f.options);
  await notifyLinkedThreads(f.client, { ...f.event, deliveryId: NEXT_EVENT }, f.options);
  assert.equal(f.sent.length, 2);
});

test('a notice that may have reached Discord is held, not replayed', async () => {
  const f = fixture(); let attempts = 0;
  f.source.reply = async () => { attempts++; throw Error('Synthetic ambiguous send'); };
  await notifyLinkedThreads(f.client, f.event, f.options);
  await notifyLinkedThreads(f.client, f.event, f.options);
  assert.equal(attempts, 1);
});

test('receipt storage failure before send cannot fall back to an unfenced notice', async () => {
  const f = fixture();
  f.options.noticeReceipts.begin = async () => { throw Error('Synthetic database outage'); };
  await assert.rejects(notifyLinkedThreads(f.client, f.event, f.options));
  assert.equal(f.sent.length, 0);
});

test('a sent notice with an unconfirmed receipt cannot be sent again', async () => {
  const f = fixture();
  f.options.noticeReceipts.confirm = async () => { throw Error('Synthetic receipt acknowledgement lost'); };
  await notifyLinkedThreads(f.client, f.event, f.options);
  await notifyLinkedThreads(f.client, f.event, f.options);
  assert.equal(f.sent.length, 1);
});

test('missing or malformed GitHub delivery identity never sends', async () => {
  const f = fixture();
  for (const deliveryId of [undefined, '', 'arbitrary text', ['ambiguous', EVENT]]) {
    assert.equal(await notifyLinkedThreads(f.client, { ...f.event, deliveryId }, f.options), 0);
  }
  assert.equal(f.sent.length, 0);
});

test('a temporarily missing source does not consume another customers notice or its receipt', async () => {
  const f = fixture();
  f.channel.messages.fetch = async () => ({ ...f.source, author: { id: 'another-owner' } });
  assert.equal(await notifyLinkedThreads(f.client, f.event, f.options), 0);
  assert.equal(f.state.size, 0);
  f.channel.messages.fetch = async () => f.source;
  assert.equal(await notifyLinkedThreads(f.client, f.event, f.options), 1);
});

test('one merged event with multiple linked issue numbers still sends once per original source', async () => {
  const f = fixture();
  f.options.issueLinks.listForIssue = async (_repo, issueNumber) => [{ ...f.record, issueNumber }];
  assert.equal(await notifyLinkedThreads(f.client, { ...f.event, numbers: [42, 43] }, f.options), 1);
  assert.equal(f.sent.length, 1);
});

test('the legacy dedicated-thread notice path uses the same durable delivery fence', async t => {
  const github = require('../github');
  github.resetGithubMemory(); t.after(() => github.resetGithubMemory());
  github.linkIssueThread(42, 'synthetic-thread', { persist: false });
  const f = fixture();
  f.options.issueLinks.listForIssue = async () => [];
  f.channel.isThread = () => true;
  f.channel.send = async payload => { f.sent.push(payload); return { id: '100000000000000999' }; };
  assert.equal(await notifyLinkedThreads(f.client, f.event, f.options), 1);
  assert.equal(await notifyLinkedThreads(f.client, f.event, f.options), 0);
  assert.equal(f.sent.length, 1);
});
