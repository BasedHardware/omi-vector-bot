const test = require('node:test');
const assert = require('node:assert/strict');
const { PermissionFlagsBits: P } = require('discord.js');
const { validateStaffDestination } = require('../discordPrivacy');
const { makeStaffChannel } = require('./fixtures/discord-staff-channel');

const check = (fixture, options = {}) => validateStaffDestination(fixture.channel, { botUserId: fixture.botUserId, ...options });

test('a private channel with trusted moderation and the bot managed role passes actual SDK permission resolution', async () => {
  assert.deepEqual(await check(makeStaffChannel()), { ok: true, code: 'private_staff_destination' });
});

test('everyone view access and incomplete ACL objects fail closed', async () => {
  const fixture = makeStaffChannel();
  fixture.channel.permissionOverwrites.cache.delete(fixture.guild.id);
  assert.equal((await check(fixture)).code, 'everyone_can_view');
  assert.equal((await validateStaffDestination({ isTextBased: () => true }, { botUserId: 'bot' })).ok, false);
  const incomplete = makeStaffChannel();
  incomplete.channel.permissionsFor = () => null;
  assert.equal((await check(incomplete)).code, 'guild_acl_unavailable');
});

test('an ordinary role assigned to the bot never becomes a trusted audience role', async () => {
  const fixture = makeStaffChannel();
  const ordinary = fixture.role('customer-role', [P.ViewChannel, P.SendMessages]);
  fixture.roles.set(ordinary.id, ordinary);
  fixture.guild.members.me.roles.cache.set(ordinary.id, ordinary);
  fixture.channel.permissionOverwrites.cache.set(ordinary.id, fixture.overwrite(ordinary.id, 0, [P.ViewChannel]));
  assert.equal((await check(fixture)).code, 'untrusted_role_can_view');
  assert.equal((await check(fixture, { staffRoleIds: [ordinary.id] })).ok, true);
});

test('unconfigured member view grants require fetched verified staff authority', async () => {
  const fixture = makeStaffChannel();
  const memberId = 'direct-user';
  fixture.channel.permissionOverwrites.cache.set(memberId, fixture.overwrite(memberId, 1, [P.ViewChannel]));
  assert.equal((await check(fixture)).code, 'member_acl_unverifiable');
  assert.equal((await check(fixture, { staffUsers: [memberId] })).ok, true);
  fixture.members.set(memberId, { id: memberId, guild: fixture.guild, roles: { cache: new Map([[fixture.guild.id, fixture.roles.get(fixture.guild.id)]]) } });
  fixture.guild.members.fetch = async () => fixture.members.get(memberId);
  assert.equal((await check(fixture)).code, 'untrusted_member_can_view');
  fixture.members.get(memberId).roles.cache.set('staff-role', fixture.roles.get('staff-role'));
  assert.equal((await check(fixture)).ok, true);
});

test('unknown role overwrites and missing bot permission reject without exposing ACL identifiers', async () => {
  const fixture = makeStaffChannel();
  fixture.channel.permissionOverwrites.cache.set('unknown-role', fixture.overwrite('unknown-role', 0, [P.ViewChannel]));
  assert.deepEqual(await check(fixture), { ok: false, code: 'role_acl_unavailable' });
  fixture.channel.permissionOverwrites.cache.delete('unknown-role');
  fixture.channel.permissionOverwrites.cache.delete('bot-role');
  assert.deepEqual(await check(fixture), { ok: false, code: 'bot_cannot_send' });
});

function directGrant() {
  const fixture = makeStaffChannel();
  fixture.memberId = 'direct-user';
  fixture.channel.permissionOverwrites.cache.set(fixture.memberId, fixture.overwrite(fixture.memberId, 1, [P.ViewChannel]));
  fixture.member = (staff = true) => ({ id: fixture.memberId, guild: fixture.guild,
    roles: { cache: new Map([[fixture.guild.id, fixture.roles.get(fixture.guild.id)],
      ...(staff ? [['staff-role', fixture.roles.get('staff-role')]] : [])]) } });
  return fixture;
}

test('a direct moderator grant fetches exactly one uncached member without a members intent', async () => {
  const fixture = directGrant(); const fetches = [];
  fixture.guild.members.fetch = async options => { fetches.push(options); return fixture.member(); };
  assert.deepEqual(await check(fixture), { ok: true, code: 'private_staff_destination' });
  assert.deepEqual(fetches, [{ user: fixture.memberId, force: true, cache: false }]);
  assert.equal(fixture.members.has(fixture.memberId), false);
});

test('cached moderation authority cannot override a freshly revoked direct grant', async () => {
  const fixture = directGrant(); fixture.members.set(fixture.memberId, fixture.member());
  fixture.guild.members.fetch = async () => fixture.member(false);
  assert.deepEqual(await check(fixture), { ok: false, code: 'untrusted_member_can_view' });
});

test('an unavailable member read fails closed even if the stale cache looks trusted', async () => {
  const fixture = directGrant(); fixture.members.set(fixture.memberId, fixture.member());
  fixture.guild.members.fetch = async () => { throw new Error('private fixture credential must not be logged'); };
  assert.deepEqual(await check(fixture), { ok: false, code: 'member_acl_unverifiable' });
});

test('single-member proof refuses a wrong user, wrong guild, partial result or unknown role', async () => {
  for (const mutate of [member => { member.id = 'someone-else'; }, member => { member.guild = { id: 'another-guild' }; },
    member => { member.partial = true; }, member => { member.roles.cache.set('unknown', { id: 'unknown' }); }]) {
    const fixture = directGrant(); const member = fixture.member(); mutate(member);
    fixture.guild.members.fetch = async () => member;
    assert.deepEqual(await check(fixture), { ok: false, code: 'member_acl_unverifiable' });
  }
});

test('configured people and denied grants never trigger a bulk or unnecessary member fetch', async () => {
  const fixture = directGrant(); let fetches = 0;
  fixture.guild.members.fetch = async () => { fetches++; throw new Error('must not fetch'); };
  assert.equal((await check(fixture, { staffUsers: [fixture.memberId] })).ok, true);
  fixture.channel.permissionOverwrites.cache.set(fixture.memberId, fixture.overwrite(fixture.memberId, 1, [], [P.ViewChannel]));
  assert.equal((await check(fixture)).ok, true);
  assert.equal(fetches, 0);
});
