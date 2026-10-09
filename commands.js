const { REST, Routes, SlashCommandBuilder, MessageFlags } = require('discord.js');
const { isCloseableThread, canStaffAct, staffMentionIds, markHandoffClosed, sendToStaffChannel } = require('./handoff');
const github = require('./github');
const orderFlow = require('./orderFlow');
const supportCases = require('./supportCases');
const { appReviewButtons } = require('./appReviews');

const OMI_LOGO_URL =
  process.env.OMI_LOGO_URL ||
  'https://raw.githubusercontent.com/BasedHardware/omi/main/app/assets/images/app_launcher_icon.png';

const doneCommand = new SlashCommandBuilder()
  .setName('done')
  .setDescription('Mark this Handoff or help thread resolved. Staff only.')
  .toJSON();

const testCommand = new SlashCommandBuilder()
  .setName('test')
  .setDescription('Start a clean Vector test in #vector-test only. One customer question.')
  .addStringOption((option) =>
    option
      .setName('question')
      .setDescription('Customer question only. Do not paste staff replies.')
      .setRequired(true)
      .setMaxLength(1500)
  )
  .toJSON();

let runTestQuestion = null;

function setTestQuestionHandler(fn) {
  runTestQuestion = typeof fn === 'function' ? fn : null;
}

function isVectorTestParent(channel) {
  const id = String(process.env.VECTOR_TEST_CHANNEL_ID || '').trim();
  if (!id || !channel) return false;
  if (String(channel.id) === id) return true;
  const parentId = String(channel.parentId || channel.parent_id || '');
  if (channel.isThread?.() && parentId === id && !/^Handoff\b/i.test(String(channel.name || ''))) {
    return true;
  }
  return false;
}

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
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
      body: [
        doneCommand,
        testCommand,
        orderFlow.orderCommand,
        orderFlow.ordersCommand,
        orderFlow.unlinkCommand,
      ],
    });
  }
  return guildIds.size;
}

function closeNotice(user) {
  const who = user?.id ? `<@${user.id}>` : 'staff';
  return [
    'Thank you for giving us the chance to help.',
    'Did we help solve your problem? Your honest feedback helps us improve.',
    'If you still need help, use the button below. If the thread cannot be reopened, open a new post in Help.',
    `Marked resolved by ${who}. Only the customer who opened this post can submit support feedback.`,
  ].join('\n\n');
}

function closePayload(user) {
  const embed = {
    author: { name: 'Omi Support', iconURL: OMI_LOGO_URL },
    title: 'How did we do?',
    color: 0x111111,
    description: closeNotice(user),
    thumbnail: { url: OMI_LOGO_URL },
    fields: [{
      name: 'Share an honest app review · optional',
      value: "We'd appreciate an honest rating or review of the Omi app on your store. It's optional and does not affect your support.\nOn Google Play, choose **Write a review** after opening the page.",
    }],
  };
  return {
    embeds: [embed],
    components: [
      {
        type: 1,
        components: [
          { type: 2, style: 3, label: 'Yes, my issue is resolved', custom_id: 'rate:yes' },
          { type: 2, style: 2, label: 'Still need help', custom_id: 'rate:no' },
        ],
      },
      appReviewButtons(),
    ],
    allowedMentions: { parse: [] },
  };
}

