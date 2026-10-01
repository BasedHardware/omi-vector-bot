const assert = require('node:assert/strict');
const test = require('node:test');
const {
  chunkDocument,
  formatEvidence,
  mergeRanked,
  queryTerms,
  rankLocalChunks,
  sourceAuthority,
  sourceKind,
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

test('retrieval labels official sources and marks Discord as corroboration only', () => {
  const text = formatEvidence([
    {
      url: 'https://help.omi.me/en/articles/reset',
      title: 'Reset Omi',
      body: 'Hold the button while placing it on the charger.',
      source: 'help',
    },
    {
      url: 'https://discord.com/channels/1/2',
      title: 'Community thread',
      body: 'A customer guessed that tapping twice resets it.',
      source: 'discord',
    },
  ]);
  assert.match(text, /Official Help Center \| authoritative/);
  assert.match(text, /Discord help history \| corroboration only; not an official fact/);
});

test('query expansion keeps exact product terms and deduplicates planned searches', () => {
  assert.deepEqual(queryTerms('How do I create an Omi developer API key?'), ['create', 'developer', 'api', 'key']);
  assert.deepEqual(
    uniqueQueries('create api key', ['Create API key', 'developer credentials', 'developer credentials']),
    ['create api key', 'developer credentials']
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
  assert.ok(sourceAuthority('help') > sourceAuthority('docs'));
  assert.ok(sourceAuthority('docs') > sourceAuthority('discord'));
});
