require('dotenv').config();

const { Client, GatewayIntentBits, Events } = require('discord.js');
const express = require('express');
const db = require('./db');
const { queryAgent, reviewAnswer, understandQuestion, contextualQuestion, officialHandoffLinks } = require('./commandcode');
const telegram = require('./telegram');
const {
  isOnCooldown,
  markReplied,
  wasRecentlyAnsweredText,
  markAnsweredText,
  typingDelay,
  clipForDiscord,
  clipThreadHistory,
  escalateReply,
  rewriteUserMentions,
  wantsAuthorPing,
  attachAuthorMention,
  replyMentions,
  isUnknownMessageRef,
} = require('./utils');
const { hasUsableAttachment, fetchTextAttachments, formatQuestion, shouldMentionUnreadMedia, unreadMediaSentence, imageErrorLines, videoErrorLines, chatFiles } = require('./attachments');
const {
  notifyStaff,
  sendToStaffChannel,
  canNotifyStaff,
  isHandoffThread,
  isHelpForumThread,
  clipUserQuestion,
  canSaveFaq,
  applyThreadName,
  staffMentionIds,
  findOpenHandoff,
  rememberOpenHandoff,
  shouldReuseOpenHandoff,
  forumStarterPrefix,
  threadHasKnownIssueTag,
} = require('./handoff');
const knowledge = require('./knowledge');
const shopify = require('./shopify');
const shopifyBind = require('./shopifyBind');
const router = require('./router');
const plannerPolicy = require('./plannerPolicy');
const { decideEscalation } = require('./escalationPolicy');
const github = require('./github');
const commands = require('./commands');
const { buildToolFacts, OFFICIAL } = require('./prompt');
const { relevantDocs, canonicalizeGithubDocsEvidence } = require('./docs');
const { relevantFeedback } = require('./feedback');
const { combineEvidence } = require('./retrieval');
const { matchingRelease } = require('./releases');
const { prepareDraftForReview, prepareDraftForReviewWithAudit, presentReviewedAnswer, ensureNonEmptyAnswer, addUnsyncedDataWarning, hasUnsyncedDataRisk, stripUnverifiedOrderClaims } = require('./answerPipeline');
const { newUsageCounters, addStageUsage, timingLogLine } = require('./timing');
const { approvedReview, reviewWithSecondLook } = require('./reviewDecision');
const triage = require('./triage');
const supportCases = require('./supportCases');
const supportIssueLinks = require('./supportIssueLinks');
const githubFlow = require('./githubFlow').createGithubFlow();
const { SupportRuntime, PostgresRuntimeStore, MemoryRuntimeStore, questionFingerprint, assertCurrentOwnership, markCurrentReplySent, isLeaseLost } = require('./supportRuntime');

const HELP_FORUM_CHANNEL_ID = process.env.HELP_FORUM_CHANNEL_ID;
const VECTOR_TEST_CHANNEL_ID = process.env.VECTOR_TEST_CHANNEL_ID;
const PORT = process.env.PORT || 3000;
const KNOWLEDGE_REFRESH_MS = 6 * 60 * 60 * 1000;
const telegramReady = Boolean(process.env.TELEGRAM_TOKEN && process.env.TELEGRAM_CHAT_ID);
const dbReady = Boolean(process.env.DATABASE_URL);
const runtime = new SupportRuntime({ store: dbReady ? new PostgresRuntimeStore(db.pool) : new MemoryRuntimeStore() });
let coordinationReady = !dbReady;
let httpServer;
let shutdownPromise;
let recoveryTimer;
const BOT_REPLY_MEMORY_MAX = 2000;
const BOT_REPLY_MEMORY_MS = 24 * 60 * 60 * 1000;
const botReplyOwners = new Map();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const app = express();
app.get('/health', (_req, res) => {
  const ready = coordinationReady && !runtime.stopping;
  res.status(ready ? 200 : 503).json({
    status: ready ? 'ok' : 'not_ready',
    staffHandoff: process.env.STAFF_ALERT_CHANNEL_ID || telegram.isReady() ? 'configured' : 'missing',
  });
});
app.get('/ratings', async (_req, res) => {
  try {
  const { ratingCounts } = require('./ratings');
  const counts = await ratingCounts();
  res.type('html').send(`<!doctype html>
<meta charset="utf-8">
<title>Omi Support ratings</title>
<body style="font-family: Georgia, serif; background:#111; color:#f4f1ea; margin:48px;">
<h1>Did this help?</h1>
<p>Answers from the customer who opened the post.</p>
<p style="font-size:32px;">Helpful: ${counts.yes}</p>
<p style="font-size:32px;">Still need help: ${counts.no}</p>
</body>`);
  } catch {
    console.error('[Bot] support feedback totals unavailable');
    res.status(503).type('text').send('Support feedback totals are temporarily unavailable.');
  }
});

app.post('/github-webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || '');
  if (!github.verifyWebhook(raw, req.headers['x-hub-signature-256'])) {
    res.status(401).send('bad signature');
    return;
  }
  let payload;
  try {
    payload = JSON.parse(raw.toString('utf8'));
  } catch {
    res.status(400).send('bad json');
    return;
  }
  if (!github.webhookRepoOk(payload)) {
    res.send('ok');
    return;
  }
  const event = github.describeWebhookEvent(payload);
  if (event) {
    try {
      await commands.notifyLinkedThreads(client, event);
    } catch (err) {
      console.error('[GitHub] webhook post failed:', err.message);
    }
  }
  res.send('ok');
});

function rememberBotReply(sent, message) {
  const replyId = String(sent?.id || '');
  const customerId = String(message?.author?.id || '');
  const channelId = String(message?.channel?.id || '');
  if (!replyId || !customerId || !channelId) return;
  const now = Date.now();
  botReplyOwners.set(replyId, { customerId, channelId, at: now });
  for (const [id, item] of botReplyOwners) {
    if (botReplyOwners.size <= BOT_REPLY_MEMORY_MAX && now - item.at <= BOT_REPLY_MEMORY_MS) break;
    botReplyOwners.delete(id);
  }
}

async function replySafe(message, content, { pingAuthor = false } = {}) {
  await assertCurrentOwnership();
  let text = ensureNonEmptyAnswer(rewriteUserMentions(ensureNonEmptyAnswer(content), message));
  if (pingAuthor) text = attachAuthorMention(text, message);
  const payload = {
    content: text,
    allowedMentions: replyMentions(message, { pingAuthor, repliedUser: false }),
  };
  try {
    const sent = await message.reply({
      ...payload,
      allowedMentions: replyMentions(message, { pingAuthor, repliedUser: true }),
    });
    markCurrentReplySent();
    rememberBotReply(sent, message);
    return sent;
  } catch (err) {
    if (!isUnknownMessageRef(err) || typeof message.channel?.send !== 'function') {
      throw err;
    }
    console.error('[Bot] reply reference missing, sending in channel:', err.message);
    const sent = await message.channel.send(payload);
    markCurrentReplySent();
    rememberBotReply(sent, message);
    return sent;
  }
}

