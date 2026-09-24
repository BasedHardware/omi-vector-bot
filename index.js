require('dotenv').config();

const { Client, GatewayIntentBits, Events } = require('discord.js');
const express = require('express');
const db = require('./db');
const { queryAgent } = require('./opencode');
const telegram = require('./telegram');
const {
  isOnCooldown,
  markReplied,
  claimMessage,
  shouldEscalate,
  typingDelay,
  sanitizeReply,
  formatDiscordReply,
  clipForDiscord,
  clipThreadHistory,
  escalateReply,
  stripPingNarration,
  stripFalseCertainty,
  rewriteUserMentions,
  wantsAuthorPing,
  attachAuthorMention,
  replyMentions,
  isUnknownMessageRef,
} = require('./utils');
const { hasUsableAttachment, fetchTextAttachments, formatQuestion, shouldMentionUnreadMedia, unreadMediaSentence } = require('./attachments');
const {
  notifyStaff,
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
const github = require('./github');
const commands = require('./commands');
const { buildToolFacts } = require('./prompt');
const { stripHowtoBleed, stripShopBleed, stripUnsupportedClaims } = require('./honesty');
const triage = require('./triage');

const HELP_FORUM_CHANNEL_ID = process.env.HELP_FORUM_CHANNEL_ID;
const VECTOR_TEST_CHANNEL_ID = process.env.VECTOR_TEST_CHANNEL_ID;
const PORT = process.env.PORT || 3000;
const telegramReady = Boolean(process.env.TELEGRAM_TOKEN && process.env.TELEGRAM_CHAT_ID);
const dbReady = Boolean(process.env.DATABASE_URL);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const app = express();
app.get('/health', (_req, res) => res.send('OK'));

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

async function replySafe(message, content, { pingAuthor = false } = {}) {
  let text = rewriteUserMentions(content, message);
  if (pingAuthor) text = attachAuthorMention(text, message);
  const payload = {
    content: text,
    allowedMentions: replyMentions(message, { pingAuthor, repliedUser: false }),
  };
  try {
    await message.reply({
      ...payload,
      allowedMentions: replyMentions(message, { pingAuthor, repliedUser: true }),
    });
  } catch (err) {
    if (!isUnknownMessageRef(err) || typeof message.channel?.send !== 'function') {
      throw err;
    }
    console.error('[Bot] reply reference missing, sending in channel:', err.message);
    await message.channel.send(payload);
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

function shouldHandle(message) {
  if (message.author.bot) return false;
  const caption = message.content.replace(/<@!?\d+>/g, '').trim();
  if (caption.length < 5 && !hasUsableAttachment(message) && !forumStarterPrefix(message)) return false;
  if (isHandoffThread(message.channel)) {
    if (isTestChannel(message.channel)) return true;
    const { users } = staffMentionIds();
    if (users.length && canSaveFaq(message.author.id)) return false;
    return true;
  }
  if (isTestChannel(message.channel)) return true;
  if (isHelpThread(message.channel)) return true;
  if (client.user && message.mentions.has(client.user, { ignoreEveryone: true })) return true;
  return false;
}

async function getHistory(channel, excludeId) {
  // Parent #vector-test is a pile of unrelated tickets. Only follow-ups
  // inside an existing Handoff or help post may see prior messages.
  if (!isHandoffThread(channel) && !isHelpThread(channel)) return [];
  const messages = await channel.messages.fetch({ limit: 12 });
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
  try {
    return await knowledge.searchAll(question);
  } catch (err) {
    console.error('[Knowledge] search failed:', err.message);
    return knowledge.search(question);
  }
}

async function handleFaqSave(message) {
  if (message.author?.bot) return false;
  if (!isHandoffThread(message.channel)) return false;

  const snippet = knowledge.parseFaqCommand(message.content);
  if (snippet === null) return false;

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

  if (!saved.duplicate) {
    await knowledge.persistSnippet(saved.snippet);
  }
  try {
    await replySafe(message, 'Saved. I will use this on later questions.');
  } catch (err) {
    console.error('[Knowledge] reply failed:', err.message);
  }
  return true;
}

async function postIssueCard(channel, draft, githubHit) {
  if (!channel?.send || !draft) return;
  let url = githubHit?.duplicate?.url || '';
  if (!url && github.isConfigured()) {
    const created = await github.createIssue({ ...draft, threadId: channel.id });
    if (created.ok) {
      url = created.url;
      github.linkIssueThread(created.number, channel.id);
    }
  }
  try {
    await channel.send({ embeds: [github.formatIssueCard(draft, { url })] });
  } catch (err) {
    console.error('[Bot] issue card failed:', err.message);
  }
}

async function postShopTicketCard(channel, triaged) {
  if (!channel?.send || !triaged) return;
  try {
    await channel.send({
      embeds: [
        github.formatShopTicketCard({
          title: triaged.topic,
          labels: triaged.labels,
        }),
      ],
    });
  } catch (err) {
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
  if (!shouldHandle(message)) return;
  if (!claimMessage(message.id)) {
    console.log(`[Bot] already handling ${message.id}`);
    return;
  }

  const channel = message.channel;
  // Test channel: do not silently drop a second question. Help-forum cooldown stays.
  if (isOnCooldown(channel.id) && !isTestChannel(channel)) {
    console.log(`[Bot] Cooldown active for ${channel.id}, skipping`);
    return;
  }

  const caption = message.content.replace(/<@!?\d+>/g, '').trim();
  const files = await fetchTextAttachments(message.attachments);
  const unreadMedia = shouldMentionUnreadMedia(message.attachments, files);
  let asked = clipUserQuestion(caption) || caption;
  const forumPrefix = forumStarterPrefix(message);
  if (forumPrefix) asked = [forumPrefix, asked].filter(Boolean).join('\n');
  const embedNote = github.textFromEmbeds(message.embeds);
  if (embedNote) asked = [asked, embedNote].filter(Boolean).join('\n');
  const question = formatQuestion(asked, files);
  const changes = github.linkedChanges(question);
  if (question.length < 5) {
    if (unreadMedia && !changes.length) {
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

    const route = router.classify(question);
    const holdPublicCopy = isHelpThread(channel) && !router.isPublicForumSafe(asked || question);
    if (holdPublicCopy) {
      console.log('[Bot] PII/order/privacy stays off the public help copy');
    }
    let botCanAnswer = false;
    if (!holdPublicCopy && router.isTechLane(route) && !changes.length) {
      const found = await github.searchPulls(question);
      if (found) changes.push(found);
    }
    if (router.isTechLane(route) && changes.length) botCanAnswer = true;

    const binding = await shopifyBind.get(message.author.id);
    const verifiedEmail = binding?.email || '';
    const useShopify = shopify.shouldLookup(route, asked || question, { verifiedEmail });
    let shopifyLookup = null;
    let githubHit = null;
    let fileIssueId;
    let aiResponse;
    let cleanAnswer;
    let skipModel = false;
    let snippets = [];

    if (useShopify) {
      shopifyLookup = await shopify.lookupOrder(asked || question, { verifiedEmail });
      console.log(`[Shopify] lookup key=${shopifyLookup.reason === 'no-key' ? 'none' : 'set'} status=${shopifyLookup.reason || 'hit'}`);
    }
    if (!holdPublicCopy && github.isConfigured() && router.isTechLane(route)) {
      githubHit = await github.searchIssues(asked || question);
    }

    if (botCanAnswer) {
      skipModel = true;
      aiResponse = {
        final_answer: '',
        confidence: 0.95,
        escalate: false,
        reason: 'Pull request already covers this',
      };
      cleanAnswer = '';
    } else if (holdPublicCopy || router.skipModel(route)) {
      skipModel = true;
      aiResponse = {
        final_answer: '',
        confidence: 0.9,
        escalate: true,
        reason: router.staffReason(route, asked || question),
      };
      cleanAnswer = clipForDiscord(router.cannedReply(route, asked || question) || '');
      if (shopifyLookup) {
        const extra = shopify.buildUserReply(shopifyLookup, asked || question);
        if (extra) {
          cleanAnswer = clipForDiscord([cleanAnswer, extra].filter(Boolean).join('\n\n'));
        }
        aiResponse.reason = aiResponse.reason || shopify.staffReason(shopifyLookup, asked || question);
      }
    }

    if (!skipModel) {
      const [threadHistory, knowledgeSnippets] = await Promise.all([
        getHistory(channel, message.id),
        searchKnowledge(asked || question),
      ]);
      snippets = knowledge.filterSnippetsForLane(
        shopify.filterKnowledge(knowledgeSnippets),
        route.lane
      );
      const shopifyText = shopifyLookup
        ? shopify.buildUserReply(shopifyLookup, asked || question)
        : '';
      const toolFacts = buildToolFacts({
        route,
        shopifyText,
        githubText: githubHit?.duplicate?.url || '',
      });

      try {
        aiResponse = await queryAgent({
          question,
          threadHistory,
          knowledgeSnippets: snippets,
          route,
          toolFacts,
          sessionId: `discord-${channel.id}`,
          canNotifyStaff: canNotifyStaff({ discordReady: true }),
        });

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
        const down = router.whenModelDown(route, asked || question);
        aiResponse = down.agent;
        cleanAnswer = clipForDiscord(down.reply);
      }
    }

    const triaged = triage.merge(route, skipModel ? {} : aiResponse, question);
    if (!skipModel) {
      cleanAnswer = clipForDiscord(
        knowledge.applyStaffFacts(
          formatDiscordReply(stripPingNarration(sanitizeReply(aiResponse.final_answer))),
          snippets
        )
      );
    }
    cleanAnswer = clipForDiscord(
      stripFalseCertainty(
        stripUnsupportedClaims(
          stripShopBleed(stripHowtoBleed(cleanAnswer || '', triaged.lane), triaged.lane),
          triaged.lane,
          asked || question
        )
      )
    );
    if (threadHasKnownIssueTag(channel)) {
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
      const note = unreadMediaSentence();
      if (!String(cleanAnswer || '').includes(note)) {
        cleanAnswer = [cleanAnswer, note].filter(Boolean).join('\n\n');
      }
    }
    let changeSentence = '';
    if (changes[0]) {
      const lookup = await github.lookupChange(changes[0]);
      changeSentence = github.customerChangeSentence(changes[0], lookup, {
        question,
        title: changes[0].title,
      });
      cleanAnswer = github.stripShippedClaims(cleanAnswer);
      if (changeSentence && !String(cleanAnswer || '').includes(changes[0].url)) {
        cleanAnswer = [cleanAnswer, changeSentence].filter(Boolean).join('\n\n');
      }
    }

    if (holdPublicCopy) {
      cleanAnswer = clipForDiscord(
        router.cannedReply(route, asked || question) ||
          "I can't share account or order details in this public post."
      );
      if (
        /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(cleanAnswer) ||
        /\b\d{1,5}\s+(?:(?:[A-Za-z][A-Za-z.'-]*|\d{1,3}(?:st|nd|rd|th))\s+){0,4}(?:street|st|avenue|ave|road|rd|blvd)\b/i.test(
          cleanAnswer
        )
      ) {
        cleanAnswer = "I can't share account or order details in this public post.";
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
    const inHandoff = isHandoffThread(channel);
    const pingAuthor = wantsAuthorPing(caption);
    const escalate =
      holdPublicCopy ||
      (!botCanAnswer && (shouldEscalate(aiResponse, caption) || route.escalate || triaged.escalate));
    const draft = github.draftFromQuestion(staffQuestion, triaged.area, {
      topic: nameMeta.topic,
      labels: triaged.labels,
    });

    await typingDelay();

    if (inHandoff) {
      await applyThreadName(channel, nameMeta);
    }

    if (escalate) {
      console.log(`[Bot] Escalating ${channel.id} area=${triaged.area} topic=${triaged.topic}`);
      const techLane = router.isTechLane({ lane: triaged.lane, area: triaged.area });
      if (github.isConfigured() && techLane && !githubHit?.duplicate) {
        fileIssueId = github.stashDraft(draft);
      }
      let pinged = false;
      let duplicate = false;
      let reused = false;
      let reuseFailed = false;
      let cardHere = false;
      let handoffThread = inHandoff ? channel : null;
      if (!inHandoff && shouldReuseOpenHandoff(channel)) {
        const existing = await findOpenHandoff(channel, {
          userId: message.author?.id,
          question: asked,
          topic: triaged.topic,
        });
        if (existing) {
          try {
            await existing.send({
              content: rewriteUserMentions(escalateReply(cleanAnswer, { conversation: true }), message),
              allowedMentions: replyMentions(message, { pingAuthor: false, repliedUser: false }),
            });
            reused = true;
            duplicate = true;
            pinged = true;
            handoffThread = existing;
            await applyThreadName(existing, nameMeta);
            console.log(`[Bot] Reusing Handoff ${existing.id} for ${channel.id}`);
          } catch (err) {
            reuseFailed = true;
            console.error('[Bot] reuse thread reply failed:', err.message);
          }
        }
      }
      if (!reused && !inHandoff) {
        try {
          const handoff = await notifyStaff({
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
          });
          pinged = Boolean(handoff.ok);
          cardHere = handoff.via === 'channel' && Boolean(channel.isThread?.());
          duplicate = Boolean(handoff.duplicate);
          handoffThread = handoff.thread || handoffThread;
          if (handoff.thread) {
            rememberOpenHandoff(channel.id, message.author?.id, handoff.thread);
            await applyThreadName(handoff.thread, nameMeta);
          }
          if (handoff.threadId && githubHit?.duplicate?.number) {
            github.linkIssueThread(githubHit.duplicate.number, handoff.threadId);
          }
          console.log(
            `[Bot] Handoff ${channel.id} via=${handoff.via || 'none'} ok=${pinged}`
          );
        } catch (err) {
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
      let parentReply = escalateReply(cleanAnswer, {
        pinged,
        duplicate,
        conversation: inHandoff,
        issue:
          (triaged.fileIssue || triage.wantsShopTicket(triaged)) &&
          !inHandoff &&
          !reused &&
          (Boolean(handoffThread) || cardHere),
        pingAuthor,
      });
      if (reused && handoffThread?.id && !inHandoff) {
        parentReply = `${parentReply}\n\n<#${handoffThread.id}>`;
      }
      if (holdPublicCopy) parentReply = cleanAnswer;
      await replySafe(message, parentReply, { pingAuthor });
      if (dbReady) {
        await db.createEscalation(channel.id);
      }
    } else {
      await replySafe(message, cleanAnswer, { pingAuthor });
    }

    markReplied(channel.id);
    if (dbReady) {
      await db.upsertThread(channel.id, message.id);
    }
  } catch (err) {
    console.error(`[Bot] Error in ${channel.id}:`, err.message);
    try {
      await replySafe(
        message,
        'Something broke on my side. I have not pinged anyone. Try that again in a moment.'
      );
    } catch (replyErr) {
      console.error('[Bot] Reply failed:', replyErr.message);
    }
  }
}

client.on(Events.ThreadCreate, async (thread) => {
  if (client.user && thread.ownerId === client.user.id) return;
  if (isHandoffThread(thread)) return;
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
  commands.handleInteraction(interaction);
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
    const n = await knowledge.hydrateFromDiscord(client);
    console.log(`[Knowledge] hydrated ${n} faq line(s) from Handoff threads`);
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
  const required = ['DISCORD_TOKEN', 'OPENCODE_API_KEY'];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(`[Boot] Missing env variables: ${missing.join(', ')}`);
    process.exit(1);
  }

  if (dbReady) {
    await db.initSchema();
  }

  app.listen(PORT, () => {
    console.log(`[Health] Listening on port ${PORT}`);
  });

  if (telegramReady) {
    telegram.setDiscordClient(client);
    telegram.startPolling();
  }

  await client.login(process.env.DISCORD_TOKEN);
}

async function shutdown(signal) {
  console.log(`[Bot] Received ${signal}, shutting down...`);
  telegram.stopPolling();
  client.destroy();
  if (dbReady) {
    await db.shutdown();
  }
  process.exit(0);
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

module.exports = { client, handleMessage, shouldHandle };
