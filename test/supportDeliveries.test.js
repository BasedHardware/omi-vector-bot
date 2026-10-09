const test = require('node:test');
const assert = require('node:assert/strict');
const { createMemoryStore, createPostgresStore, createDeliveryService, classifyDeliveryError, isDeliveryUncertain, initSchema } = require('../supportDeliveries');
const { DiscordTransportError } = require('../supportDiscordTransport');

const scope = (extra = {}) => ({ operationKey: 'answer:source', kind: 'answer', sourceMessageId: 'source', customerId: 'alice',
  channelId: 'customer-channel', botUserId: 'bot', caseId: null, referenceMessageId: 'source', ...extra });
const receipt = (nonce, extra = {}) => ({ id: 'receipt', nonce, author: { id: 'bot', bot: true }, channelId: 'customer-channel', reference: { messageId: 'source' }, ...extra });
const gate = () => { let release; const promise = new Promise((resolve) => { release = resolve; }); return { promise, release }; };
const closureScope = (extra = {}) => scope({ operationKey: 'closure:case:0:customer-channel', kind: 'closure', sourceMessageId: 'customer-channel',
  caseId: 'case', caseGeneration: 0, referenceMessageId: null, approvalId: null, ...extra });
const closureMessage = (nonce, extra = {}) => receipt(undefined, { reference: null, components: [{ type: 1, components: [
  { type: 2, customId: `rate:yes:${nonce}` }, { type: 2, customId: `rate:no:${nonce}` },
] }], ...extra });

test('only delivery metadata persists, accepted receipts survive restart, and scope conflicts never send', async () => {
  const store = createMemoryStore();
  const first = createDeliveryService(store);
  let posts = 0;
  const send = async ({ nonce, enforceNonce }) => { posts++; assert.equal(enforceNonce, true); assert.match(nonce, /^[0-9a-f]{24}$/); return receipt(nonce, { content: 'PRIVATE_CUSTOMER_BODY' }); };
  await first.send(scope({ payload: { content: 'SECRET_EMAIL@example.test' } }), send);
  const restarted = createDeliveryService(createMemoryStore(store.state));
  const reused = await restarted.send(scope(), send);
  assert.equal(reused.id, 'receipt'); assert.equal(posts, 1);
  await assert.rejects(restarted.send(scope({ customerId: 'bob' }), send), (error) => error.deliveryBlocked === true);
  assert.doesNotMatch(JSON.stringify([...store.state.deliveries.values()]), /PRIVATE_CUSTOMER_BODY|SECRET_EMAIL|payload|content/);
});

test('concurrent senders share one atomic dispatch and the second is held', async () => {
  const store = createMemoryStore();
  const first = createDeliveryService(store); const second = createDeliveryService(store);
  const held = gate(); const started = gate(); let posts = 0;
  const pending = first.send(scope(), async ({ nonce }) => { posts++; started.release(); await held.promise; return receipt(nonce); });
  await started.promise;
  await assert.rejects(second.send(scope(), async () => { posts++; }), isDeliveryUncertain);
  assert.equal(posts, 1); held.release(); await pending;
});

test('uncertain transport, server errors and invalid receipts are never automatically retried', async () => {
  for (const mode of ['socket', 'server', 'missing', 'wrong-author', 'wrong-channel', 'missing-author', 'missing-channel']) {
    const service = createDeliveryService(createMemoryStore()); let posts = 0;
    await assert.rejects(service.send(scope(), async ({ nonce }) => {
      posts++;
      if (mode === 'socket') throw Object.assign(new Error('PRIVATE_SOCKET_BODY'), { code: 'ECONNRESET' });
      if (mode === 'server') throw Object.assign(new Error('PRIVATE_HTTP_BODY'), { status: 503, code: 50013 });
      if (mode === 'missing') return {};
      if (mode === 'missing-author') return receipt(nonce, { author: undefined });
      if (mode === 'missing-channel') return receipt(nonce, { channelId: undefined });
      return receipt(nonce, mode === 'wrong-author' ? { author: { id: 'another-bot' } } : { channelId: 'wrong-channel' });
    }), (error) => isDeliveryUncertain(error) && !error.message.includes('PRIVATE'));
    await assert.rejects(service.send(scope(), async () => posts++), isDeliveryUncertain);
    assert.equal(posts, 1); assert.equal((await service.listHeld()).length, 1);
    assert.deepEqual(await service.pendingReceipts(), []);
  }
});

