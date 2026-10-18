const assert = require('node:assert/strict');
const test = require('node:test');
const knowledge = require('../knowledge');
const { createHash } = require('node:crypto');
const { hashContent } = require('../knowledgeReview');

const DAY = 86_400_000;
const guildId = 'synthetic-guild';
const actorId = 'synthetic-reviewer';
const content = 'The task list shows action items from conversations.';
const source = 'https://help.omi.me/en/articles/synthetic-task-list';

function fixtureProof(row) {
  return { ok: true, digest: row.digest, reviewApproved: true,
    regression: { passed: true, questionHash: hashContent(row.regressionQuestion) },
    evidence: row.sources.map(url => ({ url, sha256: createHash('sha256').update(`Synthetic public source ${url}`).digest('hex'), checkedAt: row.approvedAt })) };
}

function fixture(options = {}) {
  assert.equal(typeof knowledge.createReviewService, 'function');
  const store = options.store || knowledge.createReviewedMemoryStore();
  let timestamp = 1_800_000_000_000, enabled = true;
  const service = knowledge.createReviewService({
    store, allowedStaffIds: () => [actorId], enabled: () => enabled, now: () => timestamp,
    validate: async draft => fixtureProof(draft),
    ...options,
  });
  return { service, store, disable: () => { enabled = false; }, advance: ms => { timestamp += ms; } };
}

function draft(overrides = {}) {
  return { guildId, factId: 'synthetic-task-fact', expectedVersion: 0, content,
    sources: [source], productVersion: 'Omi app; reviewed synthetic fixture',
    regressionQuestion: 'Where are action items shown in the app?',
    provenance: [{ caseId: 'synthetic-case', expiresAt: 1_800_000_000_000 + 30 * DAY }], ...overrides };
}

async function publish(f, overrides = {}) {
  const created = await f.service.propose(draft(overrides), actorId);
  assert.equal(created.ok, true);
  const approved = await f.service.approve({ guildId, factId: created.factId, version: created.version }, actorId);
  assert.equal(approved.ok, true);
  return created;
}

test('reviewed corrections are off by default and never publish without a configured validator', async () => {
  const store = knowledge.createReviewedMemoryStore?.();
  assert.ok(store);
  const off = knowledge.createReviewService({ store, allowedStaffIds: () => [actorId] });
  assert.deepEqual(await off.propose(draft(), actorId), { ok: false, reason: 'disabled' });
  const f = fixture({ validate: undefined });
  await f.service.propose(draft(), actorId);
  assert.equal((await f.service.approve({ guildId, factId: draft().factId, version: 1 }, actorId)).reason, 'validation_unavailable');
  assert.deepEqual(await f.service.search(guildId, 'task list'), []);
});

test('named-staff approval, bound validation and restart make a fact eligible in the existing knowledge service', async () => {
  const f = fixture();
  await publish(f);
  const restarted = fixture({ store: f.store });
  const rows = await restarted.service.search(guildId, 'task list');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].content, content);
  assert.equal(rows[0].approvedBy, actorId);
  assert.equal(rows[0].recheckAt - rows[0].approvedAt, 90 * DAY);
  assert.deepEqual(rows[0].sources, [source]);
  assert.deepEqual(await restarted.service.search('another-guild', 'task list'), []);
});

test('customers, roles and input approval flags cannot grant publication', async () => {
  const f = fixture();
  assert.equal((await f.service.propose(draft(), 'customer')).reason, 'unauthorized');
  await f.service.propose(draft(), actorId);
  const result = await f.service.approve({ guildId, factId: draft().factId, version: 1, approved: true }, 'customer');
  assert.equal(result.reason, 'unauthorized');
  assert.deepEqual(await f.service.search(guildId, 'task list'), []);
});

test('correction drafts require bounded official evidence and reject private intake or fake source hosts', async () => {
  const f = fixture();
  for (const overrides of [
    { sources: [] }, { sources: ['https://help.omi.me.example.test/article'] },
    { sources: ['https://github.com/BasedHardware/omi/issues/123'] },
    { sources: ['https://feedback.omi.me/p/task-list'] },
    { content: 'Contact fixture@example.test to see the task list.' },
    { content: 'My order number is 12345.' }, { content: 'A'.repeat(501) },
    { regressionQuestion: '' }, { productVersion: '' },
    { provenance: [{ caseId: 'synthetic-case', customerText: 'Do not store this.' }] },
  ]) assert.equal((await f.service.propose(draft(overrides), actorId)).ok, false);
});

