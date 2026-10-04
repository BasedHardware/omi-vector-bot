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
