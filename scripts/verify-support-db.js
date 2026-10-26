// Integration fixtures only: never point this script at a customer database.
const assert = require('node:assert/strict');
const { randomUUID, createCipheriv, createHmac, createHash } = require('node:crypto');
const runtime = require('../supportRuntime');
const cases = require('../supportCases');
const cards = require('../caseCards');
const { SupportIdentityStore, initSchema: initIdentity } = require('../supportIdentityStore');
const approvals = require('../supportApprovals');
const issueLinks = require('../supportIssueLinks');
const githubNoticeReceipts = require('../githubNoticeReceipts');
const supportMemory = require('../supportMemory');
const memoryStore = require('../supportMemoryStore');
const { createObserver } = require('../supportLearning');
const knowledge = require('../knowledge');
const reviewedStore = require('../knowledgeReviewStore');
const threadLanguage = require('../supportThreadLanguage');
const { verifyMemoryContext } = require('./verify-memory-context');

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

async function verifyEarlyPickup(pool, store, prefix) {
  const make = suffix => ({ messageId: `${prefix}-heartbeat-${suffix}`, caseKey: `${prefix}:heartbeat-${suffix}`,
    owner: `${prefix}-heartbeat-owner-${suffix}`, fingerprint: null });
  const columns = (await pool.query(`SELECT column_name FROM information_schema.columns
    WHERE table_name='support_message_claims'`)).rows.map(row => row.column_name);
  assert.ok(columns.includes('heartbeat_at') && columns.includes('heartbeat_owner'));
  const dead = make('dead'), live = make('live');
  for (const job of [dead, live]) {
    assert.equal(await store.claim(job), true); assert.equal(await store.acquire(job), true);
  }
  await pool.query("UPDATE support_message_claims SET heartbeat_at=NOW() - INTERVAL '30 seconds' WHERE message_id=$1", [live.messageId]);
  await pool.query("UPDATE support_message_claims SET heartbeat_at=NOW() - INTERVAL '46 seconds' WHERE message_id=$1", [dead.messageId]);
  const recovered = await store.abandoned();
  assert.ok(recovered.some(row => row.messageId === dead.messageId && row.state === 'queued'));
  assert.ok(!recovered.some(row => row.messageId === live.messageId));
  assert.equal(await store.owned(live), true, 'unrelated live capacity remains owned');
  assert.equal(await store.owned(dead), false); assert.equal(await store.markDelivering(dead), false);
  const replacement = { ...dead, owner: `${prefix}-heartbeat-replacement`, slot: undefined };
  assert.equal(await store.claim(replacement), true);
  assert.equal(await store.acquire(replacement), true, 'old case/slot leases were released atomically');
  assert.equal(await store.reclaim(dead), false);
  await store.finish(replacement, 'answered'); await store.finish(live, 'answered');

  const legacy = make('legacy');
  assert.equal(await store.claim(legacy), true);
  await pool.query("UPDATE support_message_claims SET heartbeat_at=NOW() - INTERVAL '46 seconds', heartbeat_owner=$2 WHERE message_id=$1",
    [legacy.messageId, `${prefix}-different-generation`]);
  assert.ok(!(await store.abandoned()).some(row => row.messageId === legacy.messageId));
  await store.finish(legacy, 'ignored');

  const delivering = make('delivering');
  assert.equal(await store.claim(delivering), true); assert.equal(await store.acquire(delivering), true);
  assert.equal(await store.markDelivering(delivering), true);
  await pool.query("UPDATE support_message_claims SET heartbeat_at=NOW() - INTERVAL '46 seconds' WHERE message_id=$1", [delivering.messageId]);
  assert.ok(!(await store.abandoned()).some(row => row.messageId === delivering.messageId));
  assert.ok(!(await store.queued(100)).some(row => row.messageId === delivering.messageId));
  await store.finish(delivering, 'answered');

  // Either the delivery marker or recovery wins the row lock, never both.
  for (const deliveryFirst of [true, false]) {
    const race = make(`race-${deliveryFirst}`);
    assert.equal(await store.claim(race), true); assert.equal(await store.acquire(race), true);
    await pool.query("UPDATE support_message_claims SET heartbeat_at=NOW() - INTERVAL '46 seconds' WHERE message_id=$1", [race.messageId]);
    const actions = deliveryFirst
      ? [store.markDelivering(race), store.abandoned()]
      : [store.abandoned(), store.markDelivering(race)];
    const results = await Promise.all(actions);
    const started = results[deliveryFirst ? 0 : 1], swept = results[deliveryFirst ? 1 : 0];
    assert.equal(started && swept.some(row => row.messageId === race.messageId && row.state === 'queued'), false);
    const row = (await pool.query('SELECT state,delivery_started FROM support_message_claims WHERE message_id=$1', [race.messageId])).rows[0];
    assert.equal(row.state === 'queued' && row.delivery_started, false);
    await store.finish(race, 'answered');
    await store.discard(race);
  }
  await verifyRuntimePickupFences(pool, prefix);
}

