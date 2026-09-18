const axios = require('axios');

const TOKEN = process.env.TELEGRAM_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const BASE = TOKEN ? `https://api.telegram.org/bot${TOKEN}` : '';
const POLL_INTERVAL_MS = 3_000;
const TELEGRAM_MAX = 3500;

let offset = 0;
let pollTimer = null;
let discordClient = null;
let botUserId = null;

async function getBotUserId() {
  if (botUserId) return botUserId;
  const { data } = await axios.get(`${BASE}/getMe`, { timeout: 10_000 });
  if (data.ok && data.result?.id) botUserId = data.result.id;
  return botUserId;
}

// A reply only counts as a staff answer when it targets a message this bot
// actually sent. Without the author check, anyone in the configured chat can
// post their own "Thread: <channel id>" message, reply to it, and make Vector
// post into arbitrary Discord channels (and poison the knowledge base).
function isBotEscalationReply(msg, botId) {
  const replyTo = msg?.reply_to_message;
  if (!replyTo?.text) return false;
  if (!botId || Number(replyTo.from?.id) !== Number(botId)) return false;
  return /^Thread:\s*\S+/m.test(replyTo.text);
}

function isReady() {
  return Boolean(TOKEN && CHAT_ID);
}

function setDiscordClient(client) {
  discordClient = client;
}

function clipField(value, max) {
  const text = String(value || '').trim();
  if (!text) return '(none)';
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

function formatEscalationText({ threadId, userQuestion, botDraft, missingInfo, jumpUrl }) {
  const lines = [
    `Thread: ${threadId || '(unknown)'}`,
    jumpUrl ? `Jump: ${jumpUrl}` : '',
    `User asked: ${clipField(userQuestion, 1200)}`,
    `Why: ${clipField(missingInfo, 300)}`,
    `Bot draft: ${clipField(botDraft, 800)}`,
  ].filter(Boolean);
  return lines.join('\n').slice(0, TELEGRAM_MAX);
}

async function sendEscalation(payload) {
  if (!isReady()) return false;
  try {
    await axios.post(`${BASE}/sendMessage`, {
      chat_id: CHAT_ID,
      text: formatEscalationText(payload),
    });
    return true;
  } catch (err) {
    console.error('[Telegram] send failed:', err.message);
    return false;
  }
}

async function pollUpdates() {
  if (!isReady()) return;
  try {
    const { data } = await axios.get(`${BASE}/getUpdates`, {
      params: { offset, timeout: 2 },
      timeout: 10_000,
    });

    if (!data.ok || !data.result?.length) return;

    for (const update of data.result) {
      offset = update.update_id + 1;
      await handleUpdate(update);
    }
  } catch (err) {
    console.error('[Telegram] Poll error:', err.message);
  }
}

async function handleUpdate(update) {
  const msg = update.message;
  if (!msg?.text) return;

  // Only process messages from the configured chat
  if (String(msg.chat.id) !== String(CHAT_ID)) return;

  const text = msg.text.trim();

  // Check if this is a reply to an escalation message this bot sent
  let myId;
  try {
    myId = await getBotUserId();
  } catch (err) {
    console.error('[Telegram] getMe failed:', err.message);
    return;
  }
  if (!isBotEscalationReply(msg, myId)) return;
  const replyTo = msg.reply_to_message.text;

  // Extract thread ID from the original escalation message
  const threadMatch = replyTo.match(/^Thread:\s*(\S+)/m);
  if (!threadMatch) return;

  const threadId = threadMatch[1];

  // Parse Aarav's reply: "A: answer\nKB: knowledge snippet"
  const answerMatch = text.match(/^A:\s*(.+?)(?:\nKB:|$)/s);
  if (!answerMatch) {
    console.log('[Telegram] Reply did not match A: format, skipping');
    return;
  }

  const answer = answerMatch[1].trim();
  const kbMatch = text.match(/^KB:\s*(.+)/ms);
  const kbSnippet = kbMatch ? kbMatch[1].trim() : null;

  console.log(`[Telegram] Got reply for thread ${threadId}`);

  // Post answer to Discord (thread or text channel)
  if (discordClient) {
    try {
      const channel = await discordClient.channels.fetch(threadId);
      if (channel?.isTextBased?.() && typeof channel.send === 'function') {
        // Staff replies are pasted into Discord verbatim — suppress all
        // mention resolution so a stray @here / <@&role> cannot ping.
        await channel.send({ content: answer, allowedMentions: { parse: [] } });
        console.log(`[Telegram] Posted answer to ${threadId}`);
      }
    } catch (err) {
      console.error(`[Telegram] Failed to post to ${threadId}:`, err.message);
    }
  }

  // Save KB snippet if provided (needs DATABASE_URL)
  if (kbSnippet && process.env.DATABASE_URL) {
    const db = require('./db');
    await db.addKnowledge(kbSnippet);
    console.log('[Telegram] Saved knowledge snippet');
  }

  // Resolve escalation
  if (process.env.DATABASE_URL) {
    const db = require('./db');
    const escalation = await db.getPendingEscalation(threadId);
    if (escalation) {
      await db.resolveEscalation(escalation.id);
      console.log(`[Telegram] Resolved escalation #${escalation.id}`);
    }
  }
}

function startPolling() {
  if (pollTimer) return;
  if (!isReady()) {
    console.log('[Telegram] Not configured, polling skipped');
    return;
  }
  console.log('[Telegram] Polling started');

  async function tick() {
    await pollUpdates();
    pollTimer = setTimeout(tick, POLL_INTERVAL_MS);
  }
  tick();
}

function stopPolling() {
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
    console.log('[Telegram] Polling stopped');
  }
}

module.exports = {
  isReady,
  formatEscalationText,
  sendEscalation,
  startPolling,
  stopPolling,
  setDiscordClient,
  getBotUserId,
  isBotEscalationReply,
  handleUpdate,
};
