const { looksLikeStaffLie, stripStaffLies } = require('../honesty');
const { parseAgentJson } = require('../opencode');
const { shouldEscalate, clipForDiscord, escalateReply } = require('../utils');
const assert = require('node:assert/strict');
const test = require('node:test');

test('staff-lie lines are stripped', () => {
  const out = stripStaffLies(
    'I have spoken to the higher-ups and conveyed your message.\nTry restarting the app.'
  );
  assert.equal(out.includes('higher'), false);
  assert.match(out, /restarting/i);
});

test('pure lie is replaced with an honest fallback', () => {
  const out = stripStaffLies('I have conveyed your issue to the upper team.');
  assert.equal(looksLikeStaffLie(out), false);
  assert.match(out, /have not messaged anyone/i);
});

test('refund questions escalate without needing the model', () => {
  assert.equal(
    shouldEscalate({ confidence: 0.99, escalate: false }, 'I want a refund'),
    true
  );
});

test('clips Discord replies under the length cap', () => {
  const long = 'a'.repeat(2000);
  const out = clipForDiscord(long, 100);
  assert.equal(out.length, 100);
  assert.equal(out.endsWith('…'), true);
});

test('escalate footer is generic and skipped if the answer already said no ping', () => {
  const withFooter = escalateReply('This needs a person.');
  assert.match(withFooter, /person on the team needs to take this/i);
  assert.equal(withFooter.includes('Refunds'), false);
  assert.equal(withFooter.includes('shipping'), false);

  const german = escalateReply(
    'Ich habe noch niemanden kontaktiert. Bitte halte die LED-Farbe bereit.'
  );
  assert.equal(german.includes('Refunds'), false);
  assert.equal(german.includes('I have not pinged'), false);
});

test('parses fenced JSON from the model', () => {
  const parsed = parseAgentJson(
    '```json\n{"final_answer":"Press the center button.","confidence":0.9,"escalate":false}\n```'
  );
  assert.equal(parsed.final_answer, 'Press the center button.');
  assert.equal(parsed.confidence, 0.9);
  assert.equal(parsed.escalate, false);
});
