const assert = require('node:assert/strict');
const test = require('node:test');
const { relevantDocs, storedDocs, topPages } = require('../docs');
const { pages: developerPages, store: developerStore } = require('./fixtures/developer-docs');

test('app-building questions keep API pages and prioritize them through stored retrieval', async () => {
  const question = 'I want to make my own Omi app that pulls my memories, where do I start?';
  const apiPage = developerPages.find((page) => page.url.includes('/api-reference/'));
  assert.ok(topPages(question, [{ ...apiPage, blurb: 'Build your own Omi app to read memories' }], 1).length);
  const evidence = await relevantDocs(question, {
    store: developerStore(),
    fetchImpl: async () => { throw new Error('the stored path should answer'); },
  });
  const urls = [...evidence.matchAll(/^\[S\d+[^\n]*\n[^\n]*\n(https:\/\/[^\s]+)/gm)]
    .map((match) => match[1]);
  assert.match(urls[0], /docs\.omi\.me\/docs\/developer\/apps\/Import/);
  assert.ok(urls.slice(0, 3).every((url) => url.startsWith('https://docs.omi.me/')));
  assert.ok(urls.some((url) => url.includes('/api-reference/api-keys/create-api-key')));
  assert.ok(urls.some((url) => url.startsWith('https://help.omi.me/')));
});

test('developer and hardware questions retain their pages despite app-related planner searches', async () => {
  const cases = [
    ['how do I build an app for omi that reads my conversations', 'https://docs.omi.me/doc/developer/apps/PromptBased.md'],
    ['does the devkit 2 keep recording when the app is closed', 'https://docs.omi.me/doc/hardware/DevKit2.md'],
    ['how do I flash new firmware to my devkit, the app update fails', 'https://docs.omi.me/doc/get_started/Flash_device.md'],
    ['which omi should I buy if I mostly want the app to record meetings', 'https://docs.omi.me/doc/assembly/Buying_Guide.md'],
  ];
  for (const [question, url] of cases) {
    const page = { title: question, url, blurb: question, body: question, source: 'docs', chunk_index: 0, rank: 1 };
    assert.equal(topPages(question, [page], 1, `${question} Omi app guide`)[0]?.url, url, question);
    const evidence = await storedDocs(question, {
      searchDocPages: async (_query, _limit, sources = []) => sources.length ? [] : [page],
    }, ['Omi app conversations recording']);
    assert.ok(evidence.includes(url), question);
  }
});

test('single-item in-app deletion keeps Help Center and excludes developer pages', async () => {
  for (const question of [
    'How do I remove just one memory without clearing the rest?',
    'Can I erase a single recording from my list?',
  ]) {
    const developer = { title: 'Delete memory in developer app', url: 'https://docs.omi.me/doc/developer/memory-clients.md', blurb: question, body: question, source: 'docs', chunk_index: 0, rank: 1 };
    const help = { title: 'Conversations and memories', url: 'https://help.omi.me/en/articles/conversations', blurb: question, body: 'You can delete individual conversations or memories from their detail view.', source: 'help', chunk_index: 0, rank: 0.5 };
    assert.deepEqual(topPages(question, [developer], 1), [], question);
    const evidence = await storedDocs(question, {
      searchDocPages: async (_query, _limit, sources = []) => sources.includes('github') ? [] : [developer, help],
    }, ['Omi app delete one item']);
    assert.match(evidence, /Conversations and memories/, question);
    assert.doesNotMatch(evidence, /memory-clients\.md/, question);
  }
});

test('planner wording cannot turn an ambiguous consumer question into API documentation', async () => {
  const text = await storedDocs('How do I make one?', {
    searchDocPages: async () => [{
      title: 'Create API key', url: 'https://docs.omi.me/api-reference/api-keys/create-api-key',
      body: 'Create an API key.', source: 'docs', chunk_index: 0, rank: 1,
    }],
  }, ['Omi developer API key']);
  assert.equal(text, '');
});

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

test('explicit developer questions retrieve source-labeled API evidence', async () => {
  const searches = [];
  const text = await relevantDocs('How do I make a developer API key?', {
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
