const telegram = require('./telegram');
const { clipForDiscord, stripPingNarration } = require('./utils');
const { classify, pickStaffReason, looksLikeCaptureFailure, looksLikeTranscription, specialistNames } = require('./router');

const DEDUPE_MS = 15 * 60_000;
const lastHandoff = new Map();

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
  if (discordReady) return true;
  if (process.env.STAFF_ALERT_CHANNEL_ID) return true;
  return telegram.isReady();
}

function recentlyHandedOff(channelId) {
  const prev = lastHandoff.get(String(channelId || ''));
  return Boolean(prev && prev.ok && Date.now() - prev.at < DEDUPE_MS);
}

function markHandedOff(channelId, ok) {
  lastHandoff.set(String(channelId || ''), { ok: Boolean(ok), at: Date.now() });
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
  if (remembered && !remembered.archived) return remembered;
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
    if (thread?.archived) continue;
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
  return clipForDiscord(`Handoff · ${tag.join(' · ')} · ${subject}`, 100);
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
  extraMentions,
  extraUsers,
  extraRoles,
  labels: labelOverride,
}) {
  const asked = clipUserQuestion(question);
  const jump = message?.url || '';
  const from = message?.author?.id ? `<@${message.author.id}>` : 'unknown user';
  const channel = message?.channel?.id ? `<#${message.channel.id}>` : '';
  const mentions = '';
  const cleanDraft = stripPingNarration(draft || '');
  const resolved = resolveRoute({ area, lane, question });
  const why = clipForDiscord(
    pickStaffReason(resolved, reason, question) || "I can't finish this from chat.",
    200
  );
  const labels =
    Array.isArray(labelOverride) && labelOverride.length
      ? labelOverride.filter((label) => label && label !== 'needs-human')
      : ticketLabels({ area: resolved.area, lane: resolved.lane, question });
  if (!labels.length) labels.push('needs-human');

  const embed = {
    title: 'Needs a human',
    color: 0xe67e22,
    description: asked || '(no text)',
    fields: [
      { name: 'Why', value: why, inline: false },
    ],
  };
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
  if (specialist) {
    embed.fields.push({ name: 'Specialist', value: specialist, inline: true });
  }
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
    value:
      'Reply in this thread. The user can read it.\nTo save a fact for next time: `faq: short true sentence`\n`/done` when it is resolved.',
    inline: false,
  });

  const discord = {
    content: mentions || undefined,
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

  return {
    discord,
    plain: {
      threadId: message?.channel?.id,
      jumpUrl: jump,
      userQuestion: asked,
      botDraft: cleanDraft,
      missingInfo: why,
    },
  };
}

async function postHandoffThread(message, payload, meta = {}) {
  if (!message?.startThread) return null;
  if (message.channel?.isThread?.()) return null;

  if (message.hasThread && message.thread?.send) {
    await message.thread.send(payload);
    return message.thread;
  }

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
  await thread.send(payload);
  return thread;
}

async function sendToStaffChannel(client, payload) {
  const staffId = process.env.STAFF_ALERT_CHANNEL_ID;
  if (!staffId || !client?.channels?.fetch) return false;
  const ch = await client.channels.fetch(staffId);
  if (!ch?.isTextBased?.() || typeof ch.send !== 'function') return false;
  await ch.send(payload);
  return true;
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
}) {
  const channelId = message?.channel?.id;
  if (!skipDedupe && recentlyHandedOff(channelId)) {
    return { ok: true, via: 'recent', duplicate: true };
  }

  let extraMentions = '';
  const extraUsers = [];
  const extraRoles = [];

  const ticket = formatStaffTicket({
    message,
    question,
    reason,
    draft,
    shopify,
    area,
    lane: route?.lane,
    github,
    fileIssueId,
    extraMentions,
    extraUsers,
    extraRoles,
    labels,
  });
  const errors = [];

  try {
    if (await sendToStaffChannel(client, ticket.discord)) {
      markHandedOff(channelId, true);
      await telegram.sendEscalation(ticket.plain);
      return { ok: true, via: 'staff-channel' };
    }
  } catch (err) {
    errors.push(`staff-channel: ${err.message}`);
  }

  if (process.env.HANDOFF_THREADS !== '0') {
    try {
      const thread = await postHandoffThread(message, ticket.discord, {
        question,
        area,
        lane: route?.lane,
        topic,
        labels,
      });
      if (thread) {
        markHandedOff(channelId, true);
        await telegram.sendEscalation(ticket.plain);
        return { ok: true, via: 'thread', threadId: thread.id, thread };
      }
    } catch (err) {
      errors.push(`thread: ${err.message}`);
    }
  }

  try {
    if (message?.channel?.isTextBased?.() && typeof message.channel.send === 'function') {
      await message.channel.send(ticket.discord);
      markHandedOff(channelId, true);
      await telegram.sendEscalation(ticket.plain);
      return { ok: true, via: 'channel' };
    }
  } catch (err) {
    errors.push(`channel: ${err.message}`);
  }

  try {
    if (await telegram.sendEscalation(ticket.plain)) {
      markHandedOff(channelId, true);
      return { ok: true, via: 'telegram' };
    }
  } catch (err) {
    errors.push(`telegram: ${err.message}`);
  }

  markHandedOff(channelId, false);
  return { ok: false, via: null, error: errors.join('; ') || 'no staff path' };
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
  if (!users.length) return true;
  return users.includes(String(userId || ''));
}

module.exports = {
  DEDUPE_MS,
  canNotifyStaff,
  recentlyHandedOff,
  resetHandoffMemory,
  formatStaffTicket,
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
  notifyStaff,
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
