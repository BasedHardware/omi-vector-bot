const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const { supportQueries } = require('../retrieval');

// Separate index caches per scenario without adding a production test switch.
function isolatedDocs() {
  const filename = require.resolve('../docs');
  const instance = new Module(filename, module);
  instance.filename = filename;
  instance.paths = Module._nodeModulePaths(path.dirname(filename));
  instance._compile(fs.readFileSync(filename, 'utf8'), filename);
  return instance.exports;
}

const parts = [
  { question: 'Export a saved note', query: 'saved note archive export' },
  { question: 'Select notification sounds', query: 'notification sound controls' },
  { question: 'Organize session labels', query: 'session label organization' },
];
const question = 'General app workspace orientation';
const plannedQueries = count => [...parts.slice(0, count).map(part => part.query), 'workspace settings reference', 'general navigation guide'];
const pages = [question, ...parts.map(part => part.query)].flatMap((title, group) =>
  Array.from({ length: 5 }, (_, item) => ({
    title, url: `https://docs.omi.me/synthetic-contract/${group}/${item}.md`,
    body: `${title}. Use the documented control.`, source: 'docs', chunk_index: 0, rank: 1,
  })));

async function settleMicrotasks() {
  // Advance async composition, not elapsed time. A serial fetch is still blocked
  // on the explicit gate, so a busy host cannot accidentally make it pass.
  for (let turn = 0; turn < 40; turn++) await Promise.resolve();
}

for (const count of [2, 3]) {
  test(`${count}-part live docs retain six parallel page fetches and the existing page timeout`, async t => {
    const docs = isolatedDocs();
    const planned = plannedQueries(count);
    const timeouts = [];
    t.mock.method(AbortSignal, 'timeout', milliseconds => {
      timeouts.push(milliseconds);
      return new AbortController().signal;
    });
    const started = [];
    let initiallyStarted = 0;
    let indexCalls = 0;
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const pending = docs.relevantDocs(question, {
      store: { searchDocPages: async () => [] },
      queries: planned, subQuestions: parts.slice(0, count),
      fetchImpl: async (url, options) => {
        assert.ok(options.signal instanceof AbortSignal);
        if (String(url).endsWith('/llms.txt')) {
          indexCalls++;
          return { ok: true, text: async () => pages.map(page => `- [${page.title}](${page.url}): ${page.title}`).join('\n') };
        }
        const page = pages.find(item => item.url === url);
        assert.ok(page, 'fetch only pages from the synthetic index');
        started.push(url);
        await gate;
        return { ok: true, text: async () => page.body };
      },
    });
    try {
      await settleMicrotasks();
      assert.equal(indexCalls, 1, 'one index request, separate from the six-page cap');
      initiallyStarted = started.length;
      assert.ok(initiallyStarted > 1 && initiallyStarted <= 6, 'multiple pages start concurrently, never more than six');
      assert.equal(new Set(started).size, initiallyStarted, 'do not fetch a page twice');
      assert.deepEqual(timeouts, Array(initiallyStarted + 1).fill(10_000), 'index and each page keep the existing 10s timeout');
    } finally { release(); }
    const result = await pending;
    assert.ok(result.length > 0);
    assert.ok(result.length <= 9_000);
    assert.equal(started.length, initiallyStarted, 'every selected page was started before any could finish');
    assert.ok(started.length <= 6, 'no later wave of page fetches');
  });

  test(`${count}-part stored docs keep parallel bounded SQL lookups and make no HTTP fetch`, async t => {
    const docs = isolatedDocs();
    const planned = plannedQueries(count);
    const queries = supportQueries(question, planned, { subQuestions: parts.slice(0, count) });
    assert.ok(queries.length <= 5, 'short multipart requests keep the five-query budget');
    const calls = [];
    let httpCalls = 0;
    t.mock.method(globalThis, 'fetch', async () => { httpCalls++; throw new Error('unexpected HTTP request'); });
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const store = { searchDocPages: async (query, limit, sources) => {
      calls.push({ query, limit, sources });
      await gate;
      return sources ? [] : pages.slice(0, limit);
    } };
    const pending = docs.storedDocs(question, store, planned, { subQuestions: parts.slice(0, count) });
    try {
      await settleMicrotasks();
      assert.equal(calls.length, queries.length * 3, 'all SQL searches start before one completes');
      for (const query of queries) assert.deepEqual(calls.filter(call => call.query === query), [
        { query, limit: 12, sources: undefined },
        { query, limit: 5, sources: ['help'] },
        { query, limit: 5, sources: ['github'] },
      ]);
    } finally { release(); }
    const result = await pending;
    assert.ok(result.length > 0);
    assert.equal(httpCalls, 0, 'stored retrieval does not fetch documentation pages');
    assert.ok(result.length <= 9_000);
    assert.ok((result.match(/^\[S\d+ \|/gm) || []).length <= 8);
    const viaRelevant = await docs.relevantDocs(question, { store, queries: planned, subQuestions: parts.slice(0, count) });
    assert.equal(viaRelevant, result);
    assert.equal(httpCalls, 0, 'a nonempty stored result must not start live fallback');
  });
}
