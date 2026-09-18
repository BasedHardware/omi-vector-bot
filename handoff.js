const telegram = require('./telegram');
const { clipForDiscord, stripPingNarration } = require('./utils');
const { ownerMention, ownerRef, shouldPingOwner, parseAreaOwners, classify } = require('./router');

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

function canStaffAct(interaction) {
  const userId = String(interaction?.user?.id || '');
  const { users, roles } = staffMentionIds();
  if (users.includes(userId)) return true;
  const cache = interaction?.member?.roles?.cache;
  if (roles.length && cache) {
    if (typeof cache.has === 'function' && roles.some((id) => cache.has(id))) return true;
    if (typeof cache.includes === 'function' && roles.some((id) => cache.includes(id))) return true;
  }
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

function clipUserQuestion(text) {
  const raw = String(text || '').trim();
  const cleaned = raw
    .split('\n')
    .filter((line) => !/^want:\s/i.test(line.trim()))
    .join('\n')
    .trim();
  return clipForDiscord(cleaned || raw, 1000);
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
    /\b(taxes?|refunds?|payment)\b/i.test(q) &&
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
  const numbered = raw.match(/\border\s*#\s*(\d{3,})\b/i);
  if (numbered) return `Order #${numbered[1]}`;
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
  const line = raw
    .split('\n')
    .map((part) => part.trim())
    .filter((part) => !isThreadNoise(part))
    .find((part) => part.length > 12 && part.length <= 70);
  if (line) return clipForDiscord(line.replace(/["*_`]/g, ''), 70);
  const resolved = resolveRoute({ area: route.area, lane: route.lane, question });
  return defaultTopic(resolved.area, resolved.lane);
}

function handoffThreadName({ question, area, lane } = {}) {
  const resolved = resolveRoute({ area, lane, question });
  const labels = ticketLabels({ area: resolved.area, lane: resolved.lane, question });
  return clipForDiscord(
    `Handoff · ${labels.join(' · ')} · ${threadTopic(question, resolved)}`,
    100
  );
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
}) {
  const why = clipForDiscord(reason || "I can't finish this from chat.", 200);
  const asked = clipUserQuestion(question);
  const jump = message?.url || '';
  const from = message?.author?.id ? `<@${message.author.id}>` : 'unknown user';
  const channel = message?.channel?.id ? `<#${message.channel.id}>` : '';
  const mentions = [staffMentions(), extraMentions].filter(Boolean).join(' ').trim();
  const { users, roles } = staffMentionIds();
  const cleanDraft = stripPingNarration(draft || '');
  const resolved = resolveRoute({ area, lane, question });
  const labels = ticketLabels({ area: resolved.area, lane: resolved.lane, question });

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
      users: [...users, ...(extraUsers || [])],
      roles: [...roles, ...(extraRoles || [])],
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
}) {
  const channelId = message?.channel?.id;
  if (!skipDedupe && recentlyHandedOff(channelId)) {
    return { ok: true, via: 'recent', duplicate: true };
  }

  let extraMentions = '';
  const extraUsers = [];
  const extraRoles = [];
  if (shouldPingOwner(route || { area, escalate: true, lane: area })) {
    const owners = parseAreaOwners();
    extraMentions = ownerMention(area, owners);
    const ref = ownerRef(area, owners);
    if (ref?.kind === 'user') extraUsers.push(ref.id);
    if (ref?.kind === 'role') extraRoles.push(ref.id);
  }

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
      });
      if (thread) {
        markHandedOff(channelId, true);
        await telegram.sendEscalation(ticket.plain);
        return { ok: true, via: 'thread', threadId: thread.id };
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
  notifyStaff,
  isHandoffThread,
  canSaveFaq,
  canStaffAct,
  staffMentions,
  staffMentionIds,
};
