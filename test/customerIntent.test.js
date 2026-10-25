const test = require('node:test');
const assert = require('node:assert/strict');
const router = require('../router');
const policy = require('../plannerPolicy');
const { projectCustomerIntent, constrainIntentPlan } = require('../customerIntent');
const { contextualQuestion } = require('../commandcode');

const project = (turns, question) => projectCustomerIntent({ turns, question, contextualize: contextualQuestion });

test('withdrawing one action preserves unrelated technical facts from the same earlier turn', () => {
  const p = project([
    { id: 'owner-1', role: 'owner', content: 'I want a refund; my Mac app cannot detect the microphone after I change inputs.' },
    { id: 'owner-2', role: 'owner', content: 'I do not want a refund.' },
  ], 'My app build is 8.4.3.');
  assert.equal(p.active.has('money'), false);
  assert.equal(p.withdrawn.has('money'), true);
  assert.equal(p.route.lane, 'tech');
  assert.equal(p.route.area, 'desktop');
  assert.match(p.fallbackQuestion, /cannot detect the microphone after I change inputs/);
  assert.doesNotMatch(p.fallbackQuestion, /refund/i);
});

test('withdrawn routing signals do not erase technical facts or a separate active action', () => {
  const turns = [
    { id: 'owner-1', role: 'owner', content: 'Please delete my data; the desktop app crashes when I select a microphone.' },
    { id: 'owner-2', role: 'owner', content: 'I do not want to delete my data.' },
  ];
  const p = project(turns, 'The app build is 8.4.3.');
  assert.match(p.fallbackQuestion, /crashes when I select a microphone/);
  assert.doesNotMatch(p.fallbackQuestion, /delete my data/i);
  assert.equal(p.route.area, 'desktop');
  const reopened = project(turns, 'Please delete my data now.');
  assert.equal(reopened.route.lane, 'privacy');
  assert.equal(reopened.active.has('privacy'), true);
  const independent = project(turns, 'I want a refund.');
  assert.equal(independent.route.lane, 'money');
  assert.equal(independent.withdrawn.has('privacy'), true);
});

test('withdrawals are folded before the bounded planning view clips middle turns', () => {
  const turns = [
    { id: 'owner-1', role: 'owner', content: 'I want a refund.' },
    { id: 'owner-2', role: 'owner', content: 'Android sync fails.' },
    { id: 'owner-3', role: 'owner', content: 'I am not asking for a refund; Android sync still fails.' },
    ...Array.from({ length: 27 }, (_, i) => ({ id: `owner-${i + 4}`, role: 'owner', content: `Android diagnostic build ${i + 1}.` })),
  ];
  const p = project(turns, 'My Android app build is 8.4.3.');
  assert.equal(p.active.has('money'), false);
  assert.equal(p.withdrawn.has('money'), true);
  assert.equal(p.summary.ownerTurns.length, 8);
  assert.equal(p.route.lane, 'tech');
  const result = constrainIntentPlan({ supportKind: 'technical_problem', customerGoal: 'refund the purchase',
    queries: ['refund timing'], customerFacts: ['wants a refund'], mustAnswer: ['refund status'] }, p);
  assert.deepEqual(result.queries, []);
  assert.deepEqual(result.customerFacts, []);
  assert.doesNotMatch(result.customerGoal, /refund/i);
});

test('new owner actions reopen independently while another participant cannot withdraw them', () => {
  const turns = [
    { id: 'owner-1', role: 'owner', content: 'I want a refund.' },
    { id: 'owner-2', role: 'owner', content: 'Please delete my data.' },
    { id: 'owner-3', role: 'owner', content: 'I do not want a refund.' },
    { id: 'participant-1', role: 'participant', content: 'I did not request data deletion.' },
  ];
  const p = project(turns, 'My Android app build is 8.4.3.');
  assert.equal(p.active.has('privacy'), true);
  assert.equal(p.active.has('money'), false);
  const reopened = project(turns, 'I want a refund now.');
  assert.equal(reopened.active.has('money'), true);
  assert.equal(reopened.withdrawn.has('money'), false);
  assert.equal(reopened.active.has('privacy'), true);
});

