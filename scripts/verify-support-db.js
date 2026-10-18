// Integration fixtures only: never point this script at a customer database.
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const runtime = require('../supportRuntime');
const cases = require('../supportCases');
const cards = require('../caseCards');
const { SupportIdentityStore, initSchema: initIdentity } = require('../supportIdentityStore');
const supportMemory = require('../supportMemory');
const memoryStore = require('../supportMemoryStore');
const { createObserver } = require('../supportLearning');
const knowledge = require('../knowledge');
const reviewedStore = require('../knowledgeReviewStore');

async function isolatedPool() {
  const moduleAt = process.argv.indexOf('--pglite');
  if (moduleAt !== -1) {
    const { PGlite } = require(process.argv[moduleAt + 1]);
    const database = new PGlite();
    let tail = Promise.resolve();
    async function acquire() {
      const previous = tail; let release;
      tail = new Promise((resolve) => { release = resolve; });
      await previous; return release;
    }
    const query = (sql, args) => args?.length ? database.query(sql, args) : database.exec(sql).then((results) => results.at(-1) || { rows: [] });
    return {
      async query(sql, args) { const release = await acquire(); try { return await query(sql, args); } finally { release(); } },
      async connect() { const release = await acquire(); return { query, release }; },
      end: () => database.close(),
    };
  }
  const raw = process.env.SUPPORT_TEST_DATABASE_URL;
  if (!raw) throw new Error('A dedicated local support test database is required');
  const url = new URL(raw);
  if (!['localhost', '127.0.0.1', '::1'].includes(url.hostname) || !/^\/omi_support_test(?:_[a-z0-9_]+)?$/.test(url.pathname)) {
    throw new Error('Refusing a non-local or non-test database');
  }
  const { Pool } = require('pg');
  return new Pool({ connectionString: raw, max: 6 });
}

