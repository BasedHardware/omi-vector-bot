const test = require('node:test');
const assert = require('node:assert/strict');
const { MessageFlags, ActionRowBuilder, EmbedBuilder } = require('discord.js');
const { createGithubFlow, privateStaffAuthorized } = require('../githubFlow');
const github = require('../github');
const { createApprovalService, createMemoryStore: approvalMemory } = require('../supportApprovals');
const { createCaseService, createMemoryStore: caseMemory } = require('../supportCases');
const { createIssueLinkService, createMemoryStore: linkMemory } = require('../supportIssueLinks');
const { makeStaffChannel } = require('./fixtures/discord-staff-channel');

async function fixture(t, { kind = 'issue', result } = {}) {
  const previous = process.env.STAFF_ALERT_CHANNEL_ID;
  process.env.STAFF_ALERT_CHANNEL_ID = 'staff-room';
  t.after(() => { if (previous === undefined) delete process.env.STAFF_ALERT_CHANNEL_ID; else process.env.STAFF_ALERT_CHANNEL_ID = previous; });
  const cases = createCaseService(caseMemory());
  const value = await cases.getOrCreateCase({ channelId: 'customer-thread', customerId: 'customer', customerThreadId: 'customer-thread', context: { area: 'app', lane: 'app' } });
  const approvalsStore = approvalMemory();
  const approvals = createApprovalService(approvalsStore, { key: Buffer.alloc(32, 31) });
  const links = createIssueLinkService(linkMemory(), { getCase: cases.getCaseById });
  const posts = []; const notices = []; const logs = [];
  const channel = makeStaffChannel().channel;
  const customerChannel = { id: 'customer-thread', isTextBased: () => true, isThread: () => true,
    messages: { fetch: async () => ({ id: 'source-message', author: { id: 'customer' }, reply: async (payload) => notices.push(payload) }) } };
  const client = { user: { id: 'bot-user' }, channels: { fetch: async (id) => id === 'customer-thread' ? customerChannel : channel } };
  const api = {
    ...github, isConfigured: () => true, isApprovalReady: () => true, repo: () => 'BasedHardware/omi',
    createScopedApproval: approvals.createDraft, getScopedApproval: approvals.getDraft,
    bindApprovalCard: approvals.bindCard, beginApprovalEdit: approvals.beginEdit, updateApprovalDraft: approvals.updateDraft,
    bindApprovalPreview: approvals.bindPreview, claimApproval: approvals.claimDraft,
    recordApprovalFiled: approvals.recordFiled, recordApprovalCommented: approvals.recordCommented,
    recordApprovalRejected: approvals.recordRejected, recordApprovalUnknown: approvals.recordUnknown,
    existingWork: async () => ({ hit: null }), linkIssueThread: () => {},
    createIssue: async (draft) => { posts.push({ kind: 'issue', draft }); return result || { ok: true, outcome: 'accepted', number: 42, url: 'https://github.com/BasedHardware/omi/issues/42' }; },
    commentOnIssue: async (number, body, options) => { posts.push({ kind: 'comment', number, body, options }); return result || { ok: true, outcome: 'accepted', id: 123, url: `https://github.com/BasedHardware/omi/issues/${number}#issuecomment-123` }; },
  };
  const flow = createGithubFlow({ api, cases, issueLinks: links, log: (line) => logs.push(line) });
  const message = { id: 'source-message', author: { id: 'customer' }, channel: customerChannel, attachments: { size: 1 }, url: 'https://discord.com/channels/100/200/300' };
  const approval = await flow.prepare({ message, client, supportCase: value, kind, issueNumber: kind === 'comment' ? 42 : undefined });
  await flow.bindCard(approval, { id: 'original-card', author: { id: client.user.id } });
  let seq = 0;
  function interaction(customId, { id = 'original-card', author = 'bot-user', user = 'staff-user', summary } = {}) {
    const responses = [];
    return { customId, client, channel, channelId: channel.id, user: { id: user },
      memberPermissions: { has: (permission) => user === 'staff-user' && permission === 'ManageThreads' },
      message: { id, author: { id: author } }, fields: { getTextInputValue: (key) => key === 'title' ? 'App crashes during a documented operation' : summary || 'The app fails during the operation. Reproduction steps and app version were checked by support.' },
      responses, deferReply: async (payload) => { assert.equal(payload.flags, MessageFlags.Ephemeral); responses.push({ deferred: true }); },
      reply: async (payload) => { responses.push(payload); },
      editReply: async (payload) => { responses.push(payload); return { id: `preview-${++seq}`, author: { id: client.user.id } }; },
      showModal: async (modal) => responses.push(modal.toJSON()),
    };
  }
  async function reviewedPreview({ summary } = {}) {
    const start = interaction(`file:${approval.id}`); await flow.handleInteraction(start);
    const editId = start.responses.at(-1).components[0].components[0].custom_id;
    const edit = interaction(editId, { id: 'editor-message' }); await flow.handleInteraction(edit);
    const modal = edit.responses.at(-1);
    const submitted = interaction(modal.custom_id, { summary }); await flow.handleInteraction(submitted);
    const latest = await approvals.getDraft(approval.id);
    return { submitted, latest, confirmation: submitted.responses.at(-1).components?.[0]?.components?.[0]?.custom_id };
  }
  return { cases, value, api, flow, approvals, approvalsStore, links, approval, posts, notices, logs, interaction, reviewedPreview, client, message };
}

