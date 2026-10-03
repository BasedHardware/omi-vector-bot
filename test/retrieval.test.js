const assert = require('node:assert/strict');
const test = require('node:test');
const {
  chunkDocument,
  combineEvidence,
  formatEvidence,
  mergeRanked,
  queryTerms,
  rankLocalChunks,
  sourceAuthority,
  sourceKind,
  supportQueries,
  uniqueQueries,
} = require('../retrieval');

test('long official pages are chunked without dropping the answer near the end', () => {
  const tail = 'Reset the necklace while holding the button on the charger.';
  const chunks = chunkDocument({
    url: 'https://help.omi.me/en/articles/device',
    title: 'Device guide',
    body: `${'Battery background information. '.repeat(120)}\nReset\n${tail}`,
  });
  assert.ok(chunks.length > 1);
  assert.match(chunks.map((chunk) => chunk.body).join('\n'), /holding the button on the charger/);
  assert.equal(chunks[0].source, 'help');
});

test('retrieval labels official sources and separates Feedback from Discord history', () => {
  const text = formatEvidence([
    {
      url: 'https://help.omi.me/en/articles/reset',
      title: 'Reset Omi',
      body: 'Hold the button while placing it on the charger.',
      source: 'help',
    },
    {
      url: 'https://feedback.omi.me/p/google-calender',
      title: 'Google Calendar report',
      body: 'Portal status: In Progress. Customer reports a blocked app.',
      source: 'feedback',
    },
    {
      url: 'https://discord.com/channels/1/2',
      title: 'Community thread',
      body: 'A customer guessed that tapping twice resets it.',
      source: 'discord',
    },
  ]);
  assert.match(text, /Official Help Center \| authoritative/);
  assert.match(
    text,
    /Omi Feedback portal \| issue\/status signal only; customer report is not product documentation/
  );
  assert.match(text, /Discord help history \| corroboration only; not an official fact/);
});

