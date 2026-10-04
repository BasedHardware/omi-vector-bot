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
