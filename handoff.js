const telegram = require('./telegram');
const { clipForDiscord } = require('./utils');

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

function formatStaffTicket({ message, question, reason, draft }) {
  const why = clipForDiscord(reason || 'Vector cannot finish this. Needs a person.', 200);
  const asked = clipForDiscord(question || '(no text)', 1000);
  const jump = message?.url || '';
  const from = message?.author?.id ? `<@${message.author.id}>` : 'unknown user';
  const channel = message?.channel?.id ? `<#${message.channel.id}>` : '';
  const mentions = staffMentions();
  const { users, roles } = staffMentionIds();

  const embed = {
    title: 'Needs a human',
    color: 0xe67e22,
    description: asked,
    fields: [
      { name: 'Why', value: why, inline: false },
      { name: 'From', value: [from, channel].filter(Boolean).join(' · '), inline: true },
    ],
  };
  if (jump) embed.fields.push({ name: 'Jump', value: jump, inline: true });
  const clippedDraft = clipForDiscord(draft || '', 300);
  if (clippedDraft) {
    embed.fields.push({ name: 'Vector draft', value: clippedDraft, inline: false });
  }

  return {
    discord: {
      content: mentions || undefined,
      embeds: [embed],
      allowedMentions: { parse: [], users, roles },
    },
    plain: {
      threadId: message?.channel?.id,
      jumpUrl: jump,
      userQuestion: question,
      botDraft: draft,
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
    reason: 'Vector could not resolve this',
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

async function notifyStaff({ client, message, question, reason, draft }) {
  const channelId = message?.channel?.id;
  if (recentlyHandedOff(channelId)) {
    return { ok: true, via: 'recent', duplicate: true };
  }

  const ticket = formatStaffTicket({ message, question, reason, draft });
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

module.exports = {
  DEDUPE_MS,
  canNotifyStaff,
  recentlyHandedOff,
  resetHandoffMemory,
  formatStaffTicket,
  notifyStaff,
  isHandoffThread,
  staffMentions,
};
