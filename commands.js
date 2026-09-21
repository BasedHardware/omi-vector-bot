const { REST, Routes, SlashCommandBuilder, MessageFlags } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');
const { isCloseableThread, canStaffAct } = require('./handoff');
const github = require('./github');

const OMI_LOGO_NAME = 'omi-logo.png';
const OMI_LOGO_PATH = path.join(__dirname, 'assets', OMI_LOGO_NAME);

const doneCommand = new SlashCommandBuilder()
  .setName('done')
  .setDescription('Mark this Handoff or help thread resolved. Staff only.')
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

function closeNotice(user) {
  const who = user?.id ? `<@${user.id}>` : 'staff';
  return [
    "If this is still happening, open a new post in Help. We won't see replies here.",
    `Closed by ${who}.`,
  ].join('\n\n');
}

function closePayload(user) {
  const hasLogo = fs.existsSync(OMI_LOGO_PATH);
  const embed = {
    title: 'This ticket is closed',
    color: 0x111111,
    description: closeNotice(user),
  };
  if (hasLogo) {
    embed.author = { name: 'Omi', iconURL: `attachment://${OMI_LOGO_NAME}` };
    embed.thumbnail = { url: `attachment://${OMI_LOGO_NAME}` };
  }
  const payload = {
    embeds: [embed],
    allowedMentions: user?.id ? { users: [String(user.id)] } : { parse: [] },
  };
  if (hasLogo) {
    payload.files = [{ attachment: OMI_LOGO_PATH, name: OMI_LOGO_NAME }];
  }
  return payload;
}

async function archiveHandoff(channel) {
  // One PATCH. Lock-then-archive as two calls returns Missing Access on public threads.
  if (typeof channel.edit === 'function') {
    await channel.edit({ archived: true, locked: true, reason: 'Resolved with /done' });
    return;
  }
  if (typeof channel.setArchived === 'function') {
    await channel.setArchived(true, 'Resolved with /done');
  }
}

async function closeHandoff(channel, user) {
  if (!isCloseableThread(channel)) {
    return { ok: false, reason: 'Use /done in a Handoff or help thread.' };
  }
  try {
    await channel.send(closePayload(user));
  } catch (err) {
    console.error('[Bot] /done notice failed:', err.message);
    return { ok: false, reason: 'Could not post the resolved message.' };
  }
  try {
    await archiveHandoff(channel);
  } catch (err) {
    console.error('[Bot] /done archive failed:', err.message);
  }
  return { ok: true };
}

async function handleDone(interaction) {
  if (!canStaffAct(interaction)) {
    await interaction.reply({
      content: 'Only named staff can close a thread. Set STAFF_USER_IDS or STAFF_ROLE_ID.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  let result;
  try {
    result = await closeHandoff(interaction.channel, interaction.user);
  } catch (err) {
    console.error('[Bot] /done close failed:', err.message);
    result = { ok: false, reason: 'Could not close the thread.' };
  }
  try {
    await interaction.editReply(result.ok ? 'Marked resolved.' : result.reason);
  } catch (err) {
    console.error('[Bot] /done ack failed:', err.message);
  }
}

async function handleFileIssue(interaction) {
  if (!canStaffAct(interaction)) {
    await interaction.reply({
      content: 'Only named staff can file a GitHub issue.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const id = String(interaction.customId || '').replace(/^file:/, '');
  const draft = github.takeDraft(id);
  if (!draft) {
    await interaction.reply({ content: 'That File button expired. Ask again in the channel.', flags: MessageFlags.Ephemeral });
    return;
  }
  if (!github.isConfigured()) {
    await interaction.reply({ content: 'No GitHub token on the host.', flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const created = await github.createIssue({
    ...draft,
    threadId: interaction.channelId,
  });
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
    if (interaction.commandName === 'done') return;
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ content: 'That command failed.', flags: MessageFlags.Ephemeral });
      } else {
        await interaction.reply({ content: 'That command failed.', flags: MessageFlags.Ephemeral });
      }
    } catch {
      /* ignore */
    }
  }
}

async function notifyLinkedThreads(client, event) {
  const nums = event?.numbers || (event?.number ? [event.number] : []);
  const ids = new Set((event?.threadIds || []).map(String).filter(Boolean));
  for (const num of nums) {
    for (const id of github.threadsForIssue(num)) ids.add(id);
  }
  if (!ids.size || !client?.channels?.fetch) return 0;
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
  closeNotice,
  closePayload,
  closeHandoff,
  handleInteraction,
  notifyLinkedThreads,
};
