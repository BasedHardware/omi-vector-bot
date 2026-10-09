const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags } = require('discord.js');
const github = require('./github');
const supportCases = require('./supportCases');
const links = require('./supportIssueLinks');
const { validateStaffDestination } = require('./discordPrivacy');
const { staffMentionIds } = require('./handoff');

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const sensitiveLanes = new Set(['shop', 'money', 'account', 'privacy']);
const publicationStates = new Set(['filed', 'commented']);

function scopeOf(value) {
  return Object.fromEntries(['caseId', 'customerId', 'sourceMessageId', 'channelId', 'threadId', 'botUserId', 'repo', 'kind', 'targetIssueNumber'].map((key) => [key, value[key]]));
}

function publicTechnicalTitle(area) {
  const names = { app: 'app', desktop: 'desktop', firmware: 'firmware', integrations: 'integration', unknown: 'product' };
  return `Omi ${names[area] || 'product'} support report`;
}

function privateStaffAuthorized(interaction) {
  const staffChannel = String(process.env.STAFF_ALERT_CHANNEL_ID || '');
  if (!staffChannel || String(interaction.channelId || interaction.channel?.id) !== staffChannel ||
      String(interaction.channel?.id) !== staffChannel || interaction.channel?.isThread?.()) return false;
  const user = String(interaction.user?.id || ''); const { users, roles } = staffMentionIds();
  if (!user) return false;
  if (users.includes(user)) return true;
  const cache = interaction.member?.roles?.cache;
  if (roles.some((id) => cache?.has?.(id) || cache?.includes?.(id))) return true;
  try {
    const permissions = interaction.memberPermissions || interaction.member?.permissions;
    return Boolean(permissions?.has?.('Administrator', true) || permissions?.has?.('ManageThreads', true));
  } catch { return false; }
}

function approvalCard(approval, sourceUrl = '') {
  const target = approval.kind === 'comment' ? `https://github.com/${approval.repo}/issues/${approval.targetIssueNumber}` : approval.repo;
  const fields = [{ name: 'GitHub target', value: target }];
  if (sourceUrl && /^https:\/\/discord\.com\/channels\/\d+\/\d+\/\d+$/.test(sourceUrl)) fields.push({ name: 'Customer evidence', value: `[Open original message](${sourceUrl})` });
  return {
    embeds: [{ title: approval.kind === 'comment' ? 'Review an engineering update' : 'Review an issue draft',
      description: 'Write a technical summary, then inspect the public preview. Customer text and attachments are not forwarded automatically.', fields }],
    components: [{ type: 1, components: [{ type: 2, style: 1, custom_id: `file:${approval.id}`, label: 'Review technical summary' }] }],
    allowedMentions: { parse: [] },
  };
}