test('definitive Discord rejection preserves only code/status and caps retries at three in ten minutes', async () => {
  let now = 1000;
  const service = createDeliveryService(createMemoryStore(), { now: () => now }); let posts = 0;
  const reject = async () => { posts++; throw Object.assign(new Error('PRIVATE_PROVIDER_RESPONSE'), { code: 10008, status: 404 }); };
  for (let attempt = 0; attempt < 3; attempt++) {
    await assert.rejects(service.send(scope(), reject), (error) => error.deliveryRejected && error.code === 10008 && error.status === 404 && !error.message.includes('PRIVATE'));
  }
  await assert.rejects(service.send(scope(), reject), (error) => error.deliveryBlocked);
  assert.equal(posts, 3);
  assert.deepEqual(await service.pendingReceipts(), []);
  const later = createDeliveryService(createMemoryStore(), { now: () => now });
  await assert.rejects(later.send(scope(), reject), (error) => error.deliveryRejected);
  now += 10 * 60_000 + 1;
  await assert.rejects(later.send(scope(), reject), (error) => error.deliveryBlocked);
  assert.equal(posts, 4);
});

test('known rejected delivery can retry successfully with the same nonce', async () => {
  const service = createDeliveryService(createMemoryStore()); let nonce;
  await assert.rejects(service.send(scope(), async (options) => { nonce = options.nonce; throw { status: 403, code: 50013 }; }), (error) => error.deliveryRejected);
  await service.send(scope(), async (options) => { assert.equal(options.nonce, nonce); return receipt(options.nonce); });
  assert.equal((await service.get('answer:source')).attemptCount, 2);
});

test('database failure blocks before POST and cannot downgrade to an in-memory send', async () => {
  const service = createDeliveryService(createPostgresStore({ query: async () => { throw new Error('PRIVATE_DATABASE_FAILURE'); } }));
  let posts = 0;
  await assert.rejects(service.send(scope(), async () => posts++), (error) => error.deliveryBlocked && !error.message.includes('PRIVATE'));
  assert.equal(posts, 0);
});

test('lost accepted receipt persistence remains held and exposes only receipt metadata', async () => {
  const base = createMemoryStore();
  const service = createDeliveryService({ ...base, accepted: async () => { throw new Error('PRIVATE_SQL_RESPONSE'); } });
  let nonce;
  await assert.rejects(service.send(scope(), async (options) => { nonce = options.nonce; return receipt(nonce, { content: 'PRIVATE_CUSTOMER_BODY' }); }),
    (error) => isDeliveryUncertain(error) && error.receipt.id === 'receipt' && !JSON.stringify(error).includes('PRIVATE'));
  assert.equal((await service.get('answer:source')).state, 'unknown');
  const restarted = createDeliveryService(base);
  const repaired = await restarted.acceptGatewayReceipt(receipt(nonce));
  assert.equal(repaired.state, 'accepted'); assert.equal(repaired.messageId, 'receipt');
  assert.equal((await restarted.pendingReceipts()).length, 1);
});

