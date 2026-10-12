const test = require('node:test');
const assert = require('node:assert/strict');
const { Client, Routes, Guild, PermissionFlagsBits: P } = require('discord.js');

test('preflight uses REST metadata without gateway login and permanently refuses writes', async () => {
  const client = new Client({ intents: [] }); const f = restMetadata();
  const reads = [];
  client.rest.get = async route => {
    reads.push(route);
    return f.responses.get(route);
  };
  const result = await require('../scripts/preflight-staff-destination').runReadOnlyPreflight(client, { channelId: f.channelId });
  assert.equal(result.readOnly, true);
  assert.equal(result.code, 'private_staff_destination');
  assert.equal(result.ok, true);
  assert.deepEqual(reads, [Routes.user('@me'), Routes.channel(f.channelId), Routes.guild(f.guildId),
    Routes.guildRoles(f.guildId), Routes.guildMember(f.guildId, f.botId), Routes.channel(f.channelId)]);
  for (const method of ['post', 'put', 'patch', 'delete']) await assert.rejects(() => client.rest[method]('/anything'), /Read-only preflight/);
  client.destroy();
});

test('missing configuration fails without making a REST read', async () => {
  const client = new Client({ intents: [] }); let reads = 0;
  client.rest.get = async () => { reads++; throw new Error('must not read'); };
  const result = await require('../scripts/preflight-staff-destination').runReadOnlyPreflight(client, { channelId: '' });
  assert.equal(result.ok, false); assert.equal(result.code, 'staff_destination_missing');
  assert.equal(reads, 0); client.destroy();
});

function restMetadata({ unavailable = false } = {}) {
  const guildId = '234567890123456789', channelId = '334567890123456789', botId = '434567890123456789';
  const staffRole = '534567890123456789', botRole = '634567890123456789';
  const user = { id: botId, username: 'fixture-bot', discriminator: '0', bot: true };
  const role = (id, permissions, extra = {}) => ({ id, name: 'fixture-role', permissions: String(permissions), color: 0, position: 1, managed: false, ...extra });
  const roles = [role(guildId, P.ViewChannel | P.SendMessages), role(staffRole, P.ManageThreads | P.ViewChannel | P.SendMessages),
    role(botRole, P.ViewChannel | P.SendMessages, { managed: true, tags: { bot_id: botId } })];
  const guild = { id: guildId, name: 'fixture-guild', owner_id: '734567890123456789', roles, features: [], unavailable };
  const channel = { id: channelId, guild_id: guildId, name: 'fixture-staff', type: 0,
    permission_overwrites: [{ id: guildId, type: 0, allow: '0', deny: String(P.ViewChannel) },
      { id: staffRole, type: 0, allow: String(P.ViewChannel), deny: '0' },
      { id: botRole, type: 0, allow: String(P.ViewChannel), deny: '0' }] };
  const member = { user, roles: [botRole], joined_at: '2026-01-01T00:00:00Z', deaf: false, mute: false };
  const responses = new Map([[Routes.user('@me'), user], [Routes.channel(channelId), channel],
    [Routes.guild(guildId), guild], [Routes.guildRoles(guildId), roles], [Routes.guildMember(guildId, botId), member]]);
  return { guildId, channelId, botId, guild, responses };
}

test('a REST-only SDK guild snapshot verifies without faking a gateway-ready flag', async () => {
  const client = new Client({ intents: [] }); const f = restMetadata(); const reads = [];
  assert.equal(new Guild(client, f.guild).available, false, 'a bare REST guild lacks gateway channel state');
  client.rest.get = async route => { reads.push(route); assert.ok(f.responses.has(route)); return f.responses.get(route); };
  const result = await require('../scripts/preflight-staff-destination').runReadOnlyPreflight(client, { channelId: f.channelId });
  assert.equal(result.code, 'private_staff_destination');
  assert.equal(result.ok, true); assert.equal(result.readRequests, 6); assert.equal(result.singleMemberReads, 1);
  assert.deepEqual(reads, [Routes.user('@me'), Routes.channel(f.channelId), Routes.guild(f.guildId),
    Routes.guildRoles(f.guildId), Routes.guildMember(f.guildId, f.botId), Routes.channel(f.channelId)]);
  assert.equal(client.options.intents.bitfield, 0);
  for (const method of ['post', 'put', 'patch', 'delete']) await assert.rejects(() => client.rest[method]('/anything'), /Read-only preflight/);
  client.destroy();
});

test('REST hydration never overrides an actual unavailable or mismatched guild proof', async () => {
  for (const mutation of [f => { f.guild.unavailable = true; }, f => { f.guild.id = '834567890123456789'; }]) {
    const client = new Client({ intents: [] }); const f = restMetadata(); mutation(f);
    client.rest.get = async route => f.responses.get(route);
    const result = await require('../scripts/preflight-staff-destination').runReadOnlyPreflight(client, { channelId: f.channelId });
    assert.equal(result.ok, false); assert.equal(result.code, 'guild_acl_unavailable'); client.destroy();
  }
});