test('valid owner provenance can protect new multilingual or ambiguous actions without English keywords', () => {
  const denied = [{ id: 'owner-1', role: 'owner', content: 'I am not asking for a refund.' }];
  for (const [turns, question] of [
    [[], 'Ich möchte eine Rückerstattung.'],
    [[], '注文を取り消したいです。'],
    [denied, 'Actually, now I want one.'],
  ]) {
    const p = project(turns, question);
    const result = constrainIntentPlan({ supportKind: 'exception_request', intentSources: ['owner-current'],
      standaloneQuestion: 'The owner requests private review.', wantsPerson: true, dataLossRisk: true, replyLanguage: 'de' }, p);
    assert.equal(result.supportKind, 'exception_request', question);
    assert.equal(result.wantsPerson, true);
    assert.equal(result.dataLossRisk, true);
    assert.equal(result.replyLanguage, 'de');
  }
});

test('a malformed or other-speaker action citation cannot grant personal-action authority', () => {
  const p = project([{ id: 'participant-1', role: 'participant', content: 'Please refund my purchase.' }], 'Android sync fails.');
  for (const intentSources of [undefined, [], ['participant-1'], ['made-up'], 'owner-current']) {
    const result = constrainIntentPlan({ supportKind: 'money', intentSources, customerGoal: 'refund',
      customerFacts: ['refund requested'], queries: ['refund'], subQuestions: [{ question: 'refund', query: 'refund' }],
      handoffAcknowledgment: 'Your refund needs approval.', device: 'another participant device', topic: 'refund' }, p);
    assert.equal(result.supportKind, 'other');
    assert.deepEqual(result.customerFacts, []);
    assert.deepEqual(result.queries, []);
    assert.deepEqual(result.subQuestions, []);
    assert.equal(result.handoffAcknowledgment, '');
    assert.equal(result.device, '');
    assert.equal(result.topic, '');
    assert.equal(result.unconfirmedPersonalIntent, true, 'keep the conservative generic person path');
  }
});

test('known owner money and device actions retain the existing exception classification', () => {
  for (const question of ['Quiero un reembolso.', 'I need a replacement device.', 'I am not asking for a refund; I need a replacement device.']) {
    const p = project([], question);
    const result = constrainIntentPlan({ supportKind: 'exception_request', replyLanguage: 'es', wantsPerson: true }, p);
    assert.equal(result.supportKind, 'exception_request', question);
    assert.equal(result.wantsPerson, true);
    assert.equal(result.replyLanguage, 'es');
  }
});

test('already-read attachment diagnostics inform retrieval without granting personal-action authority', () => {
  const p = project([{ id: 'attachment-1', role: 'attachment', content: 'Android sync failure: diagnostic code E-STAGE.' }], 'Please check the attached log.');
  assert.match(p.fallbackQuestion, /E-STAGE/);
  assert.equal(p.ownerIds.has('attachment-1'), false);
  assert.equal(p.summary.ownerTurns.length, 1);
  const request = constrainIntentPlan({ supportKind: 'money', intentSources: ['attachment-1'] }, p);
  assert.equal(request.supportKind, 'other');
  assert.equal(request.unconfirmedPersonalIntent, true);
});

test('negating unrelated help cannot erase a later protected request', () => {
  const {requestCorrection} = require('../requestCorrections');
  for (const [question,kind] of [
    ['I do not need setup help and would like a refund.','money'],
    ['I did not ask for a call and I want to delete my data.','privacy'],
    ['No quiero instrucciones y quiero un reembolso.','money'],
    ['No he pedido ayuda y quiero borrar mi cuenta.','privacy'],
  ]) {
    assert.equal(requestCorrection(question).denied.size,0,question);
    assert.equal(router.classify(question).escalate,true,question);
    assert.equal(policy.personKind({supportKind:kind},question),kind,question);
  }
});