test('staff write and inspect a public technical summary before any GitHub mutation', async (t) => {
  const f = await fixture(t);
  const preview = await f.reviewedPreview({ summary: 'The app fails during start. Contact user@example.test, order #998877 and https://discord.com/channels/100/200/300 must not be published.' });
  assert.equal(f.posts.length, 0);
  const embed = preview.submitted.responses.at(-1).embeds[0];
  assert.doesNotMatch(embed.description, /user@example\.test|998877|discord\.com/);
  assert.doesNotThrow(() => new EmbedBuilder(embed).toJSON());
  assert.doesNotThrow(() => new ActionRowBuilder(preview.submitted.responses.at(-1).components[0]).toJSON());
  const confirm = f.interaction(preview.confirmation, { id: preview.latest.previewMessageId });
  await f.flow.handleInteraction(confirm);
  assert.equal(f.posts.length, 1);
  assert.equal(f.notices.length, 1);
  assert.match(confirm.responses.at(-1).content, /Filed https:\/\/github.com/);
  assert.equal((await f.links.findForSource(f.value.id, 'BasedHardware/omi', 'source-message')).issueNumber, 42);
  assert.doesNotMatch(JSON.stringify([...f.approvalsStore.state.approvals.values()]), /user@example\.test|The app fails/);
});

test('forged author, wrong card and nonstaff clicks never publish or edit', async (t) => {
  const f = await fixture(t);
  for (const options of [{ author: 'customer' }, { id: 'other-card' }, { user: 'customer' }]) {
    const click = f.interaction(`file:${f.approval.id}`, options);
    await f.flow.handleInteraction(click);
    assert.equal(click.responses.at(-1).components, undefined);
  }
  assert.equal(f.posts.length, 0);
});

test('concurrent confirmation clicks publish once and report the existing outcome', async (t) => {
  const f = await fixture(t); const preview = await f.reviewedPreview();
  const first = f.interaction(preview.confirmation, { id: preview.latest.previewMessageId });
  const second = f.interaction(preview.confirmation, { id: preview.latest.previewMessageId });
  await Promise.all([f.flow.handleInteraction(first), f.flow.handleInteraction(second)]);
  assert.equal(f.posts.length, 1);
  assert.equal(f.notices.length, 1);
});

test('editing invalidates an older preview instead of publishing changed bytes', async (t) => {
  const f = await fixture(t); const first = await f.reviewedPreview(); const second = await f.reviewedPreview();
  await f.flow.handleInteraction(f.interaction(first.confirmation, { id: first.latest.previewMessageId }));
  assert.equal(f.posts.length, 0);
  await f.flow.handleInteraction(f.interaction(second.confirmation, { id: second.latest.previewMessageId }));
  assert.equal(f.posts.length, 1);
});

