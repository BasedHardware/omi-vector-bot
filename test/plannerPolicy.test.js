const assert = require('node:assert/strict');
const test = require('node:test');
const policy = require('../plannerPolicy');

test('person handoffs use deterministic staff reasons, not model claims', () => {
  assert.match(policy.personReason('order_lookup'), /verified staff check/);
  assert.match(policy.personReason('account_action'), /staff access/);
  assert.match(policy.personReason('exception_request'), /staff review/);
  for (const kind of ['order_lookup', 'account_action', 'exception_request']) {
    assert.doesNotMatch(policy.personReply(kind), /(?:refund|replacement) approved|has shipped|will arrive (?:on|by|tomorrow|next)/i);
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
  assert.doesNotMatch(order, /has shipped|will arrive (?:on|by|tomorrow|next)/i);
  const account = policy.personReply('account_action', { lane: 'privacy' }, 'Delete my account');
  assert.match(account, /delet|remov|privacy/i);
});

test('planner-routed order reply uses verified /order when live and email when unavailable', () => {
  const flow = require('../orderFlow');
  const previous = flow.isLive;
  try {
    flow.isLive = () => true;
    const live = policy.personReply('order_lookup', { lane: 'shop' }, 'Where is my order?');
    assert.match(live, /Use \/order to check your own orders/i);
    assert.match(live, /email a code/i);
    flow.isLive = () => false;
    const unavailable = policy.personReply('order_lookup', { lane: 'shop' }, 'Where is my order?');
    assert.match(unavailable, /help@omi\.me/);
    assert.doesNotMatch(unavailable, /Use \/order/i);
  } finally {
    flow.isLive = previous;
  }
});

test('an official answer to a how-to can stay in-thread despite a model handoff request', () => {
  assert.equal(policy.isGroundedHowTo({ lane: 'faq' }, 'How do I update Omi?', 'Open Settings → Device Settings → Update Firmware. Source: https://help.omi.me/en/articles/13149698-omi'), true);
  assert.equal(policy.isGroundedHowTo({ lane: 'faq' }, 'How do I turn Omi off?', "I couldn't find an official power-off step. Source: https://help.omi.me/en/articles/13154278-omi-necklace-issues"), false);
  assert.equal(policy.isGroundedHowTo({ lane: 'faq' }, 'How do I update Omi?', "Open Settings → Device Settings → Update Firmware. I'm not sure where to see the version afterward. Source: https://help.omi.me/en/articles/13149698-omi"), true);
});

test('documented power-off sequence is a cited canned answer', () => {
  const question = 'How do I turn the Omi necklace off?';
  const reply = require('../router').cannedReply({ lane: 'faq' }, question);
  assert.match(reply, /3 second/i);
  assert.match(reply, /press.*once.*turn.*on/i);
  assert.match(reply, /https:\/\/docs\.omi\.me\/onboarding\/omi/);
  assert.doesNotMatch(reply, /not document|can't verify|help@omi\.me/i);
});

test('planner cannot turn a plain device how-to into a fault handoff', () => {
  const route = { area: 'unknown', lane: 'faq', escalate: false, wantHuman: false };
  const plan = { supportKind: 'technical_problem', standaloneQuestion: 'Omi necklace keeps turning itself off' };
  assert.deepEqual(policy.routeWithUnderstanding(route, plan, 'How do I switch my Omi necklace off?'), route);
  assert.equal(policy.routeWithUnderstanding({ area: 'unknown', lane: 'unknown' }, plan, 'It keeps turning itself off').lane, 'firmware');
});

test('a cited canned how-to is usable only when its official source is retrieved', () => {
  const route = { area: 'unknown', lane: 'faq', escalate: false, wantHuman: false };
  const question = 'How do I turn the Omi necklace off?';
  const evidence = '[S1 | Official documentation | authoritative]\nOmi Setup\nhttps://docs.omi.me/onboarding/omi.md\nPress and hold for 3 seconds to turn the device off. Press once to turn it on.';
  assert.match(policy.verifiedCannedReply(route, question, evidence), /3 seconds.*turn it off/i);
  assert.equal(policy.verifiedCannedReply(route, question, '[S1] Other docs'), '');
  assert.equal(policy.verifiedCannedReply(route, question, evidence.replace('3 seconds', 'some time')), '');
  assert.equal(policy.verifiedCannedReply({ ...route, wantHuman: true }, question, evidence), '');
  assert.equal(policy.verifiedCannedReply(route, 'How do I turn my Omi DevKit 2 off?', evidence), '');
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

test('confident English canned lanes skip planning while multilingual and grounded requests do not', () => {
  assert.equal(policy.skipPlannerForCanned({ lane: 'money' }, 'I want a refund for my order.'), true);
  assert.equal(policy.skipPlannerForCanned({ lane: 'privacy' }, 'Please delete my data.'), true);
  assert.equal(policy.skipPlannerForCanned({ lane: 'account' }, 'I have a question about my plan.'), true);
  assert.equal(policy.skipPlannerForCanned({ lane: 'money' }, 'Quiero un refund para mi pedido.'), false);
  assert.equal(policy.skipPlannerForCanned({ lane: 'shop', responseMode: 'grounded' }, 'Can I get a cheaper shipping quote?'), false);
});

test('off-topic chatter is silent but a request for a person is not', () => {
  assert.equal(policy.suppressOffTopic({ messageKind: 'off_topic' }, { lane: 'unknown', escalate: false }), true);
  assert.equal(policy.suppressOffTopic({ messageKind: 'off_topic' }, { lane: 'unknown', wantHuman: true }), false);
  assert.equal(policy.suppressOffTopic({ messageKind: 'off_topic' }, { lane: 'tech', escalate: true }), false);
});

test('person-only fallback matches the request and uses the customer script', () => {
  const billing = policy.personReply('money', { lane: 'money' }, 'My bill is wrong');
  assert.match(billing, /billing/i);
  assert.doesNotMatch(billing, /remove your data|replacement|warranty/i);
  const human = policy.personReply('exception_request', { lane: 'shop', wantHuman: true }, 'Can I talk to a person?');
  assert.match(human, /person/i);
  assert.doesNotMatch(human, /replacement|warranty/i);
  const romanized = policy.personReply('exception_request', { lane: 'money' }, 'Mujhe refund chahiye', {
    replyLanguage: 'hi', handoffAcknowledgment: 'मुझे मदद चाहिए।',
  });
  assert.match(romanized, /Team ke kisi vyakti/i);
  assert.doesNotMatch(romanized, /\p{Script=Devanagari}/u);
  const footer = policy.handoffFooters({ replyLanguage: 'hi' }, 'Mujhe refund chahiye');
  assert.match(footer.thread, /isi thread mein jawab/i);
  assert.doesNotMatch(footer.thread, /\p{Script=Devanagari}/u);
});
