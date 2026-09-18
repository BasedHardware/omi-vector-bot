const { looksLikeStaffLie, stripStaffLies } = require('../honesty');
const { parseAgentJson } = require('../opencode');
const { shouldEscalate, clipForDiscord, clipThreadHistory, escalateReply, sanitizeReply, formatDiscordReply, needsHumanAccess, PINGED_FOOTER } = require('../utils');
const assert = require('node:assert/strict');
const test = require('node:test');

test('staff-lie lines are stripped', () => {
  const out = stripStaffLies(
    'I have spoken to the higher-ups and conveyed your message.\nTry restarting the app.'
  );
  assert.equal(out.includes('higher'), false);
  assert.match(out, /restarting/i);
});

test('passed this along is treated as a staff lie', () => {
  const out = stripStaffLies('For a full deletion that needs a person, so I have passed this along.');
  assert.equal(/passed this along/i.test(out), false);
});

test('pure lie is replaced with an honest fallback', () => {
  const out = stripStaffLies('I have conveyed your issue to the upper team.');
  assert.equal(looksLikeStaffLie(out), false);
  assert.match(out, /have not messaged anyone/i);
});

test('strips invented checkout-email lookup from order replies', () => {
  const out = sanitizeReply(
    [
      "I still can't see order or shipping status from here.",
      "If you have your order number, keep it handy — it's what's needed to look the order up. If you don't, the email address you used at checkout is the other useful thing.",
    ].join('\n\n')
  );
  assert.match(out, /order number, keep it handy/);
  assert.equal(/checkout/i.test(out), false);
  assert.equal(/email address you used/i.test(out), false);
});

test('strips repeating-the-question lecture from order replies', () => {
  const out = sanitizeReply(
    "I can't see orders, tracking, or shipping from here, so I won't guess at a status or a delivery date — and repeating the question won't change what I have access to."
  );
  assert.match(out, /can't see orders/i);
  assert.equal(/repeating the question/i.test(out), false);
});

test('strips nothing-has-changed lecture from order replies', () => {
  const out = sanitizeReply(
    [
      "I can't see order, tracking, or shipping status from here, so I won't guess at where your order is or when it will arrive.",
      'Nothing in what I can access has changed since your last message.',
      'Your order number is the piece that matters for looking this up, so keep it handy if you have it.',
    ].join('\n\n')
  );
  assert.match(out, /can't see order/i);
  assert.match(out, /order number/);
  assert.equal(/has changed since your last/i.test(out), false);
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
  assert.match(german, /LED-Farbe/);
  assert.match(german, /have not pinged anyone yet/i);
});

test('escalate footer only claims a ping after a real handoff', () => {
  const pinged = escalateReply('I have not pinged a human yet.\nThis needs a person.', {
    pinged: true,
  });
  assert.match(pinged, /person on the team has this now/i);
  assert.equal(pinged.includes('I have not pinged'), false);
  assert.equal(pinged.includes(PINGED_FOOTER), true);

  const failed = escalateReply('This needs a person.', { pinged: false });
  assert.match(failed, /have not pinged anyone yet/i);
});

test('does not contradict a real handoff with I cannot ping anyone', () => {
  const live = escalateReply(
    [
      "I can't see orders, tracking, or shipping from here — I have no access to any of that, so I won't guess at a status or a date.",
      "I'm flagging this for a person on the Omi team. That handoff happens on my side after I answer; I'm not able to ping anyone myself, so I won't tell you I did.",
      'If you already have an order confirmation, keep the order number handy — that\'s what a human will need to look it up.',
    ].join('\n\n'),
    { pinged: true }
  );
  assert.match(live, /can't see orders/i);
  assert.match(live, /order number handy/i);
  assert.match(live, /person on the team has this now/i);
  assert.equal(/not able to ping/i.test(live), false);
  assert.equal(/won't tell you i did/i.test(live), false);
  assert.equal(/flagging this/i.test(live), false);
});

test('parses fenced JSON from the model', () => {
  const parsed = parseAgentJson(
    '```json\n{"final_answer":"Press the center button.","confidence":0.9,"escalate":false}\n```'
  );
  assert.equal(parsed.final_answer, 'Press the center button.');
  assert.equal(parsed.confidence, 0.9);
  assert.equal(parsed.escalate, false);
});

test('parseAgentJson survives raw newlines in the model JSON', () => {
  const parsed = parseAgentJson('{"final_answer":"line1\nline2","confidence":0.9,"escalate":true}');
  assert.equal(parsed.escalate, true);
  assert.match(parsed.reason, /json failed/);
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

test('clipThreadHistory drops empty lines and caps length', () => {
  const out = clipThreadHistory(
    [
      { author: 'bot', content: '' },
      { author: 'david', content: 'a'.repeat(800) },
      { author: 'user', content: 'Where is my order?' },
    ],
    40,
    8
  );
  assert.equal(out.length, 2);
  assert.equal(out[0].content.endsWith('…'), true);
  assert.equal(out[1].content, 'Where is my order?');
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