test('a known rejection is recorded but an uncertain remote outcome is never posted again', async (t) => {
  for (const outcome of ['known_rejected', 'unknown']) {
    const f = await fixture(t, { result: { ok: false, outcome } });
    const preview = await f.reviewedPreview();
    await f.flow.handleInteraction(f.interaction(preview.confirmation, { id: preview.latest.previewMessageId }));
    assert.equal((await f.approvals.getDraft(f.approval.id)).status, outcome === 'unknown' ? 'unknown' : 'rejected');
    if (outcome === 'unknown') {
      await f.flow.handleInteraction(f.interaction(preview.confirmation, { id: preview.latest.previewMessageId }));
      assert.equal(f.posts.length, 1); assert.equal(f.notices.length, 0);
    }
  }
});

test('an unknown approved action reconciles a verified issue receipt without a second POST', async (t) => {
  const f = await fixture(t, { result: { ok: false, outcome: 'unknown' } });
  const preview = await f.reviewedPreview();
  const publish = f.interaction(preview.confirmation, { id: preview.latest.previewMessageId });
  await f.flow.handleInteraction(publish);
  const unknown = await f.approvals.getDraft(f.approval.id);
  assert.equal(unknown.status, 'unknown');
  assert.equal(unknown.approvedBy, 'staff-user');
  assert.equal(f.posts.length, 1);
  assert.equal(await f.links.findForSource(f.value.id, 'BasedHardware/omi', 'source-message'), null);
  let checks = 0;
  f.api.findApprovalPublication = async (approval) => {
    checks += 1;
    assert.equal(approval.id, unknown.id);
    assert.equal(approval.payloadHash, unknown.payloadHash);
    assert.equal(approval.approvedBy, 'staff-user');
    assert.equal(approval.repo, unknown.repo);
    return { ok: true, found: true, outcomeData: { number: 42, url: 'https://github.com/BasedHardware/omi/issues/42' } };
  };
  const checkId = publish.responses.at(-1).components[0].components[0].custom_id;
  assert.equal(checkId, `gh-check:${unknown.id}:${unknown.revision}`);
  const check = f.interaction(checkId, { id: 'reconciliation-card' });
  await f.flow.handleInteraction(check);
  const recorded = await f.approvals.getDraft(f.approval.id);
  assert.equal(recorded.status, 'filed');
  assert.equal(recorded.externalIssueNumber, 42);
  assert.equal(recorded.externalIssueUrl, `https://github.com/${unknown.repo}/issues/42`);
  const linked = await f.links.findForSource(f.value.id, 'BasedHardware/omi', 'source-message');
  assert.equal(linked.issueNumber, 42);
  assert.equal(linked.caseId, f.value.id);
  assert.equal(linked.customerId, 'customer');
  assert.equal(linked.threadId, 'customer-thread');
  assert.equal(linked.approvedBy, 'staff-user');
  assert.match(check.responses.at(-1).content, /Verified the existing result.*No new GitHub post/is);
  assert.equal(checks, 1);
  assert.equal(f.posts.length, 1);
  await f.flow.handleInteraction(f.interaction(preview.confirmation, { id: preview.latest.previewMessageId }));
  assert.equal(f.posts.length, 1);
});

test('missing or unavailable verified proof leaves an uncertain publication held without another POST', async (t) => {
  const f = await fixture(t, { result: { ok: false, outcome: 'unknown' } });
  const preview = await f.reviewedPreview();
  const publish = f.interaction(preview.confirmation, { id: preview.latest.previewMessageId });
  await f.flow.handleInteraction(publish);
  const unknown = await f.approvals.getDraft(f.approval.id);
  const checkId = publish.responses.at(-1).components[0].components[0].custom_id;
  for (const result of [{ ok: true, found: false }, { ok: false, found: false, reason: 'read_unavailable' }]) {
    f.api.findApprovalPublication = async (approval) => {
      assert.equal(approval.id, unknown.id);
      return result;
    };
    const check = f.interaction(checkId, { id: 'reconciliation-card' });
    await f.flow.handleInteraction(check);
    assert.match(check.responses.at(-1).content, /not verified yet.*remains held.*no duplicate/is);
    assert.deepEqual(await f.approvals.getDraft(f.approval.id), unknown);
    assert.equal(await f.links.findForSource(f.value.id, 'BasedHardware/omi', 'source-message'), null);
    assert.equal(f.posts.length, 1);
    assert.equal(f.notices.length, 0);
  }
  const retry = f.interaction(preview.confirmation, { id: preview.latest.previewMessageId });
  await f.flow.handleInteraction(retry);
  assert.match(retry.responses.at(-1).content, /previous publication is uncertain/i);
  assert.equal(f.posts.length, 1);
});

