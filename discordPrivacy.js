const { ChannelType, PermissionFlagsBits } = require('discord.js');

function has(permissionSet, flag) {
  if (typeof permissionSet?.has !== 'function') throw new Error('Unknown ACL');
  const value = permissionSet.has(flag, false);
  if (typeof value !== 'boolean') throw new Error('Unknown ACL');
  return value;
}

function authority(permissionSet) {
  return has(permissionSet, PermissionFlagsBits.Administrator) || has(permissionSet, PermissionFlagsBits.ManageThreads);
}

function validateStaffDestination(channel, { botUserId, staffUsers = [], staffRoleIds = [] } = {}) {
  const reject = (code) => ({ ok: false, code });
  try {
    const guild = channel?.guild;
    if (!guild?.id || guild.available === false || !botUserId) return reject('guild_acl_unavailable');
    if (![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type) || channel.isThread?.()) return reject('unsupported_staff_channel');
    const roles = guild.roles?.cache;
    const overwrites = channel.permissionOverwrites?.cache;
    if (!roles?.values || !overwrites?.values || typeof channel.permissionsFor !== 'function') return reject('guild_acl_unavailable');
    const everyone = roles.get(String(guild.id));
    if (!everyone || !everyone.permissions) return reject('guild_acl_unavailable');
    if (has(channel.permissionsFor(everyone), PermissionFlagsBits.ViewChannel)) return reject('everyone_can_view');
    const users = new Set(staffUsers.map(String));
    const staffRoles = new Set(staffRoleIds.map(String));
    const trustedRole = (role) => staffRoles.has(String(role.id)) || authority(role.permissions) ||
      (role.managed === true && String(role.tags?.botId || '') === String(botUserId));
    for (const role of roles.values()) {
      if (String(role.id) === String(guild.id)) continue;
      const effective = channel.permissionsFor(role);
      if (has(effective, PermissionFlagsBits.ViewChannel) && !trustedRole(role)) return reject('untrusted_role_can_view');
    }
    for (const overwrite of overwrites.values()) {
      if (overwrite.type === 0) {
        if (!roles.has(String(overwrite.id))) return reject('role_acl_unavailable');
        continue;
      }
      if (overwrite.type !== 1) return reject('overwrite_acl_unavailable');
      const id = String(overwrite.id);
      if (!has(overwrite.allow, PermissionFlagsBits.ViewChannel)) continue;
      if (id === String(botUserId) || id === String(guild.ownerId || '') || users.has(id)) continue;
      // No member fetch or privileged intent: only a cached, complete member
      // can prove that an otherwise unconfigured direct grant is staff-owned.
      const member = guild.members?.cache?.get(id);
      const memberRoles = member?.roles?.cache;
      if (!member || member.partial || !memberRoles?.values) return reject('member_acl_unverifiable');
      const resolvedRoles = [...memberRoles.values()];
      if (resolvedRoles.some((role) => !roles.has(String(role.id)))) return reject('member_acl_unverifiable');
      if (!resolvedRoles.some((role) => staffRoles.has(String(role.id)) || authority(role.permissions))) return reject('untrusted_member_can_view');
    }
    const bot = guild.members?.me;
    if (!bot || String(bot.id) !== String(botUserId)) return reject('bot_acl_unverifiable');
    const botPermissions = channel.permissionsFor(bot);
    if (!has(botPermissions, PermissionFlagsBits.ViewChannel) || !has(botPermissions, PermissionFlagsBits.SendMessages)) return reject('bot_cannot_send');
    return { ok: true, code: 'private_staff_destination' };
  } catch {
    return reject('guild_acl_unavailable');
  }
}

module.exports = { validateStaffDestination };
