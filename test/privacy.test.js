const assert = require('node:assert/strict');
const test = require('node:test');
const { redactSensitive } = require('../privacy');

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