function isHelpThread(channel) {
  return isHelpForumThread(channel);
}

function isTestChannel(channel) {
  if (!VECTOR_TEST_CHANNEL_ID) return false;
  if (channel.id === VECTOR_TEST_CHANNEL_ID) return true;
  return channel.isThread() && channel.parentId === VECTOR_TEST_CHANNEL_ID;
}

function isTrustedHandoffThread(channel) {
  if (!isHandoffThread(channel)) return false;
  if (isTestChannel(channel)) return true;
  const ownerId = String(channel?.ownerId || channel?.owner_id || '');
  return Boolean(ownerId && ownerId === String(client.user?.id || ''));
}

function memberHasRole(member, roleIds) {
  const roles = member?.roles?.cache;
  if (!roles || !roleIds.length) return false;
  if (typeof roles.has === 'function') return roleIds.some((id) => roles.has(id));
  if (typeof roles.includes === 'function') return roleIds.some((id) => roles.includes(id));
  return false;
}

function memberCanModerate(member) {
  const permissions = member?.permissions;
  if (!permissions || typeof permissions.has !== 'function') return false;
  try {
    return (
      permissions.has('ManageThreads', true) ||
      permissions.has('ManageMessages', true) ||
      permissions.has('Administrator', true)
    );
  } catch {
    return false;
  }
}

function isStaffMessage(message) {
  const { users, roles } = staffMentionIds();
  return (
    users.includes(String(message.author?.id || '')) ||
    memberHasRole(message.member, roles) ||
    memberCanModerate(message.member)
  );
}