async function handleRating(interaction, options = {}) {
  const deferred = typeof interaction.deferReply === 'function' && typeof interaction.editReply === 'function';
  if (deferred) await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const respond = (content) => deferred
    ? interaction.editReply({ content, allowedMentions: { parse: [] } })
    : interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
  if (!['rate:yes', 'rate:no'].includes(interaction.customId)) {
    await respond('That is not a support feedback button.');
    return;
  }
  const helped = interaction.customId === 'rate:yes';
  const threadId = String(interaction.channelId || interaction.channel?.id || '');
  const cases = options.cases || supportCases;
  let storedCase;
  try {
    storedCase = threadId ? await cases.getCaseByThread(threadId) : null;
  } catch {
    console.error('[Bot] rating case lookup failed');
    await respond('I could not check this case just now. Your feedback has not been saved; please try again.');
    return;
  }
  let customerId = String(interaction.channel?.ownerId || '');
  // A Handoff started from a customer's message is owned by the bot, not by
  // that customer. The starter message is the authoritative customer here.
  if (interaction.channel && /^Handoff\b/i.test(String(interaction.channel.name || ''))) {
    try {
      const starter = await interaction.channel.fetchStarterMessage?.();
      if (starter?.author && !starter.author.bot) {
        customerId = String(starter.author.id || '');
      }
    } catch (err) {
      console.error('[Bot] rating starter lookup failed:', err.message);
    }
  }
  // Durable ownership survives bot restarts and bot-owned Handoff threads.
  if (storedCase) customerId = storedCase.customerId;
  const clicker = String(interaction.user?.id || interaction.member?.user?.id || '');
  if (!customerId || clicker !== customerId) {
    await respond('Only the customer who opened this post can answer that.');
    return;
  }
  let counts = { yes: 0, no: 0 };
  let feedbackSaved = false;
  try {
    counts = await (options.recordRating || require('./ratings').recordRating)(threadId, clicker, helped);
    feedbackSaved = true;
  } catch (err) {
    console.error('[Bot] rating save failed');
  }
  let reopened = false;
  let threadReopened = false;
  if (!helped && storedCase) {
    try {
      const active = await cases.getActiveCase(storedCase.channelId, clicker);
      if (active && active.id !== storedCase.id) throw new Error('A newer support case is active');
      const channel = interaction.channel;
      if (typeof channel?.edit === 'function') {
        await channel.edit({ archived: false, locked: false, reason: 'Customer still needs help' });
      } else if (typeof channel?.setArchived === 'function') {
        if (channel.locked) {
          if (typeof channel.setLocked !== 'function') throw new Error('Thread cannot be unlocked');
          await channel.setLocked(false, 'Customer still needs help');
        }
        await channel.setArchived(false, 'Customer still needs help');
      } else {
        throw new Error('Thread cannot be reopened');
      }
      threadReopened = true;
      require('./handoff').markHandoffReopened?.(channel);
      const tagId = resolvedTagId(channel);
      if (tagId && typeof channel.setAppliedTags === 'function') {
        await channel.setAppliedTags((channel.appliedTags || []).map(String).filter((id) => id !== tagId), 'Customer still needs help');
      }
      const database = options.db || (process.env.DATABASE_URL ? require('./db') : null);
      if (storedCase.escalationId && database) {
        if (typeof database.reopenEscalation !== 'function') throw new Error('Escalation cannot be reopened');
        await database.reopenEscalation(storedCase.escalationId);
      }
      reopened = Boolean(await cases.reopenByThread(threadId, clicker));
      if (!reopened && ['queued', 'delivered', 'accepted'].includes(storedCase.status) && !channel.archived && !channel.locked) reopened = true;
    } catch (err) {
      console.error('[Bot] case reopen failed:', err.name);
    }
  }
  const where = threadId ? ` <#${threadId}>` : '';
  const totals = feedbackSaved && Number.isFinite(counts?.yes) && Number.isFinite(counts?.no)
    ? ` Helpful: ${counts.yes}. Still need help: ${counts.no}.`
    : ' Feedback totals are temporarily unavailable.';
  try {
    await (options.notifyStaff || sendToStaffChannel)(interaction.client, {
      content: helped
        ? `A customer said this helped.${where}${totals}`
        : `A customer still needs help.${where}${totals}`,
      allowedMentions: { parse: [] },
    });
  } catch (err) {
    console.error('[Bot] rating note failed:', err.message);
  }
  const note = !feedbackSaved
    ? reopened
      ? 'This case is reopened. You can continue in this thread. Saving your feedback failed; it has not been added to the dashboard.'
      : threadReopened
      ? 'This thread is reopened, but I could not finish updating the case. You can continue here. Your feedback has not been saved; please try the feedback button again.'
      : 'Thank you for your feedback. I could not save it just now; please try the feedback button again.'
    : helped ? 'Glad it helped. Thank you for your honest feedback.' : reopened
    ? 'This case is reopened. You can continue in this thread.'
    : threadReopened
    ? 'This thread is reopened, but I could not finish updating the case. You can continue here. Your feedback is recorded.'
    : 'Your feedback is recorded. This thread has not been reopened; open a new Help post if you still need help.';
  await respond(note);
}