test('failed or unbound validation never publishes a reviewed draft', async () => {
  for (const validate of [async () => ({ ok: false }), async () => ({ ok: true, digest: 'different' }),
    async () => { throw new Error('private provider details must not be logged'); }]) {
    const f = fixture({ validate });
    await f.service.propose(draft(), actorId);
    const result = await f.service.approve({ guildId, factId: draft().factId, version: 1 }, actorId);
    assert.equal(result.ok, false);
    assert.deepEqual(await f.service.search(guildId, 'task list'), []);
  }
});

test('double approval validates once and stale edits cannot replace the working published version', async () => {
  let calls = 0;
  const f = fixture({ validate: async row => { calls++; return fixtureProof(row); } });
  await f.service.propose(draft(), actorId);
  const action = { guildId, factId: draft().factId, version: 1 };
  const results = await Promise.all([f.service.approve(action, actorId), f.service.approve(action, actorId)]);
  assert.equal(results.filter(row => row.ok).length, 1);
  assert.equal(calls, 1);
  assert.equal((await f.service.propose(draft(), actorId)).reason, 'stale');
  const edit = await f.service.propose(draft({ expectedVersion: 1, content: 'The task list includes follow-up actions.' }), actorId);
  assert.equal(edit.version, 2);
  assert.equal((await f.service.search(guildId, 'task list'))[0].content, content);
});

test('revocation wins over in-flight validation and survives a new service instance', async () => {
  let finish, entered;
  const started = new Promise(resolve => { entered = resolve; });
  const waiting = new Promise(resolve => { finish = resolve; });
  const f = fixture({ validate: async row => { entered(); await waiting; return fixtureProof(row); } });
  await f.service.propose(draft(), actorId);
  const action = { guildId, factId: draft().factId, version: 1 };
  const accepting = f.service.approve(action, actorId);
  await started;
  assert.equal((await f.service.revoke(action, actorId)).ok, true);
  finish();
  assert.equal((await accepting).ok, false);
  assert.deepEqual(await fixture({ store: f.store }).service.search(guildId, 'task list'), []);
});

test('expiry, rejection and the kill switch cannot silently reactivate an older correction', async () => {
  const f = fixture();
  await publish(f);
  f.advance(90 * DAY);
  assert.deepEqual(await f.service.search(guildId, 'task list'), []);
  const edit = await f.service.propose(draft({ expectedVersion: 1, provenance: [] }), actorId);
  assert.equal((await f.service.reject({ guildId, factId: edit.factId, version: edit.version }, actorId)).ok, true);
  assert.equal((await f.service.approve({ guildId, factId: edit.factId, version: edit.version }, actorId)).ok, false);
  f.disable();
  assert.deepEqual(await f.service.search(guildId, 'task list'), []);
  assert.equal((await f.service.revoke({ guildId, factId: edit.factId, version: edit.version }, actorId)).ok, true);
});

test('a validation timeout or disabling during approval prevents late publication', async () => {
  const slow = fixture({ validationBudgetMs: 5, validate: () => new Promise(() => {}) });
  await slow.service.propose(draft(), actorId);
  assert.equal((await slow.service.approve({ guildId, factId: draft().factId, version: 1 }, actorId)).reason, 'validation_failed');
  let finish, entered;
  const started = new Promise(resolve => { entered = resolve; });
  const waiting = new Promise(resolve => { finish = resolve; });
  const f = fixture({ validate: async row => { entered(); await waiting; return fixtureProof(row); } });
  await f.service.propose(draft(), actorId);
  const operation = f.service.approve({ guildId, factId: draft().factId, version: 1 }, actorId);
  await started; f.disable(); finish();
  assert.equal((await operation).ok, false);
  assert.deepEqual(await f.service.search(guildId, 'task list'), []);
});

test('normal lookup blocks governed legacy copies after revoke and fails closed on registry outage', async () => {
  knowledge.resetKnowledge();
  const f = fixture();
  await publish(f);
  knowledge.addSnippet(content);
  const action = { guildId, factId: draft().factId, version: 1 };
  await f.service.revoke(action, actorId);
  assert.deepEqual(await knowledge.searchForAnswers('task list', { guildId, store: f.store, enabled: true }), []);
  assert.deepEqual(await knowledge.searchForAnswers('task list', { guildId, store: f.store, enabled: false }), []);
  const broken = { managedHashes: async () => { throw new Error('registry offline'); } };
  assert.deepEqual(await knowledge.searchForAnswers('task list', { guildId, store: broken, enabled: true }), []);
  knowledge.resetKnowledge();
});

