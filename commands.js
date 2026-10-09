const { REST, Routes, SlashCommandBuilder, MessageFlags } = require('discord.js');
const { isCloseableThread, canStaffAct, staffMentionIds, markHandoffClosed, sendToStaffChannel } = require('./handoff');
const github = require('./github');
const orderFlow = require('./orderFlow');
const supportCases = require('./supportCases');
const supportDeliveries = require('./supportDeliveries');
const supportCaseActions = require('./supportCaseActions');
const { sendDiscordMessage } = require('./supportDiscordTransport');
const { editDiscordThread } = require('./supportThreadTransport');
const { createClosureWorkflow } = require('./supportClosure');
const { appReviewButtons } = require('./appReviews');
const githubFlow = require('./githubFlow').createGithubFlow();

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

function closePayload(user, { feedbackNonce = '' } = {}) {
  if (feedbackNonce && !/^[a-f0-9]{24}$/.test(feedbackNonce)) throw new Error('Invalid feedback binding');
  const feedbackId = (choice) => `rate:${choice}${feedbackNonce ? `:${feedbackNonce}` : ''}`;
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
          { type: 2, style: 3, label: 'Yes, my issue is resolved', custom_id: feedbackId('yes') },
          { type: 2, style: 2, label: 'Still need help', custom_id: feedbackId('no') },
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
  const feedback = /^rate:(yes|no)(?::([a-f0-9]{24}))?$/.exec(String(interaction.customId || ''));
  if (!feedback) {
    await respond('That is not a support feedback button.');
    return;
  }
  const helped = feedback[1] === 'yes';
  const feedbackNonce = feedback[2] || '';
  const threadId = String(interaction.channelId || interaction.channel?.id || '');
  const cases = options.cases || supportCases;
  const deliveries = options.deliveries || supportDeliveries.getService();
  const patchThread = options.patchThread || editDiscordThread;
  let closingReceipt;
  let storedCase;
  try {
    if (feedbackNonce) {
      closingReceipt = await deliveries.getByNonce(feedbackNonce);
      if (!closingReceipt || closingReceipt.kind !== 'closure' || closingReceipt.channelId !== threadId ||
          closingReceipt.botUserId !== String(interaction.client?.user?.id || '')) {
        await respond('This closing notice could not be verified. Please use the original closing notice in this thread.');
        return;
      }
      storedCase = await cases.getCaseById(closingReceipt.caseId);
    } else {
      const scope = threadId ? await threadCaseScope(cases, threadId) : { case: null, ambiguous: false };
      if (scope.ambiguous) {
        await respond('This thread has multiple customer cases. Please use the closing notice in your own case thread.');
        return;
      }
      if (scope.count > 1) {
        await respond('This older feedback button cannot identify the current case. Please use its latest closing notice.');
        return;
      }
      storedCase = scope.case;
    }
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
  if (closingReceipt && (!storedCase || storedCase.customerId !== closingReceipt.customerId ||
      storedCase.generation !== closingReceipt.caseGeneration)) {
    await respond('That notice belongs to an earlier support cycle. Please use the current case’s latest closing notice for feedback.');
    return;
  }
  if (!closingReceipt && storedCase?.id) {
    let tracked;
    try { tracked = await deliveries.get(`closure:${storedCase.id}:${storedCase.generation}:${threadId}`); }
    catch {
      console.error('[Bot] feedback receipt lookup unavailable');
      await respond('I could not check this closing notice just now. Your feedback has not been saved; please try again.');
      return;
    }
    if (storedCase.generation > 0 || tracked) {
      await respond(storedCase.generation > 0 && ['queued', 'delivered', 'accepted'].includes(storedCase.status)
        ? 'This case is reopened. Continue in this thread; this older button cannot save new feedback or change the current cycle.'
        : 'Please use the latest closing notice for this support case. This older feedback button cannot reopen it.');
      return;
    }
  }
  if (closingReceipt) {
    try {
      closingReceipt = await deliveries.acceptClosureInteractionReceipt(interaction.message, feedbackNonce);
    } catch { closingReceipt = null; }
    if (!closingReceipt) {
      await respond('This closing notice could not be verified. No feedback or case change has been saved.');
      return;
    }
  }
  let counts = { yes: 0, no: 0 };
  let feedbackSaved = false;
  let reopened = false;
  let threadReopened = false;
  let reopeningComplete = false;
  let coordinationLost = false;
  const applyFeedback = async (assertOwned = async () => {}) => {
    if (storedCase?.id && typeof cases.getCaseById === 'function') {
      const fresh = await cases.getCaseById(storedCase.id);
      if (!fresh || fresh.customerId !== clicker || fresh.generation !== storedCase.generation) {
        throw new Error('Feedback cycle changed');
      }
      storedCase = fresh;
    }
    await assertOwned();
    try {
      counts = await (options.recordRating || require('./ratings').recordRating)(threadId, clicker, helped);
      feedbackSaved = true;
    } catch { console.error('[Bot] rating save failed'); }
    if (helped || !storedCase) return;
    try {
      const active = await cases.getActiveCase(storedCase.channelId, clicker);
      if (active && active.id !== storedCase.id) throw new Error('A newer support case is active');
      const channel = interaction.channel;
      // Persist the customer's new intent before physical thread updates. A
      // delayed accepted close receipt must never close this new generation.
      if (closingReceipt) {
        reopened = Boolean(await cases.reopenByThread(threadId, clicker, {
          expectedCaseId: closingReceipt.caseId, expectedGeneration: closingReceipt.caseGeneration, forceGeneration: true,
        }));
        if (!reopened) throw new Error('Case generation changed');
      }
      await assertOwned();
      if (closingReceipt) {
        await patchThread(interaction.client, channel, { archived: false, locked: false });
      } else if (typeof channel?.edit === 'function') {
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
      await assertOwned();
      require('./handoff').markHandoffReopened?.(channel);
      const tagId = resolvedTagId(channel);
      if (tagId && (closingReceipt || typeof channel.setAppliedTags === 'function')) {
        const appliedTags = (channel.appliedTags || []).map(String).filter((id) => id !== tagId);
        if (closingReceipt) { await assertOwned(); await patchThread(interaction.client, channel, { appliedTags }); }
        else await channel.setAppliedTags(appliedTags, 'Customer still needs help');
      }
      if (!closingReceipt) reopened = Boolean(await cases.reopenByThread(threadId, clicker));
      if (!reopened && ['queued', 'delivered', 'accepted'].includes(storedCase.status) && !channel.archived && !channel.locked) reopened = true;
      const database = options.db || (process.env.DATABASE_URL ? require('./db') : null);
      if (reopened && storedCase.escalationId && database) {
        if (typeof database.reopenEscalation !== 'function') throw new Error('Escalation cannot be reopened');
        await assertOwned();
        await database.reopenEscalation(storedCase.escalationId);
      }
      reopeningComplete = reopened;
    } catch (err) {
      console.error('[Bot] case reopen failed:', err.name);
    }
  };
  try {
    if (storedCase?.id) await (options.actions || supportCaseActions.getService()).run(storedCase.id, applyFeedback);
    else await applyFeedback();
  } catch {
    console.error('[Bot] feedback coordination unavailable or cycle changed');
    if (!feedbackSaved && !reopened && !threadReopened) {
      await respond('This case is being updated or that closing notice is outdated. Please use the latest closing notice; no new feedback or case change was saved by this attempt.');
      return;
    }
    coordinationLost = true;
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
  const note = coordinationLost
    ? `${feedbackSaved ? 'Your feedback was saved. ' : 'Your feedback has not been saved. '}I could not confirm the final case/thread state. If you still need help, please open a new Help post.`
    : reopened && !threadReopened
    ? `Your case is reopened, but I could not reopen this thread. Please open a new Help post.${feedbackSaved ? ' Your feedback is recorded.' : ' Your feedback has not been saved.'}`
    : reopened && threadReopened && !reopeningComplete
    ? `Your case and thread are reopened, but the tracking update is incomplete. You can continue here.${feedbackSaved ? ' Your feedback is recorded.' : ' Your feedback has not been saved.'}`
    : !feedbackSaved
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

async function applyResolvedTag(channel, patchThread = null) {
  const tagId = resolvedTagId(channel);
  if (!tagId || (!patchThread && typeof channel.setAppliedTags !== 'function')) return;
  const current = [...(channel.appliedTags || [])].map(String);
  if (current.includes(tagId)) return;
  if (patchThread) await patchThread(channel, { appliedTags: [...current, tagId] });
  else await channel.setAppliedTags([...current, tagId], 'Resolved with /done');
}

async function archiveHandoff(channel, guard = async () => {}, patchThread = null) {
  const definitePermissionRejection = (error) => Number(error?.code) === 50013 &&
    (error?.status == null || Number(error.status) === 403);
  if (patchThread || typeof channel.edit === 'function') {
    await guard();
    try {
      if (patchThread) await patchThread(channel, { archived: true, locked: true });
      else await channel.edit({ archived: true, locked: true, reason: 'Resolved with /done' });
      return;
    } catch (err) {
      console.error('[Bot] /done lock+archive unconfirmed');
      if (!definitePermissionRejection(err)) throw err;
    }
    await guard();
    try {
      if (patchThread) await patchThread(channel, { archived: true });
      else await channel.edit({ archived: true, reason: 'Resolved with /done' });
      return;
    } catch (err) {
      console.error('[Bot] /done archive unconfirmed');
      throw err;
    }
  }
  if (typeof channel.setArchived === 'function') {
    await guard();
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
    const scope = threadId ? await threadCaseScope(cases, threadId) : { case: null, ambiguous: false, count: 0 };
    if (scope.ambiguous) return { ok: false, reason: 'This thread has multiple customer cases. Close the exact customer case in its own thread instead.' };
    storedCase = scope.case;
    if (!storedCase) escalation = database && threadId ? await database.getPendingEscalation(threadId) : null;
  } catch (err) {
    console.error('[Bot] /done case lookup failed:', err.name);
    return { ok: false, reason: 'Could not read this case. The thread has not been closed.' };
  }
  if (storedCase) return closureWorkflow({ ...options, client: options.client || channel.client }).close({
    channel, user, client: options.client || channel.client, customerCase: storedCase, payloadFn: closePayload,
  });
  // Untracked legacy threads retain the manual closure path. They never
  // stand in for an ambiguous durable customer case.
  let delivered;
  try {
    delivered = await channel.send(closePayload(user));
  } catch (err) {
    console.error('[Bot] /done notice failed:', err.message);
    return { ok: false, reason: 'Could not post the resolved message.' };
  }
  try {
    if (database && escalation?.id) {
      await database.resolveEscalation(escalation.id);
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

async function threadCaseScope(cases, threadId) {
  if (typeof cases.getThreadCaseScope === 'function') return cases.getThreadCaseScope(threadId);
  // Compatibility for isolated injected test adapters, not a database fallback.
  const value = await cases.getCaseByThread(threadId);
  return { case: value, ambiguous: false, count: value ? 1 : 0 };
}

function closureWorkflow(options = {}) {
  const database = options.db || (process.env.DATABASE_URL ? require('./db') : null);
  return createClosureWorkflow({
    cases: options.cases || supportCases,
    deliveries: options.deliveries || supportDeliveries.getService(),
    actions: options.actions || supportCaseActions.getService(),
    botUserId: () => options.client?.user?.id,
    sendNotice: options.sendNotice || sendDiscordMessage,
    finishThread: options.finishThread || (async (channel, guard) => {
      const patch = (target, changes) => (options.patchThread || editDiscordThread)(options.client, target, changes);
      await guard();
      await applyResolvedTag(channel, patch);
      await guard();
      await archiveHandoff(channel, guard, patch);
    }),
    resolveEscalation: (id) => database ? database.resolveEscalation(id) : Promise.resolve(),
    markThreadClosed: markHandoffClosed,
  });
}

function canCloseCase(interaction) {
  const staffId = String(interaction.user?.id || '');
  const { users, roles } = staffMentionIds();
  const permissions = interaction.memberPermissions || interaction.member?.permissions;
  return Boolean(staffId && (users.includes(staffId) ||
    roles.some((id) => interaction.member?.roles?.cache?.has?.(id) ||
      (Array.isArray(interaction.member?.roles) && interaction.member.roles.map(String).includes(id))) ||
    permissions?.has?.('ManageThreads') || permissions?.has?.('Administrator')));
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
  if (!canCloseCase(interaction)) {
    await interaction.reply({
      content: 'Only staff can close a thread.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  let result;
  try {
    result = await closeHandoff(interaction.channel, interaction.user, { client: interaction.client });
  } catch (err) {
    console.error('[Bot] /done close failed:', err.message);
    result = { ok: false, reason: 'Could not close the thread.' };
  }
  try {
    await interaction.editReply(result.ok ? result.reason || 'Marked resolved.' : result.reason);
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
    if (await githubFlow.handleInteraction(interaction)) return;
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
  testCommand,
  registerSlashCommands,
  setTestQuestionHandler,
  isVectorTestParent,
  handleTest,
  closeNotice,
  closePayload,
  closeHandoff,
  canCloseCase,
  handleDone,
  repairClosureReceipt: (row, options = {}) => closureWorkflow(options).repair(row),
  handleRating,
  canAcceptCase,
  handleAcceptCase,
  handleInteraction,
  notifyLinkedThreads,
};
