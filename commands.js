const { REST, Routes, SlashCommandBuilder } = require('discord.js');
const { isHandoffThread, canStaffAct } = require('./handoff');
const github = require('./github');

const doneCommand = new SlashCommandBuilder()
  .setName('done')
  .setDescription('Mark this Handoff thread resolved. Staff only.')
  .toJSON();

async function registerSlashCommands(client) {
  const clientId = process.env.DISCORD_CLIENT_ID;
  const token = process.env.DISCORD_TOKEN;
  if (!clientId || !token) return 0;
  const rest = new REST({ version: '10' }).setToken(token);
  const guildIds = new Set();
  for (const id of [process.env.VECTOR_TEST_CHANNEL_ID, process.env.HELP_FORUM_CHANNEL_ID]) {
    if (!id || !client?.channels?.fetch) continue;
    try {
      const ch = await client.channels.fetch(id);
      if (ch?.guildId) guildIds.add(ch.guildId);
    } catch (err) {
      console.error('[Bot] command guild lookup failed:', err.message);
    }
  }
  for (const guildId of guildIds) {
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: [doneCommand] });
  }
  return guildIds.size;
}

async function closeHandoff(channel, user) {
  if (!isHandoffThread(channel)) {
    return { ok: false, reason: 'Use /done in a Handoff thread.' };
  }
  await channel.send(`This is resolved. Closed by <@${user.id}>.`);
  if (typeof channel.setLocked === 'function') {
    try {
      await channel.setLocked(true, 'Resolved with /done');
    } catch (err) {
      console.error('[Bot] lock thread failed:', err.message);
    }
  }
  if (typeof channel.setArchived === 'function') {
    await channel.setArchived(true, 'Resolved with /done');
  }
  return { ok: true };
}

async function handleDone(interaction) {
  if (!canStaffAct(interaction)) {
    await interaction.reply({
      content: 'Only named staff can close a thread. Set STAFF_USER_IDS or STAFF_ROLE_ID.',
      ephemeral: true,
    });
    return;
  }
  const result = await closeHandoff(interaction.channel, interaction.user);
  if (!result.ok) {
    await interaction.reply({ content: result.reason, ephemeral: true });
    return;
  }
  await interaction.reply({ content: 'Marked resolved.', ephemeral: true });
}

async function handleFileIssue(interaction) {
  if (!canStaffAct(interaction)) {
    await interaction.reply({
      content: 'Only named staff can file a GitHub issue.',
      ephemeral: true,
    });
    return;
  }
  const id = String(interaction.customId || '').replace(/^file:/, '');
  const draft = github.takeDraft(id);
  if (!draft) {
    await interaction.reply({ content: 'That File button expired. Ask again in the channel.', ephemeral: true });
    return;
  }
  if (!github.isConfigured()) {
    await interaction.reply({ content: 'No GitHub token on the host.', ephemeral: true });
    return;
  }
  await interaction.deferReply({ ephemeral: true });
  const created = await github.createIssue(draft);
  if (!created.ok) {
    await interaction.editReply('GitHub did not accept the issue. I did not claim it was filed.');
    return;
  }
  github.linkIssueThread(created.number, interaction.channelId);
  const line = `GitHub issue ${created.url}`;
  try {
    if (interaction.channel?.isTextBased?.()) {
      await interaction.channel.send(line);
    }
  } catch (err) {
    console.error('[GitHub] thread notice failed:', err.message);
  }
  await interaction.editReply(`Filed ${created.url}`);
}

async function handleInteraction(interaction) {
  try {
    if (interaction.isChatInputCommand?.() && interaction.commandName === 'done') {
      await handleDone(interaction);
      return;
    }
    if (interaction.isButton?.() && String(interaction.customId || '').startsWith('file:')) {
      await handleFileIssue(interaction);
    }
  } catch (err) {
    console.error('[Bot] interaction failed:', err.message);
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ content: 'That command failed.', ephemeral: true });
      } else {
        await interaction.reply({ content: 'That command failed.', ephemeral: true });
      }
    } catch {
      /* ignore */
    }
  }
}

async function notifyLinkedThreads(client, event) {
  const nums = event?.numbers || (event?.number ? [event.number] : []);
  if (!nums.length || !client?.channels?.fetch) return 0;
  const ids = new Set();
  for (const num of nums) {
    for (const id of github.threadsForIssue(num)) ids.add(id);
  }
  let n = 0;
  for (const id of ids) {
    try {
      const ch = await client.channels.fetch(id);
      if (ch?.isTextBased?.() && typeof ch.send === 'function') {
        await ch.send(event.line);
        n += 1;
      }
    } catch (err) {
      console.error('[GitHub] webhook notify failed:', err.message);
    }
  }
  return n;
}

module.exports = {
  doneCommand,
  registerSlashCommands,
  closeHandoff,
  handleInteraction,
  notifyLinkedThreads,
};