test('a filed receipt with a failed private link is repaired through gh-check without any external POST', async (t) => {
  const f = await fixture(t);
  const preview = await f.reviewedPreview();
  const link = f.links.link;
  let linkAttempts = 0;
  f.links.link = async () => { linkAttempts += 1; throw new Error('Private link store unavailable'); };
  const publish = f.interaction(preview.confirmation, { id: preview.latest.previewMessageId });
  await f.flow.handleInteraction(publish);
  const filed = await f.approvals.getDraft(f.approval.id);
  assert.equal(filed.status, 'filed');
  assert.equal(filed.externalIssueNumber, 42);
  assert.equal(linkAttempts, 1);
  assert.equal(await f.links.findForSource(f.value.id, 'BasedHardware/omi', 'source-message'), null);
  assert.match(publish.responses.at(-1).content, /GitHub accepted.*saving the local record failed/is);
  const checkId = publish.responses.at(-1).components[0].components[0].custom_id;
  assert.equal(checkId, `gh-check:${filed.id}:${filed.revision}`);
  f.links.link = async (input) => { linkAttempts += 1; return link(input); };
  let remoteChecks = 0;
  f.api.findApprovalPublication = async () => { remoteChecks += 1; throw new Error('A filed receipt needs no remote lookup'); };
  const check = f.interaction(checkId, { id: 'reconciliation-card' });
  await f.flow.handleInteraction(check);
  const repaired = await f.links.findForSource(f.value.id, 'BasedHardware/omi', 'source-message');
  assert.equal(repaired.issueNumber, 42);
  assert.equal(repaired.caseId, f.value.id);
  assert.equal(repaired.customerId, 'customer');
  assert.equal(repaired.sourceMessageId, 'source-message');
  assert.equal(repaired.approvedBy, 'staff-user');
  assert.deepEqual(await f.approvals.getDraft(f.approval.id), filed);
  assert.match(check.responses.at(-1).content, /accepted result is recorded and linked.*No new GitHub post/is);
  assert.equal(linkAttempts, 2);
  assert.equal(remoteChecks, 0);
  assert.equal(f.posts.length, 1);
  assert.equal(f.notices.length, 0);
});

test('a restarted workflow uses the durable approval instead of a lost process draft', async (t) => {
  const f = await fixture(t); const preview = await f.reviewedPreview();
  const restarted = createGithubFlow({ api: f.api, cases: f.cases, issueLinks: f.links, log: () => {} });
  await restarted.handleInteraction(f.interaction(preview.confirmation, { id: preview.latest.previewMessageId }));
  assert.equal(f.posts.length, 1);
});

test('unavailable GitHub configuration keeps the scoped draft unchanged and usable', async (t) => {
  const f = await fixture(t);
  const original = await f.approvals.getDraft(f.approval.id);
  for (const unavailable of ['isConfigured', 'isApprovalReady']) {
    const previous = f.api[unavailable];
    f.api[unavailable] = () => false;
    const click = f.interaction(`file:${f.approval.id}`);
    await f.flow.handleInteraction(click);
    assert.match(click.responses.at(-1).content, /publication is unavailable.*nothing was posted/is);
    assert.deepEqual(await f.approvals.getDraft(f.approval.id), original);
    assert.equal(f.posts.length, 0);
    assert.equal(f.notices.length, 0);
    f.api[unavailable] = previous;
  }
  const retry = f.interaction(`file:${f.approval.id}`);
  await f.flow.handleInteraction(retry);
  assert.match(retry.responses.at(-1).components[0].components[0].custom_id, /^gh-edit:/);
  assert.equal(f.posts.length, 0);
});

