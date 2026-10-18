const assert = require('node:assert/strict');
const test = require('node:test');
const { articleUrls, htmlToText, redactPublic } = require('../helpcenter');

test('the help center sitemap yields article urls and the page text keeps the reset steps', () => {
  const urls = articleUrls(
    '<loc>https://help.omi.me/en/articles/12847359-omi-device-troubleshooting-guide</loc><loc>https://docs.omi.me/nope</loc>'
  );
  assert.deepEqual(urls, ['https://help.omi.me/en/articles/12847359-omi-device-troubleshooting-guide']);
  const text = htmlToText(
    '<html><article><h1>Reset</h1><p>Press and hold the button while placing it on the charger.</p></article><p>menu junk</p></html>'
  );
  assert.match(text, /Press and hold the button/);
  assert.equal(/menu junk/.test(text), false);
  assert.equal(redactPublic('mail me at taj@example.com'), 'mail me at [email]');
});

test('a stored Discord help message passes the same redaction as a public issue', () => {
  const out = redactPublic([
    'My API key is sk-abcdefgh12345678 and the header was Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc',
    'Order #22777 never arrived.',
    'Ship it to 12 Baker Street, London',
    'Ask @DorkKnight or <@123456789012345678>, or mail ada@example.com',
    'The app shows error 1011 on build 1.0.552.',
  ].join('\n'));
  for (const value of ['abcdefgh', 'eyJhbGci', '22777', 'Baker Street', 'DorkKnight', '123456789012345678', 'ada@example.com']) {
    assert.equal(out.includes(value), false, value);
  }
  assert.match(out, /\[token\]/);
  assert.match(out, /\[order number\]/);
  assert.match(out, /\[address\]/);
  assert.match(out, /\[Discord user\]/);
  assert.match(out, /The app shows error 1011 on build 1\.0\.552\./);
});