test('gateway reconciliation requires exact nonce, bot, channel and reply reference', async () => {
  const service = createDeliveryService(createMemoryStore()); let nonce;
  await assert.rejects(service.send(scope(), async (options) => { nonce = options.nonce; throw new Error('timeout'); }), isDeliveryUncertain);
  for (const invalid of [receipt('wrong'), receipt(nonce, { author: { id: 'alice' } }), receipt(nonce, { channelId: 'other' }), receipt(nonce, { reference: { messageId: 'other-source' } }), receipt(nonce, { reference: null }), receipt(nonce, { webhook_id: 'webhook' }),
    receipt(nonce, { reference: { messageId: 'source', type: 1 } }), receipt(nonce, { message_snapshots: [{ message: {} }] }), receipt(nonce, { messageSnapshots: new Map([['snapshot', {}]]) })]) {
    assert.equal(await service.acceptGatewayReceipt(invalid), null);
  }
  const accepted = await service.acceptGatewayReceipt(receipt(nonce));
  assert.equal(accepted.state, 'accepted');
  assert.equal(await service.acceptGatewayReceipt(receipt(nonce, { id: 'different-receipt' })), null);
});

test('a proven gateway acceptance survives a later REST error and never overwrites its first receipt', async () => {
  const service = createDeliveryService(createMemoryStore());
  const returned = await service.send(scope(), async ({ nonce }) => {
    const accepted = await service.acceptGatewayReceipt(receipt(nonce));
    assert.equal(accepted.messageId, 'receipt');
    assert.equal(await service.acceptGatewayReceipt(receipt(nonce, { id: 'other-receipt' })), null);
    throw Object.assign(new Error('PRIVATE_TIMEOUT_DETAIL'), { status: 503 });
  });
  assert.equal(returned.id, 'receipt');
  assert.equal((await service.get('answer:source')).state, 'accepted');
});

test('gateway acceptance racing an unknown transition is returned without false unknown telemetry', async () => {
  const base = createMemoryStore(); const logs = [];
  const store = { ...base, failed: async (id, token, state, code, status, at) => {
    if (state === 'unknown') { await base.accepted(id, token, 'gateway-race-receipt', at); return null; }
    return base.failed(id, token, state, code, status, at);
  } };
  const service = createDeliveryService(store, { log: (line) => logs.push(line) });
  const result = await service.send(scope(), async () => { throw new Error('timeout'); });
  assert.equal(result.id, 'gateway-race-receipt');
  assert.equal((await service.get('answer:source')).state, 'accepted');
  assert.equal(logs.some((line) => line.includes('state=unknown')), false);
});

test('trusted preflight rejection, 429 and only specific missing-reference proof remain definitive', async () => {
  const service = createDeliveryService(createMemoryStore());
  await assert.rejects(service.send(scope(), async () => { throw new DiscordTransportError('PRIVATE_DETAIL', { code: 'DISCORD_UPLOADS_UNSUPPORTED', outcome: 'known_rejected', dispatched: false }); }),
    (error) => error.deliveryRejected && error.code === 'DISCORD_UPLOADS_UNSUPPORTED' && !error.message.includes('PRIVATE'));
  assert.equal(classifyDeliveryError(new DiscordTransportError('limited', { code: 'DISCORD_RATE_LIMITED', status: 429, outcome: 'known_rejected', dispatched: true })).outcome, 'rejected');
  const generic = createDeliveryService(createMemoryStore());
  await assert.rejects(generic.send(scope(), async () => { throw { status: 400, code: 50035 }; }), (error) => error.deliveryRejected && error.referenceMissing !== true);
  const specific = createDeliveryService(createMemoryStore());
  await assert.rejects(specific.send(scope(), async () => { throw Object.assign(new DiscordTransportError('invalid', { status: 400, code: 50035, outcome: 'known_rejected', dispatched: true }), { referenceMissing: true }); }),
    (error) => error.deliveryRejected && error.referenceMissing === true);
});

test('state telemetry contains only opaque delivery ID, kind and state', async () => {
  const logs = []; const service = createDeliveryService(createMemoryStore(), { log: (line) => logs.push(line) });
  await service.send(scope(), async ({ nonce }) => receipt(nonce));
  assert.equal(logs.length, 2);
  for (const line of logs) assert.match(line, /^\[Delivery\] id=[0-9a-f-]{36} kind=answer state=(dispatching|accepted)$/);
  assert.doesNotMatch(logs.join('\n'), /alice|source|customer-channel|nonce|operationKey/);
});