test('a rejected financial interpretation does not replace the technical request', () => {
  for (const question of [
    'I am not asking for a refund; the Android app freezes during playback.',
    'We never requested a payment adjustment. The desktop app microphone still fails.',
    'No estoy pidiendo un reembolso; la aplicación de Android no sincroniza.',
  ]) {
    const route = router.classify(question);
    assert.equal(router.isTechLane(route), true);
    assert.equal(route.escalate, true);
    const plan = { supportKind: 'money', standaloneQuestion: 'The customer wants a refund.' };
    assert.equal(policy.personKind(plan, question), '');
    assert.equal(policy.routeWithUnderstanding(route, plan, question).lane, route.lane);
  }
});

test('a corrected plan cannot retain an invented action in retrieval or answer requirements', () => {
  const question = 'We never requested a refund. Android playback still crashes.';
  const plan = { supportKind: 'money', standaloneQuestion: 'Refund the purchase', customerGoal: 'Get a refund',
    customerFacts: ['Customer requested a refund'], mustAnswer: ['Refund timing'], queries: ['refund policy'],
    subQuestions: [{ question: 'Refund timing', query: 'refund' }], replyLanguage: 'en', dataLossRisk: true, wantsPerson: true };
  const result = policy.constrainUnderstanding(plan, question);
  assert.equal(result.supportKind, 'other');
  assert.equal(result.standaloneQuestion, question);
  assert.equal(result.customerGoal, question);
  assert.deepEqual(result.mustAnswer, [question]);
  for (const field of ['customerFacts', 'queries', 'subQuestions']) assert.deepEqual(result[field], []);
  assert.equal(result.dataLossRisk, true);
  assert.equal(result.wantsPerson, true);
  assert.equal(result.replyLanguage, 'en');
});

test('unknown grammar and independent positive requests are not waived by correction filtering', () => {
  const { requestCorrection } = require('../requestCorrections');
  for (const question of [
    'I want a refund; the app fails.',
    'Please delete my data.',
    'No estoy pidiendo un reembolso, pero quiero un reembolso ahora.',
    'I did not request data deletion, but please delete my account now.',
    'I am not asking how to record; please refund my purchase.',
  ]) assert.equal(router.classify(question).escalate, true, question);
  assert.equal(requestCorrection('No personal action was specified').denied.size, 0);
  assert.equal(policy.personKind({ supportKind: 'money' }, 'Could someone check the unexpected charge?'), 'money');
});

test('a rejected deletion interpretation does not invent a privacy action', () => {
  for (const question of [
    'I did not request data deletion; my iPhone recordings are missing.',
    'No quiero borrar mi cuenta; Android muestra un error al sincronizar.',
  ]) {
    const route = router.classify(question);
    assert.equal(router.isTechLane(route), true);
    const plan = { supportKind: 'account_action', standaloneQuestion: 'Delete my account.' };
    assert.equal(policy.personKind(plan, question), '');
    assert.equal(policy.routeWithUnderstanding(route, plan, question).lane, route.lane);
  }
});

test('independent positive financial, replacement and privacy requests remain protected', () => {
  for (const question of [
    'I am not asking for a refund, but please cancel my order.',
    'We never requested a payment adjustment. I was charged twice today.',
    'I did not request data deletion before. Please delete my account now.',
    'I am not asking for a refund; I need a replacement device.',
    'I want a refund because the Android app keeps crashing.',
  ]) {
    assert.equal(router.classify(question).escalate, true);
    assert.ok(policy.personKind({ supportKind: 'exception_request' }, question));
  }
  assert.equal(policy.personKind({ supportKind: 'money' }, 'I did not request a refund yesterday, but now I want one.'), 'money');
});

test('money spent and provider billing vocabulary are not personal financial actions', () => {
  for (const question of [
    'I spent 275 dollars and Android sync still fails after reconnecting.',
    'The desktop app provider returns a billing-related error with HTTP 402.',
    'Pagué por el dispositivo y Android sigue sin grabar.',
  ]) assert.equal(router.isTechLane(router.classify(question)), true);
});
