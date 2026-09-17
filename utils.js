const { stripStaffLies } = require('./honesty');

const GREETINGS = [
  'Hey!',
  'Hi there!',
  'Hey, thanks for reaching out!',
  'Hi! Good question.',
  'Hey! Let me help with that.',
];

const ESCALATION_PATTERNS = [
  /\bbilling\b/i,
  /\brefunds?\b/i,
  /\bprivacy\b/i,
  /\bshipping\b/i,
  /\bcharged\b/i,
  /\binvoice\b/i,
  /\bpayment\b/i,
  /cancel subscription/i,
  /delete my data/i,
  /\bgdpr\b/i,
];

const CONFIDENCE_THRESHOLD = 0.72;
const COOLDOWN_MS = 60_000;

// thread_id -> timestamp of last reply
const lastReplyMap = new Map();

function isOnCooldown(threadId) {
  const last = lastReplyMap.get(threadId);
  if (!last) return false;
  return Date.now() - last < COOLDOWN_MS;
}

function markReplied(threadId) {
  lastReplyMap.set(threadId, Date.now());
}

// Prevent unbounded growth — prune entries older than 5 minutes every 2 minutes
setInterval(() => {
  const cutoff = Date.now() - 5 * 60_000;
  for (const [key, ts] of lastReplyMap) {
    if (ts < cutoff) lastReplyMap.delete(key);
  }
}, 2 * 60_000).unref();

function randomGreeting() {
  return GREETINGS[Math.floor(Math.random() * GREETINGS.length)];
}

function containsEscalationKeyword(text) {
  const s = String(text || '');
  return ESCALATION_PATTERNS.some((re) => re.test(s));
}

function shouldEscalate(aiResponse, userMessage) {
  if (aiResponse.confidence < CONFIDENCE_THRESHOLD) return true;
  if (aiResponse.escalate === true) return true;
  if (containsEscalationKeyword(userMessage)) return true;
  return false;
}

function typingDelay() {
  // 1–2 second delay to feel human
  const ms = 1000 + Math.random() * 1000;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizeReply(text) {
  return stripStaffLies(
    text.replace(/\bas an ai\b/gi, '').replace(/\s{2,}/g, ' ').trim()
  );
}

const DISCORD_REPLY_MAX = 1900;

function clipForDiscord(text, max = DISCORD_REPLY_MAX) {
  const s = String(text || '').trim();
  if (s.length <= max) return s;
  return `${s.slice(0, Math.max(0, max - 1))}…`;
}

const ESCALATE_FOOTER =
  'I have not pinged a human yet. A person on the team needs to take this.';

const ALREADY_SAID_NO_PING = [
  /have not (pinged|messaged|contacted|notified)/i,
  /noch niemanden/i,
];

function escalateReply(answer) {
  const body = String(answer || '').trim();
  if (ALREADY_SAID_NO_PING.some((re) => re.test(body))) return body;
  return `${body}\n\n${ESCALATE_FOOTER}`;
}

module.exports = {
  isOnCooldown,
  markReplied,
  randomGreeting,
  containsEscalationKeyword,
  shouldEscalate,
  typingDelay,
  sanitizeReply,
  clipForDiscord,
  escalateReply,
  ESCALATE_FOOTER,
  CONFIDENCE_THRESHOLD,
};
