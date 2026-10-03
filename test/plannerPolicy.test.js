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

test('a checkout quote keeps its distinct shop route and reply', () => {
  const route = { area: 'shop', lane: 'shop', intent: 'shipping_quote', responseMode: 'grounded', escalate: true };
  const plan = { supportKind: 'order_lookup', standaloneQuestion: 'Can I get a different shipping rate?' };
  assert.deepEqual(policy.routeWithUnderstanding(route, plan), route);
  assert.match(policy.personReply('order_lookup', route, 'Shipping cost at checkout is €145'), /checkout shipping quote/i);
});

test('order and account handoffs retain useful next steps without inventing status', () => {
  const order = policy.personReply('order_lookup', { lane: 'shop' }, 'Where is my order?');
  assert.match(order, /\/order|help@omi\.me/i);
  assert.doesNotMatch(order, /shipped|will arrive/i);
  const account = policy.personReply('account_action', { lane: 'privacy' }, 'Delete my account');
  assert.match(account, /delet|remov|privacy/i);
});

test('an official answer to a how-to can stay in-thread despite a model handoff request', () => {
  assert.equal(policy.isGroundedHowTo({ lane: 'faq' }, 'How do I update Omi?', 'Open Settings → Device Settings → Update Firmware. Source: https://help.omi.me/en/articles/13149698-omi'), true);
  assert.equal(policy.isGroundedHowTo({ lane: 'faq' }, 'How do I turn Omi off?', "I couldn't find an official power-off step. Source: https://help.omi.me/en/articles/13154278-omi-necklace-issues"), false);
  assert.equal(policy.isGroundedHowTo({ lane: 'faq' }, 'How do I update Omi?', "Open Settings → Device Settings → Update Firmware. I'm not sure where to see the version afterward. Source: https://help.omi.me/en/articles/13149698-omi"), true);
});

test('unsupported power-off sequence is not a canned answer', () => {
  const question = 'How do I turn the Omi necklace off?';
  const reply = require('../router').cannedReply({ lane: 'faq' }, question);
  assert.match(reply, /not document a power-off button sequence/i);
  assert.doesNotMatch(reply, /3 second/i);
});

test('person handoff can acknowledge the request in the customer language without copying private details', () => {
  const route = { lane: 'money' };
  const safe = policy.personReply('exception_request', route, 'Quiero un reembolso', {
    replyLanguage: 'es',
    handoffAcknowledgment: 'Una persona del equipo revisará tu solicitud de reembolso en privado.',
  });
  assert.match(safe, /reembolso/i);
  const unsafe = policy.personReply('exception_request', route, 'Quiero un reembolso', {
    replyLanguage: 'es',
    handoffAcknowledgment: 'Tu pedido #12345 recibirá un reembolso de €40 mañana.',
  });
  assert.doesNotMatch(unsafe, /#12345|€40|mañana/);
});
