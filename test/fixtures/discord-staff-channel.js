const { Collection, GuildChannel, ChannelType, PermissionsBitField, PermissionFlagsBits: P } = require('discord.js');

function makeStaffChannel({ id = 'staff-room', botUserId = 'bot-user', send = async (payload) => payload } = {}) {
  const guild = { id: 'guild-id', ownerId: 'guild-owner', available: true };
  const roles = new Collection();
  const role = (id, permissions, extra = {}) => ({ id, guild, permissions: new PermissionsBitField(permissions), ...extra });
  const everyone = role(guild.id, [P.ViewChannel, P.SendMessages]);
  const staff = role('staff-role', [P.ManageThreads, P.ViewChannel, P.SendMessages]);
  const botRole = role('bot-role', [P.ViewChannel, P.SendMessages], { managed: true, tags: { botId: botUserId } });
  for (const value of [everyone, staff, botRole]) roles.set(value.id, value);
  guild.roles = { cache: roles, everyone, resolve: (value) => roles.get(String(value?.id || value)) || null };
  const bot = { id: botUserId, roles: { cache: new Collection([[everyone.id, everyone], [botRole.id, botRole]]) } };
  const members = new Collection([[botUserId, bot]]);
  guild.members = { cache: members, me: bot, resolve: (value) => members.get(String(value?.id || value)) || null };
  const overwrite = (id, type, allow = [], deny = []) => ({ id, type, allow: new PermissionsBitField(allow), deny: new PermissionsBitField(deny) });
  const channel = Object.assign(Object.create(GuildChannel.prototype), { id, guild, guildId: guild.id, type: ChannelType.GuildText,
    isTextBased: () => true,
    permissionOverwrites: { cache: new Collection([
      [guild.id, overwrite(guild.id, 0, [], [P.ViewChannel])],
      [staff.id, overwrite(staff.id, 0, [P.ViewChannel])],
      [botRole.id, overwrite(botRole.id, 0, [P.ViewChannel])],
    ]) }, send,
  });
  return { channel, guild, roles, members, role, overwrite, botUserId };
}

module.exports = { makeStaffChannel };
