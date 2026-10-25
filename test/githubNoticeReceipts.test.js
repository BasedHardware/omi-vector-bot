const assert = require('node:assert/strict');
const test = require('node:test');
const receipts = require('../githubNoticeReceipts');
const ID = '10000000-0000-4000-8000-00000000000a';
const scope = () => receipts.keys('BasedHardware/omi', ID, ['case', 'synthetic-case', 'synthetic-owner', 'synthetic-thread', 'synthetic-source']);

test('GitHub event and recipient keys are canonical text-free hashes', () => {
  const value = scope();
  assert.deepEqual(value, receipts.keys('basedhardware/omi', ID.toUpperCase(), ['case', 'synthetic-case', 'synthetic-owner', 'synthetic-thread', 'synthetic-source']));
  assert.ok(Object.values(value).every(key => /^[a-f0-9]{64}$/.test(key)));
  assert.notEqual(value.eventKey, receipts.keys('another/repository', ID, ['same']).eventKey);
  assert.notEqual(value.eventKey, receipts.keys('BasedHardware/omi', ID.replace(/a$/, 'b'), ['same']).eventKey);
  assert.notEqual(value.recipientKey, receipts.keys('BasedHardware/omi', ID, ['case', 'another-owner']).recipientKey);
  assert.equal(receipts.validDeliveryId([ID]), false);
});

test('receipt state survives adapter recreation and uncertain outcomes are never reclaimed', async () => {
  const a = receipts.createMemoryStore(); const value = scope();
  assert.deepEqual((await Promise.all([a.begin(value), a.begin(value)])).sort(), [false, true]);
  const b = receipts.createMemoryStore(a.state);
  assert.equal(await b.begin(value), false);
  await a.uncertain(value);
  assert.equal(await b.begin(value), false);
  assert.equal(await b.confirm({ ...value, messageId: '100000000000000999' }), false);
  assert.equal(a.state.values().next().value.state, 'uncertain');
});

test('confirmed receipts cannot be overwritten or downgraded', async () => {
  const store = receipts.createMemoryStore(); const value = scope();
  await store.begin(value);
  assert.equal(await store.confirm({ ...value, messageId: '100000000000000999' }), true);
  assert.equal(await store.confirm({ ...value, messageId: '100000000000000998' }), false);
  await store.uncertain(value);
  assert.deepEqual(store.state.values().next().value, { state: 'sent', messageId: '100000000000000999' });
  await assert.rejects(store.begin({ eventKey: 'unsafe text', recipientKey: value.recipientKey }));
  await assert.rejects(store.confirm({ ...value, messageId: 'not-a-discord-receipt' }));
});

test('production receipt service requires a database and never silently selects memory', async t => {
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = '';
  receipts.setStoreForTests(null);
  t.after(() => { if (previous === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous; });
  await assert.rejects(async () => receipts.begin(scope()), /notice_database_required/);
  const store = receipts.createPostgresStore({ query: async () => { throw Error('Synthetic SQL outage'); } });
  await assert.rejects(store.begin(scope()), /Synthetic SQL outage/);
});