test('normal lookup uses eligible reviewed facts but never unprovenanced database notes', async () => {
  knowledge.resetKnowledge();
  const f = fixture();
  await publish(f);
  const rows = await knowledge.searchForAnswers('task list', { guildId, store: f.store, enabled: true, now: 1_800_000_000_000 });
  assert.match(rows[0], /task list shows action items/);
  assert.match(rows[0], /help\.omi\.me/);
  assert.doesNotMatch(rows[0], /synthetic-case|synthetic-reviewer/);
  assert.deepEqual(await knowledge.searchForAnswers('task list', { guildId, store: f.store, enabled: false }), []);
});

test('internal provenance expires and can be erased without altering the sourced public fact', async () => {
  const f = fixture();
  await publish(f);
  await f.service.eraseProvenance(guildId, ['synthetic-case']);
  assert.deepEqual((await f.service.inspect({ guildId, factId: draft().factId }, actorId)).versions[0].provenance, []);
  assert.equal((await f.service.search(guildId, 'task list')).length, 1);
  const second = fixture();
  await publish(second); second.advance(30 * DAY);
  await second.service.pruneProvenance(guildId);
  assert.deepEqual((await second.service.inspect({ guildId, factId: draft().factId }, actorId)).versions[0].provenance, []);
});

test('an unpublished draft does not hide an existing staff note before validation passes', async () => {
  knowledge.resetKnowledge();
  const f = fixture();
  knowledge.addSnippet(content);
  await f.service.propose(draft(), actorId);
  const rows = await knowledge.searchForAnswers('task list', { guildId, store: f.store, enabled: true });
  assert.deepEqual(rows, [content]);
  knowledge.resetKnowledge();
});

test('switching off while a draft waits for its store lock prevents a late write', async () => {
  const f = fixture();
  const original = f.store.mutate;
  let finish, entered;
  const started = new Promise(resolve => { entered = resolve; });
  const waiting = new Promise(resolve => { finish = resolve; });
  f.store.mutate = async (...args) => { entered(); await waiting; return original(...args); };
  const operation = f.service.propose(draft(), actorId);
  await started; f.disable(); finish();
  assert.equal((await operation).ok, false);
  assert.equal(await f.store.read(draft()), null);
});

test('erasure suppresses provenance on a draft queued before the deletion request', async () => {
  const f = fixture();
  const original = f.store.mutate;
  let finish, entered;
  const started = new Promise(resolve => { entered = resolve; });
  const waiting = new Promise(resolve => { finish = resolve; });
  let delayed = true;
  f.store.mutate = async (...args) => {
    if (delayed) { delayed = false; entered(); await waiting; }
    return original(...args);
  };
  const operation = f.service.propose(draft(), actorId);
  await started;
  await f.service.eraseProvenance(guildId, ['synthetic-case']);
  finish(); assert.equal((await operation).ok, true);
  assert.deepEqual((await f.store.read(draft())).versions[0].provenance, []);
});

test('expiry cleanup is bounded but repeating it cannot starve older provenance', async () => {
  const f = fixture();
  for (let index = 0; index < 101; index++) await f.service.propose(draft({ factId: `synthetic-${String(index).padStart(3, '0')}` }), actorId);
  f.advance(30 * DAY);
  const first = await f.service.pruneProvenance(guildId);
  assert.deepEqual(first, { processed: 100, remaining: true });
  const second = await f.service.pruneProvenance(guildId);
  assert.deepEqual(second, { processed: 1, remaining: false });
});

test('rollback is a fresh reviewed version, never automatic reactivation of an old approval', async () => {
  let validations = 0;
  const f = fixture({ validate: async row => { validations++; return fixtureProof(row); } });
  await publish(f);
  const changed = await f.service.propose(draft({ expectedVersion: 1, content: 'The task list includes suggested next actions.' }), actorId);
  await f.service.approve({ guildId, factId: changed.factId, version: 2 }, actorId);
  await f.service.revoke({ guildId, factId: changed.factId, version: 2 }, actorId);
  const restored = await f.service.propose(draft({ expectedVersion: 2 }), actorId);
  assert.deepEqual(await f.service.search(guildId, 'task list'), []);
  assert.equal(restored.version, 3);
  await f.service.approve({ guildId, factId: restored.factId, version: 3 }, actorId);
  assert.equal((await f.service.search(guildId, 'task list'))[0].version, 3);
  assert.equal(validations, 3);
});

