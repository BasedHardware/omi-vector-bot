const { REST, Routes, SlashCommandBuilder, MessageFlags } = require('discord.js');
const { isCloseableThread, canStaffAct, staffMentionIds, markHandoffClosed, sendToStaffChannel } = require('./handoff');
const github = require('./github');
const orderFlow = require('./orderFlow');
const supportCases = require('./supportCases');
const { appReviewButtons } = require('./appReviews');
const githubFlow = require('./githubFlow').createGithubFlow();
const { closingCopy } = require('./closingCopy');
const { SUPPORT_DISPLAY_NAME } = require('./supportVoice');

const OMI_LOGO_URL =
  process.env.OMI_LOGO_URL ||
  'https://raw.githubusercontent.com/BasedHardware/omi/main/app/assets/images/app_launcher_icon.png';

const doneCommand = new SlashCommandBuilder()
  .setName('done')
  .setDescription('Mark this Handoff or help thread resolved. Staff only.')
  .toJSON();

const forgetSupportHistoryCommand = new SlashCommandBuilder()
  .setName('forget-support-history')
  .setDescription('Delete retained support history for your post and stop saving it.')
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
        forgetSupportHistoryCommand,
      ],
    });
  }
  return guildIds.size;
}

function closeNotice(user, language = 'en') {
  const copy = closingCopy(language);
  const who = user?.id ? `<@${user.id}>` : copy.staff;
  return copy.description(who).join('\n\n');
}

