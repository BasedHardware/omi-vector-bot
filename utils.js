const { stripStaffLies, stripInventedLookup } = require('./honesty');

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
  const ms = 400 + Math.random() * 500;
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
  return stripInventedLookup(stripStaffLies(cleaned));
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

// Model output reaches message.reply() verbatim. Allow explicit <@id> user
// pings (see issue: Vector mentions should notify), but never everyone/here
// or role mentions — a crafted question must not turn Vector into a
// mass-ping or role-ping amplifier.
const SAFE_REPLY_MENTIONS = { parse: ['users'], roles: [], repliedUser: true };

function clipThreadHistory(entries, maxEach = 400, maxItems = 8) {
  return (entries || [])
    .map((m) => {
      const content = clipForDiscord(String(m.content || '').trim(), maxEach);
      if (!content) return null;
      return { author: m.author, content };
    })
    .filter(Boolean)
    .slice(-maxItems);
}

function clipForDiscord(text, max = DISCORD_REPLY_MAX) {
  const s = String(text || '').trim();
  if (s.length <= max) return s;
  return `${s.slice(0, Math.max(0, max - 1))}…`;
}

const ESCALATE_FOOTER =
  'A person on the team needs to take this. I have not pinged anyone yet.';

const PINGED_FOOTER = 'A person on the team has this now.';

const DUPLICATE_FOOTER =
  'A person on the team already has this. I have not sent another ping.';

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
  /person on the team has this now/i,
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
    if (duplicate && /already has this/i.test(body)) return body;
    return [body, footer].filter(Boolean).join('\n\n');
  }

  return [body, ESCALATE_FOOTER].filter(Boolean).join('\n\n');
}

module.exports = {
  isOnCooldown,
  markReplied,
  containsEscalationKeyword,
  shouldEscalate,
  typingDelay,
  sanitizeReply,
  formatDiscordReply,
  clipForDiscord,
  SAFE_REPLY_MENTIONS,
  clipThreadHistory,
  escalateReply,
  ESCALATE_FOOTER,
  PINGED_FOOTER,
  DUPLICATE_FOOTER,
  CONFIDENCE_THRESHOLD,
  needsHumanAccess,
  stripPingNarration: dropPingNarration,
};