test('expired dispatch is held and keeps immutable staff case generation', async () => {
  let now = 0;
  const store = createMemoryStore(); const service = createDeliveryService(store, { now: () => now, attemptTtlMs: 10 });
  const staff = scope({ operationKey: 'staff:source', kind: 'staff-card', caseId: 'case', caseGeneration: 0, referenceMessageId: null });
  const held = gate(); const started = gate();
  const sending = service.send(staff, async ({ nonce }) => { started.release(); await held.promise; return receipt(nonce, { reference: null }); });
  await started.promise; now = 11;
  assert.equal((await service.listHeld()).length, 1);
  await assert.rejects(service.send(staff, async () => assert.fail('must not retry expired dispatch')), isDeliveryUncertain);
  await assert.rejects(service.send({ ...staff, caseGeneration: 1 }, async () => assert.fail('must not change generation')), (error) => error.deliveryBlocked);
  held.release(); await sending;
});

test('staff approval control provenance cannot be added or replaced after delivery', async () => {
  const service = createDeliveryService(createMemoryStore(), { log: () => {} });
  const staff = scope({ operationKey: 'staff-card:source', kind: 'staff-card', caseId: 'case', referenceMessageId: null, approvalId: 'original-approval' });
  await service.send(staff, async ({ nonce }) => receipt(nonce, { reference: null }));
  assert.equal((await service.get(staff.operationKey)).approvalId, 'original-approval');
  await assert.rejects(service.send({ ...staff, approvalId: 'another-approval' }, async () => assert.fail('must not dispatch different approval')), (error) => error.deliveryBlocked);
  assert.equal((await service.get(staff.operationKey)).approvalId, 'original-approval');
});

test('local projection repairs use due accepted receipts with bounded backoff and never resend', async () => {
  let now = 1000; let posts = 0;
  const service = createDeliveryService(createMemoryStore(), { now: () => now });
  await service.send(scope(), async ({ nonce }) => { posts++; return receipt(nonce); });
  const row = (await service.pendingReceipts())[0];
  await service.deferProjection(row.id);
  assert.deepEqual(await service.pendingReceipts(), []);
  now += 30_000;
  assert.equal((await service.pendingReceipts()).length, 1);
  const deferred = await service.deferProjection(row.id); assert.equal(deferred.projectionAttempts, 2);
  assert.equal(deferred.nextProjectionAt, now + 60_000);
  const projected = await service.markProjected(row.id);
  now += 1;
  assert.equal((await service.markProjected(row.id)).projectedAt, projected.projectedAt);
  assert.equal(await service.deferProjection(row.id), null);
  assert.deepEqual(await service.pendingReceipts(), []);
  assert.equal((await service.recentAnswers({ since: 0 }))[0].messageId, 'receipt');
  assert.equal(posts, 1);
});

test('inspection limits are bounded and errors without definite rejection proof stay unknown', () => {
  const service = createDeliveryService(createMemoryStore());
  assert.throws(() => service.pendingReceipts(1000), (error) => error.deliveryBlocked);
  assert.deepEqual(classifyDeliveryError({ status: 500, code: 50013 }), { outcome: 'unknown', status: 500, code: 50013 });
  assert.equal(classifyDeliveryError({ status: 408 }).outcome, 'unknown');
  assert.equal(classifyDeliveryError({ code: 'ETIMEDOUT' }).outcome, 'unknown');
});

test('closure schema migration is repeatable and preserves existing delivery rows', async () => {
  const calls = [];
  const client = { query: async (sql) => { calls.push(sql); return { rows: [] }; } };
  await initSchema(client); await initSchema(client);
  assert.equal(calls[0], calls[1]);
  assert.match(calls[0], /DROP CONSTRAINT IF EXISTS support_deliveries_kind_check/);
  assert.match(calls[0], /ADD CONSTRAINT support_deliveries_kind_check CHECK\(kind IN \('answer','staff-card','closure'\)\)/);
  assert.doesNotMatch(calls[0], /DELETE|TRUNCATE|DROP TABLE/);
});