test('a Discord defer failure does not consume or mutate a scoped approval', async (t) => {
  const f = await fixture(t);
  const original = await f.approvals.getDraft(f.approval.id);
  const click = f.interaction(`file:${f.approval.id}`);
  click.deferReply = async () => { throw new Error('Interaction acknowledgment expired'); };
  await assert.rejects(() => f.flow.handleInteraction(click), /acknowledgment expired/);
  assert.deepEqual(await f.approvals.getDraft(f.approval.id), original);
  assert.equal(f.posts.length, 0);
  assert.equal(f.notices.length, 0);
  assert.equal(click.responses.length, 0);
  const retry = f.interaction(`file:${f.approval.id}`);
  await f.flow.handleInteraction(retry);
  assert.match(retry.responses.at(-1).components[0].components[0].custom_id, /^gh-edit:/);
  assert.equal(f.posts.length, 0);
});

test('comment updates publish only the approved summary to the fixed issue', async (t) => {
  const f = await fixture(t, { kind: 'comment' }); const preview = await f.reviewedPreview();
  assert.equal(f.posts.length, 0);
  await f.flow.handleInteraction(f.interaction(preview.confirmation, { id: preview.latest.previewMessageId }));
  assert.equal(f.posts[0].kind, 'comment'); assert.equal(f.posts[0].number, 42);
  assert.equal(github.publicMutationBody(f.posts[0].body, f.approval.id), preview.submitted.responses.at(-1).embeds[0].description);
  assert.equal((await f.approvals.getDraft(f.approval.id)).status, 'filed');
});

test('a successful remote write followed by a local-save failure does not invite a second POST', async (t) => {
  const f = await fixture(t); const preview = await f.reviewedPreview();
  f.api.recordApprovalFiled = async () => { throw new Error('local database unavailable'); };
  const click = f.interaction(preview.confirmation, { id: preview.latest.previewMessageId });
  await f.flow.handleInteraction(click);
  assert.match(click.responses.at(-1).content, /GitHub accepted.*saving the local record failed/is);
  await f.flow.handleInteraction(f.interaction(preview.confirmation, { id: preview.latest.previewMessageId }));
  assert.equal(f.posts.length, 1);
});

test('the persistent original card recovers an expired uncertain filing after the old preview is dismissed', async (t) => {
  const f = await fixture(t); const preview = await f.reviewedPreview();
  const claim = await f.approvals.claimDraft(f.approval.id, {
    ...preview.latest, authorized: true, staffId: 'staff-user', cardAuthorId: 'bot-user',
    previewMessageId: preview.latest.previewMessageId,
  });
  assert.equal(claim.ok, true);
  // The remote write happened, then the process stopped before saving a receipt.
  await f.api.createIssue({ ...claim.approval.draft, approvalId: claim.approval.id });
  f.approvalsStore.state.approvals.get(f.approval.id).leaseExpiresAt = new Date(Date.now() - 1).toISOString();
  const reopened = f.interaction(`file:${f.approval.id}`);
  await f.flow.handleInteraction(reopened);
  const control = reopened.responses.at(-1).components[0].components[0];
  assert.equal(control.label, 'Check GitHub result');
  assert.equal((await f.approvals.getDraft(f.approval.id)).status, 'unknown');
  let reads = 0;
  f.api.findApprovalPublication = async () => { reads++; return { ok: true, found: true,
    outcomeData: { number: 42, url: 'https://github.com/BasedHardware/omi/issues/42' } }; };
  const checking = f.interaction(control.custom_id, { id: 'recovered-check-message' });
  await f.flow.handleInteraction(checking);
  assert.equal(reads, 1); assert.equal(f.posts.length, 1);
  assert.equal((await f.approvals.getDraft(f.approval.id)).status, 'filed');
  assert.match(checking.responses.at(-1).content, /Verified the existing result/);
});

