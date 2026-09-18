const telegram = require('./telegram');
const { clipForDiscord, stripPingNarration } = require('./utils');
const { ownerMention, ownerRef, shouldPingOwner, parseAreaOwners } = require('./router');

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

function formatStaffTicket({
  message,
  question,
  reason,
  draft,
  shopify,
  area,
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

  const embed = {
    title: 'Needs a human',
    color: 0xe67e22,
    description: asked || '(no text)',
    fields: [
      { name: 'Why', value: why, inline: false },
    ],
  };
  if (area) {
    embed.fields.push({ name: 'Area', value: String(area), inline: true });
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

async function postHandoffThread(message, payload) {
  if (!message?.startThread) return null;
  if (message.channel?.isThread?.()) return null;

  if (message.hasThread && message.thread?.send) {
    await message.thread.send(payload);
    return message.thread;
  }

  const username = String(message.author?.username || 'user').slice(0, 24);
  const thread = await message.startThread({
    name: `Handoff · ${username}`.slice(0, 100),
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
      const thread = await postHandoffThread(message, ticket.discord);
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
  notifyStaff,
  isHandoffThread,
  canSaveFaq,
  canStaffAct,
  staffMentions,
  staffMentionIds,
};