test('combined retrieval results have unique evidence ids', () => {
  const combined = combineEvidence(
    '[S1 | Official documentation | authoritative]\nDocs',
    '[S1 | Official GitHub | authoritative]\nCode\n\n[S2 | Official GitHub | authoritative]\nMore code'
  );
  assert.deepEqual(
    [...combined.matchAll(/\[(S\d+) \|/g)].map((match) => match[1]),
    ['S1', 'S2', 'S3']
  );
});

test('query expansion keeps exact product terms and deduplicates planned searches', () => {
  assert.deepEqual(queryTerms('How do I create an Omi developer API key?'), ['create', 'developer', 'api', 'key']);
  assert.deepEqual(
    uniqueQueries('create api key', ['Create API key', 'developer credentials', 'developer credentials']),
    ['create api key', 'developer credentials']
  );
});

test('voice input without an answer adds the intended chat-delivery vocabulary', () => {
  const queries = supportQueries(
    'The transcription appears after I ask, but nothing answers',
    ['Omi transcription no answer']
  );
  assert.equal(queries[0], 'The transcription appears after I ask, but nothing answers');
  assert.match(queries[1], /chat answer AI message response visible/);
});

test('conversation deletion searches both synced data and phone-local copies', () => {
  const queries = supportQueries(
    'How do I remove past conversations from the app and phone?',
    []
  );
  assert.match(queries.join('\n'), /Offline Sync Manage Storage/);
  assert.match(queries.join('\n'), /phone local synced recording copies/);
});

test('device how-to searches use the official DevKit and power-button terms', () => {
  assert.match(
    supportQueries('Which Omi can record on its own without the phone?').join('\n'),
    /DevKit 2 standalone recording/
  );
  assert.match(
    supportQueries('How do I turn the Omi necklace off?').join('\n'),
    /Power button controls|power button controls/
  );
  assert.match(
    supportQueries('Omi keeps disconnecting from my phone').join('\n'),
    /Bluetooth connection dropping background app battery optimization/
  );
  assert.match(
    supportQueries("My Omi won't pair and the app keeps searching forever").join('\n'),
    /Omi is on but won’t connect to the app pair from inside/
  );
  assert.match(
    supportQueries("I recorded offline all day and now it's stuck syncing").join('\n'),
    /Local Sync offline recordings keep app open phone nearby/
  );
});

test('rank fusion rewards results recalled by more than one search', () => {
  const shared = { url: 'https://docs.omi.me/api.md', chunk_index: 0, source: 'docs', body: 'API keys' };
  const rows = mergeRanked([
    [shared, { url: 'https://docs.omi.me/other.md', chunk_index: 0, source: 'docs' }],
    [shared, { url: 'https://help.omi.me/en/articles/other', chunk_index: 0, source: 'help' }],
  ]);
  assert.equal(rows[0].url, shared.url);
});

test('retrieval keeps one large file from crowding every other source out', () => {
  const repeated = Array.from({ length: 8 }, (_, index) => ({
    url: 'https://github.com/BasedHardware/omi/blob/main/app/lib/services/notifications.dart',
    chunk_index: index,
    title: 'Notifications',
    body: 'voice question response chat',
    source: 'github',
  }));
  const complementary = {
    url: 'https://github.com/BasedHardware/omi/blob/main/app/lib/providers/message_provider.dart',
    chunk_index: 0,
    title: 'Message provider',
    body: 'voice question response chat',
    source: 'github',
  };
  const rows = rankLocalChunks(['voice question response chat'], [...repeated, complementary], 8);
  assert.ok(rows.some((row) => row.url.includes('message_provider')));
  assert.equal(rows.filter((row) => row.url.includes('notifications.dart')).length, 2);
  assert.equal(rows[1].url.includes('notifications.dart'), false);
  assert.equal(new Set(rows.map((row) => row.chunk_index)).size > 1, true);
});

test('Omi necklace questions do not borrow device-specific Limitless advice', () => {
  const rows = [
    { url: 'https://help.omi.me/en/articles/limitless', title: 'FAQ – Using Your Limitless Pendant with Omi', body: 'Omi keeps disconnecting from my phone. Keep it nearby.' },
    { url: 'https://help.omi.me/en/articles/necklace', title: 'Omi necklace issues', body: 'Keep your phone nearby when Omi disconnects.' },
  ];
  assert.deepEqual(
    rankLocalChunks(['Omi keeps disconnecting from my phone'], rows, 2).map((row) => row.url),
    ['https://help.omi.me/en/articles/necklace']
  );
  assert.deepEqual(
    rankLocalChunks(['Omi keeps disconnecting from my phone', 'Limitless pendant disconnecting'], rows, 2, { customerQuestion: 'Omi keeps disconnecting from my phone' }).map((row) => row.url),
    ['https://help.omi.me/en/articles/necklace']
  );
  assert.ok(rankLocalChunks(['Limitless Pendant keeps disconnecting'], rows, 2).some((row) => row.url.includes('limitless')));
  assert.deepEqual(
    rankLocalChunks(['Omi keeps disconnecting from my phone'], [
      { url: 'https://help.omi.me/en/articles/13068083-faq-using-your-limitless-pendant-with-omi', title: 'https://help.omi.me/en/articles/13068083-faq-using-your-limitless-pendant-with-omi', body: 'Omi disconnects. Keep the app open.' },
      rows[1],
    ], 2).map((row) => row.url),
    ['https://help.omi.me/en/articles/necklace']
  );
});

test('local fallback ranks the chunk containing the specific answer', () => {
  const rows = rankLocalChunks(
    ['conversation timeout silence duration'],
    [
      { url: 'https://docs.omi.me/battery', title: 'Battery', body: 'Battery life and charging.', source: 'docs' },
      {
        url: 'https://help.omi.me/en/articles/settings',
        title: 'Advanced settings',
        body: 'Conversation timeout controls the silence duration under Settings and Profile.',
        source: 'help',
      },
    ]
  );
  assert.match(rows[0].url, /help\.omi\.me/);
});

test('source hierarchy keeps community history below official material', () => {
  assert.equal(sourceKind('https://www.omi.me/products/omi'), 'website');
  assert.equal(sourceKind('https://feedback.omi.me/p/google-calender'), 'feedback');
  assert.ok(sourceAuthority('help') > sourceAuthority('docs'));
  assert.ok(sourceAuthority('website') > sourceAuthority('feedback'));
  assert.ok(sourceAuthority('feedback') > sourceAuthority('discord'));
  assert.ok(sourceAuthority('docs') > sourceAuthority('discord'));
});
