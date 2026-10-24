const test = require('node:test');
const assert = require('node:assert/strict');
const router = require('../router');
const policy = require('../plannerPolicy');

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