test('forged original cards cannot reveal recovery controls in unknown or filed states', async (t) => {
  for (const result of [{ ok: false, outcome: 'unknown' }, undefined]) {
    const f = await fixture(t, { result }); const preview = await f.reviewedPreview();
    await f.flow.handleInteraction(f.interaction(preview.confirmation, { id: preview.latest.previewMessageId }));
    for (const proof of [{ id: 'forged-original-card' }, { author: 'another-bot' }]) {
      const click = f.interaction(`file:${f.approval.id}`, proof);
      await f.flow.handleInteraction(click);
      assert.equal(click.responses.at(-1).components, undefined);
      assert.match(click.responses.at(-1).content, /does not match the original bot card/);
    }
    assert.equal(f.posts.length, 1);
  }
});

test('the filed original card exposes link repair only to its approving actor, without another POST', async (t) => {
  const f = await fixture(t); const preview = await f.reviewedPreview();
  const link = f.links.link;
  f.links.link = async () => { throw new Error('local link recording unavailable'); };
  await f.flow.handleInteraction(f.interaction(preview.confirmation, { id: preview.latest.previewMessageId }));
  assert.equal((await f.approvals.getDraft(f.approval.id)).status, 'filed');
  f.links.link = link;
  const other = f.interaction(`file:${f.approval.id}`, { user: 'other-staff' });
  other.memberPermissions = { has: (flag) => flag === 'ManageThreads' };
  await f.flow.handleInteraction(other);
  assert.equal(other.responses.at(-1).components, undefined);
  assert.match(other.responses.at(-1).content, /Only the staff member who approved/);
  const original = f.interaction(`file:${f.approval.id}`);
  await f.flow.handleInteraction(original);
  const control = original.responses.at(-1).components[0].components[0];
  assert.equal(control.label, 'Check recorded result');
  f.api.findApprovalPublication = async () => assert.fail('A recorded receipt needs no remote reconciliation');
  await f.flow.handleInteraction(f.interaction(control.custom_id, { id: 'filed-repair-message' }));
  assert.equal((await f.links.findForSource(f.value.id, 'BasedHardware/omi', f.message.id)).issueNumber, 42);
  assert.equal(f.posts.length, 1);
});

test('the original card reports an active filing without exposing a retry or check control', async (t) => {
  const f = await fixture(t); const preview = await f.reviewedPreview();
  await f.approvals.claimDraft(f.approval.id, { ...preview.latest, authorized: true, staffId: 'staff-user', cardAuthorId: 'bot-user', previewMessageId: preview.latest.previewMessageId });
  const original = f.interaction(`file:${f.approval.id}`);
  await f.flow.handleInteraction(original);
  assert.match(original.responses.at(-1).content, /in progress.*Wait.*will not start another attempt/is);
  assert.equal(original.responses.at(-1).components, undefined);
  assert.equal(f.posts.length, 0);
});

test('a cached private editor opens blank, but submit force-checks changed public ACL without reading or changing the draft', async (t) => {
  const f = await fixture(t);
  const start = f.interaction(`file:${f.approval.id}`); await f.flow.handleInteraction(start);
  const editorId = start.responses.at(-1).components[0].components[0].custom_id;
  const before = await f.approvals.getDraft(f.approval.id);
  const fresh = makeStaffChannel().channel;
  fresh.permissionOverwrites.cache.delete(fresh.guild.id);
  const fetches = [];
  f.client.channels.fetch = async (id, options) => { fetches.push({ id, options }); return fresh; };
  let reads = 0; const get = f.api.getScopedApproval;
  f.api.getScopedApproval = async (...args) => { reads++; return get(...args); };
  const opening = f.interaction(editorId, { id: 'editor-message' });
  await f.flow.handleInteraction(opening);
  const modal = opening.responses.at(-1);
  assert.match(modal.custom_id, /^gh-summary:/); assert.equal(fetches.length, 0); assert.equal(reads, 0);
  const submitted = f.interaction(modal.custom_id);
  await f.flow.handleInteraction(submitted);
  assert.deepEqual(fetches, [{ id: 'staff-room', options: { force: true } }]);
  assert.match(submitted.responses.at(-1).content, /not verified as staff-only/);
  assert.equal(reads, 0); assert.equal(f.posts.length, 0);
  assert.deepEqual(await f.approvals.getDraft(f.approval.id), before);
});

