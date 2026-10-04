const assert = require('node:assert/strict');
const test = require('node:test');
const { relevantDocs, topPages } = require('../docs');

test('device controls retrieve the official Omi setup page even when its index blurb omits power-off', () => {
  const setup = { title: 'Omi Setup', url: 'https://docs.omi.me/onboarding/omi', blurb: 'Get started with your Omi device' };
  const unrelated = { title: 'API Setup', url: 'https://docs.omi.me/api/setup', blurb: 'Developer setup' };
  assert.deepEqual(topPages('How do I turn the Omi necklace off?', [unrelated, setup], 2), [setup]);
});

test('consumer necklace questions do not mix in DevKit button instructions', () => {
  const consumer = { title: 'Omi Setup', url: 'https://docs.omi.me/onboarding/omi.md', blurb: 'Get started with your Omi device' };
  const devkit = { title: 'Omi DevKit 2 Setup', url: 'https://docs.omi.me/onboarding/omi-devkit-2.md', blurb: 'Necklace button on and off' };
  assert.deepEqual(topPages('How do I turn my Omi necklace off with the button?', [devkit, consumer], 3), [consumer]);
  assert.deepEqual(topPages('How do I turn my Omi DevKit 2 off with the button?', [devkit, consumer], 3)[0], devkit);
});

test('consumer app searches exclude developer API reference pages', () => {
  const api = { title: 'Delete memory', url: 'https://docs.omi.me/api-reference/memories/delete', blurb: 'Delete a memory by API' };
  const developer = { title: 'Memory client', url: 'https://docs.omi.me/doc/developer/memory-clients.md', blurb: 'Store conversations from an app' };
  const app = { title: 'Manage memories in the app', url: 'https://docs.omi.me/user-guide/memories', blurb: 'Remove a memory in Omi' };
  assert.deepEqual(topPages('How do I remove one memory in the Omi app?', [api, developer, app], 3), [app]);
  assert.deepEqual(topPages('How do I delete a memory with the API?', [api, app], 3)[0], api);
});

test('stored consumer-device results also exclude DevKit instructions', async () => {
  const text = await relevantDocs('How do I turn my Omi necklace off with the button?', {
    fetchImpl: async () => { throw new Error('stored evidence should win'); },
    store: {
      searchDocPages: async (_query, _limit, sources = []) => sources.length ? [] : [
        { title: 'Omi DevKit 2 Setup', url: 'https://docs.omi.me/onboarding/omi-devkit-2.md', body: 'Single press to turn off', source: 'docs', chunk_index: 0, rank: 0.9 },
        { title: 'Omi Setup', url: 'https://docs.omi.me/onboarding/omi.md', body: 'Press and hold for 3 seconds to turn the device off.', source: 'docs', chunk_index: 0, rank: 0.5 },
      ],
    },
  });
  assert.match(text, /hold for 3 seconds/);
  assert.doesNotMatch(text, /DevKit|Single press to turn off/i);
});

test('stored consumer-app results do not crowd out Help Center with API references', async () => {
  const text = await relevantDocs('Can I erase a single recording from my list?', {
    fetchImpl: async () => { throw new Error('stored evidence should win'); },
    store: {
      searchDocPages: async (_query, _limit, sources = []) => sources.includes('github') ? [] : [
        { title: 'Delete recording API', url: 'https://docs.omi.me/api-reference/recordings/delete', body: 'DELETE /recordings/{id}', source: 'docs', chunk_index: 0, rank: 1 },
        { title: 'Conversations and memories', url: 'https://help.omi.me/en/articles/manage-conversations', body: 'Delete an individual conversation in the app.', source: 'help', chunk_index: 0, rank: 0.5 },
      ],
    },
  });
  assert.match(text, /Delete an individual conversation/);
  assert.doesNotMatch(text, /DELETE \/recordings/);
});

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

test('a docs lookup uses the saved page when the site is down', async () => {
  const pages = [
    {
      title: 'Battery',
      url: 'https://docs.omi.me/doc/battery.md',
      body: 'Battery life is 24 hours to a few days.',
    },
  ];
  const text = await relevantDocs('How long is the battery?', {
    fetchImpl: async () => {
      throw new Error('docs down');
    },
    store: {
      searchDocPages: async () => pages,
    },
  });
  assert.match(text, /24 hours/);
  assert.match(text, /docs\.omi\.me\/doc\/battery\.md/);
});

test('planned searches retrieve source-labeled Help Center evidence', async () => {
  const searches = [];
  const text = await relevantDocs('How do I make one?', {
    queries: ['create Omi developer API key', 'developer credentials settings'],
    fetchImpl: async () => {
      throw new Error('stored evidence should win');
    },
    store: {
      searchDocPages: async (query) => {
        searches.push(query);
        if (!/developer|credentials/i.test(query)) return [];
        return [
          {
            title: 'Create API key',
            url: 'https://docs.omi.me/api-reference/api-keys/create-api-key',
            body: 'Get a developer API key from Settings, Developer, Create Key.',
            source: 'docs',
            chunk_index: 0,
            rank: 1,
          },
        ];
      },
    },
  });
  assert.ok(searches.length >= 2);
  assert.match(text, /Official documentation \| authoritative/);
  assert.match(text, /Settings, Developer, Create Key/);
});

test('stored retrieval recalls official source even when generic docs have more keyword hits', async () => {
  const filters = [];
  const text = await relevantDocs('My voice question transcribes but has no answer', {
    fetchImpl: async () => {
      throw new Error('stored evidence should win');
    },
    store: {
      searchDocPages: async (_query, _limit, sources = []) => {
        filters.push(sources);
        if (sources.includes('github')) {
          return [
            {
              title: 'app/lib/services/notifications/chat_answer_notification_handler.dart',
              url: 'https://github.com/BasedHardware/omi/blob/main/app/lib/services/notifications/chat_answer_notification_handler.dart',
              body: 'Foreground chat answers are consumed in the app; background answers use a notification.',
              source: 'github',
              chunk_index: 0,
              rank: 0.4,
            },
          ];
        }
        if (sources.includes('help')) return [];
        return Array.from({ length: 12 }, (_, index) => ({
          title: `Generic developer chat page ${index}`,
          url: `https://docs.omi.me/generic-${index}`,
          body: 'Generic developer chat answer documentation.',
          source: 'docs',
          chunk_index: 0,
          rank: 1,
        }));
      },
    },
  });
  assert.ok(filters.some((sources) => sources.includes('github')));
  assert.match(text, /Foreground chat answers are consumed in the app/);
  assert.match(text, /Official GitHub \| authoritative/);
});