function messageCaption(content) {
  return String(content || '')
    .replace(/<@!?\d+>|<@&\d+>|<#\d+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function directlyMentionsBot(content) {
  const id = String(client.user?.id || '');
  if (!/^\d+$/.test(id)) return false;
  return String(content || '').includes(`<@${id}>`) || String(content || '').includes(`<@!${id}>`);
}

function isActionableMessage(message) {
  const caption = messageCaption(message.content);
  if (/^\/[a-z][\w-]*(?:\s|$)/i.test(caption)) return false;
  if (caption.length < 5 && !hasUsableAttachment(message) && !forumStarterPrefix(message)) return false;
  if (/^(thanks|thank you|thx|ok|okay|got it|cool|lol|ty|hello|hi|hey)[.!\s]*$/i.test(caption)) return false;
  if (
    /^(?:(?:sweet|great|awesome|perfect|nice|cool|okay|ok|got it)[,!.\s]+)*(?:thanks(?:\s+(?:a lot|so much))?|thank you(?:\s+so much)?|thx|ty)[.!\s]*$/i.test(
      caption
    )
  ) {
    return false;
  }
  const hasAttachment = Number(message.attachments?.size || 0) > 0;
  if (!hasAttachment && (isIdentifierOnlyUpdate(caption) || isDeliveryAcknowledgment(caption))) {
    return false;
  }
  return true;
}

function isIdentifierOnlyUpdate(text) {
  const value = String(text || '').trim();
  if (!value || !/\d/.test(value)) return false;
  const remainder = value
    .replace(/\b(?:ticket|case|request|order)\b/gi, ' ')
    .replace(/\b(?:number|no\.?|id)\b/gi, ' ')
    .replace(/[#,:;()[\]]/g, ' ')
    .trim();
  const tokens = remainder.match(/[A-Za-z0-9-]+/g) || [];
  return Boolean(tokens.length) && tokens.every((token) => /\d/.test(token));
}

function isDeliveryAcknowledgment(text) {
  const value = String(text || '').trim();
  if (!value || /[?]/.test(value)) return false;
  const sending =
    /\b(?:i(?:['’]ll|\s+will|['’]m|\s+am)\s+(?:send|email|attach|upload|provide|share)|i(?:['’]ve|\s+have)\s+(?:sent|emailed|attached|uploaded|provided|shared))\b/i.test(
      value
    );
  if (!sending) return false;
  return !/\b(?:still|waiting|no (?:reply|response|answer)|problem|issue|error|fail(?:ed|ing)?|crash(?:ed|ing)?|not working|doesn['’]?t|cannot|can['’]?t|won['’]?t|help)\b/i.test(
    value
  );
}

function shouldHandle(message) {
  if (message.author.bot) return false;
  // Staff replies in live support threads are interventions, not new customer
  // questions. Keep #vector-test available for staff to exercise the bot.
  if ((isTrustedHandoffThread(message.channel) || isHelpThread(message.channel)) && isStaffMessage(message)) {
    return false;
  }
  if (!isActionableMessage(message)) return false;
  if (isTrustedHandoffThread(message.channel)) {
    if (isTestChannel(message.channel)) return true;
    const { users } = staffMentionIds();
    if (users.length && canSaveFaq(message.author.id)) return false;
    return true;
  }
  if (isTestChannel(message.channel)) return true;
  if (isHelpThread(message.channel)) return true;
  if (directlyMentionsBot(message.content)) return true;
  return false;
}

async function fetchReferencedMessage(message) {
  if (!message?.reference?.messageId && typeof message?.fetchReference !== 'function') return null;
  try {
    if (typeof message.fetchReference === 'function') return await message.fetchReference();
  } catch {
    return null;
  }
  const id = String(message.reference?.messageId || '');
  if (!id) return null;
  const cached = message.channel?.messages?.cache?.get?.(id);
  if (cached) return cached;
  try {
    return await message.channel?.messages?.fetch?.(id);
  } catch {
    return null;
  }
}

async function repliesToDifferentHuman(message) {
  if (!message?.reference?.messageId && typeof message?.fetchReference !== 'function') return false;
  const referenced = await fetchReferencedMessage(message);
  if (!referenced || referenced.author?.bot) return false;
  const targetId = String(referenced.author?.id || '');
  const authorId = String(message.author?.id || '');
  return Boolean(targetId && authorId && targetId !== authorId);
}

async function directContinuationHistory(message) {
  if (!isActionableMessage(message) || directlyMentionsBot(message.content)) return [];
  if (
    isHelpThread(message.channel) ||
    isTrustedHandoffThread(message.channel) ||
    isTestChannel(message.channel)
  ) {
    return [];
  }
  const referenced = await fetchReferencedMessage(message);
  if (String(referenced?.author?.id || '') !== String(client.user?.id || '')) return [];

  const replyId = String(referenced.id || message.reference?.messageId || '');
  const remembered = botReplyOwners.get(replyId);
  let original = null;
  if (remembered) {
    if (
      remembered.customerId !== String(message.author?.id || '') ||
      remembered.channelId !== String(message.channel?.id || '') ||
      Date.now() - remembered.at > BOT_REPLY_MEMORY_MS
    ) {
      return [];
    }
  } else {
    original = await fetchReferencedMessage(referenced);
    if (String(original?.author?.id || '') !== String(message.author?.id || '')) return [];
  }
  if (!original) {
    original = await fetchReferencedMessage(referenced);
  }

  const entries = [];
  const originalText = messageCaption(original?.content || '');
  if (originalText) {
    entries.push({ author: original?.author?.username || 'customer', content: originalText });
  }
  const botText = String(referenced.content || '').trim();
  if (botText) entries.push({ author: 'bot', content: botText });
  return clipThreadHistory(entries);
}

async function hasEarlierMessages(channel, messageId) {
  if (!channel?.isThread?.()) return false;
  try {
    const messages = await channel.messages.fetch({ limit: 12 });
    return [...messages.values()].some((m) => m.id !== messageId);
  } catch {
    return false;
  }
}

async function getHistory(channel, excludeId) {
  // Parent #vector-test is a pile of unrelated tickets. Only follow-ups
  // inside an existing Handoff or help post may see prior messages.
  const samePost = channel.isThread?.() && (isHelpThread(channel) || isTestChannel(channel));
  if (!isTrustedHandoffThread(channel) && !samePost) return [];
  const messages = await channel.messages.fetch({ limit: 50 });
  const entries = [...messages.values()]
    .reverse()
    .filter((m) => m.id !== excludeId)
    .map((m) => ({
      author: m.author.bot ? 'bot' : m.author.username,
      content: m.content,
    }));
  return clipThreadHistory(entries);
}

async function searchKnowledge(question) {
  // Legacy database notes have no author/provenance field, so do not expose
  // them to the model until they can be reviewed or migrated.
  return knowledge.search(question);
}

async function handleFaqSave(message) {
  if (message.author?.bot) return false;
  if (!isTrustedHandoffThread(message.channel)) return false;

  const commanded = knowledge.parseFaqCommand(message.content);
  const snippet = commanded;
  if (!snippet) return false;

  if (!canSaveFaq(message.author.id)) {
    try {
      await replySafe(message, 'Only named staff can save a faq line.');
    } catch (err) {
      console.error('[Knowledge] reply failed:', err.message);
    }
    return true;
  }

  const saved = knowledge.addSnippet(snippet);
  if (!saved.ok) {
    const why =
      saved.reason === 'lie'
        ? 'I will not save that. It claims a ping I did not make.'
        : saved.reason === 'stale'
          ? 'Order lookup is already on. I will not save that I cannot see Shopify.'
        : 'Nothing to save. Use `faq: short true sentence`.';
    try {
      await replySafe(message, why);
    } catch (err) {
      console.error('[Knowledge] reply failed:', err.message);
    }
    return true;
  }

  try {
    await replySafe(message, 'Saved as a staff note. Answers still require official-source review.');
  } catch (err) {
    console.error('[Knowledge] reply failed:', err.message);
  }
  return true;
}

async function noteCustomerLead(channel, message) {
  if (!github.isConfigured() || !github.isApprovalReady() || !channel.isThread?.() ||
    !github.isImportantLead(message.content, message.attachments)) return;
  try {
    const value = await supportCases.getCaseByThread(channel.id, message.author.id);
    if (!value || value.customerId !== String(message.author.id)) return;
    const rows = await supportIssueLinks.listForThread(value.id, github.repo(), channel.id);
    const linked = [...new Map(rows.filter((row) => row.customerId === String(message.author.id))
      .map((row) => [`${row.repo}:${row.issueNumber}`, row])).values()];
    if (linked.length !== 1) return;
    const approval = await githubFlow.prepare({ message, client, supportCase: value, kind: 'comment', issueNumber: linked[0].issueNumber });
    if (!approval || approval.cardMessageId || approval.status !== 'pending') return;
    const payload = githubFlow.approvalCard(approval, message.url);
    await sendToStaffChannel(client, payload, channel.id, { onSent: async (sent) => { await githubFlow.bindCard(approval, sent); } });
  } catch (err) {
    if (isLeaseLost(err)) throw err;
    console.error('[GitHubFlow] customer update staging failed');
  }
}

async function postIssueCard(channel, draft, githubHit) {
  if (!channel?.send || !draft) return;
  const url = githubHit?.duplicate?.url || '';
  try {
    await assertCurrentOwnership();
    await channel.send({ embeds: [github.formatIssueCard(draft, { url })] });
  } catch (err) {
    if (isLeaseLost(err)) throw err;
    console.error('[Bot] issue card failed:', err.message);
  }
}

async function postShopTicketCard(channel, triaged) {
  if (!channel?.send || !triaged) return;
  try {
    await assertCurrentOwnership();
    await channel.send({
      embeds: [
        github.formatShopTicketCard({
          title: triaged.topic,
          labels: triaged.labels,
        }),
      ],
    });
  } catch (err) {
    if (isLeaseLost(err)) throw err;
    console.error('[Bot] shop ticket card failed:', err.message);
  }
}

function redactStaffQuestion(text) {
  const orders = [];
  let s = String(text || '')
    .replace(/\s*\n+\s*/g, ' ')
    .trim()
    .replace(/#\d{3,}/g, (match) => {
      orders.push(match);
      return `§${orders.length - 1}§`;
    });
  s = s.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email]');
  s = s.replace(
    /\b\d{1,5}\s+(?:(?:[A-Za-z][A-Za-z.'-]*|\d{1,3}(?:st|nd|rd|th))\s+){0,4}(?:street|st|avenue|ave|road|rd|blvd)\b\.?/gi,
    '[address]'
  );
  s = s.replace(/(?<![\d#])\+?(?:\d[\s().-]*){6,14}\d(?!\d)/g, (match) => {
    const digits = match.replace(/\D/g, '');
    if (digits.length < 7 || digits.length > 15) return match;
    return '[phone]';
  });
  return s.replace(/§(\d+)§/g, (_, i) => orders[Number(i)] || '');
}

async function handleMessage(message) {
  if (runtime.stopping || !coordinationReady) return { status: 'stopping' };
  if (
    !directlyMentionsBot(message.content) &&
    (isHelpThread(message.channel) || isTrustedHandoffThread(message.channel)) &&
    (await repliesToDifferentHuman(message))
  ) {
    return { status: 'ignored' };
  }
  let directHistory = [];
  if (!shouldHandle(message)) {
    directHistory = await directContinuationHistory(message);
    if (!directHistory.length) return { status: 'ignored' };
  }
  if (
    message.channel?.isThread?.() &&
    wasRecentlyAnsweredText(message.channel.id, message.author?.id, message.content)
  ) {
    return { status: 'ignored' };
  }
  const channel = message.channel;
  const replyCooldownKey = `${channel.id}:${message.author.id}`;
  // In ordinary channels, rate-limit each customer independently. A direct
  // reply continuation may proceed immediately; it is already opt-in scoped.
  if (
    !directHistory.length &&
    isOnCooldown(replyCooldownKey) &&
    !isTestChannel(channel) &&
    !channel.isThread?.()
  ) {
    console.log(`[Bot] Cooldown active for ${channel.id}, skipping`);
    return { status: 'ignored' };
  }
  try {
    return await runtime.run({
      messageId: message.id,
      caseKey: replyCooldownKey,
      fingerprint: channel.isThread?.() ? questionFingerprint(message.content) : null,
    }, () => {
      // A concurrently queued ordinary-channel question must observe the
      // reply cooldown established by the preceding job, not its arrival time.
      if (!directHistory.length && !isTestChannel(channel) && !channel.isThread?.() && isOnCooldown(replyCooldownKey)) return false;
      return answerMessage(message, { directHistory });
    });
  } catch (err) {
    console.error('[SupportRuntime] request coordination failed');
    // Never let a stale worker send after its lease has been taken by another copy.
    if (err.message === 'support lease lost' || err.replyAlreadySent) return { status: 'failed' };
    try {
      await message.reply({
        content: 'I am having trouble saving this support request. Please email help@omi.me so the team can receive it.',
        allowedMentions: { parse: [], repliedUser: false },
      });
    } catch { console.error('[SupportRuntime] fallback delivery failed'); }
    return { status: 'failed' };
  }
}

async function recoverQueuedRequest(input) {
  const [channelId, customerId] = input.caseKey.split(':');
  try {
    const channel = await client.channels.fetch(channelId);
    const message = await channel?.messages?.fetch?.(input.messageId);
    if (!message || String(message.author?.id) !== customerId || !shouldHandle(message)) {
      // Direct-reply continuations also require their original customer proof.
      if (!message || String(message.author?.id) !== customerId || !(await directContinuationHistory(message)).length) {
        await runtime.store.discard(input); return;
      }
    }
    const result = await handleMessage(message);
    if (['ignored', 'duplicate'].includes(result?.status)) await runtime.store.discard(input);
  } catch (err) {
    if ([10003, 10008, 50001, 50013].includes(Number(err.code))) await runtime.store.discard(input);
    else console.error('[SupportRuntime] queued request recovery failed');
  }
}

async function answerMessage(message, { directHistory = [] } = {}) {
  const startedAt = performance.now();
  const stageMs = { planner: 0, retrieval: 0, answer: 0, review: 0 };
  const stageUsage = newUsageCounters();
  const onUsage = (event) => addStageUsage(stageUsage, event);
  let didReply = false;
  let answered = false;
  const channel = message.channel;
  const caption = messageCaption(message.content);
  const files = await fetchTextAttachments(message.attachments);
  const read = { image: false, video: false };
  if (process.env.VECTOR_OCR === '1') {
    const screenText = await imageErrorLines(message.attachments);
    const videoText = await videoErrorLines(message.attachments);
    if (screenText) {
      read.image = true;
      files.push({ name: 'screen.txt', text: screenText });
    }
    if (videoText) {
      read.video = true;
      files.push({ name: 'video.txt', text: videoText });
    }
  }
  const unreadMedia = shouldMentionUnreadMedia(message.attachments, files, read);
  let asked = clipUserQuestion(caption) || caption;
  const forumPrefix = forumStarterPrefix(message);
  if (forumPrefix) asked = [forumPrefix, asked].filter(Boolean).join('\n');
  const embedNote = github.textFromEmbeds(message.embeds);
  if (embedNote) asked = [asked, embedNote].filter(Boolean).join('\n');
  const question = formatQuestion(asked, files);
  const changes = github.linkedChanges(question);
  if (question.length < 5) {
    if (unreadMedia && !changes.length) {
      await assertCurrentOwnership();
      await message.reply({
        content: unreadMediaSentence(),
        allowedMentions: replyMentions(message, { pingAuthor: false, repliedUser: false }),
      }).catch((err) => console.error('[Bot] media note failed:', err.message));
    }
    return;
  }

  console.log(`[Bot] Processing in ${channel.id}`);

  try {
    await channel.sendTyping();

    const useThreadMetadata =
      isHelpThread(channel) || isTrustedHandoffThread(channel) || isTestChannel(channel);
    const routeSource = [useThreadMetadata && channel.isThread?.() ? channel.name : '', question]
      .filter(Boolean)
      .join('\n');
    let contextHistory = directHistory;
    let prior = contextHistory.map((entry) => entry.content).join('\n');
    if (
      channel.isThread?.() &&
      (isHelpThread(channel) || isTrustedHandoffThread(channel) || isTestChannel(channel))
    ) {
      try {
        contextHistory = await getHistory(channel, message.id);
        prior = contextHistory.map((entry) => entry.content).join('\n');
      } catch (err) {
        console.error('[Bot] thread context failed:', err.message);
      }
    }
    const caseQuestion = contextualQuestion(question, contextHistory);
    const routeText = [routeSource, prior].filter(Boolean).join('\n');
    const groundedShop = router.needsGroundedShopAnswer(asked || question);
    const classifiedCurrent = router.classify(asked || question);
    const currentRoute = groundedShop
      ? { ...classifiedCurrent, area: 'shop', lane: 'shop', escalate: true, responseMode: 'grounded' }
      : classifiedCurrent;
    const contextRoute = router.classify(routeText);
    // History preserves the ticket topic, but only the newest customer message
    // decides whether they are currently asking for a human.
    let route = {
      ...contextRoute,
      wantHuman: Boolean(currentRoute.wantHuman),
      escalate: Boolean(contextRoute.escalate || currentRoute.escalate),
    };
    if (groundedShop) route = { ...route, area: 'shop', lane: 'shop', escalate: true, responseMode: 'grounded' };
    if (plannerPolicy.suppressAcknowledgment(null, asked || question)) return;
    const cannedEnglish = plannerPolicy.skipPlannerForCanned(currentRoute, asked || question);
    const holdPublicCopy = isHelpThread(channel) && !router.isPublicForumSafe(asked || question);
    let searchPlan = {
      standaloneQuestion: caseQuestion,
      customerGoal: asked || question,
      mustAnswer: [asked || question],
      customerFacts: [],
      supportKind: 'other',
      queries: [],
    };
    if (!cannedEnglish && process.env.CMD_API_KEY) {
      const stageStart = performance.now();
      try {
        searchPlan = await understandQuestion({
          question: asked || question,
          threadHistory: contextHistory,
          route,
          onUsage,
          sessionId: `discord-${channel.id}-search`,
        });
      } catch (err) {
        console.error('[Bot] search planning failed:', err.message);
      } finally {
        stageMs.planner += Math.round(performance.now() - stageStart);
      }
    }
    if (plannerPolicy.suppressAcknowledgment(searchPlan, asked || question)) return;
    if (plannerPolicy.suppressOffTopic(searchPlan, currentRoute)) return;
    const plannedPersonKind = cannedEnglish ? '' : plannerPolicy.personKind(searchPlan);
    route = cannedEnglish
      ? currentRoute
      : plannerPolicy.routeWithUnderstanding(route, searchPlan, asked || question);
    if (groundedShop) route = { ...route, area: 'shop', lane: 'shop', escalate: true, responseMode: 'grounded' };
    const forceGroundedPersonAnswer = Boolean(plannedPersonKind);
    const cannedEnglishReply = cannedEnglish ? router.cannedReply(route, asked || question) : '';
    const supportFollowup =
      Boolean(currentRoute.wantHuman) || router.looksLikeSupportNudge(asked || question);
    const handoffPlanned = Boolean(route.escalate || forceGroundedPersonAnswer ||
      searchPlan.dataLossRisk || hasUnsyncedDataRisk(asked || question));
    if (holdPublicCopy) {
      console.log('[Bot] PII/order/privacy stays off the public help copy');
    }
    if (!holdPublicCopy && router.isTechLane(route) && !changes.length) {
      const found = await github.searchPulls(caseQuestion);
      if (found) changes.push(found);
    }

    const binding = await shopifyBind.get(message.author.id);
    const verifiedEmail = binding?.email || '';
    const useShopify = shopify.shouldLookup(route, asked || question, { verifiedEmail });
    let shopifyLookup = null;
    let githubHit = null;
    let fileIssueId;
    let aiResponse;
    let threadHistory = [];
    let cleanAnswer;
    let skipModel = false;
    let reviewedGrounded = false;
    let snippets = [];

    if (useShopify) {
      shopifyLookup = await shopify.lookupOrder(asked || question, { verifiedEmail });
      console.log(`[Shopify] lookup key=${shopifyLookup.reason === 'no-key' ? 'none' : 'set'} status=${shopifyLookup.reason || 'hit'}`);
    }
    if (!holdPublicCopy && github.isConfigured() && router.isTechLane(route)) {
      githubHit = await github.searchIssues(caseQuestion);
    }
    const relatedPull = changes.find((change) => change.kind === 'pull');
    const relatedPullLookup = relatedPull ? await github.lookupChange(relatedPull) : null;
    const relatedPullEvidence = relatedPull
      ? [
          '[Related GitHub pull request | lower priority than the Help Center, docs, and release notes; not proof of a customer fix]',
          `#${relatedPull.number}: ${String(relatedPull.title || '').replace(/\s+/g, ' ').slice(0, 200)}`,
          `Status: ${relatedPullLookup?.ok ? relatedPullLookup.state : 'unverified'}`,
          relatedPull.url,
          "Mention this only if it is directly relevant, and say: There's a related change on GitHub; I can't confirm it fixes your case.",
        ].join('\n')
      : '';

    if (holdPublicCopy || cannedEnglishReply ||
      (!forceGroundedPersonAnswer && !router.requiresGroundedAnswer(route))) {
      skipModel = true;
      aiResponse = {
        final_answer: '',
        confidence: 0.9,
        escalate: true,
        reason: router.staffReason(route, asked || question),
      };
      cleanAnswer = clipForDiscord(cannedEnglishReply || router.cannedReply(route, asked || question) || '');
      if (shopifyLookup?.reason) {
        aiResponse.reason = aiResponse.reason || shopify.staffReason(shopifyLookup, asked || question);
      }
    }

    if (!skipModel) {
      const knowledgeSnippets = await searchKnowledge(caseQuestion);
      threadHistory = contextHistory;
      snippets = knowledge.filterSnippetsForLane(
        shopify.filterKnowledge(knowledgeSnippets),
        route.lane
      );
      // Chat replies are not ephemeral. Even a verified customer's order facts
      // belong in /order or the private staff card, never a public model prompt.
      const shopifyText = '';
      const sourceQuestion = contextualQuestion(
        searchPlan.standaloneQuestion || asked || question,
        threadHistory
      );
      const retrievalStart = performance.now();
      const [docsText, officialCodeText, feedbackText, releaseText] = await Promise.all([
        relevantDocs(sourceQuestion, { queries: searchPlan.queries }),
        route.area === 'shop' ? '' : github.searchOfficialCode(sourceQuestion, { queries: searchPlan.queries }),
        router.isTechLane(route) || route.lane === 'unknown'
          ? relevantFeedback(sourceQuestion, { queries: searchPlan.queries })
          : '',
        matchingRelease(sourceQuestion),
      ]);
      stageMs.retrieval += Math.round(performance.now() - retrievalStart);
      const retrievedEvidence = await canonicalizeGithubDocsEvidence(
        combineEvidence(docsText, feedbackText, officialCodeText)
      );
      const toolFacts = buildToolFacts({
        route,
        shopifyText,
        githubText: githubHit?.duplicate?.url || '',
        docsText: retrievedEvidence,
        releaseText,
      });

      const verifiedCanned = plannerPolicy.verifiedCannedReply(route, asked || question, retrievedEvidence);
      if (verifiedCanned) {
        skipModel = true;
        aiResponse = { final_answer: verifiedCanned, confidence: 0.95, escalate: false, reason: '' };
        cleanAnswer = verifiedCanned;
      } else try {
        const answerStart = performance.now();
        try {
          aiResponse = await queryAgent({
            question,
            threadHistory,
            knowledgeSnippets: snippets,
            route,
            toolFacts,
            understanding: searchPlan,
            handoffPlanned,
            onUsage,
            sessionId: `discord-${channel.id}`,
            canNotifyStaff: canNotifyStaff({ discordReady: true }),
          });
        } finally {
          stageMs.answer += Math.round(performance.now() - answerStart);
        }
        if (aiResponse?.final_answer) {
          const draftLane = triage.merge(route, aiResponse, question).lane;
          const prepared = prepareDraftForReviewWithAudit(
            aiResponse.final_answer,
            draftLane,
            caseQuestion
          );
          aiResponse.final_answer = prepared.draft;
          try {
            const reviewStart = performance.now();
            let checked;
            try {
              checked = await reviewWithSecondLook({
                question,
                threadHistory,
                draft: aiResponse.final_answer,
                removedBySafetyFilters: prepared.removed,
                understanding: searchPlan,
                policy: toolFacts,
                lane: draftLane,
                handoffPlanned: handoffPlanned || aiResponse.escalate === true,
                onUsage,
                sources: [
                  retrievedEvidence,
                  releaseText ? `[S99 | Official release note]\n${releaseText}` : '',
                  `[Static fallback | lower priority than retrieved Help Center and docs]\n${OFFICIAL}`,
                  relatedPullEvidence,
                ]
                  .filter(Boolean)
                  .join('\n\n'),
                sessionId: `discord-${channel.id}-review`,
              }, { review: reviewAnswer });
            } finally {
              stageMs.review += Math.round(performance.now() - reviewStart);
            }
            const approved = approvedReview(checked);
            reviewedGrounded = Boolean(approved);
            aiResponse.final_answer = approved
              ? github.reviewedPullMention(checked.final_answer, relatedPull)
              : checked.safeHandoff
                ? checked.final_answer
                : "I couldn't verify a direct answer to what you asked from the official Omi information. I won't substitute a different or guessed answer; a person needs to check this.";
            aiResponse.confidence = Math.min(
              Number(aiResponse.confidence) || 0.4,
              Number(checked.confidence) || 0.4
            );
            if (checked.escalate || !approved) {
              aiResponse.escalate = true;
              aiResponse.reason =
                aiResponse.reason ||
                (checked.relevant
                  ? 'The answer was not fully supported by official pages.'
                  : 'The drafted reply did not answer the customer question.');
            } else if (
              route.lane === 'faq' &&
              !route.wantHuman &&
              !route.escalate &&
              (router.looksLikeDocs(asked || question) ||
                router.looksLikeRecordingHow(asked || question) ||
                router.looksLikeDeviceReset(asked || question))
            ) {
              aiResponse.escalate = false;
            }
          } catch (err) {
            console.error('[Bot] review failed:', err.message);
            const links = officialHandoffLinks(retrievedEvidence);
            aiResponse.final_answer =
              "I found relevant information, but I couldn't verify a safe answer from the official Omi sources just now. I won't guess or ask you to repeat steps already in this thread; a person needs to check this." +
              (links.length ? `\n\nSource: ${links.join(' ')}` : '');
            aiResponse.confidence = 0.2;
            aiResponse.escalate = true;
            aiResponse.reason = 'Official-source review was unavailable.';
          }
        }

        if (useShopify && shopifyLookup) {
          aiResponse.reason = aiResponse.reason || shopify.staffReason(shopifyLookup, asked || question);
        } else if (githubHit?.duplicate) {
          aiResponse.reason = aiResponse.reason || `Looks like ${githubHit.duplicate.url}`;
        } else if (route.escalate) {
          aiResponse.reason = aiResponse.reason || router.staffReason(route, asked || question);
        }
      } catch (err) {
        console.error('[Bot] model failed:', err.message);
        skipModel = true;
        const down = router.whenModelDown(route, caseQuestion);
        aiResponse = down.agent;
        cleanAnswer = clipForDiscord(down.reply);
      }
    }

    if (plannedPersonKind) {
      aiResponse.escalate = true;
      aiResponse.reason = plannerPolicy.personReason(plannedPersonKind);
      if (!reviewedGrounded) {
        aiResponse.final_answer = plannerPolicy.personReply(plannedPersonKind, route, asked || question, searchPlan);
      }
    }

    const triaged = triage.merge(route, skipModel ? {} : aiResponse, question);
    if (!skipModel) {
      cleanAnswer = presentReviewedAnswer(aiResponse.final_answer);
    } else {
      cleanAnswer = clipForDiscord(
        prepareDraftForReview(cleanAnswer || '', triaged.lane, caseQuestion)
      );
    }
    if (plannedPersonKind && !reviewedGrounded) {
      cleanAnswer = plannerPolicy.personReply(plannedPersonKind, route, asked || question, searchPlan);
    }
    if (!plannedPersonKind && threadHasKnownIssueTag(channel)) {
      cleanAnswer = router.knownIssueReply();
      aiResponse.reason = 'Already tagged Known issue.';
    } else {
      aiResponse.reason = router.pickStaffReason(
        { area: triaged.area, lane: triaged.lane },
        aiResponse.reason,
        asked || question
      );
    }
    if (unreadMedia && !changes.length) {
      const note = unreadMediaSentence(asked || question);
      if (!String(cleanAnswer || '').includes(note)) {
        cleanAnswer = [cleanAnswer, note].filter(Boolean).join('\n\n');
      }
    }
    let changeSentence = '';
    if (changes[0] && !plannedPersonKind) {
      const lookup = changes[0] === relatedPull
        ? relatedPullLookup
        : await github.lookupChange(changes[0]);
      changeSentence = github.customerChangeSentence(changes[0], lookup, {
        question,
        title: changes[0].title,
      });
      cleanAnswer = github.stripShippedClaims(cleanAnswer);
    }

    if (holdPublicCopy) {
      cleanAnswer = clipForDiscord(
        (plannedPersonKind ? plannerPolicy.personReply(plannedPersonKind, route, asked || question, searchPlan) : router.cannedReply(route, asked || question)) ||
          "I can't share account or order details in this public post."
      );
      const publicText = String(cleanAnswer || '').replace(/help@omi\.me/gi, '');
      if (
        /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(publicText) ||
        /\b\d{1,5}\s+(?:(?:[A-Za-z][A-Za-z.'-]*|\d{1,3}(?:st|nd|rd|th))\s+){0,4}(?:street|st|avenue|ave|road|rd|blvd)\b/i.test(
          cleanAnswer
        )
      ) {
        cleanAnswer = "I can't share account or order details in this public post.";
      }
    }
    const dataLossRisk = hasUnsyncedDataRisk(caseQuestion) || searchPlan.dataLossRisk === true;
    cleanAnswer = ensureNonEmptyAnswer(addUnsyncedDataWarning(cleanAnswer, caseQuestion, {
      dataLossRisk,
      language: searchPlan.replyLanguage,
    }));
    if (groundedShop && !holdPublicCopy) {
      cleanAnswer = stripUnverifiedOrderClaims(cleanAnswer);
      if (!cleanAnswer.startsWith(router.ORDER_STATUS_OPENING)) {
        cleanAnswer = `${router.ORDER_STATUS_OPENING}\n\n${cleanAnswer}`;
      }
    }
    const staffQuestion = holdPublicCopy ? redactStaffQuestion(asked) : asked;

    const nameMeta = {
      question: staffQuestion,
      area: triaged.area,
      lane: triaged.lane,
      topic: holdPublicCopy ? redactStaffQuestion(triaged.topic) : triaged.topic,
      labels: triaged.labels,
    };
    const inHandoff = isTrustedHandoffThread(channel);
    const continuingPost = await hasEarlierMessages(channel, message.id);
    const stayInPost = inHandoff || continuingPost;
    const handoffFollowup = continuingPost && supportFollowup;
    const pingAuthor = wantsAuthorPing(caption);
    const localizedFooters = plannerPolicy.handoffFooters(searchPlan, asked || question);
    const { escalate, signals: escalationSignals } = decideEscalation({
      route,
      question: asked || question,
      answer: cleanAnswer,
      agent: aiResponse,
      caption,
      triaged,
      holdPublicCopy,
      dataLossRisk,
    });
    const draft = github.draftFromQuestion(staffQuestion, triaged.area, {
      topic: nameMeta.topic,
      labels: triaged.labels,
      reason: aiResponse.reason || router.staffReason({ area: triaged.area, lane: triaged.lane }, staffQuestion),
    });
    draft.files = chatFiles(message.attachments);

    await typingDelay();

    if (inHandoff) {
      await applyThreadName(channel, nameMeta);
    }

    if (escalate) {
      await assertCurrentOwnership();
      const previousCase = await supportCases.getCaseByThread(channel.id, message.author.id);
      let supportCase = await supportCases.getOrCreateCase({
        channelId: previousCase?.channelId || channel.id, customerId: message.author.id,
        customerThreadId: channel.isThread?.() ? channel.id : undefined,
        context: { area: triaged.area, lane: triaged.lane, dataLossRisk, needsPerson: true,
          attachmentCount: message.attachments?.size || 0, reasonCodes: dataLossRisk ? ['data_loss_risk'] : ['needs_person'] },
        sources: cleanAnswer.match(/https:\/\/[^\s)>]+/g) || [],
      });
      if (dbReady && !supportCase.escalationId) {
        supportCase = await supportCases.linkHandoff(supportCase.id, { escalationId: await db.createEscalation(channel.id) });
      }
      const deliveredCase = ['delivered', 'accepted'].includes(supportCase.status);
      console.log(`[Bot] Escalating channel=${channel.id} area=${triaged.area} signals=${escalationSignals.join(',')}`);
      const techLane = router.isTechLane({ lane: triaged.lane, area: triaged.area });
      if (github.isConfigured() && techLane) {
        try {
          const approval = await githubFlow.prepare({ message, client, supportCase,
            kind: githubHit?.duplicate ? 'comment' : 'issue', issueNumber: githubHit?.duplicate?.number });
          fileIssueId = approval?.id;
        } catch { console.error('[GitHubFlow] issue proposal staging unavailable'); }
      }
      let pinged = false;
      let duplicate = false;
      let reused = false;
      let reuseFailed = false;
      let cardHere = false;
      let deliveryFailed = false;
      let handoffThread = inHandoff ? channel : null;
      if (deliveredCase && !inHandoff && shouldReuseOpenHandoff(channel)) {
        const existing = await findOpenHandoff(channel, {
          userId: message.author?.id,
          question: asked,
          topic: triaged.topic,
        });
        if (existing) {
          try {
            await assertCurrentOwnership();
            await existing.send({
              content: rewriteUserMentions(escalateReply(cleanAnswer, { pinged: true, conversation: true, footers: localizedFooters }), message),
              allowedMentions: replyMentions(message, { pingAuthor: false, repliedUser: false }),
            });
            reused = true;
            duplicate = true;
            pinged = true;
            handoffThread = existing;
            await applyThreadName(existing, nameMeta);
            console.log(`[Bot] Reusing Handoff ${existing.id} for ${channel.id}`);
          } catch (err) {
            if (isLeaseLost(err)) throw err;
            reuseFailed = true;
            console.error('[Bot] reuse thread reply failed:', err.message);
          }
        }
      }
      if (!reused && (!stayInPost || handoffFollowup || !deliveredCase)) {
        try {
          await assertCurrentOwnership();
          const handoff = await notifyStaff({
            caseId: supportCase.id,
            onStaffSent: fileIssueId ? async (sent) => {
              const approval = await github.getScopedApproval(fileIssueId);
              await githubFlow.bindCard(approval, sent);
            } : undefined,
            client,
            message,
            question: staffQuestion,
            reason: holdPublicCopy
              ? redactStaffQuestion(aiResponse.reason || router.staffReason(triaged, asked))
              : aiResponse.reason || router.staffReason(triaged, asked),
            draft: cleanAnswer,
            shopify: shopifyLookup?.order ? shopify.formatStaffFacts(shopifyLookup.order) : undefined,
            area: triaged.area,
            github: changeSentence || githubHit?.duplicate?.url,
            fileIssueId,
            route: { area: triaged.area, lane: triaged.lane, escalate: true },
            skipDedupe: (isTestChannel(channel) && !inHandoff) || reuseFailed,
            topic: nameMeta.topic,
            labels: triaged.labels,
            dataLossRisk,
          });
          pinged = Boolean(handoff.ok);
          deliveryFailed = !handoff.ok;
          cardHere = handoff.via === 'channel' && Boolean(channel.isThread?.());
          duplicate = Boolean(handoff.duplicate);
          handoffThread = handoff.thread || handoffThread;
          if (handoff.threadId) await supportCases.linkHandoff(supportCase.id, { handoffThreadId: handoff.threadId });
          if (handoff.ok) await supportCases.markDelivered(supportCase.id, {
            confirmed: true, destination: handoff.deliveredVia || handoff.via,
          });
          if (handoff.thread && handoff.ok) {
            rememberOpenHandoff(channel.id, message.author?.id, handoff.thread);
            await applyThreadName(handoff.thread, nameMeta);
          }
          // Search similarity is background, not a customer-owned issue link.
          // The reviewed publication records that link after staff approval.
          console.log(
            `[Bot] Handoff ${channel.id} via=${handoff.via || 'none'} ok=${pinged}`
          );
        } catch (err) {
          if (isLeaseLost(err)) throw err;
          deliveryFailed = !pinged;
          console.error('[Bot] Handoff failed:', err.message);
        }
      }
      if (
        !reused &&
        !inHandoff &&
        triaged.fileIssue &&
        handoffThread &&
        triaged.area !== 'shop' &&
        triaged.area !== 'privacy'
      ) {
        await postIssueCard(handoffThread, draft, githubHit);
      }
      if (
        !reused &&
        !inHandoff &&
        !triaged.fileIssue &&
        triage.wantsShopTicket(triaged) &&
        handoffThread
      ) {
        await postShopTicketCard(handoffThread, triaged);
      }
      const movedToThread = !inHandoff && Boolean(handoffThread?.id);
      let parentReply = escalateReply(cleanAnswer, {
        pinged: pinged || deliveredCase,
        duplicate,
        conversation: stayInPost && !handoffFollowup,
        issue:
          (triaged.fileIssue || triage.wantsShopTicket(triaged)) &&
          !inHandoff &&
          !reused &&
          !movedToThread &&
          (Boolean(handoffThread) || cardHere),
        pingAuthor,
        deliveryFailed,
        replyInThread: pinged && Boolean(channel.isThread?.() || handoffThread?.id),
        footers: localizedFooters,
      });
      if (movedToThread) {
        const threadLink = `<#${handoffThread.id}>`;
        parentReply = `${clipForDiscord(parentReply, 1900 - threadLink.length - 2)}\n\n${threadLink}`;
      }
      await replySafe(message, parentReply, { pingAuthor });
      didReply = true;
      answered = true;
    } else {
      await replySafe(message, cleanAnswer, { pingAuthor });
      didReply = true;
      answered = true;
    }

    if (stayInPost) await noteCustomerLead(channel, message);
    markReplied(`${channel.id}:${message.author.id}`);
    if (channel.isThread?.()) markAnsweredText(channel.id, message.author.id, message.content);
    if (dbReady) {
      await db.upsertThread(channel.id, message.id);
    }
  } catch (err) {
    if (isLeaseLost(err)) throw err;
    console.error(`[Bot] Error in ${channel.id}:`, err.message);
    if (!didReply) try {
      await replySafe(
        message,
        'Something broke on my side. I have not pinged anyone. Try that again in a moment.'
      );
      didReply = true;
    } catch (replyErr) {
      console.error('[Bot] Reply failed:', replyErr.message);
    }
  } finally {
    const total = Math.round(performance.now() - startedAt);
    if (didReply) console.log(timingLogLine({ ...stageMs, total }, stageUsage));
    process.emit('omiSupportTimings', { messageId: message.id, stages: { ...stageMs, total } });
  }
  return answered ? 'answered' : didReply ? 'failed' : 'ignored';
}

client.on(Events.ThreadCreate, async (thread) => {
  if (client.user && thread.ownerId === client.user.id) return;
  if (isTrustedHandoffThread(thread)) return;
  if (!isHelpThread(thread) && !isTestChannel(thread)) return;
  try {
    const starter = await thread.fetchStarterMessage();
    if (starter && !starter.author.bot) {
      await handleMessage(starter);
    }
  } catch (err) {
    console.error(`[Bot] Error handling new thread ${thread.id}:`, err.message);
  }
});

client.on(Events.MessageCreate, async (message) => {
  if (await handleFaqSave(message)) return;
  await handleMessage(message);
});

client.on(Events.InteractionCreate, (interaction) => {
  return runtime.track(() => commands.handleInteraction(interaction)).catch(() => {
    console.error('[Bot] interaction handling failed');
  });
});

commands.setTestQuestionHandler(async (interaction, question) => {
  const channel = interaction.channel;
  if (!channel) return;
  const message = {
    id: interaction.id,
    content: question,
    author: interaction.user,
    channel,
    attachments: { size: 0, values: () => [] },
    mentions: { has: () => false },
    reply: async (opts) => channel.send(opts),
  };
  await handleMessage(message);
});

async function nickOmiSupport(client) {
  if (!VECTOR_TEST_CHANNEL_ID) return;
  try {
    const ch = await client.channels.fetch(VECTOR_TEST_CHANNEL_ID);
    const me = ch?.guild?.members?.me;
    if (me && typeof me.setNickname === 'function' && me.nickname !== 'Omi Support') {
      await me.setNickname('Omi Support', 'Customers should see Omi Support');
    }
  } catch (err) {
    console.error('[Bot] nickname Omi Support failed:', err.message);
  }
}

client.once(Events.ClientReady, async () => {
  recoveryTimer = setInterval(() => {
    runtime.track(() => runtime.recoverQueued(recoverQueuedRequest)).catch(() => console.error('[SupportRuntime] queued request lookup failed'));
  }, 1000);
  recoveryTimer.unref();
  console.log(`[Bot] Logged in as ${client.user.tag}`);
  await nickOmiSupport(client);
  if (VECTOR_TEST_CHANNEL_ID) {
    console.log(`[Bot] Test channel ${VECTOR_TEST_CHANNEL_ID}`);
  }
  if (HELP_FORUM_CHANNEL_ID) {
    console.log('[Bot] Help forum is set — PII/order/privacy stay on private Handoff. Leave this unset until #vector-test lanes are proven.');
  }
  if (!VECTOR_TEST_CHANNEL_ID && !HELP_FORUM_CHANNEL_ID) {
    console.log('[Bot] No channel pinned — will answer when @mentioned');
  }
  console.log(
    `[Bot] Handoff staff-channel=${Boolean(process.env.STAFF_ALERT_CHANNEL_ID)} telegram=${telegramReady} threads=${process.env.HANDOFF_THREADS !== '0'} shopify=${shopify.isConfigured()} github=${github.isConfigured()}`
  );
  try {
    const n = await knowledge.hydrateFromDiscord(client, staffMentionIds().users);
    console.log(`[Knowledge] hydrated ${n} named-staff faq line(s) from Handoff threads`);
  } catch (err) {
    console.error('[Knowledge] hydrate failed:', err.message);
  }
  try {
    const n = await commands.registerSlashCommands(client);
    console.log(`[Bot] slash commands in ${n} guild(s)`);
  } catch (err) {
    console.error('[Bot] slash command register failed:', err.message);
  }
});

async function start() {
  const required = ['DISCORD_TOKEN'];
  if (!process.env.CMD_API_KEY) required.push('CMD_API_KEY');
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(`[Boot] Missing env variables: ${missing.join(', ')}`);
    process.exit(1);
  }
  if (!process.env.STAFF_ALERT_CHANNEL_ID && !telegram.isReady()) {
    console.error('[Boot] No staff-only handoff destination configured; customer handoffs will use the email fallback.');
  }

  if (dbReady) {
    try {
      await db.initSchema();
      await require('./supportIdentityStore').getStore().pruneExpired();
      coordinationReady = true;
      await github.hydrateIssueThreads();
      const { fillIfEmpty } = require('./scripts/fill-db');
      fillIfEmpty().catch((err) => console.error('[DB] fill failed:', err.message));
      const refresh = setInterval(() => {
        fillIfEmpty().catch((err) => console.error('[DB] refresh failed:', err.message));
        require('./supportIdentityStore').getStore().pruneExpired().catch(() => console.error('[DB] support identity cleanup failed'));
      }, KNOWLEDGE_REFRESH_MS);
      refresh.unref();
    } catch (err) {
      throw new Error('Support database initialization failed');
    }
  }

  httpServer = app.listen(PORT, () => {
    console.log(`[Health] Listening on port ${PORT}`);
  });

  if (telegramReady) {
    telegram.setDiscordClient(client);
    telegram.startPolling();
  }

  await client.login(process.env.DISCORD_TOKEN);
}

async function shutdown(signal) {
  if (shutdownPromise) return shutdownPromise;
  shutdownPromise = (async () => {
    console.log(`[Bot] Received ${signal}, draining replies...`);
    runtime.stopAccepting();
    clearInterval(recoveryTimer);
    telegram.stopPolling();
    const [drained, telegramDrained] = await Promise.all([runtime.drain(), telegram.drainPolling()]);
    console.log(`[SupportRuntime] drain completed=${drained} telegram_completed=${telegramDrained}`);
    client.destroy();
    if (dbReady) await db.shutdown();
    httpServer?.close();
    process.exit(0);
  })();
  return shutdownPromise;
}

if (require.main === module) {
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', (err) => {
    console.error('[Bot] Unhandled rejection:', err);
  });

  start().catch((err) => {
    console.error('[Boot] Fatal error:', err);
    process.exit(1);
  });
}

module.exports = { app, client, handleMessage, shouldHandle, runtime, noteCustomerLead };