test('a wrong-author source never broadcasts a customer notice even in an otherwise owned thread', async (t) => {
  const f = await fixture(t); const preview = await f.reviewedPreview();
  const channel = await f.client.channels.fetch(f.message.channel.id);
  let broadcasts = 0; let wrongReplies = 0;
  channel.ownerId = 'customer';
  channel.messages.fetch = async () => ({ id: f.message.id, author: { id: 'another-customer' }, reply: async () => { wrongReplies++; } });
  channel.send = async () => { broadcasts++; };
  const publishing = f.interaction(preview.confirmation, { id: preview.latest.previewMessageId });
  await f.flow.handleInteraction(publishing);
  assert.equal(f.posts.length, 1); assert.equal(wrongReplies, 0); assert.equal(broadcasts, 0); assert.equal(f.notices.length, 0);
  assert.match(publishing.responses.at(-1).content, /customer notice was not confirmed/);
});

test('a missing source in a forum shared by multiple customer cases does not fall back to broadcast', async (t) => {
  const f = await fixture(t); const preview = await f.reviewedPreview();
  const channel = await f.client.channels.fetch(f.message.channel.id);
  channel.ownerId = 'customer'; channel.messages.fetch = async () => null;
  let broadcasts = 0; channel.send = async () => { broadcasts++; };
  await f.cases.getOrCreateCase({ channelId: channel.id, customerId: 'other-customer', customerThreadId: channel.id, context: { area: 'app' } });
  const publishing = f.interaction(preview.confirmation, { id: preview.latest.previewMessageId });
  await f.flow.handleInteraction(publishing);
  assert.equal(broadcasts, 0); assert.match(publishing.responses.at(-1).content, /customer notice was not confirmed/);
});

test('null accepted issue or comment receipts prevent linking and customer notices', async (t) => {
  for (const kind of ['issue', 'comment']) {
    const f = await fixture(t, { kind }); const preview = await f.reviewedPreview();
    f.api[kind === 'comment' ? 'recordApprovalCommented' : 'recordApprovalFiled'] = async () => null;
    let linkWrites = 0; const link = f.links.link;
    f.links.link = async (...args) => { linkWrites++; return link(...args); };
    const publishing = f.interaction(preview.confirmation, { id: preview.latest.previewMessageId });
    await f.flow.handleInteraction(publishing);
    assert.equal(f.posts.length, 1); assert.equal(linkWrites, 0); assert.equal(f.notices.length, 0);
    assert.match(publishing.responses.at(-1).content, /accepted.*saving the local record failed/is);
  }
});

test('null reconciliation receipts do not claim a recorded result or create a trusted case link', async (t) => {
  const f = await fixture(t, { result: { ok: false, outcome: 'unknown' } }); const preview = await f.reviewedPreview();
  const publishing = f.interaction(preview.confirmation, { id: preview.latest.previewMessageId });
  await f.flow.handleInteraction(publishing);
  f.api.findApprovalPublication = async () => ({ ok: true, found: true, outcomeData: { number: 42, url: 'https://github.com/BasedHardware/omi/issues/42' } });
  f.api.recordApprovalFiled = async () => null;
  let linkWrites = 0; const link = f.links.link;
  f.links.link = async (...args) => { linkWrites++; return link(...args); };
  const checking = f.interaction(publishing.responses.at(-1).components[0].components[0].custom_id, { id: 'checking-message' });
  await f.flow.handleInteraction(checking);
  assert.equal(linkWrites, 0); assert.equal(f.posts.length, 1); assert.equal(f.notices.length, 0);
  assert.doesNotMatch(checking.responses.at(-1).content, /Verified the existing result|recorded and linked/);
  assert.equal((await f.approvals.getDraft(f.approval.id)).status, 'unknown');
});

test('private staff authorization has no permissive test-channel bypass', () => {
  const previous = process.env.STAFF_ALERT_CHANNEL_ID; process.env.STAFF_ALERT_CHANNEL_ID = 'staff-room';
  try {
    assert.equal(privateStaffAuthorized({ channelId: 'vector-test', channel: { id: 'vector-test' }, user: { id: 'customer' } }), false);
  } finally { if (previous === undefined) delete process.env.STAFF_ALERT_CHANNEL_ID; else process.env.STAFF_ALERT_CHANNEL_ID = previous; }
});
