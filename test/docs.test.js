const assert = require('node:assert/strict');
const test = require('node:test');
const { relevantDocs } = require('../docs');

test('a recording question pulls the matching docs page', async () => {
  const fetched = [];
  const text = await relevantDocs('How long does the Omi battery last while recording?', {
    fetchImpl: async (url) => {
      fetched.push(String(url));
      if (String(url).endsWith('/llms.txt')) {
        return {
          ok: true,
          text: async () =>
            '- [Omi Setup](https://docs.omi.me/onboarding/omi.md): battery and recording\n- [Privacy](https://docs.omi.me/doc/info/Privacy.md): privacy',
        };
      }
      return {
        ok: true,
        text: async () => '# Omi Setup\n\nBattery life is 24 hours to a few days. Leave the app in the background.',
      };
    },
  });
  assert.match(fetched[1], /onboarding\/omi\.md/);
  assert.match(text, /24 hours/);
  assert.match(text, /docs\.omi\.me\/onboarding\/omi\.md/);
});

test('a docs lookup that fails leaves the answer path alone', async () => {
  const text = await relevantDocs('How do I pair my Omi?', {
    fetchImpl: async () => {
      throw new Error('unexpected fetch');
    },
  });
  assert.equal(text, '');
});
