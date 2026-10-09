const test = require('node:test');
const assert = require('node:assert/strict');
const { createReceiptRecovery } = require('../supportDeliveryRecovery');

function fixture(overrides = {}) {
  const effects = [];
  const row = { id: 'receipt', state: 'accepted', kind: 'staff-card', messageId: 'staff-message',
    caseId: 'case', caseGeneration: 0, approvalId: 'approval', customerId: 'alice', sourceMessageId: 'question', channelId: 'staff', botUserId: 'bot' };
  const supportCase = { id: 'case', customerId: 'alice', status: 'queued', generation: 0 };
  const sent = { id: 'staff-message', channelId: 'staff', author: { id: 'bot' },
    components: [{ components: [{ customId: 'file:approval' }] }] };
  const approval = { id: 'approval', caseId: 'case', customerId: 'alice', sourceMessageId: 'question', channelId: 'staff', botUserId: 'bot' };
  const dependencies = {
    deliveries: { pendingReceipts: async () => [row], markProjected: async (id) => effects.push(['projected', id]),
      deferProjection: async (id) => effects.push(['deferred', id]) },
    cases: { getCaseById: async () => supportCase, markDelivered: async (_id, receipt) => { effects.push(['delivered', receipt]); return supportCase; } },
    fetchChannel: async () => { effects.push(['fetch']); return { id: 'staff', messages: { fetch: async () => sent } }; },
    botUserId: () => 'bot', staffChannelId: () => 'staff', validateDestination: async () => true,
    getApproval: async () => approval,
    bindCard: async () => effects.push(['bound']),
    rememberAnswer: (_receipt, owner) => effects.push(['remembered', owner]),
    log: (line) => effects.push(['log', line]),
    ...overrides,
  };
  return { service: createReceiptRecovery(dependencies), row, supportCase, sent, approval, dependencies, effects };
}

test('restart repair uses the exact accepted staff receipt without another send', async () => {
  const f = fixture();
  await f.service.recover();
  assert.deepEqual(f.effects.map(([name]) => name), ['fetch', 'delivered', 'bound', 'projected']);
  assert.deepEqual(f.effects[1][1], { messageId: 'staff-message', destination: 'staff-channel', expectedGeneration: 0 });
});

test('unconfirmed receipts, other bot identities and other customers cannot project a handoff', async () => {
  for (const change of [{ state: 'unknown' }, { messageId: null }, { botUserId: 'another-bot' }, { customerId: 'bob' }]) {
    const f = fixture(); Object.assign(f.row, change);
    assert.equal(await f.service.repair(f.row), false);
    assert.deepEqual(f.effects, []);
  }
});

test('closed cases and old generations retire their projection without reopening or binding', async () => {
  for (const change of [{ status: 'closed' }, { status: 'resolved' }, { generation: 1 }]) {
    const f = fixture(); Object.assign(f.supportCase, change);
    assert.equal(await f.service.repair(f.row), true);
    assert.deepEqual(f.effects, [['projected', 'receipt']]);
  }
});

test('changed destination and failed fresh audience checks leave a receipt held', async () => {
  for (const overrides of [{ staffChannelId: () => 'other-staff' }, { validateDestination: async () => false }]) {
    const f = fixture(overrides);
    assert.equal(await f.service.repair(f.row), false);
    assert.equal(f.effects.some(([name]) => ['delivered', 'bound', 'projected'].includes(name)), false);
  }
});

test('an exact saved message ID still requires bot and channel ownership and no webhook', async () => {
  for (const change of [{ id: 'other-message' }, { channelId: 'public' }, { author: { id: 'other' } }, { webhookId: 'hook' }]) {
    const f = fixture(); Object.assign(f.sent, change);
    assert.equal(await f.service.repair(f.row), false);
    assert.deepEqual(f.effects, [['fetch']]);
  }
});