test('startup faq hydration cannot restore a revoked correction into customer answer lookup', async t => {
  const f = fixture();
  await publish(f);
  await f.service.revoke({ guildId, factId: draft().factId, version: 1 }, actorId);
  knowledge.resetKnowledge();
  const previous = process.env.VECTOR_TEST_CHANNEL_ID;
  process.env.VECTOR_TEST_CHANNEL_ID = 'synthetic-forum';
  t.after(() => {
    knowledge.resetKnowledge();
    if (previous === undefined) delete process.env.VECTOR_TEST_CHANNEL_ID;
    else process.env.VECTOR_TEST_CHANNEL_ID = previous;
  });
  const thread = { id: 'synthetic-handoff', name: 'Handoff · fixture', messages: {
    fetch: async () => new Map([['message', { author: { bot: false, id: actorId }, content: `faq: ${content}` }]]),
  } };
  const client = { channels: { fetch: async () => ({ threads: {
    fetchActive: async () => ({ threads: new Map([[thread.id, thread]]) }),
    fetchArchived: async () => ({ threads: new Map() }),
  } }) } };
  assert.equal(await knowledge.hydrateFromDiscord(client, [actorId]), 1);
  assert.deepEqual(await knowledge.searchForAnswers('task list', { guildId, store: f.store, enabled: true }), []);
});

test('rejection and revocation retain the actual named staff actor and decision time', async () => {
  const f = fixture();
  await f.service.propose(draft(), actorId);
  await f.service.reject({ guildId, factId: draft().factId, version: 1 }, actorId);
  let row = (await f.service.inspect(draft(), actorId)).versions[0];
  assert.equal(row.rejectedBy, actorId);
  assert.equal(row.rejectedAt, 1_800_000_000_000);
  await f.service.revoke({ guildId, factId: draft().factId, version: 1 }, actorId);
  row = (await f.service.inspect(draft(), actorId)).versions[0];
  assert.equal(row.revokedBy, actorId);
  assert.equal(row.revokedAt, 1_800_000_000_000);
});

test('publication requires recorded review, fresh source fingerprints and the bound synthetic regression', async () => {
  for (const alter of [
    row => ({ ok: true, digest: row.digest }),
    row => ({ ...fixtureProof(row), reviewApproved: false }),
    row => ({ ...fixtureProof(row), regression: { passed: false, questionHash: hashContent(row.regressionQuestion) } }),
    row => ({ ...fixtureProof(row), regression: { passed: true, questionHash: hashContent('A different question') } }),
    row => ({ ...fixtureProof(row), evidence: [] }),
    row => ({ ...fixtureProof(row), evidence: [{ ...fixtureProof(row).evidence[0], url: 'https://docs.omi.me/not-the-selected-page' }] }),
    row => ({ ...fixtureProof(row), evidence: [{ ...fixtureProof(row).evidence[0], checkedAt: row.approvedAt + 1 }] }),
    row => ({ ...fixtureProof(row), evidence: [{ ...fixtureProof(row).evidence[0], sha256: 'not-a-fingerprint' }] }),
  ]) {
    const f = fixture({ validate: async row => alter(row) });
    await f.service.propose(draft(), actorId);
    assert.equal((await f.service.approve({ guildId, factId: draft().factId, version: 1 }, actorId)).ok, false);
    assert.deepEqual(await f.service.search(guildId, 'task list'), []);
  }
});

test('stored validation audit contains bounded evidence metadata, never raw validator output', async () => {
  const f = fixture({ validate: async row => ({ ...fixtureProof(row), rawText: 'Synthetic text that must not be retained.' }) });
  await publish(f);
  const row = (await f.service.inspect(draft(), actorId)).versions[0];
  assert.equal(row.validation.digest, row.digest);
  assert.equal(row.validation.reviewApproved, true);
  assert.equal(row.validation.evidence[0].url, source);
  assert.equal(row.validation.regression.questionHash, hashContent(row.regressionQuestion));
  assert.equal(JSON.stringify(row).includes('Synthetic text that must not be retained.'), false);
});

test('content changed after validation is ineligible rather than inheriting an old proof', async () => {
  const f = fixture();
  await publish(f);
  await f.store.mutate(draft(), state => {
    state.versions[0].content = 'The task list now has an unreviewed instruction.';
    return { state, result: true };
  });
  assert.deepEqual(await f.service.search(guildId, 'task list'), []);
});

test('a revoked correction cannot return inside an older faq note with an appended source link', async () => {
  knowledge.resetKnowledge();
  const f = fixture();
  await publish(f);
  await f.service.revoke({ guildId, factId: draft().factId, version: 1 }, actorId);
  knowledge.addSnippet(`${content} Source: ${source}`);
  assert.deepEqual(await knowledge.searchForAnswers('task list', { guildId, store: f.store, enabled: true }), []);
  assert.deepEqual(await knowledge.searchForAnswers('task list', { guildId, store: f.store, enabled: false }), []);
  knowledge.resetKnowledge();
});
