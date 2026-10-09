const assert = require('node:assert/strict');
const test = require('node:test');
const { REST } = require('discord.js');
const { createThreadTransport, editDiscordThread, setThreadTransportForTests } = require('../supportThreadTransport');

const THREAD_ID = '111111111111111111';
const TAG_ONE = '222222222222222222';
const TAG_TWO = '333333333333333333';
function fixture() {
  const client = { token: 'FIXTURE_THREAD_TOKEN', rest: { options: { retries: 3 }, patch: () => assert.fail('Shared client REST must not mutate a tracked thread') } };
  const channel = { id: THREAD_ID, isThread: () => true, archived: false,
    edit: () => assert.fail('SDK thread editor must not be used'), setArchived: () => assert.fail('SDK archive fallback must not be used') };
  return { client, channel };
}
function response(extra = {}) {
  return { id: THREAD_ID, type: 11, name: 'PRIVATE_NAME_NOT_RETURNED', topic: 'PRIVATE_TOPIC_NOT_RETURNED',
    thread_metadata: { archived: true, locked: false }, applied_tags: [TAG_ONE, TAG_TWO], ...extra };
}

test('isolated thread transport maps only supported fields and returns actual metadata without names', async () => {
  const { client, channel } = fixture(); let configuration; let patched;
  const transport = createThreadTransport({ restFactory: (options) => {
    configuration = options;
    return { setToken: (token) => assert.equal(token, client.token), patch: async (route, options) => {
      patched = { route, ...options }; return response({ applied_tags: [TAG_TWO, TAG_ONE] });
    } };
  } });
  const result = await transport.editDiscordThread(client, channel, { archived: true, locked: false, appliedTags: [TAG_ONE, TAG_TWO] });
  assert.equal(configuration.version, '10'); assert.equal(configuration.retries, 0); assert.equal(configuration.timeout, 15000);
  assert.equal(configuration.rejectOnRateLimit({}), true);
  assert.equal(patched.route, `/channels/${THREAD_ID}`);
  assert.deepEqual(patched.body, { archived: true, locked: false, applied_tags: [TAG_ONE, TAG_TWO] });
  assert.equal(patched.signal instanceof AbortSignal, true);
  assert.deepEqual(result, { id: THREAD_ID, archived: true, locked: false, appliedTags: [TAG_TWO, TAG_ONE] });
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|name|topic/);
  assert.equal(channel.archived, false, 'actual proof is returned, not invented into an SDK cache');
  assert.equal(client.rest.options.retries, 3);
});

test('empty tag selection is a supported clear operation and unrelated response metadata is omitted', async () => {
  const { client, channel } = fixture();
  const transport = createThreadTransport({ restFactory: () => ({ setToken: () => {}, patch: async () => response({ applied_tags: [] }) }) });
  assert.deepEqual(await transport.editDiscordThread(client, channel, { appliedTags: [] }), { id: THREAD_ID, appliedTags: [] });
});

test('unsupported fields and invalid flag/tag values are rejected before any REST call', async () => {
  const { client, channel } = fixture(); let factories = 0;
  const transport = createThreadTransport({ restFactory: () => { factories++; assert.fail('Preflight must reject'); } });
  for (const changes of [null, [], {}, { name: 'PRIVATE_NAME' }, { archived: true, reason: 'PRIVATE_REASON' },
    { applied_tags: [TAG_ONE] }, { topic: 'PRIVATE_TOPIC' }, { archived: 1 }, { archived: undefined }, { locked: 'false' },
    { appliedTags: [TAG_ONE, TAG_ONE] }, { appliedTags: Array.from({ length: 6 }, (_, i) => String(i + 1)) },
    { appliedTags: ['0'] }, { appliedTags: ['leading-space '] }, { appliedTags: [123] }, { appliedTags: {} }]) {
    await assert.rejects(transport.editDiscordThread(client, channel, changes), (error) => error.outcome === 'known_rejected' && !error.dispatched);
  }
  assert.equal(factories, 0);
});

test('missing credentials and non-thread or invalid channel identities fail closed before REST', async () => {
  const { client, channel } = fixture(); let factories = 0;
  const transport = createThreadTransport({ restFactory: () => { factories++; assert.fail('Preflight must reject'); } });
  for (const candidate of [{ ...channel, id: 'invalid' }, { ...channel, id: '0' }, { ...channel, id: 123 },
    { ...channel, isThread: () => false }, { id: THREAD_ID }, null]) {
    await assert.rejects(transport.editDiscordThread(client, candidate, { archived: true }), (error) => error.code === 'DISCORD_THREAD_INVALID' && !error.dispatched);
  }
  for (const token of [null, '', '   ', 123]) {
    await assert.rejects(transport.editDiscordThread({ ...client, token }, channel, { archived: true }), (error) => error.code === 'DISCORD_THREAD_TRANSPORT_UNCONFIGURED');
  }
  assert.equal(factories, 0);
});

