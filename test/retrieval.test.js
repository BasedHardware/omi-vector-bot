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
  isDeveloperIntent,
  isDeveloperPageCompatibleQuestion,
} = require('../retrieval');
const { pages: developerPages } = require('./fixtures/developer-docs');

test('developer intent is shared across building apps and programmatic data access', () => {
  for (const question of [
    'I want to make my own Omi app that pulls my memories',
    'How can I build a plugin for Omi?',
    'Creating an integration that reads conversations',
    'Can I fetch memories programmatically?',
    'How do I use the Omi API?',
  ]) assert.equal(isDeveloperIntent(question), true, question);
  for (const question of [
    'How do I use an Omi app?',
    'How do I connect my Google Calendar integration?',
    'How do I delete one memory from the app?',
    'my omi light keeps flashing red',
    'how do I update the firmware on my omi?',
    'the build quality feels cheap',
    'Where is the Omi source?',
  ]) assert.equal(isDeveloperIntent(question), false, question);
});

test('broad page compatibility does not grant developer ranking boosts', () => {
  for (const question of [
    'how do I update the firmware on my omi?',
    'does the devkit 2 keep recording when the app is closed',
    'Where is the Omi source?',
  ]) {
    assert.equal(isDeveloperPageCompatibleQuestion(question), true, question);
    assert.equal(isDeveloperIntent(question), false, question);
  }
  const question = 'how do I update the firmware on my omi?';
  const rows = rankLocalChunks([question], [
    { title: 'Firmware update', body: 'Update Omi firmware in the app', source: 'help', url: 'https://help.omi.me/firmware' },
    { title: 'Firmware update', body: 'Update Omi firmware in the app', source: 'docs', url: 'https://docs.omi.me/doc/developer/firmware' },
  ], 2, { customerQuestion: question });
  assert.equal(rows[0].source, 'help');
});

test('an app-builder question ranks developer docs before consumer guides', () => {
  const question = 'I want to make my own Omi app that pulls my memories, where do I start?';
  const rows = rankLocalChunks(supportQueries(question), developerPages, 5, { customerQuestion: question });
  assert.match(rows[0].url, /docs\.omi\.me\/docs\/developer\/apps\/Import/);
  assert.ok(rows.slice(0, 3).every((row) => row.url.startsWith('https://docs.omi.me/')));
});

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

test('device purchase questions also search buying and parts terminology', () => {
  const queries = supportQueries('Which Omi device should I buy for meetings?');
  assert.match(queries.join('\n'), /buying guide.*parts list/i);
});

test('building Omi apps searches the app-development guides as well as API docs', () => {
  const queries = supportQueries('How can I build an Omi app that reads my conversations?');
  assert.match(queries.join('\n'), /building apps.*developer.*conversations/i);
});

test('conversation deletion searches both synced data and phone-local copies', () => {
  const queries = supportQueries(
    'How do I remove past conversations from the app and phone?',
    []
  );
  assert.match(queries.join('\n'), /Offline Sync Manage Storage/);
  assert.match(queries.join('\n'), /phone local synced recording copies/);
});

test('single-item app deletion searches consumer terminology and favors Help Center evidence', () => {
  const question = 'Can I erase a single recording from my list?';
  const queries = supportQueries(question, []);
  assert.equal(queries[0], question);
  assert.match(queries[1], /individual conversation memory recording/);
  const ranked = rankLocalChunks(queries, [
    { url: 'https://www.omi.me/pages/second-memory', title: 'Second memory', body: 'Your Omi memories and recordings.', source: 'website' },
    { url: 'https://help.omi.me/en/articles/manage-conversations', title: 'Conversations and memories', body: 'Delete an individual conversation from the app.', source: 'help' },
  ], 2, { customerQuestion: question });
  assert.match(ranked[0].url, /help\.omi\.me/);
});

test('a Help Center page with individual deletion instructions outranks generic memory marketing', () => {
  const question = 'How do I remove just one memory without clearing the rest?';
  const queries = supportQueries(question, ['Omi memory deletion settings']);
  const ranked = rankLocalChunks(queries, [
    { url: 'https://www.omi.me/pages/second-memory', title: 'Your second memory', body: 'Omi memory stores conversations and recordings in the app.', source: 'website' },
    { url: 'https://help.omi.me/en/articles/manage-data', title: 'Conversations and memories', body: 'Delete: You can delete individual conversations or memories from their detail view.', source: 'help' },
  ], 2, { customerQuestion: question });
  assert.equal(ranked[0].source, 'help');
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
