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

// Things Vector cannot see or change. Do not bluff — hand off.
const ACCESS_GAP_PATTERNS = [
  /\border\s*(#|number|id|status|num)\b/i,
  /\b(my|the)\s+order\b/i,
  /\btracking\b/i,
  /\bfirmware\b/i,
  /\brma\b/i,
  /\bwarehouse\b/i,
  /\bcustoms\b/i,
  /\bproduction logs?\b/i,
  /\bserver logs?\b/i,
  /\bserial( number)?\b/i,
  /\breplacement (device|unit|omi)\b/i,
  /\bdelete my (account|data)\b/i,
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

function needsHumanAccess(text) {
  const s = String(text || '');
  return ACCESS_GAP_PATTERNS.some((re) => re.test(s));
}

function shouldEscalate(aiResponse, userMessage) {
  if (aiResponse.confidence < CONFIDENCE_THRESHOLD) return true;
  if (aiResponse.escalate === true) return true;
  if (containsEscalationKeyword(userMessage)) return true;
  if (needsHumanAccess(userMessage)) return true;
  return false;
}

function typingDelay() {
  // 1–2 second delay to feel human
  const ms = 1000 + Math.random() * 1000;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizeReply(text) {
  const cleaned = String(text || '')
    .replace(/\bas an ai\b/gi, '')
    .split('\n')
    .map((line) => line.replace(/[^\S\n]{2,}/g, ' ').trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return stripStaffLies(cleaned);
}

function expandPipeLists(text) {
  return String(text || '')
    .split('\n')
    .flatMap((line) => {
      if (!/=/.test(line) || !/\s\|\s/.test(line)) return [line];
      const items = line
        .split(/\s*\|\s*/)
        .map((part) => part.replace(/^[-*]\s+/, '').trim())
        .filter(Boolean);
      if (items.length < 2) return [line];

      const first = items[0];
      const labeled = first.match(/^(.*?:\s*)(.+?\s*=\s*.+)$/);
      const rest = items.slice(1).map((item) => `- ${item}`);
      if (labeled) {
        const intro = labeled[1].trim();
        const bullets = [`- ${labeled[2].trim()}`, ...rest];
        return intro ? [intro, ...bullets] : bullets;
      }
      return items.map((item) => `- ${item}`);
    })
    .join('\n');
}

function formatDiscordReply(text) {
  return expandPipeLists(String(text || '').trim())
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const DISCORD_REPLY_MAX = 1900;

function clipForDiscord(text, max = DISCORD_REPLY_MAX) {
  const s = String(text || '').trim();
  if (s.length <= max) return s;
  return `${s.slice(0, Math.max(0, max - 1))}…`;
}

const ESCALATE_FOOTER =
  'I have not pinged a human yet. A person on the team needs to take this.';

const PINGED_FOOTER =
  'I sent this to a person on the team. I cannot see orders, warehouse, or production logs myself.';

const DUPLICATE_FOOTER =
  'This is still with a person from earlier. I have not sent a second ping.';

const PING_NARRATION = [
  /have not (pinged|messaged|contacted|notified)/i,
  /noch niemanden/i,
  /not able to ping/i,
  /can'?t ping/i,
  /cannot ping/i,
  /won'?t tell you i (did|pinged)/i,
  /will not tell you i (did|pinged)/i,
  /ping anyone myself/i,
  /handoff happens/i,
  /flagging this/i,
  /i('m| am) not able to ping/i,
];

const ALREADY_SAID_PINGED = [
  /sent this to a person/i,
  /posted this to the team/i,
];

function dropPingNarration(text) {
  return String(text || '')
    .split('\n')
    .map((line) => {
      if (!PING_NARRATION.some((re) => re.test(line))) return line;
      return line
        .split(/(?<=[.!?])\s+/)
        .filter((sentence) => !PING_NARRATION.some((re) => re.test(sentence)))
        .join(' ');
    })
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function escalateReply(answer, opts = {}) {
  const pinged = Boolean(opts.pinged);
  const duplicate = Boolean(opts.duplicate);
  let body = dropPingNarration(String(answer || '').trim());

  if (pinged) {
    const footer = duplicate ? DUPLICATE_FOOTER : PINGED_FOOTER;
    if (!duplicate && ALREADY_SAID_PINGED.some((re) => re.test(body))) return body;
    if (duplicate && /still with a person/i.test(body)) return body;
    return [body, footer].filter(Boolean).join('\n\n');
  }

  return [body, ESCALATE_FOOTER].filter(Boolean).join('\n\n');
}

module.exports = {
  isOnCooldown,
  markReplied,
  randomGreeting,
  containsEscalationKeyword,
  shouldEscalate,
  typingDelay,
  sanitizeReply,
  formatDiscordReply,
  clipForDiscord,
  escalateReply,
  ESCALATE_FOOTER,
  PINGED_FOOTER,
  DUPLICATE_FOOTER,
  CONFIDENCE_THRESHOLD,
  needsHumanAccess,
};
