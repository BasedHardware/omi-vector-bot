const assert = require('node:assert/strict');
const test = require('node:test');
const { issueBody } = require('../github');
const { redactSensitive } = require('../privacy');

test('provider-only official email exception does not weaken public issue redaction', () => {
  const input = 'Email: help@omi.me; team@basedhardware.com; press@news.omi.me; user@notomi.me';
  assert.doesNotMatch(redactSensitive(input, { issue: true }), /help@omi\.me|team@basedhardware\.com/);
  const provider = redactSensitive(input, { issue: true, preserveOfficialEmails: true });
  assert.match(provider, /help@omi\.me/);
  assert.match(provider, /team@basedhardware\.com/);
  assert.match(provider, /press@news\.omi\.me/);
  assert.doesNotMatch(provider, /user@notomi\.me/);
});

test('public issue redaction covers international contacts, addresses, identifiers and secrets', () => {
  const input = [
    'Reach @DorkKnight or <@123456789012345678> at ada@example.com.',
    'Call +44 7700 900123 or +91 98765 43210.',
    'Ship to Flat 2B, 12 Rue de Paris, 97400 Saint-Denis.',
    'Order #22777, ticket #138637367, key sk-abcdefgh12345678.',
    'Photo https://cdn.discordapp.com/attachments/1/2/photo.jpg',
  ].join('\n');
  const out = redactSensitive(input, { issue: true });
  for (const value of ['DorkKnight', '123456789012345678', 'ada@example.com', '7700 900123', '98765 43210', 'Rue de Paris', 'Saint-Denis', '22777', '138637367', 'abcdefgh12345678', 'photo.jpg']) {
    assert.equal(out.includes(value), false, value);
  }
  assert.match(out, /\[phone\]/);
  assert.match(out, /\[address\]/);
  assert.match(out, /\[order number\]/);
  assert.match(out, /\[token\]/);
});

test('phone redaction preserves dates, times, versions and build identifiers', () => {
  const input = '2026-10-03 12:30:45 build 2026100312 version 1.0.552 (1246)';
  assert.equal(redactSensitive(input, { issue: true }), input);
});

test('phone redaction catches explicit phone context and common groupings', () => {
  const input = 'Call +44 7700 900123; phone: 4155550199; WhatsApp 98765 43210; tel (415) 555-0199.';
  const out = redactSensitive(input, { issue: true });
  assert.doesNotMatch(out, /7700 900123|4155550199|98765 43210|555-0199/);
  assert.equal((out.match(/\[phone\]/g) || []).length, 4);
});

test('provider redaction keeps support placeholders while removing short international numbers and provider-style tokens', () => {
  const out = redactSensitive('phone: 612 345 678; Order ID: 22777; API key user_123456789012345678901234', { issue: true });
  assert.doesNotMatch(out, /612 345 678|22777|user_123456789012345678901234/);
  assert.match(out, /\[phone\].*\[order number\].*\[token\]/);
});

test('public repository issue numbers survive while customer ticket numbers do not', () => {
  const out = redactSensitive('GitHub issue #20172; support ticket #138637367; Order #18063', { issue: true });
  assert.match(out, /GitHub issue #20172/);
  assert.doesNotMatch(out, /138637367|18063/);
});

test('phone redaction catches a number introduced in ordinary words', () => {
  const lines = [
    'Phone number: 9876543210',
    'My phone number is 9876543210, please call.',
    'My phone is 4155550199',
    'call me on 9876543210',
    'Mobile 4155550199',
    'cell: 4155550199',
    'contact number 4155550199',
    'tel. 020 7946 0958',
    'Ph no: 9876543210',
    'my number is 9876543210',
    'Teléfono: 612345678',
  ];
  for (const line of lines) {
    const out = redactSensitive(line, { issue: true });
    assert.match(out, /\[phone\]/, line);
    assert.doesNotMatch(out, /\d{4}/, line);
  }
});

test('a phone word in the sentence does not turn builds and serials into phone numbers', () => {
  const kept = 'On my phone the app is build 2026100312. Serial number is 0123456789012.';
  assert.equal(redactSensitive(kept, { issue: true }), kept);
});

test('a phone number written into a bug report stays out of the public issue', () => {
  const body = issueBody({
    quote: 'The app crashes when I open Memories. Phone number: 9876543210 if you need to reach me.',
  });
  assert.doesNotMatch(body, /9876543210/);
  assert.ok(body.includes('The app crashes when I open Memories. Phone number: [phone] if you need to reach me.'));
});
