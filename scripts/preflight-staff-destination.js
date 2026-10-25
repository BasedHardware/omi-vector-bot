// Read-only Discord ACL metadata. Never import index.js or log API payloads.
const { Client, Routes, User, Guild } = require('discord.js');
const { checkConfiguredStaffDestination } = require('../discordPrivacy');

async function runReadOnlyPreflight(client, { channelId, staffUsers = [], staffRoleIds = [] } = {}) {
  const startedAt = new Date().toISOString();
  let readRequests = 0, singleMemberReads = 0;
  const get = client.rest.get.bind(client.rest);
  client.rest.get = (route, options) => {
    readRequests++;
    if (/\/members\/[^/]+$/.test(route)) singleMemberReads++;
    return get(route, options);
  };
  for (const method of ['post', 'put', 'patch', 'delete']) {
    client.rest[method] = async () => { throw new Error('Read-only preflight refuses writes'); };
  }
  let result;
  try {
    if (!channelId) result = { ok: false, code: 'staff_destination_missing' };
    else {
      client.user = new User(client, await client.rest.get(Routes.user('@me')));
      const channel = await client.rest.get(Routes.channel(channelId));
      if (!channel.guild_id) result = { ok: false, code: 'guild_acl_unavailable' };
      else {
        const [data, roles, botMember] = await Promise.all([
          client.rest.get(Routes.guild(channel.guild_id)),
          client.rest.get(Routes.guildRoles(channel.guild_id)),
          client.rest.get(Routes.guildMember(channel.guild_id, client.user.id)),
        ]);
        if (String(data?.id) !== String(channel.guild_id) || data.unavailable === true ||
            !Array.isArray(roles) || String(botMember?.user?.id) !== String(client.user.id)) {
          result = { ok: false, code: 'guild_acl_unavailable' };
        } else {
          // A bare REST Guild is unavailable in the SDK because it lacks gateway
          // channel state. Hydrate only verified metadata for the target channel,
          // roles and bot member; never assign available=true or log in a gateway.
          const guild = new Guild(client, { ...data, roles, channels: [channel], members: [botMember] });
          client.guilds.cache.set(guild.id, guild);
          result = await checkConfiguredStaffDestination(client, { channelId, staffUsers, staffRoleIds });
        }
      }
    }
  } catch { result = { ok: false, code: 'staff_channel_unavailable' }; }
  return { ...result, readOnly: true, startedAt, endedAt: new Date().toISOString(), readRequests, singleMemberReads };
}

if (require.main === module) {
  require('dotenv').config({ path: process.env.DOTENV_CONFIG_PATH || '.env', quiet: true });
  (async () => {
    if (!process.env.DISCORD_TOKEN) {
      console.log(JSON.stringify({ ok: false, code: 'discord_configuration_missing', readOnly: true }));
      process.exitCode = 1; return;
    }
    const client = new Client({ intents: [], rest: { timeout: 10000, retries: 0 } });
    client.rest.setToken(process.env.DISCORD_TOKEN);
    try {
      const staff = require('../handoff').staffMentionIds();
      const result = await runReadOnlyPreflight(client, { channelId: process.env.STAFF_ALERT_CHANNEL_ID,
        staffUsers: staff.users, staffRoleIds: staff.roles });
      console.log(JSON.stringify(result));
      if (!result.ok || result.code !== 'private_staff_destination') process.exitCode = 1;
    } finally { client.destroy(); }
  })().catch(() => {
    console.log(JSON.stringify({ ok: false, code: 'preflight_unavailable', readOnly: true }));
    process.exitCode = 1;
  });
}

module.exports = { runReadOnlyPreflight };