function createGithubFlow({ api = github, cases = supportCases, issueLinks = links,
  authorize = privateStaffAuthorized, validateDestination = validateStaffDestination,
  log = console.error } = {}) {
  async function ownedCase(approval) {
    if (!approval || approval.repo.toLowerCase() !== api.repo().toLowerCase()) return null;
    const value = await cases.getCaseById(approval.caseId);
    if (!value || value.customerId !== approval.customerId ||
      ![value.channelId, value.customerThreadId, value.handoffThreadId].includes(approval.threadId) ||
      sensitiveLanes.has(value.context?.area) || sensitiveLanes.has(value.context?.lane)) return null;
    return value;
  }

  async function prepare({ message, client, supportCase, kind = 'issue', issueNumber }) {
    if (!api.isConfigured() || !api.isApprovalReady() || !process.env.STAFF_ALERT_CHANNEL_ID || !client?.user?.id ||
      !supportCase || supportCase.customerId !== String(message.author?.id) ||
      ![supportCase.channelId, supportCase.customerThreadId, supportCase.handoffThreadId].includes(String(message.channel?.id)) ||
      sensitiveLanes.has(supportCase.context?.area) || sensitiveLanes.has(supportCase.context?.lane)) return null;
    return api.createScopedApproval({
      title: publicTechnicalTitle(supportCase.context?.area),
      body: 'Technical details pending staff review.', labels: [], files: { size: Number(message.attachments?.size || 0) },
    }, {
      caseId: supportCase.id, customerId: supportCase.customerId, sourceMessageId: String(message.id),
      channelId: String(process.env.STAFF_ALERT_CHANNEL_ID), threadId: String(message.channel.id),
      botUserId: String(client.user.id), repo: api.repo(), kind,
      targetIssueNumber: kind === 'comment' ? Number(issueNumber) : null,
    });
  }

  async function bindCard(approval, sent) {
    if (!approval || !sent?.id || String(sent.author?.id || '') !== approval.botUserId) throw new Error('Unverifiable approval card');
    const bound = await api.bindApprovalCard(approval.id, { ...scopeOf(approval), cardMessageId: String(sent.id), cardAuthorId: String(sent.author.id) });
    if (!bound) throw new Error('Unverifiable approval card');
    return bound;
  }

  async function respond(interaction, payload) {
    const body = typeof payload === 'string' ? { content: payload } : payload;
    return interaction.editReply({ ...body, allowedMentions: { parse: [] } });
  }

  async function privateDestination(interaction) {
    const channelId = String(process.env.STAFF_ALERT_CHANNEL_ID || '');
    const guildId = String(interaction.guildId || interaction.channel?.guildId || interaction.channel?.guild?.id || '');
    if (!channelId || !guildId || typeof interaction.client?.channels?.fetch !== 'function') return false;
    const fresh = await interaction.client.channels.fetch(channelId, { force: true });
    if (!fresh || String(fresh.id) !== channelId || String(fresh.guild?.id || '') !== guildId ||
        (fresh.guildId && String(fresh.guildId) !== guildId)) return false;
    const { users, roles } = staffMentionIds();
    return (await validateDestination(fresh, {
      botUserId: String(interaction.client?.user?.id || ''), staffUsers: users, staffRoleIds: roles,
    })).ok;
  }

  async function notifyCustomer(approval, url, client) {
    try {
      const value = await ownedCase(approval);
      if (!value) return false;
      const channel = await client.channels.fetch(approval.threadId, { force: true });
      const text = approval.kind === 'comment' ? `A support-reviewed technical update was posted on ${url}` : `This report is tracked on GitHub: ${url}`;
      const payload = { content: text, allowedMentions: { parse: [], repliedUser: false } };
      if (!channel?.isTextBased?.() || String(channel.id) !== approval.threadId) return false;
      let original;
      try { original = await channel.messages?.fetch?.(approval.sourceMessageId); } catch { original = null; }
      if (original) {
        if (String(original.id || '') !== approval.sourceMessageId || String(original.author?.id || '') !== approval.customerId || typeof original.reply !== 'function') return false;
        await original.reply(payload);
      } else {
        const handoff = Boolean(value.handoffThreadId && String(channel.id) === value.handoffThreadId);
        const customerPost = Boolean(value.customerThreadId && String(channel.id) === value.customerThreadId && String(channel.ownerId || '') === approval.customerId);
        if (!channel.isThread?.() || typeof channel.send !== 'function' || (!handoff && !customerPost)) return false;
        // A forum post shared by several customer cases is not a fallback target.
        if (!handoff && (await cases.getCaseByThread?.(String(channel.id)))?.id !== value.id) return false;
        await channel.send(payload);
      }
      return true;
    } catch { log('[GitHubFlow] customer tracking notice unavailable'); return false; }
  }

  async function review(interaction, id) {
    const approval = await api.getScopedApproval(id);
    if (!approval) return respond(interaction, 'This draft is unavailable or no longer matches its customer case. Nothing was posted.');
    if (!approval.cardMessageId || String(interaction.message?.id || '') !== approval.cardMessageId ||
        String(interaction.message?.author?.id || '') !== approval.botUserId) {
      return respond(interaction, 'This review button does not match the original bot card. Nothing was posted.');
    }
    if (!(await ownedCase(approval))) return respond(interaction, 'This draft is unavailable or no longer matches its customer case. Nothing was posted.');
    if (approval.status === 'filing') return respond(interaction, 'Publication is in progress. Wait for its recorded outcome, then reopen this card. It will not start another attempt.');
    if (publicationStates.has(approval.status) || approval.status === 'unknown') {
      const filed = publicationStates.has(approval.status);
      if (approval.approvedBy !== String(interaction.user.id)) {
        return respond(interaction, filed
          ? 'This action is already recorded. Only the staff member who approved it can repair the recorded link; ask them to reopen this card.'
          : 'Publication remains held. Only the staff member who approved it can check the result; ask them to reopen this card.');
      }
      return respond(interaction, {
        content: filed
          ? `This action is already recorded: ${approval.externalIssueUrl || approval.externalCommentUrl || ''}. Check the recorded result to repair its case link without posting again.`
          : 'Publication is uncertain and remains held to prevent a duplicate. Check GitHub for the exact approved result; this control will not publish again.',
        components: [{ type: 1, components: [{ type: 2, style: 2,
          label: filed ? 'Check recorded result' : 'Check GitHub result', custom_id: `gh-check:${approval.id}:${approval.revision}` }] }],
      });
    }
    const began = await api.beginApprovalEdit(id, {
      ...scopeOf(approval), authorized: true, staffId: String(interaction.user.id),
      cardMessageId: String(interaction.message?.id || ''), cardAuthorId: String(interaction.message?.author?.id || ''),
    });
    if (!began?.ok) return respond(interaction, 'This review button is expired or does not match the original bot card. Nothing was posted.');
    return respond(interaction, {
      content: 'Prepare a public technical summary in your own words. It will be used to check related GitHub work and shown in a private preview before publication. Include symptoms, reproduction steps and versions—not customer contacts, order/payment details, recordings or private screenshots.',
      components: [{ type: 1, components: [{ type: 2, style: 1, label: 'Write technical summary', custom_id: `gh-edit:${approval.id}:${began.editToken}` }] }],
    });
  }

  async function preview(interaction, id, token) {
    const approval = await api.getScopedApproval(id);
    if (!approval || !(await ownedCase(approval))) return respond(interaction, 'This case is no longer available for publication. Nothing was posted.');
    const title = interaction.fields.getTextInputValue('title');
    const summary = interaction.fields.getTextInputValue('summary');
    const updated = await api.updateApprovalDraft(id, {
      ...scopeOf(approval), scope: scopeOf(approval), staffId: String(interaction.user.id), editToken: token,
      draft: { title, body: `## Technical summary\n\n${summary}`, labels: [], files: approval.draft.files },
    });
    if (!updated) return respond(interaction, 'This editor expired or belongs to a different staff member. Reopen the original review button. Nothing was posted.');
    const payload = updated.kind === 'comment'
      ? { title: updated.draft.title, body: api.publicMutationBody(updated.draft.body, updated.id) }
      : api.issuePublicationPayload({ ...updated.draft, approvalId: updated.id });
    let related;
    if (updated.kind === 'issue') {
      const found = await api.existingWork(`${payload.title}\n${updated.draft.body}`);
      if (found.error) return respond(interaction, 'The summary is saved, but checking related GitHub work failed. Reopen the review when GitHub is available; nothing was posted.');
      related = found.hit;
    }
    const target = updated.kind === 'comment' ? `https://github.com/${updated.repo}/issues/${updated.targetIssueNumber}` : updated.repo;
    const embed = {
      title: updated.kind === 'comment' ? 'Public comment preview' : 'Public issue preview',
      description: payload.body,
      fields: [{ name: 'Target', value: target }, { name: 'Title', value: payload.title },
        { name: 'Privacy check', value: 'Confirm that this is a technical summary with no private customer information. The operation marker is used for duplicate detection.' }],
    };
    if (related?.url) embed.fields.push({ name: 'Related work', value: `${related.url}\nReview this first. Publishing here creates a separate report; related work is not proof the customer issue is fixed.` });
    const sent = await respond(interaction, {
      embeds: [embed], components: [{ type: 1, components: [{ type: 2, style: 1,
        custom_id: `gh-publish:${updated.id}:${updated.revision}`,
        label: updated.kind === 'comment' ? 'Publish reviewed update' : related ? 'Publish separate issue' : 'Publish reviewed issue' }] }],
    });
    const bound = sent?.id && await api.bindApprovalPreview(updated.id, {
      ...scopeOf(updated), authorized: true, staffId: String(interaction.user.id), revision: updated.revision,
      payloadHash: updated.payloadHash, previewMessageId: String(sent.id), cardAuthorId: String(sent.author?.id || ''),
    });
    if (!bound) await respond(interaction, { content: 'The preview could not be secured for approval. Reopen the original review button; nothing was posted.', embeds: [], components: [] });
  }

  async function publish(interaction, id, revision) {
    const approval = await api.getScopedApproval(id);
    if (!approval || !(await ownedCase(approval))) return respond(interaction, 'This action no longer matches its case or repository. Nothing was posted.');
    const existing = approval.kind === 'issue' ? await issueLinks.findForSource(approval.caseId, approval.repo, approval.sourceMessageId) : null;
    if (existing) return respond(interaction, `This source report is already linked to https://github.com/${existing.repo}/issues/${existing.issueNumber}. No new issue was created.`);
    const claim = await api.claimApproval(id, {
      ...scopeOf(approval), authorized: true, staffId: String(interaction.user.id), revision,
      payloadHash: approval.payloadHash, previewMessageId: String(interaction.message?.id || ''),
      cardAuthorId: String(interaction.message?.author?.id || ''),
    });
    if (!claim?.ok) {
      if (claim?.status === 'unknown') return respond(interaction, {
        content: 'The previous publication is uncertain. Check for the exact recorded result before any retry.',
        components: [{ type: 1, components: [{ type: 2, style: 2, label: 'Check GitHub result', custom_id: `gh-check:${approval.id}:${approval.revision}` }] }],
      });
      return respond(interaction, `This preview is no longer publishable (${claim?.status || 'unavailable'}). Nothing new was posted.`);
    }
    const current = claim.approval;
    const result = current.kind === 'comment'
      ? await api.commentOnIssue(current.targetIssueNumber, current.draft.body, { approvalId: current.id })
      : await api.createIssue({ ...current.draft, approvalId: current.id });
    if (!result?.ok) {
      if (result?.outcome === 'known_rejected') {
        await api.recordApprovalRejected(id, { leaseToken: claim.leaseToken, code: 'http_rejected' });
        return respond(interaction, 'GitHub rejected this publication. Nothing was accepted; inspect the configuration or edit the draft before a deliberate retry.');
      }
      await api.recordApprovalUnknown(id, { leaseToken: claim.leaseToken, code: 'remote_unknown' });
      return respond(interaction, { content: 'GitHub publication could not be confirmed. It may already exist. This action is held to prevent a duplicate.',
        components: [{ type: 1, components: [{ type: 2, style: 2, label: 'Check GitHub result', custom_id: `gh-check:${current.id}:${current.revision}` }] }],
      });
    }
    try {
      if (current.kind === 'comment') {
        const recorded = await api.recordApprovalCommented(id, { leaseToken: claim.leaseToken,
          id: result.id, commentId: result.id, number: current.targetIssueNumber, url: result.url });
        if (!recorded || recorded.status !== 'filed') throw new Error('Accepted receipt was not recorded');
        await issueLinks.link({ repo: current.repo, issueNumber: current.targetIssueNumber, caseId: current.caseId,
          customerId: current.customerId, channelId: (await cases.getCaseById(current.caseId)).channelId,
          threadId: current.threadId, sourceMessageId: current.sourceMessageId, approvedBy: String(interaction.user.id) });
        api.linkIssueThread(current.targetIssueNumber, current.threadId, { persist: false });
      } else {
        const recorded = await api.recordApprovalFiled(id, { leaseToken: claim.leaseToken, number: result.number, url: result.url });
        if (!recorded || recorded.status !== 'filed') throw new Error('Accepted receipt was not recorded');
        await issueLinks.link({ repo: current.repo, issueNumber: result.number, caseId: current.caseId,
          customerId: current.customerId, channelId: (await cases.getCaseById(current.caseId)).channelId,
          threadId: current.threadId, sourceMessageId: current.sourceMessageId, approvedBy: String(interaction.user.id) });
        api.linkIssueThread(result.number, current.threadId, { persist: false });
      }
    } catch {
      log('[GitHubFlow] accepted publication recording incomplete');
      return respond(interaction, { content: `GitHub accepted ${result.url}, but saving the local record failed. Do not publish again; reconcile this existing result first.`,
        components: [{ type: 1, components: [{ type: 2, style: 2, label: 'Check recorded result', custom_id: `gh-check:${current.id}:${current.revision}` }] }],
      });
    }
    const delivered = await notifyCustomer(current, result.url, interaction.client);
    return respond(interaction, `${current.kind === 'comment' ? 'Posted' : 'Filed'} ${result.url}${delivered ? '' : '\nThe customer notice was not confirmed. Reply using the original customer message link.'}`);
  }

  async function check(interaction, id, revision) {
    const approval = await api.getScopedApproval(id);
    if (!approval || approval.revision !== revision || !(await ownedCase(approval)) ||
      String(interaction.message?.author?.id || '') !== approval.botUserId || approval.approvedBy !== String(interaction.user.id)) {
      return respond(interaction, 'This check does not match the approved action. Nothing was posted.');
    }
    if (approval.status === 'filed') {
      const value = await cases.getCaseById(approval.caseId);
      await issueLinks.link({ repo: approval.repo, issueNumber: approval.externalIssueNumber, caseId: value.id,
        customerId: value.customerId, channelId: value.channelId, threadId: approval.threadId,
        sourceMessageId: approval.sourceMessageId, approvedBy: approval.approvedBy });
      api.linkIssueThread(approval.externalIssueNumber, approval.threadId, { persist: false });
      return respond(interaction, `The accepted result is recorded and linked: ${approval.externalIssueUrl}. No new GitHub post was sent.`);
    }
    if (approval.status !== 'unknown') return respond(interaction, 'This action is not awaiting reconciliation. Its state has not been changed.');
    const found = await api.findApprovalPublication(approval);
    if (!found.ok || !found.found) return respond(interaction, 'The exact GitHub result is not verified yet. The action remains held; no duplicate was posted.');
    const receipt = { ...found.outcomeData, leaseToken: approval.leaseToken, reconciled: true };
    const recorded = approval.kind === 'comment'
      ? await api.recordApprovalCommented(approval.id, receipt)
      : await api.recordApprovalFiled(approval.id, receipt);
    if (!recorded || recorded.status !== 'filed') throw new Error('Verified receipt was not recorded');
    const value = await cases.getCaseById(approval.caseId);
    await issueLinks.link({ repo: approval.repo, issueNumber: receipt.number, caseId: value.id,
      customerId: value.customerId, channelId: value.channelId, threadId: approval.threadId,
      sourceMessageId: approval.sourceMessageId, approvedBy: approval.approvedBy });
    api.linkIssueThread(receipt.number, approval.threadId, { persist: false });
    await respond(interaction, `Verified the existing result: ${receipt.url}. No new GitHub post was sent.`);
  }

  async function handleInteraction(interaction) {
    const id = String(interaction.customId || '');
    const reviewId = id.match(new RegExp(`^file:(${UUID})$`, 'i'))?.[1];
    const edit = id.match(new RegExp(`^gh-edit:(${UUID}):(${UUID})$`, 'i'));
    const summary = id.match(new RegExp(`^gh-summary:(${UUID}):(${UUID})$`, 'i'));
    const confirmation = id.match(new RegExp(`^gh-publish:(${UUID}):(\\d+)$`, 'i'));
    const checking = id.match(new RegExp(`^gh-check:(${UUID}):(\\d+)$`, 'i'));
    if (!reviewId && !edit && !summary && !confirmation && !checking) {
      if (id.startsWith('file:')) { await interaction.reply({ content: 'This older File button cannot be verified. Use the current private staff case workflow.', flags: MessageFlags.Ephemeral }); return true; }
      return false;
    }
    if (!authorize(interaction)) { await interaction.reply({ content: 'Only authorized staff can prepare public GitHub updates in the configured staff channel.', flags: MessageFlags.Ephemeral }); return true; }
    if (edit) {
      if (String(interaction.message?.author?.id || '') !== String(interaction.client?.user?.id || '')) {
        await interaction.reply({ content: 'This is not a bot-authored summary editor.', flags: MessageFlags.Ephemeral }); return true;
      }
      const modal = new ModalBuilder().setCustomId(`gh-summary:${edit[1]}:${edit[2]}`).setTitle('Prepare a technical report');
      modal.addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('title').setLabel('Public technical title').setStyle(TextInputStyle.Short).setRequired(true).setMinLength(8).setMaxLength(80)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('summary').setLabel('Technical details only — no customer data').setStyle(TextInputStyle.Paragraph).setRequired(true).setMinLength(30).setMaxLength(1600))
      );
      await interaction.showModal(modal); return true;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      if (!(await privateDestination(interaction))) { await respond(interaction, 'This destination is not verified as staff-only. Nothing was posted.'); return true; }
      if (!api.isConfigured() || !api.isApprovalReady()) { await respond(interaction, 'Secure GitHub publication is unavailable. The case remains with staff; nothing was posted.'); return true; }
      if (reviewId) await review(interaction, reviewId);
      else if (summary) await preview(interaction, summary[1], summary[2]);
      else if (checking) await check(interaction, checking[1], Number(checking[2]));
      else await publish(interaction, confirmation[1], Number(confirmation[2]));
    } catch {
      log('[GitHubFlow] approval operation failed');
      await respond(interaction, 'The operation could not be completed. Its existing record has not been reset; check the case before retrying.');
    }
    return true;
  }

  return { prepare, bindCard, handleInteraction, approvalCard };
}

module.exports = { createGithubFlow, privateStaffAuthorized, scopeOf, approvalCard };
