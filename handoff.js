const telegram = require('./telegram');
const { ChannelType } = require('discord.js');
const { clipForDiscord, stripPingNarration } = require('./utils');
const { redactSensitive } = require('./privacy');
const {
  classify,
  pickStaffReason,
  looksLikeCaptureFailure,
  looksLikeTranscription,
  looksLikeShippingQuote,
  specialistNames,
} = require('./router');

const DEDUPE_MS = 15 * 60_000;
const lastHandoff = new Map();
const { assertCurrentOwnership, isLeaseLost } = require('./supportRuntime');

function staffMentionIds() {
  const users = String(process.env.STAFF_USER_IDS || '')
    .split(',')
    .map((id) => id.trim())
    .filter((id) => /^\d{5,}$/.test(id));
  const role = String(process.env.STAFF_ROLE_ID || '').trim();
  const roles = /^\d{5,}$/.test(role) ? [role] : [];
  return { users, roles };
}

function staffMentions() {
  const { users, roles } = staffMentionIds();
  return [...users.map((id) => `<@${id}>`), ...roles.map((id) => `<@&${id}>`)].join(' ');
}

function isTestHandoffChannel(channel) {
  const testId = process.env.VECTOR_TEST_CHANNEL_ID;
  if (!testId || !channel) return false;
  if (channel.id === testId) return true;
  return Boolean(channel.isThread?.() && channel.parentId === testId);
}

function isHelpForumThread(channel) {
  const id = String(process.env.HELP_FORUM_CHANNEL_ID || '').trim();
  if (!id || !channel) return false;
  return Boolean(channel.isThread?.() && String(channel.parentId || '') === id);
}

function isForumPostThread(channel) {
  if (!channel?.isThread?.()) return false;
  if (Number(channel.parent?.type) === 15) return true;
  return isHelpForumThread(channel);
}

function isCloseableThread(channel) {
  return isHandoffThread(channel) || isForumPostThread(channel);
}

function hasThreadManage(interaction) {
  const perms = interaction?.memberPermissions || interaction?.member?.permissions;
  if (!perms || typeof perms.has !== 'function') return false;
  try {
    return perms.has('ManageThreads', true) || perms.has('Administrator', true);
  } catch {
    return false;
  }
}

function canStaffAct(interaction) {
  const userId = String(interaction?.user?.id || '');
  const { users, roles } = staffMentionIds();
  if (users.includes(userId)) return true;
  const cache = interaction?.member?.roles?.cache;
  if (roles.length && cache) {
    if (typeof cache.has === 'function' && roles.some((id) => cache.has(id))) return true;
    if (typeof cache.includes === 'function' && roles.some((id) => cache.includes(id))) return true;
  }
  if (hasThreadManage(interaction)) return true;
  if (!users.length && !roles.length && isTestHandoffChannel(interaction?.channel)) {
    return true;
  }
  return false;
}

function canNotifyStaff({ discordReady = false } = {}) {
  if (discordReady && process.env.STAFF_ALERT_CHANNEL_ID) return true;
  return telegram.isReady();
}

function handoffKey(channelId, userId) {
  return `${String(channelId || '')}:${String(userId || '')}`;
}

function recentlyHandedOff(channelId, userId) {
  const prev = lastHandoff.get(handoffKey(channelId, userId));
  return Boolean(prev && prev.ok && Date.now() - prev.at < DEDUPE_MS);
}

function markHandedOff(channelId, userId, ok) {
  lastHandoff.set(handoffKey(channelId, userId), { ok: Boolean(ok), at: Date.now() });
}

function resetHandoffMemory() {
  lastHandoff.clear();
}

function isDiscordPasteChrome(line) {
  const t = String(line || '').trim();
  if (!t) return true;
  if (/^op$/i.test(t)) return true;
  if (/^image$/i.test(t)) return true;
  if (/^(—\s*)?(yesterday|today)\s+at\s+\d{1,2}:\d{2}/i.test(t)) return true;
  if (/^—\s*\d{1,2}:\d{2}\b/.test(t)) return true;
  if (/^—?\s*\d{1,2}[/.]\d{1,2}[/.]\d{2,4}([, T]\s*\d{1,2}:\d{2})?/i.test(t)) return true;
  if (/^[A-Z][A-Za-z]+(\s+[A-Z][A-Za-z]+)+,?\s*$/.test(t) && t.split(/\s+/).length <= 4) {
    return true;
  }
  if (/\[[A-Za-z0-9_]{2,16}\]/.test(t) && t.length <= 88 && t.split(/\s+/).length <= 14) {
    return true;
  }
  return false;
}

function isSingleDisplayName(line) {
  return /^[A-Z][A-Za-z]{1,20}$/.test(String(line || '').trim());
}

