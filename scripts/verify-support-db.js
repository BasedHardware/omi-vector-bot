// Integration fixtures only: never point this script at a customer database.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const runtime = require('../supportRuntime');
const cases = require('../supportCases');
const cards = require('../caseCards');
const { SupportIdentityStore, initSchema: initIdentity } = require('../supportIdentityStore');
const supportMemory = require('../supportMemory');
const memoryStore = require('../supportMemoryStore');
const { createObserver } = require('../supportLearning');
const threadLanguage = require('../supportThreadLanguage');

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
  // Upgrade real legacy-shaped rows, not just a fresh empty schema.
  await pool.query(`CREATE TABLE IF NOT EXISTS support_memory_messages (
    guild_id TEXT NOT NULL, thread_id TEXT NOT NULL, customer_id TEXT NOT NULL, message_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('customer','staff','bot')), at BIGINT NOT NULL, version BIGINT NOT NULL,
    expires_at BIGINT NOT NULL, ciphertext TEXT NOT NULL, iv TEXT NOT NULL, tag TEXT NOT NULL,
    PRIMARY KEY(guild_id,thread_id,message_id)
  )`);
  const legacyColumns = (await pool.query(`SELECT column_name FROM information_schema.columns
    WHERE table_name='support_memory_messages' AND column_name='ciphertext'`)).rows;
  if (legacyColumns.length) await pool.query(`INSERT INTO support_memory_messages
    (guild_id,thread_id,customer_id,message_id,role,at,version,expires_at,ciphertext,iv,tag)
    VALUES ($1,$2,$3,$4,'customer',1,1,$5,'synthetic-ciphertext','synthetic-iv','synthetic-tag')`,
  [`${prefix}-legacy-guild`, `${prefix}-legacy-thread`, `${prefix}-legacy-owner`, `${prefix}-legacy-message`, Date.now() + 86400000]);
  await pool.query(`CREATE TABLE IF NOT EXISTS support_memory_scopes (
    guild_id TEXT NOT NULL,thread_id TEXT NOT NULL,customer_id TEXT NOT NULL,expires_at BIGINT NOT NULL,PRIMARY KEY(guild_id,thread_id));
    CREATE TABLE IF NOT EXISTS support_memory_deletions (
    guild_id TEXT NOT NULL,thread_id TEXT NOT NULL,message_id TEXT NOT NULL,expires_at BIGINT NOT NULL,PRIMARY KEY(guild_id,thread_id,message_id));
    CREATE TABLE IF NOT EXISTS support_quality_signals (
    guild_id TEXT NOT NULL,thread_id TEXT NOT NULL,customer_id TEXT NOT NULL,event_id TEXT NOT NULL,kind TEXT NOT NULL,area TEXT NOT NULL,
    expires_at BIGINT NOT NULL,PRIMARY KEY(guild_id,thread_id,event_id))`);
  await pool.query(`INSERT INTO support_memory_scopes(guild_id,thread_id,customer_id,expires_at) VALUES ($1,$2,$3,$4)`,
    [`${prefix}-legacy-guild`,`${prefix}-legacy-opt-out`,`${prefix}-legacy-opted-owner`,Date.now() + 86400000]);
  await pool.query(`INSERT INTO support_memory_deletions(guild_id,thread_id,message_id,expires_at) VALUES ($1,$2,'*',9007199254740991)`,
    [`${prefix}-legacy-guild`,`${prefix}-legacy-opt-out`]);
  await pool.query(`INSERT INTO support_quality_signals(guild_id,thread_id,customer_id,event_id,kind,area,expires_at)
    VALUES ($1,$2,$3,$4,'resolved','app',$5)`,
    [`${prefix}-legacy-guild`,`${prefix}-legacy-metadata`,`${prefix}-legacy-metadata-owner`,`${prefix}-legacy-outcome`,Date.now() + 86400000]);
  for (let count = 0; count < 2; count++) {
    await runtime.initSchema(pool); await cases.initSchema(pool); await cards.initSchema(pool); await initIdentity(pool);
    await memoryStore.initSchema(pool);
    await threadLanguage.initSchema(pool);
  }
  const memoryColumns = (await pool.query(`SELECT column_name FROM information_schema.columns
    WHERE table_name='support_memory_messages' ORDER BY column_name`)).rows.map(row => row.column_name);
  assert.deepEqual(memoryColumns, ['at','customer_id','expires_at','forum_id','guild_id','message_id','role','thread_id']);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM support_memory_messages WHERE message_id=$1', [`${prefix}-legacy-message`])).rows[0].n, 0);
  const everyMemoryColumn = (await pool.query(`SELECT column_name FROM information_schema.columns
    WHERE table_name IN ('support_memory_messages','support_memory_scopes','support_memory_deletions','support_memory_opt_outs','support_quality_signals')`)).rows;
  assert.ok(everyMemoryColumn.every(row => !/^(?:text|content|ciphertext|iv|tag|title|embedding|attachment)/i.test(row.column_name)));
  const legacyOutcome = (await pool.query('SELECT kind,area,forum_id FROM support_quality_signals WHERE event_id=$1', [`${prefix}-legacy-outcome`])).rows[0];
  assert.deepEqual(legacyOutcome, { kind: 'resolved', area: 'app', forum_id: null });
  const legacy = (await pool.query('SELECT * FROM support_cases WHERE id=$1', [legacyId])).rows[0];
  assert.equal(legacy.status, 'accepted'); assert.equal(legacy.accepted_by, `${prefix}-legacy-staff`);
  assert.equal(legacy.acceptance_notice_started, false); assert.equal(legacy.work_status, null);
  let languageNow = Date.now();
  const languageScope = { guildId: `${prefix}-guild`, threadId: `${prefix}-thread`, ownerId: `${prefix}-owner` };
  const languageStore = threadLanguage.createStore(pool, { now: () => languageNow });
  await languageStore.save(languageScope, 'es');
  const languageRestart = threadLanguage.createStore(pool, { now: () => languageNow });
  assert.equal(await languageRestart.get(languageScope), 'es');
  for (const key of ['guildId', 'threadId', 'ownerId']) {
    assert.equal(await languageRestart.get({ ...languageScope, [key]: `${prefix}-other` }), null);
  }
  assert.equal(await languageStore.save(languageScope, 'fixture-private-message'), false);
  const languageColumns = (await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name='support_thread_languages' ORDER BY ordinal_position")).rows.map(row => row.column_name);
  assert.deepEqual(languageColumns, ['guild_id', 'thread_id', 'owner_id', 'language_code', 'expires_at']);
  languageNow += threadLanguage.RETENTION_MS;
  assert.equal(await languageRestart.get(languageScope), null);
  await languageRestart.prune();
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM support_thread_languages WHERE guild_id=$1', [languageScope.guildId])).rows[0].n, 0);
  await languageStore.save(languageScope, 'zh');
  await languageStore.forgetThread({ guildId: `${prefix}-other`, id: languageScope.threadId });
  assert.equal(await languageRestart.get(languageScope), 'zh');
  await languageStore.forgetThread({ guildId: languageScope.guildId, id: languageScope.threadId });
  assert.equal(await languageRestart.get(languageScope), null);
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
  const memoryOptions = { store: memoryStore.createPostgresStore(pool),
    policy: { enabled: true, contextEnabled: true, forumIds: ['fixture-help','fixture-other-forum'], staffIds: ['fixture-staff'], botId: 'fixture-bot' } };
  const journal = supportMemory.createSupportMemory(memoryOptions);
  const journalRestart = supportMemory.createSupportMemory(memoryOptions);
  const memoryChannel = { id: `${prefix}-memory-thread`, guildId: `${prefix}-guild`, ownerId: `${prefix}-customer`, parentId: 'fixture-help', isThread: () => true };
  const message = { id: `${prefix}-memory-message`, channel: memoryChannel, author: { id: memoryChannel.ownerId },
    content: 'Synthetic private support text. Email fixture@example.test.', createdTimestamp: Date.now() };
  const legacyOptedChannel = { ...memoryChannel, guildId: `${prefix}-legacy-guild`, id: `${prefix}-new-after-legacy-opt-out`, ownerId: `${prefix}-legacy-opted-owner` };
  assert.equal(await journal.capture({ ...message, channel: legacyOptedChannel, author: { id: legacyOptedChannel.ownerId } }), false);
  await journal.forgetCustomer({ guildId: `${prefix}-legacy-guild`, forumId: 'fixture-help', threadId: `${prefix}-erase-legacy`, customerId: `${prefix}-legacy-metadata-owner` });
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM support_quality_signals WHERE event_id=$1', [`${prefix}-legacy-outcome`])).rows[0].n, 0);
  await Promise.all([journal.capture(message), journalRestart.capture(message)]);
  const scope = journal.scopeFor(memoryChannel);
  assert.equal((await journalRestart.history(scope)).length, 1);
  const referenceRows = (await pool.query('SELECT * FROM support_memory_messages WHERE thread_id=$1', [memoryChannel.id])).rows;
  assert.doesNotMatch(JSON.stringify(referenceRows), /Synthetic private|fixture@example|ciphertext|"iv"|"tag"|"content"/);
  assert.equal(referenceRows[0].forum_id, 'fixture-help');
  await journal.capture({ ...message, content: 'Corrected attempt', editedTimestamp: Date.now() + 10 });
  await journalRestart.capture(message);
  assert.equal((await journal.history(scope))[0].content, undefined);
  assert.equal((await journal.history(scope))[0].at, message.createdTimestamp);
  await assert.rejects(journal.forgetThread({ ...scope, customerId: `${prefix}-stranger` }));
  const signal = { ...scope, eventId: `${prefix}-feedback`, kind: 'needs_help', area: 'app' };
  await Promise.all([journal.signal(signal), journalRestart.signal(signal)]);
  assert.ok((await journal.report()).some(row => row.kind === 'needs_help' && row.count >= 1));
  const previousPosts = ['first','second'].map((name, index) => ({ ...memoryChannel, id: `${prefix}-previous-${name}`, at: message.createdTimestamp - (index + 1) * 1000 }));
  for (const ch of previousPosts) await journal.capture({ ...message, channel: ch, id: `${ch.id}-message`, createdTimestamp: ch.at });
  const priorScope = journal.scopeFor(previousPosts[0]);
  await journal.signal({ ...priorScope, eventId: `${prefix}-a-resolution`, kind: 'resolved', area: 'app' });
  await journal.signal({ ...priorScope, eventId: `${prefix}-z-review`, kind: 'review_rejected', area: 'app' });
  const anotherOwner = { ...memoryChannel, id: `${prefix}-other-owner`, ownerId: `${prefix}-other-customer` };
  const anotherForum = { ...memoryChannel, id: `${prefix}-other-forum`, parentId: 'fixture-other-forum' };
  await journal.capture({ ...message, channel: anotherOwner, id: `${prefix}-other-owner-message`, author: { id: anotherOwner.ownerId } });
  await journal.capture({ ...message, channel: anotherForum, id: `${prefix}-other-forum-message` });
  assert.deepEqual((await journalRestart.otherThreads(scope)).map(row => row.threadId), previousPosts.map(ch => ch.id));
  assert.equal((await journalRestart.otherThreads(scope))[0].outcome, 'resolved');
  const contextPost = { ...memoryChannel, id: `${prefix}-context-post`, ownerId: `${prefix}-context-owner` };
  const contextAt = Date.now() - 10000;
  for (let i = 0; i < 4; i++) await journal.capture({ ...message, channel: contextPost, author: { id: contextPost.ownerId }, id: `${prefix}-context-owner-${i}`, createdTimestamp: contextAt + i });
  for (let i = 0; i < 2; i++) await journal.capture({ ...message, channel: contextPost, author: { id: 'fixture-bot', bot: true }, id: `${prefix}-context-bot-${i}`, createdTimestamp: contextAt + 10 + i });
  for (let i = 0; i < 55; i++) await journal.capture({ ...message, channel: contextPost, author: { id: 'fixture-staff' }, id: `${prefix}-context-staff-${i}`, createdTimestamp: contextAt + 20 + i });
  const contextScope = journal.scopeFor(contextPost);
  const contextReferences = await journalRestart.contextReferences(contextScope);
  assert.deepEqual(contextReferences.map(row => row.id), [1,2,3].map(i => `${prefix}-context-owner-${i}`).concat(`${prefix}-context-bot-1`));
  assert.equal(await journalRestart.allowsContext(contextScope), true);
  await journal.forgetCustomer(contextScope);
  assert.equal(await journalRestart.allowsContext(contextScope), false);
  assert.deepEqual(await journalRestart.contextReferences(contextScope), []);
  await journal.forgetMessage({ ...scope, messageId: message.id });
  assert.equal(await journalRestart.capture(message), false);
  await journal.forgetThread(scope, { optOut: true });
  for (const table of ['support_memory_messages','support_quality_signals','support_memory_scopes','support_memory_deletions']) {
    const remaining = await pool.query('SELECT count(*)::int AS n FROM ' + table + ' WHERE guild_id=$1 AND customer_id=$2 AND forum_id=$3',
      [scope.guildId,scope.customerId,scope.forumId]);
    assert.equal(remaining.rows[0].n, 0);
  }
  assert.equal(await journal.capture({ ...message, id: `${prefix}-delayed` }), false);
  assert.deepEqual(await journalRestart.history(scope), []);
  assert.deepEqual(await journalRestart.otherThreads(scope), []);
  assert.equal((await journalRestart.history(journal.scopeFor(anotherOwner))).length, 1);
  assert.equal((await journalRestart.history(journal.scopeFor(anotherForum))).length, 1);
  for (const ch of previousPosts) assert.deepEqual(await journalRestart.history(journal.scopeFor(ch)), []);
  await journal.prune();
  const laterTime = Date.now() + 31 * 86400000;
  const laterJournal = supportMemory.createSupportMemory({ ...memoryOptions, now: () => laterTime });
  await laterJournal.prune();
  assert.equal(await laterJournal.capture({ ...message, id: `${prefix}-after-opt-out`, createdTimestamp: laterTime }), false);
  for (const deletion of ['message', 'thread']) {
    const channel = { ...memoryChannel, id: `${prefix}-queued-${deletion}`, ownerId: `${prefix}-race-owner-${deletion}` };
    const pending = { ...message, channel, id: `${prefix}-before-${deletion}`, author: { id: channel.ownerId } };
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
  const queuedChannel = { ...memoryChannel, id: `${prefix}-queued-forum`, ownerId: `${prefix}-forum-race-owner` };
  const queuedMessage = { ...message, channel: queuedChannel, id: `${prefix}-queued-forum-message`, author: { id: queuedChannel.ownerId } };
  let releaseForumCapture;
  const forumWait = new Promise(resolve => { releaseForumCapture = resolve; });
  const forumObserver = createObserver({ ...journal, capture: async item => { await forumWait; return journalRestart.capture(item); } });
  const forumSaving = forumObserver.capture(queuedMessage);
  const forumScope = journal.scopeFor({ ...queuedChannel, id: `${prefix}-forget-new-post` });
  try { await journal.forgetCustomer(forumScope); } finally { releaseForumCapture(); }
  assert.equal(await forumSaving, false);
  assert.equal(await journalRestart.signal({ ...forumScope, eventId: `${prefix}-delayed-signal`, kind: 'needs_help' }), false);
  assert.deepEqual(await journalRestart.otherThreads(forumScope), []);
  console.log('Support database integration: schema upgrade, claims, lease recovery, queue, case isolation, live cards, notices, verification, reference-only memory, forum erasure, edit/delete races, revocation and text-free thread languages passed');
}

(async () => {
  const pool = await isolatedPool();
  try { await verify(pool); } finally { await pool.end(); }
})().catch((error) => {
  // SQL and connection errors can contain inputs. Never dump them or a URL.
  console.error(`Support database integration failed: ${error.name}; code=${String(error.code || 'check_failed').replace(/[^A-Za-z0-9_]/g, '')}`);
  process.exitCode = 1;
});