function resolvedTagId(channel) {
  const tags = channel?.parent?.availableTags || channel?.parent?.available_tags || [];
  const hit = tags.find((tag) => /^resolved$/i.test(String(tag.name || '')));
  return hit?.id ? String(hit.id) : '';
}

async function applyResolvedTag(channel) {
  const tagId = resolvedTagId(channel);
  if (!tagId || typeof channel.setAppliedTags !== 'function') return;
  const current = [...(channel.appliedTags || [])].map(String);
  if (current.includes(tagId)) return;
  await channel.setAppliedTags([...current, tagId], 'Resolved with /done');
}

async function archiveHandoff(channel) {
  if (typeof channel.edit === 'function') {
    try {
      await channel.edit({ archived: true, locked: true, reason: 'Resolved with /done' });
      return;
    } catch (err) {
      console.error('[Bot] /done lock+archive failed:', err.message);
    }
    try {
      await channel.edit({ archived: true, reason: 'Resolved with /done' });
      return;
    } catch (err) {
      console.error('[Bot] /done archive failed:', err.message);
    }
  }
  if (typeof channel.setArchived === 'function') {
    await channel.setArchived(true, 'Resolved with /done');
  }
}

async function closeHandoff(channel, user, options = {}) {
  if (!isCloseableThread(channel)) {
    return { ok: false, reason: 'Use /done in a Handoff or help thread.' };
  }
  const cases = options.cases || supportCases;
  const threadId = String(channel.id || '');
  let storedCase;
  let escalation;
  const database = options.db || (process.env.DATABASE_URL ? require('./db') : null);
  try {
    storedCase = threadId ? await cases.getCaseByThread(threadId) : null;
    escalation = database && threadId ? await database.getPendingEscalation(threadId) : null;
  } catch (err) {
    console.error('[Bot] /done case lookup failed:', err.name);
    return { ok: false, reason: 'Could not read this case. The thread has not been closed.' };
  }
  let delivered;
  try {
    delivered = await channel.send(closePayload(user));
  } catch (err) {
    console.error('[Bot] /done notice failed:', err.message);
    return { ok: false, reason: 'Could not post the resolved message.' };
  }
  try {
    if (storedCase) await cases.resolveByThread(threadId, { customerId: storedCase.customerId, close: true, deliveryId: delivered?.id, confirmed: true });
    if (database && (storedCase?.escalationId || escalation?.id)) {
      await database.resolveEscalation(storedCase?.escalationId || escalation.id);
    }
  } catch (err) {
    console.error('[Bot] /done case save failed:', err.name);
    return { ok: false, reason: 'The notice was posted, but saving the case failed. The thread has not been archived; please retry.' };
  }
  markHandoffClosed(channel);
  try {
    await applyResolvedTag(channel);
  } catch (err) {
    console.error('[Bot] /done tag failed:', err.message);
  }
  try {
    await archiveHandoff(channel);
  } catch (err) {
    console.error('[Bot] /done archive failed:', err.message);
  }
  return { ok: true };
}

