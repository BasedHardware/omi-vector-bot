const { looksLikeStaffLie, stripStaffLies } = require('../honesty');
const { parseAgentJson } = require('../opencode');
const { shouldEscalate, clipForDiscord, escalateReply, sanitizeReply, formatDiscordReply, needsHumanAccess, PINGED_FOOTER } = require('../utils');
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

test('device charging does not keyword-escalate; billed charge does', () => {
  assert.equal(
    shouldEscalate(
      { confidence: 0.99, escalate: false },
      'the LED is orange, the device is charging'
    ),
    false
  );
  assert.equal(
    shouldEscalate({ confidence: 0.99, escalate: false }, 'I was charged twice'),
    true
  );
});

test('order/firmware/tracking need a human; pairing does not', () => {
  assert.equal(needsHumanAccess('where is my order'), true);
  assert.equal(needsHumanAccess('tracking number for order #1234'), true);
  assert.equal(needsHumanAccess('what firmware should I flash'), true);
  assert.equal(needsHumanAccess('in order to pair, I press the button'), false);
  assert.equal(
    shouldEscalate({ confidence: 0.99, escalate: false }, 'where is my order'),
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

test('escalate footer only claims a ping after a real handoff', () => {
  const pinged = escalateReply('I have not pinged a human yet.\nThis needs a person.', {
    pinged: true,
  });
  assert.match(pinged, /sent this to a person/i);
  assert.equal(pinged.includes('I have not pinged'), false);
  assert.equal(pinged.includes(PINGED_FOOTER), true);

  const failed = escalateReply('This needs a person.', { pinged: false });
  assert.match(failed, /have not pinged a human yet/i);
});

test('parses fenced JSON from the model', () => {
  const parsed = parseAgentJson(
    '```json\n{"final_answer":"Press the center button.","confidence":0.9,"escalate":false}\n```'
  );
  assert.equal(parsed.final_answer, 'Press the center button.');
  assert.equal(parsed.confidence, 0.9);
  assert.equal(parsed.escalate, false);
});

test('parses escalate reason from the model', () => {
  const parsed = parseAgentJson(
    '{"final_answer":"A person needs to look up the order.","confidence":0.4,"escalate":true,"reason":"no order access"}'
  );
  assert.equal(parsed.escalate, true);
  assert.equal(parsed.reason, 'no order access');
});

test('sanitizeReply keeps paragraph breaks', () => {
  const out = sanitizeReply('First point.\n\nSecond point.');
  assert.equal(out.includes('\n\n'), true);
  assert.match(out, /First point/);
  assert.match(out, /Second point/);
});

test('formatDiscordReply turns LED pipe lists into bullets', () => {
  const out = formatDiscordReply(
    'LED colours: red = on, disconnected | blue = on, connected | orange = charging, disconnected'
  );
  assert.match(out, /^LED colours:$/m);
  assert.match(out, /^- red = on, disconnected$/m);
  assert.match(out, /^- blue = on, connected$/m);
  assert.match(out, /^- orange = charging, disconnected$/m);
  assert.equal(out.includes(' | '), false);
});
