require('dotenv').config();

const { Client, GatewayIntentBits, Events } = require('discord.js');
const express = require('express');
const db = require('./db');
const { queryAgent } = require('./openclaw');
const telegram = require('./telegram');
const {
  isOnCooldown,
  markReplied,
  randomGreeting,
  shouldEscalate,
  typingDelay,
  sanitizeReply,
} = require('./utils');

const HELP_FORUM_CHANNEL_ID = process.env.HELP_FORUM_CHANNEL_ID;
const PORT = process.env.PORT || 3000;

// ── Discord Client ──────────────────────────────────────────────────────────

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// ── Health Server ───────────────────────────────────────────────────────────

const app = express();
app.get('/health', (_req, res) => res.send('OK'));

// ── Helpers ─────────────────────────────────────────────────────────────────

function isHelpThread(channel) {
  return channel.isThread() && channel.parentId === HELP_FORUM_CHANNEL_ID;
}

async function getThreadHistory(thread, limit = 10) {
  const messages = await thread.messages.fetch({ limit });
  return [...messages.values()]
    .reverse()
    .map((m) => ({
      author: m.author.bot ? 'bot' : m.author.username,
      content: m.content,
    }));
}

async function handleMessage(message) {
  // Ignore bots
  if (message.author.bot) return;

  // Must be in a help forum thread
  const thread = message.channel;
  if (!isHelpThread(thread)) return;

  // Ignore very short messages
  if (message.content.trim().length < 5) return;

  // Anti-spam: 60s cooldown per thread
  if (isOnCooldown(thread.id)) {
    console.log(`[Bot] Cooldown active for thread ${thread.id}, skipping`);
    return;
  }

  console.log(`[Bot] Processing message in thread ${thread.id}`);

  try {
    // Show typing indicator
    await thread.sendTyping();

    // Gather context
    const [threadHistory, knowledgeSnippets] = await Promise.all([
      getThreadHistory(thread),
      db.searchKnowledge(message.content),
    ]);

    // Call OpenClaw
    const aiResponse = await queryAgent({
      question: message.content,
      threadHistory,
      knowledgeSnippets,
    });

    // Human-like delay
    await typingDelay();

    const cleanAnswer = sanitizeReply(aiResponse.final_answer);

    // Decide: escalate or reply directly
    if (shouldEscalate(aiResponse, message.content)) {
      console.log(`[Bot] Escalating thread ${thread.id} (confidence: ${aiResponse.confidence})`);

      // Send placeholder to user
      await thread.send(
        'Got this — checking internally to give you the right answer \u{1F64F}'
      );

      // Send escalation to Telegram
      await telegram.sendEscalation({
        threadId: thread.id,
        userQuestion: message.content,
        botDraft: cleanAnswer,
        missingInfo: aiResponse.escalation_question_for_aarav,
      });

      // Store escalation
      await db.createEscalation(thread.id);
    } else {
      // Direct reply with a greeting
      const greeting = randomGreeting();
      await thread.send(`${greeting} ${cleanAnswer}`);
    }

    // Update tracking
    markReplied(thread.id);
    await db.upsertThread(thread.id, message.id);
  } catch (err) {
    console.error(`[Bot] Error handling message in ${thread.id}:`, err.message);

    // If OpenClaw is down, escalate gracefully
    if (!isOnCooldown(thread.id)) {
      try {
        await thread.send(
          'Got this — checking internally to give you the right answer \u{1F64F}'
        );
        await telegram.sendEscalation({
          threadId: thread.id,
          userQuestion: message.content,
          botDraft: '[OpenClaw unreachable]',
          missingInfo: 'Bot failed to generate a response — needs manual reply.',
        });
        await db.createEscalation(thread.id);
        markReplied(thread.id);
      } catch (fallbackErr) {
        console.error('[Bot] Fallback escalation failed:', fallbackErr.message);
      }
    }
  }
}

// ── Events ──────────────────────────────────────────────────────────────────

client.on(Events.ThreadCreate, async (thread) => {
  if (!isHelpThread(thread)) return;
  console.log(`[Bot] New help thread created: ${thread.id}`);

  // Wait for the first message to arrive
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
  await handleMessage(message);
});

client.once(Events.ClientReady, () => {
  console.log(`[Bot] Logged in as ${client.user.tag}`);
});

// ── Startup ─────────────────────────────────────────────────────────────────

async function start() {
  // Validate env
  const required = [
    'DISCORD_TOKEN',
    'TELEGRAM_TOKEN',
    'TELEGRAM_CHAT_ID',
    'OPENCLAW_URL',
    'DATABASE_URL',
    'HELP_FORUM_CHANNEL_ID',
  ];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(`[Boot] Missing env variables: ${missing.join(', ')}`);
    process.exit(1);
  }

  // Init DB schema
  await db.initSchema();

  // Start health server
  app.listen(PORT, () => {
    console.log(`[Health] Listening on port ${PORT}`);
  });

  // Give Telegram module access to Discord client for posting replies
  telegram.setDiscordClient(client);
  telegram.startPolling();

  // Login to Discord
  await client.login(process.env.DISCORD_TOKEN);
}

// ── Graceful Shutdown ───────────────────────────────────────────────────────

async function shutdown(signal) {
  console.log(`[Bot] Received ${signal}, shutting down...`);
  telegram.stopPolling();
  client.destroy();
  await db.shutdown();
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
