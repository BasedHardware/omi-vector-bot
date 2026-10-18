const assert = require('node:assert/strict');
const test = require('node:test');
const { EMPTY_ANSWER_FALLBACK } = require('../answerPipeline');
const { decideEscalation } = require('../escalationPolicy');

const question = 'why does omi save two copies of my conversation?';
const source = 'Source: https://help.omi.me/en/articles/123-update-omi';
const route = { lane: 'faq', area: 'unknown', wantHuman: false, escalate: false };

function decision(answer, overrides = {}) {
  return decideEscalation({
    route,
    question,
    answer: `${answer}\n${source}`,
    agent: { confidence: 0.95, escalate: false },
    caption: question,
    triaged: { escalate: false },
    holdPublicCopy: false,
    ...overrides,
  });
}

test('every bot-written person-needed fallback forces a handoff despite a cited FAQ URL', () => {
  const fallbacks = [
    "I found relevant information, but I couldn't verify a safe answer. A person needs to check this.",
    "I couldn't verify a direct answer to what you asked. A person needs to check this.",
    "I couldn't verify a safe troubleshooting step from the official information. A person needs to check this.",
    EMPTY_ANSWER_FALLBACK,
  ];
  for (const answer of fallbacks) {
    assert.equal(decision(answer).escalate, true, answer);
  }
});

test('an upstream person request cannot be canceled by a grounded how-to', () => {
  const answer = 'Open the Omi app and select the conversation. Source: https://help.omi.me/en/articles/123-update-omi';
  assert.equal(decision(answer, { agent: { confidence: 0.95, escalate: true } }).escalate, true);
  assert.equal(decision(answer, { route: { ...route, wantHuman: true } }).escalate, true);
  assert.equal(decision(answer, { route: { ...route, escalate: true } }).escalate, true);
  assert.equal(decision(answer, { agent: { confidence: 0.95, escalate: false } }).escalate, false);
});

test('data-loss risk forces a handoff even when the FAQ answer is grounded', () => {
  assert.equal(decision('Open the app and check the transcript.', { dataLossRisk: true }).escalate, true);
  assert.equal(decision('Open the app and check the transcript.', { dataLossRisk: false }).escalate, false);
});

test('handoff decision returns only the safe names of every firing signal', () => {
  const result = decision('A person needs to check this.', {
    route: { ...route, wantHuman: true, escalate: true },
    agent: { confidence: 0.2, escalate: true },
    triaged: { escalate: true },
    dataLossRisk: true,
    holdPublicCopy: true,
  });
  assert.equal(result.escalate, true);
  assert.deepEqual(result.signals, [
    'model_review', 'want_human', 'route', 'triage', 'data_loss',
    'answer_person', 'public_copy', 'low_confidence',
  ]);
  assert.equal(decision('Open the app and select the conversation.').signals.length, 0);
});

test('low confidence and caption fallback are named without logging the caption', () => {
  const uncertain = decideEscalation({
    route: { lane: 'unknown' }, question: 'A neutral question', answer: 'I am unsure.',
    agent: { confidence: 0.1, escalate: false }, caption: 'A neutral question',
  });
  assert.deepEqual(uncertain.signals, ['low_confidence']);
  const caption = decideEscalation({
    route: { lane: 'unknown' }, question: 'A neutral question', answer: 'I can explain.',
    agent: { confidence: 0.9, escalate: false }, caption: 'I need a refund for order 12345',
  });
  assert.deepEqual(caption.signals, ['caption']);
  assert.equal(caption.escalate, true);
});

const taskSource = 'https://help.omi.me/en/articles/synthetic-task-reference';
function reviewedDecision(overrides = {}) {
  return decideEscalation({
    route: { lane: 'unknown', area: 'unknown', escalate: false, wantHuman: false },
    question: 'Explain the purpose of the task list in Omi.',
    answer: `Tasks collect follow-up actions from conversations.\nSource: ${taskSource}`,
    agent: { confidence: 0.3, escalate: false },
    triaged: { lane: 'unknown', area: 'unknown', escalate: false },
    reviewApproved: true,
    retrievedUrls: [taskSource],
    ...overrides,
  });
}

