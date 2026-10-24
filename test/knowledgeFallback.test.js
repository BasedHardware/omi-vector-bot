const assert = require('node:assert/strict');
const test = require('node:test');
const knowledge = require('../knowledge');
const { hashContent } = require('../knowledgeReview');

const guildId = 'synthetic-fallback-guild';
const ordinary = 'The task list contains your follow-up actions.';
const governed = 'The task list shows a reviewed correction.';

function reset(t) {
  knowledge.resetKnowledge();
  t.after(() => knowledge.resetKnowledge());
  knowledge.addSnippet(ordinary);
}

test('a disabled fix inbox uses local staff notes without either registry call', async t => {
  reset(t);
  let calls = 0;
  const store = {
    managedHashes: async () => { calls++; return []; },
    search: async () => { calls++; return []; },
  };
  assert.deepEqual(await knowledge.searchForAnswers('task list', { guildId, store, enabled: false }), [ordinary]);
  assert.equal(calls, 0);
});

test('a registry outage preserves unrelated local staff notes', async t => {
  reset(t);
  const store = { managedHashes: async () => { throw Error('synthetic registry unavailable'); } };
  assert.deepEqual(await knowledge.searchForAnswers('task list', { guildId, store, enabled: true }), [ordinary]);
});

test('a reviewed search outage keeps local notes except newly observed governed hashes', async t => {
  reset(t);
  knowledge.addSnippet(governed);
  const store = {
    managedHashes: async () => [hashContent(governed)],
    search: async () => { throw Error('synthetic reviewed search unavailable'); },
  };
  assert.deepEqual(await knowledge.searchForAnswers('task list', { guildId, store, enabled: true }), [ordinary]);
});

test('known governed hashes remain suppressed through a later outage and switch-off', async t => {
  reset(t);
  knowledge.addSnippet(governed);
  let failing = false, calls = 0;
  const store = {
    managedHashes: async () => {
      calls++;
      if (failing) throw Error('synthetic registry unavailable');
      return [hashContent(governed)];
    },
    search: async () => [],
  };
  const options = { guildId, store, enabled: true };
  assert.deepEqual(await knowledge.searchForAnswers('task list', options), [ordinary]);
  failing = true;
  assert.deepEqual(await knowledge.searchForAnswers('task list', options), [ordinary]);
  const before = calls;
  assert.deepEqual(await knowledge.searchForAnswers('task list', { ...options, enabled: false }), [ordinary]);
  assert.equal(calls, before, 'switch-off does not add a database dependency');
});

test('known governance suppression is scoped to the guild that observed it', async t => {
  reset(t);
  knowledge.addSnippet(governed);
  await knowledge.searchForAnswers('task list', {
    guildId, enabled: true,
    store: { managedHashes: async () => [hashContent(governed)], search: async () => [] },
  });
  const store = { managedHashes: async () => { throw Error('synthetic registry unavailable'); } };
  assert.deepEqual(await knowledge.searchForAnswers('task list', {
    guildId: 'synthetic-other-guild', store, enabled: true,
  }), [governed, ordinary]);
});

test('off at cold start preserves legacy behavior without discovering remote governance', async t => {
  reset(t);
  knowledge.addSnippet(governed);
  const store = {
    managedHashes: async () => { throw Error('must not inspect remote state while off'); },
    search: async () => { throw Error('must not retrieve reviewed facts while off'); },
  };
  assert.deepEqual(await knowledge.searchForAnswers('task list', { guildId, store, enabled: false }), [governed, ordinary]);
});