test('actual REST reset and 5xx responses make one PATCH and expose no raw cause or request', async () => {
  const { client, channel } = fixture();
  for (const mode of ['reset', '500']) {
    let attempts = 0;
    const transport = createThreadTransport({ restFactory: (options) => new REST({ ...options, makeRequest: async () => {
      attempts++;
      if (mode === 'reset') throw Object.assign(new Error('CANARY_PRIVATE_REQUEST_TOKEN'), { code: 'ECONNRESET' });
      return new Response('CANARY_PRIVATE_REQUEST_TOKEN', { status: 500 });
    } }) });
    await assert.rejects(transport.editDiscordThread(client, channel, { archived: true }), (error) => {
      assert.equal(error.outcome, 'unknown'); assert.equal(error.dispatched, true);
      assert.doesNotMatch(JSON.stringify(error), /CANARY|FIXTURE_THREAD_TOKEN/);
      assert.doesNotMatch(String(error.stack), /CANARY|FIXTURE_THREAD_TOKEN/);
      assert.equal(error.cause, undefined); assert.equal(error.requestBody, undefined); assert.equal(error.rawError, undefined);
      return true;
    });
    assert.equal(attempts, 1);
  }
});

test('actual REST 429 is rejected immediately rather than sleeping or sending another PATCH', async () => {
  const { client, channel } = fixture(); let attempts = 0;
  const transport = createThreadTransport({ restFactory: (options) => new REST({ ...options, makeRequest: async () => {
    attempts++;
    return new Response(JSON.stringify({ message: 'Rate limited', retry_after: 120, global: false }), {
      status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': '120' },
    });
  } }) });
  await assert.rejects(transport.editDiscordThread(client, channel, { archived: true }), (error) => error.outcome === 'known_rejected' && error.status === 429);
  assert.equal(attempts, 1);
});

test('an overall deadline stops a hanging PATCH even when its adapter ignores cancellation', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { client, channel } = fixture(); let signal;
  const transport = createThreadTransport({ timeoutMs: 100, restFactory: () => ({ setToken: () => {}, patch: async (_route, options) => {
    signal = options.signal; return new Promise(() => {});
  } }) });
  const result = assert.rejects(transport.editDiscordThread(client, channel, { archived: true }), (error) => error.outcome === 'unknown' && error.code === 'DISCORD_THREAD_TIMEOUT');
  for (let count = 0; count < 8; count++) await Promise.resolve();
  assert.equal(signal.aborted, false);
  t.mock.timers.tick(100); await result;
  assert.equal(signal.aborted, true);
});

test('sanitized permission rejection retains only the status/code needed for a deliberate fallback', async () => {
  const { client, channel } = fixture();
  const transport = createThreadTransport({ restFactory: () => ({ setToken: () => {}, patch: async () => {
    throw Object.assign(new Error('CANARY_PRIVATE_ERROR_DETAILS'), { status: 403, code: 50013,
      rawError: { message: 'CANARY_PRIVATE_ERROR_DETAILS' }, requestBody: { content: 'CANARY_PRIVATE_ERROR_DETAILS' } });
  } }) });
  await assert.rejects(transport.editDiscordThread(client, channel, { archived: true, locked: true }), (error) => {
    assert.equal(error.outcome, 'known_rejected'); assert.equal(error.status, 403); assert.equal(error.code, 50013);
    assert.equal(error.dispatched, true); assert.doesNotMatch(JSON.stringify(error), /CANARY/); assert.equal(error.rawError, undefined);
    return true;
  });
});

test('missing or mismatching response proof is held rather than filled from the requested flags', async () => {
  const { client, channel } = fixture();
  const examples = [{}, { ...response(), id: '999999999999999999' }, { ...response(), id: 111 },
    { ...response(), thread_metadata: undefined }, { ...response(), thread_metadata: { archived: false, locked: false } },
    { ...response(), thread_metadata: { archived: true } }, { ...response(), applied_tags: undefined },
    { ...response(), applied_tags: [TAG_ONE] }, { ...response(), applied_tags: [TAG_ONE, TAG_ONE] }];
  for (const raw of examples) {
    let attempts = 0;
    const transport = createThreadTransport({ restFactory: () => ({ setToken: () => {}, patch: async () => { attempts++; return raw; } }) });
    await assert.rejects(transport.editDiscordThread(client, channel, { archived: true, locked: false, appliedTags: [TAG_ONE, TAG_TWO] }),
      (error) => error.outcome === 'unknown' && error.dispatched === true);
    assert.equal(attempts, 1);
  }
});

test('singleton test injection can be removed without changing the production adapter', async (t) => {
  const { client, channel } = fixture(); let tuple;
  setThreadTransportForTests(async (...args) => { tuple = args; return { id: THREAD_ID, archived: true }; });
  t.after(() => setThreadTransportForTests(null));
  assert.deepEqual(await editDiscordThread(client, channel, { archived: true }), { id: THREAD_ID, archived: true });
  assert.deepEqual(tuple, [client, channel, { archived: true }]);
  setThreadTransportForTests(null);
  await assert.rejects(editDiscordThread({ ...client, token: null }, channel, { archived: true }), (error) => error.code === 'DISCORD_THREAD_TRANSPORT_UNCONFIGURED');
});
