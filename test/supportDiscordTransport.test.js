const assert = require('node:assert/strict');
const test = require('node:test');
const { REST, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { createTransport, sendDiscordMessage, setTransportForTests } = require('../supportDiscordTransport');

const CHANNEL_ID = '111111111111111111';
const SOURCE_ID = '222222222222222222';
const BOT_ID = '333333333333333333';

function fixture() {
  const client = { token: 'FIXTURE_BOT_TOKEN', user: { id: BOT_ID }, options: {
    jsonTransformer: (value) => value, failIfNotExists: true, enforceNonce: false,
  }, rest: { options: { retries: 3 }, post: () => assert.fail('Global client REST must not be used') } };
  const channel = { id: CHANNEL_ID, client, messages: { resolveId: (value) => String(value) },
    send: () => assert.fail('SDK sender must not be used'), reply: () => assert.fail('SDK reply must not be used') };
  const payload = { content: 'A safe support reply.', nonce: '0123456789abcdef01234567', enforceNonce: true,
    allowedMentions: { parse: [], users: [], roles: [], repliedUser: false } };
  return { client, channel, payload };
}

function response(extra = {}) {
  return { id: '444444444444444444', channel_id: CHANNEL_ID, author: { id: BOT_ID, bot: true }, nonce: '0123456789abcdef01234567', ...extra };
}

test('isolated transport resolves nonce, mention, embed and component options into API fields without using SDK send', async () => {
  const { client, channel, payload } = fixture(); let configuration; let posted;
  const transport = createTransport({ restFactory: (options) => {
    configuration = options;
    return { setToken: (token) => assert.equal(token, client.token), post: async (route, options) => { posted = { route, ...options }; return response(); } };
  } });
  payload.embeds = [{ title: 'Staff intake', description: 'A minimized support card.' }];
  payload.components = [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('case:accept:opaque').setLabel('Accept case').setStyle(ButtonStyle.Primary))];
  const sent = await transport.sendDiscordMessage(client, channel, payload);
  assert.equal(configuration.version, '10'); assert.equal(configuration.retries, 0); assert.equal(configuration.timeout, 15000);
  assert.equal(configuration.rejectOnRateLimit({}), true);
  assert.equal(posted.route, `/channels/${CHANNEL_ID}/messages`);
  assert.equal(posted.body.nonce, payload.nonce); assert.equal(posted.body.enforce_nonce, true);
  assert.deepEqual(posted.body.allowed_mentions, { parse: [], users: [], roles: [], replied_user: false });
  assert.equal(posted.body.embeds[0].title, 'Staff intake'); assert.equal(posted.body.components[0].components[0].custom_id, 'case:accept:opaque');
  assert.equal(posted.signal instanceof AbortSignal, true);
  assert.equal(sent.channelId, CHANNEL_ID); assert.equal(sent.channel_id, CHANNEL_ID); assert.equal(sent.author.id, BOT_ID);
  assert.equal(client.rest.options.retries, 3);
});

test('reply relation is explicit and missing source cannot silently become a normal message', async () => {
  const { client, channel, payload } = fixture(); let posted;
  const transport = createTransport({ restFactory: () => ({ setToken: () => {}, post: async (_route, options) => {
    posted = options.body;
    return response({ message_reference: { message_id: SOURCE_ID, channel_id: CHANNEL_ID, guild_id: '555555555555555555', type: 0 } });
  } }) });
  const sent = await transport.sendDiscordMessage(client, channel, payload, { replyToMessageId: SOURCE_ID });
  assert.deepEqual(posted.message_reference, { message_id: SOURCE_ID, fail_if_not_exists: true });
  assert.deepEqual(sent.reference, { messageId: SOURCE_ID, channelId: CHANNEL_ID, guildId: '555555555555555555', type: 0 });
});

test('uploads, missing nonce, unsupported references and missing token fail before a REST attempt', async () => {
  const { client, channel, payload } = fixture(); let factories = 0;
  const transport = createTransport({ restFactory: () => { factories++; assert.fail('Preflight must reject'); } });
  for (const body of [
    { ...payload, files: ['https://private.example/recording.wav'] },
    { ...payload, attachments: [{ id: '1', filename: 'private.txt' }] },
    { ...payload, nonce: undefined }, { ...payload, nonce: 'x'.repeat(26) },
    { ...payload, enforceNonce: false }, { ...payload, reply: { messageReference: SOURCE_ID } },
    { ...payload, forward: { message: SOURCE_ID } },
  ]) await assert.rejects(transport.sendDiscordMessage(client, channel, body), (error) => error.outcome === 'known_rejected' && !error.dispatched);
  await assert.rejects(transport.sendDiscordMessage({ ...client, token: null }, channel, payload), (error) => error.code === 'DISCORD_TRANSPORT_UNCONFIGURED');
  assert.equal(factories, 0);
});

test('actual REST adapter makes one attempt for reset or 5xx and never exposes token/payload in errors', async () => {
  const { client, channel, payload } = fixture(); const logs = []; const oldLog = console.error;
  console.error = (...args) => logs.push(args.join(' '));
  try {
    for (const mode of ['reset', '500']) {
      let attempts = 0;
      const transport = createTransport({ restFactory: (options) => new REST({ ...options, makeRequest: async () => {
        attempts++;
        if (mode === 'reset') throw Object.assign(new Error('CANARY_TOKEN_AND_PRIVATE_PAYLOAD'), { code: 'ECONNRESET' });
        return new Response('CANARY_TOKEN_AND_PRIVATE_PAYLOAD', { status: 500 });
      } }) });
      await assert.rejects(transport.sendDiscordMessage(client, channel, payload), (error) => {
        assert.equal(error.outcome, 'unknown'); assert.equal(error.dispatched, true);
        assert.equal(JSON.stringify(error).includes('CANARY'), false);
        assert.equal(String(error.stack).includes(client.token), false);
        assert.equal(error.requestBody, undefined); assert.equal(error.cause, undefined);
        return true;
      });
      assert.equal(attempts, 1);
    }
    assert.equal(logs.length, 0);
  } finally { console.error = oldLog; }
});