test('closure scope requires the immutable case epoch, thread origin and canonical operation', async () => {
  const store = createMemoryStore(); const service = createDeliveryService(store, { log: () => {} }); let posts = 0;
  for (const invalid of [
    { caseId: null }, { caseGeneration: null }, { caseGeneration: undefined }, { caseGeneration: -1 }, { caseGeneration: 0.5 },
    { sourceMessageId: 'new-question' }, { referenceMessageId: 'question' }, { approvalId: 'approval' },
    { operationKey: 'closure:another-case:0:customer-channel' }, { operationKey: 'closure:case:1:customer-channel' },
  ]) await assert.rejects(service.send(closureScope(invalid), async () => posts++), (error) => error.deliveryBlocked);
  assert.equal(posts, 0); assert.equal(store.state.deliveries.size, 0);
  await service.send(closureScope({ content: 'PRIVATE_CUSTOMER_CONTENT' }), async ({ nonce }) => { posts++; return receipt(nonce, { reference: null }); });
  const row = await service.get('closure:case:0:customer-channel');
  assert.equal(row.kind, 'closure'); assert.equal(row.caseGeneration, 0); assert.equal(row.sourceMessageId, row.channelId);
  assert.equal((await service.getByNonce(row.nonce)).id, row.id);
  assert.equal(await service.getByNonce('not-a-nonce'), null);
  assert.equal(await service.getByNonce('a'.repeat(24)), null);
  await service.send(closureScope(), async () => assert.fail('accepted closure must not resend'));
  assert.equal(posts, 1); assert.doesNotMatch(JSON.stringify([...store.state.deliveries.values()]), /PRIVATE_CUSTOMER_CONTENT|content/);
});

test('trusted closure feedback can repair a held receipt without manufacturing a Gateway nonce', async () => {
  const store = createMemoryStore(); const service = createDeliveryService(store, { log: () => {} }); let nonce; let posts = 0;
  await assert.rejects(service.send(closureScope(), async (options) => { posts++; nonce = options.nonce; throw new Error('timeout'); }), isDeliveryUncertain);
  const message = closureMessage(nonce);
  assert.equal(await service.acceptGatewayReceipt(message), null);
  const restarted = createDeliveryService(createMemoryStore(store.state), { log: () => {} });
  const accepted = await restarted.acceptClosureInteractionReceipt(closureMessage(nonce, { components: [{ type: 1, components: [
    { type: 2, custom_id: `rate:yes:${nonce}` }, { type: 2, custom_id: `rate:no:${nonce}` },
  ] }] }), nonce);
  assert.equal(accepted.state, 'accepted'); assert.equal(accepted.messageId, 'receipt'); assert.equal(accepted.caseId, 'case');
  assert.equal(accepted.caseGeneration, 0); assert.equal(accepted.referenceMessageId, null);
  assert.equal((await restarted.send(closureScope(), async () => assert.fail('feedback repair must not repost'))).id, 'receipt');
  assert.equal(posts, 1);
});