async function verifyRuntimePickupFences(pool, prefix) {
  const gate = () => { let release; const promise = new Promise(resolve => { release = resolve; }); return { promise, release }; };
  const oldStore = new runtime.PostgresRuntimeStore(pool);
  const nextStore = new runtime.PostgresRuntimeStore(pool);
  // Other verifier groups deliberately leave queued fixtures. Scope dispatch to
  // this group's identifiers; claims, leases, fences and mutations use real SQL.
  const pickupIds = new Set();
  const queued = nextStore.queued.bind(nextStore);
  nextStore.queued = async (limit, options) => (await queued(100, options)).filter(row => pickupIds.has(row.messageId)).slice(0, limit);
  const old = new runtime.SupportRuntime({ store: oldStore, heartbeatMs: 1000000, log: () => {} });
  const next = new runtime.SupportRuntime({ store: nextStore, heartbeatMs: 1000000, sweepMs: 0, log: () => {} });
  const started = gate(), held = gate();
  let unavailable = false, sends = 0;
  const owned = oldStore.owned.bind(oldStore);
  oldStore.owned = async job => { if (unavailable) throw new Error('synthetic old-worker partition'); return owned(job); };
  const send = async () => { await runtime.assertCurrentOwnership(); sends++; runtime.markCurrentReplySent(); return true; };
  const messageId = `${prefix}-two-worker-partition`;
  pickupIds.add(messageId);
  const pending = old.run({ messageId, caseKey: `${prefix}:partition-case`, fingerprint: null }, async () => {
    started.release(); await held.promise; return send();
  });
  const settled = pending.then(value => ({ value }), error => ({ error }));
  try {
    await started.promise;
    await pool.query("UPDATE support_message_claims SET heartbeat_at=NOW() - INTERVAL '46 seconds' WHERE message_id=$1", [messageId]);
    await next.recoverQueued(input => next.run(input, send));
    assert.equal(sends, 1);
    unavailable = true; held.release();
    assert.equal((await settled).error?.code, 'SUPPORT_OWNERSHIP_UNKNOWN');
    assert.equal(sends, 1, 'old owner cannot send through its failed ownership read');
    assert.equal((await pool.query('SELECT state FROM support_message_claims WHERE message_id=$1', [messageId])).rows[0].state, 'answered');
  } finally { held.release(); await settled; }

  const slow = `${prefix}-recovery-slow`, orphan = {
    messageId: `${prefix}-recovery-later`, caseKey: `${prefix}:recovery-later`, owner: `${prefix}-dead-worker`, fingerprint: null,
  };
  const began = gate(), resume = gate();
  pickupIds.add(slow); pickupIds.add(orphan.messageId);
  await nextStore.enqueue({ messageId: slow, caseKey: `${prefix}:recovery-slow`, fingerprint: null });
  await nextStore.claim(orphan); await nextStore.acquire(orphan);
  const handler = input => next.run(input, async () => {
    if (input.messageId === slow) { began.release(); await resume.promise; }
    return send();
  });
  const first = next.recoverQueued(handler);
  try {
    await began.promise;
    await pool.query("UPDATE support_message_claims SET heartbeat_at=NOW() - INTERVAL '46 seconds' WHERE message_id=$1", [orphan.messageId]);
    await next.recoverQueued(handler);
    assert.equal((await pool.query('SELECT state FROM support_message_claims WHERE message_id=$1', [orphan.messageId])).rows[0].state, 'answered');
    assert.equal(next.running, 1, 'the first answer is still held while later recovery completes');
  } finally { resume.release(); await first; }

  const ambiguous = { messageId: `${prefix}-ambiguous-marker`, caseKey: `${prefix}:ambiguous-marker`, owner: `${prefix}-marker-owner`, fingerprint: null };
  await nextStore.claim(ambiguous); await nextStore.acquire(ambiguous); await nextStore.markDelivering(ambiguous);
  await nextStore.defer(ambiguous);
  assert.equal((await pool.query('SELECT state,delivery_started FROM support_message_claims WHERE message_id=$1', [ambiguous.messageId])).rows[0].state, 'processing');
  assert.ok(!(await nextStore.queued(100)).some(row => row.messageId === ambiguous.messageId));
  await nextStore.finish(ambiguous, 'uncertain');

  // Exclusions must apply before LIMIT, even with earlier still-queued fetches.
  const heldIds = ['a', 'b', 'c'].map(suffix => `${prefix}-000-held-${suffix}`);
  const laterId = `${prefix}-999-later`;
  for (const id of [...heldIds, laterId]) await nextStore.enqueue({ messageId: id, caseKey: `${prefix}:${id}`, fingerprint: null });
  const ordered = await queued(100);
  const limit = ordered.findIndex(row => row.messageId === laterId) - heldIds.length + 1;
  assert.ok((await queued(limit, { exclude: heldIds })).some(row => row.messageId === laterId), 'SQL excludes in-flight rows before applying the dispatch limit');
  for (const id of [...heldIds, laterId]) await nextStore.discard({ messageId: id });

  const lostAck = `${prefix}-lost-claim-ack`;
  pickupIds.add(lostAck);
  const claim = oldStore.claim.bind(oldStore);
  oldStore.claim = async job => { await claim(job); throw new Error('synthetic lost claim acknowledgement'); };
  await assert.rejects(old.run({ messageId: lostAck, caseKey: `${prefix}:lost-ack`, fingerprint: null }, send));
  assert.equal((await next.run({ messageId: lostAck, caseKey: `${prefix}:lost-ack`, fingerprint: null }, send)).status, 'duplicate');
  const before = sends;
  await pool.query("UPDATE support_message_claims SET heartbeat_at=NOW() - INTERVAL '46 seconds' WHERE message_id=$1", [lostAck]);
  await next.recoverQueued(input => next.run(input, send));
  assert.equal(sends, before + 1, 'lost claim acknowledgement is recovered once, not sent as an unfenced note');
  const transient = `${prefix}-transient-pre-work`;
  pickupIds.add(transient);
  const repeated = nextStore.repeated.bind(nextStore);
  let fail = true;
  nextStore.repeated = async job => {
    if (fail) { fail = false; throw new Error('synthetic transient coordinator failure'); }
    return repeated(job);
  };
  await assert.rejects(next.run({ messageId: transient, caseKey: `${prefix}:transient`, fingerprint: null }, send));
  assert.equal((await pool.query('SELECT state FROM support_message_claims WHERE message_id=$1', [transient])).rows[0].state, 'queued');
  await next.recoverQueued(input => next.run(input, send));
  assert.equal((await pool.query('SELECT state FROM support_message_claims WHERE message_id=$1', [transient])).rows[0].state, 'answered');
  console.log('Early pickup two-worker SQL: partition fences, independent sweeps, queue-limit exclusion, transient/lost-ack recovery and ambiguous-marker no-replay passed');
}

