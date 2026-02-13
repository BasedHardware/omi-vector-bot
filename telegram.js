const axios = require('axios');
const db = require('./db');

const TOKEN = process.env.TELEGRAM_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const BASE = `https://api.telegram.org/bot${TOKEN}`;
const POLL_INTERVAL_MS = 3_000;

let offset = 0;
let pollTimer = null;
let discordClient = null;

function setDiscordClient(client) {
  discordClient = client;
}

async function sendEscalation({ threadId, userQuestion, botDraft, missingInfo }) {
  const text = [
    `Thread: ${threadId}`,
    `User asked: ${userQuestion}`,
    `Bot draft: ${botDraft}`,
    `Missing info: ${missingInfo}`,
  ].join('\n');

  await axios.post(`${BASE}/sendMessage`, {
    chat_id: CHAT_ID,
    text,
    parse_mode: 'HTML',
  });
}

async function pollUpdates() {
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

  // Check if this is a reply to an escalation message
  const replyTo = msg.reply_to_message?.text;
  if (!replyTo) return;

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

  // Post answer to Discord thread
  if (discordClient) {
    try {
      const channel = await discordClient.channels.fetch(threadId);
      if (channel?.isThread()) {
        await channel.send(answer);
        console.log(`[Telegram] Posted answer to thread ${threadId}`);
      }
    } catch (err) {
      console.error(`[Telegram] Failed to post to thread ${threadId}:`, err.message);
    }
  }

  // Save KB snippet if provided
  if (kbSnippet) {
    await db.addKnowledge(kbSnippet);
    console.log('[Telegram] Saved knowledge snippet');
  }

  // Resolve escalation
  const escalation = await db.getPendingEscalation(threadId);
  if (escalation) {
    await db.resolveEscalation(escalation.id);
    console.log(`[Telegram] Resolved escalation #${escalation.id}`);
  }
}

function startPolling() {
  if (pollTimer) return;
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
  sendEscalation,
  startPolling,
  stopPolling,
  setDiscordClient,
};
