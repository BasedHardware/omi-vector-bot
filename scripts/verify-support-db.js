// Integration fixtures only: never point this script at a customer database.
const assert = require('node:assert/strict');
const { randomUUID, createCipheriv, createHmac } = require('node:crypto');
const runtime = require('../supportRuntime');
const cases = require('../supportCases');
const { SupportIdentityStore, initSchema: initIdentity } = require('../supportIdentityStore');
const approvals = require('../supportApprovals');
const issueLinks = require('../supportIssueLinks');
const deliveries = require('../supportDeliveries');

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
    await approvals.initSchema(pool); await issueLinks.initSchema(pool);
    await deliveries.initSchema(pool);
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
  const reopened = await service.reopenByThread(`${prefix}-handoff`, aliceInput.customerId);
  assert.equal(reopened.status, 'queued'); assert.equal(reopened.generation, 1);
  assert.equal(reopened.acceptedBy, null); assert.equal(reopened.acceptedAt, null); assert.equal(reopened.deliveryId, null);
  assert.equal(await service.markDelivered(first.id, { messageId: `${prefix}-old-receipt`, destination: 'staff-channel', expectedGeneration: 0 }), null);
  assert.equal((await service.markDelivered(first.id, { messageId: `${prefix}-new-receipt`, destination: 'staff-channel', expectedGeneration: 1 })).status, 'delivered');

  let deliveryNow = Date.now();
  const deliveryStore = deliveries.createPostgresStore(pool);
  const delivery = deliveries.createDeliveryService(deliveryStore, { now: () => deliveryNow, log: () => {} });
  const deliveryCopy = deliveries.createDeliveryService(deliveryStore, { now: () => deliveryNow, log: () => {} });
  const deliveryScope = { operationKey: `${prefix}:answer`, kind: 'answer', sourceMessageId: `${prefix}-source`, customerId: aliceInput.customerId,
    channelId: aliceInput.channelId, botUserId: `${prefix}-bot`, caseId: first.id, caseGeneration: 1, referenceMessageId: `${prefix}-source` };
  const makeReceipt = (nonce, id = `${prefix}-message-receipt`) => ({ id, nonce, author: { id: deliveryScope.botUserId, bot: true },
    channelId: deliveryScope.channelId, reference: { messageId: deliveryScope.referenceMessageId } });
  let releaseSend; let beganSend;
  const sendGate = new Promise((resolve) => { releaseSend = resolve; });
  const began = new Promise((resolve) => { beganSend = resolve; });
  let deliveryPosts = 0;
  const activeSend = delivery.send({ ...deliveryScope, payload: 'SYNTHETIC_PRIVATE_PAYLOAD' }, async ({ nonce, enforceNonce }) => {
    deliveryPosts++; assert.equal(enforceNonce, true); beganSend(); await sendGate; return makeReceipt(nonce);
  });
  await began;
  await assert.rejects(deliveryCopy.send(deliveryScope, async () => { deliveryPosts++; }), deliveries.isDeliveryUncertain);
  releaseSend(); await activeSend;
  assert.equal((await deliveryCopy.send(deliveryScope, async () => { deliveryPosts++; })).id, `${prefix}-message-receipt`);
  assert.equal(deliveryPosts, 1);
  await assert.rejects(deliveryCopy.send({ ...deliveryScope, customerId: bob.customerId }, async () => assert.fail('wrong customer cannot send')), (error) => error.deliveryBlocked);
  const storedDelivery = (await pool.query('SELECT * FROM support_deliveries WHERE operation_key=$1', [deliveryScope.operationKey])).rows[0];
  assert.doesNotMatch(JSON.stringify(storedDelivery), /SYNTHETIC_PRIVATE_PAYLOAD/);
  assert.equal(storedDelivery.case_generation, 1);
  const acceptedDelivery = await delivery.get(deliveryScope.operationKey);
  assert.ok((await delivery.pendingReceipts(100)).some((row) => row.id === acceptedDelivery.id));
  const projection = await delivery.deferProjection(acceptedDelivery.id);
  assert.equal(projection.projectionAttempts, 1);
  assert.equal(new Date(projection.nextProjectionAt).getTime(), deliveryNow + 30_000);
  assert.equal((await delivery.pendingReceipts(100)).some((row) => row.id === acceptedDelivery.id), false);
  deliveryNow += 30_000;
  assert.ok((await delivery.pendingReceipts(100)).some((row) => row.id === acceptedDelivery.id));
  await delivery.markProjected(acceptedDelivery.id);
  assert.equal((await delivery.pendingReceipts(100)).some((row) => row.id === acceptedDelivery.id), false);
  assert.equal(await delivery.deferProjection(acceptedDelivery.id), null);
  assert.ok((await delivery.recentAnswers({ since: 0 })).some((row) => row.id === acceptedDelivery.id));
  const unknownScope = { ...deliveryScope, operationKey: `${prefix}:unknown` }; let unknownNonce;
  await assert.rejects(delivery.send(unknownScope, async ({ nonce }) => { unknownNonce = nonce; throw new Error('SYNTHETIC_PRIVATE_ERROR'); }), deliveries.isDeliveryUncertain);
  await assert.rejects(deliveryCopy.send(unknownScope, async () => assert.fail('held delivery cannot replay')), deliveries.isDeliveryUncertain);
  assert.equal(await delivery.acceptGatewayReceipt({ ...makeReceipt(unknownNonce), author: { id: 'wrong-bot' } }), null);
  const gatewayDelivery = await delivery.acceptGatewayReceipt(makeReceipt(unknownNonce, `${prefix}-gateway`));
  assert.equal(gatewayDelivery.state, 'accepted'); assert.equal(gatewayDelivery.messageId, `${prefix}-gateway`);
  const rejectedScope = { ...deliveryScope, operationKey: `${prefix}:rejected` };
  for (let attempt = 0; attempt < 3; attempt++) await assert.rejects(delivery.send(rejectedScope, async () => { throw { status: 403, code: 50013 }; }), (error) => error.deliveryRejected);
  await assert.rejects(delivery.send(rejectedScope, async () => assert.fail('retry cap must block')), (error) => error.deliveryBlocked);
  assert.equal((await delivery.get(rejectedScope.operationKey)).attemptCount, 3);
  assert.equal((await delivery.pendingReceipts(100)).some((row) => row.operationKey === rejectedScope.operationKey), false);
  const staffScope = { ...deliveryScope, operationKey: `${prefix}:staff`, kind: 'staff-card', referenceMessageId: null, caseGeneration: 1, approvalId: `${prefix}-approval` };
  await delivery.send(staffScope, async ({ nonce }) => ({ ...makeReceipt(nonce, `${prefix}-staff-receipt`), reference: null }));
  assert.equal((await delivery.get(staffScope.operationKey)).approvalId, staffScope.approvalId);
  await assert.rejects(delivery.send({ ...staffScope, approvalId: `${prefix}-different-approval` }, async () => assert.fail('cannot change bound approval')), (error) => error.deliveryBlocked);

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
  console.log('Support database integration: schema, claims, queue, case isolation, verification and revocation passed');
  console.log('GitHub approval integration: encrypted drafts, case-insensitive source uniqueness, single dispatch, private links and fail-safe migration passed');
  console.log('Delivery ledger integration: single dispatch, scope/generation guards, metadata receipts, unknown holds, gateway proof and projection backoff passed');
}

(async () => {
  const pool = await isolatedPool();
  try { await verify(pool); } finally { await pool.end(); }
})().catch((error) => {
  // SQL and connection errors can contain inputs. Never dump them or a URL.
  console.error(`Support database integration failed: ${error.name}; code=${String(error.code || 'check_failed').replace(/[^A-Za-z0-9_]/g, '')}`);
  process.exitCode = 1;
});