async function verifyGitHubNoticeReceipts(pool, prefix) {
  await githubNoticeReceipts.initSchema(pool);
  await githubNoticeReceipts.initSchema(pool);
  const a = githubNoticeReceipts.createPostgresStore(pool);
  const b = githubNoticeReceipts.createPostgresStore(pool);
  const databaseNow = async () => Number((await pool.query('SELECT EXTRACT(EPOCH FROM clock_timestamp())*1000 AS at')).rows[0].at);
  const scope = (owner = prefix, eventAt = Date.now() - 1000) => ({
    ...githubNoticeReceipts.keys('BasedHardware/omi', randomUUID(), ['case', prefix, randomUUID()]),
    customerKey: githubNoticeReceipts.customerKey(owner), eventAt: Math.floor(eventAt),
  });
  const value = scope();
  assert.deepEqual((await Promise.all([a.begin(value), b.begin(value)])).sort(), [false, true]);
  assert.equal(await b.confirm({ ...value, messageId: '100000000000000999' }), true);
  assert.equal(await githubNoticeReceipts.createPostgresStore(pool).begin(value), false);
  assert.equal(await a.confirm({ ...value, messageId: '100000000000000998' }), false);
  await a.uncertain(value);
  assert.equal((await pool.query('SELECT state FROM support_github_notice_receipts WHERE event_key=$1 AND recipient_key=$2',
    [value.eventKey, value.recipientKey])).rows[0].state, 'sent');
  const unknown = scope();
  assert.equal(await a.begin(unknown), true); await a.uncertain(unknown);
  assert.equal(await b.begin(unknown), false);
  const ackLost = scope();
  const lost = githubNoticeReceipts.createPostgresStore({ connect: async () => {
    const client = await pool.connect();
    return { release: () => client.release(), query: async (sql, args) => {
      const result = await client.query(sql, args);
      if (sql === 'COMMIT') throw Error('Synthetic committed-write acknowledgement lost');
      return result;
    } };
  } });
  await assert.rejects(lost.begin(ackLost));
  assert.equal(await b.begin(ackLost), false);
  const other = { ...value, recipientKey: githubNoticeReceipts.keys('BasedHardware/omi', randomUUID(), ['case', prefix, 'another-owner']).recipientKey };
  assert.equal(await b.begin(other), true);
  const columns = (await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name='support_github_notice_receipts' ORDER BY ordinal_position")).rows.map(row => row.column_name);
  assert.deepEqual(columns, ['event_key','recipient_key','customer_key','event_at','expires_at','state','message_id','created_at','updated_at']);
  const erasureColumns = (await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name='support_github_notice_erasures' ORDER BY ordinal_position")).rows.map(row => row.column_name);
  assert.deepEqual(erasureColumns, ['customer_key','erased_before','expires_at']);
  assert.ok([value.eventKey, value.recipientKey, value.customerKey].every(key => !key.includes(prefix)));

  // Prune an expired fence, then prove the subject-age guard still blocks it.
  const old = scope(prefix + '-expired', (await databaseNow()) - 31 * 86400000);
  await pool.query(`INSERT INTO support_github_notice_receipts(event_key,recipient_key,customer_key,event_at,expires_at,state)
    VALUES ($1,$2,$3,to_timestamp($4::double precision/1000),to_timestamp($4::double precision/1000)+INTERVAL '30 days','sent')`,
  [old.eventKey,old.recipientKey,old.customerKey,old.eventAt]);
  await a.pruneExpired();
  assert.equal((await pool.query('SELECT 1 FROM support_github_notice_receipts WHERE event_key=$1', [old.eventKey])).rows.length, 0);
  assert.equal(await b.begin(old), false);
  const fresh = scope(prefix + '-expired', await databaseNow());
  assert.equal(await b.begin(fresh), true); assert.equal(await a.begin(fresh), false);
  // A fast application clock must not delete a fence while PostgreSQL still accepts its event.
  await a.pruneExpired(Date.now() + 365 * 86400000);
  assert.equal(await b.begin(fresh), false);

  const erased = await a.eraseCustomer(value.customerKey);
  assert.deepEqual(erased, { ok:true, remaining:false });
  assert.equal((await pool.query('SELECT 1 FROM support_github_notice_receipts WHERE customer_key=$1', [value.customerKey])).rows.length, 0);
  assert.equal(await b.begin(value), false, 'customer cutoff survives store recreation');
  assert.equal(await b.confirm({ ...value,messageId:'100000000000000999' }), false, 'late ACK cannot recreate an erased receipt');
  assert.equal((await pool.query('SELECT 1 FROM support_github_notice_receipts WHERE event_key=$1', [fresh.eventKey])).rows.length, 1, 'other customer is preserved');
  // A subsequent server-time event remains deliverable after erasure.
  const later = scope(prefix, (await databaseNow()) + 1000);
  assert.equal(await b.begin(later), true);

  // Independent batches each make progress even with an expiry backlog.
  const expiryOwner = githubNoticeReceipts.customerKey(prefix + '-expiry-backlog');
  const eraseOwner = githubNoticeReceipts.customerKey(prefix + '-erase-backlog');
  for (const [owner, age] of [[expiryOwner,31], [eraseOwner,1]]) {
    await pool.query(`INSERT INTO support_github_notice_receipts(event_key,recipient_key,customer_key,event_at,expires_at,state)
      SELECT md5($1 || n::text)||md5(n::text || $1),md5('recipient'||n::text)||md5(n::text||'recipient'),$1,
        clock_timestamp()-($2::int*INTERVAL '1 day'),clock_timestamp()+((30-$2::int)*INTERVAL '1 day'),'sent'
      FROM generate_series(1,205) n`, [owner,age]);
  }
  assert.deepEqual(await a.eraseCustomer(eraseOwner), { ok:true,remaining:true });
  const count = async owner => Number((await pool.query('SELECT COUNT(*) AS n FROM support_github_notice_receipts WHERE customer_key=$1', [owner])).rows[0].n);
  assert.equal(await count(eraseOwner),105);
  assert.equal((await a.pruneExpired()).remaining,true);
  assert.equal(await count(expiryOwner),105);
  assert.equal(await count(eraseOwner),5,'erasure does not starve behind expiry');
  await a.pruneExpired(); assert.equal((await a.pruneExpired()).remaining,false);
  assert.equal(await count(expiryOwner),0); assert.equal(await count(eraseOwner),0);

  // Both lock orders are safe: a claim before erasure is removed; one after is denied.
  const race = scope(prefix + '-race');
  await Promise.all([a.begin(race),b.eraseCustomer(race.customerKey)]);
  assert.equal(await a.begin(race),false);
  assert.equal(await count(race.customerKey),0);
  // Expired cutoffs are bounded and retiring them cannot revive old subject times.
  await pool.query(`INSERT INTO support_github_notice_erasures(customer_key,erased_before,expires_at)
    SELECT md5($1||n::text)||md5(n::text||$1),clock_timestamp()-INTERVAL '31 days',clock_timestamp()-INTERVAL '1 day'
    FROM generate_series(1,205) n`, [prefix + '-old-cutoff']);
  const expiredCutoffs = async () => Number((await pool.query('SELECT COUNT(*) AS n FROM support_github_notice_erasures WHERE expires_at<=clock_timestamp()')).rows[0].n);
  assert.equal((await a.pruneExpired()).remaining,true); assert.equal(await expiredCutoffs(),105);
  await a.pruneExpired(); assert.equal((await a.pruneExpired()).remaining,false); assert.equal(await expiredCutoffs(),0);
  assert.equal(await b.begin(old),false);
  console.log('GitHub notice receipts: concurrent claims, uncertain/lost ACK fences, subject-age rejection after pruning, customer erasure/recreation, bounded non-starvable cleanup and text-free schema passed');
}

async function verify(pool) {

  const prefix = `test-${randomUUID()}`;
  await verifyGitHubNoticeReceipts(pool, prefix);
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
    await approvals.initSchema(pool); await issueLinks.initSchema(pool);
    await memoryStore.initSchema(pool);
    await reviewedStore.initSchema(pool);
    await threadLanguage.initSchema(pool);
  }
  await verifyReviewedKnowledge(pool, prefix);
  await verifyKnowledgePrivacy(pool, prefix);
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

  await verifyEarlyPickup(pool, store, prefix);

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
  const approvalStore = approvals.createPostgresStore(pool);
  const publication = approvals.createApprovalService(approvalStore, { key: Buffer.alloc(32, 19) });
  const publicationCopy = approvals.createApprovalService(approvalStore, { key: Buffer.alloc(32, 19) });
  const commentScope = { caseId: first.id, customerId: aliceInput.customerId, sourceMessageId: `${prefix}-comment-first`,
    channelId: `${prefix}-staff`, threadId: aliceInput.channelId, botUserId: `${prefix}-bot`, repo: 'Example/Support',
    kind: 'comment', targetIssueNumber: 81 };
  const comments = await Promise.all([0, 1, 2].map(index => (index % 2 ? publicationCopy : publication)
    .createDraft({ body: `Synthetic technical proposal ${index}` }, { ...commentScope, sourceMessageId: `${prefix}-comment-${index}` })));
  assert.equal(new Set(comments.map(value => value.id)).size, 1, 'independent SQL creators share one unpublished case/target approval');
  assert.equal(comments.filter(value => value.created).length, 1, 'one creation winner may send a card');
  const winner = comments.find(value => value.created);
  assert.ok(comments.every(value => value.sourceMessageId === winner.sourceMessageId && value.payloadHash === winner.payloadHash));
  assert.equal(Number((await pool.query("SELECT COUNT(*) AS count FROM support_issue_approvals WHERE case_id=$1 AND LOWER(repository)=$2 AND kind='comment' AND target_issue_number=$3",
    [first.id, 'example/support', 81])).rows[0].count), 1);
  for (const status of ['filing', 'unknown']) {
    await pool.query('UPDATE support_issue_approvals SET status=$2 WHERE id=$1', [winner.id, status]);
    const held = await publicationCopy.createDraft({ body: 'A later event must not bypass uncertainty.' }, { ...commentScope, sourceMessageId: `${prefix}-later-${status}` });
    assert.equal(held.id, winner.id); assert.equal(held.created, false); assert.equal(held.payloadHash, winner.payloadHash);
  }
  await assert.rejects(() => publicationCopy.createDraft({ body: 'Another customer must not adopt this action.' },
    { ...commentScope, customerId: `${prefix}-unrelated-owner`, sourceMessageId: `${prefix}-unrelated-event` }), /scope/i);
  await pool.query("UPDATE support_issue_approvals SET status='filed' WHERE id=$1", [winner.id]);
  const subsequent = await publicationCopy.createDraft({ body: 'A new technical update after verified publication.' },
    { ...commentScope, sourceMessageId: `${prefix}-after-published` });
  assert.notEqual(subsequent.id, winner.id); assert.equal(subsequent.created, true);
  const scoped = { caseId: first.id, customerId: aliceInput.customerId, sourceMessageId: `${prefix}-report`,
    channelId: `${prefix}-staff`, threadId: aliceInput.channelId, botUserId: `${prefix}-bot`, repo: 'BasedHardware/omi', kind: 'issue' };
  const draft = await publication.createDraft({ title: 'Technical support report', body: 'Staff technical details pending review', labels: [] }, scoped);
  const duplicateDraft = await publicationCopy.createDraft({ title: 'Do not replace', body: 'This must not overwrite an existing scoped draft' }, { ...scoped, repo: 'basedhardware/OMI' });
  assert.equal(draft.id, duplicateDraft.id);
  assert.equal(draft.repo, 'basedhardware/omi');
  assert.equal(duplicateDraft.payloadHash, draft.payloadHash);
  const original = { ...scoped, cardMessageId: `${prefix}-card`, cardAuthorId: scoped.botUserId };
  await publication.bindCard(draft.id, original);
  const editing = await publication.beginEdit(draft.id, { ...original, authorized: true, staffId: `${prefix}-staff-user` });
  assert.equal(editing.ok, true);
  const reviewed = await publication.updateDraft(draft.id, { scope: scoped, staffId: `${prefix}-staff-user`, editToken: editing.editToken,
    draft: { title: 'App failure report', body: 'Support reviewed the technical reproduction and app version.' } });
  assert.ok(reviewed);
  const confirmation = { ...scoped, authorized: true, staffId: `${prefix}-staff-user`, cardAuthorId: scoped.botUserId,
    previewMessageId: `${prefix}-preview`, revision: reviewed.revision, payloadHash: reviewed.payloadHash };
  await publication.bindPreview(draft.id, confirmation);
  const concurrent = await Promise.all([publication.claimDraft(draft.id, confirmation), publicationCopy.claimDraft(draft.id, { ...confirmation, repo: 'BASEDHARDWARE/omi' })]);
  assert.equal(concurrent.filter((result) => result.ok).length, 1);
  const dispatch = concurrent.find((result) => result.ok);
  await publication.recordFiled(draft.id, { leaseToken: dispatch.leaseToken, number: 4242, url: 'https://github.com/BasedHardware/omi/issues/4242' });
  assert.equal((await publicationCopy.getDraft(draft.id)).status, 'filed');
  const storedPublication = (await pool.query('SELECT * FROM support_issue_approvals WHERE id=$1', [draft.id])).rows[0];
  assert.doesNotMatch(JSON.stringify(storedPublication), /Support reviewed the technical reproduction|App failure report/);
  const internalLinks = issueLinks.createIssueLinkService(issueLinks.createPostgresStore(pool), { getCase: service.getCaseById });
  await internalLinks.link({ repo: scoped.repo, issueNumber: 4242, caseId: first.id, customerId: aliceInput.customerId,
    channelId: aliceInput.channelId, threadId: scoped.threadId, sourceMessageId: scoped.sourceMessageId, approvedBy: `${prefix}-staff-user` });
  assert.equal((await internalLinks.findForSource(first.id, scoped.repo, scoped.sourceMessageId)).issueNumber, 4242);
  assert.equal(Number((await pool.query('SELECT COUNT(*) AS count FROM support_issue_approvals WHERE case_id=$1 AND LOWER(repository)=$2 AND source_message_id=$3',
    [first.id, 'basedhardware/omi', scoped.sourceMessageId])).rows[0].count), 1);

  // Transaction-only migration fixture in this dedicated test database. Removing
  // the new index reproduces the old schema; rollback restores it and all rows.
  const publishedApproval = await publication.getDraft(draft.id);
  const migration = await pool.connect();
  try {
    await migration.query('BEGIN');
    await migration.query('DROP INDEX support_issue_approvals_action_canonical_idx');
    const legacy = { ...publishedApproval, id: `${prefix}-legacy-variant`, repo: 'BasedHardware/omi' };
    const aad = Buffer.from(JSON.stringify([legacy.id, legacy.caseId, legacy.customerId, legacy.sourceMessageId,
      legacy.channelId, legacy.threadId, legacy.botUserId, legacy.repo, legacy.kind, legacy.targetIssueNumber, legacy.revision]));
    const plaintext = JSON.stringify(legacy.draft);
    const iv = Buffer.alloc(12, 11); const encryptionKey = Buffer.alloc(32, 19);
    const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv); cipher.setAAD(aad);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]).toString('base64');
    const payloadHash = createHmac('sha256', encryptionKey).update(aad).update(plaintext).digest('hex');
    await migration.query(`INSERT INTO support_issue_approvals
      (id,case_id,customer_id,source_message_id,channel_id,thread_id,bot_user_id,repository,kind,target_issue_number,
       payload_ciphertext,payload_iv,payload_tag,payload_hash,payload_revision,created_at,expires_at)
      SELECT $1,case_id,customer_id,source_message_id,channel_id,thread_id,bot_user_id,$2,kind,target_issue_number,
       $3,$4,$5,$6,payload_revision,created_at,expires_at FROM support_issue_approvals WHERE id=$7`,
    [legacy.id, legacy.repo, ciphertext, iv.toString('base64'), cipher.getAuthTag().toString('base64'), payloadHash, draft.id]);
    const legacyReader = approvals.createApprovalService(approvals.createPostgresStore(migration), { key: encryptionKey });
    assert.deepEqual((await legacyReader.getDraft(legacy.id)).draft, legacy.draft);
    const beforeMigration = (await migration.query('SELECT id,repository,payload_ciphertext,payload_iv,payload_tag,payload_hash FROM support_issue_approvals WHERE case_id=$1 AND source_message_id=$2 ORDER BY id',
      [first.id, scoped.sourceMessageId])).rows;
    assert.equal(beforeMigration.length, 2);
    await migration.query('SAVEPOINT before_canonical_migration');
    await assert.rejects(() => approvals.initSchema(migration), (error) => error.code === '23505');
    await migration.query('ROLLBACK TO SAVEPOINT before_canonical_migration');
    const afterMigration = (await migration.query('SELECT id,repository,payload_ciphertext,payload_iv,payload_tag,payload_hash FROM support_issue_approvals WHERE case_id=$1 AND source_message_id=$2 ORDER BY id',
      [first.id, scoped.sourceMessageId])).rows;
    assert.deepEqual(afterMigration, beforeMigration);
  } finally {
    await migration.query('ROLLBACK');
    migration.release();
  }
  console.log('Support database integration: schema upgrade, claims, lease recovery, queue, case isolation, live cards, acceptance notices, verification and revocation passed');
  console.log('GitHub approval integration: encrypted drafts, case-insensitive source uniqueness, single dispatch, private links and fail-safe migration passed');
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
  const contextChecks = await verifyMemoryContext(pool, `${prefix}-reader`);
  assert.equal(contextChecks.length, 8);
  console.log('Support memory SQL/live-reader rehearsal: 8 synthetic scenario groups passed; no Discord/provider calls');
  console.log('Support database integration: schema upgrade, claims, lease recovery, queue, case isolation, live cards, notices, verification, reference-only memory, forum erasure, edit/delete races, revocation and text-free thread languages passed');

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

  // Mandatory retention is global, bounded and independent of publication.
  const retentionNow = clock;
  const retainedInputs = ['retention-a', 'retention-b'].map((guild, index) => ({ ...input,
    guildId: `${prefix}-${guild}`, factId: 'retention-fact', expectedVersion: 0,
    provenance: [{ caseId: `${prefix}-expired-${index}`, expiresAt: retentionNow + 86400000 },
      { caseId: `${prefix}-live-${index}`, expiresAt: retentionNow + 30 * 86400000 }] }));
  for (const candidate of retainedInputs) {
    assert.equal((await first.propose(candidate, actor)).ok, true);
    assert.equal((await first.approve({ ...candidate, version: 1 }, actor)).ok, true);
  }
  const beforeCleanup = await firstStore.read(retainedInputs[0]);
  const priorStatementTimeout = (await pool.query("SELECT current_setting('statement_timeout') AS value")).rows[0].value;
  for (let i = 0; i < 101; i++) assert.equal((await first.propose({ ...input,
    guildId: `${prefix}-retention-bulk`, factId: 'bulk-' + String(i).padStart(3, '0'), expectedVersion: 0,
    provenance: [{ caseId: `${prefix}-bulk-expired`, expiresAt: retentionNow + 86400000 }] }, actor)).ok, true);
  await firstStore.eraseProvenance(retainedInputs[0].guildId, retentionNow - 31 * 86400000, [`${prefix}-old-barrier`]);
  await firstStore.eraseProvenance(retainedInputs[0].guildId, retentionNow, [`${prefix}-active-barrier`]);
  clock += 2 * 86400000;
  const raceAction = { ...retainedInputs[1], version: 1 };
  const [batch, revocation] = await Promise.all([firstStore.pruneExpiredProvenance(clock), second.revoke(raceAction, actor)]);
  assert.equal(batch.examined, 100); assert.equal(batch.remaining, true); assert.equal(revocation.ok, true);
  assert.equal(batch.barriersDeleted, 1);
  assert.deepEqual(await secondStore.pruneExpiredProvenance(clock), { examined: 3, barriersDeleted: 0, remaining: false });
  assert.equal((await pool.query("SELECT current_setting('statement_timeout') AS value")).rows[0].value, priorStatementTimeout);
  beforeCleanup.versions[0].provenance = retainedInputs[0].provenance.slice(1);
  assert.deepEqual(await secondStore.read(retainedInputs[0]), beforeCleanup, 'expiry changes provenance, not reviewed product state');
  assert.equal((await second.search(retainedInputs[0].guildId, 'task list'))[0].content, input.content);
  const revokedAfterCleanup = await firstStore.read(retainedInputs[1]);
  assert.equal(revokedAfterCleanup.versions[0].status, 'revoked');
  assert.equal(revokedAfterCleanup.publishedVersion, null);
  assert.deepEqual(revokedAfterCleanup.versions[0].provenance, retainedInputs[1].provenance.slice(1));
  assert.equal((await first.propose({ ...input, guildId: retainedInputs[0].guildId,
    factId: 'barrier-still-active', expectedVersion: 0,
    provenance: [{ caseId: `${prefix}-active-barrier`, expiresAt: clock + 86400000 }] }, actor)).ok, true);
  assert.deepEqual((await secondStore.read({ guildId: retainedInputs[0].guildId, factId: 'barrier-still-active' })).versions[0].provenance, []);
  assert.equal((await firstStore.pruneExpiredProvenance(clock)).examined, 0);
  console.log('Reviewed knowledge retention: global bounded expiry, restart, active barriers and concurrent revocation passed');

}

