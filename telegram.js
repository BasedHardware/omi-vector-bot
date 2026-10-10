const axios = require('axios');
const knowledge = require('./knowledge');
const supportCases = require('./supportCases');

const TOKEN = process.env.TELEGRAM_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const BASE = TOKEN ? `https://api.telegram.org/bot${TOKEN}` : '';
const POLL_INTERVAL_MS = 3_000;
const TELEGRAM_MAX = 3500;

let offset = 0;
let pollTimer = null;
let polling = false;
let activePoll = null;
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

function formatEscalationText({ threadId, caseId, userQuestion, botDraft, missingInfo, jumpUrl }) {
  const lines = [
    `Thread: ${threadId || '(unknown)'}`,
    caseId ? `Case: ${caseId}` : '',
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

async function handleUpdate(update, options = {}) {
  const msg = update.message;
  if (!msg?.text) return;

  // Only process messages from the configured chat
  if (String(msg.chat.id) !== String(CHAT_ID)) return;

  const text = msg.text.trim();

  // Check if this is a reply to an escalation message this bot sent
  let myId;
  try {
    myId = await (options.getBotUserId || getBotUserId)();
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
  if (!answer) return;
  const kbMatch = text.match(/^KB:\s*(.+)/ms);
  const kbSnippet = kbMatch ? kbMatch[1].trim() : null;

  console.log(`[Telegram] Got reply for thread ${threadId}`);

  const cases = options.cases || supportCases;
  const database = options.db || (process.env.DATABASE_URL ? require('./db') : null);
  let storedCase;
  try {
    const caseId = replyTo.match(/^Case:\s*(\S+)/m)?.[1];
    storedCase = caseId ? await cases.getCaseById(caseId) : await cases.getCaseByThread(threadId);
    if (caseId && (!storedCase || ![storedCase.channelId, storedCase.customerThreadId, storedCase.handoffThreadId].includes(threadId))) return;
  } catch (err) {
    console.error('[Telegram] case lookup failed:', err.name);
    return;
  }
  // Post answer to Discord (thread or text channel). A successful staff reply
  // fetch is not customer delivery; keep the case pending on any send failure.
  let delivered = false;
  let deliveryId;
  let isDedicatedThread = false;
  const client = options.discordClient || discordClient;
  if (client) {
    try {
      const channel = await client.channels.fetch(threadId);
      isDedicatedThread = Boolean(channel?.isThread?.());
      if (channel?.isTextBased?.() && typeof channel.send === 'function') {
        // Staff replies are pasted into Discord verbatim — suppress all
        // mention resolution so a stray @here / <@&role> cannot ping.
        const sent = await channel.send({ content: answer, allowedMentions: { parse: [] } });
        delivered = true;
        deliveryId = sent?.id;
        console.log(`[Telegram] Posted answer to ${threadId}`);
      }
    } catch (err) {
      console.error(`[Telegram] Failed to post to ${threadId}:`, err.message);
    }
  }
  if (!delivered) return;

  // Use the same reviewed, in-memory staff-note path as Discord `faq:`.
  // Legacy database notes have no provenance and are not read by the bot.
  if (kbSnippet) {
    const saved = knowledge.addSnippet(kbSnippet);
    if (saved.ok) console.log('[Telegram] Saved in-memory knowledge snippet');
    else console.log(`[Telegram] Rejected knowledge snippet (${saved.reason})`);
  }

  // Resolve escalation
  if (storedCase) {
    await cases.resolveCase(storedCase.id, { deliveryId, confirmed: true });
  }
  if (database) {
    // Legacy records have no customer ownership. Only a dedicated thread can
    // safely resolve one by thread; shared channels require an exact case link.
    const escalation = !storedCase?.escalationId && isDedicatedThread ? await database.getPendingEscalation(threadId) : null;
    const escalationId = storedCase?.escalationId || escalation?.id;
    if (escalationId) {
      await database.resolveEscalation(escalationId);
      console.log(`[Telegram] Resolved escalation #${escalationId}`);
    }
  }
}

function startPolling({ poll = pollUpdates, intervalMs = POLL_INTERVAL_MS, schedule = setTimeout } = {}) {
  if (polling) return activePoll;
  if (!isReady()) {
    console.log('[Telegram] Not configured, polling skipped');
    return;
  }
  polling = true;
  console.log('[Telegram] Polling started');
  if (activePoll) return activePoll;

  function tick() {
    if (!polling) return Promise.resolve();
    const task = Promise.resolve().then(poll).catch((err) => {
      console.error('[Telegram] active poll failed:', err.name);
    }).finally(() => {
      if (activePoll === task) activePoll = null;
      // Shutdown may have started during getUpdates or a Discord send.
      if (polling) pollTimer = schedule(() => { pollTimer = null; tick(); }, intervalMs);
    });
    activePoll = task;
    return task;
  }
  return tick();
}

function stopPolling() {
  polling = false;
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
    console.log('[Telegram] Polling stopped');
  }
  return activePoll || Promise.resolve();
}

async function drainPolling(timeoutMs = 90_000) {
  const pending = stopPolling();
  let timer;
  try {
    return await Promise.race([
      pending.then(() => true),
      new Promise((resolve) => { timer = setTimeout(() => resolve(false), timeoutMs); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  isReady,
  formatEscalationText,
  sendEscalation,
  startPolling,
  stopPolling,
  drainPolling,
  setDiscordClient,
  getBotUserId,
  isBotEscalationReply,
  handleUpdate,
};
