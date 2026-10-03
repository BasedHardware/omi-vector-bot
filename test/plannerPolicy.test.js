const assert = require('node:assert/strict');
const test = require('node:test');
const policy = require('../plannerPolicy');

test('person handoffs use deterministic staff reasons, not model claims', () => {
  assert.match(policy.personReason('order_lookup'), /verified staff check/);
  assert.match(policy.personReason('account_action'), /staff access/);
  assert.match(policy.personReason('exception_request'), /staff review/);
  for (const kind of ['order_lookup', 'account_action', 'exception_request']) {
    assert.doesNotMatch(policy.personReply(kind), /approved|shipped|will arrive/i);
  }
});
