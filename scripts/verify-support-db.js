// Integration fixtures only: never point this script at a customer database.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const runtime = require('../supportRuntime');
const cases = require('../supportCases');
const { SupportIdentityStore, initSchema: initIdentity } = require('../supportIdentityStore');

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
  for (let count = 0; count < 2; count++) {
    await runtime.initSchema(pool); await cases.initSchema(pool); await initIdentity(pool);
  }
  const prefix = `test-${randomUUID()}`;
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
  await service.resolveCase(first.id, { close: true, confirmed: true });
  assert.equal((await service.reopenByThread(`${prefix}-handoff`, aliceInput.customerId)).status, 'queued');

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
  console.log('Support database integration: schema, claims, queue, case isolation, verification and revocation passed');
}

(async () => {
  const pool = await isolatedPool();
  try { await verify(pool); } finally { await pool.end(); }
})().catch((error) => {
  // SQL and connection errors can contain inputs. Never dump them or a URL.
  console.error(`Support database integration failed: ${error.name}; code=${String(error.code || 'check_failed').replace(/[^A-Za-z0-9_]/g, '')}`);
  process.exitCode = 1;
});
