const test = require('node:test');
const assert = require('node:assert/strict');
const { PermissionFlagsBits: P } = require('discord.js');
const { validateStaffDestination } = require('../discordPrivacy');
const { makeStaffChannel } = require('./fixtures/discord-staff-channel');

const check = (fixture, options = {}) => validateStaffDestination(fixture.channel, { botUserId: fixture.botUserId, ...options });

test('a private channel with trusted moderation and the bot managed role passes actual SDK permission resolution', () => {
  assert.deepEqual(check(makeStaffChannel()), { ok: true, code: 'private_staff_destination' });
});

test('everyone view access and incomplete ACL objects fail closed', () => {
  const fixture = makeStaffChannel();
  fixture.channel.permissionOverwrites.cache.delete(fixture.guild.id);
  assert.equal(check(fixture).code, 'everyone_can_view');
  assert.equal(validateStaffDestination({ isTextBased: () => true }, { botUserId: 'bot' }).ok, false);
  const incomplete = makeStaffChannel();
  incomplete.channel.permissionsFor = () => null;
  assert.equal(check(incomplete).code, 'guild_acl_unavailable');
});

test('an ordinary role assigned to the bot never becomes a trusted audience role', () => {
  const fixture = makeStaffChannel();
  const ordinary = fixture.role('customer-role', [P.ViewChannel, P.SendMessages]);
  fixture.roles.set(ordinary.id, ordinary);
  fixture.guild.members.me.roles.cache.set(ordinary.id, ordinary);
  fixture.channel.permissionOverwrites.cache.set(ordinary.id, fixture.overwrite(ordinary.id, 0, [P.ViewChannel]));
  assert.equal(check(fixture).code, 'untrusted_role_can_view');
  assert.equal(check(fixture, { staffRoleIds: [ordinary.id] }).ok, true);
});

test('unconfigured member view grants require cached verified staff authority', () => {
  const fixture = makeStaffChannel();
  const memberId = 'direct-user';
  fixture.channel.permissionOverwrites.cache.set(memberId, fixture.overwrite(memberId, 1, [P.ViewChannel]));
  assert.equal(check(fixture).code, 'member_acl_unverifiable');
  assert.equal(check(fixture, { staffUsers: [memberId] }).ok, true);
  fixture.members.set(memberId, { id: memberId, roles: { cache: new Map([[fixture.guild.id, fixture.roles.get(fixture.guild.id)]]) } });
  assert.equal(check(fixture).code, 'untrusted_member_can_view');
  fixture.members.get(memberId).roles.cache.set('staff-role', fixture.roles.get('staff-role'));
  assert.equal(check(fixture).ok, true);
});

test('unknown role overwrites and missing bot permission reject without exposing ACL identifiers', () => {
  const fixture = makeStaffChannel();
  fixture.channel.permissionOverwrites.cache.set('unknown-role', fixture.overwrite('unknown-role', 0, [P.ViewChannel]));
  assert.deepEqual(check(fixture), { ok: false, code: 'role_acl_unavailable' });
  fixture.channel.permissionOverwrites.cache.delete('unknown-role');
  fixture.channel.permissionOverwrites.cache.delete('bot-role');
  assert.deepEqual(check(fixture), { ok: false, code: 'bot_cannot_send' });
});