async function verifyKnowledgePrivacy(pool, prefix) {
  const at = Date.now(), DAY = 86400000;
  const registry = reviewedStore.createPostgresStore(pool), restarted = reviewedStore.createPostgresStore(pool);
  const caseService = cases.createCaseService(cases.createPostgresStore(pool));
  const memory = memoryStore.createPostgresStore(pool);
  const scope = { guildId: `${prefix}-privacy-guild`, forumId: `${prefix}-privacy-forum`,
    threadId: `${prefix}-privacy-thread`, customerId: `${prefix}-privacy-owner` };
  async function makeCase(overrides = {}) {
    const value = { ...scope, ...overrides };
    return caseService.getOrCreateCase({ guildId: value.guildId, forumId: value.forumId,
      channelId: value.threadId, customerThreadId: value.threadId, customerId: value.customerId });
  }
  const own = await makeCase();
  assert.equal(own.guildId, scope.guildId); assert.equal(own.forumId, scope.forumId);
  const rebound = await caseService.getOrCreateCase({ channelId: scope.threadId, customerThreadId: scope.threadId,
    customerId: scope.customerId, guildId: `${prefix}-not-the-guild`, forumId: `${prefix}-not-the-forum` });
  assert.equal(rebound.guildId, own.guildId); assert.equal(rebound.forumId, own.forumId);
  const others = [await makeCase({ customerId: `${prefix}-other-owner` }),
    await makeCase({ forumId: `${prefix}-other-forum`, threadId: `${prefix}-other-forum-thread` }),
    await makeCase({ guildId: `${prefix}-other-guild`, threadId: `${prefix}-other-guild-thread` })];
  async function fact(factId, references, guildId = scope.guildId) {
    const state = { latestVersion: 1, publishedVersion: 1, updatedAt: at,
      versions: [{ version: 1, status: 'published', content: 'Synthetic independent product fact.',
        approvedBy: `${prefix}-staff`, approvedAt: at, provenance: references.map(value => ({ caseId: value.id, expiresAt: at + DAY })) }] };
    await registry.mutate({ guildId, factId }, () => ({ state, result: true }), { create: true });
    return state;
  }
  for (let i = 0; i < 101; i++) await fact('privacy-' + String(i).padStart(3, '0'), [own, ...others]);
  const original = await restarted.read({ guildId: scope.guildId, factId: 'privacy-100' });
  assert.deepEqual(await registry.eraseOwnedReferences(scope, at), { ok: false, reason: 'opt_out_required' });
  await registry.eraseProvenance(scope.guildId, at, [own.id]);
  await memory.put({ ...scope, messageId: `${prefix}-private-reference`, role: 'customer', at, expiresAt: at + DAY }, at);
  const previousForum = process.env.HELP_FORUM_CHANNEL_ID;
  process.env.HELP_FORUM_CHANNEL_ID = scope.forumId;
  try {
    const { forgetOwnedThread } = require('../supportLearning');
    const { eraseOwnedKnowledge } = require('../supportKnowledgePrivacy');
    const channel = { id: scope.threadId, guildId: scope.guildId, parentId: scope.forumId,
      ownerId: scope.customerId, isThread: () => true, name: 'Synthetic support' };
    assert.equal(await forgetOwnedThread(channel, scope.customerId, { store: memory,
      eraseKnowledge: value => eraseOwnedKnowledge(value, { store: registry, now: () => at }) }), true);
    assert.deepEqual(await memory.list(scope, at), []);
    assert.equal(await memory.isSuppressed(scope, at), true);
    original.versions[0].provenance = original.versions[0].provenance.filter(item => item.caseId !== own.id);
    assert.deepEqual(await restarted.read({ guildId: scope.guildId, factId: 'privacy-100' }), original);
    assert.equal((await pool.query('SELECT case_id FROM support_knowledge_erasures WHERE guild_id=$1 AND case_id=$2', [scope.guildId,own.id])).rows.length, 0,
      'the permanent owner opt-out replaces unnecessary case-specific erasure pointers');
    assert.deepEqual(await restarted.eraseOwnedReferences(scope, at), { ok: true, examined: 0, remaining: false });
    const late = await makeCase({ threadId: `${prefix}-post-after-opt-out` });
    await fact('privacy-late-writer', [own, late, others[0]]);
    assert.deepEqual((await restarted.read({ guildId: scope.guildId, factId: 'privacy-late-writer' })).versions[0].provenance.map(item => item.caseId), [others[0].id]);

    const retryScope = { ...scope, customerId: `${prefix}-retry-owner`, threadId: `${prefix}-retry-post` };
    const retryCase = await makeCase(retryScope);
    for (let i = 0; i < 3; i++) await fact('privacy-retry-' + i, [retryCase]);
    await memory.forgetCustomer(retryScope);
    const retry = await restarted.pruneExpiredProvenance(at);
    assert.equal(retry.examined, 3);
    assert.deepEqual((await registry.read({ guildId: scope.guildId, factId: 'privacy-retry-2' })).versions[0].provenance, []);

    const raceScope = { ...scope, customerId: `${prefix}-privacy-race-owner`, threadId: `${prefix}-privacy-race-post` };
    const raceCase = await makeCase(raceScope);
    await fact('privacy-race', [raceCase]);
    await Promise.all([
      registry.mutate({ guildId: scope.guildId, factId: 'privacy-race' }, state => ({ state, result: true })),
      (async () => { await memory.forgetCustomer(raceScope); return restarted.eraseOwnedReferences(raceScope, at); })(),
    ]);
    assert.deepEqual((await registry.read({ guildId: scope.guildId, factId: 'privacy-race' })).versions[0].provenance, []);

    const legacyScope = { ...scope, guildId: `${prefix}-legacy-privacy`, customerId: `${prefix}-legacy-privacy-owner` };
    const legacyCase = await caseService.getOrCreateCase({ channelId: `${prefix}-legacy-privacy-post`, customerId: legacyScope.customerId });
    await fact('legacy-unverifiable', [legacyCase], legacyScope.guildId);
    await memory.forgetCustomer(legacyScope);
    assert.deepEqual(await registry.eraseOwnedReferences(legacyScope, at), { ok: false, reason: 'unverifiable' });
    assert.equal((await registry.read({ guildId: legacyScope.guildId, factId: 'legacy-unverifiable' })).versions[0].provenance.length, 1);
    await restarted.pruneExpiredProvenance(at);
    assert.equal((await registry.read({ guildId: legacyScope.guildId, factId: 'legacy-unverifiable' })).versions[0].provenance.length, 1,
      'the automatic sweep cannot guess a missing forum and erase an unverified legacy link');
    const orphanScope = { ...scope, guildId: `${prefix}-orphan-privacy` };
    await fact('orphan-unverifiable', [{ id: `${prefix}-no-case-record` }], orphanScope.guildId);
    await memory.forgetCustomer(orphanScope);
    assert.deepEqual(await registry.eraseOwnedReferences(orphanScope, at), { ok: false, reason: 'unverifiable' });
    const orphanBarrierScope = { ...scope, guildId: `${prefix}-orphan-barrier-privacy` };
    await registry.eraseProvenance(orphanBarrierScope.guildId, at, [`${prefix}-orphan-barrier`]);
    await memory.forgetCustomer(orphanBarrierScope);
    assert.deepEqual(await registry.eraseOwnedReferences(orphanBarrierScope, at), { ok: false, reason: 'unverifiable' },
      'unidentified deletion markers cannot be silently excluded from a full-deletion claim');
    const noPostScope = { ...scope, guildId: `${prefix}-no-post-privacy` };
    const noPostCase = await caseService.getOrCreateCase({ guildId: noPostScope.guildId, forumId: noPostScope.forumId,
      customerId: noPostScope.customerId, channelId: `${prefix}-not-a-post` });
    await fact('unverified-post', [noPostCase], noPostScope.guildId);
    await memory.forgetCustomer(noPostScope);
    assert.deepEqual(await registry.eraseOwnedReferences(noPostScope, at), { ok: false, reason: 'unverifiable' });
    await restarted.pruneExpiredProvenance(at);
    assert.equal((await registry.read({ guildId: noPostScope.guildId, factId: 'unverified-post' })).versions[0].provenance.length, 1,
      'automatic erasure must require the same complete post scope as command erasure');
  } finally {
    if (previousForum === undefined) delete process.env.HELP_FORUM_CHANNEL_ID; else process.env.HELP_FORUM_CHANNEL_ID = previousForum;
  }
  console.log('Reviewed knowledge privacy: owned forum erasure, preserved facts and other scopes, late writes, retry cleanup and legacy refusal passed');
}

(async () => {
  const pool = await isolatedPool();
  try { await verify(pool); } finally { await pool.end(); }
})().catch((error) => {
  // SQL and connection errors can contain inputs. Never dump them or a URL.
  console.error(`Support database integration failed: ${error.name}; code=${String(error.code || 'check_failed').replace(/[^A-Za-z0-9_]/g, '')}`);
  process.exitCode = 1;
});