function clipUserQuestion(text) {
  const raw = String(text || '').trim();
  const lines = raw.split('\n').map((line) => line.replace(/\\+\s*$/g, ''));
  const hasQuestion = lines.some((line) => {
    const t = line.trim();
    return t && !isDiscordPasteChrome(t) && !isSingleDisplayName(t);
  });
  const kept = [];
  for (const line of lines) {
    const t = line.trim();
    if (/^@[\w.]+/.test(t) && kept.some((k) => k.trim())) break;
    if (/^want:\s/i.test(t) || isDiscordPasteChrome(line)) continue;
    if (hasQuestion && isSingleDisplayName(t)) continue;
    kept.push(line);
  }
  const cleaned = kept
    .join('\n')
    .replace(/\bping me as\s+@\S+/gi, '')
    .replace(/@yourdiscordname/gi, '')
    .replace(/\bso i know you got this\.?/gi, '')
    .replace(/\bping me\b[^.?!]*[.?!]?/gi, '')
    .replace(/[^\S\n]{2,}/g, ' ')
    .replace(/\s+\./g, '.')
    .trim();
  return clipForDiscord(cleaned || raw, 1000);
}

function significantWords(text) {
  const stop = new Set([
    'handoff',
    'still',
    'after',
    'from',
    'this',
    'that',
    'have',
    'with',
    'ping',
    'please',
    'your',
    'know',
    'into',
    'they',
    'them',
    'then',
    'than',
    'just',
    'want',
    'even',
    'though',
    'says',
    'today',
    'showing',
  ]);
  return String(text || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 3 && !stop.has(word));
}

const GENERIC_OVERLAP = new Set([
  'missing',
  'recordings',
  'recording',
  'clips',
  'phone',
  'device',
  'light',
  'disconnected',
  'offline',
  'problem',
  'error',
  'issue',
]);

const SURFACE = /\b(watch|iphone|android|ios|macos|windows|desktop)\b/i;

function handoffSubject(threadName) {
  const parts = String(threadName || '')
    .split(' · ')
    .map((part) => part.trim())
    .filter(Boolean);
  if (!/^handoff$/i.test(parts[0] || '')) return '';
  const labels = new Set([
    'app',
    'tech',
    'shop',
    'money',
    'desktop',
    'firmware',
    'privacy',
    'account',
    'faq',
    'needs-human',
    'shipping',
  ]);
  return parts
    .slice(1)
    .filter((part) => !labels.has(part.toLowerCase()))
    .join(' · ');
}

function isGenericTopic(text) {
  return /^(phone app|computer app|app bug|device problem|order|needs a person|refund or charge|how-to|privacy)$/i.test(
    String(text || '').trim()
  );
}

function shouldReuseOpenHandoff(channel) {
  if (!channel) return false;
  if (isHandoffThread(channel)) return false;
  const testId = String(process.env.VECTOR_TEST_CHANNEL_ID || '').trim();
  if (!testId) return true;
  if (String(channel.id) === testId) return false;
  if (String(channel.parentId || channel.parent_id || '') === testId) return false;
  return true;
}

function isWeakerHandoffName(nextName, currentName) {
  if (!/^Handoff\b/i.test(String(currentName || ''))) return false;
  if (/^Handoff · needs-human\b/i.test(nextName) && !/^Handoff · needs-human\b/i.test(currentName)) return true;
  const next = handoffSubject(nextName);
  const current = handoffSubject(currentName);
  if (!current) return false;
  return isGenericTopic(next) && !isGenericTopic(current);
}

function isSameHandoff(threadName, { question, topic } = {}) {
  if (!/^Handoff\b/i.test(String(threadName || ''))) return false;
  const subject = handoffSubject(threadName);
  const sub = significantWords(subject);
  if (sub.length < 2) return false;
  const asked = `${question || ''} ${topic || ''}`;
  const surface = subject.match(SURFACE);
  if (surface && !SURFACE.test(asked)) return false;
  if (surface && !new RegExp(`\\b${surface[1]}\\b`, 'i').test(asked)) return false;
  const hay = new Set(significantWords(asked));
  const overlap = sub.filter((word) => hay.has(word));
  if (overlap.length < 2) return false;
  const core = sub.filter((word) => !SURFACE.test(word));
  if (core.length >= 2 && core.filter((word) => hay.has(word)).length < 2) return false;
  return overlap.some((word) => !GENERIC_OVERLAP.has(word));
}

const rememberedHandoffs = new Map();

function rememberOpenHandoff(parentId, userId, thread) {
  if (!parentId || !userId || !thread?.id) return;
  const key = `${parentId}:${userId}`;
  const rest = (rememberedHandoffs.get(key) || []).filter((item) => item.id !== thread.id);
  rememberedHandoffs.set(
    key,
    [{ id: thread.id, name: thread.name, thread, at: Date.now() }, ...rest].slice(0, 12)
  );
}

const closedHandoffs = new Set();

function forgetOpenHandoff(thread) {
  const id = String(thread?.id || '');
  for (const [key, list] of rememberedHandoffs) {
    rememberedHandoffs.set(key, list.filter((item) => String(item.id) !== id));
  }
}

