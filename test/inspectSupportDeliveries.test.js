const test = require('node:test');
const assert = require('node:assert/strict');
const { inspect } = require('../scripts/inspect-support-deliveries');

test('read-only inspection reports bounded operational metadata, not delivery provenance or payload', async () => {
  const row = { id: 'opaque-receipt', kind: 'answer', state: 'unknown', attemptCount: 1, createdAt: 1000,
    nonce: 'SECRET_NONCE', customerId: 'PRIVATE_CUSTOMER', channelId: 'PRIVATE_CHANNEL', sourceMessageId: 'PRIVATE_SOURCE',
    payload: 'PRIVATE_BODY', operationKey: 'PRIVATE_OPERATION' };
  const calls = [];
  const result = await inspect({ listHeld: async (limit) => { calls.push(limit); return [row]; },
    pendingReceipts: async (limit) => { calls.push(limit); return [{ ...row, state: 'accepted', messageId: 'PRIVATE_RECEIPT' }]; },
  }, { limit: 5, now: 6000 });
  assert.deepEqual(calls, [5, 5]);
  assert.deepEqual(result.held, [{ id: 'opaque-receipt', kind: 'answer', state: 'unknown', attemptCount: 1,
    hasReceipt: false, projectionPending: false, ageSeconds: 5 }]);
  assert.equal(result.pendingProjections[0].hasReceipt, true);
  assert.equal(result.pendingProjections[0].projectionPending, true);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_|SECRET_/);
});