test('a reviewer-approved retrieved citation can clear confidence alone without relying on a how-to label', () => {
  const result = reviewedDecision();
  assert.equal(result.docsQuiet, false);
  assert.equal(result.escalate, false);
  assert.deepEqual(result.signals, []);
});

test('low confidence still escalates without an actual published retrieved citation', () => {
  for (const overrides of [
    { answer: 'Tasks collect follow-up actions from conversations.' },
    { retrievedUrls: [] },
    { retrievedUrls: ['https://help.omi.me/en/articles/synthetic-other-reference'] },
    { answer: `Source: ${taskSource}-not-the-returned-page` },
    { answer: `Source: ${taskSource}#not-returned` },
  ]) assert.deepEqual(reviewedDecision(overrides).signals, ['low_confidence']);
});

test('only authoritative official sources qualify, not reports, spoofed hosts or repository issues', () => {
  for (const url of [
    'https://feedback.omi.me/p/synthetic-task-report',
    'https://discord.com/channels/1/2/3',
    'https://github.com/BasedHardware/omi/issues/123',
    'https://github.com/another-owner/omi/blob/main/tasks.md',
    'https://help.omi.me.example.test/article',
    'https://help.omi.me@example.test/article',
    'https://example.test/?next=https://help.omi.me/article',
    'http://help.omi.me/article',
  ]) assert.equal(reviewedDecision({ answer: `Source: ${url}`, retrievedUrls: [url] }).escalate, true, url);
  for (const url of [
    taskSource,
    'https://docs.omi.me/user-guide/synthetic-tasks',
    'https://omi.me/pages/synthetic-task-guide',
    'https://github.com/BasedHardware/omi/blob/main/app/tasks.dart',
    'https://github.com/BasedHardware/omi/releases/tag/synthetic-release',
  ]) assert.equal(reviewedDecision({ answer: `Tasks collect follow-ups. [Guide](${url}).`, retrievedUrls: [url] }).escalate, false, url);
});

test('a rejected, missing or merely truthy review approval never clears low confidence', () => {
  for (const reviewApproved of [false, undefined, null, 'true', {}]) {
    assert.equal(reviewedDecision({ reviewApproved }).escalate, true);
  }
});

test('a grounded confidence exception cannot change any other firing signal', () => {
  const independent = [
    [{ agent: { confidence: 0.3, escalate: true } }, 'model_review'],
    [{ route: { lane: 'unknown', wantHuman: true } }, 'want_human'],
    [{ route: { lane: 'unknown', escalate: true } }, 'route'],
    [{ triaged: { escalate: true } }, 'triage'],
    [{ dataLossRisk: true }, 'data_loss'],
    [{ answer: `A person needs to review this. Source: ${taskSource}` }, 'answer_person'],
    [{ holdPublicCopy: true }, 'public_copy'],
    [{ caption: 'I need the server logs.' }, 'caption'],
  ];
  for (const [overrides, name] of independent) {
    const result = reviewedDecision(overrides);
    assert.equal(result.escalate, true, name);
    assert.ok(result.signals.includes(name), name);
    assert.ok(result.signals.includes('low_confidence'), name);
  }
});

test('protected lanes, topics and interpreted person requests retain their existing low-confidence handoff', () => {
  for (const lane of ['shop', 'money', 'account', 'privacy']) {
    assert.equal(reviewedDecision({ route: { lane, escalate: false } }).escalate, true, lane);
    assert.equal(reviewedDecision({ triaged: { lane, escalate: false } }).escalate, true, lane);
  }
  for (const question of [
    'Explain the return policy for a refund.',
    'Explain replacement options for a damaged strap.',
    'Explain the warranty on this accessory.',
    'Explain how an account can be closed.',
    'Explain the process for deleting personal data.',
    'The meeting audio disappeared from yesterday.',
  ]) assert.equal(reviewedDecision({ question }).escalate, true, question);
  for (const supportKind of ['order_lookup', 'exception_request', 'account_action', 'money', 'privacy']) {
    assert.equal(reviewedDecision({ question: 'Explícame las opciones disponibles.', supportKind }).escalate, true, supportKind);
  }
});