function markHandoffReopened(thread) {
  closedHandoffs.delete(String(thread?.id || ''));
}

function markHandoffClosed(thread) {
  if (!thread?.id) return;
  closedHandoffs.add(String(thread.id));
  forgetOpenHandoff(thread);
  const parent = String(thread.parentId || '');
  for (const key of [...lastHandoff.keys()]) {
    if (parent && (key === parent || key.startsWith(`${parent}:`))) lastHandoff.delete(key);
  }
}

function isClosedHandoff(thread) {
  return Boolean(thread?.archived || thread?.locked || closedHandoffs.has(String(thread?.id)));
}

function recallOpenHandoff(parentId, userId, hint) {
  const list = rememberedHandoffs.get(`${parentId}:${userId}`) || [];
  const hit = list.find((item) => isSameHandoff(item.name, hint));
  return hit?.thread || null;
}

async function threadBelongsToUser(thread, userId) {
  if (!thread || !userId) return false;
  try {
    if (typeof thread.fetchStarterMessage === 'function') {
      const starter = await thread.fetchStarterMessage();
      if (String(starter?.author?.id || '') === String(userId)) return true;
    }
  } catch {
    // Starter can be missing on old threads; fall through to members.
  }
  try {
    const cached = thread.members?.cache;
    if (cached && typeof cached.has === 'function' && cached.has(userId)) return true;
    const members = await thread.members?.fetch?.();
    if (members && typeof members.has === 'function' && members.has(userId)) return true;
  } catch {
    return false;
  }
  return false;
}

async function findOpenHandoff(channel, { userId, question, topic } = {}) {
  const parent = channel?.isThread?.() ? channel.parent : channel;
  const parentId = parent?.id || channel?.id;
  const hint = { question, topic };
  const remembered = recallOpenHandoff(parentId, userId, hint);
  if (remembered && !isClosedHandoff(remembered)) return remembered;
  if (!parent?.threads?.fetchActive || !userId) return null;
  let active;
  try {
    active = await parent.threads.fetchActive();
  } catch {
    return null;
  }
  const threads = active?.threads;
  if (!threads || typeof threads.values !== 'function') return null;
  for (const thread of threads.values()) {
    if (isClosedHandoff(thread)) continue;
    if (!isSameHandoff(thread.name, hint)) continue;
    if (await threadBelongsToUser(thread, userId)) {
      rememberOpenHandoff(parentId, userId, thread);
      return thread;
    }
  }
  return null;
}

function resolveRoute({ area, lane, question } = {}) {
  const inferred = question ? classify(question) : { area: 'unknown', lane: 'unknown' };
  const inferredWins = inferred.area !== 'unknown' && (!area || area === 'unknown');
  const resolvedArea = inferredWins ? inferred.area : area && area !== 'unknown' ? area : inferred.area;
  const resolvedLane = inferredWins
    ? inferred.lane
    : lane && lane !== 'unknown'
      ? lane
      : inferred.lane;
  return {
    area: resolvedArea || 'unknown',
    lane: resolvedLane || 'unknown',
  };
}

function defaultTopic(area, lane) {
  if (lane === 'account') return 'fair use and plans';
  if (lane === 'money') return 'refund or charge';
  if (lane === 'shop') return 'order';
  if (lane === 'firmware' || area === 'firmware') return 'device problem';
  if (area === 'desktop') return 'computer app';
  if (area === 'app') return 'phone app';
  if (lane === 'privacy') return 'privacy';
  if (lane === 'faq') return 'how-to';
  if (lane === 'tech') return 'app bug';
  return 'needs a person';
}

function ticketLabels({ area, lane, question } = {}) {
  const resolved = resolveRoute({ area, lane, question });
  const labels = [];
  if (resolved.area && resolved.area !== 'unknown') labels.push(String(resolved.area));
  if (resolved.lane && resolved.lane !== 'unknown' && !labels.includes(String(resolved.lane))) {
    labels.push(String(resolved.lane));
  }
  const q = String(question || '');
  if (
    (resolved.area === 'shop' ||
      resolved.lane === 'shop' ||
      resolved.lane === 'money' ||
      resolved.lane === 'account') &&
    /\b(taxes?|duties|customs|refunds?|payment)\b/i.test(q) &&
    !labels.includes('money')
  ) {
    labels.push('money');
  }
  if (!labels.length) labels.push('needs-human');
  return labels;
}

