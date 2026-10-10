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

test('planner human request reaches staff even when language routing is otherwise a FAQ', () => {
  const route = { area: 'unknown', lane: 'faq', escalate: false, wantHuman: false };
  const plan = { supportKind: 'official_information', wantsPerson: true, standaloneQuestion: 'I want to speak with a person' };
  assert.deepEqual(policy.routeWithUnderstanding(route, plan), { ...route, escalate: true, wantHuman: true });
  assert.equal(policy.suppressOffTopic({ ...plan, messageKind: 'off_topic' }, route), false);
});

test('planner-confirmed human order requests keep the human path through private-status fallback', (t) => {
  const router = require('../router');
  const { escalateReply } = require('../utils');
  t.mock.method(require('../orderFlow'), 'isLive', () => true);
  const question = 'Where is my shipment? I would prefer somebody from dispatch to look into it.';
  const plan = { supportKind: 'order_lookup', wantsPerson: true, replyLanguage: 'en' };
  const route = policy.routeWithUnderstanding(router.classify(question), plan, question);
  assert.equal(route.wantHuman, true);
  const body = policy.personReply('order_lookup', route, question, plan);
  assert.match(body, /person from the shop team/i);
  assert.match(body, /verified order check/i);
  assert.match(body, /don't post your address or payment details/i);
  const delivered = escalateReply(body, { pinged: true, replyInThread: true });
  assert.match(delivered, /will reply in this thread/i);
  assert.doesNotMatch(delivered, /\/order\b|email a code|help@omi\.me/i);
});

test('ordinary planner-routed order status keeps live private self-service', (t) => {
  const router = require('../router');
  t.mock.method(require('../orderFlow'), 'isLive', () => true);
  const plan = { supportKind: 'order_lookup', wantsPerson: false, replyLanguage: 'en' };
  const question = 'Where is my shipment?';
  const route = policy.routeWithUnderstanding(router.classify(question), plan, question);
  assert.equal(Boolean(route.wantHuman), false);
  assert.match(policy.personReply('order_lookup', route, question, plan), /Use \/order to check your own orders privately/i);
});

test('order and account handoff drafts retain the relevant goal without inventing status', () => {
  const order = policy.personReply('order_lookup', { lane: 'shop' }, 'Where is my order?');
  assert.match(order, /verified order check/i);
  assert.doesNotMatch(order, /help@omi\.me|Use \/order/i);
  assert.doesNotMatch(order, /has shipped|will arrive (?:on|by|tomorrow|next)/i);
  const account = policy.personReply('account_action', { lane: 'privacy' }, 'Delete my account');
  assert.match(account, /delet|remov|privacy/i);
});

test('planner-routed personal actions get exactly the next step confirmed by delivery', () => {
  const { escalateReply } = require('../utils');
  for (const [kind, route, question] of [
    ['order_lookup', { lane: 'shop' }, 'Where is my order?'],
    ['account_action', { lane: 'account' }, 'Please change my account plan'],
    ['privacy', { lane: 'privacy' }, 'Please delete my data'],
    ['money', { lane: 'money' }, 'I want a refund'],
    ['exception_request', { lane: 'shop' }, 'Can you approve a warranty replacement?'],
  ]) {
    const draft = policy.personReply(kind, route, question);
    assert.ok(draft.trim());
    assert.doesNotMatch(draft, /^I can|has this now|will reply|email help@omi\.me|Use \/order/i);
    const delivered = escalateReply(draft, { pinged: true, replyInThread: true });
    assert.equal((delivered.match(/will reply in this thread/gi) || []).length, 1);
    assert.doesNotMatch(delivered, /help@omi\.me|Use \/order|approved|has shipped/i);
    const failed = escalateReply(draft, { deliveryFailed: true });
    assert.equal((failed.match(/help@omi\.me/gi) || []).length, 1);
    assert.doesNotMatch(failed, /will reply|has this now|Use \/order/i);
  }
});

test('an official answer to a how-to can stay in-thread despite a model handoff request', () => {
  assert.equal(policy.isGroundedHowTo({ lane: 'faq' }, 'How do I update Omi?', 'Open Settings → Device Settings → Update Firmware. Source: https://help.omi.me/en/articles/13149698-omi'), true);
  assert.equal(policy.isGroundedHowTo({ lane: 'faq' }, 'How do I turn Omi off?', "I couldn't find an official power-off step. Source: https://help.omi.me/en/articles/13154278-omi-necklace-issues"), false);
  assert.equal(policy.isGroundedHowTo({ lane: 'faq' }, 'How do I update Omi?', "I couldn't verify a safe answer. A person needs to check this. Source: https://help.omi.me/en/articles/123-update-omi"), false);
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
  const symptom = { supportKind: 'technical_problem', standaloneQuestion: 'The transcripts are empty after pairing was resolved' };
  assert.equal(policy.routeWithUnderstanding(route, symptom, 'Resolved the pairing, now transcripts are empty').lane, 'tech');
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

test('only short, pure acknowledgments are suppressed, even when the planner mislabels a question', () => {
  for (const message of ['Thanks!', 'fixed it thanks', 'Gracias, ya funciona', 'Order #12345 is resolved, merci']) {
    assert.equal(policy.suppressAcknowledgment({ messageKind: 'acknowledgment' }, message), true, message);
  }
  for (const message of [
    'Has the error been fixed in the new version',
    'Resolved the pairing, now transcripts are empty',
    'Thanks, but the recordings are still missing',
    'It was fixed, another issue appeared with the microphone',
    'Can support check whether that bug is fixed',
  ]) {
    assert.equal(policy.suppressAcknowledgment(null, message), false, message);
    assert.equal(policy.suppressAcknowledgment({ messageKind: 'acknowledgment' }, message), false, message);
  }
});

test('unsupported handoff languages keep a delivered or failed next step', () => {
  const { escalateReply } = require('../utils');
  for (const { language, question, acknowledgment } of [
    { language: 'ko', question: '상담원과 이야기하고 싶어요', acknowledgment: '담당자가 요청을 비공개로 검토해야 합니다.' },
    { language: 'ru', question: 'Хочу поговорить с человеком', acknowledgment: 'Запрос должен проверить сотрудник команды.' },
  ]) {
    const plan = { replyLanguage: language, handoffAcknowledgment: acknowledgment };
    const body = policy.personReply('exception_request', { lane: 'account' }, question, plan);
    assert.equal(body, acknowledgment);
    const footers = policy.handoffFooters(plan, question);
    const delivered = escalateReply(body, { pinged: true, replyInThread: true, footers });
    assert.match(delivered, /will reply in this thread/i, language);
    const failed = escalateReply(body, { deliveryFailed: true, footers });
    assert.match(failed, /help@omi\.me/i, language);
  }
  const fallback = policy.personReply('exception_request', { lane: 'account' }, 'Хочу поговорить с человеком', { replyLanguage: 'ru' });
  assert.match(fallback, /person needs to review/i);
});

const NEW_HANDOFF_LOCALES = [
  { language: 'zh', regionalLanguage: 'zh-CN', question: '我需要人工帮助。', body: '这个问题仍需查看。',
    pending: /需要.*支持团队.*查看/, thread: /已将.*发送给支持团队.*等待团队回复/, sent: /已发送给支持团队/,
    failed: /未能.*发送给支持团队.*help@omi\.me/, duplicate: /支持团队已经收到/, issue: /问题已记录/ },
  { language: 'it', regionalLanguage: 'it-IT', question: 'Ho bisogno di aiuto da una persona.', body: 'Il problema richiede una verifica.',
    pending: /persona del team.*esaminare/, thread: /Ho inviato.*Attendi la risposta.*questa conversazione/, sent: /richiesta è stata inviata/,
    failed: /Non ho potuto inviare.*help@omi\.me/, duplicate: /team ha già ricevuto/, issue: /problema è registrato/ },
];

test('Chinese and Italian handoffs provide every delivery-state key and a localized pending fallback', () => {
  const keys = ['pending', 'thread', 'sent', 'failed', 'duplicate', 'issue'];
  for (const locale of NEW_HANDOFF_LOCALES) {
    const footers = policy.handoffFooters({ replyLanguage: locale.language }, locale.question);
    assert.ok(footers, locale.language);
    assert.deepEqual(Object.keys(footers).sort(), [...keys].sort(), locale.language);
    for (const key of keys) assert.match(footers[key], locale[key], `${locale.language}:${key}`);
    assert.deepEqual(policy.handoffFooters({ replyLanguage: locale.regionalLanguage }, locale.question), footers);
    assert.equal(policy.personReply('exception_request', { lane: 'account' }, locale.question,
      { replyLanguage: locale.language }), footers.pending);
    assert.doesNotMatch(footers.pending, /help@omi\.me|has this now|will reply|received|已发送|已经收到/);
  }
});

test('Chinese and Italian handoff footers follow confirmed delivered, failed and other outcome paths', () => {
  const { escalateReply } = require('../utils');
  for (const locale of NEW_HANDOFF_LOCALES) {
    const footers = policy.handoffFooters({ replyLanguage: locale.language }, locale.question);
    assert.ok(footers, locale.language);
    for (const [options, key] of [
      [{ pinged: true, replyInThread: true }, 'thread'],
      [{ pinged: true }, 'sent'],
      [{ pinged: true, duplicate: true }, 'duplicate'],
      [{ deliveryFailed: true, pinged: true, replyInThread: true }, 'failed'],
      [{ issue: true }, 'issue'],
      [{}, 'pending'],
    ]) {
      const reply = escalateReply(locale.body, { ...options, footers });
      assert.equal(reply, `${locale.body}\n\n${footers[key]}`, `${locale.language}:${key}`);
      assert.doesNotMatch(reply, /A person on the team|will reply in this thread|I could not send|The team already|The problem is written/i);
      assert.equal((reply.match(/help@omi\.me/g) || []).length, key === 'failed' ? 1 : 0, `${locale.language}:${key}`);
    }
    assert.doesNotMatch(footers.failed, locale.sent);
    assert.doesNotMatch(footers.failed, locale.thread);
  }
});

test('person-only fallback matches the request and uses the customer script', () => {
  const billing = policy.personReply('money', { lane: 'money' }, 'My bill is wrong');
  assert.match(billing, /payment|charge|billing/i);
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