function closePayload(user, language = 'en') {
  const copy = closingCopy(language);
  const embed = {
    author: { name: SUPPORT_DISPLAY_NAME, iconURL: OMI_LOGO_URL },
    title: copy.title,
    color: 0x111111,
    description: closeNotice(user, language),
    thumbnail: { url: OMI_LOGO_URL },
    fields: [{
      name: copy.reviewTitle,
      value: copy.reviewText,
    }],
  };
  return {
    embeds: [embed],
    components: [
      {
        type: 1,
        components: [
          { type: 2, style: 3, label: copy.resolved, custom_id: 'rate:yes' },
          { type: 2, style: 2, label: copy.needsHelp, custom_id: 'rate:no' },
        ],
      },
      appReviewButtons(copy),
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
  // Optional quality collection cannot delay the feedback acknowledgment.
  const learning = require('./supportLearning').getObserver(interaction.client?.user?.id);
  if (feedbackSaved) await learning.signal(interaction.channel, {
    eventId: `${interaction.message?.id || interaction.id || threadId}-${helped ? 'yes' : 'no'}`,
    kind: helped ? 'resolved' : 'needs_help', area: storedCase?.context?.area,
  }, clicker);
  if (reopened) await learning.signal(interaction.channel, {
    eventId: `${interaction.message?.id || interaction.id || threadId}-reopened`,
    kind: 'reopened', area: storedCase?.context?.area,
  }, clicker);
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
    delivered = await channel.send(closePayload(user, storedCase?.context?.replyLanguage));
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

async function handleCaseAction(interaction, { cases = supportCases, cards = require('./caseCards') } = {}) {
  if (!canAcceptCase(interaction)) {
    await interaction.reply({ content: 'Only authorized staff can accept a case in the configured staff channel.', flags: MessageFlags.Ephemeral });
    return;
  }
  const action = String(interaction.customId || '').match(/^case:(accept|refresh|work:(?:in_progress|waiting_customer)):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
  const caseId = action?.[2];
  const botId = String(interaction.client?.user?.id || '');
  const cardCase = (interaction.message?.embeds || []).flatMap((embed) => embed.fields || embed.data?.fields || [])
    .find((field) => field.name === 'Case')?.value;
  if (!caseId || !botId || String(interaction.message?.author?.id || '') !== botId || cardCase !== caseId) {
    await interaction.reply({ content: 'That is not a valid case acceptance card.', flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  let value;
  try {
    value = action[1] === 'accept' ? await cases.markAccepted(caseId, { staffId: interaction.user.id })
      : action[1] === 'refresh' ? await cases.getCaseById(caseId) : await cases.setWorkStatus(caseId, action[1].slice(5));
  } catch {
    console.error('[CaseCard] staff action state not confirmed');
    await interaction.editReply({ content: 'I could not confirm the saved case state. Use Refresh status before trying the action again.', allowedMentions: { parse: [] } });
    return;
  }
  if (!value) {
    await interaction.editReply({ content: 'This action is not available in the current case state. Accept a delivered case before starting work.', allowedMentions: { parse: [] } });
    return;
  }
  let refreshed = false;
  try {
    await cards.rememberCard(caseId, interaction.channelId, interaction.message.id);
    refreshed = Boolean((await cards.syncCase(interaction.client, caseId))?.ok);
  } catch { console.error('[CaseCard] staff action refresh failed; pending retry'); }
  let notice = null;
  if (action[1] === 'accept') {
    try { notice = await cards.notifyAcceptance(interaction.client, value, { service: cases }); }
    catch { console.error('[CaseCard] acceptance notice not confirmed'); notice = { ok: false }; }
  }
  const summary = action[1] === 'accept' ? `Case accepted by <@${value.acceptedBy}>.`
    : action[1] === 'work:in_progress' ? 'Case marked In progress.'
      : action[1] === 'work:waiting_customer' ? 'Case marked Waiting for customer.' : 'Case status refreshed.';
  await interaction.editReply({
    content: [summary,
      refreshed ? 'The staff card is up to date.' : 'The card refresh is not confirmed; use Refresh status to check it.',
      notice ? notice.ok ? notice.duplicate ? 'No duplicate customer notice was sent.' : 'The customer thread was updated.'
        : 'The customer notice was not confirmed. Please reply in their thread yourself.' : '',
    ].filter(Boolean).join(' '),
    allowedMentions: { parse: [] },
  });
}

const handleAcceptCase = (interaction, options) => handleCaseAction(interaction, options);

async function handleInteraction(interaction) {
  try {
    if (await orderFlow.handleOrderInteraction(interaction)) return;
    if (await githubFlow.handleInteraction(interaction)) return;
    if (interaction.isChatInputCommand?.() && interaction.commandName === 'forget-support-history') {
      await handleForgetSupportHistory(interaction);
      return;
    }
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
    if (interaction.isButton?.() && /^case:(?:accept|refresh|work:)/.test(String(interaction.customId || ''))) {
      await handleCaseAction(interaction);
      return;
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

async function handleForgetSupportHistory(interaction, { forget = require('./supportLearning').forgetOwnedThread } = {}) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const respond = content => interaction.editReply({ content, allowedMentions: { parse: [] } });
  const customerId = String(interaction.user?.id || '');
  if (!customerId || String(interaction.channel?.ownerId || '') !== customerId) {
    await respond('Use this command in your own support post.'); return;
  }
  try {
    if (await forget(interaction.channel, customerId)) {
      await respond('Retained support history for this post was deleted. I won’t save new history here. Your messages in Discord are unchanged.');
      return;
    }
  } catch { console.error('[SupportMemory] customer erasure not confirmed'); }
  await respond('I couldn’t confirm deletion of retained history here. Please contact help@omi.me for a data-deletion request.');
}

async function notifyLinkedThreads(client, event, options = {}) {
  const nums = event?.numbers || (event?.number ? [event.number] : []);
  if (!client?.channels?.fetch) return 0;
  const issueLinks = options.issueLinks || require('./supportIssueLinks');
  const cases = options.cases || supportCases;
  const repo = github.repo().toLowerCase();
  const notices = [];
  const legacyIds = new Set();
  const scopedIds = new Set();
  for (const num of nums) {
    let records;
    try { records = await issueLinks.listForIssue(repo, Number(num)); }
    catch { console.error('[GitHub] scoped notice lookup unavailable'); return 0; }
    for (const record of records) {
      const target = record.threadId || record.channelId;
      if (target) scopedIds.add(String(target));
      let value;
      try { value = await cases.getCaseById(record.caseId); }
      catch { console.error('[GitHub] notice ownership lookup unavailable'); continue; }
      if (record.repo?.toLowerCase() === repo && value?.customerId === record.customerId &&
          [value.channelId, value.customerThreadId, value.handoffThreadId].includes(target)) notices.push({ record, value, target: String(target) });
    }
    // Old internal rows lack repository/customer provenance. They may support
    // legacy status notices for the original repository, never new approvals.
    if (repo === github.DEFAULT_REPO.toLowerCase()) {
      for (const id of github.threadsForIssue(num)) legacyIds.add(String(id));
    }
  }
  let n = 0;
  const seen = new Set();
  const payload = { content: event.line, allowedMentions: { parse: [], repliedUser: false } };
  for (const { record, value, target } of notices) {
    const key = JSON.stringify([repo, record.issueNumber, record.sourceMessageId]);
    if (seen.has(key)) continue;
    try {
      const ch = await client.channels.fetch(target);
      if (!ch?.isTextBased?.() || String(ch.id || '') !== target) continue;
      let original;
      try { original = await ch.messages?.fetch?.(record.sourceMessageId); }
      catch { /* A missing source can fall back only to a proven dedicated thread. */ }
      if (original) {
        if (String(original.id || '') !== record.sourceMessageId || String(original.author?.id) !== record.customerId || typeof original.reply !== 'function') continue;
        await original.reply(payload);
      } else {
        const dedicated = ch.isThread?.() && (value.handoffThreadId === target ||
          (value.customerThreadId === target && String(ch.ownerId || '') === record.customerId));
        if (!dedicated || typeof ch.send !== 'function') continue;
        await ch.send(payload);
      }
      seen.add(key);
      n += 1;
    } catch {
      console.error('[GitHub] scoped notice delivery failed');
    }
  }
  for (const id of legacyIds) {
    // A legacy mapping must never bypass a failed modern ownership/source check.
    if (scopedIds.has(id)) continue;
    try {
      const ch = await client.channels.fetch(id);
      if (!ch?.isThread?.() || !ch.isTextBased?.() || typeof ch.send !== 'function') continue;
      await ch.send(payload);
      n += 1;
    } catch {
      console.error('[GitHub] legacy thread notice delivery failed');
    }
  }
  return n;
}

module.exports = {
  doneCommand,
  forgetSupportHistoryCommand,
  handleForgetSupportHistory,
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
  handleCaseAction,
  handleInteraction,
  notifyLinkedThreads,
};
