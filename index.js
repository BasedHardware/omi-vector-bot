require('dotenv').config();

const { Client, GatewayIntentBits, Events } = require('discord.js');
const express = require('express');
const db = require('./db');
const { queryAgent } = require('./opencode');
const telegram = require('./telegram');
const {
  isOnCooldown,
  markReplied,
  shouldEscalate,
  typingDelay,
  sanitizeReply,
  formatDiscordReply,
  clipForDiscord,
  clipThreadHistory,
  escalateReply,
  stripPingNarration,
} = require('./utils');
const { hasUsableAttachment, fetchTextAttachments, formatQuestion } = require('./attachments');
const { notifyStaff, canNotifyStaff, isHandoffThread, clipUserQuestion, canSaveFaq } = require('./handoff');
const knowledge = require('./knowledge');

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

function isHelpThread(channel) {
  return Boolean(HELP_FORUM_CHANNEL_ID) && channel.isThread() && channel.parentId === HELP_FORUM_CHANNEL_ID;
}

function isTestChannel(channel) {
  if (!VECTOR_TEST_CHANNEL_ID) return false;
  if (channel.id === VECTOR_TEST_CHANNEL_ID) return true;
  return channel.isThread() && channel.parentId === VECTOR_TEST_CHANNEL_ID;
}

function shouldHandle(message) {
  if (message.author.bot) return false;
  if (isHandoffThread(message.channel)) return false;
  const caption = message.content.replace(/<@!?\d+>/g, '').trim();
  if (caption.length < 5 && !hasUsableAttachment(message)) return false;
  if (isTestChannel(message.channel)) return true;
  if (isHelpThread(message.channel)) return true;
  if (client.user && message.mentions.has(client.user)) return true;
  return false;
}

async function getHistory(channel, excludeId) {
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
  if (snippet === null) return true;

  if (!canSaveFaq(message.author.id)) {
    try {
      await message.reply('Only named staff can save a faq line.');
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
        : 'Nothing to save. Use `faq: short true sentence`.';
    try {
      await message.reply(why);
    } catch (err) {
      console.error('[Knowledge] reply failed:', err.message);
    }
    return true;
  }

  if (!saved.duplicate) {
    await knowledge.persistSnippet(saved.snippet);
  }
  try {
    await message.reply('Saved. I will use this on later questions.');
  } catch (err) {
    console.error('[Knowledge] reply failed:', err.message);
  }
  return true;
}

async function handleMessage(message) {
  if (!shouldHandle(message)) return;

  const channel = message.channel;
  // Test channel: do not silently drop a second question. Help-forum cooldown stays.
  if (isOnCooldown(channel.id) && !isTestChannel(channel)) {
    console.log(`[Bot] Cooldown active for ${channel.id}, skipping`);
    return;
  }

  const caption = message.content.replace(/<@!?\d+>/g, '').trim();
  const asked = clipUserQuestion(caption) || caption;
  const files = await fetchTextAttachments(message.attachments);
  const question = formatQuestion(asked, files);
  if (question.length < 5) return;

  console.log(`[Bot] Processing in ${channel.id}`);

  try {
    await channel.sendTyping();

    const [threadHistory, knowledgeSnippets] = await Promise.all([
      getHistory(channel, message.id),
      searchKnowledge(asked || question),
    ]);

    const aiResponse = await queryAgent({
      question,
      threadHistory,
      knowledgeSnippets,
      sessionId: `discord-${channel.id}`,
      canNotifyStaff: canNotifyStaff({ discordReady: true }),
    });

    await typingDelay();
    const cleanAnswer = clipForDiscord(
      knowledge.applyStaffFacts(
        formatDiscordReply(stripPingNarration(sanitizeReply(aiResponse.final_answer))),
        knowledgeSnippets
      )
    );

    if (shouldEscalate(aiResponse, caption)) {
      console.log(`[Bot] Escalating ${channel.id} (confidence: ${aiResponse.confidence})`);
      let pinged = false;
      let duplicate = false;
      try {
        const handoff = await notifyStaff({
          client,
          message,
          question: asked,
          reason: aiResponse.reason,
          draft: cleanAnswer,
          skipDedupe: isTestChannel(channel),
        });
        pinged = Boolean(handoff.ok);
        duplicate = Boolean(handoff.duplicate);
        console.log(
          `[Bot] Handoff ${channel.id} via=${handoff.via || 'none'} ok=${pinged}`
        );
      } catch (err) {
        console.error('[Bot] Handoff failed:', err.message);
      }
      await message.reply(escalateReply(cleanAnswer, { pinged, duplicate }));
      if (dbReady) {
        await db.createEscalation(channel.id);
      }
    } else {
      await message.reply(cleanAnswer);
    }

    markReplied(channel.id);
    if (dbReady) {
      await db.upsertThread(channel.id, message.id);
    }
  } catch (err) {
    console.error(`[Bot] Error in ${channel.id}:`, err.message);
    try {
      await message.reply(
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

client.once(Events.ClientReady, () => {
  console.log(`[Bot] Logged in as ${client.user.tag}`);
  if (VECTOR_TEST_CHANNEL_ID) {
    console.log(`[Bot] Test channel ${VECTOR_TEST_CHANNEL_ID}`);
  }
  if (HELP_FORUM_CHANNEL_ID) {
    console.log(`[Bot] Help forum ${HELP_FORUM_CHANNEL_ID}`);
  }
  if (!VECTOR_TEST_CHANNEL_ID && !HELP_FORUM_CHANNEL_ID) {
    console.log('[Bot] No channel pinned — will answer when @mentioned');
  }
  console.log(
    `[Bot] Handoff staff-channel=${Boolean(process.env.STAFF_ALERT_CHANNEL_ID)} telegram=${telegramReady} threads=${process.env.HANDOFF_THREADS !== '0'}`
  );
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

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (err) => {
  console.error('[Bot] Unhandled rejection:', err);
});

start().catch((err) => {
  console.error('[Boot] Fatal error:', err);
  process.exit(1);
});
