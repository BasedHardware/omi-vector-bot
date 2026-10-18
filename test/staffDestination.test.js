const test = require('node:test');
const assert = require('node:assert/strict');
const { makeStaffChannel } = require('./fixtures/discord-staff-channel');

function bootFixture(t) {
  const before = process.env.STAFF_ALERT_CHANNEL_ID;
  process.env.STAFF_ALERT_CHANNEL_ID = 'fixture-staff';
  t.after(() => { if (before === undefined) delete process.env.STAFF_ALERT_CHANNEL_ID; else process.env.STAFF_ALERT_CHANNEL_ID = before; });
  const fixture = makeStaffChannel({ id: 'fixture-staff', send: async () => { throw new Error('preflight must not post to Discord'); } });
  const reads = [], alerts = [], logs = [];
  const client = { user: { id: fixture.botUserId }, channels: { fetch: async (id, options) => { reads.push({ id, options }); return fixture.channel; } } };
  const options = { alert: async content => { alerts.push(content); return true; },
    log: message => logs.push(message), error: message => logs.push(message) };
  return { fixture, reads, alerts, logs, client, options };
}

test('boot checks the fresh configured staff destination without posting when private', async t => {
  const f = bootFixture(t);
  const result = await require('../staffDestination').checkBootStaffDestination(f.client, f.options);
  assert.deepEqual(result, { ok: true, code: 'private_staff_destination' });
  assert.deepEqual(f.reads, [{ id: 'fixture-staff', options: { force: true } }]);
  assert.equal(f.alerts.length, 0);
  assert.match(f.logs[0], /private_staff_destination/);
});

test('unsafe boot destination has a metadata-only rejection and one Telegram alert', async t => {
  const f = bootFixture(t); f.fixture.channel.permissionOverwrites.cache.delete(f.fixture.guild.id);
  const result = await require('../staffDestination').checkBootStaffDestination(f.client, f.options);
  assert.deepEqual(result, { ok: false, code: 'everyone_can_view' });
  assert.equal(f.alerts.length, 1);
  assert.match(f.alerts[0], /everyone_can_view/);
  assert.match(f.alerts[0], /blocked/i);
  assert.doesNotMatch(f.alerts.join(' ') + f.logs.join(' '), /fixture-staff|guild-id|bot-user|Thread:|User asked:/);
});

test('boot read errors and failed alerts are explicit without leaking exception content', async t => {
  const f = bootFixture(t);
  f.client.channels.fetch = async () => { throw new Error('private-fixture@example.test SECRET_SENTINEL'); };
  f.options.alert = async () => { throw new Error('SECRET_SENTINEL'); };
  const result = await require('../staffDestination').checkBootStaffDestination(f.client, f.options);
  assert.deepEqual(result, { ok: false, code: 'staff_channel_unavailable' });
  assert.match(f.logs.join(' '), /alert not confirmed/);
  assert.doesNotMatch(f.logs.join(' '), /SECRET_SENTINEL|private-fixture/);
});

test('the read-only preflight rejects a wrong fetched destination before checking ACLs', async t => {
  const f = bootFixture(t); f.fixture.channel.id = 'wrong-channel';
  const result = await require('../discordPrivacy').checkConfiguredStaffDestination(f.client);
  assert.deepEqual(result, { ok: false, code: 'staff_channel_unavailable' });
});

test('operational Telegram alert is bounded and does not log a transport exception', async t => {
  const axios = require('axios'); const id = require.resolve('../telegram');
  const old = { module: require.cache[id], token: process.env.TELEGRAM_TOKEN, chat: process.env.TELEGRAM_CHAT_ID,
    post: axios.post, error: console.error };
  process.env.TELEGRAM_TOKEN = 'synthetic-token'; process.env.TELEGRAM_CHAT_ID = 'synthetic-chat';
  delete require.cache[id];
  t.after(() => { require.cache[id] = old.module; axios.post = old.post; console.error = old.error;
    for (const [key, value] of [['TELEGRAM_TOKEN', old.token], ['TELEGRAM_CHAT_ID', old.chat]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  const requests = [], logs = []; console.error = message => logs.push(message);
  axios.post = async (_url, body, options) => { requests.push({ body, options }); return { data: { ok: true } }; };
  const telegram = require('../telegram');
  assert.equal(await telegram.sendOperationalAlert('Metadata-only boot alert'), true);
  assert.deepEqual(requests[0], { body: { chat_id: 'synthetic-chat', text: 'Metadata-only boot alert' }, options: { timeout: 10000 } });
  axios.post = async () => { throw new Error('SECRET_SENTINEL private fixture'); };
  assert.equal(await telegram.sendOperationalAlert('Metadata-only boot alert'), false);
  assert.doesNotMatch(logs.join(' '), /SECRET_SENTINEL|private fixture|synthetic-token/);
});
