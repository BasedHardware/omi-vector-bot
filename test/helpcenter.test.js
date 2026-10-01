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
