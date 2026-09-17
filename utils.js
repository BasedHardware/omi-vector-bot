const { stripStaffLies } = require('./honesty');

const GREETINGS = [
  'Hey!',
  'Hi there!',
  'Hey, thanks for reaching out!',
  'Hi! Good question.',
  'Hey! Let me help with that.',
];

const ESCALATION_KEYWORDS = [
  'billing',
  'refund',
  'privacy',
  'shipping',
  'charge',
  'charged',
  'invoice',
  'payment',
  'cancel subscription',
  'delete my data',
  'gdpr',
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
  const lower = text.toLowerCase();
  return ESCALATION_KEYWORDS.some((kw) => lower.includes(kw));
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

module.exports = {
  isOnCooldown,
  markReplied,
  randomGreeting,
  containsEscalationKeyword,
  shouldEscalate,
  typingDelay,
  sanitizeReply,
  CONFIDENCE_THRESHOLD,
};