test('generation change during receipt lookup is fenced atomically before a bind', async () => {
  const f = fixture({ cases: { getCaseById: async () => ({ customerId: 'alice', status: 'queued', generation: 0 }), markDelivered: async () => null } });
  assert.equal(await f.service.repair(f.row), false);
  assert.deepEqual(f.effects, [['fetch']]);
});

test('approval controls cannot bind a different source, customer or case', async () => {
  for (const change of [{ sourceMessageId: 'other-question' }, { customerId: 'bob' }, { caseId: 'other-case' }, { channelId: 'public' }]) {
    const f = fixture(); Object.assign(f.approval, change);
    assert.equal(await f.service.repair(f.row), false);
    assert.equal(f.effects.some(([name]) => name === 'bound' || name === 'projected'), false);
  }
});

test('a removed control is recovered from immutable approval scope using only the saved-card PATCH', async () => {
  const f = fixture(); f.sent.components = [];
  f.sent.edit = async (payload) => { f.effects.push(['edited', payload]); };
  assert.equal(await f.service.repair(f.row), true);
  assert.deepEqual(f.effects.map(([name]) => name), ['fetch', 'delivered', 'bound', 'edited', 'projected']);
  assert.equal(f.effects[3][1].components[0].components[0].custom_id, 'file:approval');
  assert.deepEqual(f.effects[3][1].allowedMentions, { parse: [] });
});

test('a card with an unexpected publication control cannot repair the scoped proposal', async () => {
  const f = fixture(); f.sent.components[0].components[0].customId = 'file:other';
  assert.equal(await f.service.repair(f.row), false);
  assert.equal(f.effects.some(([name]) => name === 'bound' || name === 'projected'), false);
});

test('filed or expired approvals already bound to this exact card are not rebound', async () => {
  for (const change of [{ status: 'filed' }, { status: 'pending', expiresAt: '2000-01-01T00:00:00Z' }]) {
    const f = fixture(); Object.assign(f.approval, change, { cardMessageId: f.row.messageId });
    assert.equal(await f.service.repair(f.row), true);
    assert.equal(f.effects.some(([name]) => name === 'bound'), false);
    assert.equal(f.effects.at(-1)[0], 'projected');
  }
});

test('an approval bound to a different card stays held and cannot be retargeted', async () => {
  const f = fixture(); f.approval.cardMessageId = 'another-card';
  assert.equal(await f.service.repair(f.row), false);
  assert.equal(f.effects.some(([name]) => name === 'bound' || name === 'projected'), false);
});

test('accepted cases preserve their accepting actor and do not repeat a delivery transition', async () => {
  const f = fixture(); f.supportCase.status = 'accepted';
  assert.equal(await f.service.repair(f.row), true);
  assert.deepEqual(f.effects.map(([name]) => name), ['fetch', 'bound', 'projected']);
});

test('answer receipts rebuild customer-owned continuation references, with no fetch or send', async () => {
  const f = fixture(); Object.assign(f.row, { kind: 'answer', channelId: 'general' });
  assert.equal(await f.service.repair(f.row), true);
  assert.deepEqual(f.effects, [['remembered', { author: { id: 'alice' }, channel: { id: 'general' } }], ['projected', 'receipt']]);
});

test('failed repair schedules bounded backoff and logs no private exception', async () => {
  const f = fixture({ fetchChannel: async () => { throw new Error('PRIVATE_CONTENT_SECRET'); } });
  await f.service.recover();
  assert.deepEqual(f.effects, [['log', '[Delivery] accepted receipt projection held'], ['deferred', 'receipt']]);
});

test('overlapping recovery loops do not run the same projection concurrently in one copy', async () => {
  let release;
  const wait = new Promise((resolve) => { release = resolve; });
  const f = fixture({ fetchChannel: async () => { await wait; return { id: 'staff', messages: { fetch: async () => f.sent } }; } });
  const first = f.service.recover();
  await new Promise((resolve) => setImmediate(resolve));
  await f.service.recover();
  release(); await first;
  assert.equal(f.effects.filter(([name]) => name === 'delivered').length, 1);
});
