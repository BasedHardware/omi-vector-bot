const assert = require('node:assert/strict');
const test = require('node:test');
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