function staffDetailsRequest(route, question) {
  const text = String(question || '');
  if (route.area === 'privacy' || route.lane === 'privacy') {
    return 'If they did not provide the account email, ask for it privately.';
  }
  if (/\b(?:bulk|wholesale|sales|business|enterprise|company|corporate|\d+\s+(?:units|devices|omis))\b/i.test(text) &&
      (route.area === 'shop' || route.lane === 'shop')) {
    return 'If they did not provide the company and quantity, ask for both.';
  }
  if (route.lane === 'money' || route.lane === 'account' ||
      /\b(?:refund|charg(?:e|ed)|bill(?:ing)?|payment|purchase|subscription|invoice)\b/i.test(text)) {
    return 'If they did not provide the purchase email, ask for it privately.';
  }
  if (route.area === 'shop' || route.lane === 'shop') {
    if (looksLikeShippingQuote(text)) return 'Ask for the checkout destination and quoted shipping cost, not private address details.';
    return 'If they did not provide the order number and the delivery date tracking shows, ask for both.';
  }
  if (['app', 'desktop', 'firmware'].includes(route.area) || route.lane === 'tech') {
    return 'If they did not name the device and the app version, ask for both.';
  }
  return 'Ask what they need help with and which Omi product is involved.';
}

function isThreadNoise(line) {
  const part = String(line || '').trim();
  if (!part || part.length < 8) return true;
  if (/^want:\s/i.test(part) || /^chatgpt/i.test(part)) return true;
  if (/^e abaixo/i.test(part)) return true;
  if (/^[A-Z0-9 ,/|:.—–-]{3,60}$/.test(part) && part === part.toUpperCase()) return true;
  if (/^[A-Z]{2,} — /.test(part) && part.length < 48) return true;
  if (/^["“]/.test(part) && !/\border\s*#/i.test(part)) return true;
  if (/^(hi|hello|hey)[,!.\s]/i.test(part) && !/\?/.test(part)) return true;
  if (/nintendo kid|lost that enthusiasm/i.test(part)) return true;
  if (/just got .{0,80}(in the mail|my omi)/i.test(part) && !/fair[- ]use|turns? off|crash/i.test(part)) {
    return true;
  }
  if (/^i('m| am) getting this error\b/i.test(part) && part.length < 90) return true;
  return false;
}

function threadTopic(question, route = {}) {
  const raw = String(question || '');
  if (looksLikeCaptureFailure(raw) && looksLikeTranscription(raw)) {
    return 'Transcription unavailable, device not capturing';
  }
  if (looksLikeShippingQuote(raw)) {
    return 'checkout shipping quote';
  }
  const numbered = raw.match(/\border\s*#\s*(\d{3,})\b/i) || raw.match(/#\s*(\d{3,})\b/);
  if (/\b((import\s+)?tax(es)?|duties)\b/i.test(raw)) {
    return numbered ? `import tax on order #${numbered[1]}` : 'import tax or duties';
  }
  if (/\bcustoms\b/i.test(raw)) {
    return numbered ? `customs on order #${numbered[1]}` : 'stuck in customs';
  }
  if (numbered && (/\border\b/i.test(raw) || route?.lane === 'shop' || route?.area === 'shop')) {
    return `Order #${numbered[1]}`;
  }
  const pack = raw.match(/\b(omi-windows|omi-desktop)\b/i);
  const code = raw.match(/\b(ERESOLVE|EPERM|ENOENT)\b/);
  if (pack && code) return `${pack[1]} ${code[1]}`;
  if (pack) return pack[1];
  const secs = raw.match(/after\s+(\d+)\s*seconds?/i);
  if (/turning itself off|turns? itself off|keeps turning (itself )?off/i.test(raw)) {
    return secs ? `device off after ${secs[1]}s` : 'device turns itself off';
  }
  if (/fair[- ]use/i.test(raw)) {
    return /plan|memory/i.test(raw) ? 'fair use and plans' : 'fair use warning';
  }
  if (/\bapple watch\b/i.test(raw) && /\b(missing|didn'?t sync|sync)\b/i.test(raw)) {
    return 'Apple Watch recordings missing from app';
  }
  if (
    /\b(blue|red|teal|orange)\b/i.test(raw) &&
    /\b(light|dot|led)\b/i.test(raw) &&
    /\b(disconnected|offline)\b/i.test(raw)
  ) {
    return 'app offline while blue light on';
  }
  if (/\biphone\b/i.test(raw) && /\bdisconnected\b/i.test(raw)) {
    return 'iPhone app disconnected';
  }
  const line = raw
    .split('\n')
    .map((part) => part.trim())
    .filter((part) => !isThreadNoise(part))
    .find((part) => part.length > 12 && part.length <= 70);
  if (line) return clipForDiscord(line.replace(/["*_`]/g, ''), 70);
  const resolved = resolveRoute({ area: route.area, lane: route.lane, question });
  return defaultTopic(resolved.area, resolved.lane);
}

function handoffThreadName({ question, area, lane, topic, labels } = {}) {
  const resolved = resolveRoute({ area, lane, question });
  const tag = (Array.isArray(labels) && labels.length
    ? labels.map((label) => String(label).trim()).filter(Boolean)
    : ticketLabels({ area: resolved.area, lane: resolved.lane, question })
  ).filter((label) => label !== 'needs-human');
  if (!tag.length) tag.push('needs-human');
  const subject = String(topic || '').trim() || threadTopic(question, resolved);
  const parts = tag.includes(subject.toLowerCase()) ? tag : [...tag, subject];
  return clipForDiscord(redactSensitive(`Handoff · ${parts.join(' · ')}`, { issue: true }), 100);
}

async function applyThreadName(thread, meta = {}) {
  if (!thread || typeof thread.setName !== 'function') return false;
  const name = handoffThreadName(meta);
  if (!name || thread.name === name) return false;
  if (isWeakerHandoffName(name, thread.name)) return false;
  try {
    await thread.setName(name);
    return true;
  } catch (err) {
    console.error('[Bot] thread rename failed:', err.message);
    return false;
  }
}

const MONTH_NAME =
  'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';

function isDateOnlyLine(line) {
  const t = String(line || '')
    .trim()
    .replace(/[.,:]\s*$/g, '')
    .replace(/^[—–-]\s*/, '');
  if (!t || /#/.test(t)) return false;
  if (/^\d{1,2}[/.]\d{1,2}[/.]\d{2,4}(?:[, ]+\d{1,2}:\d{2}(?:\s*[ap]m)?)?$/i.test(t)) return true;
  if (/^\d{4}-\d{1,2}-\d{1,2}(?:[ t]\d{1,2}:\d{2})?$/i.test(t)) return true;
  if (/^\d{1,2}-\d{1,2}-\d{2,4}$/.test(t)) return true;
  if (/^\d{1,2}:\d{2}(?:\s*[ap]m)?$/i.test(t)) return true;
  if (/^(yesterday|today)(?:\s+at\s+\d{1,2}:\d{2}(?:\s*[ap]m)?)?$/i.test(t)) return true;
  const weekday = '(?:(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*,?\\s+)?';
  const clock = '(?:\\s+\\d{1,2}:\\d{2}(?:\\s*[ap]m)?)?';
  const monthDay = new RegExp(
    `^${weekday}(?:${MONTH_NAME})\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?${clock}$`,
    'i'
  );
  const dayMonth = new RegExp(
    `^${weekday}\\d{1,2}(?:st|nd|rd|th)?\\s+(?:${MONTH_NAME})\\.?(?:,?\\s+\\d{4})?${clock}$`,
    'i'
  );
  return monthDay.test(t) || dayMonth.test(t);
}

function isLabeledDateLine(line) {
  const raw = String(line || '').trim();
  if (/#\s*\d{3,}/.test(raw) || /\border\b/i.test(raw)) return false;
  const match = raw.match(/^[A-Za-z0-9][A-Za-z0-9]{1,16}\s*[—–-]\s+(.+)$/);
  if (!match) return false;
  return isDateOnlyLine(match[1]);
}

function quoteHasBody(lines) {
  return lines.some((line) => {
    const t = line.trim();
    if (!t) return false;
    if (/^op\s*[,.:]?$/i.test(t) || /^e\s+embaixo\s*[,.:]?\s*$/i.test(t)) return false;
    if (isDateOnlyLine(t) || isLabeledDateLine(t)) return false;
    if (/^[A-Za-z][A-Za-z'’-]{1,20}[,.]?$/.test(t)) return false;
    return true;
  });
}

function stripQuoteChrome(text) {
  const lines = String(text || '').split('\n');
  const hasBody = quoteHasBody(lines);
  const kept = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) {
      kept.push(line);
      continue;
    }
    if (/^op\s*[,.:]?$/i.test(t) || /^e\s+embaixo\s*[,.:]?\s*$/i.test(t)) continue;
    if (isDateOnlyLine(t) || isLabeledDateLine(t)) continue;
    if (hasBody && /^[A-Za-z][A-Za-z'’-]{1,20}[,.]?$/.test(t)) continue;
    kept.push(line);
  }
  return kept.join('\n').replace(/[^\S\n]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
}

function hasMailboxMark(token) {
  return /[._\d]/.test(token) && !/^[0-9]+$/.test(token);
}

function redactBareMailbox(text) {
  const provider = '(?:gmail|hotmail)';
  const handle = '(?![0-9]+\\b)(?=[A-Z0-9._%+-]*[._\\d])[A-Z0-9._%+-]+';
  let out = String(text || '');
  out = out.replace(
    new RegExp(`\\b[A-Z0-9._%+-]+\\s*@\\s*${provider}(?:\\.[A-Z]{2,})?\\b`, 'gi'),
    '[email]'
  );
  out = out.replace(
    new RegExp(
      `\\b([A-Z0-9._%+-]{2,})\\s*(?:\\(|\\[)\\s*at\\s*(?:\\)|\\])\\s*${provider}(?:\\.[A-Z]{2,})?\\b`,
      'gi'
    ),
    (match, token) => (hasMailboxMark(token) ? '[email]' : match)
  );
  out = out.replace(new RegExp(`\\b${handle}\\s+(?:at\\s+)?${provider}(?:\\.[A-Z]{2,})?\\b`, 'gi'), '[email]');
  out = out.replace(
    new RegExp(`\\b${provider}(?:\\.[A-Z]{2,})?\\s+(?:is\\s+)?${handle}\\b`, 'gi'),
    '[email]'
  );
  out = out.replace(
    new RegExp(`\\b${provider}\\s*[:/]\\s*([A-Z0-9._%+-]{2,})\\b`, 'gi'),
    (match, token) => (hasMailboxMark(token) ? '[email]' : match)
  );
  out = out.replace(
    new RegExp(`\\b([A-Z0-9._%+-]{2,})\\s*[\\[(]\\s*${provider}\\s*[\\])]`, 'gi'),
    (match, token) => (hasMailboxMark(token) ? '[email]' : match)
  );
  return out;
}

function redactCardQuote(text) {
  let out = redactSensitive(text);
  out = out.replace(
    /(?<!#)\b\d{1,5}[A-Za-z]?\s+(?:[A-Za-z][A-Za-z.'-]*\s+){1,4}(?:street|st|avenue|ave|road|rd|boulevard|blvd|lane|ln|drive|dr|court|ct|place|pl|way|terrace|crescent)\b\.?/gi,
    '[address]'
  );
  out = out.replace(
    /(?<![\w#])\+?(?:\(\d{1,4}\)|\d{1,4})(?:[\s.-]*(?:\(\d{1,4}\)|\d{1,4})){1,4}(?![\w])/g,
    (match) => {
      const digits = match.replace(/\D/g, '');
      if (digits.length < 10 || digits.length > 15) return match;
      return '[phone]';
    }
  );
  out = redactBareMailbox(out);
  return stripQuoteChrome(out);
}

function formatStaffTicket({
  message,
  question,
  reason,
  draft,
  shopify,
  area,
  lane,
  github,
  fileIssueId,
  staffOnly = false,
  labels: labelOverride,
  dataLossRisk = false,
  caseId,
}) {
  const asked = clipUserQuestion(question);
  const jump = message?.url || '';
  const from = /^\d+$/.test(String(message?.author?.id || '')) ? `<@${message.author.id}>` : 'unknown user';
  const channel = message?.channel?.id ? `<#${message.channel.id}>` : '';
  const cleanDraft = stripPingNarration(draft || '');
  const resolved = resolveRoute({ area, lane, question });
  const whyReason = pickStaffReason(resolved, reason, question) || "I can't finish this from chat.";
  const why = clipForDiscord(
    dataLossRisk
      ? `Possible data loss: they should not reinstall, log out or clear storage.\n${whyReason}`
      : whyReason,
    300
  );
  const labels =
    Array.isArray(labelOverride) && labelOverride.length
      ? labelOverride.filter((label) => label && label !== 'needs-human')
      : ticketLabels({ area: resolved.area, lane: resolved.lane, question });
  if (!labels.length) labels.push('needs-human');
  if (dataLossRisk && !labels.includes('data-loss')) labels.push('data-loss');

  const embed = {
    title: 'Needs a human',
    color: 0xe67e22,
    description: redactCardQuote(asked) || '(no text)',
    fields: [
      { name: 'Why', value: why, inline: false },
    ],
  };
  if (staffOnly && /^[A-Za-z0-9_.:-]{1,128}$/.test(String(caseId || ''))) {
    embed.fields.push({ name: 'Case', value: String(caseId), inline: true });
  }
  embed.fields.push({
    name: 'Labels',
    value: labels.map((label) => `\`${label}\``).join('  '),
    inline: true,
  });
  const areaValue = resolved.area !== 'unknown' ? resolved.area : resolved.lane !== 'unknown' ? resolved.lane : '';
  if (areaValue) {
    embed.fields.push({ name: 'Area', value: String(areaValue), inline: true });
  }
  const specialist = specialistNames(resolved.area, resolved.lane);
  embed.fields.push({ name: 'Owner', value: specialist, inline: true });
  const shopifyFacts = clipForDiscord(String(shopify || '').trim(), 500);
  if (shopifyFacts) {
    embed.fields.push({ name: 'Shopify', value: shopifyFacts, inline: false });
  }
  const githubFacts = clipForDiscord(String(github || '').trim(), 400);
  if (githubFacts) {
    embed.fields.push({ name: 'GitHub', value: githubFacts, inline: false });
  }
  embed.fields.push({
    name: 'From',
    value: [from, channel].filter(Boolean).join(' · ') || 'unknown',
    inline: true,
  });
  if (jump) {
    embed.fields.push({ name: 'Jump', value: `[Open message](${jump})`, inline: true });
  }
  embed.fields.push({
    name: 'Staff',
    value: staffOnly
      ? `Reply in the customer's thread using the Jump link above (or to the linked message if it is not in a thread); replies in #vector-staff do not reach the customer.\n${staffDetailsRequest(resolved, question)}\nUse \`/done\` in the customer's forum or Handoff thread when resolved. Use \`faq: short true sentence\` in a Handoff thread to save a fact.`
      : `Reply here. If this card is in the customer thread, they can read it.\n${staffDetailsRequest(resolved, question)}\nTo save a fact for next time: \`faq: short true sentence\`\n\`/done\` when it is resolved.`,
    inline: false,
  });
  embed.description = embed.description.replace(/<@(?:&|!)?\d+>/g, '[Discord user]');
  for (const field of embed.fields) {
    if (field.name === 'From') continue; // Trusted author ID identifies the customer without a notification.
    field.value = field.value.replace(/<@(?:&|!)?\d+>/g, '[Discord user]');
  }

  const discord = {
    embeds: [embed],
    allowedMentions: {
      parse: [],
      users: [],
      roles: [],
    },
  };
  if (fileIssueId) {
    discord.components = [
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 1,
            custom_id: `file:${fileIssueId}`,
            label: 'File issue',
          },
        ],
      },
    ];
  }
  if (staffOnly && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(caseId || ''))) {
    if (!discord.components) discord.components = [{ type: 1, components: [] }];
    discord.components[0].components.push({ type: 2, style: 1, custom_id: `case:accept:${caseId}`, label: 'Accept case' });
  }

  return {
    discord,
    plain: {
      caseId,
      threadId: message?.channel?.id,
      jumpUrl: jump,
      userQuestion: redactCardQuote(asked),
      botDraft: cleanDraft,
      missingInfo: why,
    },
  };
}

async function postHandoffThread(message, payload, meta = {}) {
  await assertCurrentOwnership();
  if (message.channel?.isThread?.()) return null;

  if (message.hasThread && message.thread?.send) {
    await assertCurrentOwnership();
    await message.thread.send(payload);
    return message.thread;
  }

  // A private thread is customer-visible, not a staff-only channel. It still
  // receives only the minimal card. Invite the customer and configured staff.
  if (typeof message.channel?.threads?.create === 'function' && message.author?.id) {
    try {
      await assertCurrentOwnership();
      const thread = await message.channel.threads.create({
        name: handoffThreadName(meta),
        type: ChannelType.PrivateThread,
        invitable: false,
        autoArchiveDuration: 1440,
        reason: 'Support handoff',
      });
      await assertCurrentOwnership();
      await thread.members?.add?.(String(message.author.id));
      for (const id of staffMentionIds().users) {
        try { await assertCurrentOwnership(); await thread.members?.add?.(id); } catch (err) { if (isLeaseLost(err)) throw err; console.error('[Bot] private handoff staff invite failed:', err.message); }
      }
      await assertCurrentOwnership();
      await thread.send(payload);
      return thread;
    } catch (err) {
      if (isLeaseLost(err)) throw err;
      console.error('[Bot] private handoff unavailable:', err.message);
    }
  }

  if (!message?.startThread) return null;

  await assertCurrentOwnership();
  const thread = await message.startThread({
    name: handoffThreadName({
      question: meta.question,
      area: meta.area,
      lane: meta.lane,
      topic: meta.topic,
      labels: meta.labels,
    }),
    autoArchiveDuration: 1440,
    reason: 'Could not finish this from chat',
  });
  await assertCurrentOwnership();
  await thread.send(payload);
  return thread;
}

async function sendToStaffChannel(client, payload, customerChannelId) {
  const staffId = process.env.STAFF_ALERT_CHANNEL_ID;
  if (!staffId || !client?.channels?.fetch) return false;
  if (String(staffId) === String(customerChannelId || '')) return false;
  const ch = await client.channels.fetch(staffId);
  if (!ch?.isTextBased?.() || typeof ch.send !== 'function') return false;
  await assertCurrentOwnership();
  await ch.send(payload);
  return true;
}

const PUBLIC_HELP_CARD_DESCRIPTION =
  'Details are in the original support message. This card does not repeat it.';

function publicHandoffDiscord(discord) {
  const embed = discord?.embeds?.[0] || {};
  const keep = new Set(['Area', 'Owner', 'Labels']);
  const fields = (embed.fields || [])
    .filter((field) => keep.has(field?.name))
    .map((field) => ({
      name: field.name,
      value:
        field.name === 'Owner' ? String(field.value || '').replace(/@/g, '') : field.value,
      inline: field.inline,
    }));
  const payload = {
    embeds: [
      {
        title: embed.title,
        color: embed.color,
        description: PUBLIC_HELP_CARD_DESCRIPTION,
        fields,
      },
    ],
    allowedMentions: {
      parse: [],
      users: [],
      roles: [],
    },
  };
  if (Array.isArray(discord?.components) && discord.components.length) {
    const publicRows = discord.components.map((row) => ({ ...row,
      components: (row.components || []).filter((component) => !String(component.custom_id || component.customId || '').startsWith('case:accept:')),
    })).filter((row) => row.components.length);
    if (publicRows.length) payload.components = publicRows;
  }
  return payload;
}

async function notifyStaff({
  client,
  message,
  question,
  reason,
  draft,
  shopify,
  area,
  github,
  fileIssueId,
  route,
  skipDedupe = false,
  topic,
  labels,
  dataLossRisk = false,
  caseId,
}) {
  const channelId = message?.channel?.id;
  const userId = message?.author?.id;
  if (!skipDedupe && recentlyHandedOff(channelId, userId)) {
    return { ok: true, via: 'recent', duplicate: true };
  }

  const ticket = formatStaffTicket({
    caseId,
    message,
    question,
    reason,
    draft,
    shopify,
    area,
    lane: route?.lane,
    github,
    fileIssueId,
    staffOnly: true,
    labels,
    dataLossRisk,
  });
  const errors = [];
  let visibleCard = null;

  try {
    if (await sendToStaffChannel(client, ticket.discord, channelId)) {
      markHandedOff(channelId, userId, true);
      await assertCurrentOwnership();
      await telegram.sendEscalation(ticket.plain);
      return { ok: true, via: 'staff-channel' };
    }
  } catch (err) {
    if (isLeaseLost(err)) throw err;
    errors.push(`staff-channel: ${err.message}`);
  }

  if (process.env.HANDOFF_THREADS !== '0') {
    try {
      const thread = await postHandoffThread(message, publicHandoffDiscord(ticket.discord), {
        question,
        area,
        lane: route?.lane,
        topic,
        labels,
      });
      if (thread) {
        visibleCard = { via: 'thread', threadId: thread.id, thread };
      }
    } catch (err) {
      if (isLeaseLost(err)) throw err;
      errors.push(`thread: ${err.message}`);
    }
  }

  try {
    if (!visibleCard && message?.channel?.isTextBased?.() && typeof message.channel.send === 'function') {
      const payload = publicHandoffDiscord(ticket.discord);
      await assertCurrentOwnership();
      await message.channel.send(payload);
      visibleCard = { via: 'channel' };
    }
  } catch (err) {
    if (isLeaseLost(err)) throw err;
    errors.push(`channel: ${err.message}`);
  }

  try {
    await assertCurrentOwnership();
    if (await telegram.sendEscalation(ticket.plain)) {
      markHandedOff(channelId, userId, true);
      return { ok: true, ...(visibleCard || { via: 'telegram' }), deliveredVia: 'telegram' };
    }
  } catch (err) {
    if (isLeaseLost(err)) throw err;
    errors.push(`telegram: ${err.message}`);
  }

  markHandedOff(channelId, userId, false);
  console.error('[Handoff] Staff delivery failed; no staff-only destination accepted the ticket.');
  return { ok: false, ...(visibleCard || { via: null }), error: errors.join('; ') || 'no staff path' };
}

function appliedTagNames(channel) {
  const tags = channel?.parent?.availableTags || channel?.parent?.available_tags || [];
  const applied = new Set([...(channel?.appliedTags || [])].map(String));
  return tags
    .filter((tag) => applied.has(String(tag.id)))
    .map((tag) => String(tag.name || '').trim())
    .filter(Boolean);
}

function threadHasKnownIssueTag(channel) {
  if (!isHelpForumThread(channel)) return false;
  return appliedTagNames(channel).some((name) => /^known issue$/i.test(name));
}

function forumStarterPrefix(message) {
  const channel = message?.channel;
  if (!isHelpForumThread(channel)) return '';
  if (String(message?.id || '') !== String(channel?.id || '')) return '';
  const title = String(channel.name || '').trim();
  const tags = appliedTagNames(channel);
  const lines = [];
  if (title) lines.push(`Post: ${title}`);
  if (tags.length) lines.push(`Tags: ${tags.join(', ')}`);
  return lines.join('\n');
}

function isHandoffThread(channel) {
  return Boolean(channel?.isThread?.() && /^Handoff\b/i.test(channel.name || ''));
}

function canSaveFaq(userId, allowList) {
  const users = allowList !== undefined ? allowList : staffMentionIds().users;
  if (!users.length) return false;
  return users.includes(String(userId || ''));
}

module.exports = {
  DEDUPE_MS,
  canNotifyStaff,
  recentlyHandedOff,
  resetHandoffMemory,
  formatStaffTicket,
  publicHandoffDiscord,
  clipUserQuestion,
  ticketLabels,
  threadTopic,
  handoffThreadName,
  applyThreadName,
  isSameHandoff,
  shouldReuseOpenHandoff,
  isWeakerHandoffName,
  findOpenHandoff,
  rememberOpenHandoff,
  markHandoffClosed,
  markHandoffReopened,
  notifyStaff,
  sendToStaffChannel,
  isHandoffThread,
  isHelpForumThread,
  forumStarterPrefix,
  threadHasKnownIssueTag,
  isCloseableThread,
  canSaveFaq,
  canStaffAct,
  staffMentions,
  staffMentionIds,
};
