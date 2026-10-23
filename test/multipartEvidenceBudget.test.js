const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const retrieval = require('../retrieval');
const { parseSearchPlan, groundedSourceLine } = require('../commandcode');
const { evaluationDocsEvidence } = require('../scripts/live-eval');
const { relevantDocs } = require('../docs');
const { storedDocs } = require('../docs');

const parts = [
  { question: 'Capture audio', query: 'microphone audio capture' },
  { question: 'Read the transcript', query: 'conversation transcript reading' },
  { question: 'Recognize the speaker', query: 'personal voice profile setup' },
];
const address = host => new URL(randomUUID(), host).href;

for (const count of [2, 3]) test(`${count}-part joint evidence keeps complementary sources before shared filler`, () => {
  const selected = parts.slice(0, count);
  const docs = Array.from({ length: 8 }, () => ({
    url: address('https://docs.omi.me/'), title: 'General app overview', source: 'docs', chunkIndex: 0,
    body: `General app overview. ${'Background and optional details. '.repeat(65)}`,
  }));
  const help = selected.map(part => ({
    url: address('https://help.omi.me/en/articles/'), title: part.query, source: 'help', chunkIndex: 0,
    body: `${part.query}: use the documented app control. ${'Additional guidance. '.repeat(55)}`,
  }));
  const result = evaluationDocsEvidence(retrieval, 'Explain the app features.', {
    queries: ['general app overview', ...selected.map(part => part.query)], subQuestions: selected,
  }, retrieval.formatEvidence(docs), help);
  for (const page of help) assert.ok(result.slice(0, 6000).includes(page.url), 'every part survives the compact reviewer evidence boundary');
  assert.ok(result.length <= 9000, 'do not grow the shared evidence budget');
  assert.ok((result.match(/^\[S\d+ \|/gm) || []).length <= 8);
});

for (const count of [2, 3]) test(`${count}-part overlapping matches reserve complementary alternatives before generic filler`, () => {
  const selected = [
    { question: 'Archive export', query: 'app archive export official' },
    { question: 'Notification preferences', query: 'app notification preferences official' },
    { question: 'Speaker enrollment', query: 'app speaker enrollment official' },
  ].slice(0, count);
  const shared = {
    url: address('https://help.omi.me/en/articles/'), title: 'App archive export notification preferences speaker enrollment',
    body: 'Archive preferences enrollment overview.', source: 'help', chunkIndex: 0,
  };
  const alternatives = selected.map(part => ({
    url: address('https://help.omi.me/en/articles/'), title: part.question,
    body: `${part.query}: use this documented control.`, source: 'help', chunkIndex: 0,
  }));
  const filler = Array.from({ length: 6 }, () => ({
    url: address('https://docs.omi.me/'), title: 'General app reference guide',
    body: 'General app reference guide and background.', source: 'docs', chunkIndex: 0,
  }));
  const question = 'General app reference guide';
  const rows = retrieval.rankLocalChunks([question, ...selected.map(part => part.query)],
    [...filler, shared, ...alternatives], 8, { customerQuestion: question, subQuestions: selected });
  assert.ok(rows.some(row => row.url === shared.url), 'retain the strongest shared match');
  for (const page of alternatives) assert.ok(rows.some(row => row.url === page.url),
    'a repeated shared match cannot crowd out the next relevant page for a part');
  const evidence = retrieval.formatEvidence(rows);
  assert.ok(evidence.length <= 9000);
  assert.ok(new Set(rows.map(row => row.url)).size <= 4);
});

test('two neutral requirements remain multipart when an older planner omits explicit pairs', () => {
  const plan = parseSearchPlan(JSON.stringify({
    must_answer: ['Choose a language', 'Export notes'], search_queries: [],
  }), 'Help with language and exports.');
  assert.equal(plan.subQuestions.length, 2);
  assert.deepEqual(plan.subQuestions.map(part => part.query), ['Choose a language', 'Export notes']);
});

test('three requested parts can retain three exact retrieved citations without changing ordinary replies', () => {
  const pages = parts.map(part => ({
    url: address('https://help.omi.me/en/articles/'), title: part.query, body: part.query, source: 'help', chunkIndex: 0,
  }));
  const evidence = retrieval.formatEvidence(pages), ids = ['S1', 'S2', 'S3'];
  const multi = groundedSourceLine('Here are the requested steps.', evidence, ids, 'en', { subQuestions: parts });
  for (const page of pages) assert.ok(multi.includes(page.url));
  const ordinary = groundedSourceLine('Here is one step.', evidence, ids);
  assert.equal(pages.filter(page => ordinary.includes(page.url)).length, 2);
});

test('the common evaluation adapter preserves the frozen baseline path without the new runtime export', () => {
  const legacy = { ...retrieval };
  delete legacy.hasMultipleParts;
  const subQuestions = parts.slice(0, 2);
  const rows = subQuestions.map(part => ({
    url: address('https://help.omi.me/en/articles/'), title: part.query, body: part.query, source: 'help', chunkIndex: 0,
  }));
  const docs = '[S1 | Official documentation | authoritative]\nGeneral guide\nhttps://docs.omi.me/\nGeneral background.';
  const options = { queries: subQuestions.map(part => part.query), subQuestions };
  const before = legacy.combineEvidence(docs, legacy.formatEvidence(legacy.rankLocalChunks(
    legacy.supportQueries('Explain the app features.', options.queries), rows, 7,
    { customerQuestion: 'Explain the app features.' },
  )));
  assert.equal(evaluationDocsEvidence(legacy, 'Explain the app features.', options, docs, rows), before);
});

test('short multipart live-docs fetching reserves one page per part within six fetches', async () => {
  const generic = Array.from({ length: 6 }, () => ({ url: address('https://docs.omi.me/'), title: 'General app guide overview' }));
  const specific = parts.map(part => ({ url: address('https://docs.omi.me/'), title: part.query }));
  const pages = [...generic, ...specific];
  const index = pages.map(page => `- [${page.title}](${page.url}): ${page.title}`).join('\n');
  for (const count of [2, 3]) {
    const fetched = [];
    const result = await relevantDocs('General app guide overview', {
      queries: ['general app guide overview'], subQuestions: parts.slice(0, count),
      store: { searchDocPages: async () => [] },
      fetchImpl: async url => {
        if (String(url).endsWith('/llms.txt')) return { ok: true, text: async () => index };
        const page = pages.find(item => item.url === url);
        assert.ok(page, 'only the fixture index may supply page URLs');
        fetched.push(url);
        return { ok: true, text: async () => `${page.title}. Documented app information.` };
      },
    });
    for (const page of specific.slice(0, count)) {
      assert.ok(fetched.includes(page.url), 'every part receives a fetch slot');
      assert.ok(result.includes(page.url), 'every fetched part retains evidence');
    }
    assert.ok(fetched.length <= 6);
    assert.ok(result.length <= 9000);
  }
});

for (const count of [2, 3]) test(`${count}-part required chunks sharing a page precede weaker optional pages`, async () => {
  const requested = [
    { question: 'Choose summary headings', query: 'summary heading template' },
    { question: 'Adjust alert cadence', query: 'alert cadence schedule' },
    { question: 'Rename saved folders', query: 'saved folder rename' },
  ].slice(0, count);
  const shared = address('https://help.omi.me/en/articles/') + '/shared-reference-and-configuration-guide';
  const required = requested.map((part, index) => ({
    url: index < 2 ? shared : address('https://help.omi.me/en/articles/') + '/separate-feature-reference',
    title: 'Documented feature instructions', source: 'help', chunk_index: index, rank: 1,
    body: `${part.query}. Required section ${index + 1}. ${'Detailed documented guidance. '.repeat(60)}`.slice(0, 1700),
  }));
  const optional = requested.map(part => ({
    url: address('https://help.omi.me/en/articles/') + '/supplementary-reference-information',
    title: 'Additional information', source: 'help', chunk_index: 0, rank: 0.5,
    body: `${part.query.split(' ')[0]}. ${'Optional background notes. '.repeat(70)}`.slice(0, 1700),
  }));
  const filler = { url: address('https://docs.omi.me/') + '/workspace-reference-information',
    title: 'General app workspace orientation', source: 'docs', chunk_index: 0, rank: 0.4,
    body: 'General app workspace orientation. ' + 'Other background notes. '.repeat(70) };
  const rows = [...required, ...optional, filler];
  const selected = retrieval.selectSubQuestionEvidence(rows, requested, 8);
  for (const row of required) assert.ok(selected.indexOf(row) < count, 'each distinct best chunk precedes optional diversity');
  const evidence = retrieval.formatEvidence(selected);
  const compact = evidence.slice(0, 6000);
  for (const [index] of requested.entries()) assert.ok(compact.includes(`Required section ${index + 1}.`));
  const actual = await storedDocs('General app workspace orientation', {
    searchDocPages: async (_query, limit, sources = []) => rows.filter(row => !sources.length || sources.includes(row.source)).slice(0, limit),
  }, requested.map(part => part.query), { subQuestions: requested });
  for (const [index] of requested.entries()) assert.ok(actual.slice(0, 6000).includes(`Required section ${index + 1}.`), 'actual stored retrieval keeps every requested section');
  for (const text of [evidence, actual]) {
    assert.ok(text.length <= 9000);
    assert.ok((text.match(/^\[S\d+ \|/gm) || []).length <= 8);
    assert.ok(new Set(text.match(/^https:\/\/[^\s]+$/gm) || []).size <= 4);
  }
});

test('three required sections on one page survive stored and joint multipart evidence', async () => {
  const requested = [
    { question: 'Set a notification sound', query: 'notification sound choice' },
    { question: 'Choose summary headings', query: 'summary heading selection' },
    { question: 'Rename saved folders', query: 'saved folder renaming' },
  ];
  const url = address('https://help.omi.me/en/articles/');
  const rows = requested.map((part, index) => ({ url, title: 'Feature reference', source: 'help',
    chunk_index: index, body: `${part.query}. Required section ${index + 1}.`, rank: 1 }));
  const question = 'Explain the requested app preferences.';
  const options = { queries: requested.map(part => part.query), subQuestions: requested };
  const stored = await storedDocs(question, { searchDocPages: async (_query, _limit, sources = []) =>
    !sources.length || sources.includes('help') ? rows : [] }, options.queries, options);
  const joint = retrieval.jointMultipartEvidence(question, '', rows, options);
  for (const evidence of [stored, joint]) {
    for (const [index] of requested.entries()) assert.ok(evidence.includes(`Required section ${index + 1}.`));
    assert.ok(evidence.length <= 9000);
    assert.ok((evidence.match(/^\[S\d+ \|/gm) || []).length <= 8);
    assert.equal(new Set(evidence.match(/^https:\/\/[^\s]+$/gm) || []).size, 1);
  }
  assert.equal((retrieval.formatEvidence(rows).match(/^\[S\d+ \|/gm) || []).length, 2,
    'ordinary formatting keeps the existing two-chunk-per-page default');
});