async function handleTest(interaction) {
  if (!isVectorTestParent(interaction.channel)) {
    await interaction.reply({
      content: 'Use `/test` only in #vector-test — the channel itself, not inside a Handoff.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const question = String(interaction.options.getString('question') || '').trim();
  if (question.length < 5) {
    await interaction.reply({
      content: 'Paste the customer question (a few words at least).',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (!runTestQuestion) {
    await interaction.reply({
      content: 'Test runner is not ready yet. Try again in a few seconds.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  await interaction.reply({
    content: 'New test Handoff in this channel.',
    flags: MessageFlags.Ephemeral,
  });
  await runTestQuestion(interaction, question);
}

async function handleDone(interaction) {
  if (!canStaffAct(interaction)) {
    await interaction.reply({
      content: 'Only staff can close a thread.',
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
    github.restoreDraft(id, draft);
    await interaction.reply({ content: 'No GitHub token on the host.', flags: MessageFlags.Ephemeral });
    return;
  }
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  } catch (err) {
    github.restoreDraft(id, draft);
    throw err;
  }
  const prior = await github.existingWork(`${draft.title}\n${draft.body}`);
  if (prior.error) {
    github.restoreDraft(id, draft);
    await interaction.editReply('I could not check GitHub for an existing issue. I did not file another.');
    return;
  }
  if (prior.hit) {
    github.restoreDraft(id, draft);
    await interaction.editReply(`Already on GitHub: ${prior.hit.url}. I did not file another.`);
    return;
  }
  const asked = `${draft.title}\n${draft.quote || draft.body}`;
  const related = [...(await github.relatedPulls(asked)), ...(await github.relatedIssues(asked))];
  const created = await github.createIssue({
    ...draft,
    body: github.issueBody({
      quote: draft.quote,
      reason: draft.reason,
      threadUrl: github.discordThreadUrl(interaction),
      related,
      files: draft.files,
    }),
    threadId: interaction.channelId,
  });
  const filedUrl = String(created?.url || '');
  if (!created?.ok || !/\/issues\/[1-9]\d*/.test(filedUrl)) {
    github.restoreDraft(id, draft);
    await interaction.editReply('GitHub did not accept the issue. I did not claim it was filed.');
    return;
  }
  github.linkIssueThread(created.number, interaction.channelId);
  const line = `GitHub issue ${filedUrl}`;
  try {
    if (interaction.channel?.isTextBased?.()) {
      await interaction.channel.send(line);
    }
  } catch (err) {
    console.error('[GitHub] thread notice failed:', err.message);
  }
  await interaction.editReply(`Filed ${filedUrl}`);
}

function canAcceptCase(interaction) {
  const staffChannelId = String(process.env.STAFF_ALERT_CHANNEL_ID || '').trim();
  if (!staffChannelId || String(interaction.channel?.id || '') !== staffChannelId ||
      String(interaction.channelId || interaction.channel?.id || '') !== staffChannelId || interaction.channel?.isThread?.()) return false;
  const staffId = String(interaction.user?.id || '');
  if (!staffId) return false;
  const { users, roles } = staffMentionIds();
  if (users.includes(staffId)) return true;
  const cache = interaction.member?.roles?.cache;
  if (roles.some((id) => cache?.has?.(id) || cache?.includes?.(id))) return true;
  const permissions = interaction.memberPermissions || interaction.member?.permissions;
  try { return Boolean(permissions?.has?.('ManageThreads', true) || permissions?.has?.('Administrator', true)); }
  catch { return false; }
}

async function handleAcceptCase(interaction, { cases = supportCases } = {}) {
  if (!canAcceptCase(interaction)) {
    await interaction.reply({ content: 'Only authorized staff can accept a case in the configured staff channel.', flags: MessageFlags.Ephemeral });
    return;
  }
  const caseId = String(interaction.customId || '').match(/^case:accept:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i)?.[1];
  const botId = String(interaction.client?.user?.id || '');
  const cardCase = (interaction.message?.embeds || []).flatMap((embed) => embed.fields || embed.data?.fields || [])
    .find((field) => field.name === 'Case')?.value;
  if (!caseId || !botId || String(interaction.message?.author?.id || '') !== botId || cardCase !== caseId) {
    await interaction.reply({ content: 'That is not a valid case acceptance card.', flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const value = await cases.markAccepted(caseId, { staffId: interaction.user.id });
  await interaction.editReply({
    content: value?.acceptedBy && value?.acceptedAt
      ? `Case accepted by <@${value.acceptedBy}>.`
      : 'This case is not awaiting acceptance. It must be delivered before staff can accept it.',
    allowedMentions: { parse: [] },
  });
}

async function handleInteraction(interaction) {
  try {
    if (await orderFlow.handleOrderInteraction(interaction)) return;
    if (interaction.isChatInputCommand?.() && interaction.commandName === 'test') {
      await handleTest(interaction);
      return;
    }
    if (interaction.isChatInputCommand?.() && interaction.commandName === 'done') {
      await handleDone(interaction);
      return;
    }
    if (interaction.isButton?.() && String(interaction.customId || '').startsWith('rate:')) {
      await handleRating(interaction);
      return;
    }
    if (interaction.isButton?.() && String(interaction.customId || '').startsWith('case:accept:')) {
      await handleAcceptCase(interaction);
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
  const ids = new Set();
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
  testCommand,
  registerSlashCommands,
  setTestQuestionHandler,
  isVectorTestParent,
  handleTest,
  closeNotice,
  closePayload,
  closeHandoff,
  handleRating,
  canAcceptCase,
  handleAcceptCase,
  handleInteraction,
  notifyLinkedThreads,
};