test('actual REST adapter rejects a 429 instead of sleeping or re-posting', async () => {
  const { client, channel, payload } = fixture(); let attempts = 0;
  const transport = createTransport({ restFactory: (options) => new REST({ ...options, makeRequest: async () => {
    attempts++;
    return new Response(JSON.stringify({ message: 'Rate limited', retry_after: 120, global: false }), {
      status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': '120' },
    });
  } }) });
  await assert.rejects(transport.sendDiscordMessage(client, channel, payload), (error) => error.outcome === 'known_rejected' && error.status === 429);
  assert.equal(attempts, 1);
});

test('overall abort deadline bounds a pending send even when an injected sender ignores cancellation', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { client, channel, payload } = fixture(); let signal;
  const transport = createTransport({ timeoutMs: 100, restFactory: () => ({ setToken: () => {}, post: async (_route, options) => { signal = options.signal; return new Promise(() => {}); } }) });
  const result = assert.rejects(transport.sendDiscordMessage(client, channel, payload), (error) => error.outcome === 'unknown' && error.code === 'DISCORD_DELIVERY_TIMEOUT');
  for (let count = 0; count < 8; count++) await Promise.resolve();
  assert.equal(signal.aborted, false);
  t.mock.timers.tick(100);
  await result;
  assert.equal(signal.aborted, true);
});

test('API error code is preserved for explicit missing-reference handling without raw request data', async () => {
  const { client, channel, payload } = fixture();
  const transport = createTransport({ restFactory: () => ({ setToken: () => {}, post: async () => {
    throw Object.assign(new Error('CANARY_PRIVATE_DETAILS'), { status: 404, code: 10008, requestBody: { content: 'CANARY_PRIVATE_DETAILS' } });
  } }) });
  await assert.rejects(transport.sendDiscordMessage(client, channel, payload, { replyToMessageId: SOURCE_ID }), (error) => error.code === 10008 && error.referenceMissing === true && error.outcome === 'known_rejected' && !JSON.stringify(error).includes('CANARY'));
});

test('generic invalid-form errors do not become missing-reference failures through their text', async () => {
  const { client, channel, payload } = fixture();
  const transport = createTransport({ restFactory: () => ({ setToken: () => {}, post: async () => {
    throw Object.assign(new Error('Unknown message CANARY_PRIVATE_DETAILS'), { status: 400, code: 50035,
      rawError: { code: 50035, errors: { content: { _errors: [{ code: 'BASE_TYPE_MAX_LENGTH', message: 'CANARY_PRIVATE_DETAILS' }] } } } });
  } }) });
  await assert.rejects(transport.sendDiscordMessage(client, channel, payload, { replyToMessageId: SOURCE_ID }), (error) => {
    assert.equal(error.code, 50035); assert.equal(error.referenceMissing, false);
    assert.equal(JSON.stringify(error).includes('CANARY'), false); assert.equal(error.rawError, undefined);
    return true;
  });
});

test('the exact nested Discord missing-reference subcode survives only as a fixed boolean', async () => {
  const { client, channel, payload } = fixture();
  const transport = createTransport({ restFactory: () => ({ setToken: () => {}, post: async () => {
    throw Object.assign(new Error('CANARY_PRIVATE_DETAILS'), { status: 400, code: 50035,
      rawError: { code: 50035, errors: { message_reference: { _errors: [{ code: 'MESSAGE_REFERENCE_UNKNOWN_MESSAGE', message: 'CANARY_PRIVATE_DETAILS' }] } } } });
  } }) });
  await assert.rejects(transport.sendDiscordMessage(client, channel, payload, { replyToMessageId: SOURCE_ID }), (error) => {
    assert.equal(error.code, 50035); assert.equal(error.referenceMissing, true); assert.equal(error.outcome, 'known_rejected');
    assert.equal(error.rawError, undefined); assert.equal(JSON.stringify(error).includes('CANARY'), false);
    return true;
  });
});

test('receipt proof is not filled from intended author, channel or nonce when REST omits it', async () => {
  const { client, channel, payload } = fixture();
  const transport = createTransport({ restFactory: () => ({ setToken: () => {}, post: async () => ({ id: '444444444444444444' }) }) });
  const sent = await transport.sendDiscordMessage(client, channel, payload);
  assert.equal(sent.channelId, undefined); assert.equal(sent.author, undefined); assert.equal(sent.nonce, undefined); assert.equal(sent.reference, null);
});

test('singleton test hook is explicit, receives the ordinary send signature and can be removed', async (t) => {
  const { client, channel, payload } = fixture(); let received;
  setTransportForTests(async (...args) => { received = args; return response(); });
  t.after(() => setTransportForTests(null));
  await sendDiscordMessage(client, channel, payload, { replyToMessageId: SOURCE_ID });
  assert.deepEqual(received, [client, channel, payload, { replyToMessageId: SOURCE_ID }]);
  setTransportForTests(null);
  await assert.rejects(sendDiscordMessage({ ...client, token: null }, channel, payload), (error) => error.code === 'DISCORD_TRANSPORT_UNCONFIGURED');
});