test('closure feedback rejects forged authors, channels, controls, references, webhooks and forwards', async () => {
  const service = createDeliveryService(createMemoryStore(), { log: () => {} }); let nonce;
  await assert.rejects(service.send(closureScope(), async (options) => { nonce = options.nonce; throw new Error('timeout'); }), isDeliveryUncertain);
  const badPair = (first, second, type = 2) => [{ type: 1, components: [{ type, customId: first }, { type, customId: second }] }];
  for (const changes of [
    { id: '' }, { author: { id: 'alice', bot: false } }, { author: { id: 'other-bot', bot: true } }, { channelId: 'other-thread' },
    { nonce: 'b'.repeat(24) }, { components: [] },
    { components: badPair(`rate:yes:${nonce}`, 'rate:no:wrong') },
    { components: badPair(`rate:yes:${nonce}`, `rate:no:${nonce}`, 3) },
    { components: [{ type: 2, components: badPair(`rate:yes:${nonce}`, `rate:no:${nonce}`)[0].components }] },
    { reference: { messageId: 'customer-message' } }, { message_reference: { message_id: 'customer-message' } },
    { webhookId: 'webhook' }, { webhook_id: 'webhook' }, { reference: { type: 1 } }, { message_reference: { type: 1 } },
    { messageSnapshots: new Map([['snapshot', {}]]) }, { message_snapshots: [{ message: {} }] },
  ]) assert.equal(await service.acceptClosureInteractionReceipt(closureMessage(nonce, changes), nonce), null);
  assert.equal((await service.getByNonce(nonce)).state, 'unknown');
  assert.equal(await service.acceptClosureInteractionReceipt(closureMessage(nonce), 'invalid'), null);
  assert.equal((await service.acceptClosureInteractionReceipt(closureMessage(nonce), nonce)).state, 'accepted');
});

test('closure feedback cannot attest another case nonce or an answer/staff-card operation', async () => {
  const service = createDeliveryService(createMemoryStore(), { log: () => {} }); const nonces = new Map();
  const inputs = [closureScope(), closureScope({ caseId: 'other-case', operationKey: 'closure:other-case:0:customer-channel' }),
    scope(), scope({ kind: 'staff-card', operationKey: 'staff:source', referenceMessageId: null })];
  for (const input of inputs) await assert.rejects(service.send(input, async ({ nonce }) => { nonces.set(input.operationKey, nonce); throw new Error('timeout'); }), isDeliveryUncertain);
  const first = nonces.get(inputs[0].operationKey), second = nonces.get(inputs[1].operationKey);
  assert.equal(await service.acceptClosureInteractionReceipt(closureMessage(second), first), null);
  for (const input of inputs.slice(2)) {
    const nonce = nonces.get(input.operationKey);
    assert.equal(await service.acceptClosureInteractionReceipt(closureMessage(nonce), nonce), null);
  }
  assert.equal((await service.getByNonce(first)).state, 'unknown');
});

test('closure feedback accepted message ID is stable and rejected operations cannot be attested', async () => {
  const service = createDeliveryService(createMemoryStore(), { log: () => {} }); let nonce;
  await service.send(closureScope(), async (options) => { nonce = options.nonce; return receipt(nonce, { reference: null }); });
  const before = await service.getByNonce(nonce);
  assert.equal((await service.acceptClosureInteractionReceipt(closureMessage(nonce), nonce)).acceptedAt, before.acceptedAt);
  assert.equal(await service.acceptClosureInteractionReceipt(closureMessage(nonce, { id: 'different-message' }), nonce), null);
  assert.equal((await service.getByNonce(nonce)).messageId, 'receipt');
  const rejected = createDeliveryService(createMemoryStore(), { log: () => {} }); let rejectedNonce;
  await assert.rejects(rejected.send(closureScope(), async (options) => { rejectedNonce = options.nonce; throw { status: 403, code: 50013 }; }), (error) => error.deliveryRejected);
  assert.equal(await rejected.acceptClosureInteractionReceipt(closureMessage(rejectedNonce), rejectedNonce), null);
  assert.equal((await rejected.getByNonce(rejectedNonce)).state, 'rejected');
});

test('closure feedback can win the REST-error race without replay or overwriting the first accepted message', async () => {
  const service = createDeliveryService(createMemoryStore(), { log: () => {} });
  const result = await service.send(closureScope(), async ({ nonce }) => {
    const results = await Promise.all([
      service.acceptClosureInteractionReceipt(closureMessage(nonce), nonce),
      service.acceptClosureInteractionReceipt(closureMessage(nonce, { id: 'other-message' }), nonce),
    ]);
    assert.equal(results[0].messageId, 'receipt'); assert.equal(results[1], null);
    throw new Error('timeout');
  });
  assert.equal(result.id, 'receipt');
});
