const assert = require('node:assert/strict');
const test = require('node:test');
const { selectReviewedAnswer, reviewWithSecondLook } = require('../reviewDecision');
const { rememberRemovalAudit } = require('../answerFilterAudit');
const { reviewRejectionReply } = require('../supportReplyCopy');

const question = 'Where is the documentation for repeating reminders?';
const reviewed = extra => ({ final_answer: 'Open the reminder guide.', grounded: true,
  relevant: true, confidence: 0.8, escalate: false, ...extra });
const choose = extra => selectReviewedAnswer({ question, route: { lane: 'faq' },
  agent: { final_answer: 'An earlier draft.', confidence: 0.9, escalate: true },
  checked: reviewed(), ...extra });

test('shared selection clears only the existing approved FAQ exceptions without mutating inputs', () => {
  const agent = Object.freeze({ final_answer: 'An earlier draft.', confidence: 0.9, escalate: true, reason: 'Draft reason.' });
  const checked = Object.freeze(reviewed());
  const result = choose({ agent, checked });
  assert.equal(result.approved, true);
  assert.equal(result.agent.escalate, false);
  assert.equal(result.agent.final_answer, checked.final_answer);
  assert.equal(result.agent.confidence, 0.8);
  assert.equal(result.agent.reason, 'Draft reason.');
  assert.equal(agent.escalate, true);
  for (const route of [{ lane: 'tech' }, { lane: 'faq', wantHuman: true }, { lane: 'faq', escalate: true }]) {
    assert.equal(choose({ route }).agent.escalate, true);
  }
  assert.equal(choose({ question: 'Explain repeating reminders.' }).agent.escalate, true);
});

test('an approved unresolved-point handoff survives FAQ reset while a useful clarification stays ordinary', () => {
  const handoff = choose({ checked: reviewed({ final_answer: 'The guides disagree about this option.', escalate: true }) });
  assert.equal(handoff.approved, true);
  assert.equal(handoff.agent.escalate, true);
  assert.equal(handoff.agent.reason, 'The answer was not fully supported by official pages.');
  const clarification = choose({ checked: reviewed({ final_answer: 'Which app version is installed?' }) });
  assert.equal(clarification.agent.escalate, false);
  assert.match(clarification.agent.final_answer, /Which app version/);
});

test('unapproved and audited safe-handoff output cannot escape the localized rejection path', () => {
  const unsafe = reviewed({ grounded: false, relevant: false, safeHandoff: true,
    final_answer: 'I have told an engineer.' });
  rememberRemovalAudit(unsafe, { removed: ['I have told an engineer.'], truncated: false });
  const result = choose({ checked: unsafe, language: 'fr' });
  assert.equal(result.approved, false);
  assert.equal(result.agent.escalate, true);
  assert.equal(result.agent.final_answer, reviewRejectionReply('fr', question));
  const safe = reviewed({ grounded: false, relevant: false, safeHandoff: true,
    final_answer: 'A person needs to check the unsupported option.' });
  assert.equal(choose({ checked: safe }).agent.final_answer, safe.final_answer);
  assert.equal(choose({ checked: safe }).agent.escalate, true);
  assert.equal(choose({ checked: undefined }).agent.escalate, true);
  assert.equal(choose({ checked: undefined }).agent.confidence, 0.4);
});

test('existing second-look selection preserves the repaired escalation and makes at most two reviews', async () => {
  let calls = 0;
  const checked = await reviewWithSecondLook({ question }, { log: () => {}, review: async () => {
    calls++;
    return reviewed(calls === 1 ? { relevant: false } : { escalate: true });
  } });
  assert.equal(calls, 2);
  assert.equal(choose({ checked }).agent.escalate, true);
});
