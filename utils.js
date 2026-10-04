const { stripStaffLies, stripInventedLookup } = require('./honesty');
const { createHash } = require('node:crypto');

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

const claimedMessages = new Map();
const CLAIM_MS = 10 * 60_000;
const answeredText = new Map();
const ANSWER_REPEAT_MS = 10 * 60_000;

function answeredTextKey(channelId, authorId, text) {
  const normalized = String(text || '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
  if (!channelId || !authorId || !normalized) return '';
  const hash = createHash('sha256').update(normalized).digest('hex');
  return `${channelId}:${authorId}:${hash}`;
}

function wasRecentlyAnsweredText(channelId, authorId, text, now = Date.now()) {
  const key = answeredTextKey(channelId, authorId, text);
  const last = key && answeredText.get(key);
  return Boolean(last && now - last < ANSWER_REPEAT_MS);
}

function markAnsweredText(channelId, authorId, text, now = Date.now()) {
  const key = answeredTextKey(channelId, authorId, text);
  if (key) answeredText.set(key, now);
}

function claimMessage(id, now = Date.now()) {
  const key = String(id || '').trim();
  if (!key) return true;
  const prev = claimedMessages.get(key);
  if (prev && now - prev < CLAIM_MS) return false;
  claimedMessages.set(key, now);
  return true;
}

const answeringAskers = new Map();
const ANSWER_CLAIM_MS = 2 * 60_000;

function claimAsker(key, now = Date.now()) {
  const prev = answeringAskers.get(key);
  if (prev && now - prev < ANSWER_CLAIM_MS) return false;
  answeringAskers.set(key, now);
  return true;
}

function releaseAsker(key) {
  answeringAskers.delete(key);
}

function pruneTracked(now = Date.now()) {
  const replyCutoff = now - 5 * 60_000;
  const claimCutoff = now - CLAIM_MS;
  for (const [key, ts] of lastReplyMap) {
    if (ts < replyCutoff) lastReplyMap.delete(key);
  }
  for (const [key, ts] of claimedMessages) {
    if (ts < claimCutoff) claimedMessages.delete(key);
  }
  for (const [key, ts] of answeredText) {
    if (ts < now - ANSWER_REPEAT_MS) answeredText.delete(key);
  }
}

// Prevent unbounded growth. Claims last 10 minutes; reply cooldowns last 5.
setInterval(() => {
  pruneTracked();
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
    .replace(/\bas an ai\b(?!\s+(?:message|response|reply))\s*,?\s*/gi, '')
    .split('\n')
    .map((line) => line.replace(/[^\S\n]{2,}/g, ' ').trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return stripInventedLookup(stripStaffLies(cleaned));
}

function stripSupportRedirect(text) {
  return String(text || '')
    .split('\n')
    .map((line) =>
      line
        .split(/(?<=[.!?])\s+/)
        .filter(
          (sentence) =>
            !/\b(?:email|e-mail|contact|reach out to|write to)\b[^.!?]{0,80}\bhelp@omi\.me\b/i.test(sentence) &&
            !/^\s*(?:use\s+\/order\b|include (?:the )?order (?:number|#)|we email a code\b|keep (?:your|the) order number handy\b)/i.test(sentence)
        )
        .join(' ')
        .trim()
    )
    .filter(Boolean)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
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
const SAFE_REPLY_MENTIONS = { parse: [], users: [], roles: [], repliedUser: false };

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function mentionNamesForUser(user, member) {
  const names = [user?.username, user?.globalName, member?.nickname, member?.displayName]
    .map((name) => String(name || '').trim())
    .filter((name) => name.length >= 2 && !/\s/.test(name) && !/^everyone$|^here$/i.test(name));
  return [...new Set(names)].sort((a, b) => b.length - a.length);
}

function mentionablePeople(message) {
  const people = [];
  const seen = new Set();
  const add = (user, member) => {
    const id = String(user?.id || '');
    if (!/^\d{5,}$/.test(id) || seen.has(id)) return;
    seen.add(id);
    people.push({ id, names: mentionNamesForUser(user, member) });
  };
  add(message?.author, message?.member);
  return people;
}

// Discord only pings <@USER_ID>. Plain @username is decoration. Only rewrite
// people we already know (the author, or users they @'d) — never guild-scan.
function rewriteUserMentions(text, message) {
  let out = String(text || '');
  for (const person of mentionablePeople(message)) {
    for (const name of person.names) {
      const re = new RegExp(`(^|[^<\\w])@${escapeRegExp(name)}\\b`, 'gi');
      out = out.replace(re, `$1<@${person.id}>`);
    }
  }
  const authorId = String(message?.author?.id || '');
  out = out.replace(/<@!?(\d+)>/g, (token, id) => (id === authorId ? token : ''));
  return out.replace(/[^\S\n]{2,}/g, ' ').trim();
}

function replyMentions(message, { pingAuthor = false, repliedUser = false } = {}) {
  const users = [];
  const id = String(message?.author?.id || '');
  if (pingAuthor && /^\d{5,}$/.test(id)) users.push(id);
  return { parse: [], users, roles: [], repliedUser: Boolean(repliedUser) };
}

function isUnknownMessageRef(err) {
  const text = `${err?.message || ''} ${err?.code || ''} ${JSON.stringify(err?.rawError || {})}`;
  return /Unknown message|MESSAGE_REFERENCE_UNKNOWN_MESSAGE/i.test(text);
}

function wantsAuthorPing(text) {
  return /\bping me\b|\bmention me\b|\bnotify me\b|@yourdiscordname/i.test(String(text || ''));
}

function attachAuthorMention(text, message) {
  const id = String(message?.author?.id || '');
  if (!/^\d{5,}$/.test(id)) return String(text || '');
  const out = String(text || '');
  if (new RegExp(`<@!?${id}>`).test(out)) return out;
  return `<@${id}> ${out}`.trim();
}

function clipThreadHistory(entries, maxEach = 800, maxItems = 24) {
  const clipped = (entries || [])
    .map((m) => {
      const content = clipForDiscord(String(m.content || '').trim(), maxEach);
      if (!content) return null;
      return { author: m.author, content };
    })
    .filter(Boolean);
  if (clipped.length <= maxItems) return clipped;
  const openingCount = Math.min(2, Math.max(1, maxItems - 1));
  return [...clipped.slice(0, openingCount), ...clipped.slice(-(maxItems - openingCount))];
}

function clipForDiscord(text, max = DISCORD_REPLY_MAX) {
  const s = String(text || '').trim();
  if (s.length <= max) return s;
  return `${s.slice(0, Math.max(0, max - 1))}…`;
}

const ESCALATE_FOOTER =
  'A person on the team needs to take this. I have not pinged anyone yet.';
const FAILED_HANDOFF_FOOTER =
  'I could not deliver this to the support team from here. Please email help@omi.me with the details; do not post order or account information publicly.';

const PINGED_FOOTER = 'A person on the team has this now.';
const THREAD_REPLY_FOOTER = 'A person on the team has this now and will reply in this thread.';

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
  /person on the team/i,
  /going into your account/i,
  /can'?t send you a mention/i,
  /cannot send you a mention/i,
  /send you a mention myself/i,
  /i('m| am) passing on/i,
  /keep re-explaining/i,
  /needs a person who can look/i,
  /this one needs a person/i,
  /not sure what the (blue|red|orange|teal) (dot|light)/i,
  /sent this along/i,
  /passed this along/i,
  /passing it along/i,
  /needs the app side to look/i,
];

const ALREADY_SAID_PINGED = [
  /sent this to a person/i,
  /posted this to the team/i,
  /person on the team has this now/i,
];

function dropPingNarration(text) {
  return String(text || '')
    .replace(/\bi can('t|not) send you a mention( myself)?\b/gi, '')
    .replace(/\bi('m| am) passing on\b/gi, '')
    .replace(/\bi('m| am) passing it along( as-is)?\b/gi, '')
    .replace(/\byou don'?t need to keep re-explaining\b/gi, '')
    .split('\n')
    .map((line) => {
      if (!PING_NARRATION.some((re) => re.test(line))) return line;
      return line
        .split(/(?<=[.!?])\s+|\s+[—–]\s+/)
        .filter((sentence) => !PING_NARRATION.some((re) => re.test(sentence)))
        .join(' ');
    })
    .map((line) => line.replace(/^[,\s]+/, '').replace(/\s{2,}/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Claims that a bug is already fixed, solved, or shipped, plus improvised repair steps.
// "It has not shipped." stays — that sentence is the honest status.
// "I am not sure" / "Ich bin mir nicht sicher" stay — those are not a diagnosis.
// "Não tenho certeza." / "No estoy seguro." stay — they do not match the fix claims below.
// "I am sure" does not match "I am not sure": "not" sits between "am" and "sure".
// Recordings location and "firmware bug" stay in honesty.js.
const FALSE_CERTAINTY = [
  /\bhalf[-\s]+solved\b/i,
  /\balready\s+solved\b/i,
  /\balready\s+fixed\b/i,
  /\bthis\s+is\s+fixed\b/i,
  /\bthis\s+is\s+solved\b/i,
  /\bit(?:['’]s|\s+is)\s+fixed\b/i,
  /\bit(?:['’]s|\s+is)\s+solved\b/i,
  /\b(?:bug|issue|problem)\s+is\s+(?:fixed|solved)\b/i,
  /\bhas\s+been\s+fixed\b/i,
  /\bhas\s+been\s+solved\b/i,
  /\bjá\s+foi\s+corrigido\b/i,
  /\bjá\s+está\s+resolvido\b/i,
  /\bya\s+está\s+arreglado\b/i,
  /\besto\s+está\s+solucionado\b/i,
  /\bschon\s+behoben\b/i,
  /\bbereits\s+gelöst\b/i,
  /\b(?:do\s+not|don['’]?t)\s+keep\s+turning\s+it\s+on\b/i,
  /\bset\s+it\s+aside\b/i,
  /\bleave\s+it\s+as\s+it\s+is\b/i,
  /\bstop\s+turning\s+it\s+on\b/i,
  /\bI(?:['’]m|\s+am)\s+sure\b/i,
  /\bthis\s+will\s+fix\s+it\b/i,
];

function claimsBugShipped(sentence) {
  const s = String(sentence || '')
    .replace(/\b(?:not|never|cannot)(?:\s+\w+){0,3}\s+shipped\b/gi, '')
    .replace(/n['’]t(?:\s+\w+){0,3}\s+shipped\b/gi, '');
  return /\bshipped\b/i.test(s);
}

function isHonestUncertainty(sentence) {
  const s = String(sentence || '');
  return /\bI(?:['’]m|\s+am)\s+not\s+sure\b/i.test(s) || /\bnicht\s+sicher\b/i.test(s);
}

// "kein bekannter Fix" is the negation. Drop only when a positive known-fix claim remains.
function claimsKnownFix(sentence) {
  const s = String(sentence || '')
    .replace(/\bno\s+known\s+fix\b/gi, ' ')
    .replace(/\bkein(?:e[mnrs]?)?\s+bekannt(?:e[rsn]?)?\s+fix(?:es|e)?\b/gi, ' ');
  return /\bknown\s+fix\b/i.test(s) || /\bbekannt(?:e[rsn]?)?\s+fix(?:es|e)?\b/i.test(s);
}

function looksLikeFalseCertainty(sentence) {
  const s = String(sentence || '');
  if (FALSE_CERTAINTY.some((re) => re.test(s))) return true;
  if (claimsBugShipped(s)) return true;
  if (claimsKnownFix(s)) return true;
  if (isHonestUncertainty(s)) return false;
  if (/\bthe\s+cause\s+is\b/i.test(s)) return true;
  return /\bno\s+known\s+fix\b/i.test(s);
}

function stripFalseCertainty(text) {
  return String(text || '')
    .split('\n')
    .map((line) =>
      line
        .split(/(?<=[.!?])\s+|\s+[—–]\s+/)
        .filter((sentence) => sentence.trim() && !looksLikeFalseCertainty(sentence))
        .join(' ')
    )
    .map((line) => line.replace(/^[,\s]+/, '').replace(/\s{2,}/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const ISSUE_FOOTER = 'The problem is written in this thread. Keep talking here — you do not need to ping anyone.';

function escalateReply(answer, opts = {}) {
  const pinged = Boolean(opts.pinged);
  const duplicate = Boolean(opts.duplicate);
  const footers = opts.footers;
  let body = dropPingNarration(String(answer || '').trim());

  if (opts.deliveryFailed) {
    body = stripSupportRedirect(body);
    return [body, footers?.failed || FAILED_HANDOFF_FOOTER].filter(Boolean).join('\n\n');
  }

  if (pinged && opts.replyInThread) {
    return [body, footers?.thread || THREAD_REPLY_FOOTER].filter(Boolean).join('\n\n');
  }

  if (opts.conversation) {
    return body;
  }

  if (opts.issue && !opts.pingAuthor) {
    if (/written (up|in this thread)/i.test(body)) return body;
    return [body, footers?.issue || ISSUE_FOOTER].filter(Boolean).join('\n\n');
  }

  if (pinged) {
    const footer = duplicate
      ? (footers?.duplicate || DUPLICATE_FOOTER)
      : (footers?.sent || PINGED_FOOTER);
    if (!duplicate && ALREADY_SAID_PINGED.some((re) => re.test(body))) return body;
    if (duplicate && /already has this/i.test(body)) return body;
    return [body, footer].filter(Boolean).join('\n\n');
  }

  if (opts.pingAuthor) return body;

  return [body, footers?.pending || ESCALATE_FOOTER].filter(Boolean).join('\n\n');
}

module.exports = {
  isOnCooldown,
  markReplied,
  wasRecentlyAnsweredText,
  markAnsweredText,
  claimMessage,
  claimAsker,
  releaseAsker,
  pruneTracked,
  containsEscalationKeyword,
  shouldEscalate,
  typingDelay,
  sanitizeReply,
  stripSupportRedirect,
  formatDiscordReply,
  clipForDiscord,
  SAFE_REPLY_MENTIONS,
  rewriteUserMentions,
  wantsAuthorPing,
  attachAuthorMention,
  replyMentions,
  isUnknownMessageRef,
  clipThreadHistory,
  escalateReply,
  ESCALATE_FOOTER,
  PINGED_FOOTER,
  DUPLICATE_FOOTER,
  ISSUE_FOOTER,
  CONFIDENCE_THRESHOLD,
  needsHumanAccess,
  stripPingNarration: dropPingNarration,
  stripFalseCertainty,
};