async function verify(pool) {
  const prefix = `test-${randomUUID()}`;
  // Exercise an additive upgrade without dropping existing rows or state.
  await pool.query(`CREATE TABLE IF NOT EXISTS support_cases (
    id TEXT PRIMARY KEY, channel_id TEXT NOT NULL, customer_id TEXT NOT NULL,
    customer_thread_id TEXT, handoff_thread_id TEXT, escalation_id INTEGER,
    status TEXT NOT NULL CHECK (status IN ('queued','delivered','accepted','resolved','closed')),
    context JSONB NOT NULL DEFAULT '{}', sources JSONB NOT NULL DEFAULT '[]',
    delivery_id TEXT, delivery_destination TEXT, accepted_by TEXT, accepted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  const legacyId = randomUUID();
  await pool.query(`INSERT INTO support_cases (id, channel_id, customer_id, status, accepted_by, accepted_at)
    VALUES ($1,$2,$3,'accepted',$4,NOW())`, [legacyId, `${prefix}-legacy`, `${prefix}-legacy-customer`, `${prefix}-legacy-staff`]);
  for (let count = 0; count < 2; count++) {
    await runtime.initSchema(pool); await cases.initSchema(pool); await cards.initSchema(pool); await initIdentity(pool);
    await memoryStore.initSchema(pool);
    await reviewedStore.initSchema(pool);
  }
  await verifyReviewedKnowledge(pool, prefix);
  const legacy = (await pool.query('SELECT * FROM support_cases WHERE id=$1', [legacyId])).rows[0];
  assert.equal(legacy.status, 'accepted'); assert.equal(legacy.accepted_by, `${prefix}-legacy-staff`);
  assert.equal(legacy.acceptance_notice_started, false); assert.equal(legacy.work_status, null);
  const store = new runtime.PostgresRuntimeStore(pool);
  const job = { messageId: `${prefix}-message`, caseKey: `${prefix}:alice`, owner: `${prefix}-owner`, fingerprint: runtime.questionFingerprint('synthetic private input') };
  const duplicate = { ...job, owner: `${prefix}-second` };
  assert.deepEqual((await Promise.all([store.claim(job), store.claim(duplicate)])).sort(), [false, true]);
  const ownerRow = (await pool.query('SELECT owner FROM support_message_claims WHERE message_id=$1', [job.messageId])).rows[0];
  const owned = ownerRow.owner === job.owner ? job : duplicate;
  const stale = owned === job ? duplicate : job;
  assert.equal(await store.acquire(owned), true);
  assert.equal(await store.owned(owned), true); assert.equal(await store.owned(stale), false);
  assert.equal(await store.renew(owned), true);
  await store.finish(owned, 'answered');
  assert.equal(await store.claim(stale), false);
  assert.equal(await store.repeated({ ...job, messageId: `${prefix}-new` }), true);
  const queued = { messageId: `${prefix}-queued`, caseKey: `${prefix}:bob`, fingerprint: null };
  await store.enqueue(queued);
  assert.ok((await store.queued(100)).some((item) => item.messageId === queued.messageId));
  const resumed = { ...queued, owner: `${prefix}-resumed` };
  assert.equal(await store.claim(resumed), true); await store.finish(resumed, 'ignored');

  // A stalled worker resumes an expired claim nobody took; a dead one's unsent request is requeued.
  const expire = (messageId) => pool.query("UPDATE support_message_claims SET lease_until=NOW() - INTERVAL '1 second' WHERE message_id=$1", [messageId]);
  const stalled = { messageId: `${prefix}-stalled`, caseKey: `${prefix}:carol`, owner: `${prefix}-stalled-owner`, fingerprint: null };
  assert.equal(await store.claim(stalled), true); assert.equal(await store.acquire(stalled), true);
  await pool.query("UPDATE support_case_leases SET lease_until=NOW() - INTERVAL '1 second' WHERE case_key=$1", [stalled.caseKey]);
  await pool.query("UPDATE support_worker_slots SET lease_until=NOW() - INTERVAL '1 second' WHERE owner=$1", [stalled.owner]);
  await expire(stalled.messageId);
  assert.equal(await store.owned(stalled), false); assert.equal(await store.renew(stalled), false);
  assert.equal(await store.reclaim(stalled), true); assert.notEqual(stalled.slot, null);
  assert.equal(await store.owned(stalled), true); assert.equal(await store.markDelivering(stalled), true);
  await store.finish(stalled, 'answered');
  const orphan = { messageId: `${prefix}-orphan`, caseKey: `${prefix}:dave`, owner: `${prefix}-dead-owner`, fingerprint: null };
  const partial = { messageId: `${prefix}-partial`, caseKey: `${prefix}:erin`, owner: `${prefix}-dead-owner-2`, fingerprint: null };
  const local = { messageId: `${prefix}-local`, caseKey: `${prefix}:frank`, owner: `${prefix}-local-owner`, fingerprint: null };
  for (const job of [orphan, partial, local]) assert.equal(await store.claim(job), true);
  assert.equal(await store.markDelivering(partial), true);
  for (const job of [orphan, partial, local]) await expire(job.messageId);
  const swept = await store.abandoned({ exclude: [local.owner] });
  assert.ok(swept.some((item) => item.messageId === orphan.messageId && item.state === 'queued'));
  assert.ok(!swept.some((item) => [partial.messageId, local.messageId].includes(item.messageId)));
  assert.equal(await store.reclaim(orphan), false);
  assert.equal(await store.reclaim(local), true);
  assert.ok((await store.queued(100)).some((item) => item.messageId === orphan.messageId));
  const sweptLater = await store.abandoned({ exclude: [local.owner], uncertainGraceMs: 0 });
  assert.ok(sweptLater.some((item) => item.messageId === partial.messageId && item.state === 'uncertain'));
  assert.equal(await store.reclaim(partial), false);
  await store.finish(local, 'answered');

  const service = cases.createCaseService(cases.createPostgresStore(pool));
  const aliceInput = { channelId: `${prefix}-general`, customerId: `${prefix}-alice`, context: { area: 'app', summary: 'private content must not persist' } };
  const [first, second] = await Promise.all([service.getOrCreateCase(aliceInput), service.getOrCreateCase(aliceInput)]);
  assert.equal(first.id, second.id);
  const bob = await service.getOrCreateCase({ ...aliceInput, customerId: `${prefix}-bob` });
  assert.notEqual(first.id, bob.id);
  assert.equal(await service.getCaseByThread(aliceInput.channelId), null);
  assert.doesNotMatch(JSON.stringify(first.context), /private content/);
  await service.linkHandoff(first.id, { handoffThreadId: `${prefix}-handoff` });
  await service.markDelivered(first.id, { messageId: `${prefix}-receipt`, destination: 'staff-channel' });
  const accepted = await service.markAccepted(first.id, { staffId: `${prefix}-staff` });
  assert.equal(accepted.acceptedBy, `${prefix}-staff`);
  assert.equal((await service.markAccepted(first.id, { staffId: `${prefix}-other-staff` })).acceptedBy, `${prefix}-staff`);
  await service.setWorkStatus(first.id, 'in_progress');
  assert.equal((await service.getCaseById(first.id)).workStatus, 'in_progress');
  const claimedNotices = await Promise.all([service.claimAcceptanceNotice(first.id, accepted.acceptanceGeneration), service.claimAcceptanceNotice(first.id, accepted.acceptanceGeneration)]);
  assert.equal(claimedNotices.filter(Boolean).length, 1);
  await service.saveAcceptanceNotice(first.id, accepted.acceptanceGeneration, `${prefix}-acceptance-receipt`);
  assert.equal((await service.getCaseById(first.id)).acceptanceNoticeId, `${prefix}-acceptance-receipt`);
  const cardStore = cards.createPostgresStore(pool);
  // Native Postgres retains sub-millisecond precision; JS Date does not.
  await pool.query("UPDATE support_cases SET updated_at=date_trunc('milliseconds', NOW()) + INTERVAL '456 microseconds' WHERE id=$1", [first.id]);
  const cardService = cards.createCardService(cardStore, { service });
  const staffChannelId = '234567890123456789'; const staffCardId = '534567890123456789';
  const previousStaffChannel = process.env.STAFF_ALERT_CHANNEL_ID; process.env.STAFF_ALERT_CHANNEL_ID = staffChannelId;
  let lastCard;
  try {
    await cardService.rememberCard(first.id, staffChannelId, staffCardId);
    const message = { author: { id: 'fixture-bot' }, embeds: [{ fields: [{ name: 'Case', value: first.id }] }],
      edit: async payload => { lastCard = payload; message.embeds = payload.embeds; message.components = payload.components; } };
    const client = { user: { id: 'fixture-bot' }, channels: { fetch: async () => ({ messages: { fetch: async () => message } }) } };
    assert.equal(await cardService.syncPending(client), 1);
    assert.match(lastCard.embeds[0].title, /In progress/);
    assert.equal(await cardService.syncPending(client), 0);
    const staleSnapshot = await service.getCaseById(first.id);
    await service.setWorkStatus(first.id, 'waiting_customer');
    await cardStore.synced({ caseId: first.id, messageId: staffCardId }, staleSnapshot);
    assert.ok((await cardStore.dirty(service, 25)).includes(first.id));
    await cardService.syncPending(client); assert.match(lastCard.embeds[0].title, /Waiting for customer/);
    await service.resolveCase(first.id, { close: true, confirmed: true });
    await cardService.syncPending(client); assert.match(lastCard.embeds[0].title, /Closed/);
    const reopened = await service.reopenByThread(`${prefix}-handoff`, aliceInput.customerId);
    assert.equal(reopened.status, 'queued'); assert.equal(reopened.acceptedBy, null); assert.equal(reopened.workStatus, null);
    await cardService.syncPending(client); assert.match(lastCard.embeds[0].title, /Handoff pending/);
    assert.equal(await service.claimAcceptanceNotice(first.id, accepted.acceptanceGeneration), null);
  } finally {
    if (previousStaffChannel === undefined) delete process.env.STAFF_ALERT_CHANNEL_ID; else process.env.STAFF_ALERT_CHANNEL_ID = previousStaffChannel;
  }

  const identity = new SupportIdentityStore({ pool, key: Buffer.alloc(32, 17) });
  const restarted = new SupportIdentityStore({ pool, key: Buffer.alloc(32, 17) });
  const user = `${prefix}-identity`;
  const reservations = await Promise.all(Array.from({ length: 5 }, () => identity.reserveAttempt(user, 'fixture@example.test', 3)));
  assert.equal(reservations.filter(Boolean).length, 3);
  const code = await identity.createChallenge(user, 'fixture@example.test', { ttlMinutes: 10, maxAttempts: 5 });
  const results = await Promise.all([identity.verifyChallenge(user, code), restarted.verifyChallenge(user, code)]);
  assert.equal(results.filter((result) => result.ok).length, 1);
  assert.equal((await restarted.getBinding(user)).email, 'fixture@example.test');
  const encrypted = (await pool.query('SELECT * FROM support_verified_emails WHERE discord_user_id=$1', [user])).rows[0];
  assert.doesNotMatch(JSON.stringify(encrypted), /fixture@example\.test/);
  await restarted.revoke(user); assert.equal(await identity.getBinding(user), null);
  const memoryOptions = { store: memoryStore.createPostgresStore(pool), key: Buffer.alloc(32, 19),
    policy: { enabled: true, forumIds: ['fixture-help'], staffIds: [], botId: 'fixture-bot' } };
  const journal = supportMemory.createSupportMemory(memoryOptions);
  const journalRestart = supportMemory.createSupportMemory(memoryOptions);
  const memoryChannel = { id: `${prefix}-memory-thread`, guildId: `${prefix}-guild`, ownerId: `${prefix}-customer`, parentId: 'fixture-help', isThread: () => true };
  const message = { id: `${prefix}-memory-message`, channel: memoryChannel, author: { id: memoryChannel.ownerId },
    content: 'Synthetic private support text. Email fixture@example.test.', createdTimestamp: Date.now() };
  await Promise.all([journal.capture(message), journalRestart.capture(message)]);
  const scope = journal.scopeFor(memoryChannel);
  assert.equal((await journalRestart.history(scope)).length, 1);
  const encryptedMemory = (await pool.query('SELECT * FROM support_memory_messages WHERE thread_id=$1', [memoryChannel.id])).rows;
  assert.doesNotMatch(JSON.stringify(encryptedMemory), /Synthetic private|fixture@example/);
  await journal.capture({ ...message, content: 'Corrected attempt', editedTimestamp: Date.now() + 10 });
  await journalRestart.capture(message);
  assert.equal((await journal.history(scope))[0].content, 'Corrected attempt');
  await assert.rejects(journal.forgetThread({ ...scope, customerId: `${prefix}-stranger` }));
  const signal = { ...scope, eventId: `${prefix}-feedback`, kind: 'needs_help', area: 'app' };
  await Promise.all([journal.signal(signal), journalRestart.signal(signal)]);
  assert.ok((await journal.report()).some(row => row.kind === 'needs_help' && row.count >= 1));
  await journal.forgetMessage({ ...scope, messageId: message.id });
  assert.equal(await journalRestart.capture(message), false);
  await journal.forgetThread(scope, { optOut: true });
  assert.equal(await journal.capture({ ...message, id: `${prefix}-delayed` }), false);
  assert.deepEqual(await journalRestart.history(scope), []);
  await journal.prune();
  const laterTime = Date.now() + 31 * 86400000;
  const laterJournal = supportMemory.createSupportMemory({ ...memoryOptions, now: () => laterTime });
  await laterJournal.prune();
  assert.equal(await laterJournal.capture({ ...message, id: `${prefix}-after-opt-out`, createdTimestamp: laterTime }), false);
  for (const deletion of ['message', 'thread']) {
    const channel = { ...memoryChannel, id: `${prefix}-queued-${deletion}` };
    const pending = { ...message, channel, id: `${prefix}-before-${deletion}` };
    let release;
    const waiting = new Promise(resolve => { release = resolve; });
    const observer = createObserver({ ...journal, capture: async item => { await waiting; return journalRestart.capture(item); } });
    const saving = observer.capture(pending);
    try {
      if (deletion === 'message') await observer.forgetMessage(pending);
      else await observer.forgetThread(channel);
    } finally { release(); }
    assert.equal(await saving, false);
    assert.deepEqual(await journalRestart.history(journal.scopeFor(channel)), []);
  }
  console.log('Support database integration: schema upgrade, claims, lease recovery, queue, case isolation, live cards, notices, verification, encrypted support memory, reviewed knowledge, edit/delete races and revocation passed');
}

async function verifyReviewedKnowledge(pool, prefix) {
  const guildId = `${prefix}-knowledge`, actor = `${prefix}-reviewer`, now = Date.now();
  const firstStore = reviewedStore.createPostgresStore(pool), secondStore = reviewedStore.createPostgresStore(pool);
  let validations = 0, clock = now;
  const fixtureProof = row => ({ ok: true, digest: row.digest, reviewApproved: true,
    regression: { passed: true, questionHash: reviewedStore.hashContent(row.regressionQuestion) },
    evidence: row.sources.map(url => ({ url, sha256: createHash('sha256').update(`Synthetic public source ${url}`).digest('hex'), checkedAt: row.approvedAt })) });
  const options = { allowedStaffIds: () => [actor], enabled: () => true, now: () => clock,
    validate: async row => { validations++; return fixtureProof(row); } };
  const first = knowledge.createReviewService({ ...options, store: firstStore });
  const second = knowledge.createReviewService({ ...options, store: secondStore });
  const input = { guildId, factId: 'task-guide', expectedVersion: 0,
    content: 'The task list displays conversation action items.',
    sources: ['https://help.omi.me/en/articles/synthetic-task-list'], productVersion: 'Synthetic app fixture',
    regressionQuestion: 'Where does the app display action items?',
    provenance: [{ caseId: `${prefix}-case`, expiresAt: now + 30 * 86400000 }] };
  assert.equal((await first.propose(input, actor)).ok, true);
  const action = { guildId, factId: input.factId, version: 1 };
  const double = await Promise.all([first.approve(action, actor), second.approve(action, actor)]);
  assert.equal(double.filter(row => row.ok).length, 1); assert.equal(validations, 1);
  assert.equal((await second.search(guildId, 'task list'))[0].content, input.content);
  assert.deepEqual(await second.search(`${guildId}-other`, 'task list'), []);
  assert.equal((await first.inspect(input, actor)).versions[0].approvedBy, actor);
  await second.eraseProvenance(guildId, [`${prefix}-case`]);
  assert.deepEqual((await firstStore.read(input)).versions[0].provenance, []);
  await first.propose({ ...input, factId: 'queued-after-erasure' }, actor);
  assert.deepEqual((await secondStore.read({ ...input, factId: 'queued-after-erasure' })).versions[0].provenance, [], 'erasure survives another writer');
  await reviewedStore.initSchema(pool);
  assert.equal((await second.search(guildId, 'task list')).length, 1, 'repeat schema initialization preserves approval');
  const edited = await second.propose({ ...input, expectedVersion: 1, content: 'The task list includes next actions.' }, actor);
  assert.equal(edited.version, 2);
  assert.equal((await first.search(guildId, 'task list'))[0].content, input.content, 'pending edits preserve the working version');
  assert.equal((await second.reject({ ...action, version: 2 }, actor)).ok, true);
  assert.equal((await first.search(guildId, 'task list')).length, 1);
  assert.equal((await first.revoke({ ...action, version: 2 }, actor)).ok, true);
  knowledge.resetKnowledge(); knowledge.addSnippet(input.content);
  assert.deepEqual(await knowledge.searchForAnswers('task list', { guildId, store: secondStore, enabled: true }), []);
  assert.deepEqual(await knowledge.searchForAnswers('task list', { guildId, store: secondStore, enabled: false }), []);
  knowledge.resetKnowledge(); knowledge.addSnippet(`${input.content} Source: ${input.sources[0]}`);
  assert.deepEqual(await knowledge.searchForAnswers('task list', { guildId, store: secondStore, enabled: true }), []);
  assert.deepEqual(await knowledge.searchForAnswers('task list', { guildId, store: secondStore, enabled: false }), []);
  knowledge.resetKnowledge();
  assert.deepEqual(await second.search(guildId, 'task list'), []);

  // A late validator in another process cannot undo an explicit revocation.
  let release, entered;
  const waiting = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  const slow = knowledge.createReviewService({ ...options, store: firstStore,
    validate: async row => { entered(); await waiting; return fixtureProof(row); } });
  const next = { ...input, factId: 'late-guide' };
  assert.equal((await slow.propose(next, actor)).ok, true);
  const accepting = slow.approve({ ...action, factId: next.factId }, actor);
  await started;
  assert.equal((await second.revoke({ ...action, factId: next.factId }, actor)).ok, true);
  release(); assert.equal((await accepting).ok, false);

  const expiring = { ...input, factId: 'expiring-guide' };
  expiring.provenance = [{ caseId: `${prefix}-expiry-case`, expiresAt: now + 30 * 86400000 }];
  await first.propose(expiring, actor);
  await first.approve({ ...action, factId: expiring.factId }, actor);
  clock += 90 * 86400000;
  assert.deepEqual(await second.search(guildId, 'task list'), []);
  await first.pruneProvenance(guildId);
  assert.deepEqual((await secondStore.read(expiring)).versions[0].provenance, []);
  // Failed compare-and-swap creation must not leave an empty durable record.
  assert.equal((await first.propose({ ...input, factId: 'stale-create', expectedVersion: 3, provenance: [] }, actor)).reason, 'stale');
  assert.equal(await firstStore.read({ ...input, factId: 'stale-create' }), null);
}

(async () => {
  const pool = await isolatedPool();
  try { await verify(pool); } finally { await pool.end(); }
})().catch((error) => {
  // SQL and connection errors can contain inputs. Never dump them or a URL.
  console.error(`Support database integration failed: ${error.name}; code=${String(error.code || 'check_failed').replace(/[^A-Za-z0-9_]/g, '')}`);
  process.exitCode = 1;
});
